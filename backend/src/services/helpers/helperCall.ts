/**
 * One helper call (ADR-0080): the title job, the summary job and the router shadow all go
 * through here. The helper is Claude Haiku 5.5, a registry row with `role: 'helper'`.
 *
 * Invariant 1: there is no helper fallback. Without a key or an id, or after a real call showed
 * the model missing, the job is skipped with a code, and no other model is called in its place.
 * Thinking is off (N-69, N-77); no cache breakpoint; no SDK retry (the job is simply skipped).
 */
import { HELPER_ALIAS, type ModelEntry, type ModelRegistry } from '../../providers/registry.js';
import { isAbort, ProviderError, type HelperResult, type ProviderUsage, type ReasoningEffort } from '../../providers/types.js';

export type HelperRole = 'title' | 'summary' | 'router';

/**
 * P22 contract (wave plan §4): the per-call usage shape `CallUsage`, built locally until P22's
 * `providers/types.ts` export lands; the orchestrator wires helper calls to `ledger.recordCalls`
 * at merge. Nothing is written ledger-side here.
 */
export interface HelperCallUsage {
  ordinal: number;
  attempt: number;
  role: HelperRole;
  /** The helper registry row's provider: the ledger row names it (review R9). */
  provider: ModelEntry['provider'];
  providerModelId: string;
  usage: ProviderUsage;
  usageSource: 'provider' | 'provider_partial' | 'none';
  finishReason: string;
  providerRef?: string;
  ttftMs?: number;
  durationMs?: number;
}

export type HelperOutcome =
  | { status: 'ok'; result: HelperResult & { value?: unknown }; call: HelperCallUsage }
  | { status: 'skipped'; code: 'helper_unavailable'; reason: string }
  | { status: 'timeout' | 'error'; code: string; call: HelperCallUsage | null };

export interface HelperCallRequest {
  role: HelperRole;
  system: string;
  text: string;
  maxOutputTokens: number;
  timeoutMs: number;
  reasoningEffort?: ReasoningEffort;
  /** Structured output (`classify`); absent: plain text (`complete`). */
  schema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export async function callHelper(registry: ModelRegistry, request: HelperCallRequest): Promise<HelperOutcome> {
  const status = registry.helperStatus(HELPER_ALIAS);
  if (!status || !status.available) {
    return { status: 'skipped', code: 'helper_unavailable', reason: status?.reason ?? 'not_configured' };
  }
  const entry = status.entry;
  const provider = registry.providerFor(entry);
  const call = request.schema ? provider?.classify?.bind(provider) : provider?.complete?.bind(provider);
  if (!provider || !call) return { status: 'skipped', code: 'helper_unavailable', reason: 'no_helper_adapter' };

  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const startedAt = Date.now();
  const usageOf = (result: HelperResult | null): HelperCallUsage => ({
    ordinal: 0,
    attempt: 1,
    role: request.role,
    provider: entry.provider,
    providerModelId: entry.providerModelId!,
    usage: result?.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, exact: false },
    usageSource: result?.usage.exact ? 'provider' : 'none',
    finishReason: result?.finishReason ?? 'error',
    durationMs: Date.now() - startedAt,
  });
  try {
    const args = {
      providerModelId: entry.providerModelId!,
      system: request.system,
      text: request.text,
      maxOutputTokens: request.maxOutputTokens,
      thinking: 'off' as const,
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
      signal,
    };
    const result = request.schema
      ? await provider.classify!({ ...args, schema: request.schema })
      : await provider.complete!(args);
    registry.recordHelperOutcome(HELPER_ALIAS, { available: true });
    return { status: 'ok', result, call: usageOf(result) };
  } catch (err) {
    if (timeout.aborted && !request.signal?.aborted) return { status: 'timeout', code: 'helper_timeout', call: usageOf(null) };
    if (isAbort(err)) return { status: 'error', code: 'cancelled', call: usageOf(null) };
    if (err instanceof ProviderError && err.code === 'model_unavailable') {
      // A missing model or a rejected key: the helper is unavailable until the probe TTL passes.
      registry.recordHelperOutcome(HELPER_ALIAS, { available: false, detail: err.code });
    }
    return { status: 'error', code: err instanceof ProviderError ? err.code : 'helper_error', call: usageOf(null) };
  }
}

/** A string cut to `max` code points (never inside a surrogate pair). */
export function cutCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}
