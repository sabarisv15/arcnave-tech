/**
 * Provider loop: the typed errors a provider failure becomes, for the turn. The retry, the
 * context-overflow cut and the fallback chain moved to `providers/gateway.ts` (P11, ADR-0081:
 * retries live in the gateway only, D3 A-07); their helpers are re-exported here so earlier
 * imports keep working.
 */
import { ApiError } from '../../errors.js';
import { ModelNotFoundError, ProviderError } from '../../providers/types.js';

export { FailedAfterToolRun, isContextOverflowError, reduceHistoryForOverflow, retryDelayMs } from '../../providers/gateway.js';

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

/** A show_widget call being written: its code so far, titled by its first loading message. */
export function visualDrafts(input: Record<string, unknown>, callKey: string): { draftId: string; title: string; html: string }[] {
  if (typeof input.widget_code !== 'string') return [];
  const loading = Array.isArray(input.loading_messages) ? input.loading_messages.find((m) => typeof m === 'string') : undefined;
  const title = typeof loading === 'string' ? loading : typeof input.title === 'string' ? input.title : '';
  return [{ draftId: `${callKey}:0`, title, html: input.widget_code }];
}
