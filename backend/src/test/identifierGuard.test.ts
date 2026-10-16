/**
 * No cloud identifier in launch code (PH-4, Stage 21 A1, ADR-0065): a project id, a project
 * number inside a service-account e-mail or a Cloud Run URL, or any service-account e-mail lives
 * in configuration, never in `backend/src` (tests and one-off scripts excepted). The second case
 * plants fake identifiers in a scratch tree and proves the scan finds each kind.
 */
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['GCP project id', /project-[0-9a-f]{8}-/],
  ['default compute service account', /\d{12}-compute@developer/],
  ['project-numbered Cloud Run URL', /\d{12}\.[a-z0-9-]+\.run\.app/],
  ['service-account e-mail', /[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/],
];

async function launchFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(root)) {
    const full = path.join(root, name);
    if ((await stat(full)).isDirectory()) {
      if (name === 'test' || name === 'scripts' || name === 'node_modules') continue;
      out.push(...(await launchFiles(full)));
    } else if (/\.(ts|js|json)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

async function findIdentifiers(root: string): Promise<string[]> {
  const hits: string[] = [];
  for (const file of await launchFiles(root)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const [kind, pattern] of PATTERNS) {
        if (pattern.test(line)) hits.push(`${path.relative(root, file)}:${String(i + 1)} ${kind}`);
      }
    });
  }
  return hits;
}

describe('identifier guard', () => {
  it('finds no cloud identifier in backend/src launch code', async () => {
    expect(await findIdentifiers(path.resolve(__dirname, '..'))).toEqual([]);
  });

  it('catches a planted identifier of each kind, and skips tests and scripts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arcnave-guard-'));
    try {
      // Fake values, built so no real identifier appears in this file.
      const digits = '0'.repeat(12);
      await mkdir(path.join(root, 'services'), { recursive: true });
      await mkdir(path.join(root, 'scripts'), { recursive: true });
      await writeFile(path.join(root, 'services', 'a.ts'), `const p = 'project-${'0'.repeat(8)}-0000';\n`);
      await writeFile(path.join(root, 'services', 'b.ts'), `const sa = '${digits}-compute@developer.gserviceaccount.com';\n`);
      await writeFile(path.join(root, 'services', 'c.ts'), `const u = 'https://svc-${digits}.region-1.run.app/v1';\n`);
      await writeFile(path.join(root, 'services', 'd.ts'), `const s = 'robot@fake-project.iam.gserviceaccount.com';\n`);
      await writeFile(path.join(root, 'services', 'e.test.ts'), `const p = 'project-${'0'.repeat(8)}-0000';\n`);
      await writeFile(path.join(root, 'scripts', 'f.ts'), `const p = 'project-${'0'.repeat(8)}-0000';\n`);

      const hits = await findIdentifiers(root);
      expect(hits).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^services\/a\.ts:1 GCP project id$/),
          expect.stringMatching(/^services\/b\.ts:1 default compute service account$/),
          expect.stringMatching(/^services\/c\.ts:1 project-numbered Cloud Run URL$/),
          expect.stringMatching(/^services\/d\.ts:1 service-account e-mail$/),
        ]),
      );
      expect(hits.some((h) => h.includes('e.test.ts') || h.startsWith('scripts'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
