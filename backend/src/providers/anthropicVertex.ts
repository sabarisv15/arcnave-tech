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
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { sourcesFromAnthropicBlocks } from './grounding.js';
import type {
  GenerationRequest,
  Provider,
  ProviderEvent,
  ProviderUsage,
  ToolDefinition,
  ToolResult,
} from './types.js';
import { EMPTY_USAGE, isAbort, ModelNotFoundError, ProviderError } from './types.js';

const log = logger.child({ module: 'provider:anthropic' });

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

/** The tool version string is part of the API contract, not a date to be freshened casually. */
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as const;

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
  const block = result.content[0];
  const content = block === undefined ? '' : block.type === 'json' ? JSON.stringify(block.data) : block.text;
  return { type: 'tool_result', tool_use_id: toolUseId, content, is_error: !result.ok };
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
 * Anthropic splits usage across `message_start` and `message_delta`.
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

type CacheableBlock = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam | Anthropic.TextBlockParam;

function attachmentBlocks(attachments: GenerationRequest['attachments']): CacheableBlock[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((a): CacheableBlock =>
    a.mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: a.mimeType as Anthropic.Base64ImageSource['media_type'],
            data: a.base64,
          },
        },
  );
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
    (turn) => turn.text.trim() !== '' || (turn.attachments?.length ?? 0) > 0,
  );

  const messages: { role: 'user' | 'assistant'; content: string | CacheableBlock[] }[] = turns.map(
    (turn) => {
      const blocks = attachmentBlocks(turn.attachments);
      if (blocks.length === 0) return { role: turn.role, content: turn.text };
      const content: CacheableBlock[] = [...blocks];
      if (turn.text.trim() !== '') content.push({ type: 'text', text: turn.text });
      return { role: turn.role, content };
    },
  );

  // The API requires the sequence to start with a user turn.
  while (messages.length > 0 && messages[0]!.role !== 'user') messages.shift();

  const currentBlocks = attachmentBlocks(request.attachments);
  if (currentBlocks.length === 0) {
    messages.push({ role: 'user', content: request.prompt });
  } else {
    messages.push({ role: 'user', content: [...currentBlocks, { type: 'text', text: request.prompt }] });
  }

  if (messages.length > 1) {
    const cached = messages[messages.length - 2]!;
    if (typeof cached.content === 'string') {
      cached.content = [{ type: 'text', text: cached.content, cache_control: { type: 'ephemeral' } }];
    } else if (cached.content.length > 0) {
      cached.content[cached.content.length - 1]!.cache_control = { type: 'ephemeral' };
    }
  }

  return messages as Anthropic.MessageParam[];
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

    if (grounded) {
      yield {
        type: 'progress',
        stage: 'searching',
        label: 'Web search tool enabled',
        detail: 'Claude may issue searches; citations come from the results it returns.',
      };
    }

    let usage = EMPTY_USAGE;
    let finishReason = 'stop';
    const searchBlocks: SearchResultBlock[] = [];
    let messages = buildAnthropicMessages(request);
    const maxRounds = useTools ? Math.max(1, this.cfg.TOOL_MAX_ROUNDS) : 1;

    const tools = [
      ...(grounded ? [WEB_SEARCH_TOOL] : []),
      ...(useTools ? toolDefs.map(toAnthropicTool) : []),
    ];

    try {
      roundLoop: for (let round = 0; round < maxRounds; round += 1) {
        // A round boundary is the one place abort can fire with no request in flight yet (e.g.
        // during tool execution, between this round's response and the next round's request).
        // The SDK's `signal` option only stops a request already underway; without this check,
        // an abort here would still issue one more provider call. See Task 7/8's equivalent gap
        // in the Gemini adapter, caught only by an abort-mid-loop test.
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const stream = this.getClient().messages.stream(
          {
            model: request.providerModelId,
            max_tokens: request.maxOutputTokens,
            messages,
            ...(request.systemInstruction ? { system: request.systemInstruction } : {}),
            ...(tools.length > 0 ? { tools } : {}),
            ...(useTools ? { tool_choice: { type: 'auto', disable_parallel_tool_use: true } } : {}),
          },
          { signal: request.signal },
        );

        for await (const event of stream) {
          if (request.signal.aborted) break roundLoop;
          switch (event.type) {
            case 'content_block_delta': {
              const delta = event.delta;
              if (delta.type === 'text_delta' && delta.text) {
                yield { type: 'delta', text: delta.text };
              }
              break;
            }
            case 'message_start':
              usage = merge(usage, usageFrom(event.message.usage as AnthropicUsage));
              break;
            case 'message_delta': {
              usage = merge(usage, usageFrom(event.usage as AnthropicUsage));
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
        usage = merge(usage, usageFrom(final.usage as AnthropicUsage));
        if (final.stop_reason) finishReason = String(final.stop_reason);
        for (const block of final.content ?? []) searchBlocks.push(...collectSearchResults(block));

        const toolUseBlocks = (final.content ?? []).filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (!useTools || toolUseBlocks.length === 0) break;

        messages = [...messages, { role: 'assistant', content: final.content }];

        // disable_parallel_tool_use should make this length 1, but the request is honest about
        // what the SDK actually returned rather than assuming: only the first is executed,
        // matching Gemini's Task 7 policy exactly.
        const [primary, ...rest] = toolUseBlocks;
        const resultBlocks: Anthropic.ToolResultBlockParam[] = [];

        if (primary) {
          const call = { id: primary.id, name: primary.name, input: primary.input };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          resultBlocks.push(toAnthropicToolResultBlock(call.id, result));
        }
        for (const extra of rest) {
          resultBlocks.push(
            toAnthropicToolResultBlock(extra.id, {
              toolCallId: extra.id,
              ok: false,
              content: [
                {
                  type: 'text',
                  text: 'Only one tool call is processed per round in this phase; call again ' +
                    'on the next round if this is still needed.',
                },
              ],
            }),
          );
        }
        messages = [...messages, { role: 'user', content: resultBlocks }];

        if (round === maxRounds - 1) finishReason = 'tool_limit';
      }
    } catch (err) {
      if (isAbort(err) || request.signal.aborted) throw err;
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
      } else {
        yield {
          type: 'progress',
          stage: 'partial',
          label: 'No sources returned',
          detail:
            'The web search tool was available but returned no results for this question.',
        };
      }
    }

    yield { type: 'completed', usage, finishReason };
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
