/**
 * P08 exit test (ADR-0078): two app instances on one database, as two Cloud Run instances would be.
 *
 * (a) concurrent starts on one chat across the apps: exactly one 200 and one 409;
 * (b) a killed instance: its pool ends, the other app's sweeper interrupts the turn, the flushed
 *     text stays, usage is `exact: false` with no price, the reservation expires and the counter's
 *     hold returns to 0, and the dead runner's late settle is fenced out;
 * (c) resume: `Last-Event-ID` k gives frames from k+1 only and beats `?after=`; a lost gap gets a
 *     `snapshot`; a reattach on the other app gets snapshots, then the end;
 * (d) Idempotency-Key, sequential and parallel: one pair of rows, one provider call, one message
 *     id; another body is 409;
 * (e) drain waits for the run to settle within its budget; a generate during the drain is 503;
 * plus: a budget refusal is HTTP 402 with no rows; `ack` is the first frame; `ping` arrives; a
 * deleted session ends the stream with an `unauthorized` frame.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { budgetReservations, chats, messages, turns, usageCounters, usageRecords } from '../db/schema.js';
import { drain } from '../services/shutdown.js';
import { FencedOut, settleTurn, sweepTurns } from '../services/turn/turnStore.js';
import type { ProviderEvent } from '../providers/types.js';
import { createTestApp, FakeProvider, parseSse, signUp, sleep, type TestContext, type TestUser } from '../test/harness.js';

const usage = { inputTokens: 5, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true };
const deltas = (n: number): ProviderEvent[] => [
  ...Array.from({ length: n }, (_, i) => ({ type: 'delta' as const, text: `w${String(i)} ` })),
  { type: 'completed', usage, finishReason: 'stop' },
];

interface RawFrame {
  id: number | null;
  event: string;
  data: Record<string, unknown>;
}
function rawFrames(body: string): RawFrame[] {
  return body
    .split('\n\n')
    .map((block) => {
      const id = /^id: (\d+)$/m.exec(block)?.[1];
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return event && data ? { id: id === undefined ? null : Number(id), event, data: JSON.parse(data) as Record<string, unknown> } : null;
    })
    .filter((f): f is RawFrame => f !== null);
}

const providerA = new FakeProvider();
const providerB = new FakeProvider();
let A: TestContext;
let B: TestContext;
let user: TestUser;

beforeAll(async () => {
  // Fast enough for a test, in the same ratios as N-73 (lease = 3 heartbeats).
  const env = { TURN_LEASE_MS: '600', TURN_HEARTBEAT_MS: '200', TURN_CANCEL_CHECK_MS: '100', TURN_FLUSH_MS: '0' };
  A = await createTestApp(env, providerA);
  B = await createTestApp(env, providerB);
  user = await signUp(A);
});

afterAll(async () => {
  await A.close();
  await B.close();
});

async function newChat(ctx: TestContext = A, owner: TestUser = user): Promise<string> {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: owner.cookie }, payload: { title: 't' } });
  return (res.json() as { id: string }).id;
}

function generate(ctx: TestContext, chatId: string, payload: Record<string, unknown> = {}, headers: Record<string, string> = {}, owner: TestUser = user) {
  return ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie: owner.cookie, ...headers },
    payload: { prompt: 'hello', ...payload },
  });
}

async function assistantOf(chatId: string): Promise<{ id: string; status: string; text: string; errorCode: string | null }> {
  const rows = await A.db
    .select({ id: messages.id, status: messages.status, text: messages.text, errorCode: messages.errorCode })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant')))
    .orderBy(asc(messages.seq));
  return rows.at(-1)!;
}

async function turnsOf(chatId: string) {
  return A.db.select().from(turns).where(eq(turns.chatId, chatId)).orderBy(asc(turns.createdAt));
}

/** Every turn in the conversation: P22's regenerate of a kept answer runs in a new version (ADR-0079). */
async function familyTurnsOf(chatId: string) {
  return A.db
    .select({ state: turns.state, chatId: turns.chatId })
    .from(turns)
    .innerJoin(chats, eq(chats.id, turns.chatId))
    .where(sql`coalesce(${chats.rootChatId}, ${chats.id}) = ${chatId}`)
    .orderBy(asc(turns.createdAt));
}

async function until(check: () => Promise<boolean>, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error('condition not met in time');
}

/* -------------------------------------------------------------------------- (a) */

describe('(a) one turn per chat across two instances', () => {
  const cases = [
    ['send', 'send'],
    ['send', 'regenerate'],
    ['regenerate', 'regenerate'],
  ] as const;

  for (const [first, second] of cases) {
    it(`${first} on A + ${second} on B at once: exactly one 200 and one 409`, async () => {
      providerA.gapMs = 0;
      providerA.script = deltas(1);
      const chatId = await newChat();
      // An earlier, finished turn to regenerate.
      expect((await generate(A, chatId)).statusCode).toBe(200);
      const earlier = await assistantOf(chatId);
      providerA.gapMs = 60;
      providerB.gapMs = 60;
      providerA.script = deltas(4);
      providerB.script = deltas(4);
      const body = (kind: string) => (kind === 'send' ? { prompt: 'again' } : { prompt: 'hello', retryMessageId: earlier.id });
      const [ra, rb] = await Promise.all([generate(A, chatId, body(first)), generate(B, chatId, body(second))]);
      const codes = [ra.statusCode, rb.statusCode].sort();
      expect(codes).toEqual([200, 409]);
      const refused = ra.statusCode === 409 ? ra : rb;
      expect((refused.json() as { error: { code: string } }).error.code).toBe('run_in_progress');
      // One new turn, ended; never two running (counted over the conversation's versions).
      const all = await familyTurnsOf(chatId);
      expect(all).toHaveLength(2);
      expect(all.every((t) => t.state === 'done')).toBe(true);
      providerA.gapMs = 0;
      providerB.gapMs = 0;
    });
  }
});

/* -------------------------------------------------------------------------- (b) */

describe('(b) a killed instance', () => {
  it("is taken over by the other app's sweeper: interrupted, text kept, no price, reservation expired, late settle fenced", async () => {
    const owner = await signUp(B);
    // A budget, so the counters hold the reservation and its return can be read.
    await B.app.inject({ method: 'PATCH', url: '/v1/usage/limits', headers: { cookie: owner.cookie }, payload: { dailyTokenBudget: 10_000_000 } });
    const dying = await createTestApp({ TURN_LEASE_MS: '400', TURN_HEARTBEAT_MS: '100', TURN_CANCEL_CHECK_MS: '100', TURN_FLUSH_MS: '0' }, new FakeProvider());
    const provider = dying.provider;
    provider.gapMs = 150;
    provider.script = deltas(30);
    const chatId = await newChat(dying, owner);
    const running = generate(dying, chatId, {}, {}, owner);
    await until(async () => (await assistantOf(chatId))?.text.length > 0);
    const [before] = await turnsOf(chatId);
    expect(before!.state).toBe('running');

    // The instance dies: no heartbeat, no flush, no settle reaches the database again.
    await dying.sql.end({ timeout: 0 });
    const flushed = (await assistantOf(chatId)).text;
    await sleep(600);

    const swept = await sweepTurns(B.app.services);
    expect(swept.interrupted).toBeGreaterThanOrEqual(1);

    const [after] = await turnsOf(chatId);
    expect(after).toMatchObject({ state: 'interrupted', finishCode: 'interrupted', fencingToken: before!.fencingToken + 1 });
    const row = await assistantOf(chatId);
    expect(row).toMatchObject({ status: 'error', errorCode: 'interrupted' });
    expect(row.text).toBe(flushed);
    expect(row.text.length).toBeGreaterThan(0);

    const ledger = await B.db.select().from(usageRecords).where(eq(usageRecords.messageId, row.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ tokensExact: false, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: null, errorCode: 'interrupted' });

    const holds = await B.db.select().from(budgetReservations).where(eq(budgetReservations.turnId, after!.id));
    expect(holds.map((h) => h.status)).toEqual(['expired']);
    const counters = await B.db.select().from(usageCounters).where(eq(usageCounters.userId, owner.id));
    expect(counters.length).toBeGreaterThan(0);
    for (const c of counters) expect(c.tokensReserved).toBe(0);

    // The old runner's settle, had it reached the database: refused, nothing written.
    await expect(
      settleTurn(
        B.app.services,
        { userId: owner.id, chatId, messageId: row.id, requestId: 'late', projectId: null },
        { turnId: after!.id, fencingToken: before!.fencingToken, reservation: null },
        {
          message: { kind: 'failed', errorCode: 'provider_error', mode: 'chat' },
          usage: null,
          end: 'failed',
          finishCode: 'provider_error',
        },
      ),
    ).rejects.toBeInstanceOf(FencedOut);
    expect(await assistantOf(chatId)).toMatchObject({ status: 'error', errorCode: 'interrupted', text: flushed });
    expect((await turnsOf(chatId))[0]).toMatchObject({ state: 'interrupted' });

    // The chat is free again, on the surviving instance.
    providerB.script = deltas(1);
    expect((await generate(B, chatId, {}, {}, owner)).statusCode).toBe(200);
    await running.catch(() => undefined);
    await dying.close().catch(() => undefined);
  });
});

/* -------------------------------------------------------------------------- (c) */

describe('(c) resume', () => {
  it('Last-Event-ID k replays frames from k+1 only, and beats ?after=', async () => {
    providerA.script = deltas(4);
    const chatId = await newChat();
    const first = rawFrames((await generate(A, chatId)).body);
    expect(first.map((f) => f.id)).toEqual(first.map((_, i) => i));
    const k = 2;
    const again = await A.app.inject({ url: `/v1/chats/${chatId}/stream?after=0`, headers: { cookie: user.cookie, 'last-event-id': String(k) } });
    const got = rawFrames(again.body);
    expect(got.map((f) => f.id)).toEqual(first.slice(k + 1).map((f) => f.id));
    expect(got.map((f) => f.event)).toEqual(first.slice(k + 1).map((f) => f.event));
    const byQuery = rawFrames((await A.app.inject({ url: `/v1/chats/${chatId}/stream?after=0`, headers: { cookie: user.cookie } })).body);
    expect(byQuery[0]!.id).toBe(1);
  });

  it('a gap the buffer no longer holds gets a snapshot first', async () => {
    const small = await createTestApp({ RUN_BUFFER_MAX_EVENTS: '3', TURN_FLUSH_MS: '0' });
    try {
      const owner = await signUp(small);
      small.provider.script = deltas(8);
      const chatId = await newChat(small, owner);
      await generate(small, chatId, {}, {}, owner);
      const res = await small.app.inject({ url: `/v1/chats/${chatId}/stream`, headers: { cookie: owner.cookie, 'last-event-id': '0' } });
      const got = rawFrames(res.body);
      expect(got[0]!.event).toBe('snapshot');
      expect((got[0]!.data['message'] as { status: string }).status).toBe('complete');
      expect(got.at(-1)!.event).toBe('done');
    } finally {
      await small.close();
    }
  });

  it('a reattach on the other instance gets snapshots of the stored row, then the end', async () => {
    providerA.gapMs = 120;
    providerA.script = deltas(6);
    const chatId = await newChat();
    const running = generate(A, chatId);
    await until(async () => (await turnsOf(chatId)).length === 1);
    const res = await B.app.inject({ url: `/v1/chats/${chatId}/stream`, headers: { cookie: user.cookie } });
    const got = rawFrames(res.body);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((f) => f.event === 'snapshot')).toBe(true);
    const last = got.at(-1)!.data as { state: string; message: { status: string; text: string } };
    expect(last.state).toBe('done');
    expect(last.message.status).toBe('complete');
    expect(last.message.text).toBe('w0 w1 w2 w3 w4 w5 ');
    await running;
    providerA.gapMs = 0;
  });
});

/* -------------------------------------------------------------------------- (d) */

describe('(d) Idempotency-Key', () => {
  const idOf = (body: string): string => {
    const f = rawFrames(body)[0]!;
    return f.event === 'ack' ? String(f.data['messageId']) : String((f.data['message'] as { id: string }).id);
  };

  it('sequential: the same key and body return the same turn, one pair of rows, one provider call', async () => {
    providerA.script = deltas(2);
    const chatId = await newChat();
    const calls = providerA.seen.length;
    const key = { 'idempotency-key': `seq-${chatId}` };
    const one = await generate(A, chatId, {}, key);
    const two = await generate(A, chatId, {}, key);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(idOf(two.body)).toBe(idOf(one.body));
    expect(providerA.seen.length).toBe(calls + 1);
    const rows = await A.db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId));
    expect(rows).toHaveLength(2);
  });

  it('parallel on two instances: one turn, one provider call, the same message id', async () => {
    providerA.gapMs = 40;
    providerB.gapMs = 40;
    providerA.script = deltas(3);
    providerB.script = deltas(3);
    const chatId = await newChat();
    const calls = providerA.seen.length + providerB.seen.length;
    const key = { 'idempotency-key': `par-${chatId}` };
    const [one, two] = await Promise.all([generate(A, chatId, {}, key), generate(B, chatId, {}, key)]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(idOf(one.body)).toBe(idOf(two.body));
    expect(providerA.seen.length + providerB.seen.length).toBe(calls + 1);
    expect(await A.db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId))).toHaveLength(2);
    expect(await turnsOf(chatId)).toHaveLength(1);
    providerA.gapMs = 0;
    providerB.gapMs = 0;
  });

  it('the same key with another body is 409 idempotency_conflict', async () => {
    providerA.script = deltas(1);
    const chatId = await newChat();
    const key = { 'idempotency-key': `diff-${chatId}` };
    expect((await generate(A, chatId, { prompt: 'one' }, key)).statusCode).toBe(200);
    const other = await generate(A, chatId, { prompt: 'two' }, key);
    expect(other.statusCode).toBe(409);
    expect((other.json() as { error: { code: string } }).error.code).toBe('idempotency_conflict');
  });
});

/* -------------------------------------------------------------------------- (e) */

describe('(e) drain', () => {
  it('waits for the stopped run to settle inside its budget; a generate during the drain is 503', async () => {
    const C = await createTestApp({ TURN_FLUSH_MS: '0' });
    const owner = await signUp(C);
    C.provider.gapMs = 200;
    C.provider.script = deltas(40);
    const chatId = await newChat(C, owner);
    const running = generate(C, chatId, {}, {}, owner);
    await until(async () => (await assistantOf(chatId))?.text.length > 0);

    const draining = drain(C.app, { budgetMs: 5_000, closeApp: false });
    const refused = await generate(C, await newChat(C, owner), {}, {}, owner);
    expect(refused.statusCode).toBe(503);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('server_shutdown');
    const result = await draining;
    expect(result).toMatchObject({ runs: 1, settled: true });
    expect(result.ms).toBeLessThan(5_000);

    // Settled before drain returned: the row, the turn and the reservation.
    const row = await assistantOf(chatId);
    expect(row).toMatchObject({ status: 'error', errorCode: 'server_shutdown' });
    const [turn] = await turnsOf(chatId);
    expect(turn).toMatchObject({ state: 'interrupted', finishCode: 'server_shutdown' });
    const holds = await C.db.select().from(budgetReservations).where(eq(budgetReservations.turnId, turn!.id));
    expect(holds.map((h) => h.status)).toEqual(['settled']);
    const frames = parseSse((await running).body);
    expect(frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'server_shutdown' } });
    await C.close();
  });
});

/* -------------------------------------------------------------------------- frames and refusals */

describe('frames and refusals', () => {
  it('a budget refusal is HTTP 402 with no rows written', async () => {
    const owner = await signUp(A);
    // One turn of the fake costs 8 tokens, so a budget of 5 is spent after it.
    await A.app.inject({ method: 'PATCH', url: '/v1/usage/limits', headers: { cookie: owner.cookie }, payload: { dailyTokenBudget: 5 } });
    providerA.script = deltas(1);
    const chatId = await newChat(A, owner);
    expect((await generate(A, chatId, {}, {}, owner)).statusCode).toBe(200);
    const msgsBefore = await A.db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId));
    const holdsBefore = await A.db.select({ id: budgetReservations.id }).from(budgetReservations).where(eq(budgetReservations.userId, owner.id));
    const calls = providerA.seen.length;
    const refused = await generate(A, chatId, { prompt: 'more' }, {}, owner);
    expect(refused.statusCode).toBe(402);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('budget_exceeded');
    expect(await A.db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId))).toHaveLength(msgsBefore.length);
    expect(await turnsOf(chatId)).toHaveLength(1);
    expect(await A.db.select({ id: budgetReservations.id }).from(budgetReservations).where(eq(budgetReservations.userId, owner.id))).toHaveLength(holdsBefore.length);
    expect(providerA.seen.length).toBe(calls);
  });

  it('a named model the deployment cannot serve is HTTP 400 with no rows written', async () => {
    const chatId = await newChat();
    const refused = await generate(A, chatId, { model: 'No Such Model' });
    expect(refused.statusCode).toBe(400);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('model_unavailable');
    expect(await turnsOf(chatId)).toHaveLength(0);
  });

  it('ack is the first frame, with the turn and both message ids', async () => {
    providerA.script = deltas(1);
    const chatId = await newChat();
    const frames = rawFrames((await generate(A, chatId)).body);
    expect(frames[0]).toMatchObject({ id: 0, event: 'ack' });
    const [turn] = await turnsOf(chatId);
    expect(frames[0]!.data).toEqual({ type: 'ack', turnId: turn!.id, messageId: turn!.assistantMessageId, userMessageId: turn!.userMessageId });
    expect(frames[1]!.event).toBe('start');
  });

  it('a named ping frame arrives, without an id', async () => {
    const P = await createTestApp({ SSE_PING_MS: '40' });
    try {
      const owner = await signUp(P);
      P.provider.gapMs = 60;
      P.provider.script = deltas(5);
      const chatId = await newChat(P, owner);
      const res = await generate(P, chatId, {}, {}, owner);
      const pings = rawFrames(res.body).filter((f) => f.event === 'ping');
      expect(pings.length).toBeGreaterThan(0);
      expect(pings.every((p) => p.id === null && p.data['type'] === 'ping')).toBe(true);
      // The test parser drops it: it is transport, not part of the run.
      expect(parseSse(res.body).some((f) => f.event === 'ping')).toBe(false);
    } finally {
      await P.close();
    }
  });

  it('a session deleted mid-stream ends the stream with an unauthorized frame', async () => {
    const S = await createTestApp({ SSE_SESSION_RECHECK_MS: '50' });
    try {
      const owner = await signUp(S);
      S.provider.gapMs = 100;
      S.provider.script = deltas(20);
      const chatId = await newChat(S, owner);
      const streaming = generate(S, chatId, {}, {}, owner);
      await sleep(150);
      expect((await S.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie: owner.cookie } })).statusCode).toBeLessThan(300);
      const frames = rawFrames((await streaming).body);
      expect(frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'unauthorized' } });
      expect(frames.some((f) => f.event === 'done')).toBe(false);
      // The run itself is not the session's to end; stop it so the app closes cleanly.
      S.app.services.runHub.active(chatId)?.controller.abort();
      await S.app.services.runHub.latest(chatId)?.done;
    } finally {
      await S.close();
    }
  });
});
