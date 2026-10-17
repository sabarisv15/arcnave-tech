/**
 * What each kind of provider failure allows (Stage 15 ER-2, ER-13, ER-14; Stage 7 7.12; ADR-0081).
 *
 * The adapters classify a failure into one closed `FailureKind` (types.ts); this table is the one
 * place that says what the kind permits: a retry on the same model (ER-2, before the first
 * visible step only), a hop to the next model of the fallback chain (7.12, OQ-02 A: always with a
 * visible label), a count against the model's circuit breaker (ER-13), and whether every other
 * model of the same provider is skipped for the rest of the turn (a spend cap or a credential
 * failure is the account's, not the model's: Stage 21 doc-sync 2026-10-12).
 */
import type { FailureKind } from './types.js';
import { isAbort, ProviderError } from './types.js';

export interface FailurePolicy {
  /** ER-2: retried on the same model, before the first visible step. */
  retry: boolean;
  /** 7.12: the next model of the chain may answer, with a label. */
  fallback: boolean;
  /** ER-13: counted as a failure by the model's breaker. */
  breaker: boolean;
  /** Every model of the same provider is skipped for the rest of the turn. */
  skipProvider: boolean;
}

export const FAILURE_POLICY: Readonly<Record<FailureKind, FailurePolicy>> = {
  transient: { retry: true, fallback: true, breaker: true, skipProvider: false },
  timeout: { retry: true, fallback: true, breaker: true, skipProvider: false },
  // ER-2g: no retry loop on a zero quota; one breaker failure, then the next model.
  quota: { retry: false, fallback: true, breaker: true, skipProvider: false },
  // 403 / 404: this model, not the account.
  config: { retry: false, fallback: true, breaker: true, skipProvider: false },
  // 401: the account's key; counted by the breaker (doc-sync 2026-10-12).
  credentials: { retry: false, fallback: true, breaker: true, skipProvider: true },
  // Spend cap / workspace limit / billing: every Claude row skipped, not counted.
  claude_limit: { retry: false, fallback: true, breaker: false, skipProvider: true },
  // 400 / 413: the request itself; another model would get the same request.
  request_rejected: { retry: false, fallback: false, breaker: false, skipProvider: false },
  // SD-9b / 7.12: a safety block or refusal never falls back.
  blocked: { retry: false, fallback: false, breaker: false, skipProvider: false },
  // M-12: one history cut on the same model (gateway), never a hop.
  context_overflow: { retry: false, fallback: false, breaker: false, skipProvider: false },
  cancelled: { retry: false, fallback: false, breaker: false, skipProvider: false },
};

/** The kind of any thrown value. An error no adapter classified is never retried or hopped over. */
export function kindOf(err: unknown): FailureKind {
  if (err instanceof ProviderError) return err.kind;
  if (isAbort(err)) return 'cancelled';
  return 'request_rejected';
}

/**
 * Why a turn moved to another model, as stored on the message (`messages.fallback_reason`,
 * varchar 32) and sent in `model_switch` / `done.fallback`. Machine-readable (Invariant 5); the
 * client words the label.
 */
export const FALLBACK_REASONS = [
  'unavailable',
  'timeout',
  'quota',
  'config',
  'credentials',
  'claude_limit',
  'breaker_open',
  'disabled',
] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

export function fallbackReasonFor(kind: FailureKind): FallbackReason {
  switch (kind) {
    case 'timeout':
      return 'timeout';
    case 'quota':
      return 'quota';
    case 'config':
      return 'config';
    case 'credentials':
      return 'credentials';
    case 'claude_limit':
      return 'claude_limit';
    default:
      return 'unavailable';
  }
}
