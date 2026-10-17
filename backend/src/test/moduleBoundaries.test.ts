/**
 * P21 exit test (D3 A-16, A-23, ADR-0082): the module boundaries the container depends on.
 *
 * - The database is reached through the container: `getDb()` is imported or called only by
 *   `container.ts` and `db/client.ts` (tests and `scripts/live` are outside the shipped tree).
 * - No service is a module-level singleton (`const x = new XService(` at the top of a file).
 * - `process.env` is read by `config.ts` only, plus the sites below, each with its reason.
 * - Model SDKs are imported only under `providers/` (CLAUDE.md "Forbidden").
 * - A swallowed error says why (A-23): every `catch {` and `.catch(() => …)` either throws,
 *   logs, or carries a `benign:` comment.
 */
import { describe, expect, it } from 'vitest';

import { codeOf, isCommentLine, shippedSources, type SourceFile } from './sourceWalk.js';

const files = shippedSources();

function lines(file: SourceFile): Array<{ n: number; line: string }> {
  return file.text.split('\n').map((line, i) => ({ n: i + 1, line }));
}

/** Child-process environment forwarding, and switches read at call time, kept as they are. */
const PROCESS_ENV_ALLOWLIST: Record<string, string> = {
  'config.ts': 'the one reader of the environment',
  'services/attachments/isolatedExtract.ts': 'forwards PATH and NODE_ENV to the isolated parser child',
  'services/attachments/untrustedTools.ts': 'forwards PATH to untrusted CLI children',
  'tools/sandbox/processSandboxClient.ts': 'forwards (or strips) the environment of the local sandbox child',
  'tools/execution/executionRuntime.ts': 'USE_DOCKER_SANDBOX / SANDBOX_IMAGE / ALLOW_HOST_CLI read per call by tests and local runs (moving them to config is a behaviour change: P21 follow-up)',
  'tools/sandbox/cloudRunSandboxClient.ts': 'SANDBOX_SIGNING_SA fallback when a client is built without options (tests); the container passes cfg',
  'routes/health.ts': "npm_package_version, set by npm itself, not deployment configuration",
};

export function getDbHits(all: SourceFile[]): string[] {
  return all.flatMap((f) =>
    f.rel === 'container.ts' || f.rel === 'db/client.ts'
      ? []
      : lines(f)
          .filter(({ line }) => !isCommentLine(line) && /\bgetDb\b/.test(codeOf(line)))
          .map(({ n, line }) => `${f.rel}:${String(n)}: ${line.trim()}`),
  );
}

export function singletonHits(all: SourceFile[]): string[] {
  return all.flatMap((f) =>
    lines(f)
      .filter(({ line }) => /^(export\s+)?(const|let)\s+\w+\s*(:[^=]+)?=\s*new\s+\w*Service\(/.test(line))
      .map(({ n, line }) => `${f.rel}:${String(n)}: ${line.trim()}`),
  );
}

export function processEnvHits(all: SourceFile[]): string[] {
  return all.flatMap((f) =>
    f.rel in PROCESS_ENV_ALLOWLIST
      ? []
      : lines(f)
          .filter(({ line }) => !isCommentLine(line) && /\bprocess\.env\b/.test(codeOf(line)))
          .map(({ n, line }) => `${f.rel}:${String(n)}: ${line.trim()}`),
  );
}

export function sdkImportHits(all: SourceFile[]): string[] {
  return all.flatMap((f) =>
    f.rel.startsWith('providers/')
      ? []
      : lines(f)
          .filter(({ line }) => /from '(@anthropic-ai\/sdk|@google\/genai)[^']*'|import\('(@anthropic-ai\/sdk|@google\/genai)/.test(line))
          .map(({ n, line }) => `${f.rel}:${String(n)}: ${line.trim()}`),
  );
}

/** A catch that neither throws, logs nor says `benign:` within its first lines. */
export function silentCatchHits(all: SourceFile[]): string[] {
  const hits: string[] = [];
  for (const f of all) {
    const ls = f.text.split('\n');
    ls.forEach((line, i) => {
      if (isCommentLine(line)) return;
      const block = /\bcatch\s*(\(\s*\w*\s*\))?\s*\{/.test(line);
      const promise = /\.catch\(\s*\(\s*\w*\s*\)\s*=>/.test(line);
      if (!block && !promise) return;
      // The catch line itself, the line above (a comment introducing a `.catch(...)`), and the
      // block's first lines.
      const window = [ls[i - 1] ?? '', ...ls.slice(i, i + (block ? 5 : 1))].join('\n');
      const body = block ? window.slice(window.indexOf(line)) : window;
      if (/benign:/.test(window) || /\bthrow\b/.test(body) || /\b(log|logger|request\.log|this\.log|deps\.log)\.(warn|error|info|debug)\(/.test(body)) return;
      // A `catch (err)` that uses the error (rethrows it under a type, maps it to a result) is not silent.
      if (block && /catch\s*\(\s*(\w+)\s*\)/.test(line)) {
        const name = /catch\s*\(\s*(\w+)\s*\)/.exec(line)![1]!;
        if (new RegExp(`\\b${name}\\b`).test(ls.slice(i + 1, i + 8).join('\n'))) return;
      }
      if (promise && /\.catch\(\s*\(\s*(\w+)\s*\)/.test(line)) {
        const name = /\.catch\(\s*\(\s*(\w+)\s*\)/.exec(line)![1]!;
        if (new RegExp(`\\b${name}\\b`).test(line.slice(line.indexOf('=>')) + ls.slice(i + 1, i + 4).join('\n'))) return;
      }
      hits.push(`${f.rel}:${String(i + 1)}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('module boundaries (P21)', () => {
  it('reaches the database only through the container', () => {
    expect(getDbHits(files)).toEqual([]);
  });

  it('has no module-level service singleton', () => {
    expect(singletonHits(files)).toEqual([]);
  });

  it('reads process.env only in config.ts and the listed sites', () => {
    expect(processEnvHits(files)).toEqual([]);
    for (const rel of Object.keys(PROCESS_ENV_ALLOWLIST)) {
      const file = files.find((f) => f.rel === rel);
      expect(file && /\bprocess\.env\b/.test(file.text), `${rel} is listed but no longer reads process.env`).toBe(true);
    }
  });

  it('imports the model SDKs only under providers/', () => {
    expect(sdkImportHits(files)).toEqual([]);
  });

  it('A-23: every swallowed error says why (benign:, a log line, or a typed error)', () => {
    expect(silentCatchHits(files)).toEqual([]);
  });

  it('each check catches a planted violation', () => {
    const planted: SourceFile[] = [
      { rel: 'services/planted.ts', text: [
        "import { getDb } from '../db/client.js';",
        'export const thingService = new ThingService(getDb());',
        "const key = process.env.SECRET_THING;",
        "import Anthropic from '@anthropic-ai/sdk';",
        'try { a(); } catch {',
        '  return null;',
        '}',
        'void p.catch(() => undefined);',
        'try { b(); } catch {',
        '  // benign: the file may already be gone',
        '}',
      ].join('\n') },
    ];
    expect(getDbHits(planted)).toHaveLength(2);
    expect(singletonHits(planted)).toHaveLength(1);
    expect(processEnvHits(planted)).toHaveLength(1);
    expect(sdkImportHits(planted)).toHaveLength(1);
    expect(silentCatchHits(planted).map((h) => h.split(':')[1])).toEqual(['5', '8']);
  });
});
