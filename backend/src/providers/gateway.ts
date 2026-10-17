/**
 * The provider gateway: the only place a model call is retried or handed to another model
 * (Stage 15 ER-1, ER-2, ER-4f, ER-13, ER-14; Stage 7 RT-6 / 7.12; D3 A-07; ADR-0081).
 *
 * The SDKs' own retries stay off (`maxRetries: 0`, Gemini `attempts: 1`), so every attempt is one
 * of these. `call` runs one model: its admission through the breaker and the kill switch, the
 * optional token bucket, the retries of the Stage 15 matrix (only before the attempt's first
 * visible or side-effecting step, ER-2b), the retry budget, the one history cut for a context
 * overflow (M-12), and each attempt's usage (AL-1). `stream` walks the fallback chain on top of
 * it: when a model fails before it showed anything or ran a tool, and its failure kind allows it,
 * the next model of the chain gets the turn, rebuilt for that model (capability stripping,
 * ER-14b), and a `model_switch` event says so. No hop is ever silent (Invariant 1, OQ-02 A).
 *
 * ER-4f: once the turn's deadline has passed, no retry and no hop is started; the turn ends
 * `turn_deadline_exceeded`. ER-4a/b (first-token and stall timers) are not built (OQ-16;
 * ADR-0024 / ADR-0054 keep them off); `onAttempt` is the per-attempt hook they would use.
 */
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { type Admission, CircuitBreaker } from './breaker.js';
import { FAILURE_POLICY, type FallbackReason, fallbackReasonFor, kindOf } from './failures.js';
import { type HopNeeds, nextInChain } from './fallback.js';
import { RateLimiter } from './rateLimiter.js';
import type { ModelEntry } from './registry.js';
import { RetryBudget } from './retryBudget.js';
import {
  type CallRole,
  type CallUsage,
  type GenerationRequest,
  type Provider,
  type ProviderEvent,
  type ProviderUsage,
  type Turn,
  addRequestUsage,
  EMPTY_USAGE,
  isAbort,
  ProviderError,
} from './types.js';

const log = logger.child({ module: 'gateway' });

export type GatewayConfig = Pick<
  Config,
  | 'PROVIDER_MAX_RETRIES'
  | 'PROVIDER_RETRY_BASE_MS'
  | 'PROVIDER_RETRY_MAX_BACKOFF_MS'
  | 'PROVIDER_RETRY_AFTER_MAX_MS'
  | 'FALLBACK_ENABLED'
  | 'BREAKER_FAILURES'
  | 'BREAKER_WINDOW_MS'
  | 'BREAKER_RATIO'
  | 'BREAKER_MIN_CALLS'
  | 'BREAKER_HALF_OPEN_MS'
  | 'MODELS_DISABLED'
  | 'RETRY_BUDGET_RATIO'
  | 'RETRY_BUDGET_MIN_RESERVE'
  | 'PROVIDER_RATE_LIMIT_PER_MINUTE'
>;

/** Time, injectable so the matrix test runs with a fake clock. */
export interface GatewayClock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const realClock: GatewayClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      // A listener added after the signal aborted never fires (mistakes.md 2026-09-25).
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
    }),
};

/** One model the gateway may call: its registry row, its adapter and the request built for it. */
export interface HopTarget {
  entry: ModelEntry;
  provider: Provider;
  request: GenerationRequest;
  /** P13's helper calls never feed the breaker (wave plan §4). Default `chat`. */
  role?: 'chat' | 'helper';
}

/** The usage source of a failed request's row: the provider's partial counts, or none. */
function failedSource(usage: ProviderUsage | undefined): CallUsage['usageSource'] {
  return usage !== undefined && usage.exact ? 'provider_partial' : 'none';
}

export type GatewayEvent =
  | ProviderEvent
  | {
      /** The turn moved to another model (7.12): the label the user sees comes from this. */
      type: 'model_switch';
      from: string;
      to: string;
      reason: FallbackReason;
      /** The next model, with the request rebuilt for it. */
      target: HopTarget;
      /** The failure that caused the hop (the service records a missing model from it). */
      cause: unknown;
    };

/** What one turn tells the gateway besides the first model. */
export interface GatewayTurn {
  signal: AbortSignal;
  /** ER-4f: epoch ms after which no retry and no hop starts. */
  deadlineAt?: number;
  /** What the next model must be able to do (7.12: skip a hop that lacks it). */
  needs?: HopNeeds;
  /** The configured, available models (registry), for the chain. */
  entries?: readonly ModelEntry[];
  /** The service's own checks on a candidate (e.g. code execution). */
  canServe?: (entry: ModelEntry) => boolean;
  /** Rebuilds the turn for another model (capability stripping, ER-14b). Absent = no hop. */
  build?: (entry: ModelEntry) => Promise<HopTarget | null>;
  /**
   * The turn's ledger rows (P22 `CallUsage`, wave plan §4), filled here: the gateway is the one
   * place that knows each request's attempt number and model. One row per provider request:
   * each `call_usage` an adapter reports (a finished or stopped request), one per failed request
   * that reached the provider (`provider_partial` from `failedRequestUsage`, else `none` with
   * zeros), and one from `completed` for an adapter that reports no per-request usage. A model
   * the breaker or the kill switch refused made no request and has no row.
   */
  calls?: CallUsage[];
  /** The role of this stream's rows (`answer` by default; `forced_answer` for the forced answer). */
  callRole?: CallRole;
  /** Called as each attempt starts: the seam for ER-4a/b timers (OQ-16, not built). */
  onAttempt?: (info: { alias: string; attempt: number }) => void;
}

/** A model the breaker or the kill switch refused: no call was made (M-29). */
export class NotAdmitted extends ProviderError {
  constructor(
    readonly alias: string,
    readonly reason: 'breaker_open' | 'disabled',
  ) {
    super(`Model "${alias}" was not called: ${reason === 'disabled' ? 'it is switched off' : 'its circuit breaker is open'}`, {
      code: 'model_unavailable',
      kind: 'config',
    });
    this.name = 'NotAdmitted';
  }
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

/** ER-2b: a step the user saw, or one with effects outside the model. */
function isVisible(event: ProviderEvent): boolean {
  return (
    (event.type === 'delta' && event.text.length > 0) ||
    (event.type === 'code' && Boolean(event.code || event.output)) ||
    (event.type === 'thinking' && event.text.length > 0) ||
    event.type === 'tool_input_partial' ||
    event.type === 'tool_use' ||
    event.type === 'tool_result'
  );
}

export class ProviderGateway {
  readonly breaker: CircuitBreaker;
  readonly retryBudget: RetryBudget;
  readonly rateLimiter: RateLimiter;
  private readonly clock: GatewayClock;
  private readonly random: () => number;

  constructor(
    private readonly cfg: GatewayConfig,
    deps: Partial<{ breaker: CircuitBreaker; retryBudget: RetryBudget; rateLimiter: RateLimiter; clock: GatewayClock; random: () => number }> = {},
  ) {
    this.clock = deps.clock ?? realClock;
    const now = () => this.clock.now();
    this.random = deps.random ?? Math.random;
    this.breaker =
      deps.breaker ??
      new CircuitBreaker(
        {
          failures: cfg.BREAKER_FAILURES,
          windowMs: cfg.BREAKER_WINDOW_MS,
          ratio: cfg.BREAKER_RATIO,
          minCalls: cfg.BREAKER_MIN_CALLS,
          halfOpenMs: cfg.BREAKER_HALF_OPEN_MS,
        },
        cfg.MODELS_DISABLED,
        now,
      );
    this.retryBudget = deps.retryBudget ?? new RetryBudget(cfg.RETRY_BUDGET_RATIO, cfg.RETRY_BUDGET_MIN_RESERVE, cfg.BREAKER_WINDOW_MS, now);
    this.rateLimiter = deps.rateLimiter ?? new RateLimiter(cfg.PROVIDER_RATE_LIMIT_PER_MINUTE, now);
  }

  /** ER-4f: past the deadline nothing new starts. */
  private checkDeadline(turn: GatewayTurn, extraMs = 0): void {
    if (turn.deadlineAt !== undefined && this.clock.now() + extraMs >= turn.deadlineAt) {
      throw new ApiError('turn_deadline_exceeded');
    }
  }

  /**
   * One model: retries per the Stage 15 matrix, the context-overflow cut, breaker admissions,
   * and the attempts' usage. Throws the last failure, with `partialUsage` summed over this model's
   * failed attempts.
   */
  async *call(target: HopTarget, turn: GatewayTurn): AsyncGenerator<ProviderEvent> {
    const { entry } = target;
    const role = target.role ?? 'chat';
    const providerModelId = target.request.providerModelId;
    let attempt = 0;
    // Requests sent to this model in this call, 1-based: the ledger's `attempt` (a retry and the
    // context-overflow re-send each count).
    let sent = 0;
    const callRole: CallRole = turn.callRole ?? 'answer';
    const row = (c: Omit<CallUsage, 'ordinal' | 'attempt' | 'role' | 'providerModelId' | 'provider'>): void => {
      if (!turn.calls) return;
      turn.calls.push({ ordinal: turn.calls.length + 1, attempt: sent, role: callRole, providerModelId, provider: entry.provider, ...c });
    };
    let overflowRetried = false;
    let request = target.request;
    // The usage the failed attempts of this model reported; null when none reported any.
    let partial: ProviderUsage | null = null;
    const withPartial = <E>(err: E): E => {
      if (err instanceof ProviderError && partial !== null) err.partialUsage = partial;
      if (err instanceof FailedAfterToolRun && partial !== null) err.failure.partialUsage = partial;
      return err;
    };

    for (;;) {
      // A Stop that landed before this attempt began (while history or files were still
      // loading) must not run the turn anyway.
      if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      this.checkDeadline(turn);

      let admission: Admission | null = null;
      if (role !== 'helper') {
        const admitted = this.breaker.admit(entry.alias, providerModelId);
        if (!admitted.ok) throw withPartial(new NotAdmitted(entry.alias, admitted.reason));
        admission = admitted.admission;
      }
      const wait = this.rateLimiter.reserve(entry.alias);
      if (wait > this.cfg.PROVIDER_RETRY_AFTER_MAX_MS) {
        admission?.release();
        throw withPartial(new ProviderError(`Local rate limit for "${entry.alias}" is full`, { kind: 'transient', retryAfterMs: wait }));
      }
      if (wait > 0) {
        try {
          await this.clock.sleep(wait, request.signal);
        } catch (err) {
          admission?.release();
          throw err;
        }
      }

      this.retryBudget.recordCall();
      turn.onAttempt?.({ alias: entry.alias, attempt });
      sent += 1;
      const startedAt = this.clock.now();
      // Wall time for the ledger's partition key; the injected clock only measures durations.
      const sentAt = new Date();
      // Per-request rows the adapter reported in this attempt.
      let reported = 0;
      let ttftMs: number | undefined;
      let visible = false;
      let toolRan = false;
      try {
        for await (const raw of target.provider.stream(request)) {
          if (ttftMs === undefined) {
            ttftMs = this.clock.now() - startedAt;
            log.info({ ttftMs, attempt }, 'provider first event');
          }
          if (isVisible(raw)) visible = true;
          // A call is a step with effects outside the model (a file written, a search run): a
          // retry would run it again, so from here the attempt is never retried.
          if (raw.type === 'tool_use' || raw.type === 'tool_result') toolRan = true;
          let event = raw;
          if (raw.type === 'call_usage') {
            // One source per request: the adapter's own report of a finished or stopped request.
            reported += 1;
            row({
              usage: raw.usage,
              usageSource: raw.usageSource,
              finishReason: raw.finishReason,
              ...(raw.providerRef ? { providerRef: raw.providerRef } : {}),
              ...(raw.ttftMs !== undefined ? { ttftMs: raw.ttftMs } : {}),
              ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs } : {}),
              startedAt: new Date(Date.now() - (raw.durationMs ?? 0)),
            });
          }
          if (raw.type === 'completed') {
            // An adapter that reports only the whole call: that total is this attempt's one row.
            if (reported === 0) {
              row({
                usage: raw.usage,
                usageSource: raw.usage.exact ? 'provider' : 'none',
                finishReason: raw.finishReason,
                ...(ttftMs !== undefined ? { ttftMs } : {}),
                durationMs: this.clock.now() - startedAt,
                startedAt: sentAt,
              });
            }
            reported = 0;
            // AL-1: the failed attempts of this model were billed too.
            if (partial !== null) event = { ...raw, usage: addRequestUsage(partial, raw.usage) };
          }
          yield event;
        }
        admission?.success();
        return;
      } catch (thrown) {
        let err = thrown;
        const cancelled = request.signal.aborted;
        // Check who aborted, not the error's shape: the caller did not, so an abort here is a
        // provider-side timeout, typed and retryable, never stored as the user pressing Stop.
        if (!cancelled && isAbort(err)) {
          err = new ProviderError(`Provider request aborted without a cancel: ${String(err)}`, { code: 'provider_timeout', kind: 'timeout' });
        }
        const kind = cancelled ? 'cancelled' : kindOf(err);
        if (FAILURE_POLICY[kind].breaker) admission?.failure();
        else admission?.release();

        const failure = err instanceof FailedAfterToolRun ? err.failure : err instanceof ProviderError ? err : undefined;
        // A stop: the adapter already reported the request in flight (`provider_partial`). Any
        // other failure of a request that was sent gets its own row; NotAdmitted and the local
        // rate limit never reach this point. The failed request's own counts only: the earlier
        // rounds of this attempt each reported a `call_usage` already.
        if (!cancelled) {
          const own = failure?.failedRequestUsage;
          row({
            usage: own !== undefined && own.exact ? own : EMPTY_USAGE,
            usageSource: failedSource(own),
            finishReason: 'error',
            ...(ttftMs !== undefined ? { ttftMs } : {}),
            durationMs: this.clock.now() - startedAt,
            startedAt: sentAt,
          });
        }
        const reportedUsage = failure?.partialUsage;
        // Undefined: the request failed before its stream opened, so nothing was billed.
        if (reportedUsage !== undefined) partial = addRequestUsage(partial, reportedUsage);
        if (cancelled) throw withPartial(err);

        if (kind === 'quota') {
          // M-19: a zero quota is configuration; one coded ERROR line per failed call.
          log.error({ code: 'provider_quota_zero', alias: entry.alias }, 'model has no quota; not retried');
        }

        // M-12: one bounded history cut, only before anything was shown.
        if (isContextOverflowError(err)) {
          if (!visible && !overflowRetried) {
            overflowRetried = true;
            log.warn({ code: 'context_overflow_cut', alias: entry.alias }, 'context overflow; one history reduction');
            const reducedHistory = reduceHistoryForOverflow(request.history);
            const hydrated = request.history.some((t) => t.attachments?.some((a) => Boolean(a.base64 || a.pages)));
            if (reducedHistory.length < request.history.length || hydrated) {
              request = { ...request, history: reducedHistory };
              continue;
            }
          }
          throw withPartial(
            new ProviderError('Conversation exceeded usable model context and could not be recovered after trimming', {
              code: 'context_overflow',
              retryable: false,
            }),
          );
        }

        const retryable = err instanceof ProviderError && err.retryable;
        // A failure a retry would have answered, after a tool ran: the tool is not run twice; the
        // turn ends with what it has, marked partial (ER-2b, ADR-0072).
        if (retryable && toolRan) throw withPartial(new FailedAfterToolRun(err as ProviderError));
        if (visible || !retryable || attempt >= this.cfg.PROVIDER_MAX_RETRIES) throw withPartial(err);
        const delay = retryDelayMs(attempt + 1, (err as ProviderError).retryAfterMs, this.cfg, this.random);
        // M-03: a Retry-After above N-42's cap is not waited for: straight to the next model.
        if (delay === null) throw withPartial(err);
        this.checkDeadline(turn, delay);
        if (!this.retryBudget.tryRetry()) {
          // M-30: the instance's retry budget is spent; the next model, not another try.
          log.warn({ code: 'retry_budget_spent', alias: entry.alias }, 'retry budget spent; not retried');
          throw withPartial(err);
        }
        attempt += 1;
        log.warn({ code: 'provider_retry', alias: entry.alias, attempt, delay, kind }, 'retrying provider call');
        await this.clock.sleep(delay, request.signal);
      }
    }
  }

  /**
   * The labelled fallback chain over `call`. A hop happens only when the failed model showed
   * nothing and ran no tool, its failure kind allows one, fallback is on, the deadline has not
   * passed, and a next model can take the turn; otherwise the failure goes to the caller.
   */
  async *stream(first: HopTarget, turn: GatewayTurn): AsyncGenerator<GatewayEvent> {
    let target = first;
    const origin = first.entry.alias;
    const tried = new Set<string>([origin]);
    const skipProviders = new Set<ModelEntry['provider']>();
    // Usage reported by a model the turn then left: it is priced at another rate than the model
    // that answers, so the `completed` event's one total cannot be called exact (Invariant 3).
    // The turn's usage row does not read that total: it is the sum of `turn.calls`, each row
    // with its own model and price (P22 + P11 merge).
    let mixedModels = false;

    for (;;) {
      let shown = false;
      try {
        for await (const event of this.call(target, turn)) {
          if (isVisible(event)) shown = true;
          yield mixedModels && event.type === 'completed' ? { ...event, usage: EMPTY_USAGE } : event;
        }
        return;
      } catch (err) {
        if (mixedModels && err instanceof ProviderError) err.partialUsage = EMPTY_USAGE;
        if (turn.signal.aborted || shown || err instanceof FailedAfterToolRun || !turn.build) throw err;
        const kind = kindOf(err);
        const notAdmitted = err instanceof NotAdmitted;
        if (!this.cfg.FALLBACK_ENABLED || !(notAdmitted || FAILURE_POLICY[kind].fallback)) throw err;
        this.checkDeadline(turn);
        if (!notAdmitted && FAILURE_POLICY[kind].skipProvider) skipProviders.add(target.entry.provider);
        const reason: FallbackReason = notAdmitted ? err.reason : fallbackReasonFor(kind);

        let next: HopTarget | null = null;
        for (;;) {
          const candidate = nextInChain({
            origin,
            tried,
            skipProviders,
            needs: turn.needs ?? { vision: false, grounding: false },
            entries: turn.entries ?? [],
            admissible: (e) => this.breaker.wouldAdmit(e.alias, e.providerModelId).ok && (turn.canServe?.(e) ?? true),
          });
          if (!candidate) break;
          tried.add(candidate.alias);
          next = await turn.build(candidate);
          if (next) break;
        }
        if (!next) throw err;
        if (err instanceof ProviderError && err.partialUsage !== undefined) mixedModels = true;
        log.warn({ code: 'model_fallback', from: target.entry.alias, to: next.entry.alias, reason }, 'model failed before answering; next model of the chain');
        yield { type: 'model_switch', from: target.entry.alias, to: next.entry.alias, reason, target: next, cause: err };
        target = next;
      }
    }
  }
}

/* -------------------------------------------------------------------------- moved helpers */

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
