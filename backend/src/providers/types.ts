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

export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: ProviderSource[]; searchEntryPoint?: string }
  | { type: 'progress'; stage: Stage; label: string; detail: string }
  | { type: 'completed'; usage: ProviderUsage; finishReason: string };

/** An image or PDF, ready to hand a provider as a native content block. */
export interface AttachmentBlock {
  mimeType: string;
  base64: string;
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Present only for a turn that had an image/PDF attached; carried forward on every later
   *  turn of the same chat so the model keeps "seeing" it, per the design's caching strategy. */
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
  readonly code: 'provider_error' | 'provider_timeout' | 'model_unavailable';
  readonly statusCode: number | undefined;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      code?: 'provider_error' | 'provider_timeout' | 'model_unavailable';
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
  stream(request: GenerationRequest): AsyncGenerator<ProviderEvent>;
  /** The cheapest possible real call. Throws ProviderError when the model is unusable. */
  probe(providerModelId: string, signal: AbortSignal): Promise<void>;
}

/** True when an error is an abort rather than a genuine failure. */
export function isAbort(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return true;
  }
  return false;
}
