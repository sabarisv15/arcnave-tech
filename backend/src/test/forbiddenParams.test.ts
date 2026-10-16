/**
 * Grep guard (tech-p03): no sampling parameter in application code.
 *
 * `CLAUDE.md` forbids `temperature`, `top_p` and `top_k` (current models set their own; Claude's
 * newer models reject them). This reads every non-test source file under backend/src and fails on
 * the names. Test files are exempt, and this file is the only one that spells them out.
 * `\b` keeps "stopped" (which contains "topp") from matching.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BACKEND_DIR } from '../../evals/prompt-kit/kit.js';

const SRC = join(BACKEND_DIR, 'src');
const FORBIDDEN = /\b(?:temperature|top_p|top_k|top-p|top-k|topP|topK)\b/i;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (relative(SRC, full) === 'test') continue;
      sources(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('no sampling parameter in application code', () => {
  it('scans the source tree (not an empty glob)', () => {
    expect(sources(SRC).length).toBeGreaterThan(100);
  });

  it('finds no temperature / top_p / top_k outside tests', () => {
    const hits = sources(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ file: relative(BACKEND_DIR, file), line: i + 1, text: line }))
        .filter((l) => FORBIDDEN.test(l.text)),
    );
    expect(hits.map((h) => `${h.file}:${String(h.line)}`)).toEqual([]);
  });

  it('would catch each name (the pattern is not vacuous)', () => {
    for (const bad of ['temperature: 0.2', 'top_p: 1', 'topK = 3', 'generationConfig.topP', 'top-k']) expect(FORBIDDEN.test(bad), bad).toBe(true);
    for (const fine of ['[Response stopped]', 'was stopped', 'pdftoppm', 'stop_sequence']) expect(FORBIDDEN.test(fine), fine).toBe(false);
  });
});
