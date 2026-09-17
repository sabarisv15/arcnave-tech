#!/usr/bin/env node
/**
 * Stop hook: a nudge to write the lesson down before the session ends.
 *
 * The documented failure mode of a learning log is that the write step gets skipped exactly
 * when context is tightest — which is also when the lesson is freshest. This checks whether
 * the working tree has code changes that were not accompanied by a `mistakes.md` edit, and
 * says so once.
 *
 * It is deliberately a reminder and not a block. Plenty of sessions produce no lesson worth
 * recording, and a hook that refuses to let you stop would train people to disable it.
 */
import { execFileSync } from 'node:child_process';

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

const changed = git('status', '--porcelain')
  .split('\n')
  .map((line) => line.slice(3).trim())
  .filter(Boolean);

if (changed.length === 0) process.exit(0);

const touchedCode = changed.some(
  (path) => /\.(ts|tsx|mjs|js)$/.test(path) && !path.endsWith('.test.ts'),
);
const touchedLog = changed.some((path) => path.endsWith('mistakes.md'));

if (touchedCode && !touchedLog) {
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        'Source changed but mistakes.md did not. If anything went wrong this session — a ' +
        'wrong assumption, a failing first attempt, a bug you introduced and fixed — add it ' +
        'now while it is fresh (symptom, cause, rule, how to verify). If nothing did, ignore ' +
        'this.',
    }),
  );
}
