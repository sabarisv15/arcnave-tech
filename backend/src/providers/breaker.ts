/**
 * A circuit breaker per model alias, per instance (Stage 15 ER-13, Stage 7 BREAKER; N-47;
 * ADR-0081).
 *
 * Opens after BREAKER_FAILURES counted failures within BREAKER_WINDOW_MS, or when at least
 * BREAKER_RATIO of the last BREAKER_MIN_CALLS outcomes failed. While open, nothing is admitted and
 * the gateway goes to the next model at once (no retries). After BREAKER_HALF_OPEN_MS it is
 * half-open: exactly one trial call is admitted; its success closes the breaker, its failure opens
 * it again for another full period.
 *
 * Every admission is given back exactly once (`success`, `failure` or `release`; later calls on
 * the same admission do nothing), also when the call is cancelled in a retry wait. A call that
 * was admitted before the breaker last opened cannot change a half-open breaker (Stage 21
 * doc-sync 2026-10-11). The kill switch (`MODELS_DISABLED`) overrides the breaker: a disabled
 * model is never admitted, whatever the breaker's state.
 *
 * Kinds the failure table does not count (a spend cap, a block, a rejected request, a cancel)
 * are given back with `release`, which records nothing. Helper calls (role `helper`) never take
 * an admission (P13 contract, wave plan §4).
 */
import { NUMBERS } from '../config/numbers.js';

export interface BreakerSettings {
  /** N-47: failures within the window that open the breaker. */
  failures: number;
  /** N-47: the window for `failures`. */
  windowMs: number;
  /** N-47: failure share over the last `minCalls` outcomes that opens the breaker. */
  ratio: number;
  /** N-47: outcomes the ratio is taken over. */
  minCalls: number;
  /** N-47: open period before one trial call. */
  halfOpenMs: number;
}

export const DEFAULT_BREAKER_SETTINGS: BreakerSettings = {
  failures: NUMBERS.BREAKER_FAILURES.value,
  windowMs: NUMBERS.BREAKER_WINDOW_MS.value,
  ratio: NUMBERS.BREAKER_RATIO.value,
  minCalls: NUMBERS.BREAKER_MIN_CALLS.value,
  halfOpenMs: NUMBERS.BREAKER_HALF_OPEN_MS.value,
};

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface Admission {
  success(): void;
  failure(): void;
  /** Give the admission back without an outcome (an uncounted kind, a cancel). */
  release(): void;
}

export type AdmitResult = { ok: true; admission: Admission } | { ok: false; reason: 'breaker_open' | 'disabled' };

interface Circuit {
  /** Times of counted failures inside the window. */
  failureTimes: number[];
  /** The last `minCalls` outcomes, true = failure. */
  outcomes: boolean[];
  openedAt: number | null;
  /** Bumped every time the breaker opens; an admission from an older generation is late. */
  generation: number;
  trialInFlight: boolean;
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, Circuit>();
  private readonly disabled: Set<string>;

  constructor(
    private readonly settings: BreakerSettings = DEFAULT_BREAKER_SETTINGS,
    disabled: readonly string[] = [],
    private readonly now: () => number = Date.now,
  ) {
    this.disabled = new Set(disabled.map((d) => d.trim().toLowerCase()).filter(Boolean));
  }

  /** The kill switch: an alias or a provider model id named in `MODELS_DISABLED`. */
  isDisabled(alias: string, providerModelId?: string): boolean {
    return this.disabled.has(alias.toLowerCase()) || (providerModelId !== undefined && this.disabled.has(providerModelId.toLowerCase()));
  }

  state(key: string): BreakerState {
    const c = this.circuits.get(key);
    if (!c || c.openedAt === null) return 'closed';
    return this.now() - c.openedAt >= this.settings.halfOpenMs ? 'half_open' : 'open';
  }

  /** Whether a call would be admitted now, without taking an admission. */
  wouldAdmit(key: string, providerModelId?: string): { ok: boolean; reason?: 'breaker_open' | 'disabled' } {
    if (this.isDisabled(key, providerModelId)) return { ok: false, reason: 'disabled' };
    const state = this.state(key);
    if (state === 'open') return { ok: false, reason: 'breaker_open' };
    if (state === 'half_open' && this.circuits.get(key)!.trialInFlight) return { ok: false, reason: 'breaker_open' };
    return { ok: true };
  }

  admit(key: string, providerModelId?: string): AdmitResult {
    if (this.isDisabled(key, providerModelId)) return { ok: false, reason: 'disabled' };
    const c = this.circuit(key);
    const state = this.state(key);
    if (state === 'open') return { ok: false, reason: 'breaker_open' };
    let trial = false;
    if (state === 'half_open') {
      if (c.trialInFlight) return { ok: false, reason: 'breaker_open' };
      c.trialInFlight = true;
      trial = true;
    }
    const generation = c.generation;
    let done = false;
    const settle = (outcome: 'success' | 'failure' | 'release'): void => {
      if (done) return;
      done = true;
      if (trial) c.trialInFlight = false;
      if (outcome === 'release') return;
      this.record(c, generation, trial, outcome === 'failure');
    };
    return {
      ok: true,
      admission: {
        success: () => settle('success'),
        failure: () => settle('failure'),
        release: () => settle('release'),
      },
    };
  }

  private circuit(key: string): Circuit {
    let c = this.circuits.get(key);
    if (!c) {
      c = { failureTimes: [], outcomes: [], openedAt: null, generation: 0, trialInFlight: false };
      this.circuits.set(key, c);
    }
    return c;
  }

  private record(c: Circuit, generation: number, trial: boolean, failed: boolean): void {
    const now = this.now();
    if (c.openedAt !== null) {
      // Open or half-open: only the trial call decides; a late call (admitted before the
      // breaker last opened, or any other call) changes nothing.
      if (!trial || generation !== c.generation) return;
      if (failed) this.open(c, now);
      else this.close(c);
      return;
    }
    if (generation !== c.generation) return;
    c.outcomes.push(failed);
    if (c.outcomes.length > this.settings.minCalls) c.outcomes.shift();
    if (failed) c.failureTimes.push(now);
    c.failureTimes = c.failureTimes.filter((t) => now - t < this.settings.windowMs);
    const failuresInWindow = c.failureTimes.length;
    const share = c.outcomes.length >= this.settings.minCalls ? c.outcomes.filter(Boolean).length / c.outcomes.length : 0;
    if (failuresInWindow >= this.settings.failures || share >= this.settings.ratio) this.open(c, now);
  }

  private open(c: Circuit, now: number): void {
    c.openedAt = now;
    c.generation += 1;
    c.trialInFlight = false;
  }

  private close(c: Circuit): void {
    c.openedAt = null;
    c.failureTimes = [];
    c.outcomes = [];
    c.trialInFlight = false;
  }
}
