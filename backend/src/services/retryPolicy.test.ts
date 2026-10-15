/**
 * The app's only retry for model calls (Stage 15 ER-2, N-42): backoff 1 s → 2 s with full
 * jitter, capped at 8 s; a provider Retry-After honoured up to 10 s, otherwise no retry.
 */
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { NUMBERS } from '../config/numbers.js';
import { retryDelayMs } from './generation.js';

const cfg = loadConfig({ NODE_ENV: 'test' });

describe('retryDelayMs', () => {
  it('reads its defaults from the numbers register (N-42)', () => {
    expect(cfg.PROVIDER_MAX_RETRIES).toBe(NUMBERS.PROVIDER_MAX_RETRIES.value);
    expect([cfg.PROVIDER_RETRY_BASE_MS, cfg.PROVIDER_RETRY_MAX_BACKOFF_MS, cfg.PROVIDER_RETRY_AFTER_MAX_MS]).toEqual([1_000, 8_000, 10_000]);
    expect(NUMBERS.PROVIDER_RETRY_BASE_MS.nId).toBe('N-42');
  });

  it('waits up to 1 s before the first retry and up to 2 s before the second (full jitter)', () => {
    expect(retryDelayMs(1, undefined, cfg, () => 1)).toBe(1_000);
    expect(retryDelayMs(2, undefined, cfg, () => 1)).toBe(2_000);
    expect(retryDelayMs(2, undefined, cfg, () => 0.25)).toBe(500);
    expect(retryDelayMs(1, undefined, cfg, () => 0)).toBe(0);
  });

  it('never waits longer than the cap', () => {
    expect(retryDelayMs(6, undefined, cfg, () => 1)).toBe(8_000);
  });

  it('honours a provider Retry-After up to 10 s, and refuses to wait longer', () => {
    expect(retryDelayMs(1, 3_000, cfg, () => 0)).toBe(3_000);
    expect(retryDelayMs(1, 10_000, cfg, () => 0)).toBe(10_000);
    expect(retryDelayMs(1, 10_001, cfg, () => 0)).toBeNull();
  });
});
