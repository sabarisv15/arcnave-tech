/**
 * Every setting is read by the code. A setting nothing reads still documents a behaviour in its
 * comment: `HISTORY_MAX_ATTACHMENT_TEXT_CHARS` described an 8,000-character cap that no longer
 * existed, and an audit reported that cap as real (2026-09-25).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'test' || name === 'scripts' ? [] : sources(full);
    return name.endsWith('.ts') && !name.includes('.test.') ? [full] : [];
  });
}

describe('config', () => {
  it('has no setting that production code never reads', () => {
    const configFile = path.join(SRC, 'config.ts');
    const config = readFileSync(configFile, 'utf8');
    const keys = [...config.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(50);
    const code = sources(SRC)
      .filter((f) => f !== configFile)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const unread = keys.filter((k) => {
      const word = new RegExp(`\\b${k}\\b`, 'g');
      // Read elsewhere, or read inside config.ts itself (a derived field) beyond its definition.
      return !word.test(code) && (config.match(word) ?? []).length < 2;
    });
    expect(unread).toEqual([]);
  });
});
