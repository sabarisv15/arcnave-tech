/**
 * The labelled fallback through the real route, service and gateway (P11 exit test, ADR-0081;
 * Stage 7 RT-6 / 7.12, Stage 15 ER-14, OQ-02 A, K-15), with two fake providers: one in the
 * Gemini slot, one in the Claude slot. Nothing reaches a model.
 *
 * - Gemini fails 503 three times → Sonnet answers; `model_switch`, `done.fallback` and the
 *   stored row carry the label, so a reload shows it.
 * - A picked Sonnet that is switched off → Gemini, labelled (K-15: never silently through Auto).
 * - A Claude spend cap on Opus → Gemini (every Claude row skipped).
 * - A safety block, a refusal, a passed deadline → no hop.
 * - No tool runs twice across a hop.
 * - A failure after text keeps the partial answer (`interrupted`), and the next turn's history
 *   carries it with its cut marker.
 */
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { messages, toolCalls, usageRecords } from '../db/schema.js';
import { ProviderError } from '../providers/types.js';
import { CUT_MARKERS } from '../services/history/failedExchanges.js';
import { createTestApp, signUp } from '../test/harness.js';
import { answer, ASK, AttemptsProvider, generate, newChat, type Session } from '../test/turnSnapshot.js';

const busy = () => new ProviderError('Gemini request failed: 503', { retryable: true, statusCode: 503 });

describe('labelled fallback (7.12, OQ-02 A)', () => {
  const gemini = new AttemptsProvider();
  const claude = new AttemptsProvider();
  const s = {} as Session;

  beforeAll(async () => {
    s.ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' }, gemini, { anthropic: claude });
    s.user = await signUp(s.ctx);
  });
  afterAll(async () => {
    await s.ctx.close();
  });
  beforeEach(() => {
    for (const p of [gemini, claude]) {
      p.attempts = [];
      p.streamError = null;
      p.script = answer('Hello from the fake.');
      p.seen.length = 0;
    }
  });

  const stored = async (chatId: string) => {
    const res = await s.ctx.app.inject({ method: 'GET', url: `/v1/chats/${chatId}`, headers: { cookie: s.user.cookie } });
    const body = res.json() as { messages: Array<Record<string, unknown>> };
    return body.messages.filter((m) => m.role === 'assistant').at(-1)!;
  };
  const usageOf = async (messageId: string) =>
    (await s.ctx.db.select().from(usageRecords).where(eq(usageRecords.messageId, messageId)).orderBy(desc(usageRecords.startedAt)))[0]!;

  it('GET /v1/status has no banner when ops set none', async () => {
    const res = await s.ctx.app.inject({ method: 'GET', url: '/v1/status' });
    expect(res.json()).toEqual({ incidentBanner: null });
  });

  it('Gemini 503 ×3 → Sonnet answers; model_switch, done.fallback and the stored row carry the label', async () => {
    const chatId = await newChat(s);
    gemini.streamError = busy();
    const res = await generate(s, chatId, { prompt: 'Hi', model: 'Auto' });
    const events = res.frames.map((f) => f.event);
    expect(gemini.seen).toHaveLength(1 + s.ctx.cfg.PROVIDER_MAX_RETRIES);
    expect(claude.seen).toHaveLength(1);
    expect(events).toContain('model_switch');
    expect(res.frames.find((f) => f.event === 'model_switch')!.data).toMatchObject({ from: 'Gemini 3.8 Flash', to: 'Sonnet 5.5', reason: 'unavailable' });
    expect(res.frames.at(-1)).toMatchObject({ event: 'done', data: { fallback: { from: 'Gemini 3.8 Flash', reason: 'unavailable' } } });
    // The Sonnet request was rebuilt for Sonnet (capability stripping is a rebuild, ER-14b).
    expect(claude.seen[0]!.providerModelId).toBe('fake-sonnet');

    const row = await stored(chatId);
    expect(row).toMatchObject({ status: 'complete', modelAlias: 'Sonnet 5.5', fallbackFrom: 'Gemini 3.8 Flash', fallbackReason: 'unavailable', text: 'Hello from the fake.' });
    const usage = await usageOf(row.id as string);
    expect(usage).toMatchObject({ modelAlias: 'Sonnet 5.5', providerModelId: 'fake-sonnet', status: 'complete' });
  });

  it('claude_limit on Opus → Gemini, every Claude row skipped', async () => {
    const chatId = await newChat(s);
    claude.streamError = new ProviderError('Claude account limit reached', { code: 'provider_limit', kind: 'claude_limit', statusCode: 429 });
    const res = await generate(s, chatId, { prompt: 'Hard one', model: 'Opus 5.5' });
    expect(claude.seen).toHaveLength(1);
    expect(gemini.seen).toHaveLength(1);
    expect(res.frames.find((f) => f.event === 'model_switch')!.data).toMatchObject({ from: 'Opus 5.5', to: 'Gemini 3.8 Flash', reason: 'claude_limit' });
    expect(await stored(chatId)).toMatchObject({ modelAlias: 'Gemini 3.8 Flash', fallbackFrom: 'Opus 5.5', fallbackReason: 'claude_limit' });
  });

  it('a safety block ends blocked, with its category: no retry, no other model', async () => {
    const chatId = await newChat(s);
    gemini.streamError = new ProviderError('Gemini blocked the response (safety)', { code: 'response_blocked', kind: 'blocked', refusalCategory: 'safety' });
    const res = await generate(s, chatId, { prompt: 'Blocked', model: 'Auto' });
    expect(gemini.seen).toHaveLength(1);
    expect(claude.seen).toHaveLength(0);
    expect(res.frames.map((f) => f.event)).not.toContain('model_switch');
    expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'response_blocked' } });
    const row = await stored(chatId);
    expect(row).toMatchObject({ status: 'error', errorCode: 'response_blocked', finishReason: 'blocked', fallbackFrom: null });
    expect(await usageOf(row.id as string)).toMatchObject({ status: 'blocked', refusalCategory: 'safety', finishReason: 'blocked' });
  });

  it('a Claude refusal ends blocked with its category, and never falls back (SD-9b)', async () => {
    const chatId = await newChat(s);
    claude.script = [
      { type: 'refusal', category: 'cyber', explanation: null },
      { type: 'completed', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'refusal' },
    ];
    const res = await generate(s, chatId, { prompt: 'Refused', model: 'Sonnet 5.5' });
    expect(gemini.seen).toHaveLength(0);
    expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'model_refused' } });
    const row = await stored(chatId);
    expect(row).toMatchObject({ errorCode: 'model_refused', finishReason: 'blocked' });
    expect(await usageOf(row.id as string)).toMatchObject({ status: 'blocked', refusalCategory: 'cyber' });
  });

  it('no tool runs twice across a hop: a tool that ran ends the turn partial on its model; a hop runs it once', async () => {
    // A tool ran, then a transient failure: no retry, no hop (ER-2b).
    const ranThenFailed = await newChat(s);
    gemini.attempts = [
      async function* (request) {
        const call = { id: 'call_once', name: 'ask_user_input_v0', input: ASK };
        yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
        const result = await request.toolExecutor!.execute(call, request.signal);
        yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
        throw busy();
      },
    ];
    const partial = await generate(s, ranThenFailed, { prompt: 'Ask me', model: 'Auto' });
    expect(claude.seen).toHaveLength(0);
    expect(partial.frames.at(-1)).toMatchObject({ event: 'done', data: { partial: true, errorCode: 'partial_after_tool_run' } });
    const firstRow = await stored(ranThenFailed);
    expect(await s.ctx.db.select().from(toolCalls).where(eq(toolCalls.messageId, firstRow.id as string))).toHaveLength(1);

    // Gemini fails before any tool: the hop's model runs the tool, once.
    const hopped = await newChat(s);
    gemini.streamError = busy();
    claude.attempts = [
      async function* (request) {
        const call = { id: 'call_hop', name: 'ask_user_input_v0', input: ASK };
        yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
        const result = await request.toolExecutor!.execute(call, request.signal);
        yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
        yield* answer('Pick one.');
      },
    ];
    const res = await generate(s, hopped, { prompt: 'Ask me', model: 'Auto' });
    expect(res.frames.at(-1)!.event).toBe('done');
    const row = await stored(hopped);
    const calls = await s.ctx.db.select().from(toolCalls).where(eq(toolCalls.messageId, row.id as string));
    expect(calls.map((c) => c.toolCallId)).toEqual(['call_hop']);
  });

  it('a failure after text keeps the partial answer (interrupted), and the next turn sees its cut marker', async () => {
    const chatId = await newChat(s);
    gemini.attempts = [
      // eslint-disable-next-line require-yield
      async function* () {
        yield { type: 'delta', text: 'The first half' };
        throw busy();
      },
    ];
    const res = await generate(s, chatId, { prompt: 'Write it', model: 'Auto' });
    expect(gemini.seen).toHaveLength(1);
    expect(claude.seen).toHaveLength(0);
    expect(res.frames.at(-1)).toMatchObject({ event: 'done', data: { partial: true, finishReason: 'interrupted', errorCode: 'provider_error' } });
    const row = await stored(chatId);
    expect(row).toMatchObject({ status: 'complete', text: 'The first half', finishReason: 'interrupted', errorCode: 'provider_error' });

    await generate(s, chatId, { prompt: 'and?', model: 'Auto' });
    const history = gemini.seen.at(-1)!.history;
    expect(history.at(-1)!.text).toBe(`The first half\n\n${CUT_MARKERS.cut}`);
  });
});

describe('a picked model that is switched off (K-15)', () => {
  const gemini = new AttemptsProvider();
  const claude = new AttemptsProvider();
  const s = {} as Session;
  beforeAll(async () => {
    s.ctx = await createTestApp({ MODELS_DISABLED: 'Sonnet 5.5', INCIDENT_BANNER: 'Sonnet 5.5 is paused for maintenance.' }, gemini, { anthropic: claude });
    s.user = await signUp(s.ctx);
  });
  afterAll(async () => {
    await s.ctx.close();
  });

  it('goes down its chain to Gemini with a label, not silently through Auto', async () => {
    const chatId = await newChat(s);
    const res = await generate(s, chatId, { prompt: 'Hi', model: 'Sonnet 5.5' });
    expect(res.statusCode).toBe(200);
    expect(claude.seen).toHaveLength(0);
    expect(gemini.seen).toHaveLength(1);
    expect(res.frames.find((f) => f.event === 'start')!.data).toMatchObject({ model: { requested: 'Sonnet 5.5', resolved: 'Gemini 3.8 Flash' } });
    expect(res.frames.find((f) => f.event === 'model_switch')!.data).toMatchObject({ from: 'Sonnet 5.5', to: 'Gemini 3.8 Flash', reason: 'disabled' });
    expect(res.frames.at(-1)).toMatchObject({ event: 'done', data: { fallback: { from: 'Sonnet 5.5', reason: 'disabled' } } });
    const [row] = await s.ctx.db
      .select({ modelAlias: messages.modelAlias, fallbackFrom: messages.fallbackFrom, fallbackReason: messages.fallbackReason })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant')));
    expect(row).toEqual({ modelAlias: 'Gemini 3.8 Flash', fallbackFrom: 'Sonnet 5.5', fallbackReason: 'disabled' });
  });

  it('GET /v1/status serves the ops incident banner without a sign-in (ER-12b)', async () => {
    const res = await s.ctx.app.inject({ method: 'GET', url: '/v1/status' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ incidentBanner: 'Sonnet 5.5 is paused for maintenance.' });
  });

  it('the models list says why it is off', async () => {
    const res = await s.ctx.app.inject({ method: 'GET', url: '/v1/models', headers: { cookie: s.user.cookie } });
    const models = (res.json() as { models: Array<{ alias: string; available: boolean; reason: string }> }).models;
    expect(models.find((m) => m.alias === 'Sonnet 5.5')).toMatchObject({ available: false, reason: 'disabled' });
  });
});

describe('Auto with Gemini switched off', () => {
  const gemini = new AttemptsProvider();
  const claude = new AttemptsProvider();
  const s = {} as Session;
  beforeAll(async () => {
    s.ctx = await createTestApp({ MODELS_DISABLED: 'Gemini 3.8 Flash' }, gemini, { anthropic: claude });
    s.user = await signUp(s.ctx);
  });
  afterAll(async () => {
    await s.ctx.close();
  });

  it('is answered by Sonnet with a label instead of no_model_available', async () => {
    const chatId = await newChat(s);
    const res = await generate(s, chatId, { prompt: 'Hi', model: 'Auto' });
    expect(gemini.seen).toHaveLength(0);
    expect(claude.seen).toHaveLength(1);
    expect(res.frames.find((f) => f.event === 'model_switch')!.data).toMatchObject({ from: 'Gemini 3.8 Flash', to: 'Sonnet 5.5', reason: 'disabled' });
    expect(res.frames.at(-1)!.event).toBe('done');
  });
});

describe('past the turn deadline: no hop (ER-4f)', () => {
  const gemini = new AttemptsProvider();
  const claude = new AttemptsProvider();
  const s = {} as Session;
  beforeAll(async () => {
    s.ctx = await createTestApp({ TURN_DEADLINE_MS: '300' }, gemini, { anthropic: claude });
    s.user = await signUp(s.ctx);
  });
  afterAll(async () => {
    await s.ctx.close();
  });

  it('ends turn_deadline_exceeded and never calls the next model', async () => {
    const chatId = await newChat(s);
    gemini.attempts = [
      // eslint-disable-next-line require-yield
      async function* (request) {
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new DOMException('The operation was aborted.', 'AbortError');
      },
    ];
    const res = await generate(s, chatId, { prompt: 'Slow', model: 'Auto' });
    expect(claude.seen).toHaveLength(0);
    expect(res.frames.map((f) => f.event)).not.toContain('model_switch');
    expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'turn_deadline_exceeded' } });
  });
});
