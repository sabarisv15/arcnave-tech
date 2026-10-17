/**
 * The live eval runner and the live conformance script, tested without a provider (tech-p03).
 *
 * Covers: argument parsing, the LIVE guard (also by running the real script without LIVE), the
 * cross-vendor judge plan, version stamps, error codes, the report formats, and the invariants
 * the reports must keep: provider tokens or `exact:false` with zeros (never an estimate), cost
 * `null` and not `0` when unpriced, and no model text in what is committed. A last group proves
 * the live path cannot be reached from vitest, CI or the application.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BACKEND_DIR, buildCaseRun, JUDGE_SYSTEM, judgeMessage, labelAskedOrBuilt, loadCases, loadExtraCases, parseJudgeVerdict } from '../../evals/prompt-kit/kit.js';
import {
  errorCodeOf,
  formatCaseTable,
  formatExtraTable,
  formatCommitSummary,
  formatModelSummary,
  judgeFor,
  liveGuardMessage,
  MODEL_KEYS,
  NO_TOKENS,
  parseArgs,
  planLine,
  promptStamp,
  RunnerUsageError,
  summarise,
  summaryFileName,
  toolsStamp,
} from '../../evals/prompt-kit/runner.js';
import type { RunRecord } from '../../evals/prompt-kit/runner.js';
import { formatConformance, runConformance } from '../../evals/conformance.js';
import type { GenerationRequest, Provider, ProviderEvent, ProviderUsage } from '../providers/types.js';
import { ProviderError } from '../providers/types.js';

const IDS = [...loadCases(), ...loadExtraCases()].map((c) => c.id);
const args = (...a: string[]) => parseArgs(a, IDS);
const REPO = join(BACKEND_DIR, '..');

function record(over: Partial<RunRecord> = {}): RunRecord {
  return {
    caseId: 'S1',
    gate: 'C',
    group: 'kit',
    label: null,
    model: 'gemini-flash',
    run: 1,
    outcome: 'ok',
    judgePass: true,
    judgeModel: 'claude-sonnet',
    judgeNote: null,
    tokens: { exact: true, input: 100, output: 20, cacheRead: 5, cacheWrite: 0 },
    costUsd: 0.001,
    latencyMs: 1234,
    finishReason: 'stop',
    toolNames: [],
    approximations: 0,
    ...over,
  };
}

describe('eval runner: arguments', () => {
  it('requires --models and has no default', () => {
    expect(() => args('--all')).toThrow(/--models is required/);
  });

  it('parses a full command and defaults runs to 1', () => {
    expect(args('--models', 'gemini-flash,claude-opus', '--all', '--yes')).toEqual({
      models: ['gemini-flash', 'claude-opus'],
      runs: 1,
      caseIds: null,
      yes: true,
      concurrency: 3,
    });
    expect(args('--models', 'claude-sonnet', '--runs', '3', '--cases', 'S1,T3')).toMatchObject({ runs: 3, caseIds: ['S1', 'T3'], yes: false });
  });

  it('rejects an unknown model, an unknown case, a bad count and a missing selector', () => {
    expect(() => args('--models', 'gpt', '--all')).toThrow(RunnerUsageError);
    expect(() => args('--models', 'gemini-flash', '--cases', 'S1,ZZ9')).toThrow(/ZZ9/);
    expect(() => args('--models', 'gemini-flash', '--all', '--runs', '0')).toThrow(/--runs/);
    expect(() => args('--models', 'gemini-flash', '--all', '--runs', '2.5')).toThrow(/--runs/);
    expect(() => args('--models', 'gemini-flash')).toThrow(/exactly one of --all or --cases/);
    expect(() => args('--models', 'gemini-flash', '--all', '--cases', 'S1')).toThrow(/exactly one/);
    expect(() => args('--models', 'gemini-flash', '--all', '--bogus')).toThrow(/unknown flag/);
    expect(() => args('--models')).toThrow(/needs a value/);
  });

  it('prints the plan as counts, not a token estimate', () => {
    const line = planLine(args('--models', 'gemini-flash,claude-sonnet', '--runs', '2', '--cases', 'S1,T3'), 2, 8);
    expect(line).toContain('2 cases × 2 runs × 2 models = 8 answer calls');
    expect(line).toMatch(/none is estimated/);
  });
});

describe('eval runner: the LIVE guard', () => {
  it('passes only for LIVE=1', () => {
    expect(liveGuardMessage({ LIVE: '1' })).toBeNull();
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) expect(liveGuardMessage({ LIVE: value }), String(value)).toMatch(/Refusing to run/);
  });

  it('makes the real script and the real conformance script exit non-zero without LIVE', () => {
    // No LIVE, no --yes, no credentials, and an empty stdin: were the guard ever to break, the
    // script would find nothing configured and read "no" at the confirmation, and spend nothing.
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key === 'LIVE' || /^(?:GOOGLE_|ANTHROPIC_|VERTEX_|GEMINI_|MODEL_)/.test(key)) delete env[key];
    for (const script of ['scripts/evalPrompt.ts', 'scripts/conformanceLive.ts']) {
      const run = spawnSync(process.execPath, ['--import', 'tsx', script, '--models', 'gemini-flash', '--all'], { cwd: BACKEND_DIR, env, encoding: 'utf8', input: '', timeout: 60_000 });
      expect(run.status, `${script}: ${run.stderr}`).toBe(2);
      expect(run.stderr, script).toMatch(/Refusing to run/);
    }
  }, 90_000);
});

describe('eval runner: judge plan (Stage 6 CXD-7)', () => {
  it('defaults to the other vendor: Gemini grades Claude, Sonnet grades Gemini', () => {
    expect(judgeFor('claude', {})).toBe('gemini-flash');
    expect(judgeFor('gemini', {})).toBe('claude-sonnet');
  });

  it('honours EVAL_JUDGE_FOR_CLAUDE / EVAL_JUDGE_FOR_GEMINI and refuses a same-vendor or unknown judge', () => {
    expect(judgeFor('gemini', { EVAL_JUDGE_FOR_GEMINI: 'claude-opus' })).toBe('claude-opus');
    expect(() => judgeFor('claude', { EVAL_JUDGE_FOR_CLAUDE: 'claude-opus' })).toThrow(/cross-vendor/);
    expect(() => judgeFor('gemini', { EVAL_JUDGE_FOR_GEMINI: 'gemini-flash' })).toThrow(/cross-vendor/);
    expect(() => judgeFor('gemini', { EVAL_JUDGE_FOR_GEMINI: 'nope' })).toThrow(/not one of/);
  });

  it('reads the verdict the way the kit does, and gives the judge only the test text and the answer', () => {
    expect(parseJudgeVerdict('Sure: {"pass": true, "reason": "ok"}')).toEqual({ pass: true });
    expect(parseJudgeVerdict('{"pass": "yes"}')).toBeNull();
    expect(parseJudgeVerdict('no json')).toBeNull();
    const c = loadCases().find((x) => x.id === 'T3')!;
    const message = judgeMessage(c, 'ANSWER', [{ name: 'memory_write', input: { text: 'x' } }]);
    expect(message).toContain(`EXPECTED: ${c.expect}`);
    expect(message).toContain('"name":"memory_write"');
    expect(JUDGE_SYSTEM).toMatch(/JSON only/);
  });
});

describe('eval runner: stamps and error codes', () => {
  it('stamps with the first 12 hex of a sha256, independent of tool order', () => {
    const a = { name: 'a', description: 'da', inputSchema: { type: 'object' } };
    const b = { name: 'b', description: 'db', inputSchema: { type: 'object' } };
    expect(promptStamp('static prompt')).toMatch(/^[0-9a-f]{12}$/);
    expect(promptStamp('static prompt')).toBe(promptStamp('static prompt'));
    expect(promptStamp('static prompt!')).not.toBe(promptStamp('static prompt'));
    expect(toolsStamp([a, b])).toBe(toolsStamp([b, a]));
    expect(toolsStamp([a, { ...b, description: 'changed' }])).not.toBe(toolsStamp([a, b]));
  });

  it('maps failures to stable codes, a 429 to rate_limited, and never to a message', () => {
    expect(errorCodeOf(new ProviderError('secret text', { statusCode: 429, retryable: true }))).toBe('rate_limited');
    expect(errorCodeOf(new ProviderError('x', { code: 'provider_limit', statusCode: 429 }))).toBe('provider_limit');
    expect(errorCodeOf(new ProviderError('x', { code: 'provider_quota_unavailable', statusCode: 429 }))).toBe('provider_quota_unavailable');
    expect(errorCodeOf(new ProviderError('x', { code: 'model_unavailable' }))).toBe('model_unavailable');
    expect(errorCodeOf(new ProviderError('x', { code: 'context_overflow' }))).toBe('context_overflow');
    expect(errorCodeOf(Object.assign(new Error('late'), { name: 'AbortError' }))).toBe('provider_timeout');
    expect(errorCodeOf(new Error('anything the provider echoed'))).toBe('provider_error');
  });
});

describe('eval runner: report invariants', () => {
  it('sums exact provider tokens, and one inexact record makes the model exact:false with zeros (Invariant 3)', () => {
    const exact = summarise([record(), record({ run: 2 })], 'gemini-flash');
    expect(exact.tokens).toEqual({ exact: true, input: 200, output: 40, cacheRead: 10, cacheWrite: 0 });
    const mixed = summarise([record(), record({ run: 2, tokens: NO_TOKENS })], 'gemini-flash');
    expect(mixed.tokens).toEqual({ exact: false, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    // A case that errored made no answer call: it is an error, and the answered ones still sum.
    const withError = summarise([record(), record({ run: 2, outcome: 'error:rate_limited', tokens: NO_TOKENS, costUsd: null, judgePass: null })], 'gemini-flash');
    expect(withError.tokens).toEqual({ exact: true, input: 100, output: 20, cacheRead: 5, cacheWrite: 0 });
    expect(withError.costUsd).toBe(0.001);
    expect(withError.errors).toBe(1);
  });

  it('keeps cost null when any call is unpriced, and a real 0 as 0 (Invariant 2)', () => {
    expect(summarise([record({ costUsd: null })], 'gemini-flash').costUsd).toBeNull();
    expect(summarise([record(), record({ run: 2, costUsd: null })], 'gemini-flash').costUsd).toBeNull();
    expect(summarise([record({ costUsd: 0 })], 'gemini-flash').costUsd).toBe(0);
    expect(summarise([], 'gemini-flash').costUsd).toBeNull();
  });

  it('computes C-gate rate, mean judge and variance across runs from the verdicts', () => {
    const records = [
      record({ caseId: 'S1', run: 1, judgePass: true }),
      record({ caseId: 'S1', run: 2, judgePass: false }),
      record({ caseId: 'S2', run: 1, judgePass: true }),
      record({ caseId: 'S2', run: 2, judgePass: true }),
      record({ caseId: 'LG1', gate: 'O', judgePass: null, judgeNote: 'observe' }),
      record({ caseId: 'S3', outcome: 'error:rate_limited', judgePass: null, tokens: NO_TOKENS, costUsd: null }),
    ];
    const s = summarise(records, 'gemini-flash');
    expect(s.cJudged).toBe(4);
    expect(s.cPassed).toBe(3);
    expect(s.cPassRate).toBeCloseTo(0.75);
    expect(s.cUnjudged).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.meanJudge).toBeCloseTo(0.75);
    // S1: scores 1,0 -> variance 0.25; S2: 1,1 -> 0; mean 0.125.
    expect(s.varianceAcrossRuns).toBeCloseTo(0.125);
    expect(summarise([record()], 'gemini-flash').varianceAcrossRuns).toBeNull();
    expect(summarise([], 'claude-opus').cPassRate).toBeNull();
  });

  it('renders an unpriced cost as null and unreported tokens as exact:false, never as 0', () => {
    const table = formatCaseTable([record({ costUsd: null, tokens: NO_TOKENS, outcome: 'error:rate_limited', judgePass: null, finishReason: 'none' })]);
    expect(table).toContain('| exact:false | null |');
    expect(table).toContain('error:rate_limited');
    expect(table).not.toMatch(/\| 0\.000000 \|/);
    expect(formatModelSummary([summarise([record({ tokens: NO_TOKENS, costUsd: null })], 'gemini-flash')])).toContain('exact:false | null |');
  });

  it('writes the commit summary from ids, verdicts, scores, tokens, codes and latencies only', () => {
    const meta = { utcDate: '2026-10-16', models: ['gemini-flash' as const], runs: 1, caseCount: 1, prompt12: 'abcdef012345', tools12: '0123456789ab', kitSha256: 'k'.repeat(64), judges: { gemini: 'claude-sonnet' } };
    const text = formatCommitSummary(meta, [record()]);
    expect(text).toContain('report-only');
    expect(text).toContain('abcdef012345');
    expect(text).toContain('| S1 | C | gemini-flash | 1 | ok | pass | 100/20/5 | 0.001000 | 1234 | stop | - |');
    expect(summaryFileName(meta)).toBe('2026-10-16-gemini-flash-abcdef012345.md');
    // A record type with a text field cannot be built: the type has none (compile-time), and
    // the formatter only reads the listed fields.
    expect(Object.keys(record()).sort()).toEqual(
      ['approximations', 'caseId', 'costUsd', 'finishReason', 'gate', 'group', 'judgeModel', 'label', 'judgeNote', 'judgePass', 'latencyMs', 'model', 'outcome', 'run', 'tokens', 'toolNames'].sort(),
    );
    expect(MODEL_KEYS).toEqual(['gemini-flash', 'claude-sonnet', 'claude-opus']);
  });
});

describe('extra cases (owner request, outside the master)', () => {
  const extras = loadExtraCases();

  it('adds exactly the three owner cases, live-only and report-only, without touching the master', () => {
    expect(extras.map((c) => c.id)).toEqual(['stop_then_greeting', 'missing_topic_excel', 'missing_topic_essay']);
    expect(extras.every((c) => c.gate === 'E')).toBe(true);
    expect(loadCases()).toHaveLength(68);
    expect(IDS).toHaveLength(71);
    expect(args('--models', 'gemini-flash', '--cases', 'stop_then_greeting,S1').caseIds).toEqual(['stop_then_greeting', 'S1']);
  });

  it('builds the stop-then-greeting request with the stopped partial as the earlier assistant turn', async () => {
    const c = extras.find((x) => x.id === 'stop_then_greeting')!;
    const run = await buildCaseRun(c, new Date('2026-10-14T09:30:00.000Z'));
    expect(run.history.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(run.history[0]!.text).toBe('500 words ku oru tamil essay eluthu');
    // Cut at a word: no closing full stop.
    expect(run.history[1]!.text.trimEnd().endsWith('.')).toBe(false);
    expect(run.prompt).toBe('hai');
    expect(run.scenario.toolNames).toEqual([]);
    const message = judgeMessage(c, 'x', []);
    expect(message).toContain("QUESTION: Did the reply answer 'hai' as a greeting without regenerating the earlier essay? (pass = yes)");
    expect(message).toContain('CONTEXT:');
  });

  it('labels a reply asked / built / other, and never as pass or fail', () => {
    expect(labelAskedOrBuilt('file', 'Which topic should the sheet be about?', [])).toBe('asked');
    expect(labelAskedOrBuilt('file', 'Done.', ['create_file', 'present_files'])).toBe('built');
    expect(labelAskedOrBuilt('file', 'Here you go.', [])).toBe('other');
    expect(labelAskedOrBuilt('essay', 'எந்த தலைப்பில் கட்டுரை வேண்டும்?', [])).toBe('asked');
    expect(labelAskedOrBuilt('essay', Array.from({ length: 200 }, (_, i) => `சொல்${String(i)}`).join(' '), [])).toBe('built');
    expect(labelAskedOrBuilt('essay', 'short statement without a question', [])).toBe('other');
  });

  it('keeps extras out of the kit table and the kit figures, and shows them apart', () => {
    const kit = record();
    const extra = record({ caseId: 'missing_topic_excel', gate: 'E', group: 'extra', label: 'asked', judgePass: null, judgeNote: 'label_only' });
    const summary = summarise([kit, extra], 'gemini-flash');
    expect(summary.records).toBe(1);
    expect(summary.cJudged).toBe(1);
    expect(formatCaseTable([kit, extra])).not.toContain('missing_topic_excel');
    expect(formatExtraTable([kit, extra])).toContain('| missing_topic_excel | gemini-flash | 1 | ok | - | asked |');
    expect(formatExtraTable([kit])).toContain('No extra cases');
    const doc = formatCommitSummary({ utcDate: '2026-10-16', models: ['gemini-flash'], runs: 1, caseCount: 68, prompt12: 'a'.repeat(12), tools12: 'b'.repeat(12), kitSha256: 'k'.repeat(64), judges: { gemini: 'claude-sonnet' } }, [kit, extra]);
    expect(doc).toMatch(/Extra cases \(owner request, outside the master; report-only/);
  });
});

/* -------------------------------------------------------------------------- static guards */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'eval-out') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('eval runner: the live path cannot be reached from CI, vitest or the application', () => {
  const liveSources = ['scripts/evalPrompt.ts', 'scripts/conformanceLive.ts', 'evals/prompt-kit/runner.ts'].map((p) => join(BACKEND_DIR, p));

  it('has the scripts and they are npm scripts, not part of test', () => {
    for (const file of liveSources) expect(existsSync(file), file).toBe(true);
    const pkg = JSON.parse(readFileSync(join(BACKEND_DIR, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['eval:prompt']).toContain('scripts/evalPrompt.ts');
    expect(pkg.scripts['conformance:live']).toContain('scripts/conformanceLive.ts');
    for (const key of ['test', 'test:watch', 'build', 'start', 'typecheck', 'lint']) {
      expect(pkg.scripts[key], key).not.toMatch(/eval:prompt|conformance:live|evalPrompt|conformanceLive/);
    }
  });

  it('is not named in CI or any workflow', () => {
    const dir = join(REPO, '.github', 'workflows');
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      expect(readFileSync(join(dir, name), 'utf8'), name).not.toMatch(/eval:prompt|conformance:live|LIVE\s*[:=]\s*['"]?1/);
    }
  });

  it('builds each case on its model\'s own v3 rendering and stamps each rendering\'s prompt version (P07)', () => {
    const runner = readFileSync(join(BACKEND_DIR, 'scripts', 'evalPrompt.ts'), 'utf8');
    expect(runner).toContain('buildCaseRun(c, new Date(), PROVIDER_OF[family])');
    expect(runner).toContain('const PROVIDER_OF: Record<Family, PromptProvider> = { gemini: \'google\', claude: \'anthropic\' };');
    expect(runner).toContain('promptVersion(PROVIDER_OF[f])');
    expect(runner).toContain('answerCase(c, backend, cfg, MODELS[model].family)');
  });

  it('is imported by no application or test file', () => {
    for (const file of walk(join(BACKEND_DIR, 'src'))) {
      if (file.endsWith('evalRunner.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, relative(BACKEND_DIR, file)).not.toMatch(/scripts\/(evalPrompt|conformanceLive)/);
    }
  });

  it('logs ids and codes only: no answer, prompt, judge-reason or error-message text', () => {
    for (const file of liveSources.filter((f) => f.includes('scripts'))) {
      const text = readFileSync(file, 'utf8');
      const logLines = text.split('\n').filter((l) => /console\.(log|error|warn)/.test(l));
      expect(logLines.length).toBeGreaterThan(0);
      for (const line of logLines) {
        const where = `${relative(BACKEND_DIR, file)}: ${line.trim()}`;
        expect(line, where).not.toMatch(/\.text\b|\.reason\b|judgeReason|answer\.text/);
        // Only the script's own usage messages may print an error message.
        if (/\.message\b/.test(line)) expect(line, where).toContain('eval:prompt:');
      }
    }
  });

  it('has no estimator, no sampling parameter and no retry in the live scripts or the kit', () => {
    for (const file of [...liveSources, join(BACKEND_DIR, 'evals/prompt-kit/kit.ts'), join(BACKEND_DIR, 'evals/prompt-kit/offlineGates.ts')]) {
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
        .join('\n');
      expect(code, file).not.toMatch(/tiktoken|gpt-tokenizer|countTokens|\/\s*4\)|\* 0\.75|\/ 3\.5/);
      expect(code, file).not.toMatch(/\b(?:temperature|top_p|top_k|topP|topK|maxRetries)\b|retry\(|attempt\s*<|while\s*\(\s*retries/i);
    }
  });
});

/* -------------------------------------------------------------------------- conformance checks */

const USAGE: ProviderUsage = { inputTokens: 40, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true };

/** A scripted provider: what it does with a request is chosen by the test, and nothing is reached. */
class ScriptedProvider implements Provider {
  readonly name = 'scripted';
  signature: string | undefined = 'sig-1';
  usage: ProviderUsage = USAGE;
  streams = true;
  useTool = true;
  badModel: 'typed' | 'untyped' | 'none' = 'typed';
  readonly seen: GenerationRequest[] = [];

  supportsGrounding(): boolean {
    return false;
  }

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    this.seen.push(request);
    if (request.providerModelId === 'arcnave-conformance-no-such-model') {
      if (this.badModel === 'typed') throw new ProviderError('missing', { code: 'model_unavailable', statusCode: 404 });
      if (this.badModel === 'untyped') throw new Error('boom');
      yield { type: 'delta', text: 'ok' };
      yield { type: 'completed', usage: this.usage, finishReason: 'stop' };
      return;
    }
    if (request.tools && request.tools.length > 0 && request.history.length === 0) {
      if (this.useTool) {
        const call = { id: 'c1', name: 'lookup_code', input: { code: 'ZX-41' } };
        yield { type: 'thinking', text: 't' };
        yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input, ...(this.signature ? { thoughtSignature: this.signature } : {}) };
        yield { type: 'tool_result', toolCallId: call.id, name: call.name, result: await request.toolExecutor!.execute(call, request.signal) };
      }
      yield { type: 'delta', text: 'The colour is purple.' };
      yield { type: 'completed', usage: this.usage, finishReason: 'stop' };
      return;
    }
    if (request.history.length > 0) {
      yield { type: 'delta', text: 'purple' };
      yield { type: 'completed', usage: this.usage, finishReason: 'stop' };
      return;
    }
    yield { type: 'delta', text: '1 2 3' };
    if (this.streams) yield { type: 'delta', text: ' 4 5' };
    yield { type: 'completed', usage: this.usage, finishReason: 'stop' };
  }

  probe(): Promise<void> {
    return Promise.resolve();
  }
}

const statuses = (rows: Awaited<ReturnType<typeof runConformance>>) => Object.fromEntries(rows.map((r) => [r.check, r.status]));

describe('provider conformance checks (scripted provider, nothing reached)', () => {
  const target = (provider: Provider, label = 'gemini') => ({ label, provider, providerModelId: 'm', effort: 'medium' as const });

  it('passes a provider that behaves, and replays the thought signature in history', async () => {
    const provider = new ScriptedProvider();
    const rows = await runConformance(target(provider));
    expect(statuses(rows)).toEqual({
      'streaming text': 'pass',
      'tool call round trip': 'pass',
      'exact usage metadata': 'pass',
      'thinking replay (in loop)': 'pass',
      'history replay (next turn)': 'pass',
      'typed error on bad model id': 'pass',
    });
    const replay = provider.seen.find((r) => r.history.length > 0)!;
    expect(replay.history[1]!.toolCalls![0]!.thoughtSignature).toBe('sig-1');
  });

  it('fails each check for the reason it checks', async () => {
    const noStream = new ScriptedProvider();
    noStream.streams = false;
    expect(statuses(await runConformance(target(noStream)))['streaming text']).toBe('fail');

    const inexact = new ScriptedProvider();
    inexact.usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, exact: false };
    expect(statuses(await runConformance(target(inexact)))['exact usage metadata']).toBe('fail');

    const unsigned = new ScriptedProvider();
    unsigned.signature = undefined;
    const gemini = statuses(await runConformance(target(unsigned, 'gemini')));
    expect(gemini['thinking replay (in loop)']).toBe('fail');
    // Claude has no per-call signature to surface; its block is replayed inside the adapter.
    expect(statuses(await runConformance(target(unsigned, 'claude')))['thinking replay (in loop)']).toBe('pass');

    const noTool = new ScriptedProvider();
    noTool.useTool = false;
    const skipped = statuses(await runConformance(target(noTool)));
    expect(skipped['tool call round trip']).toBe('fail');
    expect(skipped['thinking replay (in loop)']).toBe('skip');
    expect(skipped['history replay (next turn)']).toBe('skip');

    for (const badModel of ['untyped', 'none'] as const) {
      const p = new ScriptedProvider();
      p.badModel = badModel;
      expect(statuses(await runConformance(target(p)))['typed error on bad model id'], badModel).toBe('fail');
    }
  });

  it('prints a table of status and short codes, with no model text', async () => {
    const table = formatConformance(await runConformance(target(new ScriptedProvider())));
    expect(table).toContain('| gemini | streaming text | pass | deltas:2 finish:stop |');
    expect(table).not.toMatch(/purple|1 2 3/);
  });
});
