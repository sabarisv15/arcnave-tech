/**
 * P08 unit-level checks (ADR-0078):
 * - the database's "too slow / too busy" SQLSTATEs map to 503 `unavailable` with Retry-After 5,
 *   and a real lock wait past N-45's lock_timeout gets exactly that;
 * - the settle is one transaction: a step that fails after the message was written rolls the
 *   message, the turn and the reservation back with it.
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_RETRY_AFTER_S, dbUnavailable } from '../../app.js';
import { budgetReservations, chats, messages, turns, usageCounters } from '../../db/schema.js';
import { createTestApp, signUp, type TestContext, type TestUser } from '../../test/harness.js';
import { dbNowPlus, TurnRuntime } from './turnLease.js';
import { launchTurn } from './launch.js';
import { startTurn } from './turnStart.js';
import { settleTurn, settleTurnTx, sweepTurns } from './turnStore.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await ctx.close();
});

async function newChat(): Promise<string> {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
  return (res.json() as { id: string }).id;
}

describe('database timeouts', () => {
  it('maps the "could not serve in time" SQLSTATEs (and an unretried deadlock), however wrapped, and nothing else', () => {
    const wrapped = (code: string) => ({ name: 'DrizzleQueryError', cause: { name: 'PostgresError', code } });
    expect(['57014', '55P03', '53300'].map((c) => dbUnavailable(wrapped(c)))).toEqual([true, true, true]);
    expect(dbUnavailable({ code: '57014' })).toBe(true);
    // Review R3: a deadlock or serialization failure that outlived its retries is a 503 too.
    expect(['40P01', '40001'].map((c) => dbUnavailable(wrapped(c)))).toEqual([true, true]);
    expect(['23505', '42P01'].map((c) => dbUnavailable(wrapped(c)))).toEqual([false, false]);
    expect(dbUnavailable(new Error('x'))).toBe(false);
    expect(dbUnavailable(undefined)).toBe(false);
  });

  it('a lock wait past lock_timeout is 503 unavailable with Retry-After 5, not a 500', async () => {
    const chatId = await newChat();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    // Another session holds the chat row (as a long transaction would).
    const holder = ctx.db.transaction(async (tx) => {
      await tx.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId)).for('update');
      locked();
      await held;
    });
    await isLocked;
    const res = await ctx.app.inject({ method: 'PATCH', url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie }, payload: { title: 'renamed' } });
    release();
    await holder;
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe(String(DB_RETRY_AFTER_S));
    expect((res.json() as { error: { code: string } }).error.code).toBe('unavailable');
  });
});

describe('the settle transaction', () => {
  it('rolls back the message, the turn and the reservation when a later step fails', async () => {
    await ctx.app.inject({ method: 'PATCH', url: '/v1/usage/limits', headers: { cookie: user.cookie }, payload: { dailyTokenBudget: 1_000_000 } });
    const chatId = await newChat();
    const [userRow] = await ctx.db.insert(messages).values({ chatId, userId: user.id, seq: 0, role: 'user', text: 'q', status: 'complete' }).returning();
    const [assistant] = await ctx.db.insert(messages).values({ chatId, userId: user.id, seq: 1, role: 'assistant', text: 'partial', status: 'generating' }).returning();
    const [turn] = await ctx.db
      .insert(turns)
      .values({
        chatId,
        userId: user.id,
        userMessageId: userRow!.id,
        assistantMessageId: assistant!.id,
        kind: 'send',
        state: 'running',
        requestId: 'r',
        params: { mode: 'chat', modelAlias: 'Auto', attachmentIds: [], codeExecution: false, projectId: null },
        leaseOwner: 'test',
        leaseExpiresAt: dbNowPlus(30_000),
        deadline: dbNowPlus(60_000),
      })
      .returning();
    const prefs = { dailyTokenBudget: 1_000_000, monthlyTokenBudget: null, warnThresholdPct: 80, timezone: 'UTC' };
    const usage = ctx.app.services.usage;
    const reservation = await usage.reserve(user.id, prefs, 500, { owner: 'turn', turnId: turn!.id, expiresAt: new Date(Date.now() + 60_000) });
    const reservedBefore = await ctx.db.select({ r: usageCounters.tokensReserved }).from(usageCounters).where(eq(usageCounters.userId, user.id));

    const spy = vi.spyOn(usage, 'record').mockRejectedValueOnce(new Error('usage row refused'));
    await expect(
      settleTurn(
        ctx.app.services,
        { userId: user.id, chatId, messageId: assistant!.id, requestId: 'r', projectId: null },
        { turnId: turn!.id, fencingToken: turn!.fencingToken, reservation },
        {
          message: {
            kind: 'final',
            text: 'the whole answer',
            sources: [],
            searchEntryPoint: undefined,
            status: 'complete',
            errorCode: null,
            finishReason: 'stop',
            model: { alias: 'Gemini 3.8 Flash', provider: 'google', providerModelId: 'fake-flash' },
            mode: 'chat',
          },
          usage: {
            prefs,
            modelAlias: 'Gemini 3.8 Flash',
            provider: 'google',
            providerModelId: 'fake-flash',
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
            startedAt: new Date(),
            status: 'complete',
          },
          end: 'done',
          finishCode: 'stop',
        },
      ),
    ).rejects.toThrow('usage row refused');
    expect(spy).toHaveBeenCalledOnce();

    const [row] = await ctx.db.select({ status: messages.status, text: messages.text }).from(messages).where(eq(messages.id, assistant!.id));
    expect(row).toEqual({ status: 'generating', text: 'partial' });
    const [t] = await ctx.db.select({ state: turns.state, endedAt: turns.endedAt }).from(turns).where(eq(turns.id, turn!.id));
    expect(t).toEqual({ state: 'running', endedAt: null });
    const holds = await ctx.db.select({ status: budgetReservations.status }).from(budgetReservations).where(and(eq(budgetReservations.turnId, turn!.id)));
    expect(holds).toEqual([{ status: 'held' }]);
    const reservedAfter = await ctx.db.select({ r: usageCounters.tokensReserved }).from(usageCounters).where(eq(usageCounters.userId, user.id));
    expect(reservedAfter).toEqual(reservedBefore);
    // Clean up the hold so the counters of this user stay true for anything after.
    await usage.release(reservation);
    await ctx.db.execute(sql`update turns set state = 'cancelled' where id = ${turn!.id}`);
  });
});

/** A chat with a running turn and its generating assistant row, as a start leaves them. */
async function runningTurn(leaseMs = 30_000) {
  const chatId = await newChat();
  const [userRow] = await ctx.db.insert(messages).values({ chatId, userId: user.id, seq: 0, role: 'user', text: 'q', status: 'complete' }).returning();
  const [assistant] = await ctx.db.insert(messages).values({ chatId, userId: user.id, seq: 1, role: 'assistant', text: 'partial', status: 'generating' }).returning();
  const [turn] = await ctx.db
    .insert(turns)
    .values({
      chatId,
      userId: user.id,
      userMessageId: userRow!.id,
      assistantMessageId: assistant!.id,
      kind: 'send',
      state: 'running',
      requestId: 'r',
      params: { mode: 'chat', modelAlias: 'Auto', attachmentIds: [], codeExecution: false, projectId: null },
      leaseOwner: 'test',
      leaseExpiresAt: dbNowPlus(leaseMs),
      deadline: dbNowPlus(600_000),
    })
    .returning();
  return { chatId, assistantId: assistant!.id, turn: turn! };
}

describe('lock order (review R3)', () => {
  it('a settle and a start on one chat at once: no deadlock (both take the chat before the turn)', async () => {
    const { chatId, assistantId, turn } = await runningTurn();
    let chatLocked!: () => void;
    const startHasChat = new Promise<void>((r) => (chatLocked = r));
    // The start's order (turnStart.ts): the chat row, then the chat's active turn.
    const start = ctx.db.transaction(async (tx) => {
      await tx.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId)).for('update');
      chatLocked();
      // Long enough for the settle below to take whatever it takes first and block on the rest.
      await new Promise((r) => setTimeout(r, 400));
      await tx.select({ id: turns.id }).from(turns).where(eq(turns.id, turn.id)).for('update');
    });
    await startHasChat;
    // One settle transaction, not retried: a deadlock would surface here as 40P01.
    const settle = ctx.db.transaction((tx) =>
      settleTurnTx(
        ctx.app.services,
        tx,
        { userId: user.id, chatId, messageId: assistantId, requestId: 'r', projectId: null },
        { turnId: turn.id, fencingToken: turn.fencingToken, reservation: null },
        { message: { kind: 'failed', errorCode: 'provider_error', mode: 'chat' }, usage: null, end: 'failed', finishCode: 'provider_error' },
      ),
    );
    const outcomes = await Promise.allSettled([start, settle]);
    const codes = outcomes.map((o) => (o.status === 'rejected' ? ((o.reason as { cause?: { code?: string }; code?: string }).cause?.code ?? (o.reason as { code?: string }).code ?? String(o.reason)) : 'ok'));
    expect(codes).toEqual(['ok', 'ok']);
    const [t] = await ctx.db.select({ state: turns.state }).from(turns).where(eq(turns.id, turn.id));
    expect(t!.state).toBe('failed');
  });
});

describe('a start that meets a deadlock (review R3)', () => {
  it('is retried whole (N-45), not turned into a 500', async () => {
    const chatId = await newChat();
    const real = ctx.app.services.db;
    let calls = 0;
    const db = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return (...args: Parameters<typeof real.transaction>) => {
            calls += 1;
            if (calls === 1) return Promise.reject(Object.assign(new Error('deadlock detected'), { cause: { name: 'PostgresError', code: '40P01' } }));
            return target.transaction(...args);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const prefs = { dailyTokenBudget: null, monthlyTokenBudget: null, warnThresholdPct: 80, timezone: 'UTC' };
    const started = await startTurn(
      { services: { ...ctx.app.services, db } },
      chatId,
      user.id,
      { prompt: 'q', mode: 'chat', model: 'Auto', attachmentIds: [], codeExecution: false },
      { requestId: 'r-retry', projectId: null, prefs, reserveTokens: 10, instanceId: 'test' },
    );
    expect(calls).toBe(2);
    expect(started.replayed).toBe(false);
    const [t] = await ctx.db.select({ state: turns.state }).from(turns).where(eq(turns.id, started.turnId));
    expect(t!.state).toBe('running');
    await ctx.db.execute(sql`update budget_reservations set status = 'released' where turn_id = ${started.turnId}`);
    await ctx.db.execute(sql`update turns set state = 'cancelled' where id = ${started.turnId}`);
  });
});

describe('the sweeper reads the database clock (review R4)', () => {
  it('with the app clock 60 s ahead, a live lease is not swept', async () => {
    const { turn } = await runningTurn(30_000);
    await sweepTurns(ctx.app.services, new Date(Date.now() + 60_000));
    const [t] = await ctx.db.select({ state: turns.state, fencingToken: turns.fencingToken }).from(turns).where(eq(turns.id, turn.id));
    expect(t).toEqual({ state: 'running', fencingToken: turn.fencingToken });
    await ctx.db.execute(sql`update turns set state = 'cancelled' where id = ${turn.id}`);
  });

  it('a lease that lapsed on the database clock is still swept', async () => {
    const { turn } = await runningTurn(-1_000);
    await sweepTurns(ctx.app.services);
    const [t] = await ctx.db.select({ state: turns.state }).from(turns).where(eq(turns.id, turn.id));
    expect(t!.state).toBe('interrupted');
  });
});

describe('the lease after the runner\'s own settle (review R5)', () => {
  it('a heartbeat or cancel tick that runs after the settle committed is not a lost lease', async () => {
    const { chatId, assistantId, turn } = await runningTurn();
    const controller = new AbortController();
    const binding = { turnId: turn.id, fencingToken: turn.fencingToken, reservation: null };
    const runtime = new TurnRuntime(ctx.db, ctx.cfg, binding, assistantId, controller, () => 0);
    runtime.start();
    try {
      await settleTurn(ctx.app.services, { userId: user.id, chatId, messageId: assistantId, requestId: 'r', projectId: null }, binding, {
        message: { kind: 'failed', errorCode: 'provider_error', mode: 'chat' },
        usage: null,
        end: 'failed',
        finishCode: 'provider_error',
      });
      // The ticks launch's `finally` would only stop later: the turn now reads `failed`.
      await runtime.checkCancel();
      await runtime.renew();
      expect(runtime.lost).toBe(false);
      expect(controller.signal.aborted).toBe(false);
    } finally {
      runtime.stop();
    }
  });
});

describe('a run that fails before it reads its turn (review R6)', () => {
  it('gives the turn\'s held reservation back with the failed settle', async () => {
    const prefs = { dailyTokenBudget: 1_000_000, monthlyTokenBudget: null, warnThresholdPct: 80, timezone: 'UTC' };
    await ctx.app.inject({ method: 'PATCH', url: '/v1/usage/limits', headers: { cookie: user.cookie }, payload: { dailyTokenBudget: 1_000_000 } });
    const reserved = async () =>
      (await ctx.db.select({ r: usageCounters.tokensReserved }).from(usageCounters).where(and(eq(usageCounters.userId, user.id), eq(usageCounters.periodKind, 'day')))).reduce((n, c) => n + c.r, 0);
    const before = await reserved();
    const chatId = await newChat();
    const started = await startTurn(
      { services: ctx.app.services },
      chatId,
      user.id,
      { prompt: 'q', mode: 'chat', model: 'Auto', attachmentIds: [], codeExecution: false },
      { requestId: 'r-early', projectId: null, prefs, reserveTokens: 700, instanceId: 'test' },
    );
    expect(await reserved()).toBe(before + 700);

    // The run's first read (`loadTurnInput`) fails, as a dropped connection would.
    const real = ctx.app.services.db;
    let failed = false;
    const db = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'select' && !failed) {
          return () => {
            failed = true;
            throw new Error('connection dropped');
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const run = launchTurn({ ...ctx.app.services, db }, started, { userId: user.id, chatId: started.chatId, requestId: 'r-early', prefs });
    await run.done;
    expect(failed).toBe(true);

    const [t] = await ctx.db.select({ state: turns.state }).from(turns).where(eq(turns.id, started.turnId));
    expect(t!.state).toBe('failed');
    const holds = await ctx.db.select({ status: budgetReservations.status }).from(budgetReservations).where(eq(budgetReservations.turnId, started.turnId));
    expect(holds).toEqual([{ status: 'released' }]);
    expect(await reserved()).toBe(before);
  });
});
