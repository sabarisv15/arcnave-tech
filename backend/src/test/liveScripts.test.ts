/**
 * The live scripts under src/scripts (tech-p03, X-6): each is repaired, listed as stale in
 * DEFERRED.md with its reason, or recorded as unverified. A new script must be classified here, so
 * a script cannot go stale unrecorded. Nothing is run: these scripts spend provider quota.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BACKEND_DIR } from '../../evals/prompt-kit/kit.js';

const DIR = join(BACKEND_DIR, 'src', 'scripts');
const DEFERRED = readFileSync(join(BACKEND_DIR, '..', 'docs', 'ops', 'audit', 'DEFERRED.md'), 'utf8');

const REPAIRED = [
  'measureStablePrefixTokens.ts',
  'measureTokens.ts',
  'runClaudeBehaviorEvaluation.ts',
  'runClaudeCompactionEvaluation.ts',
  'runCompactionEvaluation.ts',
  'runGeminiPromptCacheEvaluation.ts',
  'runPromptCacheEvaluation.ts',
];

const SANDBOX_IDENTIFIERS = 'hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts)';
const STALE: Record<string, string> = {
  'runBehaviorEvaluation.ts': 'frozen Master Prompt v1 scenarios, removed tool read_uploaded_file, hard-coded project and retired model name; superseded by npm run eval:prompt',
  'runReliabilityMatrix.ts': 'built on the runBehaviorEvaluation scenarios and the old builder, hard-coded project; superseded by npm run eval:prompt',
  'testBatch6RehydrationLive.ts': 'describes the removed in-memory tool registry (LOAD_SKILL / SEARCH_TOOLS) and the inspectPdf tool',
  'testCloudRunDirect.ts': SANDBOX_IDENTIFIERS,
  'testDynamicOutput.ts': SANDBOX_IDENTIFIERS,
  'testNetworkEgress.ts': SANDBOX_IDENTIFIERS,
  'testSaDenied.ts': SANDBOX_IDENTIFIERS,
  'testSignedUrls.ts': SANDBOX_IDENTIFIERS,
  'testTokenAuthority.ts': SANDBOX_IDENTIFIERS,
  'testUnshare.ts': SANDBOX_IDENTIFIERS,
  'verifyBatch22Live.ts': SANDBOX_IDENTIFIERS,
  'verifyBatch24Live.ts': SANDBOX_IDENTIFIERS,
  'verifyBatch2Live.ts': SANDBOX_IDENTIFIERS,
};

/** No stale marker found by reading, but never run in P03 (needs the live database and providers). */
const UNVERIFIED = ['evalScope.ts', 'testBatch6ContextPressureLive.ts', 'verifyBatch6OverflowLive.ts', 'verifyRepairLoopLive.ts'];

describe('live scripts', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

  it('classifies every script exactly once', () => {
    const classified = [...REPAIRED, ...Object.keys(STALE), ...UNVERIFIED];
    expect([...classified].sort()).toEqual([...files].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it('gives each repaired script a one-line header and no stale literal', () => {
    for (const file of REPAIRED) {
      const text = readFileSync(join(DIR, file), 'utf8');
      expect(text.split('\n')[0], file).toMatch(/^\/\/ P03 \(X-6\) repaired: .+/);
      expect(text, file).not.toMatch(/claude-sonnet-5(?!-5)/);
      expect(text, file).not.toMatch(/project-[0-9a-f]{8}-/);
      expect(text, file).not.toMatch(/words \* 1\.33|Naive rule/);
    }
  });

  it('records every stale script in DEFERRED.md as "stale: <reason>"', () => {
    for (const file of Object.keys(STALE)) {
      expect(DEFERRED, file).toMatch(new RegExp(`${file.replace('.', '\\.')}[^\\n]*stale: `));
    }
  });
});
