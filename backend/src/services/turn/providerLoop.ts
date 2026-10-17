/**
 * Provider loop: the gateway's retry around one provider stream (Stage 15 ER-1, ER-2), the
 * context-overflow recovery, and the typed errors a provider failure becomes. Moved from
 * `services/generation.ts` unchanged but for `this` becoming `svc` (ADR-0067).
 */
import type { Config } from '../../config.js';
import { ApiError } from '../../errors.js';
import { type GenerationRequest, type ProviderEvent, type Turn, isAbort, isRetryableProviderError, ModelNotFoundError, ProviderError } from '../../providers/types.js';
import type { TurnServices } from './services.js';
import { logger } from '../../logger.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

/**
 * Retry transient provider failures, per the Stage 15 matrix (ER-1, ER-2; N-42).
 *
 * Only retries before the attempt's first visible or side-effecting step (text, code,
 * thinking, a visual being drawn, a tool call: ER-2b). After one, a restart would duplicate
 * text or run a tool twice, so the failure propagates instead; after a tool ran, a failure a
 * retry would have answered ends the turn partial (`FailedAfterToolRun`, ADR-0072).
 *
 * At most PROVIDER_MAX_RETRIES retries; attempt k waits a full-jitter random part of
 * PROVIDER_RETRY_BASE_MS·2^(k-1), capped at PROVIDER_RETRY_MAX_BACKOFF_MS. A provider
 * Retry-After is waited for when it is at most PROVIDER_RETRY_AFTER_MAX_MS; a longer one fails
 * the turn at once (there is no other model to fall back to: Invariant 1). The SDKs' own
 * retries are off, so these are the only retries.
 *
 * There is no first-token cutoff: a request is bounded by the
 * adapter's PROVIDER_TIMEOUT_MS (10 minutes, the SDK's default) and retried only when it fails
 * (connection error, timeout, 408/409/429/5xx/529), never for being slow. A 12 s cutoff aborted
 * large follow-ups that were still reading, and each retry repeated the same slow request
 * (ADR-0024, kept by ADR-0054).
 */
export async function* streamWithRetry(
  svc: TurnServices,
  open: (req: GenerationRequest) => AsyncGenerator<ProviderEvent>,
  request: GenerationRequest,
): AsyncGenerator<ProviderEvent> {
  let attempt = 0;
  let overflowRetried = false;
  let currentRequest = request;
  for (;;) {
    let firstEventReceived = false;
    // Stage 15 ER-2b: "before the first token" means before any visible or side-effecting step
    // of the attempt: text, code, thinking shown, a visual being drawn, or a tool call.
    let userVisibleOutputEmitted = false;
    let toolRan = false;
    const attemptStartedAt = Date.now();
    try {
      // A Stop that landed before this attempt began (while history or files were still
      // loading) must not run the turn anyway.
      if (currentRequest.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      for await (const event of open(currentRequest)) {
        if (!firstEventReceived) {
          firstEventReceived = true;
          log.info({ ttftMs: Date.now() - attemptStartedAt, attempt }, 'provider first event');
        }
        if (
          (event.type === 'delta' && event.text.length > 0) ||
          (event.type === 'code' && Boolean(event.code || event.output)) ||
          (event.type === 'thinking' && event.text.length > 0) ||
          event.type === 'tool_input_partial'
        ) {
          userVisibleOutputEmitted = true;
        }
        // A call is a step with effects outside the model (a file written, a search run): a
        // retry would run it again, so from here the attempt is never retried.
        if (event.type === 'tool_use' || event.type === 'tool_result') {
          userVisibleOutputEmitted = true;
          toolRan = true;
        }
        yield event;
      }
      return;
    } catch (err) {
      if (currentRequest.signal.aborted) throw err;
      // Check who aborted, not the error's shape: the caller did not, so an abort here is a
      // provider-side timeout, typed and retryable, never stored as the user pressing Stop.
      if (isAbort(err)) {
        err = new ProviderError(`Provider request aborted without a cancel: ${String(err)}`, {
          code: 'provider_timeout',
          retryable: true,
        });
      }

      // Context Overflow Recovery with Streaming Safety Rule:
      // Retry is allowed strictly if no user-visible assistant output has been committed/emitted (userVisibleOutputEmitted === false).
      // If partial output was emitted, do not silently restart and duplicate content.
      if (!userVisibleOutputEmitted && isContextOverflowError(err)) {
        if (!overflowRetried) {
          overflowRetried = true;
          log.warn(
            { err: String(err) },
            'provider context overflow detected; attempting single bounded history reduction retry',
          );

          const reducedHistory = reduceHistoryForOverflow(currentRequest.history);
          const hasHydratedHistorical = currentRequest.history.some((t) =>
            t.attachments?.some((a) => Boolean(a.base64 || a.pages)),
          );

          if (reducedHistory.length < currentRequest.history.length || hasHydratedHistorical) {
            currentRequest = {
              ...currentRequest,
              history: reducedHistory,
            };
            continue;
          }
        }
        throw new ProviderError(
          'Conversation exceeded usable model context and could not be recovered after trimming',
          { code: 'context_overflow', retryable: false },
        );
      }

      if (isContextOverflowError(err)) {
        throw new ProviderError(
          'Conversation exceeded usable model context and could not be recovered after trimming',
          { code: 'context_overflow', retryable: false },
        );
      }

      const retryable = isRetryableProviderError(err);
      // A failure a retry would have answered, after a tool ran: the tool is not run twice; the
      // turn ends with what it has, marked partial (ER-2b, ADR-0072).
      if (retryable && toolRan) throw new FailedAfterToolRun(err as ProviderError);
      if (userVisibleOutputEmitted || !retryable || attempt >= svc.cfg.PROVIDER_MAX_RETRIES) throw err;
      const delay = retryDelayMs(attempt + 1, (err as ProviderError).retryAfterMs, svc.cfg);
      if (delay === null) throw err;
      attempt += 1;
      log.warn({ attempt, delay, err: String(err) }, 'retrying provider call');
      await sleep(delay, currentRequest.signal);
    }
  }
}

export function reduceHistoryForOverflow(history: Turn[]): Turn[] {
  if (history.length === 0) return [];
  // Drop oldest half of completed history turns, keeping at least the most recent turn
  const keepCount = Math.max(1, Math.floor(history.length / 2));
  // API safety: history must start with a user turn. Walk back to the user turn that opened the
  // kept exchange rather than forward past it: walking forward from a lone assistant reply kept
  // the reply and dropped the question and its files.
  let start = history.length - keepCount;
  while (start > 0 && history[start]!.role !== 'user') start--;
  const slice = history.slice(start);

  // Dehydrate any remaining historical binary attachments in the kept turns (preserve text and metadata)
  return slice.map((turn) => {
    if (!turn.attachments || turn.attachments.length === 0) return turn;
    return {
      ...turn,
      attachments: turn.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        storageKey: a.storageKey,
        extractedText: a.extractedText,
      })),
    };
  });
}

export function isContextOverflowError(err: unknown): boolean {
  if (err instanceof ProviderError && err.code === 'context_overflow') return true;
  const str = String(err).toLowerCase();
  return (
    str.includes('input token count exceeds the maximum') ||
    str.includes('token count exceeds') ||
    str.includes('prompt is too long') ||
    str.includes('maximum context length') ||
    str.includes('context_length_exceeded') ||
    str.includes('exceeds the context window')
  );
}

/**
 * A transient provider failure after a tool already ran in the attempt (Stage 15 ER-2b). The
 * retry gate never retries it, since a retry would run the tool again; the turn ends partial.
 */
export class FailedAfterToolRun extends Error {
  constructor(readonly failure: ProviderError) {
    super(`Provider failed after a tool ran: ${failure.message}`);
    this.name = 'FailedAfterToolRun';
  }
}

/** G13: a provider refusal as the typed error the client switches on. */
export function refusalError(event: { category: string | null; explanation: string | null }): ApiError {
  const why = event.explanation ?? (event.category ? `Category: ${event.category}.` : null);
  return new ApiError('model_refused', {
    ...(why ? { detail: `The model declined to answer. ${why}` } : {}),
    meta: { category: event.category },
  });
}

export function isTurnDeadline(reason: unknown): reason is ApiError {
  return reason instanceof ApiError && reason.code === 'turn_deadline_exceeded';
}

/**
 * An abort with a typed reason: the turn deadline, a server shutdown, or a lost lease (ADR-0078).
 * Such a turn ends as an error with that code, never as a user's Stop.
 */
export function isTypedStop(reason: unknown): reason is ApiError {
  return reason instanceof ApiError && (reason.code === 'turn_deadline_exceeded' || reason.code === 'server_shutdown' || reason.code === 'interrupted');
}

export function mapProviderError(err: unknown): { code: string; title: string; detail: string } {
  if (err instanceof ModelNotFoundError) {
    return {
      code: 'model_unavailable',
      title: 'This model is unavailable',
      detail:
        `The model "${err.modelId}" was not found in "${err.location}". It may not be ` +
        'enabled for this project, or the configured region may not serve it.',
    };
  }
  if (err instanceof ApiError) {
    return { code: err.code, title: err.title, detail: err.detail };
  }
  if (err instanceof ProviderError) {
    const rawMessage = err.message || '';
    if (
      err.code === 'context_overflow' ||
      rawMessage.includes('input token count exceeds the maximum') ||
      rawMessage.includes('token count exceeds') ||
      rawMessage.includes('prompt is too long') ||
      rawMessage.includes('exceeds the maximum context length') ||
      rawMessage.includes('context_length_exceeded')
    ) {
      const api = new ApiError('context_overflow');
      return { code: api.code, title: api.title, detail: api.detail };
    }
    if (
      rawMessage.includes('image exceeds 5 MB maximum') ||
      rawMessage.includes('exceeds 5 MB') ||
      rawMessage.includes('image exceeds') ||
      rawMessage.includes('request payload size exceeds')
    ) {
      const api = new ApiError('provider_payload_limit');
      return {
        code: 'provider_payload_limit',
        title: 'Image exceeds provider 5 MB limit',
        detail:
          'This image exceeds the selected model\'s 5 MB image limit. ' +
          'Upload a smaller image or select Gemini 3.8 Flash, which supports larger files.',
      };
    }
    const api = new ApiError(err.code);
    return { code: err.code, title: api.title, detail: api.detail };
  }
  const errStr = String(err);
  if (
    errStr.includes('input token count exceeds the maximum') ||
    errStr.includes('token count exceeds') ||
    errStr.includes('prompt is too long') ||
    errStr.includes('exceeds the maximum context length') ||
    errStr.includes('context_length_exceeded')
  ) {
    const api = new ApiError('context_overflow');
    return { code: api.code, title: api.title, detail: api.detail };
  }
  if (errStr.includes('image exceeds 5 MB') || errStr.includes('exceeds 5 MB maximum')) {
    return {
      code: 'provider_payload_limit',
      title: 'Image exceeds provider 5 MB limit',
      detail:
        'This image exceeds the selected model\'s 5 MB image limit. ' +
        'Upload a smaller image or select Gemini 3.8 Flash, which supports larger files.',
    };
  }
  const api = new ApiError('provider_error');
  return { code: api.code, title: api.title, detail: api.detail };
}

/**
 * How long retry `attempt` (1-based) waits, or null when the provider asked for longer than the
 * matrix allows (ER-2: Retry-After honoured up to N-42 10 s). Full jitter spreads a burst of
 * failed requests so they do not retry in lockstep and re-create the spike that caused them.
 */
export function retryDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  cfg: Pick<Config, 'PROVIDER_RETRY_BASE_MS' | 'PROVIDER_RETRY_MAX_BACKOFF_MS' | 'PROVIDER_RETRY_AFTER_MAX_MS'>,
  random: () => number = Math.random,
): number | null {
  if (retryAfterMs !== undefined && retryAfterMs > cfg.PROVIDER_RETRY_AFTER_MAX_MS) return null;
  const ceiling = Math.min(cfg.PROVIDER_RETRY_MAX_BACKOFF_MS, cfg.PROVIDER_RETRY_BASE_MS * 2 ** (attempt - 1));
  const backoff = random() * ceiling;
  return retryAfterMs === undefined ? backoff : Math.max(backoff, retryAfterMs);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** A show_widget call being written: its code so far, titled by its first loading message. */
export function visualDrafts(input: Record<string, unknown>, callKey: string): { draftId: string; title: string; html: string }[] {
  if (typeof input.widget_code !== 'string') return [];
  const loading = Array.isArray(input.loading_messages) ? input.loading_messages.find((m) => typeof m === 'string') : undefined;
  const title = typeof loading === 'string' ? loading : typeof input.title === 'string' ? input.title : '';
  return [{ draftId: `${callKey}:0`, title, html: input.widget_code }];
}
