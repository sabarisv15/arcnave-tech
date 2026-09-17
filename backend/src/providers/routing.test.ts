/**
 * `Auto` routing rules.
 *
 * Pure functions with no IO, so every rule is exercised directly rather than through a
 * request. The table in `buildEntries` is deliberately not imported: these tests fix the
 * behaviour of the rules, not the current contents of the model list.
 */
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import type { ModelEntry, Tier } from './registry.js';
import { chooseTier, routeAuto, type RoutingInput } from './routing.js';

const cfg = loadConfig({ NODE_ENV: 'test' });

function entry(alias: string, tier: Tier, supportsGrounding: boolean, supportsVision = true): ModelEntry {
  return {
    alias,
    description: '',
    provider: alias === 'Gemini' ? 'google' : 'anthropic',
    tier,
    providerModelId: `model-${alias}`,
    location: 'global',
    supportsGrounding,
    supportsVision,
    contextWindow: 1_000,
  };
}

/** Mirrors the shape of the real table: one grounded model per tier, plus an ungrounded one. */
const GEMINI = entry('Gemini', 'economy', true);
const SONNET = entry('Sonnet', 'balanced', true);
const OPUS = entry('Opus', 'quality', true);
const GPT_OSS = entry('GPT-OSS', 'balanced', false, false);
const ALL = [GEMINI, SONNET, OPUS, GPT_OSS];

function input(over: Partial<RoutingInput> = {}): RoutingInput {
  return {
    mode: 'chat',
    promptChars: 10,
    contextChars: 0,
    hasAttachments: false,
    requiresVision: false,
    routingPreference: 'balanced',
    requiresGrounding: false,
    ...over,
  };
}

describe('chooseTier', () => {
  it('sends a short plain chat to the economy tier', () => {
    expect(chooseTier(input(), cfg)).toEqual({ tier: 'economy', rule: 'default' });
  });

  it('raises the tier for a long prompt', () => {
    const { tier, rule } = chooseTier(input({ promptChars: cfg.AUTO_ROUTE_LONG_PROMPT_CHARS + 1 }), cfg);
    expect({ tier, rule }).toEqual({ tier: 'balanced', rule: 'long_prompt' });
  });

  it('raises the tier when attachments are present', () => {
    expect(chooseTier(input({ hasAttachments: true }), cfg).tier).toBe('quality');
  });

  it('shifts one step down when the user prefers economy', () => {
    expect(chooseTier(input({ hasAttachments: true, routingPreference: 'economy' }), cfg).tier).toBe(
      'balanced',
    );
  });

  it('clamps rather than running off the end of the tier list', () => {
    expect(chooseTier(input({ routingPreference: 'economy' }), cfg).tier).toBe('economy');
  });

  describe('grounded modes', () => {
    // Search and research default to the cheapest grounded model. Measured on the same
    // question against Vertex on 2026-09-17: an Anthropic web search cost 20,440 tokens
    // where the Gemini equivalent cost 368, because the Anthropic tool pulls page content
    // into the prompt. Routing a grounded request to the quality tier by default therefore
    // multiplies the bill without a matching gain.
    it('sends search to the economy tier', () => {
      const { tier, rule } = chooseTier(input({ mode: 'search', requiresGrounding: true }), cfg);
      expect(tier).toBe('economy');
      expect(rule).toBe('grounded_economy');
    });

    it('sends research to the economy tier too', () => {
      expect(chooseTier(input({ mode: 'research', requiresGrounding: true }), cfg).tier).toBe(
        'economy',
      );
    });

    it('still honours an explicit quality preference', () => {
      expect(
        chooseTier(
          input({ mode: 'research', requiresGrounding: true, routingPreference: 'quality' }),
          cfg,
        ).tier,
      ).toBe('balanced');
    });

    it('does not let attachments override the grounded default', () => {
      expect(
        chooseTier(input({ mode: 'search', requiresGrounding: true, hasAttachments: true }), cfg)
          .tier,
      ).toBe('economy');
    });
  });
});

describe('routeAuto', () => {
  it('resolves a plain chat to the economy model', () => {
    expect(routeAuto(input(), cfg, ALL)?.alias).toBe('Gemini');
  });

  it('resolves search to Gemini', () => {
    expect(routeAuto(input({ mode: 'search', requiresGrounding: true }), cfg, ALL)?.alias).toBe(
      'Gemini',
    );
  });

  it('resolves research to Gemini', () => {
    expect(routeAuto(input({ mode: 'research', requiresGrounding: true }), cfg, ALL)?.alias).toBe(
      'Gemini',
    );
  });

  it('never considers an ungrounded model for a grounded request', () => {
    const decision = routeAuto(input({ mode: 'search', requiresGrounding: true }), cfg, ALL);
    expect(decision?.considered).not.toContain('GPT-OSS');
  });

  it('falls back to the next grounded model when Gemini is not configured', () => {
    const decision = routeAuto(input({ mode: 'search', requiresGrounding: true }), cfg, [
      SONNET,
      OPUS,
      GPT_OSS,
    ]);
    expect(decision?.alias).toBe('Sonnet');
    expect(decision?.rule).toContain('fallback');
  });

  it('returns null when nothing can ground, rather than guessing', () => {
    expect(routeAuto(input({ mode: 'search', requiresGrounding: true }), cfg, [GPT_OSS])).toBeNull();
  });

  it('reports the rule that decided, so Auto is never opaque', () => {
    expect(routeAuto(input({ mode: 'research', requiresGrounding: true }), cfg, ALL)?.rule).toBe(
      'grounded_economy',
    );
  });

  it('never considers a vision-incapable model when vision is required', () => {
    const decision = routeAuto(input({ requiresVision: true }), cfg, ALL);
    expect(decision?.considered).not.toContain('GPT-OSS');
  });

  it('returns null when nothing configured can see an attachment', () => {
    expect(routeAuto(input({ requiresVision: true }), cfg, [GPT_OSS])).toBeNull();
  });

  it('combines the grounding and vision filters', () => {
    // GPT-OSS fails both; only a model with both capabilities should be considered.
    const decision = routeAuto(
      input({ requiresGrounding: true, requiresVision: true }),
      cfg,
      ALL,
    );
    expect(decision?.considered).toEqual(['Gemini', 'Sonnet', 'Opus']);
  });
});
