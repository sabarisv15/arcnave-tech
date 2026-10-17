/**
 * The price book (N-36, Stage 18 CD-1; ADR-0079), by date: the rates in force, the env JSON the
 * book replaces, no overlapping rows, and an end date that is respected.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { PricingService } from '../services/pricing.js';
import type { ProviderUsage } from '../providers/types.js';
import { PRICE_BOOK, type PriceRow, overlaps, rowAt } from './priceBook.js';

const M = 1_000_000;
const usage = (o: Partial<ProviderUsage> = {}): ProviderUsage => ({
  inputTokens: M,
  outputTokens: M,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  exact: true,
  ...o,
});
const book = new PricingService(loadConfig({ NODE_ENV: 'test' }));

describe('the rates in force, by date', () => {
  const cases: Array<[string, string, Partial<ProviderUsage>, number | null]> = [
    // model, date, usage (1M in + 1M out unless set), dollars
    ['claude-sonnet-5-5', '2026-10-17', {}, 12],
    ['claude-sonnet-5-5', '2026-10-17', { inputTokens: 0, outputTokens: 0, cacheReadTokens: M }, 0.1],
    ['claude-sonnet-5-5', '2026-10-17', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: M }, 2.5],
    ['claude-sonnet-5-5', '2026-10-09', {}, null], // before its first row
    ['claude-opus-5-5', '2026-12-31', {}, 24],
    ['claude-opus-5-5', '2027-06-01', { inputTokens: 0, outputTokens: 0, cacheReadTokens: M, cacheWriteTokens: M }, 5.2],
    ['gemini-3.8-flash', '2026-10-17', {}, 9],
    ['gemini-3.8-flash', '2027-01-02', { inputTokens: 0, outputTokens: 0, cacheReadTokens: M }, 0.15],
    ['gemini-3.8-flash', '2026-10-17', { cacheWriteTokens: 1 }, null], // no cache-write rate: unpriced, not free
    ['claude-haiku-5-5', '2026-10-17', { inputTokens: 30_000, outputTokens: 40 }, 0.00302],
    ['claude-haiku-5-5', '2026-10-17', { inputTokens: 100_001, outputTokens: 0 }, null], // the other rate card
    ['claude-haiku-5-5', '2026-10-17', { inputTokens: 90_000, cacheReadTokens: 20_000, outputTokens: 0 }, null], // prompt > 100K counts the cache
    ['fake-flash', '2026-10-17', {}, null], // a model with no rows
    ['claude-sonnet-5-5', '2026-10-17', { exact: false }, null], // inexact counts are never priced
    ['claude-sonnet-5-5', '2026-10-17', { inputTokens: 0, outputTokens: 0 }, 0], // priced, used nothing: zero, not null
  ];
  it.each(cases)('%s on %s %o costs %s', (model, day, u, dollars) => {
    expect(book.price(model, usage(u), new Date(`${day}T12:00:00Z`)).costUsd).toBe(dollars);
  });

  it('names the rate set it priced with', () => {
    expect(book.price('claude-sonnet-5-5', usage(), new Date('2026-10-17T00:00:00Z')).priceVersion).toBe('claude-sonnet-5-5@2026-10-10');
    expect(book.price('fake-flash', usage(), new Date()).priceVersion).toBeNull();
  });
});

describe('the book matches the env JSON it replaces', () => {
  const line = readFileSync(path.resolve(__dirname, '../../../.env.example'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('PRICING_TABLE='))!;
  const env = JSON.parse(line.slice('PRICING_TABLE='.length)) as Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
  const at = new Date('2026-10-17T00:00:00Z');

  it.each(['claude-sonnet-5-5', 'claude-opus-5-5', 'gemini-3.8-flash'])('%s: input, output and cache read as .env.example', (model) => {
    const rate = (t: PriceRow['tokenType']) => rowAt(PRICE_BOOK, model, t, at)?.usdPerMTok;
    expect(rate('input')).toBe(env[model]!.input);
    expect(rate('output')).toBe(env[model]!.output);
    expect(rate('cache_read')).toBe(env[model]!.cacheRead);
  });

  it('Claude cache writes as .env.example; Gemini, which bills none, has no row instead of a zero', () => {
    expect(rowAt(PRICE_BOOK, 'claude-sonnet-5-5', 'cache_write_5m', at)?.usdPerMTok).toBe(env['claude-sonnet-5-5']!.cacheWrite);
    expect(rowAt(PRICE_BOOK, 'claude-opus-5-5', 'cache_write_5m', at)?.usdPerMTok).toBe(env['claude-opus-5-5']!.cacheWrite);
    expect(rowAt(PRICE_BOOK, 'gemini-3.8-flash', 'cache_write_5m', at)).toBeUndefined();
  });

  it('PRICE_SOURCE=env prices from the env JSON instead', () => {
    const fromEnv = new PricingService(loadConfig({ NODE_ENV: 'test', PRICE_SOURCE: 'env', PRICING_TABLE: line.slice('PRICING_TABLE='.length) }));
    expect(fromEnv.price('claude-sonnet-5-5', usage(), at)).toEqual({ costUsd: 12, priceVersion: 'env' });
    expect(fromEnv.price('claude-haiku-5-5', usage(), at).costUsd).toBeNull();
  });
});

describe('rows in time', () => {
  it('no two rows of one model, token type and tier overlap', () => {
    expect(overlaps(PRICE_BOOK)).toEqual([]);
  });

  it('every row has a source, a version and a non-negative rate', () => {
    for (const r of PRICE_BOOK) {
      expect(r.source.length, r.priceVersion).toBeGreaterThan(0);
      expect(r.usdPerMTok).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(Date.parse(r.effectiveFrom))).toBe(false);
    }
  });

  const dated: PriceRow[] = [
    { providerModelId: 'm', tokenType: 'input', trafficTier: 'standard', usdPerMTok: 1, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2027-01-01T00:00:00Z', priceVersion: 'old', source: 't' },
    { providerModelId: 'm', tokenType: 'input', trafficTier: 'standard', usdPerMTok: 2, effectiveFrom: '2027-01-01T00:00:00Z', effectiveTo: null, priceVersion: 'new', source: 't' },
    { providerModelId: 'm', tokenType: 'output', trafficTier: 'standard', usdPerMTok: 4, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null, priceVersion: 'out', source: 't' },
  ];

  it.each([
    ['2026-12-31T23:59:59.999Z', 'old', 5],
    ['2027-01-01T00:00:00.000Z', 'new', 6], // the end instant belongs to the next row
    ['2025-12-31T00:00:00.000Z', undefined, null],
  ])('at %s the row in force is %s', (at, version, dollars) => {
    expect(rowAt(dated, 'm', 'input', new Date(at))?.priceVersion).toBe(version);
    const p = new PricingService(loadConfig({ NODE_ENV: 'test' }), dated);
    expect(p.price('m', usage(), new Date(at)).costUsd).toBe(dollars);
  });

  it('the overlap check would catch an overlap (negative control)', () => {
    const clash = [...dated, { ...dated[1]!, effectiveFrom: '2026-06-01T00:00:00Z', priceVersion: 'clash' }];
    expect(overlaps(clash).length).toBeGreaterThan(0);
    expect(overlaps(dated)).toEqual([]);
  });
});
