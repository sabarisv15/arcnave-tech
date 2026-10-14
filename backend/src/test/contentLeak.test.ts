/**
 * Content-leak check, shadow mode.
 *
 * Runs one full turn through the real `GenerationService` (via the generate route, against a
 * fake provider) with a distinct sentinel in everything the user owns: the message, an attached
 * file, a memory file and the model's reply. Every pino line the turn writes is captured, and
 * none may contain a sentinel — logs outlive the database row's retention and delete controls,
 * so user content in them is a privacy leak no delete button reaches.
 *
 * Shadow mode (Phase 1; enforce is Phase 5): if a log site starts leaking, mark the check
 * `it.fails` with the offending `file:line` and sentinel instead of silencing the log site, so the
 * finding is reported without blocking CI. Today no log site leaks on this path, so it is a plain
 * `it` and already guards the happy-path turn. It does not exercise error paths (a provider
 * error echoed into `log.warn({ err })`, a failed tool); those are the likelier leak sites and
 * belong in the Phase 5 enforce version.
 *
 * Known error-path leak (found by a local smoke run, 2026-10-14, not covered here): when a query
 * fails, the app's error handler (`src/app.ts:172`, `'unhandled error'`) logs the whole
 * `DrizzleQueryError`, whose message and `params` carry the query's values — on sign-up, the
 * e-mail and the Argon2 hash. Phase 5's enforce version should reduce `err` there to its type,
 * code and SQLSTATE.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The logger is a module singleton built at import time with LOG_LEVEL=silent in tests, and
// child loggers copy their level when created, so its level cannot be raised afterwards. Replacing
// the module with the same options plus a capturing destination keeps every real child logger
// (generation, providers, tools, `request.log`) writing into the sink.
const { sink } = vi.hoisted(() => ({ sink: [] as string[] }));

vi.mock('../logger.js', async () => {
  const { pino } = await import('pino');
  const { Writable } = await import('node:stream');
  const actual = await vi.importActual<typeof import('../logger.js')>('../logger.js');
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      sink.push(chunk.toString('utf8'));
      done();
    },
  });
  const logger = pino(
    {
      level: 'trace',
      redact: { paths: actual.REDACT_PATHS, censor: '[redacted]' },
      base: { service: 'arcnave-backend' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
  return { ...actual, logger };
});

import { memoryService } from '../services/memory/memoryService.js';
import type { TestContext, TestUser } from './harness.js';
import { createTestApp, multipart, signUp } from './harness.js';

const SENTINELS = {
  user: 'SENTINEL_USER_7f3a',
  file: 'SENTINEL_FILE_91c2',
  memory: 'SENTINEL_MEMORY_b04d',
  reply: 'SENTINEL_REPLY_5e8e',
} as const;

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_MEMORY: 'true' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

/** One whole turn; returns what the provider was sent, so the test can prove the sentinels were in play. */
async function runTurn(): Promise<string> {
  // The profile is injected in full and the listing shows each file's description, so both
  // places a memory file's text can reach the prompt carry the sentinel.
  await memoryService.createMemory({
    userId: user.id,
    scope: 'global',
    key: '/profile.md',
    content: `The user's profile. ${SENTINELS.memory}_PROFILE`,
  });
  await memoryService.createMemory({
    userId: user.id,
    scope: 'global',
    key: '/topics/leak-check.md',
    content: `---\nname: leak-check\ndescription: ${SENTINELS.memory}_TOPIC\n---\n- A remembered fact.`,
  });

  const part = multipart('notes.txt', `${SENTINELS.file}: the attached file body.`, 'text/plain');
  const upload = await ctx.app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: { ...part.headers, cookie: user.cookie },
    payload: part.payload,
  });
  expect(upload.statusCode).toBe(201);
  const fileId = (upload.json() as { id: string }).id;

  const chat = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers: { cookie: user.cookie },
    payload: { title: 'New conversation' },
  });
  const chatId = (chat.json() as { id: string }).id;

  ctx.provider.script = [
    { type: 'delta', text: `Here is the answer. ${SENTINELS.reply}` },
    {
      type: 'completed',
      usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
      finishReason: 'stop',
    },
  ];

  sink.length = 0;
  const turn = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie: user.cookie },
    payload: { prompt: `Please summarise. ${SENTINELS.user}`, attachmentIds: [fileId] },
  });
  expect(turn.statusCode).toBe(200);

  const request = ctx.provider.seen.at(-1)!;
  const { signal: _signal, toolExecutor: _executor, ...sent } = request;
  return JSON.stringify(sent);
}

function findLeaks(lines: string[]): string[] {
  return lines.flatMap((line) =>
    Object.values(SENTINELS)
      .filter((sentinel) => line.includes(sentinel))
      .map((sentinel) => `${sentinel} in ${line.slice(0, 300)}`),
  );
}

describe('content-leak check (shadow mode)', () => {
  it('the sink sees lines from the shared logger and the leak finder flags a sentinel in them', async () => {
    const { logger } = await import('../logger.js');
    sink.length = 0;
    logger.child({ module: 'control' }).debug({ body: SENTINELS.user }, 'negative control');
    expect(sink).toHaveLength(1);
    expect(findLeaks(sink)).toHaveLength(1);
  });

  it('no log line written during a turn contains user, file, memory or reply content', async () => {
    const sentToProvider = await runTurn();

    // Without these the test could pass because the content never reached the turn at all.
    for (const [name, sentinel] of Object.entries(SENTINELS)) {
      if (name === 'reply') continue;
      expect(sentToProvider, `${name} sentinel never reached the provider`).toContain(sentinel);
    }
    expect(sink.length, 'no log lines were captured; the check would pass vacuously').toBeGreaterThan(0);

    expect(findLeaks(sink)).toEqual([]);
  });
});
