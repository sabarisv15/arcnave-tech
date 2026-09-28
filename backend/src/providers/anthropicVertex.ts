/**
 * Claude on Vertex, via `@anthropic-ai/vertex-sdk`.
 *
 * The SDK handles both Vertex-specific request differences for us: `model` goes in the URL,
 * and `anthropic_version: vertex-2023-10-16` goes in the body. We never hand-roll that call.
 *
 * Region defaults to `global` — the only endpoint type that serves Opus 5 / Sonnet 5, and the
 * only one with no pricing premium. Regional endpoints top out at Sonnet 4.6.
 * See docs/backend-research.md section 2.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { APIConnectionError, APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { sourcesFromAnthropicBlocks } from './grounding.js';
import type {
  FinalRoundReport,
  GenerationRequest,
  Provider,
  ProviderEvent,
  ProviderUsage,
  ToolDefinition,
  ToolResult,
} from './types.js';
import { addRequestUsage, EMPTY_USAGE, isAbort, replayNatively, toolCallAsText, ModelNotFoundError, primaryToolContent, ProviderError, toolImages } from './types.js';
import { finalRoundFinishReason, hasTerminalToolCall, isLastRound, resolveMaxRounds } from './toolLoopPolicy.js';
import { attachmentText, pageLabel, unavailableAttachmentNote } from './attachmentContent.js';

const log = logger.child({ module: 'provider:anthropic' });

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

/** The tool version string is part of the API contract, not a date to be freshened casually. */
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as const;

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
      return a.pages.flatMap((page): CacheableBlock[] => [
        { type: 'text', text: `[${pageLabel(a, page.num)}${a.id ? `, fileId: ${a.id}` : ''}]` },
        ...(page.image?.base64
          ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: page.image.mimeType, data: page.image.base64 } }]
          : page.image
            ? // Claude on Vertex reads base64 only; a URI here is a wiring bug, said, not dropped.
              [{ type: 'text' as const, text: `The image of page ${String(page.num)} could not be sent to this model.` }]
            : []),
        {
          type: 'text',
          text: page.text ? `Text of page ${String(page.num)}:\n${page.text}` : `Page ${String(page.num)} has no text layer; read it from the image.`,
        },
      ]);
    }
    return [attachmentBlock(a)];
  });
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
    if (a.filename) block.title = a.filename;
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
    if (a.filename) block.title = a.filename;
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
 * the newest user turn is never marked, since by definition it is new on every call. Vertex only
 * supports the SDK's default 5-minute cache — the 1-hour variant needs an `anthropic-beta` header
 * Vertex rejects, so none is sent here.
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

  const currentBlocks = attachmentBlocks(request.attachments);
  if (currentBlocks.length === 0) {
    messages.push({ role: 'user', content: request.prompt });
  } else {
    messages.push({ role: 'user', content: [...currentBlocks, { type: 'text', text: request.prompt }] });
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

export class AnthropicVertexProvider implements Provider {
  readonly name = 'anthropic';
  private client: Pick<AnthropicVertex, 'messages'> | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly injectedClient?: Pick<AnthropicVertex, 'messages'>,
  ) {}

  supportsGrounding(): boolean {
    return this.cfg.ENABLE_ANTHROPIC_WEB_SEARCH;
  }

  private getClient(): Pick<AnthropicVertex, 'messages'> {
    if (this.injectedClient) return this.injectedClient;
    if (!this.client) {
      if (!this.cfg.GOOGLE_CLOUD_PROJECT) {
        throw new ProviderError('GOOGLE_CLOUD_PROJECT is not set', { code: 'model_unavailable' });
      }
      this.client = new AnthropicVertex({
        projectId: this.cfg.GOOGLE_CLOUD_PROJECT,
        region: this.cfg.VERTEX_LOCATION,
        timeout: this.cfg.PROVIDER_TIMEOUT_MS,
        // Retries are handled by our own policy so backoff and usage accounting stay in one
        // place; the SDK's internal retry would hide attempts from both.
        maxRetries: 0,
      });
    }
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
    let finalRound: FinalRoundReport | undefined;
    const searchBlocks: SearchResultBlock[] = [];
    let messages = buildAnthropicMessages(request);
    const maxRounds = resolveMaxRounds(this.cfg.TOOL_MAX_ROUNDS, useTools);

    const tools = [
      ...(grounded ? [WEB_SEARCH_TOOL] : []),
      ...(useTools ? toolDefs.map(toAnthropicTool) : []),
    ];

    const failedToolCalls = new Set<string>();

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

        // If on the final round, disable tools so the model is forced to synthesize text
        const isFinalRound = isLastRound(round, maxRounds);
        const currentToolDefs = request.tools ?? toolDefs;
        const currentUseTools = currentToolDefs.length > 0 && Boolean(request.toolExecutor);
        const roundTools = [
          ...(grounded ? [WEB_SEARCH_TOOL] : []),
          ...(currentUseTools ? currentToolDefs.map(toAnthropicTool) : []),
        ];
        const effectiveTools = isFinalRound ? [] : roundTools;
        const effectiveUseTools = isFinalRound ? false : currentUseTools;

        const stream = this.getClient().messages.stream(
          {
            model: request.providerModelId,
            max_tokens: request.maxOutputTokens,
            // Claude 5 models think adaptively whether or not this is sent, but their summary
            // display defaults to "omitted" (empty text). Summarized, as Claude's app shows it.
            // The blocks go back unchanged in the tool loop below (final.content).
            thinking: { type: 'adaptive', display: 'summarized' },
            // Effort is Claude 5's control for how hard it thinks (default medium).
            ...(request.reasoningEffort ? { output_config: { effort: request.reasoningEffort } } : {}),
            messages,
            ...(systemParam !== undefined ? { system: systemParam } : {}),
            ...(effectiveTools.length > 0 ? { tools: effectiveTools } : {}),
            ...(effectiveUseTools ? { tool_choice: { type: 'auto' } } : {}),
          },
          { signal: request.signal },
        );

        let roundUsage = EMPTY_USAGE;
        let lastPartialAt = 0;
        for await (const event of stream) {
          if (request.signal.aborted) {
            usage = addRequestUsage(usage, requestUsage(roundUsage));
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

        const final = await stream.finalMessage();
        roundUsage = merge(roundUsage, usageFrom(final.usage as AnthropicUsage));
        usage = addRequestUsage(usage, requestUsage(roundUsage));
        if (final.stop_reason) finishReason = String(final.stop_reason);
        if (final.stop_reason === 'refusal') {
          const details = final.stop_details ?? null;
          yield { type: 'refusal', category: details?.category ?? null, explanation: details?.explanation ?? null };
        }
        for (const block of final.content ?? []) searchBlocks.push(...collectSearchResults(block));

        const toolUseBlocks = (final.content ?? []).filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        // The last allowed round went out without tools: the turn used its tool budget whether or
        // not this round answered (ADR-0051).
        if (isFinalRound && useTools && round > 0) {
          finalRound = {
            functionCallingOff: true,
            callsNotRun: toolUseBlocks.map((b) => b.name),
            textCharacters: (final.content ?? []).reduce((n, b) => n + (b.type === 'text' ? b.text.length : 0), 0),
            providerFinishReason: finishReason,
          };
          finishReason = finalRoundFinishReason(finishReason);
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
          const callFingerprint = `${call.name}:${JSON.stringify(call.input)}`;
          
          if (failedToolCalls.has(callFingerprint)) {
            // Duplicate failed call detected: do not repeat execution, return guard instruction
            const guardResult: ToolResult = {
              toolCallId: call.id,
              ok: false,
              content: [
                {
                  type: 'text',
                  text: `This tool (${call.name}) previously failed with these exact inputs. Do not retry it. Deliver your synthesized answer directly in text to the user.`,
                },
              ],
            };
            yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
            yield { type: 'tool_result', toolCallId: call.id, name: call.name, result: guardResult };
            resultBlocks.push(toAnthropicToolResultBlock(call.id, guardResult));
          } else {
            yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
            const result = await request.toolExecutor!.execute(call, request.signal);
            if (!result.ok) {
              failedToolCalls.add(callFingerprint);
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
      if (request.signal.aborted) throw err;
      // Not the caller's abort: the SDK's timeout or a dropped connection, both of which Claude's
      // SDK retries by default ("Connection errors ... are all retried").
      if (isAbort(err) || err instanceof APIConnectionError) {
        const timedOut = isAbort(err) || err instanceof APIConnectionTimeoutError;
        throw new ProviderError(`Claude request ${timedOut ? 'timed out' : 'lost its connection'}: ${String(err)}`, {
          retryable: true,
          ...(timedOut ? { code: 'provider_timeout' as const } : {}),
        });
      }
      const status = statusOf(err);
      if (status === 404) {
        throw new ModelNotFoundError(request.providerModelId, this.cfg.VERTEX_LOCATION);
      }
      throw new ProviderError(`Claude request failed: ${String(err)}`, {
        retryable: status !== undefined && RETRYABLE_STATUS.has(status),
        ...(status !== undefined ? { statusCode: status } : {}),
      });
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

    yield { type: 'completed', usage: usage ?? EMPTY_USAGE, finishReason, ...(finalRound ? { finalRound } : {}) };
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
      log.debug({ err, providerModelId }, 'anthropic probe failed');
      const status = statusOf(err);
      if (status === 404) throw new ModelNotFoundError(providerModelId, this.cfg.VERTEX_LOCATION);
      throw new ProviderError(String(err), {
        retryable: status !== undefined && RETRYABLE_STATUS.has(status),
        ...(status !== undefined ? { statusCode: status } : {}),
      });
    }
  }
}
