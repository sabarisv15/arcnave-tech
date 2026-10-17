/**
 * The model-call ledger end to end (Stage 4 E19, Stage 17 OD-13; ADR-0079): a turn through the
 * generate route with a fake provider that reports each request as a real adapter does
 * (`call_usage`), and the rows it leaves. In every case the turn's `usage_records` row is the
 * sum of its `model_calls` rows: counts summed, exact only if every call is, cost summed and null
 * when any call is unpriced. Gemini 3.8 Flash is priced from the book; the Sonnet slot is a fake
 * id, so it has no price.
 */
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { budgetReservations, messages, modelCalls, turns, usageRecords } from '../db/schema.js';
import { type ProviderEvent, type ProviderUsage, type UsageSource, ProviderError } from '../providers/types.js';
import { createTestApp, signUp, type TestContext, type TestUser } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  // The default price source (the book), and a real Gemini id so the book prices it.
  ctx = await createTestApp({ MODEL_GEMINI_FLASH: 'gemini-3.8-flash', PRICE_SOURCE: 'book' });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const u = (inputTokens: number, outputTokens: number, o: Partial<ProviderUsage> = {}): ProviderUsage => ({
  inputTokens,
  outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  exact: true,
  lastRequest: { inputTokens, outputTokens },
  ...o,
});
const NONE: ProviderUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, exact: false };

function call(ordinal: number, usage: ProviderUsage, usageSource: UsageSource, finishReason: string): ProviderEvent {
  return { type: 'call_usage', ordinal, usage, usageSource, finishReason, providerRef: { type: 'response_id', value: `resp-${String(ordinal)}` }, ttftMs: 40, durationMs: 240 };
}

interface Case {
  name: string;
  model: string;
  script: ProviderEvent[];
  calls: Array<{ source: UsageSource; exact: boolean; priced: boolean }>;
  turnExact: boolean;
  turnPriced: boolean;
}

const cases: Case[] = [
  {
    name: 'one call',
    model: 'Gemini 3.8 Flash',
    script: [{ type: 'delta', text: 'Hi.' }, call(0, u(1000, 100), 'provider', 'STOP'), { type: 'completed', usage: u(1000, 100), finishReason: 'STOP' }],
    calls: [{ source: 'provider', exact: true, priced: true }],
    turnExact: true,
    turnPriced: true,
  },
  {
    name: 'a three-round tool loop',
    model: 'Gemini 3.8 Flash',
    script: [
      call(0, u(1000, 50, { cacheReadTokens: 200 }), 'provider', 'STOP'),
      call(1, u(1300, 60, { cacheReadTokens: 900 }), 'provider', 'STOP'),
      { type: 'delta', text: 'Done.' },
      call(2, u(1500, 120), 'provider', 'STOP'),
      { type: 'completed', usage: u(3800, 230), finishReason: 'STOP' },
    ],
    calls: [
      { source: 'provider', exact: true, priced: true },
      { source: 'provider', exact: true, priced: true },
      { source: 'provider', exact: true, priced: true },
    ],
    turnExact: true,
    turnPriced: true,
  },
  {
    name: 'stopped mid-request: the provider partial is kept, labelled',
    model: 'Gemini 3.8 Flash',
    script: [
      call(0, u(800, 40), 'provider', 'STOP'),
      { type: 'delta', text: 'Partly' },
      call(1, u(900, 3), 'provider_partial', 'cancelled'),
      { type: 'completed', usage: u(1700, 43), finishReason: 'STOP' },
    ],
    calls: [
      { source: 'provider', exact: true, priced: true },
      { source: 'provider_partial', exact: true, priced: true },
    ],
    turnExact: true,
    turnPriced: true,
  },
  {
    name: 'one inexact call among exact ones: the turn is inexact with zeros, the others keep their counts',
    model: 'Gemini 3.8 Flash',
    script: [
      call(0, u(1000, 50), 'provider', 'STOP'),
      call(1, NONE, 'none', 'STOP'),
      { type: 'delta', text: 'Answer.' },
      call(2, u(1200, 70), 'provider', 'STOP'),
      { type: 'completed', usage: NONE, finishReason: 'STOP' },
    ],
    calls: [
      { source: 'provider', exact: true, priced: true },
      { source: 'none', exact: false, priced: false },
      { source: 'provider', exact: true, priced: true },
    ],
    turnExact: false,
    turnPriced: false,
  },
  {
    name: 'an unpriced model: every cost is null, never 0',
    model: 'Sonnet 5.5',
    script: [{ type: 'delta', text: 'Hi.' }, call(0, u(500, 20), 'provider', 'end_turn'), { type: 'completed', usage: u(500, 20), finishReason: 'end_turn' }],
    calls: [{ source: 'provider', exact: true, priced: false }],
    turnExact: true,
    turnPriced: false,
  },
];

describe('model calls sum to the turn (table)', () => {
  it.each(cases)('$name', async (c) => {
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'ledger' } });
    const chatId = (chat.json() as { id: string }).id;
    ctx.provider.script = c.script;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { cookie: user.cookie },
      payload: { prompt: 'hello', model: c.model },
    });
    expect(res.statusCode).toBe(200);

    const [assistant] = await ctx.db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.seq)).offset(1);
    const [turn] = await ctx.db.select().from(usageRecords).where(eq(usageRecords.messageId, assistant!.id));
    const rows = await ctx.db.select().from(modelCalls).where(eq(modelCalls.usageRecordId, turn!.id)).orderBy(asc(modelCalls.ordinal));

    // The calls, one row each, as the provider reported them.
    expect(rows.map((r) => ({ source: r.usageSource, exact: r.tokensExact, priced: r.costUsd !== null }))).toEqual(c.calls);
    expect(rows.map((r) => r.ordinal)).toEqual(c.calls.map((_, i) => i + 1));
    expect(rows.every((r) => r.role === 'answer' && r.userId === user.id && r.chatId === chatId && r.messageId === assistant!.id)).toBe(true);
    for (const r of rows) {
      // No price, no version, no rate; a price names the book row it came from.
      if (r.costUsd === null) expect([r.costInr, r.priceVersion, r.fxInrPerUsd]).toEqual([null, null, null]);
      else expect(r.priceVersion).toBe('gemini-3.8-flash@2026-10-11-list');
      expect(r.providerRefType).toBe('response_id');
      expect(r.durationMs).toBe(240);
      expect(r.providerTtftMs).toBe(40);
    }

    // The turn row is their sum when every call is exact. With one call that has no counts it is
    // exact:false with zeros (Invariant 3: a part is never shown as the whole); the exact calls keep
    // their own counts in their rows.
    const sum = (k: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens') => (c.turnExact ? rows.reduce((n, r) => n + r[k], 0) : 0);
    expect(turn).toMatchObject({
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      cacheReadTokens: sum('cacheReadTokens'),
      cacheWriteTokens: sum('cacheWriteTokens'),
      totalTokens: sum('inputTokens') + sum('outputTokens'),
      tokensExact: c.turnExact,
    });
    if (!c.turnExact) expect(rows.filter((r) => r.tokensExact).every((r) => r.inputTokens > 0)).toBe(true);
    if (c.turnPriced) {
      const cost = Math.round(rows.reduce((n, r) => n + r.costUsd!, 0) * 1e6) / 1e6;
      expect(turn!.costUsd).toBe(cost);
      expect(turn!.costUsd).toBeGreaterThan(0);
      expect(turn!.priceVersion).toBe('gemini-3.8-flash@2026-10-11-list');
    } else {
      expect([turn!.costUsd, turn!.costInr, turn!.priceVersion]).toEqual([null, null, null]);
    }

    // The OD-8 clocks: measured ones set, none stored as 0 for "unknown".
    expect(turn!.turnTotalMs).toBeGreaterThanOrEqual(0);
    expect(turn!.providerTtftMs).not.toBeNull();
    expect(turn!.firstVisibleMs).not.toBeNull();
    if (c.turnExact) expect(turn!.outputTps).toBeGreaterThan(0);
    else expect(turn!.outputTps).toBeNull();

    // The turn's reservation was settled against this row.
    const [t] = await ctx.db.select({ id: turns.id }).from(turns).where(eq(turns.assistantMessageId, assistant!.id));
    const [hold] = await ctx.db.select().from(budgetReservations).where(eq(budgetReservations.turnId, t!.id));
    expect(hold).toMatchObject({ status: 'settled', settledUsageRecordId: turn!.id, priceVersion: turn!.priceVersion });
    for (const r of rows) expect(r.turnId).toBe(t!.id);

    // And the done frame showed the same figure.
    const done = res.body.split('\n\n').find((b) => b.includes('event: done'));
    const frame = JSON.parse(done!.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as { usage: { costUsd: number | null; exact: boolean } };
    expect(frame.usage).toMatchObject({ costUsd: turn!.costUsd, exact: c.turnExact });
  });
});

describe('a provider that reports no per-call usage', () => {
  it('gets one call row from its completed total', async () => {
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'legacy' } });
    const chatId = (chat.json() as { id: string }).id;
    ctx.provider.script = [{ type: 'delta', text: 'Hi.' }, { type: 'completed', usage: u(300, 30), finishReason: 'STOP' }];
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt: 'x', model: 'Gemini 3.8 Flash' } });
    const [turn] = await ctx.db.select().from(usageRecords).where(eq(usageRecords.chatId, chatId));
    const rows = await ctx.db.select().from(modelCalls).where(eq(modelCalls.usageRecordId, turn!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 300, outputTokens: 30, usageSource: 'provider', tokensExact: true });
    expect(turn).toMatchObject({ inputTokens: 300, outputTokens: 30, costUsd: rows[0]!.costUsd });
  });

  it('a failed request leaves a row with no counts and no price', async () => {
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'failed' } });
    const chatId = (chat.json() as { id: string }).id;
    // A provider failure (an error of ours, not a request, writes no call).
    ctx.provider.streamError = new ProviderError('boom', { retryable: false });
    try {
      await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt: 'x', model: 'Gemini 3.8 Flash' } });
    } finally {
      ctx.provider.streamError = null;
    }
    const [turn] = await ctx.db.select().from(usageRecords).where(eq(usageRecords.chatId, chatId));
    const rows = await ctx.db.select().from(modelCalls).where(eq(modelCalls.usageRecordId, turn!.id));
    expect(rows.map((r) => ({ outcome: r.outcome, source: r.usageSource, exact: r.tokensExact, cost: r.costUsd }))).toEqual([
      { outcome: 'error', source: 'none', exact: false, cost: null },
    ]);
    expect(turn).toMatchObject({ status: 'error', inputTokens: 0, tokensExact: false, costUsd: null });
  });
});
