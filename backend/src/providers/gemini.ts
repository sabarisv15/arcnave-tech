/**
 * Gemini on Vertex, via the Google Gen AI SDK (`@google/genai`).
 *
 * Deliberately not the legacy Vertex generative modules: those were removed on 2026-06-24.
 * See docs/backend-research.md section 1.
 */
import { StreamedCallAssembler } from './streamedCall.js';
import { ApiError as GeminiApiError, FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Content, FunctionDeclaration, GoogleGenAIOptions, Part, Blob as GeminiBlob } from '@google/genai';

import type { Config } from '../config.js';
import { logger } from '../logger.js';
import type { GeminiGroundingMetadata } from './grounding.js';
import { sourcesFromGeminiMetadata } from './grounding.js';
import type {
  ReasoningEffort,
  AttachmentBlock,
  GenerationRequest,
  HistoryToolCall,
  MediaPart,
  MediaReading,
  Provider,
  ProviderEvent,
  ProviderUsage,
  ToolDefinition,
  ToolResult,
} from './types.js';
import { addRequestUsage, EMPTY_USAGE, isAbort, ModelNotFoundError, primaryToolContent, ProviderError, replayNatively, toolCallAsText, toolImages } from './types.js';
import { callFingerprint, duplicateFailedCallResult, hasTerminalToolCall, isLastRound, resolveMaxRounds } from './toolLoopPolicy.js';
import { attachmentText, pageLabel, unavailableAttachmentNote, xmlAttr } from './attachmentContent.js';

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
      const note: Part[] = a.pagesNote ? [{ text: a.pagesNote }] : [];
      return note.concat(a.pages.flatMap((page): Part[] => [
        { text: `[${pageLabel(a, page.num)}${a.id ? `, fileId: ${a.id}` : ''}]` },
        ...(page.image?.fileUri
          ? [{ fileData: { mimeType: page.image.mimeType, fileUri: page.image.fileUri } }]
          : page.image?.base64
            ? [{ inlineData: { mimeType: page.image.mimeType, data: page.image.base64 } satisfies GeminiBlob }]
            : []),
        { text: page.text ? `Text of page ${String(page.num)}:\n${page.text}` : `Page ${String(page.num)} has no text layer; read it from the image.` },
      ]));
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
    const nameAttr = a.filename ? ` filename="${xmlAttr(a.filename)}"` : '';
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
 * object shape beyond `Record<string, unknown>`'s outer wrapper. Every result goes back whole,
 * however large the conversation: nothing is cleared before compaction (ADR-0023, ADR-0064).
 */
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

/**
 * Stage 15 ER-2e: transient by HTTP status. 529 (in the matrix) is not a status Vertex sends,
 * so it is not listed here. An ordinary 429 is transient; a quota-0 429 is not (below).
 */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

/** The HTTP status `@google/genai`'s `ApiError` carries (`status`, from the response or a stream error chunk). */
function statusOf(err: unknown): number | undefined {
  if (err instanceof GeminiApiError) return err.status;
  if (typeof err === 'object' && err !== null && typeof (err as { status?: unknown }).status === 'number') {
    return (err as { status: number }).status;
  }
  return undefined;
}

interface GoogleRpcError {
  code?: number;
  message?: string;
  status?: string;
  details?: Array<Record<string, unknown>>;
}

/**
 * The `google.rpc.Status` body inside the SDK's error message. A failed response's message is
 * `JSON.stringify(body)`; an error inside a stream is `got status: X. ${JSON.stringify(chunk)}`
 * (`@google/genai` 2.22 `throwErrorIfNotOK` and the SSE reader). Undefined when it is neither.
 */
function googleRpcError(err: unknown): GoogleRpcError | undefined {
  const message = err instanceof Error ? err.message : '';
  const start = message.indexOf('{');
  if (start < 0) return undefined;
  try {
    const parsed = JSON.parse(message.slice(start)) as { error?: GoogleRpcError };
    return typeof parsed.error === 'object' && parsed.error !== null ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

function detailsOfType(body: GoogleRpcError, type: string): Array<Record<string, unknown>> {
  return (body.details ?? []).filter((d) => typeof d['@type'] === 'string' && (d['@type'] as string).endsWith(`/google.rpc.${type}`));
}

/**
 * A 429 whose quota is zero: the project has no allowance for this model at all, so waiting
 * cannot help (Stage 15 ER-2g: a configuration error, no retry loop). Google says so two ways:
 * a `QuotaFailure` violation whose `quotaValue` is 0, and the message's "limit: 0". proto3 JSON
 * leaves a zero `quota_value` out of the body (default values are not written), so the message
 * is the signal that survives; both are read.
 */
export function isQuotaZero(body: GoogleRpcError | undefined): boolean {
  if (!body) return false;
  const zeroViolation = detailsOfType(body, 'QuotaFailure').some((d) =>
    Array.isArray(d.violations) &&
    (d.violations as Array<Record<string, unknown>>).some((v) => v.quotaValue === '0' || v.quotaValue === 0),
  );
  return zeroViolation || /\blimit:\s*0(?!\d)/.test(body.message ?? '');
}

/** `RetryInfo.retryDelay` ("55s", "1.5s") in ms: Gemini's Retry-After (ER-2d honours ≤ N-42). */
function retryDelayOf(body: GoogleRpcError | undefined): number | undefined {
  if (!body) return undefined;
  for (const d of detailsOfType(body, 'RetryInfo')) {
    const match = typeof d.retryDelay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay) : null;
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return undefined;
}

/** A failure before any HTTP status: the connection dropped or never opened (ER-2e "connection"). */
function isConnectionError(err: unknown): boolean {
  if (err instanceof TypeError && err.message === 'fetch failed') return true; // undici
  const code = (err as { cause?: { code?: unknown }; code?: unknown } | null)?.cause?.code ?? (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR_)/.test(code);
}

/**
 * The typed error a failed Gemini call becomes, classified by status per the Stage 15 matrix
 * (ER-2e/f/g): 408/409/429/5xx and a lost connection are transient; a quota-0 429 is the
 * configuration error `provider_quota_unavailable`; 401/403 are `model_unavailable`; any other
 * status (400, 404 that is not the model, 413…) is not retried. The text stays in the message
 * for the overflow and payload checks downstream.
 */
export function classifyGeminiError(err: unknown, modelId: string, location: string): ProviderError {
  if (isNotFound(err)) return new ModelNotFoundError(modelId, location);
  const status = statusOf(err);
  const body = googleRpcError(err);
  if (status === 429 && isQuotaZero(body)) {
    return new ProviderError(`Gemini has no quota for this model (limit 0): ${String(err)}`, {
      code: 'provider_quota_unavailable',
      retryable: false,
      statusCode: status,
    });
  }
  if (status === 401 || status === 403) {
    return new ProviderError(`Gemini rejected the credentials or permissions: ${String(err)}`, {
      code: 'model_unavailable',
      retryable: false,
      statusCode: status,
    });
  }
  const after = status === undefined ? undefined : retryDelayOf(body);
  return new ProviderError(`Gemini request failed: ${String(err)}`, {
    retryable: status !== undefined ? RETRYABLE_STATUS.has(status) : isConnectionError(err),
    ...(status !== undefined ? { statusCode: status } : {}),
    ...(after !== undefined ? { retryAfterMs: after } : {}),
  });
}

/**
 * The options every Gemini client is built with. The SDK retries only when `retryOptions` is
 * given (2.22 `apiCall`: no options, one fetch), and a request's own `httpOptions` are merged
 * over these, so `attempts: 1` here holds for every call; it is set rather than left to the
 * default so a later SDK default cannot add hidden attempts (Stage 15 ER-1b, Stage 20 VS-29b).
 */
export const GEMINI_HTTP_OPTIONS = { retryOptions: { attempts: 1 } } as const;

/** The one place the Vertex Gemini client is built: SDK retries off; the app gateway retries (ER-1b). */
export function createGeminiClient(cfg: Config): GoogleGenAI {
  if (!cfg.GOOGLE_CLOUD_PROJECT) {
    throw new ProviderError('GOOGLE_CLOUD_PROJECT is not set', { code: 'model_unavailable' });
  }
  const options: GoogleGenAIOptions = {
    vertexai: true,
    project: cfg.GOOGLE_CLOUD_PROJECT,
    location: cfg.geminiLocation,
    httpOptions: { retryOptions: { ...GEMINI_HTTP_OPTIONS.retryOptions } },
  };
  return new GoogleGenAI(options);
}

/**
 * A media reading that did not end in a natural stop (MAX_TOKENS, SAFETY, …) may be cut short
 * (D2 X-7, Stage 9 OCR-M11 finish-reason check). Such a text is marked, never passed off as whole.
 */
export function mediaReadingComplete(finishReason: string): boolean {
  return finishReason === 'STOP';
}

function incompleteMediaNote(finishReason: string): string {
  return `\n\n[Incomplete: the reading stopped early (finish reason ${finishReason}), so the text above may be cut off.]`;
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
/** ArcNave's effort ladder on Gemini's thinkingLevel: levels above HIGH run at HIGH. */
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
    // UsageMetadata). inputTokens is the uncached part, as on every adapter, so the
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
  // Models Vertex refused `streamFunctionCallArguments` for; they get whole calls from then on.
  private readonly wholeCallModels = new Set<string>();

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
          // An explicit cap (D2 X-7), so a cut reading ends with MAX_TOKENS and is marked below.
          maxOutputTokens: this.cfg.MEDIA_MAX_OUTPUT_TOKENS,
          abortSignal: signal,
          httpOptions: { timeout: this.cfg.PROVIDER_TIMEOUT_MS },
        },
      });
      const text = response.text ?? '';
      const finishReason = String(response.candidates?.[0]?.finishReason ?? 'FINISH_REASON_UNSPECIFIED');
      return mediaReadingComplete(finishReason) ? text : `${text}${incompleteMediaNote(finishReason)}`;
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw err;
      const classified = classifyGeminiError(err, this.cfg.MODEL_GEMINI_FLASH, this.cfg.geminiLocation);
      if (classified instanceof ModelNotFoundError) throw classified;
      // The SDK's message can quote the request; only the kind of failure is kept.
      throw new ProviderError('Gemini media description failed', {
        retryable: classified.retryable,
        code: classified.code,
        ...(classified.statusCode !== undefined ? { statusCode: classified.statusCode } : {}),
      });
    }
  }

  async readMedia(parts: MediaPart[], prompt: string, signal: AbortSignal): Promise<MediaReading> {
    const model = this.cfg.MODEL_GEMINI_FLASH;
    if (!model) throw new ProviderError('MODEL_GEMINI_FLASH is not configured', { code: 'model_unavailable' });
    try {
      const response = await this.getClient().models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              ...parts.map((p) =>
                p.fileUri ? { fileData: { mimeType: p.mimeType, fileUri: p.fileUri } } : { inlineData: { mimeType: p.mimeType, data: p.base64 ?? '' } },
              ),
              { text: prompt },
            ],
          },
        ],
        config: {
          // An explicit cap (D2 X-7), so a cut reading ends with MAX_TOKENS and says so.
          maxOutputTokens: this.cfg.MEDIA_MAX_OUTPUT_TOKENS,
          abortSignal: signal,
          httpOptions: { timeout: this.cfg.PROVIDER_TIMEOUT_MS },
        },
      });
      const finishReason = String(response.candidates?.[0]?.finishReason ?? 'FINISH_REASON_UNSPECIFIED');
      return {
        text: response.text ?? '',
        finishReason,
        model: response.modelVersion ?? model,
        truncated: !mediaReadingComplete(finishReason),
      };
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw err;
      const classified = classifyGeminiError(err, model, this.cfg.geminiLocation);
      if (classified instanceof ModelNotFoundError) throw classified;
      // The SDK's message can quote the request; only the kind of failure is kept.
      throw new ProviderError('Gemini media reading failed', {
        retryable: classified.retryable,
        code: classified.code,
        ...(classified.statusCode !== undefined ? { statusCode: classified.statusCode } : {}),
      });
    }
  }

  /** Vertex `countTokens` on the Gemini model (Stage 9 TOKENS). Free; no generation. */
  async countTokens(text: string, signal: AbortSignal): Promise<{ tokens: number; model: string }> {
    const model = this.cfg.MODEL_GEMINI_FLASH;
    if (!model) throw new ProviderError('MODEL_GEMINI_FLASH is not configured', { code: 'model_unavailable' });
    const res = await this.getClient().models.countTokens({
      model,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: { abortSignal: signal },
    });
    if (typeof res.totalTokens !== 'number') throw new ProviderError('countTokens returned no total');
    return { tokens: res.totalTokens, model };
  }

  /** Lazy: the app must boot without credentials so unconfigured aliases report cleanly. */
  private getClient(): Pick<GoogleGenAI, 'models'> {
    if (this.injectedClient) return this.injectedClient;
    this.client ??= createGeminiClient(this.cfg);
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
    // Every earlier tool result goes in whole, whatever the size of the previous request: only
    // compaction shortens a conversation (ADR-0023, reinstated for Gemini by ADR-0064).
    let contents = buildGeminiContents(request);
    // A call that failed with this exact input is not run again this turn (D2 X-10).
    const failedToolCalls = new Set<string>();
    const maxRounds = resolveMaxRounds(this.cfg.TOOL_MAX_ROUNDS, useTools);

    try {
      roundLoop: for (let round = 0; round < maxRounds; round += 1) {
        // A round boundary is the one place abort can fire with no request in flight yet (e.g.
        // during tool execution, between this round's response and the next round's request).
        // The SDK's `abortSignal` config only stops a request already underway; without this
        // check, an abort here would still issue one more provider call.
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        // The last round must end in an answer, as on every adapter: function calling
        // is switched off and the system instruction says to answer from the results so far.
        // The conversation itself is left as it is: a text part added to the functionResponse
        // turn made Vertex reject the request ("Requests ending with a model turn are not
        // supported", live, Phase 3).
        const finalToolRound = useTools && isLastRound(round, maxRounds);
        const systemInstruction = finalToolRound
          ? `${request.systemInstruction ? `${request.systemInstruction}\n\n` : ''}${FINAL_ROUND_NOTE}`
          : request.systemInstruction;
        // Arguments stream while written only when a call can show them (a show_widget visual)
        // and the model takes the option; everything else is unchanged (ADR-0037).
        const streamArgs =
          useTools &&
          this.cfg.GEMINI_STREAM_TOOL_ARGS &&
          !this.wholeCallModels.has(request.providerModelId) &&
          toolDefs.some((t) => t.name === 'show_widget');
        const open = (forceAnswer: boolean, stream: boolean) => this.getClient().models.generateContentStream({
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
            ...(forceAnswer
              ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } }
              : stream
                ? { toolConfig: { functionCallingConfig: { streamFunctionCallArguments: true } } }
                : {}),
            // Thought summaries, shown to the user (audit B8). They
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
          stream = await open(finalToolRound, streamArgs && !finalToolRound);
        } catch (err) {
          // Switching calls off, or streaming their arguments, is the one thing this round asks
          // for beyond the plain request. If Vertex rejects it, the round runs as a plain request
          // rather than failing the whole turn; a call made on the final round is not run (below).
          const asked = finalToolRound || streamArgs;
          if (!asked || request.signal.aborted || !String(err).includes('INVALID_ARGUMENT')) throw err;
          if (!finalToolRound) {
            this.wholeCallModels.add(request.providerModelId);
            log.warn({ err: String(err), model: request.providerModelId }, 'streamed function-call arguments were rejected; using whole calls for this model');
          } else {
            log.warn({ err: String(err) }, 'final round with function calling off was rejected; retrying without toolConfig');
          }
          stream = await open(false, false);
        }

        let roundText = '';
        let roundUsage = EMPTY_USAGE;
        const assembler = new StreamedCallAssembler();

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
          // thought_signature"), so calls are read from the parts themselves. The assembler also
          // rebuilds a call whose arguments arrive in pieces (ADR-0037).
          const callParts = chunk.candidates?.[0]?.content?.parts?.filter((p) => p.functionCall) ?? [];
          // `functionCalls` is derived from the parts; it is read only when a chunk has no parts.
          const parts = callParts.length > 0 ? callParts : (chunk.functionCalls ?? []).map((functionCall) => ({ functionCall }));
          for (const part of parts) {
            if (!assembler.accept(part)) continue;
            const partial = assembler.partial;
            if (partial) yield { type: 'tool_input_partial', index: partial.index, name: partial.name, input: partial.args };
          }

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
        assembler.close();
        const roundCalls = assembler.calls;

        // The final round is reached only while the model is still working, and it was made to
        // answer: the turn used every tool step it may. A call it makes anyway is not run, since
        // no round is left to answer after it. Either way the caller offers Continue.
        if (finalToolRound) {
          finishReason = 'tool_limit';
          break;
        }
        if (!useTools || roundCalls.length === 0) break;

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
        // in one turn (parallel tool calls, ADR-0026). Sequential, not
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
          const fingerprint = callFingerprint(call.name, call.input);
          const repeatOfFailure = failedToolCalls.has(fingerprint);
          const result = repeatOfFailure
            ? duplicateFailedCallResult(call.id, call.name)
            : await request.toolExecutor!.execute(call, request.signal);
          if (!result.ok) failedToolCalls.add(fingerprint);
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
      // retryable timeout, as the other adapter's SDK treats one.
      if (isAbort(err)) {
        throw new ProviderError(`Gemini request timed out after ${this.cfg.PROVIDER_TIMEOUT_MS}ms`, {
          retryable: true,
          code: 'provider_timeout',
        });
      }
      throw classifyGeminiError(err, request.providerModelId, this.cfg.geminiLocation);
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
      log.debug({ status: statusOf(err), providerModelId }, 'gemini probe failed');
      throw classifyGeminiError(err, providerModelId, this.cfg.geminiLocation);
    }
  }
}
