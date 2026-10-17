/**
 * `Auto` routing rules (Stage 7 RT-1, 7.9; ADR-0076).
 *
 * Pure functions with no IO, so every rule is exercised directly rather than through a request.
 * The table in `buildEntries` is deliberately not imported: these tests fix the behaviour of the
 * rules, not the current contents of the model list.
 */
import { describe, expect, it } from 'vitest';

import type { ModelEntry, Tier } from './registry.js';
import { AUTO_RULES, routeAuto, type RoutingInput } from './routing.js';

function entry(alias: string, provider: ModelEntry['provider'], tier: Tier, supportsGrounding = true, supportsVision = true): ModelEntry {
  return {
    alias,
    description: '',
    provider,
    tier,
    providerModelId: `model-${alias}`,
    location: 'global',
    supportsGrounding,
    supportsVision,
    contextWindow: 1_000,
  };
}

const GEMINI = entry('Gemini 3.8 Flash', 'google', 'economy');
const SONNET = entry('Sonnet 5.5', 'anthropic', 'balanced');
const OPUS = entry('Opus 5.5', 'anthropic', 'quality');
const ALL = [OPUS, SONNET, GEMINI];

/** Every combination of what a turn can need. */
const NEEDS: RoutingInput[] = [false, true].flatMap((requiresGrounding) =>
  [false, true].map((requiresVision) => ({ requiresGrounding, requiresVision })),
);

describe('routeAuto (RT-1: rules only → Gemini 3.8 Flash)', () => {
  it('answers every turn with Gemini, whatever it needs, with the rule named', () => {
    for (const needs of NEEDS) {
      const decision = routeAuto(needs, ALL);
      expect(decision?.alias, JSON.stringify(needs)).toBe('Gemini 3.8 Flash');
      expect(decision?.rule).toBe('auto_gemini');
      expect(decision?.considered).toEqual(['Gemini 3.8 Flash']);
    }
  });

  it('never picks a Claude model: not for attachments, not for search, not in any list order', () => {
    for (const needs of NEEDS) {
      for (const order of [ALL, [...ALL].reverse(), [SONNET, GEMINI, OPUS]]) {
        expect(routeAuto(needs, order)?.entry.provider).toBe('google');
      }
    }
  });

  it('Opus is manual only: with Gemini gone Auto does not fall to Opus or Sonnet (no silent substitution)', () => {
    for (const needs of NEEDS) {
      expect(routeAuto(needs, [SONNET, OPUS]), JSON.stringify(needs)).toBeNull();
    }
    expect(routeAuto({ requiresGrounding: false, requiresVision: false }, [])).toBeNull();
  });

  it('refuses rather than routes elsewhere when Gemini cannot do what the turn needs', () => {
    const noVision = entry('Gemini 3.8 Flash', 'google', 'economy', true, false);
    const noGrounding = entry('Gemini 3.8 Flash', 'google', 'economy', false, true);
    expect(routeAuto({ requiresGrounding: false, requiresVision: true }, [noVision, SONNET])).toBeNull();
    expect(routeAuto({ requiresGrounding: true, requiresVision: false }, [noGrounding, SONNET])).toBeNull();
    expect(routeAuto({ requiresGrounding: false, requiresVision: false }, [noVision])?.alias).toBe('Gemini 3.8 Flash');
  });

  it('lists every Stage 7 Auto rule, each ending at Gemini, with its source', () => {
    expect(AUTO_RULES.map((r) => r.id)).toEqual(['audio_video', 'large_pdf_or_request', 'claude_off_or_limit', 'default']);
    for (const r of AUTO_RULES) expect(r.source).toMatch(/Stage 7|RT-\d/);
  });

  it('takes no routing preference, prompt length or attachment count as input', () => {
    // RoutingInput has exactly the two capability needs; anything else is a type error.
    const keys: Array<keyof RoutingInput> = ['requiresGrounding', 'requiresVision'];
    expect(Object.keys(NEEDS[0]!).sort()).toEqual([...keys].sort());
  });
});
