/**
 * The shipped backend sources, read with `readFileSync` (grep treats `services/storage.ts` as
 * binary and would skip it). Tests and `src/test/` are left out: they pin values on purpose.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { BACKEND_DIR } from '../../evals/prompt-kit/kit.js';

export const SRC = join(BACKEND_DIR, 'src');

export interface SourceFile {
  /** Relative to `src/`, with `/` separators. */
  rel: string;
  text: string;
}

export function shippedSources(dir = SRC): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const rel = relative(SRC, full).split(sep).join('/');
      if (statSync(full).isDirectory()) {
        if (rel === 'test') continue;
        walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        out.push({ rel, text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return out;
}

/** A line with string literals and comments blanked, so a check sees only code. */
export function codeOf(line: string): string {
  return line
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
    .replace(/\/\*.*?\*\//g, ' ')
    .replace(/\/\/.*$/, '');
}

/** True for a line that is only (part of) a comment. */
export function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}
