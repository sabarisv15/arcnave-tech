/**
 * The live runner's pure parts (tech-p03): arguments, the LIVE guard, the judge plan, version
 * stamps, error codes, and the two report formats. No provider, no file, no clock here, so the
 * offline test (`src/test/evalRunner.test.ts`) covers all of it without reaching anything.
 *
 * Invariants kept by construction:
 * - Tokens are the provider's (`exact`) or zeros with `exact:false`; this file sums and never
 *   estimates (Invariant 3).
 * - A cost is `null` unless the existing pricing function priced it; `0` is never defaulted
 *   (Invariant 2).
 * - The commit-able summary carries ids, verdicts, scores, tokens, codes and latencies only; no
 *   model text, no judge reason, no prompt text (Stage 17 NO_CONTENT).
 */
import { createHash } from 'node:crypto';

import type { ToolDefinition } from '../../src/providers/types.js';
import { ProviderError } from '../../src/providers/types.js';
import type { KitCase } from './kit.js';

/** The master's gates, or `E` for an owner-added extra case (report-only). */
export type RecordGate = KitCase['gate'] | 'E';

/* -------------------------------------------------------------------------- models */

export const MODEL_KEYS = ['gemini-flash', 'claude-sonnet', 'claude-opus'] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];
export type Family = 'gemini' | 'claude';

export const MODELS: Record<ModelKey, { alias: string; family: Family }> = {
  'gemini-flash': { alias: 'Gemini 3.8 Flash', family: 'gemini' },
  'claude-sonnet': { alias: 'Sonnet 5.5', family: 'claude' },
  'claude-opus': { alias: 'Opus 5.5', family: 'claude' },
};

/** Stage 6 CXD-7: an answer is judged by the other vendor. The two env names are the contract. */
export const JUDGE_ENV: Record<Family, string> = { claude: 'EVAL_JUDGE_FOR_CLAUDE', gemini: 'EVAL_JUDGE_FOR_GEMINI' };
export const JUDGE_DEFAULT: Record<Family, ModelKey> = { claude: 'gemini-flash', gemini: 'claude-sonnet' };

export function judgeFor(family: Family, env: Record<string, string | undefined>): ModelKey {
  const raw = env[JUDGE_ENV[family]]?.trim();
  if (!raw) return JUDGE_DEFAULT[family];
  if (!(MODEL_KEYS as readonly string[]).includes(raw)) {
    throw new RunnerUsageError(`${JUDGE_ENV[family]}="${raw}" is not one of ${MODEL_KEYS.join(', ')}`);
  }
  const judge = raw as ModelKey;
  if (MODELS[judge].family === family) {
    throw new RunnerUsageError(`${JUDGE_ENV[family]}="${raw}" is the same vendor as the answers it grades; the judge must be cross-vendor (Stage 6 CXD-7)`);
  }
  return judge;
}

/* -------------------------------------------------------------------------- arguments */

export class RunnerUsageError extends Error {}

export interface RunnerArgs {
  models: ModelKey[];
  runs: number;
  /** null means every case. */
  caseIds: string[] | null;
  yes: boolean;
  concurrency: number;
}

/** The refusal when the run is not explicitly live. Checked before anything else. */
export function liveGuardMessage(env: Record<string, string | undefined>): string | null {
  if (env['LIVE'] === '1') return null;
  return (
    'Refusing to run: this script calls paid model providers and runs only when LIVE=1 is set ' +
    'on purpose. It never runs in CI or under vitest.\n' +
    'PowerShell: $env:LIVE="1"; npm run eval:prompt -- --models gemini-flash --runs 1 --cases S1,T3 --yes'
  );
}

export function parseArgs(argv: string[], knownCaseIds: readonly string[]): RunnerArgs {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new RunnerUsageError(`unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (['all', 'yes'].includes(name)) {
      flags.set(name, true);
    } else if (['models', 'runs', 'cases', 'concurrency'].includes(name)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new RunnerUsageError(`--${name} needs a value`);
      flags.set(name, value);
      i += 1;
    } else {
      throw new RunnerUsageError(`unknown flag --${name}`);
    }
  }

  const modelsRaw = flags.get('models');
  if (typeof modelsRaw !== 'string') throw new RunnerUsageError(`--models is required (${MODEL_KEYS.join(', ')}; there is no default)`);
  const models = [...new Set(modelsRaw.split(',').map((m) => m.trim()).filter(Boolean))];
  for (const m of models) {
    if (!(MODEL_KEYS as readonly string[]).includes(m)) throw new RunnerUsageError(`unknown model "${m}" (${MODEL_KEYS.join(', ')})`);
  }
  if (models.length === 0) throw new RunnerUsageError('--models is empty');

  const runs = flags.has('runs') ? Number(flags.get('runs')) : 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new RunnerUsageError('--runs must be a whole number from 1 to 20');

  const concurrency = flags.has('concurrency') ? Number(flags.get('concurrency')) : 3;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new RunnerUsageError('--concurrency must be a whole number from 1 to 8');

  const casesRaw = flags.get('cases');
  const all = flags.get('all') === true;
  if (all === (typeof casesRaw === 'string')) throw new RunnerUsageError('give exactly one of --all or --cases id,id');
  let caseIds: string[] | null = null;
  if (typeof casesRaw === 'string') {
    caseIds = [...new Set(casesRaw.split(',').map((c) => c.trim()).filter(Boolean))];
    const unknown = caseIds.filter((id) => !knownCaseIds.includes(id));
    if (caseIds.length === 0 || unknown.length > 0) throw new RunnerUsageError(`unknown case id(s): ${unknown.join(', ') || '(none given)'}`);
  }

  return { models: models as ModelKey[], runs, caseIds, yes: flags.get('yes') === true, concurrency };
}

/** What the run will do, as the confirm prompt prints it: counts only, never a token estimate. */
export function planLine(args: RunnerArgs, caseCount: number, judged: number): string {
  const answers = caseCount * args.runs * args.models.length;
  return (
    `${String(caseCount)} cases × ${String(args.runs)} runs × ${String(args.models.length)} models = ${String(answers)} answer calls, ` +
    `plus up to ${String(judged)} judge calls (cross-vendor). Token counts come from the providers after the run; none is estimated here.`
  );
}

/* -------------------------------------------------------------------------- stamps */

const sha12 = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

/** First 12 hex of the sha256 of the assembled static system prompt. */
export function promptStamp(stableSystemText: string): string {
  return sha12(stableSystemText);
}

/** First 12 hex of the sha256 of the tool declarations, in name order, as sent. */
export function toolsStamp(tools: ToolDefinition[]): string {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  return sha12(JSON.stringify(sorted));
}

/* -------------------------------------------------------------------------- errors */

/** The stable code a failed case carries; never the provider's message (it can echo content). */
export function errorCodeOf(err: unknown): string {
  if (err instanceof ProviderError) {
    // Only an ordinary 429 is "rate limited". A spend cap (provider_limit) and a quota of zero
    // (provider_quota_unavailable) are configuration, keep their own code so nobody retries them.
    if (err.statusCode === 429 && err.code === 'provider_error') return 'rate_limited';
    return err.code;
  }
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return 'provider_timeout';
  return 'provider_error';
}

/* -------------------------------------------------------------------------- records */

export interface Tokens {
  exact: boolean;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface RunRecord {
  caseId: string;
  gate: RecordGate;
  /** `extra` for cases outside the Stage 6 master; they never enter the kit's C-gate or means. */
  group: 'kit' | 'extra';
  /** For the "missing topic" extras: `asked` / `built` / `other`. A label, not a verdict. */
  label: string | null;
  model: ModelKey;
  run: number;
  /** `ok`, or `error:<code>`. */
  outcome: string;
  /** Judge verdict: true / false, or null when not judged (observe case, error, judge failure). */
  judgePass: boolean | null;
  judgeModel: ModelKey | null;
  /** Why there is no verdict, as a code. */
  judgeNote: string | null;
  tokens: Tokens;
  /** The price of the answer call, or null: no verified price, or not exact. Never 0 by default. */
  costUsd: number | null;
  latencyMs: number;
  finishReason: string;
  /** Tool names in call order (mocks); the kit does not run them. */
  toolNames: string[];
  approximations: number;
}

export const NO_TOKENS: Tokens = { exact: false, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** 1 for a pass, 0 for a fail, null when there is no verdict. */
export const scoreOf = (r: RunRecord): number | null => (r.judgePass === null ? null : r.judgePass ? 1 : 0);

export interface ModelSummary {
  model: ModelKey;
  records: number;
  errors: number;
  /** Gate C records with a verdict, and how many passed. */
  cJudged: number;
  cPassed: number;
  cUnjudged: number;
  /** passed / judged, or null when nothing was judged. */
  cPassRate: number | null;
  meanJudge: number | null;
  /** Mean over cases (with 2+ judged runs) of the population variance of the score. Null with one run. */
  varianceAcrossRuns: number | null;
  tokens: Tokens;
  /** Sum of priced calls, or null when any answer call has no price. */
  costUsd: number | null;
}

export function summarise(records: RunRecord[], model: ModelKey): ModelSummary {
  const mine = records.filter((r) => r.model === model && r.group === 'kit');
  const c = mine.filter((r) => r.gate === 'C');
  const cJudged = c.filter((r) => r.judgePass !== null);
  const scores = mine.map(scoreOf).filter((s): s is number => s !== null);

  const byCase = new Map<string, number[]>();
  for (const r of mine) {
    const s = scoreOf(r);
    if (s !== null) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), s]);
  }
  const variances = [...byCase.values()]
    .filter((v) => v.length >= 2)
    .map((v) => {
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length;
    });

  // Answer calls only: a case that errored made no answer call whose count is known, so it is
  // counted in `errors`, not in the sum. Among answered cases one missing count makes the sum
  // exact:false with zeros (Invariant 3), never a part shown as the whole.
  const answered = mine.filter((r) => r.outcome === 'ok');
  const allExact = answered.length > 0 && answered.every((r) => r.tokens.exact);
  const tokens: Tokens = allExact
    ? {
        exact: true,
        input: answered.reduce((a, r) => a + r.tokens.input, 0),
        output: answered.reduce((a, r) => a + r.tokens.output, 0),
        cacheRead: answered.reduce((a, r) => a + r.tokens.cacheRead, 0),
        cacheWrite: answered.reduce((a, r) => a + r.tokens.cacheWrite, 0),
      }
    : NO_TOKENS;

  return {
    model,
    records: mine.length,
    errors: mine.filter((r) => r.outcome !== 'ok').length,
    cJudged: cJudged.length,
    cPassed: cJudged.filter((r) => r.judgePass === true).length,
    cUnjudged: c.length - cJudged.length,
    cPassRate: cJudged.length === 0 ? null : cJudged.filter((r) => r.judgePass === true).length / cJudged.length,
    meanJudge: scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length,
    varianceAcrossRuns: variances.length === 0 ? null : variances.reduce((a, b) => a + b, 0) / variances.length,
    tokens,
    costUsd: answered.length > 0 && answered.every((r) => r.costUsd !== null) ? answered.reduce((a, r) => a + (r.costUsd ?? 0), 0) : null,
  };
}

/* -------------------------------------------------------------------------- formats */

const pct = (v: number | null): string => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null, digits = 3): string => (v === null ? 'n/a' : v.toFixed(digits));
const tok = (t: Tokens): string => (t.exact ? `${String(t.input)}/${String(t.output)}/${String(t.cacheRead)}` : 'exact:false');
const usd = (v: number | null): string => (v === null ? 'null' : v.toFixed(6));

export function formatCaseTable(all: RunRecord[]): string {
  const rows = all.filter((r) => r.group === 'kit').map(
    (r) =>
      `| ${r.caseId} | ${r.gate} | ${r.model} | ${String(r.run)} | ${r.outcome} | ${r.judgePass === null ? (r.judgeNote ?? '-') : r.judgePass ? 'pass' : 'fail'} | ` +
      `${tok(r.tokens)} | ${usd(r.costUsd)} | ${String(r.latencyMs)} | ${r.finishReason} | ${r.toolNames.slice(0, 6).join('+') || '-'} |`,
  );
  return [
    '| case | gate | model | run | outcome | judge | tokens in/out/cached | costUsd | latency ms | finish | tools |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/** The owner-added cases, shown apart from the kit: judge score or label only, never a gate. */
export function formatExtraTable(all: RunRecord[]): string {
  const extra = all.filter((r) => r.group === 'extra');
  if (extra.length === 0) return '_No extra cases in this run._';
  return [
    '| extra case | model | run | outcome | judge | label | tokens in/out/cached | costUsd | latency ms | finish | tools |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...extra.map(
      (r) =>
        `| ${r.caseId} | ${r.model} | ${String(r.run)} | ${r.outcome} | ${r.judgePass === null ? '-' : r.judgePass ? 'yes' : 'no'} | ${r.label ?? '-'} | ` +
        `${tok(r.tokens)} | ${usd(r.costUsd)} | ${String(r.latencyMs)} | ${r.finishReason} | ${r.toolNames.slice(0, 6).join('+') || '-'} |`,
    ),
  ].join('\n');
}

export function formatModelSummary(summaries: ModelSummary[]): string {
  return [
    '| model | records | errors | C-gate pass | C judged | C unjudged | mean judge | variance across runs | tokens in/out/cached | costUsd |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...summaries.map(
      (s) =>
        `| ${s.model} | ${String(s.records)} | ${String(s.errors)} | ${pct(s.cPassRate)} (${String(s.cPassed)}/${String(s.cJudged)}) | ${String(s.cJudged)} | ${String(s.cUnjudged)} | ` +
        `${num(s.meanJudge)} | ${num(s.varianceAcrossRuns)} | ${tok(s.tokens)} | ${usd(s.costUsd)} |`,
    ),
  ].join('\n');
}

export interface SummaryMeta {
  utcDate: string;
  models: ModelKey[];
  runs: number;
  caseCount: number;
  prompt12: string;
  tools12: string;
  kitSha256: string;
  judges: Record<string, string>;
}

/** The file committed under docs/ops/eval-runs/: no model text, by construction. */
export function formatCommitSummary(meta: SummaryMeta, records: RunRecord[]): string {
  const summaries = meta.models.map((m) => summarise(records, m));
  return [
    `# Prompt eval run ${meta.utcDate} · ${meta.models.join(', ')} · prompt ${meta.prompt12}`,
    '',
    `- prompt version: static system prompt sha256[:12] = \`${meta.prompt12}\`; tool declarations sha256[:12] = \`${meta.tools12}\``,
    `- kit: \`06-eval-cases-v1.json\` sha256 \`${meta.kitSha256}\`; ${String(meta.caseCount)} cases × ${String(meta.runs)} runs`,
    `- judges (cross-vendor, report-only until calibrated): ${Object.entries(meta.judges).map(([k, v]) => `${k} answers → ${v}`).join('; ')}`,
    '- judge verdicts are **report-only**: they gate nothing until the judge is calibrated.',
    '- tokens are the provider\'s own (`exact`) or `exact:false` with zeros; costUsd is `null` where no verified price exists. Neither is ever estimated.',
    '- tokens and cost in the per-model table are the answer calls of answered kit cases only: errored cases, extra cases and judge calls are not in them.',
    '- no model text, judge reason or prompt text is in this file.',
    '',
    '## Per model',
    '',
    formatModelSummary(summaries),
    '',
    '## Per case (Stage 6 kit)',
    '',
    formatCaseTable(records),
    '',
    '## Extra cases (owner request, outside the master; report-only, never part of the figures above)',
    '',
    formatExtraTable(records),
    '',
  ].join('\n');
}

/** `<UTC date>-<models>-<prompt12>.md` */
export function summaryFileName(meta: Pick<SummaryMeta, 'utcDate' | 'models' | 'prompt12'>): string {
  return `${meta.utcDate}-${meta.models.join('+')}-${meta.prompt12}.md`;
}
