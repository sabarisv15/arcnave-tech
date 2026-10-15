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
import { setDb } from '../db/client.js';
import * as schema from '../db/schema.js';
import type {
  AttachmentBlock,
  GenerationRequest,
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- app */

export interface TestContext {
  app: AppInstance;
  db: Database;
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
    // The suite shares one database; a test app's file worker takes only the jobs its own app
    // queued (no polling), and never re-indexes other files' project files.
    FILE_WORKER_POLL_MS: '0',
    FILE_REINDEX_BACKFILL: 'false',
    UPLOADS_PER_USER_PER_DAY: '100000',
    // N-42's 1 s → 2 s backoff is real time; a retry test checks that it retries, not how long.
    PROVIDER_RETRY_BASE_MS: '5',
  };
}

export async function createTestApp(
  env: Record<string, string> = {},
  provider = new FakeProvider(),
  /** Further service seams, e.g. `modelInputs`. */
  seams: Pick<BuildOptions, 'modelInputs' | 'googleVerifier' | 'fileWorker'> = {},
): Promise<TestContext> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'arcnave-test-'));
  const cfg = loadConfig({ ...baseEnv(), STORAGE_LOCAL_PATH: storageRoot, ...env });

  const sql = postgres(cfg.DATABASE_URL, { max: 4, onnotice: () => {} });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  // `/readyz` and anything else reaching for the process-wide handle must find this one, not
  // open a second pool against the development database.
  setDb(db, sql);

  const app = await createApp(cfg, {
    db,
    providers: { google: provider, anthropic: provider },
    ...seams,
  });
  await app.ready();
  // As index.ts does for the real process; polling is off (baseEnv), so it runs only this app's jobs.
  app.services.files.start();

  return {
    app,
    db,
    cfg,
    provider,
    storageRoot,
    close: async () => {
      await app.close();
      await sql.end({ timeout: 5 });
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

/** Parse an `event:`/`data:` stream into frames, ignoring comment-only heartbeats. */
export function parseSse(body: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of body.split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
    const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
    if (!event || !data) continue;
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
