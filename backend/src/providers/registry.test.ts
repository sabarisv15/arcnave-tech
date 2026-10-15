/**
 * The model registry after ADR-0054/0055: exactly three aliases, Claude on the first-party API,
 * and status from configuration, probes and real outcomes only — no code path switches an alias
 * off by environment.
 */
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { buildEntries, ModelRegistry } from './registry.js';
import type { Provider } from './types.js';

function fakeProvider(): Provider {
  return {
    name: 'fake',
    supportsGrounding: () => true,
    // eslint-disable-next-line require-yield
    stream: async function* () {
      throw new Error('not used');
    },
    probe: vi.fn(() => Promise.resolve()),
  } as unknown as Provider;
}

const providers = { google: fakeProvider(), anthropic: fakeProvider() };

describe('the alias table (ADR-0055)', () => {
  it('has exactly Gemini 3.8 Flash, Sonnet 5.5 and Opus 5.5', () => {
    const entries = buildEntries(loadConfig({ NODE_ENV: 'test' }));
    expect(entries.map((e) => [e.alias, e.provider, e.tier])).toEqual([
      ['Gemini 3.8 Flash', 'google', 'economy'],
      ['Sonnet 5.5', 'anthropic', 'balanced'],
      ['Opus 5.5', 'anthropic', 'quality'],
    ]);
  });

  it('defaults the Claude ids to the first-party ids, and an empty value turns an alias off', () => {
    const byDefault = buildEntries(loadConfig({ NODE_ENV: 'test' }));
    expect(byDefault.find((e) => e.alias === 'Sonnet 5.5')?.providerModelId).toBe('claude-sonnet-5-5');
    expect(byDefault.find((e) => e.alias === 'Opus 5.5')?.providerModelId).toBe('claude-opus-5-5');
    const off = buildEntries(loadConfig({ NODE_ENV: 'test', MODEL_OPUS: '' }));
    expect(off.find((e) => e.alias === 'Opus 5.5')?.providerModelId).toBeUndefined();
  });
});

describe('ModelRegistry status', () => {
  it('serves Claude outside tests when it is configured (the old Gemini-only gate is gone)', async () => {
    const cfg = loadConfig({ NODE_ENV: 'production', COOKIE_SECRET: 'x'.repeat(32), SESSION_COOKIE_SECURE: 'true', ANTHROPIC_API_KEY: 'k', GOOGLE_CLOUD_PROJECT: 'p', MODEL_GEMINI_FLASH: 'gemini-3.8-flash' });
    const registry = new ModelRegistry(cfg, providers);
    const statuses = await registry.allStatuses({ probe: 'never' });
    expect(statuses.map((s) => [s.entry.alias, s.available])).toEqual([
      ['Gemini 3.8 Flash', true],
      ['Sonnet 5.5', true],
      ['Opus 5.5', true],
    ]);
  });

  it('reports Claude anthropic_not_configured without a key, and leaves Gemini alone', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', GOOGLE_CLOUD_PROJECT: 'p', MODEL_GEMINI_FLASH: 'gemini-3.8-flash' });
    const registry = new ModelRegistry(cfg, providers);
    const statuses = await registry.allStatuses({ probe: 'never' });
    expect(statuses.map((s) => [s.entry.alias, s.reason])).toEqual([
      ['Gemini 3.8 Flash', 'ok'],
      ['Sonnet 5.5', 'anthropic_not_configured'],
      ['Opus 5.5', 'anthropic_not_configured'],
    ]);
  });

  it('serves Claude without a Google project: the two providers are configured separately', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k' });
    const registry = new ModelRegistry(cfg, providers);
    const statuses = await registry.allStatuses({ probe: 'never' });
    expect(statuses.map((s) => [s.entry.alias, s.reason])).toEqual([
      ['Gemini 3.8 Flash', 'vertex_not_configured'],
      ['Sonnet 5.5', 'ok'],
      ['Opus 5.5', 'ok'],
    ]);
  });

  it('keeps a real outcome: a model a request could not find is unavailable until the probe TTL', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k' });
    const registry = new ModelRegistry(cfg, providers);
    registry.recordOutcome('Opus 5.5', { available: false, detail: 'not found' });
    const status = await registry.status('Opus 5.5', { probe: false });
    expect(status).toMatchObject({ available: false, reason: 'probe_failed' });
  });
});

describe('loadConfig for Claude (ADR-0054)', () => {
  const prod = { NODE_ENV: 'production', COOKIE_SECRET: 'x'.repeat(32), SESSION_COOKIE_SECURE: 'true' };

  it('boots a Gemini-only production deployment with no Claude key', () => {
    expect(() => loadConfig(prod)).not.toThrow();
  });

  it('refuses a production boot that names a Claude model but has no key', () => {
    expect(() => loadConfig({ ...prod, MODEL_OPUS: 'claude-opus-5-5' })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
