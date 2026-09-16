/**
 * `Auto` routing.
 *
 * Deterministic and ordered: first matching rule wins, and the decision is always reported
 * back to the caller in response metadata so "Auto" is never opaque. Pure functions with no
 * IO, which is what makes them straightforward to test exhaustively.
 */
import type { Config } from '../config.js';
import type { ModelEntry, Tier } from './registry.js';
import type { Mode } from './types.js';

export interface RoutingInput {
  mode: Mode;
  promptChars: number;
  contextChars: number;
  hasAttachments: boolean;
  routingPreference: Tier;
  /** Search and research need a grounded model; ungrounded candidates are skipped. */
  requiresGrounding: boolean;
}

export interface RoutingDecision {
  alias: string;
  entry: ModelEntry;
  rule: string;
  considered: string[];
}

/** Capability order, low to high. Used for both preference shift and fallback distance. */
const TIER_ORDER: readonly Tier[] = ['economy', 'balanced', 'quality'] as const;

const PREFERENCE_SHIFT: Record<Tier, number> = { economy: -1, balanced: 0, quality: 1 };

function shift(tier: Tier, preference: Tier): Tier {
  const index = TIER_ORDER.indexOf(tier) + PREFERENCE_SHIFT[preference];
  const clamped = Math.max(0, Math.min(TIER_ORDER.length - 1, index));
  return TIER_ORDER[clamped]!;
}

/**
 * Pick the tier a request deserves, before availability is considered.
 *
 * The user's routing preference shifts the result one step up or down, so "economy" does not
 * mean "never use a good model for research" — it means "prefer cheaper at each decision".
 */
export function chooseTier(input: RoutingInput, cfg: Config): { tier: Tier; rule: string } {
  if (input.mode === 'research') {
    return { tier: shift('quality', input.routingPreference), rule: 'research_mode' };
  }
  if (input.hasAttachments) {
    return { tier: shift('quality', input.routingPreference), rule: 'attachments_present' };
  }
  if (input.contextChars > cfg.AUTO_ROUTE_LONG_CONTEXT_CHARS) {
    return { tier: shift('quality', input.routingPreference), rule: 'long_project_context' };
  }
  if (input.promptChars > cfg.AUTO_ROUTE_LONG_PROMPT_CHARS) {
    return { tier: shift('balanced', input.routingPreference), rule: 'long_prompt' };
  }
  return { tier: shift('economy', input.routingPreference), rule: 'default' };
}

/**
 * Resolve `Auto` to a concrete alias.
 *
 * Falls outward from the chosen tier through neighbouring tiers, preferring higher capability
 * at equal distance, so an unconfigured quality model degrades to the best available rather
 * than failing outright. Returns null when nothing qualifies — the caller then raises
 * `no_model_available` instead of guessing.
 */
export function routeAuto(
  input: RoutingInput,
  cfg: Config,
  available: ModelEntry[],
): RoutingDecision | null {
  const candidates = input.requiresGrounding
    ? available.filter((e) => e.supportsGrounding)
    : available;
  if (candidates.length === 0) return null;

  const { tier, rule } = chooseTier(input, cfg);
  const start = TIER_ORDER.indexOf(tier);

  const byTier = new Map<Tier, ModelEntry[]>();
  for (const entry of candidates) {
    const list = byTier.get(entry.tier);
    if (list) list.push(entry);
    else byTier.set(entry.tier, [entry]);
  }

  const searchOrder = TIER_ORDER.map((_, i) => i).sort(
    (a, b) => Math.abs(a - start) - Math.abs(b - start) || b - a,
  );

  for (const index of searchOrder) {
    const tierName = TIER_ORDER[index]!;
    const forTier = byTier.get(tierName);
    if (forTier?.length) {
      const chosen = forTier[0]!;
      return {
        alias: chosen.alias,
        entry: chosen,
        rule: index === start ? rule : `${rule}+fallback_to_${tierName}`,
        considered: candidates.map((e) => e.alias),
      };
    }
  }
  return null;
}
