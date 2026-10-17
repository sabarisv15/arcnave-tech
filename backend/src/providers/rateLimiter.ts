/**
 * A token bucket per model (Stage 4 E18; ADR-0081), in front of every provider attempt.
 *
 * Ships off: `PROVIDER_RATE_LIMIT_PER_MINUTE` unset means no limit. The register has no capacity
 * for it (OWNER ITEM, docs/ops/p11-result.md), so no number is invented here. When set, each model
 * gets a bucket of that many calls refilled evenly over a minute; an attempt that finds it empty
 * waits for the next token. The gateway bounds the wait by N-42's Retry-After cap and treats a
 * longer one as a transient failure, so the turn moves to the next model instead of queueing.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly perMinute: number | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.perMinute !== undefined && this.perMinute > 0;
  }

  /**
   * Milliseconds to wait before a call to `key` may start; 0 means a token was taken now. A wait
   * above `maxWaitMs` is refused and takes no token, so refusals do not drive the bucket negative
   * and delay the calls that are admitted later (review R8).
   */
  reserve(key: string, maxWaitMs = Number.POSITIVE_INFINITY): number {
    if (!this.enabled) return 0;
    const capacity = this.perMinute!;
    const perMs = capacity / 60_000;
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + (now - b.at) * perMs);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    const wait = Math.ceil((1 - b.tokens) / perMs);
    if (wait > maxWaitMs) return wait;
    // The awaited token is taken now, so two waiters do not share one.
    b.tokens -= 1;
    return wait;
  }
}
