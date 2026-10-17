/**
 * Claude through the first-party Claude API, via `@anthropic-ai/sdk` (ADR-0054).
 *
 * The client is built with the SDK's retries off: the only retry is the app's own, in the
 * gateway (`providers/gateway.ts`), per the Stage 15 matrix (ER-1, ER-2), so attempts, backoff
 * and usage stay in one place. The API key comes from the environment and is never logged.
 */
import { neutraliseReservedTags } from '../services/prompt/reservedTags.js';
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';

import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { sourcesFromAnthropicBlocks } from './grounding.js';
import type {
  GenerationRequest,
  Provider,
  ProviderEvent,
  ProviderUsage,
  UsageSource,
  ToolDefinition,
  ToolResult,
} from './types.js';
import { addRequestUsage, EMPTY_USAGE, isAbort, replayNatively, toolCallAsText, ModelNotFoundError, primaryToolContent, ProviderError, toolImages } from './types.js';
import { callFingerprint, duplicateFailedCallResult, hasTerminalToolCall, isLastRound, resolveMaxRounds } from './toolLoopPolicy.js';
import { attachmentText, nameForModel, pageLabel, unavailableAttachmentNote } from './attachmentContent.js';
import { getModelCapability } from './capabilitiesTable.js';
import type { HelperRequest, HelperResult, ReasoningEffort } from './types.js';
import { normalisedFinish } from './finish.js';

const log = logger.child({ module: 'provider:anthropic' });

/**
 * Stage 15 ER-2: transient before the first token. 529 is the API's `overloaded_error`
 * (Claude docs, Errors). A 429 that is a spend limit is not transient; `classifyAnthropicError`
 * says so.
 */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/**
 * A mid-stream `error` event carries no HTTP status, only its error type (the SDK raises it as an
 * `APIError` with `status` undefined and `type` set). Each type is classified as the status the
 * Claude docs give it (Errors: "HTTP errors"); an unknown type is transient (Stage 21 doc-sync
 * 2026-10-12: "an unknown type is transient").
 */
const ERROR_TYPE_STATUS: Readonly<Record<string, number>> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
};

/** AL-5: the thinking-block 400s a stripped re-send repairs (Stage 15 EH24 / F31). */
export function isThinkingSignature400(err: unknown): boolean {
  if (statusOf(err) !== 400) return false;
  const text = err instanceof Error ? err.message : String(err);
  return /invalid.{0,40}signature|bound to a different conversation/i.test(text);
}

/**
 * The tool version string is part of the API contract, not a date to be freshened casually.
 * The 2026-02-09 version (dynamic filtering) is the one the first-party API serves for Sonnet 5.5
 * and Opus 5.5 (Claude docs, Web search tool); Vertex only had the 2025-03-05 one.
 */
const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 } as const;

/** The SDK surface this adapter uses, so tests can inject a fake client (no network). */
export type AnthropicClient = Pick<Anthropic, 'messages'>;

/** The one place the first-party client is built: retries off (ER-1), timeout from config (N-43). */
export function createAnthropicClient(cfg: Config): Anthropic {
  if (!cfg.ANTHROPIC_API_KEY) {
    throw new ProviderError('ANTHROPIC_API_KEY is not set', { code: 'model_unavailable' });
  }
  return new Anthropic({
    apiKey: cfg.ANTHROPIC_API_KEY,
    // N-42: retries live in the app gateway only; the SDK's default of 2 would hide attempts.
    maxRetries: 0,
    // N-43 (repo value, ADR-0024): one request, stream included.
    timeout: cfg.PROVIDER_TIMEOUT_MS,
  });
}

/** Whether any assistant turn of the request carries a thinking block. */
function hasThinking(messages: Anthropic.MessageParam[]): boolean {
  return messages.some((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b) => b.type === 'thinking' || b.type === 'redacted_thinking'));
}

/** The request with every thinking block left out (AL-5 repair). */
export function withoutThinking(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((m) =>
    m.role === 'assistant' && Array.isArray(m.content)
      ? { ...m, content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') }
      : m,
  );
}

/** How often a call's partial input is parsed and reported while it streams (ADR-0037). */
const PARTIAL_INPUT_INTERVAL_MS = 120;

export function toAnthropicTool(def: ToolDefinition): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: structuredClone(def.inputSchema) as Anthropic.Tool.InputSchema,
  };
}

/** A `json` block round-trips as a JSON string in `content` — Anthropic's tool_result content is
 *  text or a content-block array, never a structured object, so this is the one place a
 *  structured `ToolResult` becomes a string for this provider specifically. */
export function toAnthropicToolResultBlock(
  toolUseId: string,
  result: ToolResult,
): Anthropic.ToolResultBlockParam {
  const block = primaryToolContent(result);
  const text = block === undefined ? '' : block.type === 'json' ? JSON.stringify(block.data) : block.text;
  const images = toolImages(result);
  if (images.length === 0) return { type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: !result.ok };
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: !result.ok,
    content: [
      { type: 'text', text: text || '(see images)' },
      ...images.map((img) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: img.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: img.base64,
        },
      })),
    ],
  };
}

/**
 * A failure that is the account's limit, not the request's: the organisation spend cap (429
 * `enforced_spend_limit_reached` without a usable retry), a workspace usage limit (400 "API usage
 * limits") or billing (402). Stage 15 doc-sync 2026-10-12: never retried; the turn says so.
 */
function isAccountLimit(err: unknown, status: number | undefined): boolean {
  if (status === 402) return true;
  const text = err instanceof Error ? err.message : String(err);
  if (status === 429 && /spend[_ ]limit/i.test(text)) return true;
  if (status === 400 && /usage limits/i.test(text)) return true;
  return false;
}

/** A provider `retry-after` (seconds) or `retry-after-ms`, in milliseconds; undefined when absent. */
function retryAfterMs(err: unknown): number | undefined {
  if (!(err instanceof APIError) || !err.headers) return undefined;
  const headers = err.headers as Headers | Record<string, string | undefined>;
  const read = (name: string): string | null | undefined =>
    typeof (headers as Headers).get === 'function' ? (headers as Headers).get(name) : (headers as Record<string, string | undefined>)[name];
  const ms = Number(read('retry-after-ms'));
  if (Number.isFinite(ms) && ms >= 0 && read('retry-after-ms') != null) return ms;
  const seconds = Number(read('retry-after'));
  if (read('retry-after') != null && Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}

/** The typed error a failed Claude call becomes, classified per the Stage 15 matrix (ER-2f/g/h). */
export function classifyAnthropicError(err: unknown, modelId: string, partialUsage?: ProviderUsage): ProviderError {
  const httpStatus = statusOf(err);
  const type = err instanceof APIError && typeof err.type === 'string' ? err.type : undefined;
  const midStream = httpStatus === undefined && type !== undefined;
  const status = httpStatus ?? (type !== undefined ? ERROR_TYPE_STATUS[type] : undefined);
  const usage = partialUsage !== undefined ? { partialUsage } : {};
  if (status === 404) {
    const missing = new ModelNotFoundError(modelId, 'global');
    missing.partialUsage = partialUsage;
    return missing;
  }
  if (isAccountLimit(err, status)) {
    return new ProviderError(`Claude account limit reached: ${String(err)}`, {
      code: 'provider_limit',
      kind: 'claude_limit',
      retryable: false,
      ...(status !== undefined ? { statusCode: status } : {}),
      ...usage,
    });
  }
  if (status === 401) {
    // M-09: the account's credentials; every Claude row is skipped for the turn.
    return new ProviderError(`Claude rejected the credentials: ${String(err)}`, {
      code: 'model_unavailable',
      kind: 'credentials',
      retryable: false,
      statusCode: status,
      ...usage,
    });
  }
  if (status === 403) {
    return new ProviderError(`Claude refused this model for the account: ${String(err)}`, {
      code: 'model_unavailable',
      kind: 'config',
      retryable: false,
      statusCode: status,
      ...usage,
    });
  }
  if (status === 413) {
    return new ProviderError(`Claude request too large: ${String(err)}`, {
      code: 'provider_payload_limit',
      kind: 'request_rejected',
      retryable: false,
      statusCode: status,
      ...usage,
    });
  }
  if (midStream && status === undefined) {
    // An error type this table does not know: transient (doc-sync 2026-10-12).
    return new ProviderError(`Claude stream error of an unknown type: ${String(err)}`, { kind: 'transient', ...usage });
  }
  const after = retryAfterMs(err);
  const retryable = status !== undefined && RETRYABLE_STATUS.has(status);
  return new ProviderError(`Claude request failed: ${String(err)}`, {
    retryable,
    kind: retryable ? 'transient' : 'request_rejected',
    ...(status !== undefined ? { statusCode: status } : {}),
    ...(after !== undefined ? { retryAfterMs: after } : {}),
    ...usage,
  });
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return undefined;
}

interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function usageFrom(raw: AnthropicUsage | undefined | null): ProviderUsage {
  if (!raw) return EMPTY_USAGE;
  if (raw.input_tokens == null && raw.output_tokens == null) return EMPTY_USAGE;
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    cacheReadTokens: raw.cache_read_input_tokens ?? 0,
    cacheWriteTokens: raw.cache_creation_input_tokens ?? 0,
    exact: true,
  };
}

/**
 * Anthropic splits one message's usage across `message_start` and `message_delta`.
 *
 * `message_start` carries input and cache counts; `message_delta` carries the final output
 * count. Take the max per field so a later frame that omits a value cannot erase an earlier one.
 */
function merge(base: ProviderUsage, update: ProviderUsage): ProviderUsage {
  if (!update.exact) return base;
  return {
    inputTokens: Math.max(base.inputTokens, update.inputTokens),
    outputTokens: Math.max(base.outputTokens, update.outputTokens),
    cacheReadTokens: Math.max(base.cacheReadTokens, update.cacheReadTokens),
    cacheWriteTokens: Math.max(base.cacheWriteTokens, update.cacheWriteTokens),
    exact: true,
  };
}

/**
 * One request's usage with its whole prompt size. `input_tokens` is only the part after the last
 * cache breakpoint: "total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens +
 * input_tokens" (Claude docs, Prompt caching).
 */
function requestUsage(round: ProviderUsage): ProviderUsage {
  if (!round.exact) return round;
  return {
    ...round,
    lastRequest: {
      inputTokens: round.inputTokens + round.cacheReadTokens + round.cacheWriteTokens,
      outputTokens: round.outputTokens,
    },
  };
}

/** P22: one request's `call_usage` event (ADR-0079). The id is Claude's message id. */
function callUsageEvent(
  round: number,
  usage: ProviderUsage,
  usageSource: UsageSource,
  finishReason: string,
  ref: string | undefined,
  startedAt: number,
  firstAt: number | undefined,
): ProviderEvent {
  const now = Date.now();
  return {
    type: 'call_usage',
    ordinal: round,
    usage,
    usageSource,
    finishReason,
    ...(ref ? { providerRef: { type: 'message_id' as const, value: ref } } : {}),
    ...(firstAt !== undefined ? { ttftMs: firstAt - startedAt } : {}),
    durationMs: now - startedAt,
  };
}

interface SearchResultBlock {
  type?: string;
  url?: string;
  title?: string;
  page_age?: string;
}

/** Pull `web_search_result` entries out of a content block, whatever shape it arrives in. */
function collectSearchResults(block: unknown): SearchResultBlock[] {
  if (typeof block !== 'object' || block === null) return [];
  const typed = block as { type?: string; content?: unknown };
  if (typed.type !== 'web_search_tool_result' || !Array.isArray(typed.content)) return [];
  return typed.content.filter(
    (item): item is SearchResultBlock => typeof item === 'object' && item !== null,
  );
}

type CacheableBlock =
  | Anthropic.ImageBlockParam
  | Anthropic.DocumentBlockParam
  | Anthropic.TextBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam;

function attachmentBlocks(attachments: GenerationRequest['attachments']): CacheableBlock[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.flatMap((a): CacheableBlock[] => {
    // 0. A PDF as its pages: each page's image, then its text (ADR-0013). Never the PDF itself.
    if (a.pages) {
      const note: CacheableBlock[] = a.pagesNote ? [{ type: 'text', text: a.pagesNote }] : [];
      return note.concat(a.pages.flatMap((page): CacheableBlock[] => [
        { type: 'text', text: `[${pageLabel(a, page.num)}${a.id ? `, fileId: ${a.id}` : ''}]` },
        ...(page.image?.base64
          ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: page.image.mimeType, data: page.image.base64 } }]
          : page.image
            ? // Page images reach this adapter as base64 only (gs:// URIs are Gemini's, ADR-0016);
              // a URI here is a wiring bug, said, not dropped.
              [{ type: 'text' as const, text: `The image of page ${String(page.num)} could not be sent to this model.` }]
            : []),
        {
          type: 'text',
          text: page.text ? `Text of page ${String(page.num)}:\n${neutraliseReservedTags(page.text)}` : `Page ${String(page.num)} has no text layer; read it from the image.`,
        },
      ]));
    }
    return [attachmentBlock(a)];
  });
}

/** The Messages API's bounds on a document block's `title` (DocumentBlockParam: minLength 1, maxLength 500). */
const DOCUMENT_TITLE_MAX_CHARS = 500;

/**
 * A document's title: the name as the model sees it everywhere (ADR-0069), within the API's
 * bounds. Escaping can make a 255-character name several times longer, and a name of nothing but
 * dropped characters becomes empty; either would make the API refuse every later turn that
 * replays the file (review build-3-fix r1). A cut never ends inside a character reference, nor
 * between the two halves of a surrogate pair: a lone surrogate is not valid in the request (r2).
 */
export function documentTitle(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const name = nameForModel(filename).trim();
  if (name === '') return undefined;
  if (name.length <= DOCUMENT_TITLE_MAX_CHARS) return name;
  return `${name.slice(0, DOCUMENT_TITLE_MAX_CHARS - 1).replace(/(?:&(?:#\d{0,3}|[a-z]{0,4})|[\uD800-\uDBFF])$/, '')}…`;
}

function attachmentBlock(a: NonNullable<GenerationRequest['attachments']>[number]): CacheableBlock {
  // 1. Native PDF (base64)
  if (a.mimeType === 'application/pdf' && a.base64) {
    const block: Anthropic.DocumentBlockParam = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: a.base64,
      },
    };
    const title = documentTitle(a.filename);
    if (title) block.title = title;
    return block;
  }

  // 2. Native Image (base64)
  if (a.mimeType.startsWith('image/') && a.base64) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: a.mimeType as Anthropic.Base64ImageSource['media_type'],
        data: a.base64,
      },
    };
  }

  // 3. Genuine text: extracted Office/PDF text, or a textual file's own bytes.
  const text = attachmentText(a);
  if (text !== null) {
    const block: Anthropic.DocumentBlockParam = {
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: text },
    };
    const title = documentTitle(a.filename);
    if (title) block.title = title;
    return block;
  }
  // 4. Nothing sendable: say so, never an empty document or decoded binary (G15, G17).
  return { type: 'text', text: unavailableAttachmentNote(a) };
}

/**
 * Build the Anthropic message array for one request, including caching.
 *
 * A turn with an attachment becomes a content-block array (media first, text last — Anthropic's
 * documented order); a plain-text turn stays a bare string, the cheapest wire shape. The
 * `cache_control` breakpoint marks everything through the previous assistant turn as cacheable;
 * the newest user turn is never marked, since by definition it is new on every call. The cache
 * TTL is the default 5 minutes (N-74: 1 h is not used, its write costs 2×).
 */
export function buildAnthropicMessages(request: GenerationRequest): Anthropic.MessageParam[] {
  const turns = request.history.filter(
    (turn) => turn.text.trim() !== '' || (turn.attachments?.length ?? 0) > 0 || (turn.toolCalls?.length ?? 0) > 0,
  );

  type Message = { role: 'user' | 'assistant'; content: string | CacheableBlock[] };
  const messages: Message[] = turns.flatMap((turn, t): Message[] => {
    const calls = turn.role === 'assistant' ? (turn.toolCalls ?? []) : [];
    // Earlier calls go back as tool_use then tool_result, as Claude's history keeps them
    // (ADR-0022). Ids are renamed per position: the pairs only need to match each other, and a
    // stored id may be another provider's.
    const replay: Message[] =
      calls.length > 0 && replayNatively(calls, request, false)
        ? calls.flatMap((c, i): Message[] => {
            const id = `hist_${String(t)}_${String(i)}`;
            return [
              { role: 'assistant', content: [{ type: 'tool_use', id, name: c.name, input: c.input ?? {} }] },
              { role: 'user', content: [toAnthropicToolResultBlock(id, c.result)] },
            ];
          })
        : [];
    const asText = calls.length > 0 && replay.length === 0 ? calls.map(toolCallAsText).join('\n\n') : '';
    const text = [asText, turn.text.trim() !== '' ? turn.text : ''].filter(Boolean).join('\n\n');
    const blocks = attachmentBlocks(turn.attachments);
    const last: Message | undefined =
      blocks.length > 0 || text
        ? blocks.length === 0
          ? { role: turn.role, content: text }
          : { role: turn.role, content: [...blocks, ...(text ? [{ type: 'text' as const, text }] : [])] }
        : undefined;
    return last ? [...replay, last] : replay;
  });

  // The turn preamble starts the user turn (Stage 6 fallback for the `clear_at` beta, which is not used).
  const preamble: CacheableBlock[] = request.turnPreamble ? [{ type: 'text', text: request.turnPreamble }] : [];
  const currentBlocks = attachmentBlocks(request.attachments);
  if (currentBlocks.length === 0 && preamble.length === 0) {
    messages.push({ role: 'user', content: request.prompt });
  } else {
    messages.push({ role: 'user', content: [...preamble, ...currentBlocks, { type: 'text', text: request.prompt }] });
  }

  // Merge consecutive same-role messages so roles strictly alternate (e.g. after a terminal tool result)
  const normalized: Message[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (!m.content) continue;
    } else if (m.content.length === 0) {
      continue;
    }

    const prev = normalized.at(-1);
    if (prev && prev.role === m.role) {
      const prevBlocks = typeof prev.content === 'string' ? [{ type: 'text' as const, text: prev.content }] : prev.content;
      const curBlocks = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
      prev.content = [...prevBlocks, ...curBlocks];
    } else {
      normalized.push({ role: m.role, content: m.content });
    }
  }

  // The API requires the sequence to start with a user turn.
  while (normalized.length > 0 && normalized[0]!.role !== 'user') normalized.shift();

  if (normalized.length > 1) {
    const cached = normalized[normalized.length - 2]!;
    if (typeof cached.content === 'string') {
      cached.content = [{ type: 'text', text: cached.content, cache_control: { type: 'ephemeral' } }];
    } else if (cached.content.length > 0) {
      cached.content[cached.content.length - 1]!.cache_control = { type: 'ephemeral' };
    }
  }

  return normalized as Anthropic.MessageParam[];
}

/**
 * The `thinking` field for a request (ADR-0080). Thinking on is adaptive with its summary shown;
 * `off` is sent as `{type: "disabled"}` only to a model whose spec allows it, and only at effort
 * `high` or below (Haiku 5.5: "disabled only at high or below"). Any other `off` is refused here,
 * before a request is made: Sonnet 5.5 and Opus 5.5 answer it with a 400.
 */
export function thinkingParam(
  thinking: 'off' | undefined,
  providerModelId: string,
  effort: ReasoningEffort | undefined,
): Anthropic.ThinkingConfigParam {
  if (thinking !== 'off') return { type: 'adaptive', display: 'summarized' };
  const spec = getModelCapability(providerModelId);
  if (spec.thinkingOff !== 'disabled' || effort === 'xhigh' || effort === 'max') {
    throw new ProviderError(`Thinking cannot be turned off for "${providerModelId}" at this effort`, {
      code: 'model_unavailable',
      retryable: false,
    });
  }
  return { type: 'disabled' };
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  private client: AnthropicClient | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly injectedClient?: AnthropicClient,
  ) {}

  supportsGrounding(): boolean {
    return this.cfg.ENABLE_ANTHROPIC_WEB_SEARCH;
  }

  private getClient(): AnthropicClient {
    if (this.injectedClient) return this.injectedClient;
    this.client ??= createAnthropicClient(this.cfg);
    return this.client;
  }

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    const grounded = request.grounded && this.supportsGrounding();
    const toolDefs = request.tools ?? [];
    const useTools = toolDefs.length > 0 && Boolean(request.toolExecutor);

    // In Chat the search tool is only offered (the model decides), so progress is reported for
    // searches that happened, not for the tool being there.
    const searchMode = request.mode !== 'chat';
    if (grounded && searchMode) {
      yield {
        type: 'progress',
        stage: 'searching',
        label: 'Web search tool enabled',
        detail: 'Claude may issue searches; citations come from the results it returns.',
      };
    }

    // Summed over the rounds: each round is its own request, billed on its own.
    let usage: ProviderUsage | null = null;
    let finishReason = 'stop';
    const searchBlocks: SearchResultBlock[] = [];
    let messages = buildAnthropicMessages(request);
    // A grounded turn may need a round to resume a paused server tool (pause_turn), so it gets
    // the same bound as a tool turn; a turn with neither stays single-shot.
    const maxRounds = resolveMaxRounds(this.cfg.TOOL_MAX_ROUNDS, useTools || grounded);

    const tools = [
      ...(grounded ? [WEB_SEARCH_TOOL] : []),
      ...(useTools ? toolDefs.map(toAnthropicTool) : []),
    ];

    const failedToolCalls = new Set<string>();
    // The round in flight, for the usage a failure reports (AL-1) and the AL-5 repair.
    let roundUsage = EMPTY_USAGE;
    let roundOpened = false;
    let roundYielded = false;
    let thinkingRepaired = false;
    // P22: the request in flight, as a partial `call_usage`, for a stop that ends it: the SDK
    // throws on the abort, so the loop's own abort check is not always reached.
    let inFlight: (() => ProviderEvent) | null = null;
    const thinking = thinkingParam(request.thinking, request.providerModelId, request.reasoningEffort);

    try {
      roundLoop: for (let round = 0; round < maxRounds; round += 1) {
        // A round boundary is the one place abort can fire with no request in flight yet (e.g.
        // during tool execution, between this round's response and the next round's request).
        // The SDK's `signal` option only stops a request already underway; without this check,
        // an abort here would still issue one more provider call. See Task 7/8's equivalent gap
        // in the Gemini adapter, caught only by an abort-mid-loop test.
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const systemParam: string | Anthropic.TextBlockParam[] | undefined = (() => {
          // The split is by length, so it holds only when the prefix really is the start of the
          // instruction; a prefix built from another tool list would cut the text in the wrong place.
          if (
            request.promptAssembly &&
            this.cfg.ENABLE_PROMPT_CACHE &&
            request.promptAssembly.fullSystemInstruction.startsWith(request.promptAssembly.stablePrefix.systemText)
          ) {
            const { stablePrefix, fullSystemInstruction } = request.promptAssembly;
            const blocks: Anthropic.TextBlockParam[] = [
              {
                type: 'text',
                text: stablePrefix.systemText,
                cache_control: { type: 'ephemeral' },
              },
            ];
            const dynamicText = fullSystemInstruction.slice(stablePrefix.systemText.length).trim();
            if (dynamicText) {
              blocks.push({ type: 'text', text: dynamicText });
            }
            return blocks;
          }
          return request.systemInstruction || undefined;
        })();

        // The final round must end in an answer. The tools stay declared and tool_choice "none"
        // switches calling off: dropping the tools instead changes the tool-built system prompt
        // under a history full of tool_use blocks, and "none" is accepted on every Claude 5
        // model, including those that reject forced tool use (Define tools, "Forcing tool use").
        const isFinalRound = useTools && isLastRound(round, maxRounds);
        const currentToolDefs = request.tools ?? toolDefs;
        const currentUseTools = currentToolDefs.length > 0 && Boolean(request.toolExecutor);
        const roundTools = [
          ...(grounded ? [WEB_SEARCH_TOOL] : []),
          ...(currentUseTools ? currentToolDefs.map(toAnthropicTool) : []),
        ];
        const effectiveTools = roundTools;
        const toolChoice: Anthropic.ToolChoice | undefined =
          roundTools.length === 0 ? undefined : isFinalRound ? { type: 'none' } : currentUseTools ? { type: 'auto' } : undefined;

        // AL-5: a thinking-signature 400 is repaired once per turn: the round is re-sent with its
        // thinking blocks stripped (Stage 15 EH24). Nothing was shown in the round and no tool ran
        // in it, so the re-send repeats no step.
        let final!: Anthropic.Message;
        // P22: this request's own clocks and id, for its `call_usage` (OD-8, OD-13).
        let roundStartedAt = Date.now();
        let roundFirstAt: number | undefined;
        let roundRef: string | undefined;
        for (;;) {
          roundUsage = EMPTY_USAGE;
          roundOpened = false;
          roundYielded = false;
          roundStartedAt = Date.now();
          roundFirstAt = undefined;
          roundRef = undefined;
          try {
            const stream = this.getClient().messages.stream(
              {
                model: request.providerModelId,
                max_tokens: request.maxOutputTokens,
                // Claude 5 models think adaptively whether or not this is sent, but their summary
                // display defaults to "omitted" (empty text). Summarized, as Claude's app shows it.
                // The blocks go back unchanged in the tool loop below (final.content).
                thinking,
                // Effort is Claude 5's control for how hard it thinks (default medium).
                ...(request.reasoningEffort ? { output_config: { effort: request.reasoningEffort } } : {}),
                messages,
                ...(systemParam !== undefined ? { system: systemParam } : {}),
                ...(effectiveTools.length > 0 ? { tools: effectiveTools } : {}),
                ...(toolChoice ? { tool_choice: toolChoice } : {}),
              },
              { signal: request.signal },
            );

            let lastPartialAt = 0;
            // Stopped mid-request: what the provider had reported so far, labelled partial.
            inFlight = () => callUsageEvent(round, requestUsage(roundUsage), roundUsage.exact ? 'provider_partial' : 'none', 'cancelled', roundRef, roundStartedAt, roundFirstAt);
            for await (const event of stream) {
              roundOpened = true;
              roundFirstAt ??= Date.now();
              if (event.type === 'content_block_delta') roundYielded = true;
              if (request.signal.aborted) {
                usage = addRequestUsage(usage, requestUsage(roundUsage));
                yield inFlight();
                inFlight = null;
                break roundLoop;
              }
              switch (event.type) {
                case 'content_block_delta': {
                  const delta = event.delta;
                  if (delta.type === 'text_delta' && delta.text) {
                    yield { type: 'delta', text: delta.text };
                  } else if (delta.type === 'thinking_delta' && delta.thinking) {
                    yield { type: 'thinking', text: delta.thinking };
                  } else if (delta.type === 'input_json_delta') {
                    // ADR-0037: a visual drawn while written. The SDK's snapshot parses the partial
                    // JSON on each read, so reads are spaced out; only show_widget is shown.
                    const content = stream.currentMessage?.content ?? [];
                    const block = content[event.index];
                    const now = Date.now();
                    if (block?.type === 'tool_use' && block.name === 'show_widget' && now - lastPartialAt >= PARTIAL_INPUT_INTERVAL_MS) {
                      lastPartialAt = now;
                      const input = block.input;
                      if (input && typeof input === 'object') {
                        const index = content.slice(0, event.index).filter((b) => b.type === 'tool_use').length;
                        yield { type: 'tool_input_partial', index, name: block.name, input: input as Record<string, unknown> };
                      }
                    }
                  }
                  break;
                }
                case 'message_start':
                  roundUsage = merge(roundUsage, usageFrom(event.message.usage as AnthropicUsage));
                  if (typeof event.message.id === 'string') roundRef = event.message.id;
                  break;
                case 'message_delta': {
                  roundUsage = merge(roundUsage, usageFrom(event.usage as AnthropicUsage));
                  if (event.delta.stop_reason) finishReason = String(event.delta.stop_reason);
                  break;
                }
                case 'content_block_start':
                  // Search results arrive complete in the block-start event; `content_block_stop`
                  // carries only the index, so this is the streaming-time hook for them.
                  searchBlocks.push(...collectSearchResults(event.content_block));
                  break;
                default:
                  break;
              }
            }

            final = await stream.finalMessage();
            break;
          } catch (err) {
            if (!thinkingRepaired && !roundYielded && !request.signal.aborted && isThinkingSignature400(err) && hasThinking(messages)) {
              thinkingRepaired = true;
              // The refused request was sent: its own row, with no counts (P22 + P11 merge).
              inFlight = null;
              yield callUsageEvent(round, EMPTY_USAGE, 'none', 'error', roundRef, roundStartedAt, roundFirstAt);
              messages = withoutThinking(messages);
              log.warn({ code: 'thinking_signature_repair', round }, 'thinking block refused; round re-sent without thinking blocks');
              continue;
            }
            throw err;
          }
        }
        inFlight = null;
        roundUsage = merge(roundUsage, usageFrom(final.usage as AnthropicUsage));
        usage = addRequestUsage(usage, requestUsage(roundUsage));
        yield callUsageEvent(
          round,
          requestUsage(roundUsage),
          roundUsage.exact ? 'provider' : 'none',
          final.stop_reason ? String(final.stop_reason) : 'unknown',
          typeof final.id === 'string' ? final.id : roundRef,
          roundStartedAt,
          roundFirstAt,
        );
        // The round's usage is in the turn's now (and in its own call row); a later failure does
        // not count it twice.
        roundOpened = false;
        if (final.stop_reason) finishReason = String(final.stop_reason);
        if (final.stop_reason === 'refusal') {
          const details = final.stop_details ?? null;
          yield { type: 'refusal', category: details?.category ?? null, explanation: details?.explanation ?? null };
        }
        for (const block of final.content ?? []) searchBlocks.push(...collectSearchResults(block));

        // A server tool (web search) hit the API's own iteration limit mid-answer. The documented
        // resume is to send the paused assistant turn back as is, with no new user message
        // (Claude docs, Server tools, "pause_turn"). It takes one of this turn's rounds.
        if (final.stop_reason === 'pause_turn') {
          if (isLastRound(round, maxRounds)) {
            // No round left to resume in: the caller offers Continue, as at the tool limit.
            finishReason = 'tool_limit';
            break;
          }
          messages = [...messages, { role: 'assistant', content: final.content }];
          continue;
        }

        const toolUseBlocks = (final.content ?? []).filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        // The final round is reached only while the model is still working, and it was made to
        // answer: the turn used every tool step it may, so the caller offers Continue. A call on
        // that round is not run, as in the Gemini adapter: no round is left to answer after it.
        if (isFinalRound && final.stop_reason !== 'refusal') {
          finishReason = 'tool_limit';
          break;
        }
        if (!useTools || toolUseBlocks.length === 0) break;

        messages = [...messages, { role: 'assistant', content: final.content }];

        // "By default, Claude may call multiple tools in a single response" (Parallel tool use):
        // every call runs, in order, and all results go back in one user message (ADR-0026).
        const resultBlocks: Anthropic.ToolResultBlockParam[] = [];

        for (const primary of toolUseBlocks) {
          // An abort stops the remaining calls; the next round's signal check ends the turn.
          if (request.signal.aborted) break;
          const call = { id: primary.id, name: primary.name, input: primary.input };
          const fingerprint = callFingerprint(call.name, call.input);

          if (failedToolCalls.has(fingerprint)) {
            // Duplicate failed call detected: do not repeat execution, return guard instruction
            const guardResult = duplicateFailedCallResult(call.id, call.name);
            yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
            yield { type: 'tool_result', toolCallId: call.id, name: call.name, result: guardResult };
            resultBlocks.push(toAnthropicToolResultBlock(call.id, guardResult));
          } else {
            yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
            const result = await request.toolExecutor!.execute(call, request.signal);
            if (!result.ok) {
              failedToolCalls.add(fingerprint);
            }
            yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
            resultBlocks.push(toAnthropicToolResultBlock(call.id, result));
          }
        }
        messages = [...messages, { role: 'user', content: resultBlocks }];

        if (hasTerminalToolCall(toolUseBlocks)) {
          finishReason = 'stop';
          break;
        }
      }
    } catch (err) {
      if (request.signal.aborted) {
        if (inFlight) yield inFlight();
        throw err;
      }
      // AL-1: what was reported before the failure (the last cumulative usage); undefined when
      // no response stream had opened in this turn's requests (nothing billed).
      const billed = roundOpened ? addRequestUsage(usage, requestUsage(roundUsage)) : usage;
      const partialUsage = billed ?? undefined;
      // P22 + P11 merge: the failed request's own counts, for its ledger row (the gateway writes it).
      const failedRequestUsage = roundOpened ? requestUsage(roundUsage) : undefined;
      const own = failedRequestUsage !== undefined ? { failedRequestUsage } : {};
      // Not the caller's abort: the SDK's timeout or a dropped connection, both transient
      // (ER-2: "connection/408/409"); the app's retry decides, the SDK's is off.
      if (isAbort(err) || err instanceof APIConnectionError) {
        const timedOut = isAbort(err) || err instanceof APIConnectionTimeoutError;
        throw new ProviderError(`Claude request ${timedOut ? 'timed out' : 'lost its connection'}: ${String(err)}`, {
          kind: timedOut ? 'timeout' : 'transient',
          ...(timedOut ? { code: 'provider_timeout' as const } : {}),
          ...(partialUsage !== undefined ? { partialUsage } : {}),
          ...own,
        });
      }
      // M-24 (Claude): a stream that ended without a message or a stop reason.
      if (!(err instanceof APIError) && /stream ended|without producing a message|no message_stop/i.test(String(err))) {
        throw new ProviderError(`Claude stream ended without a stop reason: ${String(err)}`, {
          kind: 'transient',
          ...(partialUsage !== undefined ? { partialUsage } : {}),
          ...own,
        });
      }
      const classified = classifyAnthropicError(err, request.providerModelId, partialUsage);
      classified.failedRequestUsage = failedRequestUsage;
      throw classified;
    }

    if (grounded && !request.signal.aborted) {
      const sources = sourcesFromAnthropicBlocks(searchBlocks);
      if (sources.length > 0) {
        yield { type: 'sources', sources };
        yield {
          type: 'progress',
          stage: 'synthesizing',
          label: `Cited ${sources.length} source${sources.length === 1 ? '' : 's'}`,
          detail: 'URLs come directly from the web search tool results.',
        };
      } else if (searchMode) {
        yield {
          type: 'progress',
          stage: 'partial',
          label: 'No sources returned',
          detail:
            'The web search tool was available but returned no results for this question.',
        };
      }
    }

    yield { type: 'completed', usage: usage ?? EMPTY_USAGE, finishReason: normalisedFinish(finishReason) };
  }

  /**
   * The Claude API's `count_tokens` on the Sonnet model (Stage 9 TOKENS, ADR-0063). Free and
   * rate-limited separately from messages; no generation.
   */
  async countTokens(text: string, signal: AbortSignal): Promise<{ tokens: number; model: string }> {
    const model = this.cfg.MODEL_SONNET;
    if (!model) throw new ProviderError('MODEL_SONNET is not configured', { code: 'model_unavailable' });
    try {
      const res = await this.getClient().messages.countTokens({ model, messages: [{ role: 'user', content: text }] }, { signal });
      return { tokens: res.input_tokens, model };
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw err;
      throw classifyAnthropicError(err, model);
    }
  }

  /** A helper call with a plain-text answer (ADR-0080). */
  async complete(request: HelperRequest): Promise<HelperResult> {
    return this.helperCall(request, undefined);
  }

  /**
   * A helper call with structured output (Claude `output_config.format`, `json_schema`): the router
   * shadow's classify call (Stage 7 RT-2). `value` is undefined when the text is not JSON.
   */
  async classify(request: HelperRequest & { schema: Record<string, unknown> }): Promise<HelperResult & { value: unknown }> {
    const result = await this.helperCall(request, request.schema);
    let value: unknown;
    try {
      value = JSON.parse(result.text);
    } catch {
      value = undefined;
    }
    return { ...result, value };
  }

  /**
   * One non-streaming request: no tools, no history, no `cache_control` (a helper prompt is far
   * below any cache minimum and is not resent), no sampling parameters (Haiku 5.5 refuses
   * non-default ones), thinking off where the model allows it. Retries: none (the job is skipped).
   */
  private async helperCall(request: HelperRequest, schema: Record<string, unknown> | undefined): Promise<HelperResult> {
    const thinking = thinkingParam(request.thinking, request.providerModelId, request.reasoningEffort);
    const outputConfig: Anthropic.OutputConfig = {
      ...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}),
      ...(schema ? { format: { type: 'json_schema' as const, schema: structuredClone(schema) } } : {}),
    };
    try {
      const message = await this.getClient().messages.create(
        {
          model: request.providerModelId,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.text }],
          thinking,
          ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
        },
        { signal: request.signal },
      );
      const text = (message.content ?? [])
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { text, usage: usageFrom(message.usage as AnthropicUsage), finishReason: String(message.stop_reason ?? 'unknown') };
    } catch (err) {
      if (request.signal.aborted || isAbort(err)) throw err;
      if (err instanceof APIConnectionError) {
        throw new ProviderError(`Claude helper request lost its connection: ${String(err)}`, { retryable: false });
      }
      throw classifyAnthropicError(err, request.providerModelId);
    }
  }

  async probe(providerModelId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.getClient().messages.create(
        {
          model: providerModelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        },
        { signal },
      );
    } catch (err) {
      log.debug({ status: statusOf(err), providerModelId }, 'anthropic probe failed');
      throw classifyAnthropicError(err, providerModelId);
    }
  }
}
