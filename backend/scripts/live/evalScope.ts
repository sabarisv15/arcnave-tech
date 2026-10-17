/**
 * Scope and effort evaluation against a running ArcNave (ADR-0032).
 *
 * It sends each case through the real HTTP API, the same path the UI uses, and measures:
 * - total time;
 * - tool calls;
 * - whether a file was made;
 * - the finish reason.
 * Run it before and after a behaviour change and compare the two reports.
 *
 * It spends real model quota, so it is a script, never part of the test suite. Credentials come
 * from the environment; nothing is written to the repo.
 *
 *   ARCNAVE_BASE=https://<api host> ARCNAVE_EMAIL=... ARCNAVE_PASSWORD=... \
 *     npx tsx scripts/live/evalScope.ts [--cases ../docs/evals/scope-cases.json] [--files <dir>] [--out report.json]
 *
 * A case with a `file` field needs `--files <dir>` holding that file; the user's own documents stay
 * on their machine.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

interface EvalCase {
  id: string;
  prompt: string;
  /** File name inside --files, attached to the first turn. */
  file?: string;
  expect: {
    /** A file (generate_deliverable or artifact) is expected; false means one would be unrequested. */
    file: boolean;
    maxToolCalls?: number;
    maxSeconds?: number;
  };
}

interface CaseResult {
  id: string;
  seconds: number;
  toolCalls: string[];
  madeFile: boolean;
  finishReason: string | null;
  error: string | null;
  pass: boolean;
  failures: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

async function login(base: string): Promise<string> {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: env('ARCNAVE_EMAIL'), password: env('ARCNAVE_PASSWORD') }),
  });
  if (!response.ok) throw new Error(`login failed: ${String(response.status)}`);
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .join('; ');
}

async function upload(base: string, cookie: string, path: string): Promise<string> {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([await readFile(path)], { type: MIME[ext] ?? 'application/octet-stream' }), basename(path));
  const response = await fetch(`${base}/v1/files`, { method: 'POST', headers: { cookie }, body: form });
  if (response.status !== 201) throw new Error(`upload failed: ${String(response.status)} ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

async function runCase(base: string, cookie: string, c: EvalCase, filesDir?: string): Promise<CaseResult> {
  const result: CaseResult = {
    id: c.id,
    seconds: 0,
    toolCalls: [],
    madeFile: false,
    finishReason: null,
    error: null,
    pass: false,
    failures: [],
  };
  const payload: Record<string, unknown> = { prompt: c.prompt };
  if (c.file) {
    if (!filesDir) throw new Error(`case ${c.id} needs --files`);
    payload.attachmentIds = [await upload(base, cookie, join(filesDir, c.file))];
  }
  const chat = await fetch(`${base}/v1/chats`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `eval ${c.id}` }),
  });
  const chatId = ((await chat.json()) as { id: string }).id;

  const started = Date.now();
  const response = await fetch(`${base}/v1/chats/${chatId}/generate`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  result.seconds = Math.round((Date.now() - started) / 100) / 10;

  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    let event: { type?: string; name?: string; finishReason?: string; code?: string };
    try {
      event = JSON.parse(line.slice(5)) as typeof event;
    } catch {
      continue;
    }
    if (event.type === 'tool_use' && event.name) {
      result.toolCalls.push(event.name);
      if (event.name === 'generate_deliverable') result.madeFile = true;
    }
    if (event.type === 'artifact_created') result.madeFile = true;
    if (event.type === 'done') result.finishReason = event.finishReason ?? null;
    if (event.type === 'error') result.error = event.code ?? 'error';
  }

  if (result.error) result.failures.push(`error ${result.error}`);
  if (result.madeFile !== c.expect.file) {
    result.failures.push(c.expect.file ? 'expected a file, none made' : 'made a file nobody asked for');
  }
  if (c.expect.maxToolCalls !== undefined && result.toolCalls.length > c.expect.maxToolCalls) {
    result.failures.push(`${String(result.toolCalls.length)} tool calls > ${String(c.expect.maxToolCalls)}`);
  }
  if (c.expect.maxSeconds !== undefined && result.seconds > c.expect.maxSeconds) {
    result.failures.push(`${String(result.seconds)}s > ${String(c.expect.maxSeconds)}s`);
  }
  if (result.finishReason && !['stop', 'end_turn', 'completed'].includes(result.finishReason)) {
    result.failures.push(`finished with ${result.finishReason}`);
  }
  result.pass = result.failures.length === 0;
  return result;
}

async function main(): Promise<void> {
  const base = env('ARCNAVE_BASE').replace(/\/$/, '');
  const cases = JSON.parse(
    await readFile(arg('cases') ?? join(process.cwd(), '..', 'docs', 'evals', 'scope-cases.json'), 'utf8'),
  ) as EvalCase[];
  const filesDir = arg('files');
  const cookie = await login(base);

  const results: CaseResult[] = [];
  for (const c of cases) {
    if (c.file && !filesDir) {
      console.log(`skip ${c.id}: needs --files`);
      continue;
    }
    const r = await runCase(base, cookie, c, filesDir);
    results.push(r);
    console.log(
      `${r.pass ? 'PASS' : 'FAIL'} ${r.id}  ${String(r.seconds)}s  tools=${String(r.toolCalls.length)}  file=${String(r.madeFile)}` +
        (r.failures.length ? `  (${r.failures.join('; ')})` : ''),
    );
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${String(passed)}/${String(results.length)} passed`);
  const out = arg('out');
  if (out) await writeFile(out, JSON.stringify({ at: new Date().toISOString(), base, results }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
