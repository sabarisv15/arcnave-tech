/**
 * The circuit breaker at the N-47 thresholds (Stage 15 ER-13, Stage 7 BREAKER; ADR-0081), on an
 * injected clock: 5 failures in 30 s open it; so do 10 failures out of the last 20 calls;
 * half-open after 30 s admits exactly one trial; a call admitted before the breaker opened cannot
 * close it; every admission is given back exactly once; the kill switch overrides everything.
 */
import { describe, expect, it } from 'vitest';

import { NUMBERS } from '../config/numbers.js';
import { CircuitBreaker, DEFAULT_BREAKER_SETTINGS } from './breaker.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const admit = (b: CircuitBreaker, key = 'Gemini 3.8 Flash') => {
  const r = b.admit(key);
  if (!r.ok) throw new Error(`not admitted: ${r.reason}`);
  return r.admission;
};

describe('circuit breaker (N-47)', () => {
  it('reads its thresholds from the numbers register', () => {
    expect(DEFAULT_BREAKER_SETTINGS).toEqual({ failures: 5, windowMs: 30_000, ratio: 0.5, minCalls: 20, halfOpenMs: 30_000 });
    expect(NUMBERS.BREAKER_FAILURES.nId).toBe('N-47');
    expect(NUMBERS.RETRY_BUDGET_RATIO.value).toBe(0.1);
  });

  it('opens after 5 failures within 30 s, not after 4, and not when they are spread wider', () => {
    const c = clock();
    const b = new CircuitBreaker(DEFAULT_BREAKER_SETTINGS, [], c.now);
    for (let i = 0; i < 4; i += 1) admit(b).failure();
    expect(b.state('Gemini 3.8 Flash')).toBe('closed');
    admit(b).failure();
    expect(b.state('Gemini 3.8 Flash')).toBe('open');
    expect(b.admit('Gemini 3.8 Flash')).toEqual({ ok: false, reason: 'breaker_open' });

    const spread = new CircuitBreaker(DEFAULT_BREAKER_SETTINGS, [], c.now);
    for (let i = 0; i < 6; i += 1) {
      admit(spread, 'Sonnet 5.5').failure();
      c.advance(10_000);
    }
    // At most 3 failures fall in any 30 s window.
    expect(spread.state('Sonnet 5.5')).toBe('closed');
  });

  it('opens when 10 of the last 20 calls failed, though never 5 inside 30 s', () => {
    const c = clock();
    const b = new CircuitBreaker(DEFAULT_BREAKER_SETTINGS, [], c.now);
    // Alternate success and failure, 7 s apart: 10 failures over 20 calls, ≤ 5 in any 30 s.
    for (let i = 0; i < 19; i += 1) {
      const a = admit(b);
      if (i % 2 === 0) a.failure();
      else a.success();
      c.advance(7_000);
    }
    expect(b.state('Gemini 3.8 Flash')).toBe('closed');
    admit(b).success();
    // 10 failures of the last 20 outcomes: 50 %, reached on the 20th.
    expect(b.state('Gemini 3.8 Flash')).toBe('open');
  });

  it('half-opens after 30 s and admits exactly one trial; its success closes the breaker', () => {
    const c = clock();
    const b = new CircuitBreaker(DEFAULT_BREAKER_SETTINGS, [], c.now);
    for (let i = 0; i < 5; i += 1) admit(b).failure();
    c.advance(29_999);
    expect(b.state('Gemini 3.8 Flash')).toBe('open');
    c.advance(1);
    expect(b.state('Gemini 3.8 Flash')).toBe('half_open');
    const trial = admit(b);
    expect(b.admit('Gemini 3.8 Flash')).toEqual({ ok: false, reason: 'breaker_open' });
    trial.success();
    expect(b.state('Gemini 3.8 Flash')).toBe('closed');
    admit(b).success();
  });

  it('a failed trial opens it again for another full period', () => {
    const c = clock();
    const b = new CircuitBreaker(DEFAULT_BREAKER_SETTINGS, [], c.now);
    for (let i = 0; i < 5; i += 1) admit(b).failure();
    c.advance(30_000);
    admit(b).failure();
    expect(b.state('Gemini 3.8 Flash')).toBe('open');
    c.advance(29_000);
    expect(b.state('Gemini 3.8 Flash')).toBe('open');
    c.advance(1_000);
    expect(b.state('Gemini 3.8 Flash')).toBe('half_open');
  });

  it('a late admission (taken before the breaker opened) cannot close a half-open breaker', () => {
    const c = clock();
    const b = new CircuitBreaker(DEFAULT_BREAKER_SETTINGS, [], c.now);
    const late = admit(b);
    for (let i = 0; i < 5; i += 1) admit(b).failure();
    c.advance(30_000);
    expect(b.state('Gemini 3.8 Flash')).toBe('half_open');
    late.success();
    expect(b.state('Gemini 3.8 Flash')).toBe('half_open');
    // The trial slot is still free: the late call did not take it either.
    const trial = admit(b);
    trial.success();
    expect(b.state('Gemini 3.8 Flash')).toBe('closed');
  });

  it('gives an admission back exactly once; a release counts nothing and frees the trial slot', () => {
    const c = clock();
    const b = new CircuitBreaker(DEFAULT_BREAKER_SETTINGS, [], c.now);
    const a = admit(b);
    a.failure();
    a.failure();
    a.failure();
    a.failure();
    a.failure();
    expect(b.state('Gemini 3.8 Flash')).toBe('closed');
    for (let i = 0; i < 4; i += 1) admit(b).failure();
    expect(b.state('Gemini 3.8 Flash')).toBe('open');
    c.advance(30_000);
    const trial = admit(b);
    trial.release();
    trial.success();
    expect(b.state('Gemini 3.8 Flash')).toBe('half_open');
    admit(b).success();
    expect(b.state('Gemini 3.8 Flash')).toBe('closed');
  });

  it('the kill switch overrides the breaker, by alias or by provider model id', () => {
    const b = new CircuitBreaker(DEFAULT_BREAKER_SETTINGS, ['Sonnet 5.5', 'claude-opus-5-5']);
    expect(b.admit('Sonnet 5.5')).toEqual({ ok: false, reason: 'disabled' });
    expect(b.admit('Opus 5.5', 'claude-opus-5-5')).toEqual({ ok: false, reason: 'disabled' });
    expect(b.wouldAdmit('sonnet 5.5')).toEqual({ ok: false, reason: 'disabled' });
    expect(b.admit('Gemini 3.8 Flash').ok).toBe(true);
    // Closed or not, a disabled model is never admitted.
    expect(b.state('Sonnet 5.5')).toBe('closed');
  });

  it('keeps one circuit per model', () => {
    const b = new CircuitBreaker();
    for (let i = 0; i < 5; i += 1) admit(b, 'Gemini 3.8 Flash').failure();
    expect(b.state('Gemini 3.8 Flash')).toBe('open');
    expect(b.state('Sonnet 5.5')).toBe('closed');
  });
});
