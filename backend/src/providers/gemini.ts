/**
 * Gemini on Vertex, via the Google Gen AI SDK (`@google/genai`).
 *
 * Deliberately not the legacy Vertex generative modules: those were removed on 2026-06-24.
 * See docs/backend-research.md section 1.
 */
import { GoogleGenAI } from '@google/genai';
import type { Content, Part, Blob as GeminiBlob } from '@google/genai';

import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { GeminiGroundingMetadata } from './grounding.js';
import { sourcesFromGeminiMetadata } from './grounding.js';
import type {
  AttachmentBlock,
  GenerationRequest,
  Provider,
  ProviderEvent,
  ProviderUsage,
} from './types.js';
import { EMPTY_USAGE, isAbort, ModelNotFoundError, ProviderError } from './types.js';

const log = logger.child({ module: 'provider:gemini' });

function attachmentParts(attachments: GenerationRequest['attachments']): Part[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((a): Part => ({
    inlineData: { mimeType: a.mimeType, data: a.base64 } satisfies GeminiBlob,
  }));
}

/**
 * Build the Gemini contents array for one request.
 *
 * No cache marker is set here, unlike the Anthropic adapter — Vertex's implicit caching for
 * Gemini 2.5+/3.x models is automatic on a repeated prefix, with no request changes needed. The
 * only thing this function has to get right for that to work is stability: the same history in
 * the same order, byte-identical, every call for the same chat.
 */
export function buildGeminiContents(request: GenerationRequest): Content[] {
  const turns = request.history.filter(
    (turn) => turn.text.trim() !== '' || (turn.attachments?.length ?? 0) > 0,
  );

  const historyContents: Content[] = turns.map((turn) => {
    const parts: Part[] = [...attachmentParts(turn.attachments)];
    if (turn.text.trim() !== '') parts.push({ text: turn.text });
    return { role: turn.role === 'user' ? 'user' : 'model', parts };
  });

  const currentParts: Part[] = [...attachmentParts(request.attachments), { text: request.prompt }];
  return [...historyContents, { role: 'user', parts: currentParts }];
}

function isNotFound(err: unknown): boolean {
  const text = String(err).toLowerCase();
  return text.includes('not found') && (text.includes('publisher model') || text.includes('404'));
}

function isRetryable(err: unknown): boolean {
  const text = String(err).toLowerCase();
  return ['429', 'resource_exhausted', 'unavailable', '503', '500', 'deadline'].some((m) =>
    text.includes(m),
  );
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
}

/** Read exact counts from `usageMetadata`. Absent metadata yields exact:false, not a guess. */
function usageFrom(meta: GeminiUsageMetadata | undefined): ProviderUsage {
  if (!meta) return EMPTY_USAGE;
  const { promptTokenCount, candidatesTokenCount, cachedContentTokenCount } = meta;
  if (promptTokenCount == null && candidatesTokenCount == null) return EMPTY_USAGE;
  return {
    inputTokens: promptTokenCount ?? 0,
    outputTokens: candidatesTokenCount ?? 0,
    cacheReadTokens: cachedContentTokenCount ?? 0,
    // Gemini reports cached-content reads but not a separate cache-write count.
    cacheWriteTokens: 0,
    exact: true,
  };
}

export class GeminiProvider implements Provider {
  readonly name = 'google';
  private client: GoogleGenAI | undefined;

  constructor(private readonly cfg: Config) {}

  supportsGrounding(): boolean {
    return this.cfg.ENABLE_GOOGLE_SEARCH_GROUNDING;
  }

  supportsCodeExecution(): boolean {
    return this.cfg.ENABLE_GEMINI_CODE_EXECUTION;
  }

  /**
   * A single, non-streaming call used for OCR (scanned PDF pages rendered as images) and
   * audio/video transcription during project-file indexing — not the chat streaming path.
   */
  async describeMedia(
    parts: AttachmentBlock[],
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (!this.cfg.MODEL_GEMINI_FLASH) {
      throw new ProviderError('MODEL_GEMINI_FLASH is not configured', {
        code: 'model_unavailable',
      });
    }
    try {
      const response = await this.getClient().models.generateContent({
        model: this.cfg.MODEL_GEMINI_FLASH,
        contents: [
          {
            role: 'user',
            parts: [
              ...parts.map((p) => ({ inlineData: { mimeType: p.mimeType, data: p.base64 } })),
              { text: prompt },
            ],
          },
        ],
        config: {
          abortSignal: signal,
          httpOptions: { timeout: this.cfg.PROVIDER_TIMEOUT_MS },
        },
      });
      return response.text ?? '';
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw err;
      if (isNotFound(err)) {
        throw new ModelNotFoundError(this.cfg.MODEL_GEMINI_FLASH, this.cfg.geminiLocation);
      }
      throw new ProviderError(`Gemini media description failed: ${String(err)}`, {
        retryable: isRetryable(err),
      });
    }
  }

  /** Lazy: the app must boot without credentials so unconfigured aliases report cleanly. */
  private getClient(): GoogleGenAI {
    if (!this.client) {
      if (!this.cfg.GOOGLE_CLOUD_PROJECT) {
        throw new ProviderError('GOOGLE_CLOUD_PROJECT is not set', { code: 'model_unavailable' });
      }
      this.client = new GoogleGenAI({
        vertexai: true,
        project: this.cfg.GOOGLE_CLOUD_PROJECT,
        location: this.cfg.geminiLocation,
      });
    }
    return this.client;
  }

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    const grounded = request.grounded && this.supportsGrounding();
    const codeExecution = request.codeExecution && this.supportsCodeExecution();

    if (grounded) {
      yield {
        type: 'progress',
        stage: 'searching',
        label: 'Querying Google Search',
        detail: 'Grounding is enabled; the model is issuing search queries.',
      };
    }

    let usage = EMPTY_USAGE;
    let finishReason = 'stop';
    let lastMetadata: GeminiGroundingMetadata | undefined;
    const accumulated: string[] = [];

    try {
      const stream = await this.getClient().models.generateContentStream({
        model: request.providerModelId,
        contents: buildGeminiContents(request),
        config: {
          ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
          maxOutputTokens: request.maxOutputTokens,
          ...(grounded || codeExecution
            ? {
                tools: [
                  ...(grounded ? [{ googleSearch: {} }] : []),
                  ...(codeExecution ? [{ codeExecution: {} }] : []),
                ],
              }
            : {}),
          // The SDK aborts the underlying HTTP request on this signal, which is what makes
          // client cancellation actually stop provider work rather than just stop reading it.
          abortSignal: request.signal,
          httpOptions: { timeout: this.cfg.PROVIDER_TIMEOUT_MS },
        },
      });

      for await (const chunk of stream) {
        if (request.signal.aborted) break;

        const text = chunk.text;
        if (text) {
          accumulated.push(text);
          yield { type: 'delta', text };
        }

        if (codeExecution && (chunk.executableCode || chunk.codeExecutionResult)) {
          yield {
            type: 'code',
            ...(chunk.executableCode ? { code: chunk.executableCode } : {}),
            ...(chunk.codeExecutionResult ? { output: chunk.codeExecutionResult } : {}),
          };
        }

        const chunkUsage = usageFrom(chunk.usageMetadata);
        // Gemini reports cumulative usage; the last non-empty value is the running total.
        if (chunkUsage.exact) usage = chunkUsage;

        for (const candidate of chunk.candidates ?? []) {
          if (candidate.groundingMetadata) {
            lastMetadata = candidate.groundingMetadata as GeminiGroundingMetadata;
          }
          if (candidate.finishReason) finishReason = String(candidate.finishReason);
        }
      }
    } catch (err) {
      if (isAbort(err) || request.signal.aborted) throw err;
      if (isNotFound(err)) {
        throw new ModelNotFoundError(request.providerModelId, this.cfg.geminiLocation);
      }
      throw new ProviderError(`Gemini request failed: ${String(err)}`, {
        retryable: isRetryable(err),
      });
    }

    if (grounded && !request.signal.aborted) {
      const { sources, queries, searchEntryPoint } = await sourcesFromGeminiMetadata(
        lastMetadata,
        accumulated.join(''),
        this.cfg.GROUNDING_REDIRECT_TIMEOUT_MS,
      );

      if (queries.length > 0) {
        yield {
          type: 'progress',
          stage: 'reading',
          label: `Ran ${queries.length} search ${queries.length === 1 ? 'query' : 'queries'}`,
          detail: queries.slice(0, 5).join('; '),
        };
      }

      if (sources.length > 0) {
        yield {
          type: 'sources',
          sources,
          ...(searchEntryPoint ? { searchEntryPoint } : {}),
        };
        const unresolved = sources.filter((s) => !s.urlResolved).length;
        yield {
          type: 'progress',
          stage: 'synthesizing',
          label: `Grounded in ${sources.length} source${sources.length === 1 ? '' : 's'}`,
          detail: unresolved
            ? `${unresolved} source URL(s) could not be resolved past the Vertex redirect.`
            : 'All source URLs resolved to their original pages.',
        };
      } else {
        yield {
          type: 'progress',
          stage: 'partial',
          label: 'No sources returned',
          detail: 'Grounding was enabled but the model returned no grounding metadata.',
        };
      }
    }

    yield { type: 'completed', usage, finishReason };
  }

  async probe(providerModelId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.getClient().models.generateContent({
        model: providerModelId,
        contents: 'ping',
        config: {
          maxOutputTokens: 1,
          abortSignal: signal,
          httpOptions: { timeout: this.cfg.PROVIDER_CONNECT_TIMEOUT_MS * 3 },
        },
      });
    } catch (err) {
      log.debug({ err, providerModelId }, 'gemini probe failed');
      if (isNotFound(err)) throw new ModelNotFoundError(providerModelId, this.cfg.geminiLocation);
      throw new ProviderError(String(err), { retryable: isRetryable(err) });
    }
  }
}
