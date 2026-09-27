/**
 * Gemini on Vertex, via the Google Gen AI SDK (`@google/genai`).
 *
 * Deliberately not the legacy Vertex generative modules: those were removed on 2026-06-24.
 * See docs/backend-research.md section 1.
 */
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Content, FunctionDeclaration, Part, Blob as GeminiBlob } from '@google/genai';

import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { GeminiGroundingMetadata } from './grounding.js';
import { sourcesFromGeminiMetadata } from './grounding.js';
import type {
  ReasoningEffort,
  AttachmentBlock,
  GenerationRequest,
  HistoryToolCall,
  Provider,
  ProviderEvent,
  ProviderUsage,
  ToolDefinition,
  ToolResult,
} from './types.js';
import { addRequestUsage, EMPTY_USAGE, isAbort, ModelNotFoundError, primaryToolContent, ProviderError, replayNatively, toolCallAsText, toolImages } from './types.js';
import { hasTerminalToolCall, isLastRound, resolveMaxRounds } from './toolLoopPolicy.js';
import { attachmentText, pageLabel, unavailableAttachmentNote } from './attachmentContent.js';
import { CLEARED_TOOL_RESULT, resultsToClear, type ContextEditingPolicy } from './contextEditing.js';

/** Added to the system instruction on the final round, whose function calling is off. */
const FINAL_ROUND_NOTE =
  'This turn has no tool steps left. Answer the user now from the tool results above; do not call a tool. ' +
  'If something could not be finished, say what and why.';

const log = logger.child({ module: 'provider:gemini' });

function attachmentParts(attachments: GenerationRequest['attachments']): Part[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.flatMap((a): Part[] => {
    // 0. A PDF as its pages: each page's image, then its text (ADR-0013). Never the PDF itself.
    if (a.pages) {
      return a.pages.flatMap((page): Part[] => [
        { text: `[${pageLabel(a, page.num)}${a.id ? `, fileId: ${a.id}` : ''}]` },
        ...(page.image?.fileUri
          ? [{ fileData: { mimeType: page.image.mimeType, fileUri: page.image.fileUri } }]
          : page.image?.base64
            ? [{ inlineData: { mimeType: page.image.mimeType, data: page.image.base64 } satisfies GeminiBlob }]
            : []),
        { text: page.text ? `Text of page ${String(page.num)}:\n${page.text}` : `Page ${String(page.num)} has no text layer; read it from the image.` },
      ]);
    }
    return [attachmentPart(a)];
  });
}

function attachmentPart(a: NonNullable<GenerationRequest['attachments']>[number]): Part {
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
/**
 * `contents` with the oldest function results cleared (providers/contextEditing.ts). The call
 * parts and their thought signatures are untouched; only the result is replaced.
 */
export function clearOldFunctionResponses(contents: Content[], policy: ContextEditingPolicy): Content[] {
  const clearable = (p: Part) => Boolean(p.functionResponse) && !policy.excludeTools.includes(p.functionResponse!.name ?? '');
  const total = contents.reduce((n, c) => n + (c.parts ?? []).filter(clearable).length, 0);
  let remaining = resultsToClear(total, policy);
  if (remaining === 0) return contents;
  return contents.map((c) => {
    if (remaining === 0 || !(c.parts ?? []).some(clearable)) return c;
    return {
      ...c,
      parts: (c.parts ?? []).map((p) => {
        if (remaining === 0 || !clearable(p)) return p;
        remaining -= 1;
        const { id, name } = p.functionResponse!;
        return { functionResponse: { ...(id ? { id } : {}), name, response: { output: CLEARED_TOOL_RESULT } } };
      }),
    };
  });
}

export function toGeminiFunctionResponsePart(name: string, id: string, result: ToolResult): Part {
  const block = primaryToolContent(result);
  const value = block === undefined ? '' : block.type === 'json' ? block.data : block.text;
  const images = toolImages(result);
  return {
    functionResponse: {
      id,
      name,
      response: result.ok ? { output: value } : { error: value },
      // Gemini 3 multimodal function response: the images sit inside the functionResponse part,
      // never as separate parts of the turn (a stray part there is what made Vertex reject the
      // request in PR #11).
      ...(images.length > 0
        ? { parts: images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })) }
        : {}),
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
/** The loop names a call `${name}-${round}-${i}` when Gemini gave it no id; it never sent that id
 *  on the functionCall, so a replay does not either. */
function isSynthesisedId(call: HistoryToolCall): boolean {
  return new RegExp(`^${call.name}-\\d+-\\d+$`).test(call.id);
}

/**
 * The model responses a turn's stored calls came from. Gemini signs only the first functionCall
 * of a response that makes several (thought signatures, "parallel function calls"), so a signed
 * call starts a response and the unsigned calls after it belong to it. `replayNatively` has
 * already required the first call to be signed.
 */
export function responseGroups(calls: HistoryToolCall[]): HistoryToolCall[][] {
  const groups: HistoryToolCall[][] = [];
  for (const c of calls) {
    if (c.thoughtSignature || groups.length === 0) groups.push([c]);
    else groups.at(-1)!.push(c);
  }
  return groups;
}

export function buildGeminiContents(request: GenerationRequest): Content[] {
  const turns = request.history.filter(
    (turn) => turn.text.trim() !== '' || (turn.attachments?.length ?? 0) > 0 || (turn.toolCalls?.length ?? 0) > 0,
  );

  const historyContents: Content[] = turns.flatMap((turn): Content[] => {
    const parts: Part[] = [...attachmentParts(turn.attachments)];
    const calls = turn.role === 'assistant' ? (turn.toolCalls ?? []) : [];
    // Each earlier call goes back as the in-turn loop sent it: the model's signed functionCall,
    // then the functionResponse (ADR-0022). Unsigned or undeclared calls go as text instead.
    if (calls.length > 0 && replayNatively(calls, request, true)) {
      const replay: Content[] = responseGroups(calls).flatMap((group): Content[] => [
        {
          role: 'model',
          parts: group.map((c) => ({
            functionCall: { ...(isSynthesisedId(c) ? {} : { id: c.id }), name: c.name, args: (c.input ?? {}) as Record<string, unknown> },
            ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
          })),
        },
        { role: 'user', parts: group.map((c) => toGeminiFunctionResponsePart(c.name, c.id, c.result)) },
      ]);
      if (turn.text.trim() !== '') parts.push({ text: turn.text });
      return parts.length > 0 ? [...replay, { role: 'model', parts }] : replay;
    }
    if (calls.length > 0) parts.push({ text: calls.map(toolCallAsText).join('\n\n') });
    if (turn.text.trim() !== '') parts.push({ text: turn.text });
    return [{ role: turn.role === 'user' ? 'user' : 'model', parts }];
  });

  const currentParts: Part[] = [...attachmentParts(request.attachments), { text: request.prompt }];
  const allContents = [...historyContents, { role: 'user', parts: currentParts }];

  // Merge adjacent same-role turns so multi-turn requests alternate between 'user' and 'model' (e.g. after a terminal tool result)
  const merged: Content[] = [];
  for (const c of allContents) {
    if (!c.parts || c.parts.length === 0) continue;
    const prev = merged.at(-1);
    if (prev && prev.role === c.role) {
      prev.parts = [...(prev.parts ?? []), ...(c.parts ?? [])];
    } else {
      merged.push({ role: c.role, parts: [...c.parts] });
    }
  }
  return merged;
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
  thoughtsTokenCount?: number;
}

/**
 * Read exact counts from `usageMetadata`. Absent metadata yields exact:false, not a guess.
 *
 * Thinking is billed as output: Vertex prices "Text output (response and reasoning)" at one rate
 * (Agent Platform pricing), and `candidatesTokenCount` leaves the thoughts out. So output is both.
 * The request's context for compaction stays prompt plus answer: thoughts are not sent back.
 */
/** Claude's effort ladder on Gemini's thinkingLevel: levels above HIGH run at HIGH. */
export function geminiThinkingLevel(effort: ReasoningEffort): ThinkingLevel {
  if (effort === 'low') return ThinkingLevel.LOW;
  if (effort === 'medium') return ThinkingLevel.MEDIUM;
  return ThinkingLevel.HIGH;
}

export function usageFrom(meta: GeminiUsageMetadata | undefined): ProviderUsage {
  if (!meta) return EMPTY_USAGE;
  const { promptTokenCount, candidatesTokenCount, cachedContentTokenCount, thoughtsTokenCount } = meta;
  if (promptTokenCount == null && candidatesTokenCount == null) return EMPTY_USAGE;
  const cached = cachedContentTokenCount ?? 0;
  return {
    // promptTokenCount "also includes the number of tokens in the cached content" (SDK
    // UsageMetadata). inputTokens is the uncached part, as Claude's input_tokens is, so the
    // cached tokens are priced once, at the cache-read rate, and not again at the input rate.
    inputTokens: Math.max(0, (promptTokenCount ?? 0) - cached),
    outputTokens: (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    // Gemini reports cached-content reads but not a separate cache-write count.
    cacheWriteTokens: 0,
    exact: true,
    lastRequest: { inputTokens: promptTokenCount ?? 0, outputTokens: candidatesTokenCount ?? 0 },
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

    // In Chat the search tool is only offered (the model decides), so progress is reported for
    // searches that happened, not for the tool being there.
    const searchMode = request.mode !== 'chat';
    if (grounded && searchMode) {
      yield {
        type: 'progress',
        stage: 'searching',
        label: 'Querying Google Search',
        detail: 'Grounding is enabled; the model is issuing search queries.',
      };
    }

    // Summed over the rounds: each round is its own request, billed on its own.
    let usage: ProviderUsage | null = null;
    let finishReason = 'stop';
    let lastMetadata: GeminiGroundingMetadata | undefined;
    const accumulated: string[] = [];
    let contents = buildGeminiContents(request);
    const editing: ContextEditingPolicy = {
      triggerTokens: this.cfg.CONTEXT_EDIT_TRIGGER_TOKENS,
      keep: this.cfg.CONTEXT_EDIT_KEEP_TOOL_RESULTS,
      batch: this.cfg.CONTEXT_EDIT_CLEAR_BATCH,
      excludeTools: ['load_skill'],
    };
    // The exact prompt size of the latest request, which decides whether the next is edited.
    let lastPromptTokens = request.previousContextTokens ?? 0;
    const maxRounds = resolveMaxRounds(this.cfg.TOOL_MAX_ROUNDS, useTools);

    try {
      roundLoop: for (let round = 0; round < maxRounds; round += 1) {
        // A round boundary is the one place abort can fire with no request in flight yet (e.g.
        // during tool execution, between this round's response and the next round's request).
        // The SDK's `abortSignal` config only stops a request already underway; without this
        // check, an abort here would still issue one more provider call.
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        // The last round must end in an answer, as the Claude adapter's does: function calling
        // is switched off and the system instruction says to answer from the results so far.
        // The conversation itself is left as it is: a text part added to the functionResponse
        // turn made Vertex reject the request ("Requests ending with a model turn are not
        // supported", live, Phase 3).
        const finalToolRound = useTools && isLastRound(round, maxRounds);
        const systemInstruction = finalToolRound
          ? `${request.systemInstruction ? `${request.systemInstruction}\n\n` : ''}${FINAL_ROUND_NOTE}`
          : request.systemInstruction;
        if (lastPromptTokens >= editing.triggerTokens) contents = clearOldFunctionResponses(contents, editing);
        const open = (forceAnswer: boolean) => this.getClient().models.generateContentStream({
          model: request.providerModelId,
          contents,
          config: {
            ...(systemInstruction ? { systemInstruction } : {}),
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
            ...(forceAnswer ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } } : {}),
            // Thought summaries, shown to the user as Claude shows its thinking (audit B8). They
            // arrive as parts marked `thought`, which `chunk.text` leaves out of the answer.
            thinkingConfig: {
              includeThoughts: true,
              ...(request.reasoningEffort ? { thinkingLevel: geminiThinkingLevel(request.reasoningEffort) } : {}),
            },
            // The SDK aborts the underlying HTTP request on this signal, which is what makes
            // client cancellation actually stop provider work rather than just stop reading it.
            abortSignal: request.signal,
            httpOptions: { timeout: this.cfg.PROVIDER_TIMEOUT_MS },
          },
        });

        let stream: Awaited<ReturnType<typeof open>>;
        try {
          stream = await open(finalToolRound);
        } catch (err) {
          // Switching calls off is the one thing this round does differently. If Vertex rejects
          // it, the round still runs as before rather than failing the whole turn; a call made
          // then is not run (below).
          if (!finalToolRound || request.signal.aborted || !String(err).includes('INVALID_ARGUMENT')) throw err;
          log.warn({ err: String(err) }, 'final round with function calling off was rejected; retrying without toolConfig');
          stream = await open(false);
        }

        let roundText = '';
        let roundUsage = EMPTY_USAGE;
        const roundCalls: {
          id?: string;
          name: string;
          args: Record<string, unknown>;
          thoughtSignature?: string;
        }[] = [];

        for await (const chunk of stream) {
          if (request.signal.aborted) {
            usage = addRequestUsage(usage, roundUsage);
            break roundLoop;
          }

          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.thought && part.text) yield { type: 'thinking', text: part.text };
          }
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
          // Within one response Gemini's usage is cumulative: the last value is the round's.
          if (chunkUsage.exact) roundUsage = chunkUsage;

          for (const candidate of chunk.candidates ?? []) {
            if (candidate.groundingMetadata) {
              lastMetadata = candidate.groundingMetadata as GeminiGroundingMetadata;
            }
            if (candidate.finishReason) finishReason = String(candidate.finishReason);
          }
        }
        usage = addRequestUsage(usage, roundUsage);
        if (roundUsage.lastRequest) lastPromptTokens = roundUsage.lastRequest.inputTokens;

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

        // Every call of the response is run, in order, and all their responses go back together
        // in one turn, as Claude runs parallel tool calls (ADR-0026). Sequential, not
        // concurrent: two run_python calls share one workspace.
        const responseParts: Part[] = [];
        for (const [i, c] of roundCalls.entries()) {
          // An abort stops the remaining calls; the next round's signal check ends the turn.
          if (request.signal.aborted) break;
          const call = { id: c.id ?? `${c.name}-${String(round)}-${String(i)}`, name: c.name, input: c.args };
          yield {
            type: 'tool_use',
            toolCallId: call.id,
            name: call.name,
            input: call.input,
            ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
          };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          responseParts.push(toGeminiFunctionResponsePart(call.name, call.id, result));
        }
        contents = [...contents, { role: 'user', parts: responseParts }];

        if (hasTerminalToolCall(roundCalls)) {
          finishReason = 'stop';
          break;
        }

      }
    } catch (err) {
      if (request.signal.aborted) throw err;
      // The caller did not abort, so this is the SDK's own per-request timeout firing: a typed,
      // retryable timeout, as Claude's SDK treats one (APIConnectionTimeoutError, retried).
      if (isAbort(err)) {
        throw new ProviderError(`Gemini request timed out after ${this.cfg.PROVIDER_TIMEOUT_MS}ms`, {
          retryable: true,
          code: 'provider_timeout',
        });
      }
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
      } else if (searchMode) {
        yield {
          type: 'progress',
          stage: 'partial',
          label: 'No sources returned',
          detail: 'Grounding was enabled but the model returned no grounding metadata.',
        };
      }
    }

    yield { type: 'completed', usage: usage ?? EMPTY_USAGE, finishReason };
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
