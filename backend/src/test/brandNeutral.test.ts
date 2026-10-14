/**
 * ArcNave is its own product (ADR-0044). Files that ship at launch may name a model provider
 * where the code talks to it (the Anthropic adapter, model ids, env vars), but never describe
 * ArcNave as following or imitating another assistant. Reference material (docs/, tools/,
 * tests, dev scripts) may.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '../../..');
const LAUNCH_ROOTS = ['backend/src', 'backend/skills', 'backend/sandbox', 'arcnave-frontend/src'];
const SOURCE = /\.(ts|tsx|js|css|py|md|html)$|Dockerfile/;
const NOT_LAUNCHED = /\.test\.|[\\/]test[\\/]|backend[\\/]src[\\/]scripts[\\/]/;

/** Wording that describes ArcNave by another assistant's behaviour or product. */
const REFERENCE = /\bas Claude\b|\blike Claude\b|Claude(?:'s)? (?:app|docs|harness|container|containers|memory|settings|menu|export|Code|is the reference)|claude\.ai|Claude-(?:style|inspired)|Claude Fable|Opus 5\.5/i;

const PROVIDER_FILES = ['anthropic.ts', 'registry.ts', 'capabilitiesTable.ts'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe('launch files do not describe ArcNave as another assistant', () => {
  const launched = LAUNCH_ROOTS.flatMap((root) => files(path.join(REPO, root)))
    .filter((f) => SOURCE.test(f) && !NOT_LAUNCHED.test(f))
    // The provider adapter talks to that provider's API, and the model table and registry name
    // the models ArcNave serves (ADR-0055); the provider's and models' names are the subject there.
    .filter((f) => !PROVIDER_FILES.some((name) => f.endsWith(path.join('providers', name))));

  it('finds the launch files', () => {
    expect(launched.length).toBeGreaterThan(100);
  });

  it('has no reference wording in any of them', () => {
    const hits = launched.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ f: path.relative(REPO, f), n: i + 1, line }))
        .filter(({ line }) => REFERENCE.test(line)),
    );
    expect(hits.map(({ f, n, line }) => `${f}:${String(n)}: ${line.trim()}`)).toEqual([]);
  });
});
