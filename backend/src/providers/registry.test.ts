/**
 * The model registry after ADR-0054/0055: exactly three aliases, Claude on the first-party API,
 * and status from configuration, probes and real outcomes only — no code path switches an alias
 * off by environment.
 */
import { describe, expect, it, vi } from 'vitest';

import { loadConfig, providerReadiness } from '../config.js';
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
  it('has exactly Gemini 3.8 Flash, Sonnet 5.5 and Opus 5.5 as chat models, and Haiku 5.5 as the helper', () => {
    const entries = buildEntries(loadConfig({ NODE_ENV: 'test' }));
    expect(entries.filter((e) => (e.role ?? 'chat') === 'chat').map((e) => [e.alias, e.provider, e.tier])).toEqual([
      ['Gemini 3.8 Flash', 'google', 'economy'],
      ['Sonnet 5.5', 'anthropic', 'balanced'],
      ['Opus 5.5', 'anthropic', 'quality'],
    ]);
    // ADR-0080: one helper row, the first-party Haiku id by default.
    expect(entries.filter((e) => e.role === 'helper').map((e) => [e.alias, e.providerModelId])).toEqual([
      ['Haiku 5.5', 'claude-haiku-5-5'],
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

describe('the helper row (ADR-0080)', () => {
  it('is never a chat alias, never in the statuses /models and Auto read', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k' });
    const registry = new ModelRegistry(cfg, providers);
    expect(registry.aliases).not.toContain('Haiku 5.5');
    expect(registry.entry('Haiku 5.5')).toBeUndefined();
    expect((await registry.allStatuses({ probe: 'never' })).map((s) => s.entry.alias)).not.toContain('Haiku 5.5');
    expect((await registry.availableEntries({ probe: 'never' })).map((e) => e.alias)).not.toContain('Haiku 5.5');
    expect(registry.helperEntry()?.providerModelId).toBe('claude-haiku-5-5');
    expect(registry.helperStatus()).toMatchObject({ available: true, reason: 'ok' });
  });

  it('is unavailable with a code without a key or an id, and after a failed real call', () => {
    const noKey = new ModelRegistry(loadConfig({ NODE_ENV: 'test' }), providers);
    expect(noKey.helperStatus()).toMatchObject({ available: false, reason: 'anthropic_not_configured' });
    const noId = new ModelRegistry(loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k', MODEL_HAIKU: '' }), providers);
    expect(noId.helperStatus()).toMatchObject({ available: false, reason: 'not_configured' });
    const failed = new ModelRegistry(loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k' }), providers);
    failed.recordHelperOutcome('Haiku 5.5', { available: false, detail: 'not found' });
    expect(failed.helperStatus()).toMatchObject({ available: false, reason: 'probe_failed' });
    // A chat alias is not touched by a helper outcome.
    expect(failed.lastProbedAt('Sonnet 5.5')).toBeNull();
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

describe('providerReadiness (drives /readyz and the startup warning)', () => {
  it('is ready for Gemini alone when only Vertex is set', () => {
    const cfg = loadConfig({ GOOGLE_CLOUD_PROJECT: 'p', MODEL_GEMINI_FLASH: 'gemini-3.8-flash', MODEL_SONNET: '', MODEL_OPUS: '' });
    expect(providerReadiness(cfg).ready).toBe(true);
  });

  it('is degraded when Claude ids are active but the key is missing', () => {
    const cfg = loadConfig({ GOOGLE_CLOUD_PROJECT: 'p', MODEL_GEMINI_FLASH: 'gemini-3.8-flash' });
    const r = providerReadiness(cfg);
    expect(r.anthropic).toEqual({ inUse: true, configured: false });
    expect(r.ready).toBe(false);
  });

  it('is ready for Claude alone when only the key is set', () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: 'k' });
    expect(providerReadiness(cfg).ready).toBe(true);
  });

  it('does not count Gemini as in use without a model id, even with a project set', () => {
    const cfg = loadConfig({ GOOGLE_CLOUD_PROJECT: 'p', ANTHROPIC_API_KEY: 'k' });
    expect(providerReadiness(cfg).google).toEqual({ inUse: false, configured: true });
    expect(providerReadiness(cfg).ready).toBe(true);
  });

  it('is degraded when nothing is in use', () => {
    const cfg = loadConfig({ MODEL_SONNET: '', MODEL_OPUS: '' });
    expect(providerReadiness(cfg).ready).toBe(false);
  });
});
