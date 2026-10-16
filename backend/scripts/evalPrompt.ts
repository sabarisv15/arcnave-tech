/**
 * Live prompt eval (tech-p03): runs the Stage 6 kit against the real providers and reports.
 *
 * OWNER-RUN ONLY. It spends provider quota, so it refuses unless LIVE=1, asks before spending
 * (or takes --yes), and is never called by vitest, CI or any other script. Usage:
 *
 *   $env:LIVE="1"; npm run eval:prompt -- --models gemini-flash,claude-sonnet --runs 3 --all --yes
 *
 * What runs: each case's request is built by the deployed prompt and tool builders
 * (`evals/prompt-kit/kit.ts`) and handed to the existing provider adapters, which run their usual
 * tool loop around mock tools. No new SDK call is made here, the SDK retry stays off, and there
 * is no retry loop: a failed case is recorded as `error:<code>` and the run moves on. A 429 is
 * `error:rate_limited`. A model that is not configured is `error:model_unavailable` for every
 * case; nothing is swapped for another model.
 *
 * What is not logged or committed: user text, model text, judge reasons (Stage 17 NO_CONTENT).
 * Full answers go to backend/eval-out/ (gitignored). The committed summary has ids, verdicts,
 * scores, provider-reported tokens, codes and latencies.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { loadConfig } from '../src/config.js';
import type { Config } from '../src/config.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { buildEntries } from '../src/providers/registry.js';
import type { Provider, ProviderUsage } from '../src/providers/types.js';
import { EMPTY_USAGE } from '../src/providers/types.js';
import { computeCost } from '../src/services/usage.js';
import { BACKEND_DIR, buildCaseRun, JUDGE_SYSTEM, judgeMessage, kitSha256, labelAskedOrBuilt, loadCases, loadExtraCases, MockToolExecutor, parseJudgeVerdict, toGenerationRequest } from '../evals/prompt-kit/kit.js';
import type { ExtraCase, RunnableCase } from '../evals/prompt-kit/kit.js';
import {
  errorCodeOf,
  formatCaseTable,
  formatExtraTable,
  formatCommitSummary,
  formatModelSummary,
  judgeFor,
  liveGuardMessage,
  MODELS,
  NO_TOKENS,
  parseArgs,
  planLine,
  promptStamp,
  RunnerUsageError,
  summarise,
  summaryFileName,
  toolsStamp,
} from '../evals/prompt-kit/runner.js';
import type { Family, ModelKey, RunRecord, Tokens } from '../evals/prompt-kit/runner.js';

/** Upper bound for one answer or judge call; the provider timeout (N-43) applies inside it too. */
const CASE_DEADLINE_MS = 10 * 60 * 1000;

interface Backend {
  provider: Provider | null;
  providerModelId: string | undefined;
  unavailable: string | null;
}

function backendFor(key: ModelKey, cfg: Config, providers: Record<Family, Provider>): Backend {
  const entry = buildEntries(cfg).find((e) => e.alias === MODELS[key].alias)!;
  if (entry.provider === 'google' && !cfg.vertexConfigured) return { provider: null, providerModelId: undefined, unavailable: 'vertex_not_configured' };
  if (entry.provider === 'anthropic' && !cfg.anthropicConfigured) return { provider: null, providerModelId: undefined, unavailable: 'anthropic_not_configured' };
  if (!entry.providerModelId) return { provider: null, providerModelId: undefined, unavailable: 'not_configured' };
  return { provider: providers[MODELS[key].family], providerModelId: entry.providerModelId, unavailable: null };
}

function tokensOf(usage: ProviderUsage): Tokens {
  return usage.exact
    ? { exact: true, input: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens }
    : NO_TOKENS;
}

interface Answer {
  text: string;
  finishReason: string;
  usage: ProviderUsage;
  calls: MockToolExecutor['calls'];
  approximations: number;
}

async function answerCase(c: RunnableCase, backend: Backend, cfg: Config): Promise<Answer> {
  const run = await buildCaseRun(c, new Date());
  const executor = new MockToolExecutor();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CASE_DEADLINE_MS);
  try {
    const request = toGenerationRequest(run, {
      providerModelId: backend.providerModelId!,
      maxOutputTokens: cfg.DEFAULT_MAX_OUTPUT_TOKENS,
      signal: controller.signal,
      toolExecutor: executor,
    });
    let text = '';
    let finishReason = 'none';
    let usage: ProviderUsage = EMPTY_USAGE;
    for await (const event of backend.provider!.stream(request)) {
      if (event.type === 'delta') text += event.text;
      else if (event.type === 'refusal') finishReason = 'refusal';
      else if (event.type === 'completed') {
        usage = event.usage;
        if (finishReason !== 'refusal') finishReason = event.finishReason;
      }
    }
    return { text, finishReason, usage, calls: executor.calls, approximations: run.approximations.length };
  } finally {
    clearTimeout(timer);
  }
}

async function judgeAnswer(c: RunnableCase, answer: Answer, judge: Backend): Promise<{ pass: boolean | null; note: string | null; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CASE_DEADLINE_MS);
  try {
    let reply = '';
    const request = {
      prompt: judgeMessage(c, answer.text, answer.calls),
      history: [],
      systemInstruction: JUDGE_SYSTEM,
      mode: 'chat' as const,
      // Room for a thinking judge: the verdict is one short JSON object after any reasoning.
      maxOutputTokens: 4000,
      providerModelId: judge.providerModelId!,
      grounded: false,
      codeExecution: false,
      signal: controller.signal,
    };
    for await (const event of judge.provider!.stream(request)) if (event.type === 'delta') reply += event.text;
    const verdict = parseJudgeVerdict(reply);
    return verdict ? { pass: verdict.pass, note: null, reason: reply } : { pass: null, note: 'judge_unparseable', reason: reply };
  } catch (err) {
    return { pass: null, note: `judge_error:${errorCodeOf(err)}`, reason: '' };
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

async function main(): Promise<number> {
  const guard = liveGuardMessage(process.env);
  if (guard) {
    console.error(guard);
    return 2;
  }

  const kitCases = loadCases();
  const extraCases = loadExtraCases();
  const extraIds = new Set(extraCases.map((c) => c.id));
  const allCases: RunnableCase[] = [...kitCases, ...extraCases];
  let args;
  try {
    args = parseArgs(process.argv.slice(2), allCases.map((c) => c.id));
  } catch (err) {
    if (err instanceof RunnerUsageError) {
      console.error(`eval:prompt: ${err.message}`);
      return 2;
    }
    throw err;
  }
  const cases = args.caseIds ? allCases.filter((c) => args.caseIds!.includes(c.id)) : allCases;

  const cfg = loadConfig(process.env);
  const providers: Record<Family, Provider> = { gemini: new GeminiProvider(cfg), claude: new AnthropicProvider(cfg) };
  const families = new Set(args.models.map((m) => MODELS[m].family));
  const judgeKeys = new Map<Family, ModelKey>();
  try {
    for (const f of families) judgeKeys.set(f, judgeFor(f, process.env));
  } catch (err) {
    console.error(`eval:prompt: ${(err as Error).message}`);
    return 2;
  }
  const backends = new Map<ModelKey, Backend>();
  for (const key of new Set([...args.models, ...judgeKeys.values()])) backends.set(key, backendFor(key, cfg, providers));

  const judged = cases.filter((c) => c.gate === 'C' || c.gate === 'S' || (c as ExtraCase).judge_question).length * args.runs * args.models.length;
  console.log(planLine(args, cases.length, judged));
  for (const [key, b] of backends) if (b.unavailable) console.log(`note: ${key} is unavailable (${b.unavailable}); its cases will be error:model_unavailable, never swapped for another model`);
  if (!args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // A closed stdin (piped, no terminal) answers "no" instead of leaving the question hanging.
    const closed = new Promise<string>((resolve) => rl.once('close', () => resolve('')));
    const reply = (await Promise.race([rl.question('This spends provider quota. Type "yes" to continue: '), closed])).trim().toLowerCase();
    rl.close();
    if (reply !== 'yes') {
      console.log('Not confirmed; nothing was run.');
      return 1;
    }
  }

  const canonical = await buildCaseRun(kitCases.find((c) => c.id === 'T1')!, new Date('2026-10-14T09:30:00.000Z'));
  const prompt12 = promptStamp(canonical.scenario.assembly.stablePrefix.systemText);
  const tools12 = toolsStamp(canonical.scenario.tools);
  console.log(`prompt version ${prompt12} · tools ${tools12} (same builder for both providers)`);

  const records: RunRecord[] = [];
  const answers: Array<Record<string, unknown>> = [];
  const jobs = cases.flatMap((c) => args.models.flatMap((model) => Array.from({ length: args.runs }, (_, i) => ({ c, model, run: i + 1 }))));

  await pool(jobs, args.concurrency, async ({ c, model, run }) => {
    const backend = backends.get(model)!;
    const group = extraIds.has(c.id) ? ('extra' as const) : ('kit' as const);
    const base = { caseId: c.id, gate: c.gate, group, label: null as string | null, model, run, judgeModel: null, judgeNote: null, costUsd: null, toolNames: [] as string[], approximations: 0 };
    const started = Date.now();
    let record: RunRecord;
    if (backend.unavailable) {
      record = { ...base, outcome: 'error:model_unavailable', judgePass: null, tokens: NO_TOKENS, latencyMs: 0, finishReason: backend.unavailable };
    } else {
      try {
        const answer = await answerCase(c, backend, cfg);
        const latencyMs = Date.now() - started;
        let judgePass: boolean | null = null;
        const judged = c.gate === 'C' || c.gate === 'S' || Boolean((c as ExtraCase).judge_question);
        let judgeNote: string | null = judged ? null : c.gate === 'O' ? 'observe' : 'label_only';
        let judgeModel: ModelKey | null = null;
        let reason = '';
        if (judged) {
          judgeModel = judgeKeys.get(MODELS[model].family)!;
          const jb = backends.get(judgeModel)!;
          if (jb.unavailable) {
            judgeNote = `judge_unavailable:${jb.unavailable}`;
          } else {
            const j = await judgeAnswer(c, answer, jb);
            judgePass = j.pass;
            judgeNote = j.note;
            reason = j.reason;
          }
        }
        record = {
          ...base,
          outcome: 'ok',
          judgePass,
          judgeModel,
          judgeNote,
          tokens: tokensOf(answer.usage),
          costUsd: computeCost(cfg, backend.providerModelId!, answer.usage),
          latencyMs,
          finishReason: answer.finishReason,
          toolNames: answer.calls.map((x) => x.name),
          approximations: answer.approximations,
          label: (c as ExtraCase).label_kind ? labelAskedOrBuilt((c as ExtraCase).label_kind!, answer.text, answer.calls.map((x) => x.name)) : null,
        };
        answers.push({ caseId: c.id, model, run, text: answer.text, calls: answer.calls, judgeReason: reason });
      } catch (err) {
        record = { ...base, outcome: `error:${errorCodeOf(err)}`, judgePass: null, tokens: NO_TOKENS, latencyMs: Date.now() - started, finishReason: 'none' };
      }
    }
    records.push(record);
    // Ids and codes only (NO_CONTENT).
    console.log(`${c.id.padEnd(4)} ${model.padEnd(13)} run ${String(run)} ${record.outcome} judge=${record.judgePass === null ? (record.judgeNote ?? '-') : record.judgePass ? 'pass' : 'fail'} ${String(record.latencyMs)}ms`);
  });

  records.sort((a, b) => a.caseId.localeCompare(b.caseId, 'en', { numeric: true }) || a.model.localeCompare(b.model) || a.run - b.run);
  console.log('\n' + formatCaseTable(records));
  console.log('\nExtra cases (report-only):\n' + formatExtraTable(records));
  console.log('\n' + formatModelSummary(args.models.map((m) => summarise(records, m))));

  const utcDate = new Date().toISOString().slice(0, 10);
  const meta = {
    utcDate,
    models: args.models,
    runs: args.runs,
    caseCount: cases.filter((c) => !extraIds.has(c.id)).length,
    prompt12,
    tools12,
    kitSha256: kitSha256(),
    judges: Object.fromEntries([...judgeKeys].map(([f, j]) => [f, j])),
  };
  if (!records.some((r) => r.outcome === 'ok')) {
    // A run in which nothing was answered measured nothing; it leaves no file to commit by mistake.
    console.log('\nNo case was answered; no result file written.');
    return 1;
  }
  const outDir = join(BACKEND_DIR, 'eval-out');
  mkdirSync(outDir, { recursive: true });
  const docsDir = join(BACKEND_DIR, '..', 'docs', 'ops', 'eval-runs');
  mkdirSync(docsDir, { recursive: true });
  // Two runs on one day with one prompt and one model set must not overwrite each other.
  let stamp = summaryFileName(meta).replace(/\.md$/, '');
  for (let n = 2; existsSync(join(docsDir, `${stamp}.md`)); n += 1) stamp = `${summaryFileName(meta).replace(/\.md$/, '')}-${String(n)}`;
  writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify({ meta, records, answers }, null, 1));
  const summaryPath = join(docsDir, `${stamp}.md`);
  writeFileSync(summaryPath, formatCommitSummary(meta, records));
  console.log(`\nfull answers (not for commit): eval-out/${stamp}.json\ncommit-able summary: ${summaryPath}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`eval:prompt failed: ${err instanceof Error ? err.name : 'error'}`);
    process.exit(1);
  },
);
