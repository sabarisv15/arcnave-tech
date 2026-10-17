/**
 * The helper prompts (Stage 6 HP-TITLE, HP-SUM) and the stream-recovery text (REC), read from
 * `backend/prompts/` next to `src` and `dist` alike (the image copies the folder). ADR-0080.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeText } from '../prompt/sessionState.js';

/** `backend/prompts`, from `backend/src/services/helpers` or `backend/dist/services/helpers`. */
export const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../prompts');

const cache = new Map<string, string>();
function read(relative: string): string {
  let text = cache.get(relative);
  if (text === undefined) {
    text = readFileSync(path.join(PROMPTS_DIR, relative), 'utf8').replace(/\n$/, '');
    cache.set(relative, text);
  }
  return text;
}

/** The version a helper call is stamped with is its file name (a change is a new file). */
export const TITLE_PROMPT_VERSION = 'title-v1';
export const SUMMARY_PROMPT_VERSION = 'summary-v1';
export const RECOVERY_PROMPT_VERSION = 'continue-v1';

export function titlePrompt(): string {
  return read(`helpers/${TITLE_PROMPT_VERSION}.md`);
}

export function summaryPrompt(): string {
  return read(`helpers/${SUMMARY_PROMPT_VERSION}.md`);
}

/**
 * REC (Stage 6 doc-sync 2026-10-12): the continuation text, then the escaped partial answer in
 * `<previous_response>`, as the last text block of the current user turn. Not wired yet: the
 * stream-recovery behaviour (when to continue) is Stage 15's (P11 / P15 call this).
 */
export function renderRecovery(partial: string): { text: string; version: string } {
  return {
    text: `${read(`system/recovery/${RECOVERY_PROMPT_VERSION}.md`)}\n<previous_response>\n${escapeText(partial)}\n</previous_response>`,
    version: RECOVERY_PROMPT_VERSION,
  };
}
