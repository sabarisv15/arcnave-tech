/**
 * Integration test harness.
 *
 * Builds a real Fastify app against a real Postgres, with fake providers. Three rules it
 * enforces so the suite stays trustworthy:
 *
 * 1. **No provider is ever reached.** `FakeProvider` is injected through the service container
 *    for all three slots. There is no code path from a test to Vertex, so the suite cannot
 *    spend quota however it is run.
 * 2. **No port is bound.** Requests go through `app.inject()`, so tests are fast and can run
 *    in parallel without fighting over 8080.
 * 3. **Isolation is by ownership, not by truncation.** Every test signs up its own user, and
 *    every route scopes to the caller. Files therefore share a database without interfering —
 *    and any leak between users shows up as a test failure, which is the point.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { createApp } from '../app.js';
import type { Config } from '../config.js';
import type { BuildOptions } from '../container.js';
import { loadConfig } from '../config.js';
import type { Database } from '../db/client.js';
import { pgOptions, setDb } from '../db/client.js';
import * as schema from '../db/schema.js';
import type {
  AttachmentBlock,
  GenerationRequest,
  MediaPart,
  MediaReading,
  Provider,
  ProviderEvent,
} from '../providers/types.js';
import { addRequestUsage } from '../providers/types.js';
import type { AppInstance } from '../types.js';

export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://arcnave:arcnave@localhost:5432/arcnave_test';

/* -------------------------------------------------------------------------- fake provider */

/**
 * A scripted provider.
 *
 * `script` is the event sequence to emit. `gapMs` inserts a pause between events, which is
 * what gives a cancellation test a window to abort in. The signal is checked before every
 * event, mirroring the real adapters' contract that an abort stops upstream work rather than
 * merely ending the generator.
 */
export class FakeProvider implements Provider {
  readonly name = 'fake';

  script: ProviderEvent[] = [
    { type: 'delta', text: 'Hello' },
    { type: 'delta', text: ', world.' },
    {
      type: 'completed',
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        exact: true,
      },
      finishReason: 'stop',
    },
  ];

  gapMs = 0;
  grounding = true;
  codeExecutionSupported = false;
  /** Set to make `stream` throw before emitting anything. */
  streamError: Error | null = null;
  /** Set to make `probe` throw, which the registry reports as `probe_failed`. */
  probeError: Error | null = null;
  /** Every request this provider was asked to serve, for asserting on what was sent. */
  readonly seen: GenerationRequest[] = [];
  /** What `describeMedia` (OCR / audio-video transcription) returns. Empty means unsupported. */
  mediaDescription = 'The fake provider read this content.';
  /** Every `describeMedia` call this provider was asked to serve. */
  readonly mediaSeen: Array<{ parts: AttachmentBlock[]; prompt: string }> = [];

  supportsGrounding(): boolean {
    return this.grounding;
  }

  supportsCodeExecution(): boolean {
    return this.codeExecutionSupported;
  }

  /** Set to answer `describeMedia` per call (e.g. per page of a table extraction). */
  mediaHandler: ((parts: AttachmentBlock[], prompt: string) => Promise<string>) | null = null;

  async describeMedia(parts: AttachmentBlock[], prompt: string): Promise<string> {
    this.mediaSeen.push({ parts, prompt });
    if (this.mediaHandler) return this.mediaHandler(parts, prompt);
    return this.mediaDescription;
  }

  /**
   * OCR / transcription with a finish reason (`readMedia`). Default: an OCR prompt is answered
   * with one marked block per page it names ("Page n text"), anything else with
   * `mediaDescription`, finish reason `STOP`.
   */
  readHandler: ((parts: MediaPart[], prompt: string) => Promise<MediaReading>) | null = null;
  readonly readSeen: Array<{ parts: MediaPart[]; prompt: string }> = [];

  async readMedia(parts: MediaPart[], prompt: string, signal: AbortSignal): Promise<MediaReading> {
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    this.readSeen.push({ parts, prompt });
    if (this.readHandler) return this.readHandler(parts, prompt);
    const nums = /numbered ([\d, ]+)\./.exec(prompt)?.[1]?.split(',').map((n) => n.trim());
    if (nums) return { text: nums.map((n) => `=== PAGE ${n} ===\nPage ${n} text read by the fake OCR.`).join('\n'), finishReason: 'STOP', model: 'fake-flash-001' };
    return { text: this.mediaDescription, finishReason: 'STOP', model: 'fake-flash-001' };
  }

  /**
   * The fake count API. Not an estimator: it stands in for the provider's count endpoint so a
   * test can choose what the "provider" answers. Default: one token per 4 characters.
   */
  tokenCount: ((text: string) => number) | null = (text) => Math.ceil(text.length / 4);
  readonly countSeen: number[] = [];

  async countTokens(text: string): Promise<{ tokens: number; model: string }> {
    this.countSeen.push(text.length);
    if (!this.tokenCount) throw new Error('count API unavailable');
    return { tokens: this.tokenCount(text), model: 'fake-count' };
  }

  /**
   * Runs inside `stream`, while the turn's workspace still exists. Lets a test drive the real
   * `toolExecutor` the way a provider adapter would, without a real model.
   */
  onRequest: ((request: GenerationRequest) => Promise<void>) | null = null;

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    this.seen.push(request);
    if (this.streamError) throw this.streamError;
    if (this.onRequest) await this.onRequest(request);

    for (const event of this.script) {
      if (request.signal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      if (this.gapMs > 0) await sleep(this.gapMs);
      if (request.signal.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      // One scripted answer is one request; every real adapter reports its last request so.
      yield event.type === 'completed' && !event.usage.lastRequest
        ? { ...event, usage: event.usage.exact ? addRequestUsage(null, event.usage) : event.usage }
        : event;
    }
  }

  /** Probe calls made, so a test can prove a turn made none. */
  probes = 0;

  async probe(): Promise<void> {
    this.probes += 1;
    if (this.probeError) throw this.probeError;
  }
}

/**
 * Everything a request gives the model besides the history and the user's message: the system
 * instruction and the turn's leading text. For Gemini the session state (memory, instructions,
 * project files) is in the turn, not the system instruction (ADR-0075).
 */
export function promptOf(request: { systemInstruction: string; turnPreamble?: string }): string {
  return `${request.systemInstruction}\n\n${request.turnPreamble ?? ''}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- app */

export interface TestContext {
  app: AppInstance;
  db: Database;
  /** The app's own pool: a test can end it to play an instance that died. */
  sql: postgres.Sql;
  cfg: Config;
  provider: FakeProvider;
  /** Where the local object storage wrote its files, so a test can inspect or assert on it. */
  storageRoot: string;
  close(): Promise<void>;
}

/**
 * Base environment for a test app.
 *
 * `GOOGLE_CLOUD_PROJECT` and `ANTHROPIC_API_KEY` are fake strings: the registry only checks
 * that they are set, and the fake providers behind them never make a call. Rate limits are raised far above anything a test
 * does — the auth limiter keys on IP, and every inject shares one, so the production value of
 * 10/minute would fail a file after its tenth signup rather than finding a real bug.
 */
function baseEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    GOOGLE_CLOUD_PROJECT: 'test-project',
    MODEL_GEMINI_FLASH: 'fake-flash',
    MODEL_SONNET: 'fake-sonnet',
    MODEL_OPUS: 'fake-opus',
    ANTHROPIC_API_KEY: 'test-key-not-real',
    ENABLE_GOOGLE_SEARCH_GROUNDING: 'true',
    ENABLE_ANTHROPIC_WEB_SEARCH: 'true',
    RATE_LIMIT_AUTH_PER_MINUTE: '10000',
    RATE_LIMIT_WRITE_PER_MINUTE: '10000',
    RATE_LIMIT_GENERATE_PER_MINUTE: '10000',
    MAX_UPLOAD_BYTES: String(2 * 1024 * 1024),
    // A poll answers at once unless a test asks it to hold (ADR-0063 poll hold).
    FILE_POLL_HOLD_MS: '0',
    // The suite shares one database; a test app's file worker takes only the jobs its own app
    // queued (no polling), and never re-indexes other files' project files.
    FILE_WORKER_POLL_MS: '0',
    FILE_REINDEX_BACKFILL: 'false',
    UPLOADS_PER_USER_PER_DAY: '100000',
    // N-42's 1 s → 2 s backoff is real time; a retry test checks that it retries, not how long.
    PROVIDER_RETRY_BASE_MS: '5',
    // P11: the instance retry budget (N-47 10 %, reserve 2) spans every test of a file that
    // shares one app; a test of the budget sets its own. Raised like the rate limits above.
    RETRY_BUDGET_MIN_RESERVE: '100000',
    // …and so does each model's circuit breaker (N-47: 5 failures / 30 s): failures one test
    // provokes must not open the breaker for the next. breaker.test.ts tests the real values.
    BREAKER_FAILURES: '100000',
    BREAKER_MIN_CALLS: '100000',
  };
}

export async function createTestApp(
  env: Record<string, string> = {},
  provider = new FakeProvider(),
  /** Further service seams, e.g. `modelInputs`. */
  seams: Pick<BuildOptions, 'modelInputs' | 'googleVerifier' | 'fileWorker'> & {
    /** A separate fake for the Claude slot (e.g. a count API that answers differently). */
    anthropic?: FakeProvider;
  } = {},
): Promise<TestContext> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'arcnave-test-'));
  const cfg = loadConfig({ ...baseEnv(), STORAGE_LOCAL_PATH: storageRoot, ...env });

  // The pool's session limits are production's (N-45), so a statement or lock wait that would time
  // out in production times out here too.
  const sql = postgres(cfg.DATABASE_URL, { max: 4, onnotice: () => {}, ...pgOptions(cfg) });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  // `/readyz` and anything else reaching for the process-wide handle must find this one, not
  // open a second pool against the development database.
  setDb(db, sql);

  const { anthropic, ...rest } = seams;
  const app = await createApp(cfg, {
    db,
    providers: { google: provider, anthropic: anthropic ?? provider },
    ...rest,
  });
  await app.ready();
  // As index.ts does for the real process; polling is off (baseEnv), so it runs only this app's jobs.
  app.services.files.start();

  return {
    app,
    db,
    sql,
    cfg,
    provider,
    storageRoot,
    close: async () => {
      await app.close();
      await sql.end({ timeout: 5 }).catch(() => undefined);
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}

/* -------------------------------------------------------------------------- auth */

export interface TestUser {
  id: string;
  email: string;
  /** Ready to pass as a `cookie` header. */
  cookie: string;
}

let counter = 0;

/**
 * Register a fresh user and return its session cookie.
 *
 * The email is unique per call so tests never collide on the unique index, and every test
 * owning its own user is what lets the suite share one database without truncating between
 * cases.
 */
export async function signUp(ctx: TestContext, name = 'Test'): Promise<TestUser> {
  counter += 1;
  const email = `u${String(counter)}-${String(process.pid)}-${String(Date.now())}@example.test`;
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, password: 'correct-horse-battery-staple', name },
  });
  if (response.statusCode !== 201) {
    throw new Error(`signUp failed: ${String(response.statusCode)} ${response.body}`);
  }

  const raw = response.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw];
  const cookie = list
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.split(';')[0]!)
    .join('; ');

  return { id: (response.json() as { user: { id: string } }).user.id, email, cookie };
}

/* -------------------------------------------------------------------------- multipart */

/**
 * Hand-build a multipart body.
 *
 * `app.inject` has no file helper, and pulling in form-data just to post one part would add a
 * dependency to the production tree for a test convenience.
 */
export function multipart(
  filename: string,
  content: Buffer | string,
  contentType = 'text/plain',
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----arcnavetest${String(Date.now())}${String(Math.random()).slice(2)}`;
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
      'utf8',
    ),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    },
  };
}

/* -------------------------------------------------------------------------- SSE */

export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Parse an `event:`/`data:` stream into frames, ignoring the named `ping` keep-alive (N-24): it is
 * a transport frame, not part of the run, and when one lands depends on the clock.
 */
export function parseSse(body: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of body.split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
    const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
    if (!event || !data || event === 'ping') continue;
    frames.push({ event, data: JSON.parse(data) as Record<string, unknown> });
  }
  return frames;
}

/** The concatenated text of every `delta` frame — what the user would have seen. */
export function sseText(frames: SseFrame[]): string {
  return frames
    .filter((f) => f.event === 'delta')
    .map((f) => String(f.data['text'] ?? ''))
    .join('');
}

/* -------------------------------------------------------------------------- project files */

/**
 * Uploads a project file and waits for its job: the upload answers 202 with the file queued
 * (ADR-0063), so this returns that status code with the file as it reads once settled.
 */
export async function postProjectFile(
  ctx: TestContext,
  headers: Record<string, string>,
  projectId: string,
  part: { payload: Buffer; headers: Record<string, string> },
  method: 'POST' | 'PUT' = 'POST',
  fileId?: string,
): Promise<{ statusCode: number; json: () => Record<string, unknown>; body: string }> {
  const url = `/v1/projects/${projectId}/files${fileId ? `/${fileId}` : ''}`;
  const res = await ctx.app.inject({ method, url, headers: { ...part.headers, ...headers }, payload: part.payload });
  if (res.statusCode !== 202) return { statusCode: res.statusCode, json: () => res.json() as Record<string, unknown>, body: res.body };
  const id = String((res.json() as { id: string }).id);
  await ctx.app.services.files.idle();
  const done = await ctx.app.inject({ url: `/v1/projects/${projectId}/files/${id}`, headers });
  return { statusCode: res.statusCode, json: () => done.json() as Record<string, unknown>, body: done.body };
}
