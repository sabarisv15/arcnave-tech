/**
 * The retry budget of this instance (Stage 15 ER-13 / EH20, SRE "per-client retry budget < 10 %";
 * N-47; ADR-0081).
 *
 * Of the provider calls this instance started within the window, at most RETRY_BUDGET_RATIO may
 * be retries. When the budget is spent the gateway stops retrying and goes to the next model of
 * the chain (M-30), so a provider outage does not turn into a retry storm. `minReserve` retries
 * are always allowed in the window (ours, RETRY_BUDGET_MIN_RESERVE, default 2: without it the very
 * first failures of a quiet instance, 1 call and 10 % of it, could never be retried at all).
 *
 * The window is N-47's breaker window (ours: N-47 names no window for the budget).
 */
export class RetryBudget {
  private calls: number[] = [];
  private retries: number[] = [];

  constructor(
    private readonly ratio: number,
    private readonly minReserve: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(): void {
    const from = this.now() - this.windowMs;
    this.calls = this.calls.filter((t) => t > from);
    this.retries = this.retries.filter((t) => t > from);
  }

  /** Every attempt, first or retry, is a call. */
  recordCall(): void {
    this.calls.push(this.now());
  }

  /** Takes one retry from the budget; false when it is spent. */
  tryRetry(): boolean {
    this.prune();
    const allowed = Math.max(this.minReserve, Math.floor(this.ratio * this.calls.length));
    if (this.retries.length >= allowed) return false;
    this.retries.push(this.now());
    return true;
  }
}
