/**
 * Budget periods and cost.
 *
 * The timezone arithmetic is the part most likely to be quietly wrong: a budget that resets at
 * UTC midnight resets in the middle of the afternoon for half the world, and a DST boundary
 * moves the wall-clock midnight by an hour. These pin both down.
 */
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import type { ProviderUsage } from '../providers/types.js';
import { computeCost, nextReset, periodBounds, resolveZone } from './usage.js';

const usage = (over: Partial<ProviderUsage> = {}): ProviderUsage => ({
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  exact: true,
  ...over,
});

describe('resolveZone', () => {
  it('accepts a real IANA zone', () => {
    expect(resolveZone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('falls back to UTC for nonsense rather than throwing', () => {
    expect(resolveZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(resolveZone('')).toBe('UTC');
  });
});

describe('periodBounds', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // 18:30 UTC on the 14th is 00:00 on the 15th in Kolkata (UTC+5:30), so the local day has
    // just begun and the day boundary is that instant.
    const at = new Date('2026-03-14T18:30:00Z');
    const { dayStart } = periodBounds(at, 'Asia/Kolkata');
    expect(dayStart.toISOString()).toBe('2026-03-14T18:30:00.000Z');
  });

  it('puts the month boundary at local midnight on the first', () => {
    const { monthStart } = periodBounds(new Date('2026-03-14T18:30:00Z'), 'Asia/Kolkata');
    expect(monthStart.toISOString()).toBe('2026-02-28T18:30:00.000Z');
  });

  it('is plain midnight UTC for UTC', () => {
    const { dayStart, monthStart } = periodBounds(new Date('2026-03-14T18:30:00Z'), 'UTC');
    expect(dayStart.toISOString()).toBe('2026-03-14T00:00:00.000Z');
    expect(monthStart.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('lands on local midnight either side of a DST transition', () => {
    // US DST began 2026-03-08. Before the change New York is UTC-5, after it UTC-4, so the
    // same local midnight is a different UTC instant on either side of the boundary.
    const before = periodBounds(new Date('2026-03-07T12:00:00Z'), 'America/New_York');
    const after = periodBounds(new Date('2026-03-10T12:00:00Z'), 'America/New_York');
    expect(before.dayStart.toISOString()).toBe('2026-03-07T05:00:00.000Z');
    expect(after.dayStart.toISOString()).toBe('2026-03-10T04:00:00.000Z');
  });
});

describe('nextReset', () => {
  it('rolls to tomorrow within a month', () => {
    const { nextDay } = nextReset(new Date('2026-03-14T10:00:00Z'), 'UTC');
    expect(nextDay.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('rolls the last day of a month into the first of the next', () => {
    const { nextDay, nextMonth } = nextReset(new Date('2026-02-28T10:00:00Z'), 'UTC');
    expect(nextDay.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(nextMonth.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('rolls 31 December into 1 January', () => {
    const { nextDay, nextMonth } = nextReset(new Date('2026-12-31T10:00:00Z'), 'UTC');
    expect(nextDay.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(nextMonth.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('handles 29 February in a leap year', () => {
    const { nextDay } = nextReset(new Date('2028-02-29T10:00:00Z'), 'UTC');
    expect(nextDay.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });
});

describe('computeCost', () => {
  const priced = loadConfig({
    NODE_ENV: 'test',
    PRICING_TABLE: JSON.stringify({
      'test-model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    }),
  });
  const unpriced = loadConfig({ NODE_ENV: 'test' });

  it('prices a model that has a table entry', () => {
    expect(computeCost(priced, 'test-model', usage())).toBe(18);
  });

  it('returns null — not zero — for a model with no pricing entry', () => {
    expect(computeCost(priced, 'unknown-model', usage())).toBeNull();
    expect(computeCost(unpriced, 'test-model', usage())).toBeNull();
  });

  it('refuses to price inexact token counts', () => {
    expect(computeCost(priced, 'test-model', usage({ exact: false }))).toBeNull();
  });

  it('prices cache tokens at their own rates', () => {
    const cost = computeCost(
      priced,
      'test-model',
      usage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }),
    );
    expect(cost).toBe(0.3);
  });

  it('is zero, not null, for a priced model that used no tokens', () => {
    const cost = computeCost(priced, 'test-model', usage({ inputTokens: 0, outputTokens: 0 }));
    expect(cost).toBe(0);
  });
});
