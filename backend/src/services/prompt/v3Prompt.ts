/**
 * The Stage 6 v3 system prompt (ADR-0075): the base text each provider is sent, the product-tools
 * appendix, and the version stamped on every turn.
 *
 * The base files are the code block of each Stage 6 rendering with the tool-name map applied and
 * nothing else changed (`toolNameMap.ts`; the drift test compares them byte for byte with the
 * docs mirror). They are read from `backend/prompts/system/v3/`, next to `src` and `dist` alike,
 * so the same relative path works under tsx and from the compiled output; the image copies the
 * folder (Dockerfile).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PromptProvider = 'google' | 'anthropic';

/** `backend/prompts/system/v3`, from `backend/src/services/prompt` or `backend/dist/services/prompt`. */
export const PROMPTS_V3_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../prompts/system/v3');

const BASE_FILE: Record<PromptProvider, string> = { google: 'gemini.md', anthropic: 'claude.md' };
export const APPENDIX_FILE = 'appendix-product-tools.md';

const cache = new Map<string, string>();
function read(file: string): string {
  let text = cache.get(file);
  if (text === undefined) {
    text = readFileSync(path.join(PROMPTS_V3_DIR, file), 'utf8');
    cache.set(file, text);
  }
  return text;
}

/** The v3 base text for a provider: the runtime file without its final newline. */
export function v3BaseText(provider: PromptProvider): string {
  return read(BASE_FILE[provider]).replace(/\n$/, '');
}

/** The appendix file as written, section markers included (what the version hashes). */
export function appendixFileText(): string {
  return read(APPENDIX_FILE);
}

const SECTION_MARKER = /^<!-- section: ([a-z_]+) -->$/gm;

/** The appendix sections by id, in file order, without their markers. */
export function appendixSections(): ReadonlyMap<string, string> {
  const text = appendixFileText();
  const sections = new Map<string, string>();
  const marks = [...text.matchAll(SECTION_MARKER)];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1]!.index : text.length;
    sections.set(m[1]!, text.slice(start, end).trim());
  });
  return sections;
}

/**
 * The prompt version stamped on a turn: the first 12 hex of the SHA-256 of the provider's runtime
 * base text and the appendix file. A change to either file changes it; the per-turn session state
 * does not (it is not prompt text).
 */
export function promptVersion(provider: PromptProvider): string {
  return createHash('sha256')
    .update(read(BASE_FILE[provider]))
    .update('\n')
    .update(appendixFileText())
    .digest('hex')
    .slice(0, 12);
}
