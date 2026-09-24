/**
 * Gemini on Vertex, via the Google Gen AI SDK (`@google/genai`).
 *
 * Deliberately not the legacy Vertex generative modules: those were removed on 2026-06-24.
 * See docs/backend-research.md section 1.
 */
import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import type { Content, FunctionDeclaration, Part, Blob as GeminiBlob } from '@google/genai';

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
  ToolDefinition,
  ToolResult,
} from './types.js';
import { EMPTY_USAGE, isAbort, ModelNotFoundError, ProviderError } from './types.js';
import { deferredCallResult, isLastRound, resolveMaxRounds } from './toolLoopPolicy.js';
import { attachmentText, unavailableAttachmentNote } from './attachmentContent.js';

/** Appended to the tool results before the final round, whose calls are disabled. */
const FINAL_ROUND_NOTE =
  'This turn has no tool steps left. Answer the user now from the tool results above; do not call a tool. ' +
  'If something could not be finished, say what and why.';

const log = logger.child({ module: 'provider:gemini' });

function attachmentParts(attachments: GenerationRequest['attachments']): Part[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((a): Part => {
    // 1. Binary / media (PDF, image, audio, video) with base64
    if (
      a.base64 &&
      (a.mimeType === 'application/pdf' ||
        a.mimeType.startsWith('image/') ||
        a.mimeType.startsWith('audio/') ||
        a.mimeType.startsWith('video/'))
    ) {
      return {
        inlineData: { mimeType: a.mimeType, data: a.base64 } satisfies GeminiBlob,
      };
    }

    // 2. Genuine text: extracted Office/PDF text, or a textual file's own bytes.
    const text = attachmentText(a);
    if (text !== null) {
      const nameAttr = a.filename ? ` filename="${a.filename}"` : '';
      return { text: `<document${nameAttr}>\n${text}\n</document>` };
    }

    // 3. Nothing sendable: say so. No raw bytes under an unsupported MIME type (G15, G17).
    return { text: unavailableAttachmentNote(a) };
  });
}

/**
 * `parametersJsonSchema` (not `parameters`) deliberately — the typed `parameters: Schema` field
 * is what `@google/genai` rewrites in place (uppercasing every `type` value), and doing that to
 * a `ToolDefinition` shared with the Anthropic adapter would corrupt whichever adapter runs
 * second. `parametersJsonSchema` accepts plain JSON Schema and is documented as mutually
 * exclusive with `parameters`, so this sidesteps the mutation risk instead of cloning around it.
 */
export function toGeminiFunctionDeclaration(def: ToolDefinition): FunctionDeclaration {
  return {
    name: def.name,
    description: def.description,
    parametersJsonSchema: structuredClone(def.inputSchema),
  };
}

/**
 * Flattens a provider-neutral `ToolResult` into Gemini's `functionResponse` shape. A `json`
 * content block goes straight into `response.output`/`response.error`; a `text` block is passed
 * through as a string in the same slot — Gemini does not require the response value to be an
 * object shape beyond `Record<string, unknown>`'s outer wrapper.
 */
export function toGeminiFunctionResponsePart(name: string, id: string, result: ToolResult): Part {
  const block = result.content[0];
  const value = block === undefined ? '' : block.type === 'json' ? block.data : block.text;
  return {
    functionResponse: {
      id,
      name,
      response: result.ok ? { output: value } : { error: value },
    },
  };
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
  private client: Pick<GoogleGenAI, 'models'> | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly injectedClient?: Pick<GoogleGenAI, 'models'>,
  ) {}

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
  private getClient(): Pick<GoogleGenAI, 'models'> {
    if (this.injectedClient) return this.injectedClient;
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
    const toolDefs = request.tools ?? [];
    const useTools = toolDefs.length > 0 && Boolean(request.toolExecutor);

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
    let contents = buildGeminiContents(request);
    const maxRounds = resolveMaxRounds(this.cfg.TOOL_MAX_ROUNDS, useTools);

    try {
      roundLoop: for (let round = 0; round < maxRounds; round += 1) {
        // A round boundary is the one place abort can fire with no request in flight yet (e.g.
        // during tool execution, between this round's response and the next round's request).
        // The SDK's `abortSignal` config only stops a request already underway; without this
        // check, an abort here would still issue one more provider call.
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        // The last round must end in an answer, as the Claude adapter's does: calls are refused
        // (declarations stay, so earlier functionCall turns remain valid) and the model is told
        // to answer from the results it has. Without this, a model still calling tools used
        // every round and the turn ended with no text (live, Phase 3).
        const finalToolRound = useTools && isLastRound(round, maxRounds);
        if (finalToolRound && round > 0) {
          const last = contents.at(-1);
          if (last?.role === 'user') {
            contents = [
              ...contents.slice(0, -1),
              { ...last, parts: [...(last.parts ?? []), { text: FINAL_ROUND_NOTE }] },
            ];
          }
        }
        const stream = await this.getClient().models.generateContentStream({
          model: request.providerModelId,
          contents,
          config: {
            ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
            maxOutputTokens: request.maxOutputTokens,
            ...(grounded || codeExecution || useTools
              ? {
                  tools: [
                    ...(grounded ? [{ googleSearch: {} }] : []),
                    ...(codeExecution ? [{ codeExecution: {} }] : []),
                    ...(useTools
                      ? [{ functionDeclarations: toolDefs.map(toGeminiFunctionDeclaration) }]
                      : []),
                  ],
                }
              : {}),
            ...(finalToolRound ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } } : {}),
            // The SDK aborts the underlying HTTP request on this signal, which is what makes
            // client cancellation actually stop provider work rather than just stop reading it.
            abortSignal: request.signal,
            httpOptions: { timeout: this.cfg.PROVIDER_TIMEOUT_MS },
          },
        });

        let roundText = '';
        const roundCalls: {
          id?: string;
          name: string;
          args: Record<string, unknown>;
          thoughtSignature?: string;
        }[] = [];

        for await (const chunk of stream) {
          if (request.signal.aborted) break roundLoop;

          const text = chunk.text;
          if (text) {
            accumulated.push(text);
            roundText += text;
            yield { type: 'delta', text };
          }

          if (codeExecution && (chunk.executableCode || chunk.codeExecutionResult)) {
            yield {
              type: 'code',
              ...(chunk.executableCode ? { code: chunk.executableCode } : {}),
              ...(chunk.codeExecutionResult ? { output: chunk.codeExecutionResult } : {}),
            };
          }

          // `thoughtSignature` lives on the `Part` that carries the `functionCall`, not on the
          // `FunctionCall` object itself — `chunk.functionCalls` is a flattening getter that
          // drops it. Gemini requires the signature to be echoed back unchanged on the
          // continuation turn's functionCall part or it 400s ("Function call is missing a
          // thought_signature"); read it from the underlying parts, in the same order
          // `functionCalls` derives them, so it survives into the next round's request.
          const functionCallParts =
            chunk.candidates?.[0]?.content?.parts?.filter((p) => p.functionCall) ?? [];
          (chunk.functionCalls ?? []).forEach((fc, i) => {
            if (fc.name) {
              roundCalls.push({
                ...(fc.id ? { id: fc.id } : {}),
                name: fc.name,
                args: fc.args ?? {},
                ...(functionCallParts[i]?.thoughtSignature
                  ? { thoughtSignature: functionCallParts[i]!.thoughtSignature }
                  : {}),
              });
            }
          });

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

        if (!useTools || roundCalls.length === 0) break;
        // A call on the final round is not run: there is no round left to answer after it.
        if (finalToolRound) {
          finishReason = 'tool_limit';
          break;
        }

        const modelParts: Part[] = [];
        if (roundText) modelParts.push({ text: roundText });
        for (const c of roundCalls) {
          modelParts.push({
            functionCall: { ...(c.id ? { id: c.id } : {}), name: c.name, args: c.args },
            ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
          });
        }
        contents = [...contents, { role: 'model', parts: modelParts }];

        // Phase 1 executes exactly one ArcNave tool per round, matching Anthropic's
        // disable_parallel_tool_use semantics. If Gemini returns more than one functionCall in
        // a single response, only the first is run; the rest get an explicit deferred failure
        // so the conversation is never left with an orphaned call — the model can re-request an
        // extra call on a later round instead.
        const [primary, ...deferred] = roundCalls;
        const responseParts: Part[] = [];

        if (primary) {
          const call = {
            id: primary.id ?? `${primary.name}-${String(round)}-0`,
            name: primary.name,
            input: primary.args,
          };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          responseParts.push(toGeminiFunctionResponsePart(call.name, call.id, result));
        }
        for (const [i, extra] of deferred.entries()) {
          const id = extra.id ?? `${extra.name}-${String(round)}-${String(i + 1)}`;
          responseParts.push(toGeminiFunctionResponsePart(extra.name, id, deferredCallResult(id)));
        }
        contents = [...contents, { role: 'user', parts: responseParts }];

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
