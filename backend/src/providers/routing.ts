/**
 * `Auto` routing, by Stage 7 (RT-1, 7.9, ADR-0076).
 *
 * Auto is rules only, and every rule ends at Gemini 3.8 Flash: Auto never picks Sonnet or Opus
 * (Opus is a manual choice only; Stage 18 "Opus never default"), and nothing about the turn
 * promotes it to a Claude model (not an attachment, not research mode, not a long prompt). The
 * Stage 7.9 capability rules (audio or video, PDFs over 600 pages, requests over 30 MB, the
 * Claude switch and budget) all send a turn to Gemini, which Auto already is.
 *
 * When Gemini cannot take the turn, Auto answers nothing rather than substituting a Claude model
 * the user did not choose (Invariant 1): the caller raises `no_model_available`.
 *
 * Pure: no IO, no configuration, so every rule is tested exhaustively.
 */
import type { ModelEntry } from './registry.js';

export interface RoutingInput {
  /** Search and research need a model that can ground. */
  requiresGrounding: boolean;
  /** An image or a PDF is attached. */
  requiresVision: boolean;
}

export interface RoutingDecision {
  alias: string;
  entry: ModelEntry;
  /** The rule that chose: `auto_gemini` (RT-1), or `same_model_as_chat` (kept by the caller). */
  rule: string;
  considered: string[];
}

/** The model Auto routes to (RT-1, Stage 7 doc-sync 2026-10-10 registry: `auto` → Gemini). */
export const AUTO_PROVIDER: ModelEntry['provider'] = 'google';

/**
 * The Auto rules in the order they apply, with their stage source. The first that holds decides;
 * all of them decide Gemini (7.9 "Rules derived"). Kept as data so the table in
 * docs/ops/p07-result.md and the tests read the same list.
 */
export const AUTO_RULES: ReadonlyArray<{ id: string; when: string; source: string }> = [
  { id: 'audio_video', when: 'an audio or video input', source: 'Stage 7.9 / MR3: Claude takes no audio or video' },
  { id: 'large_pdf_or_request', when: 'a PDF over 600 pages or a request over 30 MB', source: 'Stage 7.9 Rules derived' },
  { id: 'claude_off_or_limit', when: 'the Claude switch is off or the Claude limit is reached', source: 'Stage 7.9, RT-6, RT-8 (switch and budget not built: single user)' },
  { id: 'default', when: 'every other turn: plain chat, attachments, search, research, long prompts', source: 'RT-1: Auto = rules only → Gemini 3.8 Flash' },
];

/**
 * Resolve `Auto` to Gemini 3.8 Flash, or null when Gemini is not available or cannot do what the
 * turn needs. Never another model.
 */
export function routeAuto(input: RoutingInput, available: ModelEntry[]): RoutingDecision | null {
  const gemini = available.find((e) => e.provider === AUTO_PROVIDER);
  if (!gemini) return null;
  if (input.requiresGrounding && !gemini.supportsGrounding) return null;
  if (input.requiresVision && !gemini.supportsVision) return null;
  return { alias: gemini.alias, entry: gemini, rule: 'auto_gemini', considered: [gemini.alias] };
}
