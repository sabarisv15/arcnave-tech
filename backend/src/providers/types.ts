/**
 * The provider boundary.
 *
 * Nothing above this directory knows Vertex exists. A provider consumes a `GenerationRequest`
 * and yields `ProviderEvent`s; the service layer turns those into SSE frames and database rows.
 *
 * Cancellation contract: every adapter accepts an `AbortSignal` and must stop upstream work
 * when it fires. Returning early from the async generator is not enough — the HTTP request to
 * the provider has to actually be aborted, or a cancelled client keeps burning tokens.
 */

export type Stage =
  | 'planning'
  | 'searching'
  | 'reading'
  | 'synthesizing'
  | 'complete'
  | 'partial'
  | 'error';

export type Mode = 'chat' | 'search' | 'research';

/**
 * A citation as the provider reported it.
 *
 * `urlResolved` is false when we could not turn a provider redirect into a canonical URL.
 * We surface the redirect and say so rather than inventing a destination.
 */
export interface ProviderSource {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  passage: string;
  urlResolved: boolean;
  sourceType: string;
  retrievedAt: Date;
}

/**
 * Token counts as reported by the provider.
 *
 * `exact` is false when the provider returned nothing usable. The counts are then zero and
 * callers must not present them as measurements. There is no estimator in this codebase.
 */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  exact: boolean;
  /**
   * The last provider request of the turn: its whole prompt (cached part included) and its
   * answer. That is what the next turn resends, so compaction reads this and not the turn's
   * total, which counts the conversation once per tool round. Present only when exact.
   */
  lastRequest?: { inputTokens: number; outputTokens: number };
}

export const EMPTY_USAGE: ProviderUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  exact: false,
};

export function totalTokens(usage: ProviderUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

/**
 * A turn's usage after one more provider request. Every round of a tool loop is a new request
 * that resends the conversation (the original messages, the assistant's response and the tool results), and
 * each is billed, so a turn's tokens are the sum of its requests. The sum is exact only when
 * every request's count was reported; one missing count makes the turn exact:false with zeros
 * (Invariant 3), never a part shown as the whole.
 *
 * `turn` is null before the first request. A request without `lastRequest` counts its own
 * input and output as that.
 */
export function addRequestUsage(turn: ProviderUsage | null, request: ProviderUsage): ProviderUsage {
  if (!request.exact || (turn !== null && !turn.exact)) return EMPTY_USAGE;
  return {
    inputTokens: (turn?.inputTokens ?? 0) + request.inputTokens,
    outputTokens: (turn?.outputTokens ?? 0) + request.outputTokens,
    cacheReadTokens: (turn?.cacheReadTokens ?? 0) + request.cacheReadTokens,
    cacheWriteTokens: (turn?.cacheWriteTokens ?? 0) + request.cacheWriteTokens,
    exact: true,
    lastRequest: request.lastRequest ?? { inputTokens: request.inputTokens, outputTokens: request.outputTokens },
  };
}

/**
 * The shape of one piece of a tool's result. `text` is the common case; `json` is for tools
 * whose natural output is structured (search hits, a paginated read, and — later — attendance
 * rows, assessment scores, timetable entries). Provider adapters flatten this into their own
 * wire format; nothing in this type is provider-specific.
 */
/**
 * One block of a tool's result. `image` lets a tool show the model a picture (a page crop the
 * code rendered, a chart it drew), so the model can look instead of guessing from text. Images
 * go to the model only; what is stored and previewed keeps just their names.
 */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'json'; data: unknown }
  | { type: 'image'; name: string; mimeType: string; base64: string };

/** The first non-image block: what a result "says". Images ride alongside it. */
export function primaryToolContent(result: ToolResult): Exclude<ToolContent, { type: 'image' }> | undefined {
  return result.content.find((c): c is Exclude<ToolContent, { type: 'image' }> => c.type !== 'image');
}

export function toolImages(result: ToolResult): Extract<ToolContent, { type: 'image' }>[] {
  return result.content.filter((c): c is Extract<ToolContent, { type: 'image' }> => c.type === 'image');
}

/** A result as stored: image bytes become a note naming the image, so a transcript row never
 *  carries megabytes of base64 and a replayed history never resends pictures. */
export function withoutImageBytes(content: ToolContent[]): ToolContent[] {
  return content.map((c) =>
    c.type === 'image' ? { type: 'text' as const, text: `[image "${c.name}" was shown to the model]` } : c,
  );
}

/**
 * An earlier turn's tool call written out as text, for when it cannot be replayed as a native
 * call: made by another provider, missing Gemini's signature, or naming a tool this request does
 * not declare. The model still sees what was called and what came back (ADR-0022).
 */
export function toolCallAsText(call: HistoryToolCall): string {
  const block = primaryToolContent(call.result);
  const out = block === undefined ? '' : block.type === 'json' ? JSON.stringify(block.data) : block.text;
  return `Historical execution data (not assistant prose; do not reproduce this record):\n${JSON.stringify({ tool: call.name, input: call.input ?? {}, ok: call.result.ok, output: out })}`;
}

/** Whether a turn's calls can go as native calls: every one declared in this request (and, for
 *  Gemini, signed). Otherwise the whole turn's calls go as text, so no turn is half of each. */
export function replayNatively(calls: HistoryToolCall[], request: GenerationRequest, needsSignature: boolean): boolean {
  const declared = new Set((request.tools ?? []).map((t) => t.name));
  // Gemini signs the first call of each response only (see responseGroups): the turn's first call
  // must be signed; later unsigned ones are the rest of a parallel response.
  return (
    calls.every((c) => declared.has(c.name)) && (!needsSignature || Boolean(calls[0]?.thoughtSignature))
  );
}

export function toolContentText(c: ToolContent): string {
  return c.type === 'text' ? c.text : c.type === 'json' ? JSON.stringify(c.data) : `[image ${c.name}]`;
}

/** A tool the model may call. `inputSchema` is provider-neutral JSON Schema; each adapter clones
 *  it before handing it to its own SDK — `@google/genai` rewrites a schema object in place
 *  (uppercasing `type` values), so sharing one object between two adapters would corrupt
 *  whichever one runs second. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** `ok: false` means the tool ran and failed, or its input was invalid — never thrown, always
 *  fed back to the model as a real result so it can react, per Invariant 1. `content` is already
 *  bounded by the tool implementation before it reaches here — this type does not itself impose
 *  a limit. */
export interface ToolResult {
  toolCallId: string;
  ok: boolean;
  content: ToolContent[];
  /** A failure the client must recognise by code, not by the text (Invariant 5). */
  errorCode?: ToolErrorCode;
}

/** Stable codes a failed tool call carries to the client (`tool_result.errorCode`). */
export type ToolErrorCode = 'sandbox_misconfigured';

/**
 * The seam between a provider adapter's loop and ArcNave's actual tool implementations.
 * Constructed fresh per request (it is bound to one project), never shared across requests.
 * `signal` is the same `AbortSignal` the provider request carries: a tool whose backing store
 * cannot truly interrupt an in-flight operation (e.g. a single Postgres query) still checks it
 * at its own entry/exit boundaries, so cancellation propagates as far as is honestly possible —
 * this interface does not promise mid-operation interruption for every implementation.
 */
export interface ToolExecutor {
  execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
}

/** Flatten a `ToolResult` into a short string for an SSE preview frame — never the value stored
 *  in the database or sent back to the model, both of which keep the full bounded content. */
export function toolResultPreview(result: ToolResult, maxChars: number): string {
  const flat = result.content
    .map(toolContentText)
    .join(' ');
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

export type ProviderEvent =
  | { type: 'delta'; text: string }
  /** A piece of the model's thought summary: shown to the user, never part of the answer. */
  | { type: 'thinking'; text: string }
  | { type: 'sources'; sources: ProviderSource[]; searchEntryPoint?: string }
  | { type: 'progress'; stage: Stage; label: string; detail: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown; thoughtSignature?: string }
  | { type: 'tool_result'; toolCallId: string; name: string; result: ToolResult }
  /**
   * ADR-0037: a call's arguments so far, while the model is still writing them. `index` is the
   * call's place in this response. `input` is live and changes after the event: read it at once.
   * Nothing runs on it; the call runs from its `tool_use` once complete.
   */
  | { type: 'tool_input_partial'; index: number; name: string; input: Record<string, unknown> }
  /** G13: the model declined. Never folded into an ordinary finish (Invariant 1). */
  | { type: 'refusal'; category: string | null; explanation: string | null }
  /**
   * P22 (ADR-0079, Stage 17 OD-13): one provider request has ended. `usage` is that request's
   * alone (never the running total), as the provider reported it. Emitted at each round end,
   * before `completed`; a stop mid-request reports what the provider had sent so far
   * (`provider_partial`). No metadata: `exact: false`, zeros, `none` (Invariant 3).
   */
  | {
      type: 'call_usage';
      /** The request's place in this adapter call, 0-based (one per tool round). */
      ordinal: number;
      usage: ProviderUsage;
      usageSource: UsageSource;
      /** The provider's own stop reason for this request (`end_turn`, `tool_use`, `STOP`, …). */
      finishReason: string;
      providerRef?: ProviderRef;
      /** Request sent → its first stream event. */
      ttftMs?: number;
      /** Request sent → its last stream event. */
      durationMs?: number;
    }
  | { type: 'completed'; usage: ProviderUsage; finishReason: string };

/* -------------------------------------------------------------------------- P22: per-call usage */

/**
 * Where a call's counts came from (OD-13). There is no `estimated` (Invariant 3): a stopped
 * request keeps the provider's own partial counts, and a request with no metadata has none.
 */
export const USAGE_SOURCES = ['provider', 'provider_partial', 'none'] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

/** What a call was for. `title` / `style` / `summary` / `router` are helper calls (P13). */
export const CALL_ROLES = ['answer', 'forced_answer', 'title', 'style', 'summary', 'router'] as const;
export type CallRole = (typeof CALL_ROLES)[number];

/** The provider's id for a request: Claude's message id, Gemini's response id. */
export interface ProviderRef {
  type: 'message_id' | 'response_id' | 'request_id';
  value: string;
}

/**
 * One model call of a turn, as the ledger stores it (wave-plan §4 contract: P13's helper jobs
 * and P11's attempts build this same shape and hand it to `ledger.recordCalls`).
 */
export interface CallUsage {
  /** 1-based place of the call in its turn. */
  ordinal: number;
  /** 1-based gateway attempt that made it (P11 fills retries; a retried attempt that failed has no row). */
  attempt: number;
  role: CallRole;
  providerModelId: string;
  usage: ProviderUsage;
  usageSource: UsageSource;
  finishReason: string;
  providerRef?: ProviderRef;
  ttftMs?: number;
  durationMs?: number;
  /** When the request was sent; the ledger's partition key. Defaults to the turn's start. */
  startedAt?: Date;
}

/**
 * A turn's usage from its calls (E19): the sum of every call's counts when every call is exact.
 * One call without counts makes the turn `exact: false` with zeros (Invariant 3: a part is never
 * shown as the whole); that call's row says so and the others keep their own counts in the
 * ledger. `lastRequest` is the last call's own (what the next turn resends).
 */
export function usageFromCalls(calls: readonly CallUsage[]): ProviderUsage {
  if (calls.length === 0) return EMPTY_USAGE;
  const exact = calls.every((c) => c.usage.exact);
  if (!exact) return EMPTY_USAGE;
  const last = calls.at(-1)!.usage;
  return {
    inputTokens: calls.reduce((n, c) => n + c.usage.inputTokens, 0),
    outputTokens: calls.reduce((n, c) => n + c.usage.outputTokens, 0),
    cacheReadTokens: calls.reduce((n, c) => n + c.usage.cacheReadTokens, 0),
    cacheWriteTokens: calls.reduce((n, c) => n + c.usage.cacheWriteTokens, 0),
    exact,
    // Only a size the provider reported for that request: a call without one has no claim to it.
    ...(exact && last.lastRequest ? { lastRequest: last.lastRequest } : {}),
  };
}

/** An attachment ready to hand a provider: native binary content (PDF/image) or extracted document text. */
/**
 * Canonical identity of a stored attachment (G26). Built only by `toAttachmentRef` in
 * `services/attachments/attachmentRef.ts`; every executor and adapter reads these field names.
 */
export interface AttachmentRef {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  extractedText?: string | null;
}

/** One page of a PDF as a model is shown it: an image of the page, and its text (ADR-0013). */
export interface AttachmentPage {
  num: number;
  text: string;
  /**
   * The page image: its bytes, or, for a provider that reads from Cloud Storage (Gemini), a
   * `gs://` URI in their place (ADR-0016). Never both empty.
   */
  image?: { mimeType: 'image/jpeg'; base64?: string; fileUri?: string };
}

/** An attachment as sent to a provider: its identity plus, when hydrated, its bytes. */
export interface AttachmentBlock {
  id?: string;
  filename?: string;
  mimeType: string;
  /** Why the bytes were deliberately not loaded for this request. Adapters say so (G15). */
  omittedReason?: 'history_budget' | 'storage_unavailable' | 'model_limit' | 'unreadable' | 'read_with_code';
  /** For `unreadable`: what the reader reported. */
  omittedDetail?: string;
  base64?: string;
  /**
   * A PDF of up to 100 pages, as its page images and page text. When set, `base64` is not:
   * no provider is handed the PDF itself.
   */
  pages?: AttachmentPage[];
  /** Pages in a PDF sent as text only (over 100 pages). */
  textOnlyPageCount?: number;
  /** All the pages of a PDF whose `pages` carry only some of them (the N-13 budget). */
  pageCount?: number;
  /** Said before a PDF's pages when only some are sent: which, and why (ADR-0063). */
  pagesNote?: string;
  /**
   * Set by the file budget (Stage 6 CXD-4): true when this file's provider token count fits the
   * whole-file limit (N-05), so its normalised text goes inline even on a turn that can run code.
   */
  wholeWithinBudget?: boolean;
  /** True when `extractedText` holds retrieved excerpts, not the whole file. */
  excerpted?: boolean;
  extractedText?: string | null;
  sizeBytes?: number;
  storageKey?: string;
}

/** A tool call an earlier assistant turn made, with the result the model received then. */
export interface HistoryToolCall {
  id: string;
  name: string;
  input: unknown;
  result: ToolResult;
  /** Gemini's signature on the call, when the call was made by Gemini and kept. */
  thoughtSignature?: string;
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** An assistant turn's tool calls, in order, before its final text. With every tool call and result
   *  kept in history, a later turn sees what was loaded, run and found. */
  toolCalls?: HistoryToolCall[];
  /** Attachments belonging to this turn (PDFs, images, or documents), carried forward across
   *  turns so the model keeps "seeing" them with prompt caching. */
  attachments?: AttachmentBlock[];
}

/**
 * How hard the model thinks, on ArcNave's effort ladder. Each adapter maps it to its model's own
 * control (`output_config.effort` on the Anthropic adapter, Gemini `thinkingLevel`); the service clamps it to the
 * levels the model supports first.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface GenerationRequest {
  prompt: string;
  history: Turn[];
  /** Images/PDFs attached to *this* turn specifically, as opposed to `history[].attachments`
   *  which are carried forward from earlier turns. */
  attachments?: AttachmentBlock[];
  systemInstruction: string;
  /**
   * Text that leads the current user turn, before its attachments and the user's message: the
   * per-turn state (current time, an earlier-conversation summary) and, for Gemini, the session
   * state too (ADR-0075). Never stored with the message; a later turn sends its own.
   */
  turnPreamble?: string;
  mode: Mode;
  maxOutputTokens: number;
  /**
   * Exact prompt tokens of this chat's previous request, when known. Recorded in the turn log;
   * no adapter shortens the request on it: tool results are never cleared before compaction
   * (ADR-0023, ADR-0072).
   */
  previousContextTokens?: number;
  /** Absent when the model has no effort control; the adapter then sends nothing. */
  reasoningEffort?: ReasoningEffort;
  /** Set by the service from the resolved registry entry. Never inferred by an adapter. */
  providerModelId: string;
  grounded: boolean;
  /** Whether Gemini's `code_execution` tool is enabled for this turn. See ADR-0004, item 7. */
  codeExecution: boolean;
  /** Tool schemas available this turn. Absent or empty means no tool-calling loop runs. */
  tools?: ToolDefinition[];
  /** Required when `tools` is non-empty; absent otherwise. */
  toolExecutor?: ToolExecutor;
  /** The prompt as assembled: stable text, session state, per-turn state (ADR-0075). */
  promptAssembly?: import('../services/promptCache/types.js').PromptAssembly;
  signal: AbortSignal;
}

/**
 * Upstream failure.
 *
 * `retryable` drives the backoff policy; `code` is mapped onto an API error code by the
 * service, so provider-specific vocabulary stops at this boundary.
 */
export type ProviderErrorCode = 'provider_error' | 'provider_timeout' | 'model_unavailable' | 'context_overflow' | 'provider_limit' | 'provider_quota_unavailable';

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly code: ProviderErrorCode;
  readonly statusCode: number | undefined;
  /** The provider's own Retry-After, in ms, when it sent one (Stage 15 ER-2 honours it ≤ N-42). */
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      code?: ProviderErrorCode;
      statusCode?: number;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = options.retryable ?? false;
    this.code = options.code ?? 'provider_error';
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Whether a failed provider call may be retried (Stage 15 ER-2): only a `ProviderError` the
 * adapter classified retryable. An unclassified error, or anything that is not a ProviderError,
 * is not retried. One rule for the turn loop (providerLoop.ts) and media readings (audio.ts).
 */
export function isRetryableProviderError(err: unknown): boolean {
  return err instanceof ProviderError && err.retryable;
}

/**
 * The publisher model is not available in this project/region.
 *
 * Vertex reports this as a 404 "Publisher Model not found", which reads like a routing bug but
 * almost always means the model is not enabled for the project or the region is wrong.
 */
export class ModelNotFoundError extends ProviderError {
  constructor(
    readonly modelId: string,
    readonly location: string,
  ) {
    super(`Publisher model "${modelId}" not found in location "${location}"`, {
      retryable: false,
      code: 'model_unavailable',
      statusCode: 404,
    });
    this.name = 'ModelNotFoundError';
  }
}

export interface Provider {
  readonly name: string;
  supportsGrounding(): boolean;
  /** Server-side code-execution sandbox. Optional: only Gemini has one on Vertex — see ADR-0004. */
  supportsCodeExecution?(): boolean;
  stream(request: GenerationRequest): AsyncGenerator<ProviderEvent>;
  /** The cheapest possible real call. Throws ProviderError when the model is unusable. */
  probe(providerModelId: string, signal: AbortSignal): Promise<void>;
  /**
   * Ask the model to describe/transcribe binary content it can see natively — scanned PDF
   * pages, audio, video. Optional: only a vision/multimodal-capable provider implements this.
   * Callers (retrieval's OCR and audio/video extraction) must treat a missing implementation
   * as `capability_unavailable`, never silently skip the content it would have covered.
   */
  describeMedia?(
    parts: AttachmentBlock[],
    prompt: string,
    signal: AbortSignal,
  ): Promise<string>;
  /**
   * Like `describeMedia`, with the finish reason, so OCR and transcription can tell a whole
   * answer from a cut one (Stage 9 OCR-M11 finish-reason check). Parts may be `gs://` URIs.
   */
  readMedia?(parts: MediaPart[], prompt: string, signal: AbortSignal): Promise<MediaReading>;
  /**
   * The provider's own token count for `text` on this family's counting model (Stage 9 TOKENS).
   * Provider metadata, not an estimate (Invariant 3). Throws when the count API fails.
   */
  countTokens?(text: string, signal: AbortSignal): Promise<{ tokens: number; model: string }>;
}

/** One input to `readMedia`: inline bytes, or a `gs://` URI the model reads (Gemini). */
export interface MediaPart {
  mimeType: string;
  base64?: string;
  fileUri?: string;
}

export interface MediaReading {
  text: string;
  /** The provider's finish reason as it reported it (`STOP`, `MAX_TOKENS`, `SAFETY`, …). */
  finishReason: string;
  /** The model version that answered, for `ocr_version`. */
  model: string;
  /**
   * True when the reading did not end in a natural stop (D2 X-7): the text may be cut short and
   * is never to be taken as whole. Absent from an adapter that does not report it.
   */
  truncated?: boolean;
}

/** True when an error is an abort rather than a genuine failure. */
export function isAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return true;
  }
  return false;
}
