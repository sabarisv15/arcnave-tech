/**
 * Drizzle's migrator applies a migration only when its journal `when` is later than the last
 * applied one's (`created_at < folderMillis`, drizzle-orm pg-core dialect). 0010 was stamped by
 * hand in the future; a generated 0011 got an earlier stamp and would have been skipped in
 * production without an error (mistakes.md, 2026-09-25).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../drizzle');
const journal = JSON.parse(readFileSync(path.join(DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string }[];
};

describe('migration journal', () => {
  it('stamps every migration later than the one before it', () => {
    for (const [i, e] of journal.entries.entries()) {
      if (i > 0) expect(e.when, `${e.tag} must be later than ${journal.entries[i - 1]!.tag}`).toBeGreaterThan(journal.entries[i - 1]!.when);
    }
  });

  it('lists every migration file, in order', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')).sort();
    expect(journal.entries.map((e) => e.tag)).toEqual(files);
    expect(journal.entries.map((e) => e.idx)).toEqual(files.map((_, i) => i));
  });
});
