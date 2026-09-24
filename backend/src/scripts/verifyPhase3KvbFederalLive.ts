/**
 * Phase 3 final live acceptance on the REAL kvbfedral.pdf. Local/dev only; spends Vertex quota.
 *
 *   npx tsx src/scripts/verifyPhase3KvbFederalLive.ts --pdf /path/to/kvbfedral.pdf \
 *     [--model <alias>] [--kvb-pages 1-3] [--out var/phase3-live]
 *
 * Needs Postgres (DATABASE_URL, migrated) and Application Default Credentials
 * (`gcloud auth application-default login`) with GOOGLE_CLOUD_PROJECT set. Nothing here is
 * deployed and no Cloud Run resource is touched: the sandbox is the local process engine.
 *
 * The model is real and gets only the natural prompt below. The script never calls a tool
 * itself. Afterwards it verifies the result independently of the model:
 *
 *   - pages: every page rendered and read, from the vision calls actually made;
 *   - KVB: debit and credit rows counted from the stored row array against the statement's own
 *     printed summary (Debit 41, Credit 7), never against any earlier answer;
 *   - Federal: per-page rows, running-balance reconciliation, duplicates, low-confidence rows;
 *   - classification: taken from the model's `classify` result (rows + labels), with every
 *     total recomputed here per bank and combined;
 *   - anchoring: whether 163, 211 or 277 appear anywhere the model wrote.
 *
 * Output: evidence.md and evidence.json in the --out directory, and a single verdict line.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { toolCalls } from '../db/schema.js';
import { AnthropicVertexProvider } from '../providers/anthropicVertex.js';
import { GeminiProvider } from '../providers/gemini.js';
import { GptOssVertexProvider } from '../providers/gptOssVertex.js';
import type { AttachmentBlock, Provider } from '../providers/types.js';
import { ScannedTableExtractor, type StoredExtraction } from '../services/tables/scannedTableExtraction.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import { ProcessSandboxClient } from '../tools/sandbox/processSandboxClient.js';
import { isTransaction, mapColumns, num, runningBalance, segmentsFromHeaders, type Row } from './phase3Evidence.js';

const PROMPT = 'Count every transaction exactly and classify them with party name and without party name.';
const PRINTED_KVB = { debit: 41, credit: 7 };
const ANCHORS = ['163', '211', '277'];

/* ------------------------------------------------------------------------------ args */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function range(spec: string | undefined): [number, number] | null {
  if (!spec) return null;
  const m = /^(\d+)-(\d+)$/.exec(spec);
  if (!m) throw new Error(`--kvb-pages must look like 1-3, got "${spec}"`);
  return [Number(m[1]), Number(m[2])];
}

/* ------------------------------------------------------------------------------ instrumented pieces */

interface VisionCall {
  kind: 'page' | 'crop' | 'upload_ocr' | 'visual_qa' | 'other';
  page: number | null;
  ms: number;
  ok: boolean;
  imageBytes: number;
}

function instrumentVision(provider: GeminiProvider, calls: VisionCall[]): Provider {
  const original = provider.describeMedia.bind(provider);
  provider.describeMedia = async (parts: AttachmentBlock[], prompt: string, signal: AbortSignal) => {
    const kind: VisionCall['kind'] = prompt.includes('enlarged crop')
      ? 'crop'
      : prompt.includes('of a scanned document. Extract')
        ? 'page'
        : prompt.startsWith('Transcribe every word')
          ? 'upload_ocr'
          : prompt.includes('visual QA inspector')
            ? 'visual_qa'
            : 'other';
    const page = Number(/page (\d+)/.exec(prompt)?.[1] ?? NaN);
    const started = Date.now();
    const imageBytes = parts.reduce((n, p) => n + (p.base64 ? Math.floor((p.base64.length * 3) / 4) : 0), 0);
    try {
      const out = await original(parts, prompt, signal);
      calls.push({ kind, page: Number.isNaN(page) ? null : page, ms: Date.now() - started, ok: true, imageBytes });
      return out;
    } catch (err) {
      calls.push({ kind, page: Number.isNaN(page) ? null : page, ms: Date.now() - started, ok: false, imageBytes });
      throw err;
    }
  };
  return provider;
}

class TimedRuntime extends ExecutionRuntime {
  readonly cli: Array<{ utility: string; args: string[]; ms: number; exitCode: number }> = [];
  readonly scripts: Array<{ resource: string; ms: number; ok: boolean }> = [];

  override async executeControlledCli(
    utility: string,
    args: string[],
    options?: Parameters<ExecutionRuntime['executeControlledCli']>[2],
  ) {
    const started = Date.now();
    const res = await super.executeControlledCli(utility, args, options);
    this.cli.push({ utility, args, ms: Date.now() - started, exitCode: res.exitCode });
    return res;
  }

  override async runSkillScriptJson(...a: Parameters<ExecutionRuntime['runSkillScriptJson']>) {
    const started = Date.now();
    const res = await super.runSkillScriptJson(...a);
    this.scripts.push({ resource: a[0].resource, ms: Date.now() - started, ok: res.ok });
    return res;
  }
}

/* ------------------------------------------------------------------------------ main */

async function main() {
  try {
    process.loadEnvFile?.('.env');
  } catch {
    // No .env: the environment already carries the configuration.
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run with NODE_ENV=production.');
  const pdfPath = arg('pdf');
  if (!pdfPath) throw new Error('Usage: --pdf /path/to/kvbfedral.pdf');
  const kvbOverride = range(arg('kvb-pages'));
  const outDir = path.resolve(arg('out') ?? path.join('var', 'phase3-live', new Date().toISOString().replace(/[:.]/g, '-')));
  await fs.mkdir(outDir, { recursive: true });

  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phase3-live-'));
  const cfg = loadConfig({
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    ENABLE_TOOL_USE: 'true',
    ENABLE_SKILLS: 'true',
    ENABLE_TRUSTED_CLI: 'true',
    ENABLE_SKILL_SCRIPTS: 'true',
    ENABLE_RUN_PYTHON: 'false',
    SANDBOX_ENGINE: 'process',
    STORAGE_BACKEND: 'local',
    STORAGE_LOCAL_PATH: storageRoot,
    MAX_UPLOAD_BYTES: String(50 * 1024 * 1024),
    RATE_LIMIT_AUTH_PER_MINUTE: '1000',
  });
  if (!cfg.GOOGLE_CLOUD_PROJECT) throw new Error('GOOGLE_CLOUD_PROJECT is not set.');

  const vision: VisionCall[] = [];
  const google = new GeminiProvider(cfg);
  instrumentVision(google, vision);
  const sandbox = new ProcessSandboxClient({
    codeTimeoutMs: cfg.RUN_PYTHON_CODE_TIMEOUT_MS,
    maxStdoutBytes: cfg.MAX_STDOUT_BYTES,
    maxStderrBytes: cfg.MAX_STDERR_BYTES,
    maxCodeBytes: cfg.MAX_CODE_BYTES,
  });
  const runtime = new TimedRuntime(sandbox, undefined, {
    pythonAllowed: false,
    trustedCliAllowed: true,
    skillScriptAllowed: true,
  });
  const app = await createApp(cfg, {
    providers: { google, anthropic: new AnthropicVertexProvider(cfg), 'openai-oss': new GptOssVertexProvider(cfg) },
    sandboxClient: sandbox,
    executionRuntime: runtime,
  });
  await app.ready();
  const { db, storage } = app.services;
  const started = Date.now();

  try {
    // --- user, upload, chat --------------------------------------------------------------
    const email = `phase3-live-${Date.now()}@example.test`;
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'phase3-live-acceptance-pw', name: 'Phase 3 live' },
    });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
    const cookie = ([] as string[]).concat(reg.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
    const userId = (reg.json() as { user: { id: string } }).user.id;

    const pdf = await fs.readFile(pdfPath);
    const boundary = `----phase3${Date.now()}`;
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(pdfPath)}"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploadStarted = Date.now();
    const up = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    if (up.statusCode !== 201) throw new Error(`upload failed: ${up.body}`);
    const fileId = (up.json() as { id: string }).id;
    const uploadMs = Date.now() - uploadStarted;

    const chat = await app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie }, payload: { title: 'Phase 3 live' } });
    const chatId = (chat.json() as { id: string }).id;

    // --- the turn: natural prompt only ----------------------------------------------------
    const turnStarted = Date.now();
    const gen = await app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { cookie },
      payload: { prompt: PROMPT, attachmentIds: [fileId], ...(arg('model') ? { model: arg('model') } : {}) },
    });
    const turnMs = Date.now() - turnStarted;
    const events = gen.body
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as Record<string, any>);
    const start = events.find((e) => e.type === 'start');
    const debug = events.find((e) => e.type === 'debug')?.trace;
    const done = events.find((e) => e.type === 'done');
    const error = events.find((e) => e.type === 'error');
    const finalText = events.filter((e) => e.type === 'delta').map((e) => e.text as string).join('');
    const messageId: string | undefined = start?.messageId;

    const calls = messageId
      ? await db.select().from(toolCalls).where(eq(toolCalls.messageId, messageId)).orderBy(toolCalls.ordinal)
      : [];
    const flat = (content: unknown) =>
      (content as Array<{ type: string; text?: string; data?: unknown }>)
        .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c.data)))
        .join('');
    const trace = calls.map((c) => ({ name: c.name, input: c.input, ok: c.ok, result: flat(c.content) }));

    // --- the stored extraction -------------------------------------------------------------
    const extractionIds = [
      ...new Set(
        trace
          .filter((t) => t.name === 'extract_scanned_table_rows' && t.ok)
          .map((t) => {
            try {
              return (JSON.parse(t.result) as { extractionId?: string }).extractionId;
            } catch {
              return undefined;
            }
          })
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    const stored: StoredExtraction | null = extractionIds.length
      ? (JSON.parse(
          (await storage.get(ScannedTableExtractor.storageKey(userId, extractionIds.at(-1)!)!)).toString('utf8'),
        ) as StoredExtraction)
      : null;

    // --- independent verification -----------------------------------------------------------
    const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
    const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

    const called = trace.map((t) => t.name);
    check('model loaded the pdf skill', trace.some((t) => t.name === 'load_skill' && JSON.stringify(t.input).includes('pdf')), called.join(' → '));
    check('model extracted rows', called.includes('extract_scanned_table_rows'), '');
    check('model computed with analyze_table_rows', called.includes('analyze_table_rows'), '');
    check('turn completed (no error, no tool_limit)', !error && done?.finishReason !== 'tool_limit', error ? `${error.code}: ${error.detail}` : `finishReason=${done?.finishReason}`);

    const pageCalls = vision.filter((v) => v.kind === 'page');
    const pagesRead = [...new Set(pageCalls.filter((v) => v.ok).map((v) => v.page))].sort((a, b) => a! - b!);
    const report: Record<string, unknown> = { fileId, chatId, messageId, trace, finalText, debug, done, error, vision, cli: runtime.cli, scripts: runtime.scripts };

    let kvb: Record<string, unknown> = {};
    let federal: Record<string, unknown> = {};
    let classification: Record<string, unknown> = {};

    if (!stored) {
      check('an extraction exists', false, 'the model never produced a stored extraction');
    } else {
      const t = stored.table;
      const all = Array.from({ length: stored.pageCount }, (_, i) => i + 1);
      check('12 pages detected', stored.pageCount === 12, `pageCount=${stored.pageCount}`);
      check('every page rendered and read', all.every((p) => pagesRead.includes(p)), `read=${pagesRead.join(',')}`);
      check('no failed pages', t.failedPages.length === 0, `failed=${t.failedPages.join(',') || 'none'}`);
      check(
        'every row has page, rowIndex, cells, confidence',
        t.rows.every((r) => r.page >= 1 && r.rowIndex >= 1 && Array.isArray(r.cells) && typeof r.confidence === 'number'),
        `${t.rows.length} rows; ${t.rows.filter((r) => r.sourceRegion).length} with sourceRegion`,
      );

      const segs = kvbOverride
        ? [
            { from: kvbOverride[0], to: kvbOverride[1], header: stored.table.headersSeen.find((h) => h.page >= kvbOverride[0])?.cells ?? t.header ?? [] },
            { from: kvbOverride[1] + 1, to: stored.pageCount, header: stored.table.headersSeen.find((h) => h.page > kvbOverride[1])?.cells ?? t.header ?? [] },
          ]
        : segmentsFromHeaders(stored);
      check(
        'two statements identified (KVB then Federal)',
        segs.length === 2,
        segs.map((s) => `pages ${s.from}-${s.to}: [${s.header.join(' | ')}]`).join('; ') + (kvbOverride ? ' (from --kvb-pages)' : ' (from header rows)'),
      );
      const [kSeg, fSeg] = segs;
      const inSeg = (s: { from: number; to: number } | undefined) => (r: Row) => !!s && r.page >= s.from && r.page <= s.to;

      if (kSeg) {
        const c = mapColumns(kSeg.header);
        const rows = t.rows.filter(inSeg(kSeg));
        const tx = rows.filter((r) => isTransaction(r, c));
        const debits = tx.filter((r) => c.debit !== null && (num(r.cells[c.debit]) ?? 0) !== 0).length;
        const credits = tx.filter((r) => c.credit !== null && (num(r.cells[c.credit]) ?? 0) !== 0).length;
        const expected = PRINTED_KVB.debit + PRINTED_KVB.credit;
        kvb = { pages: `${kSeg.from}-${kSeg.to}`, columns: c, rows: rows.length, transactions: tx.length, debits, credits, balance: runningBalance(rows, c) };
        check(`KVB transactions = ${expected} (printed Debit ${PRINTED_KVB.debit} + Credit ${PRINTED_KVB.credit})`, tx.length === expected, `extracted ${tx.length} (debit ${debits}, credit ${credits})`);
        check('KVB debit/credit split matches printed summary', debits === PRINTED_KVB.debit && credits === PRINTED_KVB.credit, `debit ${debits}, credit ${credits}`);
      }
      if (fSeg) {
        const c = mapColumns(fSeg.header);
        const rows = t.rows.filter(inSeg(fSeg));
        const tx = rows.filter((r) => isTransaction(r, c));
        const bal = runningBalance(rows, c);
        const perPage = Array.from({ length: fSeg.to - fSeg.from + 1 }, (_, i) => fSeg.from + i).map((p) => {
          const pr = tx.filter((r) => r.page === p);
          const describe = (r?: Row) => (r ? `${c.date !== null ? r.cells[c.date] : ''} ${c.narration !== null ? r.cells[c.narration] : r.cells.join(' ')}`.trim() : '—');
          return { page: p, transactions: pr.length, first: describe(pr[0]), last: describe(pr.at(-1)) };
        });
        const dups = t.possibleDuplicates.filter((d) => d.page >= fSeg.from && d.page <= fSeg.to);
        const weak = t.lowConfidenceRows.filter((r) => r.page >= fSeg.from && r.page <= fSeg.to);
        federal = { pages: `${fSeg.from}-${fSeg.to}`, columns: c, rows: rows.length, transactions: tx.length, perPage, balance: bal, possibleDuplicates: dups, lowConfidenceRows: weak };
        check('Federal running balance reconciles', bal.available && bal.checked > 0 && bal.mismatches.length === 0, bal.available ? `${bal.checked} transitions checked, ${bal.mismatches.length} mismatches` : 'no balance column found');
        check('Federal has no possible duplicates left', dups.length === 0, `${dups.length}`);
      }
      check('no low-confidence rows left unresolved', t.lowConfidenceRows.length === 0, `${t.lowConfidenceRows.length} remain`);
      report.rechecks = stored.rawPages.flatMap((p) => (p.rechecks ?? []).map((r) => ({ page: p.page, ...r })));
      report.changedOnRecheck = t.changedOnRecheck ?? [];

      // --- classification: the model's classify result, totals recomputed here ------------
      const analyses = trace.filter((x) => x.name === 'analyze_table_rows' && x.ok).map((x) => JSON.parse(x.result) as { results?: any[] });
      const classify = analyses.flatMap((a) => a.results ?? []).filter((r) => r.op === 'classify').at(-1) as
        | { rows: Array<{ page: number; rowIndex: number; label: string; reason: string; value?: string | null; cells: string[] }> }
        | undefined;
      if (!classify) {
        check('classification computed from the row array (classify op)', false, 'the model did not run a classify operation');
      } else {
        const bucket = (s?: { from: number; to: number }) => {
          const rs = classify.rows.filter((r) => !s || (r.page >= s.from && r.page <= s.to));
          const by = (l: string) => rs.filter((r) => r.label.toUpperCase() === l).length;
          const out = { total: rs.length, with_party: by('WITH_PARTY'), without_party: by('WITHOUT_PARTY'), unknown: by('UNKNOWN') };
          return { ...out, other: out.total - out.with_party - out.without_party - out.unknown };
        };
        classification = { kvb: bucket(kSeg), federal: bucket(fSeg), combined: bucket(), rows: classify.rows };
        for (const [name, b] of Object.entries({ kvb: bucket(kSeg), federal: bucket(fSeg), combined: bucket() })) {
          check(`${name}: with + without + unknown = total`, b.other === 0, JSON.stringify(b));
        }
        const kvbTx = (kvb as { transactions?: number }).transactions;
        if (kvbTx !== undefined) check('classification covers exactly the KVB transactions', bucket(kSeg).total === kvbTx, `${bucket(kSeg).total} labelled vs ${kvbTx}`);
        const fedTx = (federal as { transactions?: number }).transactions;
        if (fedTx !== undefined) check('classification covers exactly the Federal transactions', bucket(fSeg).total === fedTx, `${bucket(fSeg).total} labelled vs ${fedTx}`);
      }
    }

    // --- anchoring ---------------------------------------------------------------------------
    const written = [finalText, ...trace.map((t) => JSON.stringify(t.input))].join('\n');
    const anchorHits = ANCHORS.filter((a) => new RegExp(`\\b${a}\\b`).test(written));
    check('no earlier wrong answers (163/211/277) reused', anchorHits.length === 0, anchorHits.length ? `found ${anchorHits.join(', ')} — check whether each equals a computed count` : 'none found');

    // --- performance -------------------------------------------------------------------------
    const perf = {
      pages: stored?.pageCount ?? null,
      visionCalls: {
        page: pageCalls.length,
        crop: vision.filter((v) => v.kind === 'crop').length,
        uploadOcr: vision.filter((v) => v.kind === 'upload_ocr').length,
        other: vision.filter((v) => v.kind === 'other' || v.kind === 'visual_qa').length,
        failed: vision.filter((v) => !v.ok).length,
        total: vision.length,
        ms: vision.reduce((n, v) => n + v.ms, 0),
      },
      renderMs: runtime.cli.filter((c) => c.utility === 'pdftoppm').reduce((n, c) => n + c.ms, 0),
      scriptMs: runtime.scripts.reduce((n, s) => n + s.ms, 0),
      uploadMs,
      turnMs,
      totalMs: Date.now() - started,
      usage: done?.usage ?? error?.usage ?? null,
    };

    const passed = checks.every((c) => c.pass);
    const verdict = passed
      ? 'PHASE 3 REAL KVBFEDRAL DOCUMENT ACCEPTANCE PASSED'
      : 'PHASE 3 REAL KVBFEDRAL DOCUMENT ACCEPTANCE FAILED';
    Object.assign(report, { checks, kvb, federal, classification, perf, anchorHits, verdict, model: start?.model, extraction: stored });

    const md = [
      `# Phase 3 live acceptance — ${path.basename(pdfPath)}`,
      '',
      `Prompt: "${PROMPT}"`,
      '',
      '## Model flow',
      `- Model: ${JSON.stringify(start?.model ?? null)}`,
      `- Intent telemetry: ${debug?.detectedIntent ?? 'n/a'}`,
      `- Handler path: ${debug ? 'Standard chat (debug trace present)' : 'AgentLoop or failed turn (no chat debug trace)'}; ENABLE_AGENT_LOOP=${String(cfg.ENABLE_AGENT_LOOP)}`,
      `- Skills loaded: ${(debug?.loadedSkills ?? []).join(', ') || trace.filter((t) => t.name === 'load_skill').map((t) => JSON.stringify(t.input)).join(', ') || 'none'}`,
      `- Tools executed: ${called.join(' → ') || 'none'}`,
      '',
      '## Checks',
      ...checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} — ${c.name}${c.detail ? ` — ${c.detail}` : ''}`),
      '',
      '## KVB',
      '```json',
      JSON.stringify(kvb, null, 2),
      '```',
      '## Federal',
      '```json',
      JSON.stringify({ ...federal }, null, 2),
      '```',
      '## Classification totals (recomputed from the model\'s classify rows)',
      '```json',
      JSON.stringify({ kvb: (classification as any).kvb, federal: (classification as any).federal, combined: (classification as any).combined }, null, 2),
      '```',
      '## Rechecks',
      '```json',
      JSON.stringify({ rechecks: report.rechecks, changedOnRecheck: report.changedOnRecheck }, null, 2),
      '```',
      '## Performance',
      '```json',
      JSON.stringify(perf, null, 2),
      '```',
      '## Final answer',
      '',
      finalText || '(none)',
      '',
      `## Verdict`,
      '',
      verdict,
      '',
    ].join('\n');
    await fs.writeFile(path.join(outDir, 'evidence.md'), md);
    await fs.writeFile(path.join(outDir, 'evidence.json'), JSON.stringify(report, null, 2));
    console.log(md);
    console.log(`\nEvidence written to ${outDir}`);
    process.exitCode = passed ? 0 : 1;
  } finally {
    await app.close();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('PHASE 3 REAL KVBFEDRAL DOCUMENT ACCEPTANCE FAILED');
  console.error(err);
  process.exit(1);
});
