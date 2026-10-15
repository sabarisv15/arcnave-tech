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
 * Error path covered (2026-10-15): the app's error handler (`src/app.ts`, `'unhandled error'`) used to
 * log the whole `DrizzleQueryError`, whose message and `params` carry the query's values (on
 * sign-up, the e-mail and the Argon2 hash). It now logs `errorLogFields(error)` (type, code,
 * SQLSTATE, message length) plus request id, method and route pattern. The last test makes a real
 * query fail through the real Fastify handler and checks the values are absent while the line is
 * present. Still not covered: the provider-error `log.warn({ err })` sites and failed tools; the
 * other `{ err }` log sites outside the handler are a Phase 5 enforce item.
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

import { users } from '../db/schema.js';
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

  it('a failed query logs its type and SQLSTATE, never the values it carried', async () => {
    const email = `leak-${String(process.pid)}-${String(Date.now())}@sentinel-email.test`;
    const hash = 'SENTINEL_HASH_$argon2id$c3a1';
    const row = { email, passwordHash: hash, name: 'x' };
    await ctx.db.insert(users).values(row);

    // The sign-up route calls the auth service; make it run the insert that really fails (a
    // duplicate e-mail, as sign-up does) but not translate the error, so it reaches the handler.
    let thrown: unknown;
    const spy = vi.spyOn(ctx.app.services.auth, 'register').mockImplementationOnce(async () => {
      try {
        await ctx.db.insert(users).values(row);
      } catch (err) {
        thrown = err;
        throw err;
      }
      throw new Error('the duplicate insert was expected to fail');
    });

    sink.length = 0;
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email: 'someone-else@example.test', password: 'correct-horse-battery-staple', name: 'x' },
    });
    spy.mockRestore();

    expect(response.statusCode).toBe(500);
    // The error object itself carries the values, so a leak was possible here.
    expect((thrown as Error).message).toContain(email);
    expect(JSON.stringify((thrown as { params?: unknown }).params)).toContain(hash);

    const line = sink.find((l) => l.includes('unhandled error'));
    expect(line, 'the failure was not logged at all; the check would pass vacuously').toBeDefined();
    const logged = JSON.parse(line!) as Record<string, unknown>;
    expect(logged).toMatchObject({
      level: 'error',
      errorType: 'DrizzleQueryError',
      rootType: 'PostgresError',
      rootCode: '23505',
      method: 'POST',
      route: '/v1/auth/register',
      statusCode: 500,
    });
    expect(logged).not.toHaveProperty('err');
    expect(logged).not.toHaveProperty('params');
    for (const l of sink) {
      expect(l).not.toContain('sentinel-email.test');
      expect(l).not.toContain(hash);
    }
  });
});
