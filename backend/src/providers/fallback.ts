/**
 * The fallback chain (Stage 7 RT-6 / 7.12, Stage 15 ER-14a, Stage 4 E22; OQ-02 A; ADR-0081).
 *
 * 7.12: Gemini → Sonnet; Sonnet → Gemini; Opus → Sonnet → Gemini. A hop is taken only when the
 * failed model showed nothing and ran no tool (the gateway checks that), and every hop is
 * labelled ("Answered by X because Y was unavailable"); there is no silent substitution
 * (Invariant 1). A candidate is skipped when it cannot do what the turn needs (vision,
 * grounding), when it is killed or its breaker is open, when its provider was already ruled out
 * for the turn (a Claude spend cap or credential failure skips every Claude row), when it was
 * already tried, and always when it is a helper row (role `helper`, P13: never a chat answer).
 *
 * Pure: the caller passes the entries, the needs and the admission check.
 */
import type { ModelEntry } from './registry.js';

/** By alias (registry.ts `buildEntries`). */
export const FALLBACK_CHAIN: Readonly<Record<string, readonly string[]>> = {
  'Gemini 3.8 Flash': ['Sonnet 5.5'],
  'Sonnet 5.5': ['Gemini 3.8 Flash'],
  'Opus 5.5': ['Sonnet 5.5', 'Gemini 3.8 Flash'],
};

export interface HopNeeds {
  vision: boolean;
  grounding: boolean;
}

export interface PickInput {
  /** The model the turn started on: its chain is the one walked. */
  origin: string;
  /** Aliases already tried (or ruled out) this turn, the origin included. */
  tried: ReadonlySet<string>;
  /** Providers ruled out for the turn (`credentials`, `claude_limit`). */
  skipProviders: ReadonlySet<ModelEntry['provider']>;
  needs: HopNeeds;
  /** The configured, available entries (registry). */
  entries: readonly ModelEntry[];
  /** Kill switch and breaker; also the service's own checks (code execution, grounding provider). */
  admissible: (entry: ModelEntry) => boolean;
}

function isHelper(entry: ModelEntry): boolean {
  return (entry as ModelEntry & { role?: string }).role === 'helper';
}

/** The next model of `origin`'s chain that can take the turn, or null when none is left. */
export function nextInChain(input: PickInput): ModelEntry | null {
  for (const alias of FALLBACK_CHAIN[input.origin] ?? []) {
    if (input.tried.has(alias)) continue;
    const entry = input.entries.find((e) => e.alias === alias);
    if (!entry || isHelper(entry)) continue;
    if (input.skipProviders.has(entry.provider)) continue;
    if (input.needs.vision && !entry.supportsVision) continue;
    if (input.needs.grounding && !entry.supportsGrounding) continue;
    if (!input.admissible(entry)) continue;
    return entry;
  }
  return null;
}
