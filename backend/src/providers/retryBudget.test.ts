/**
 * The instance retry budget (N-47 10 %, reserve ours) and the E18 token bucket, which ships off
 * (ADR-0081).
 */
import { describe, expect, it } from 'vitest';

import { RateLimiter } from './rateLimiter.js';
import { RetryBudget } from './retryBudget.js';

describe('retry budget (N-47: ≤ 10 % of calls are retries)', () => {
  it('allows the reserve on a quiet instance, then 10 % of the calls in the window', () => {
    let t = 0;
    const budget = new RetryBudget(0.1, 2, 30_000, () => t);
    budget.recordCall();
    expect(budget.tryRetry()).toBe(true);
    expect(budget.tryRetry()).toBe(true);
    expect(budget.tryRetry()).toBe(false);
    for (let i = 0; i < 39; i += 1) budget.recordCall();
    // 40 calls: 4 retries allowed, 2 taken.
    expect(budget.tryRetry()).toBe(true);
    expect(budget.tryRetry()).toBe(true);
    expect(budget.tryRetry()).toBe(false);
    // The window moves on: old calls and retries no longer count.
    t += 30_001;
    budget.recordCall();
    expect(budget.tryRetry()).toBe(true);
  });

  it('with no reserve, a single failed call is not retried (M-30)', () => {
    const budget = new RetryBudget(0.1, 0, 30_000, () => 0);
    budget.recordCall();
    expect(budget.tryRetry()).toBe(false);
  });
});

describe('per-model token bucket (E18)', () => {
  it('is off when no capacity is configured', () => {
    const limiter = new RateLimiter(undefined, () => 0);
    expect(limiter.enabled).toBe(false);
    for (let i = 0; i < 1_000; i += 1) expect(limiter.reserve('Gemini 3.8 Flash')).toBe(0);
  });

  it('when set, takes a token per call and says how long the next one waits', () => {
    let t = 0;
    const limiter = new RateLimiter(60, () => t);
    for (let i = 0; i < 60; i += 1) expect(limiter.reserve('Gemini 3.8 Flash')).toBe(0);
    expect(limiter.reserve('Gemini 3.8 Flash')).toBe(1_000);
    // Another model has its own bucket.
    expect(limiter.reserve('Sonnet 5.5')).toBe(0);
    t += 2_000;
    expect(limiter.reserve('Gemini 3.8 Flash')).toBe(0);
  });

  it('a refused wait (above the cap) takes no token, so later calls are not delayed (review R8)', () => {
    let t = 0;
    const limiter = new RateLimiter(60, () => t);
    for (let i = 0; i < 60; i += 1) expect(limiter.reserve('Gemini 3.8 Flash', 500)).toBe(0);
    // Ten refusals: each would wait 1 s, above the 500 ms cap.
    for (let i = 0; i < 10; i += 1) expect(limiter.reserve('Gemini 3.8 Flash', 500)).toBeGreaterThan(500);
    // One second later one token has refilled: the next call starts at once.
    t += 1_000;
    expect(limiter.reserve('Gemini 3.8 Flash', 500)).toBe(0);
  });
});
