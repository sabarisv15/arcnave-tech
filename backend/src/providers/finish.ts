/**
 * How a provider's finish reason ends the turn (Stage 15 ER-3c / ER-3d, AL-4; ADR-0081).
 *
 * - A safety block, a recitation block, Model Armor, a prompt `blockReason` and a Claude
 *   `refusal` are `blocked`: no retry, no fallback, no forced answer (Stage 7 7.12, SD-9b).
 * - A natural stop and an output limit keep the provider's own spelling (`STOP`, `MAX_TOKENS`,
 *   `end_turn`, `max_tokens`, …): stored rows already carry those, and the client reads both.
 *   `model_context_window_exceeded` is an output limit ("valid but truncated", Stage 15 F6).
 * - A reason this table does not know, with text, is `other` and logged once at WARN with a
 *   code; the text stays a finished answer (EH23: tolerate new finish reasons).
 * - A stream that ends with no finish reason is a failure (doc-sync 2026-10-11): transient
 *   before any text (retried, then the next model), `interrupted` after text (partial kept).
 */
import { logger } from '../logger.js';

const log = logger.child({ module: 'provider:finish' });

/** Gemini finish reasons that are a block (Stage 21 doc-sync 2026-10-11 "Blocked list"). */
export const GEMINI_BLOCKED_FINISH = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'SPII',
  'BLOCKLIST',
  'RECITATION',
  // In the REST reference, unknown to the SDK enum (doc-sync 2026-10-11).
  'MODEL_ARMOR',
  // Ours: the image variants of the same blocks (SDK 2.22 enum), treated as the text ones.
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
]);

/** Finish reasons a turn may end with as they are. */
const KNOWN_FINISH = new Set([
  // Gemini
  'STOP',
  'MAX_TOKENS',
  // Claude
  'end_turn',
  'stop_sequence',
  'tool_use',
  'max_tokens',
  'pause_turn',
  // A refusal is turned into `blocked` by the service from the refusal event (M-14).
  'refusal',
  // ArcNave's own (adapters and fakes)
  'stop',
  'tool_limit',
  'length',
]);

/** No finish reason at all, as each provider spells it. */
const NO_FINISH = new Set(['', 'FINISH_REASON_UNSPECIFIED']);

export type FinishOutcome =
  | { kind: 'finished'; finishReason: string }
  | { kind: 'blocked'; category: string }
  | { kind: 'no_finish' };

/**
 * The outcome of a Gemini answer round's finish reason (`raw` undefined when no chunk carried
 * one). A prompt `blockReason` wins over everything.
 */
export function geminiFinish(raw: string | undefined, blockReason: string | undefined): FinishOutcome {
  if (blockReason && blockReason !== 'BLOCKED_REASON_UNSPECIFIED') return { kind: 'blocked', category: blockReason.toLowerCase().slice(0, 32) };
  if (raw === undefined || NO_FINISH.has(raw)) return { kind: 'no_finish' };
  if (GEMINI_BLOCKED_FINISH.has(raw)) return { kind: 'blocked', category: raw.toLowerCase().slice(0, 32) };
  return { kind: 'finished', finishReason: normalisedFinish(raw) };
}

/** A finish reason as stored: known ones as they are, an output limit as `max_tokens`, the rest `other`. */
export function normalisedFinish(raw: string): string {
  if (raw === 'model_context_window_exceeded') return 'max_tokens';
  if (KNOWN_FINISH.has(raw)) return raw;
  // AL-4 / EH23: a coded line, the reason only (a provider enum value, never content).
  log.warn({ code: 'finish_reason_unknown', finishReason: raw.slice(0, 48) }, 'unknown finish reason; the answer ends as other');
  return 'other';
}

/** True for a finish reason that means the output limit was reached (M-25). */
export function isOutputLimit(finishReason: string): boolean {
  const r = finishReason.toLowerCase();
  return r === 'max_tokens' || r === 'length';
}
