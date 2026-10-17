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
import { dbNowPlus } from './turnLease.js';
import { settleTurn } from './turnStore.js';

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
  it('maps the three "could not serve in time" SQLSTATEs, however wrapped, and nothing else', () => {
    const wrapped = (code: string) => ({ name: 'DrizzleQueryError', cause: { name: 'PostgresError', code } });
    expect(['57014', '55P03', '53300'].map((c) => dbUnavailable(wrapped(c)))).toEqual([true, true, true]);
    expect(dbUnavailable({ code: '57014' })).toBe(true);
    expect(['23505', '40001', '42P01'].map((c) => dbUnavailable(wrapped(c)))).toEqual([false, false, false]);
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
