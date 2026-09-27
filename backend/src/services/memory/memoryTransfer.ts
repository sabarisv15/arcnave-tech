/**
 * Moving memory in and out (WP-13, ADR-0040).
 *
 * Export is ArcNave's own JSON, which import reads back unchanged. Import also takes plain text,
 * one memory per line, which is what another assistant gives when asked to list what it
 * remembers ("[date] - memory" lines, bullets or numbers). Every line is kept as the user's own
 * statement; nothing is inferred from it.
 */
import type { MemoryKind } from './types.js';

export const MEMORY_EXPORT_VERSION = 1;
/** One import is at most this many memories; a longer paste is refused, not cut. */
export const MAX_IMPORT_ITEMS = 500;
const MAX_KEY = 200;
const KEY_WORDS = 8;

export interface TransferItem {
  key: string;
  content: string;
  kind?: MemoryKind;
  isStanding?: boolean;
  /** Only in an export; import places a project memory only in a project the user owns. */
  projectId?: string | null;
}

/** Strips list markers and a leading date, as other assistants write them. */
function lineContent(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*•–]\s+|\d+[.)]\s+)/, '')
    .replace(/^\[[^\]]{1,40}\]\s*[-–:]?\s*/, '')
    .replace(/^\d{4}-\d{2}-\d{2}\s*[-–:]\s*/, '')
    .trim();
}

/** A short topic name for a memory, from its first words. */
export function keyFor(content: string): string {
  const words = content.replace(/\s+/g, ' ').split(' ').slice(0, KEY_WORDS).join(' ');
  const key = words.length < content.length ? `${words}…` : words;
  return key.slice(0, MAX_KEY);
}

export function parseImportText(text: string): TransferItem[] {
  const out: TransferItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) continue; // a heading the other assistant added
    const content = lineContent(raw);
    if (content.length < 3) continue;
    out.push({ key: keyFor(content), content });
  }
  return out;
}

export const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
