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
 * The shape of one piece of a tool's result. `text` is the common case; `json` is for tools
 * whose natural output is structured (search hits, a paginated read, and — later — attendance
 * rows, assessment scores, timetable entries). Provider adapters flatten this into their own
 * wire format; nothing in this type is provider-specific.
 */
export type ToolContent = { type: 'text'; text: string } | { type: 'json'; data: unknown };

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
}

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
    .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c.data)))
    .join(' ');
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}

export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: ProviderSource[]; searchEntryPoint?: string }
  | { type: 'progress'; stage: Stage; label: string; detail: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; name: string; result: ToolResult }
  /** G13: the model declined. Never folded into an ordinary finish (Invariant 1). */
  | { type: 'refusal'; category: string | null; explanation: string | null }
  | { type: 'completed'; usage: ProviderUsage; finishReason: string };

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

/** An attachment as sent to a provider: its identity plus, when hydrated, its bytes. */
export interface AttachmentBlock {
  id?: string;
  filename?: string;
  mimeType: string;
  /** Why the bytes were deliberately not loaded for this request. Adapters say so (G15). */
  omittedReason?: 'history_budget' | 'storage_unavailable' | 'model_limit';
  base64?: string;
  extractedText?: string | null;
  sizeBytes?: number;
  storageKey?: string;
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Attachments belonging to this turn (PDFs, images, or documents), carried forward across
   *  turns so the model keeps "seeing" them with prompt caching. */
  attachments?: AttachmentBlock[];
}

export interface GenerationRequest {
  prompt: string;
  history: Turn[];
  /** Images/PDFs attached to *this* turn specifically, as opposed to `history[].attachments`
   *  which are carried forward from earlier turns. */
  attachments?: AttachmentBlock[];
  systemInstruction: string;
  mode: Mode;
  maxOutputTokens: number;
  /** Set by the service from the resolved registry entry. Never inferred by an adapter. */
  providerModelId: string;
  grounded: boolean;
  /** Whether Gemini's `code_execution` tool is enabled for this turn. See ADR-0004, item 7. */
  codeExecution: boolean;
  /** Tool schemas available this turn. Absent or empty means no tool-calling loop runs. */
  tools?: ToolDefinition[];
  /** Required when `tools` is non-empty; absent otherwise. */
  toolExecutor?: ToolExecutor;
  /** Phase 5 canonical prompt assembly (stable prefix + dynamic suffix). */
  promptAssembly?: import('../services/promptCache/types.js').PromptAssembly;
  signal: AbortSignal;
}

/**
 * Upstream failure.
 *
 * `retryable` drives the backoff policy; `code` is mapped onto an API error code by the
 * service, so provider-specific vocabulary stops at this boundary.
 */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly code: 'provider_error' | 'provider_timeout' | 'model_unavailable' | 'context_overflow';
  readonly statusCode: number | undefined;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      code?: 'provider_error' | 'provider_timeout' | 'model_unavailable' | 'context_overflow';
      statusCode?: number;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = options.retryable ?? false;
    this.code = options.code ?? 'provider_error';
    this.statusCode = options.statusCode;
  }
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
}

/** True when an error is an abort rather than a genuine failure. */
export function isAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return true;
  }
  return false;
}
