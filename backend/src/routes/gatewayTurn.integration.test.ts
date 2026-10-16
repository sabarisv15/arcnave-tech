/**
 * The turn-level gateway fixes of tech-build.3 Part A (ADR-0064), through the real route and
 * service with a fake provider (nothing reaches a model):
 *
 * - the history backstop is sized by the resolved model, never `Auto` (D2 X-2);
 * - failed, refused and empty exchanges are left out of the history, question and answer (X-3);
 * - the retry gate counts tool and thinking events: once a tool ran, a failure never re-runs it,
 *   and the turn ends partial with a typed code (Stage 15 ER-2b);
 * - a Gemini 502 is retried by the gateway; a quota-0 429 is not (ER-2e, ER-2g).
 */
import { ApiError as GeminiApiError } from '@google/genai';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { messages, toolCalls } from '../db/schema.js';
import { classifyGeminiError } from '../providers/gemini.js';
import type { GenerationRequest, ProviderEvent } from '../providers/types.js';
import { ProviderError } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, FakeProvider, multipart, parseSse, signUp } from '../test/harness.js';
import { AskUserInputExecutor } from '../tools/optionsExecutor.js';

/**
 * A provider whose next attempts are scripted as functions: each one gets the request (so it can
 * run a tool through the real executor, as an adapter does) and yields events or throws.
 */
class AttemptsProvider extends FakeProvider {
  attempts: Array<(request: GenerationRequest) => AsyncGenerator<ProviderEvent>> = [];

  override async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    const next = this.attempts.shift();
    if (!next) {
      yield* super.stream(request);
      return;
    }
    this.seen.push(request);
    yield* next(request);
  }
}

const usage = (inputTokens = 10) => ({ inputTokens, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true });
const plain = (text: string): ProviderEvent[] => [
  { type: 'delta', text },
  { type: 'completed', usage: usage(), finishReason: 'stop' },
];

let ctx: TestContext;
let provider: AttemptsProvider;
let user: TestUser;

beforeAll(async () => {
  provider = new AttemptsProvider();
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' }, provider);
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  provider.attempts = [];
  provider.streamError = null;
  provider.script = plain('ok');
  vi.restoreAllMocks();
});

async function newChat() {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'g' } });
  const chatId = (res.json() as { id: string }).id;
  return {
    chatId,
    send: async (prompt: string) => {
      const r = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt, model: 'Auto' } });
      expect(r.statusCode).toBe(200);
      return parseSse(r.body);
    },
  };
}

async function lastAssistant(chatId: string) {
  const [row] = await ctx.db
    .select({ id: messages.id, status: messages.status, errorCode: messages.errorCode, finishReason: messages.finishReason, text: messages.text })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant')))
    .orderBy(messages.seq)
    .then((rows) => rows.slice(-1));
  return row!;
}

describe('history is sized by the resolved model, never Auto (D2 X-2)', () => {
  it('Auto with 600k characters of tool results keeps the earliest turn', async () => {
    const { send } = await newChat();
    provider.script = plain('first answer');
    await send('EARLIEST question');
    for (const id of ['big1', 'big2']) {
      provider.script = [
        { type: 'tool_use', toolCallId: id, name: 'bash_tool', input: { command: 'cat' } },
        { type: 'tool_result', toolCallId: id, name: 'bash_tool', result: { toolCallId: id, ok: true, content: [{ type: 'text', text: 'x'.repeat(300_000) }] } },
        ...plain(`answer ${id}`),
      ];
      await send(`turn ${id}`);
    }
    provider.script = plain('ok');
    await send('next');

    const request = provider.seen.at(-1)!;
    expect(request.history[0]).toMatchObject({ role: 'user', text: 'EARLIEST question' });
    expect(request.history.flatMap((t) => t.toolCalls ?? []).map((c) => c.id)).toEqual(['big1', 'big2']);
  });
});

describe('failed, refused and empty exchanges are left out of the history (D2 X-3, R-3)', () => {
  it('omits both sides of a refused, a failed and an empty exchange, and keeps a stopped one that has text', async () => {
    const { chatId, send } = await newChat();
    provider.script = plain('good answer');
    await send('GOOD question');

    provider.script = [{ type: 'refusal', category: 'cyber', explanation: null }, { type: 'completed', usage: usage(), finishReason: 'refusal' }];
    await send('REFUSED question');

    provider.streamError = new ProviderError('bad request', { retryable: false, statusCode: 400 });
    await send('FAILED question');
    provider.streamError = null;

    provider.script = plain('will be emptied');
    await send('EMPTY question');
    await ctx.db.update(messages).set({ text: '', status: 'stopped' }).where(eq(messages.id, (await lastAssistant(chatId)).id));

    provider.script = plain('half an ans');
    await send('STOPPED question');
    await ctx.db.update(messages).set({ status: 'stopped' }).where(eq(messages.id, (await lastAssistant(chatId)).id));

    provider.script = plain('ok');
    await send('next');
    const history = provider.seen.at(-1)!.history.map((t) => `${t.role}:${t.text}`);
    expect(history).toEqual(['user:GOOD question', 'assistant:good answer', 'user:STOPPED question', 'assistant:half an ans']);
    expect(JSON.stringify(provider.seen.at(-1)!.history)).not.toContain('[Response stopped]');
  });
});

describe('a failed exchange keeps what cannot be sent again (review R1#7)', () => {
  it('keeps the question with its file when the answer failed, and an errored answer that ran a tool', async () => {
    const part = multipart('ledger.csv', 'date,amount\n2026-01-01,10\n', 'text/csv');
    const up = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, cookie: user.cookie }, payload: part.payload });
    expect(up.statusCode).toBe(201);
    const fileId = (up.json() as { id: string }).id;

    const { chatId, send } = await newChat();
    provider.streamError = new ProviderError('bad request', { retryable: false, statusCode: 400 });
    const r = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { cookie: user.cookie },
      payload: { prompt: 'FILE question', model: 'Auto', attachmentIds: [fileId] },
    });
    expect(r.statusCode).toBe(200);
    provider.streamError = null;

    provider.script = [
      { type: 'tool_use', toolCallId: 'e1', name: 'bash_tool', input: { command: 'ls' } },
      { type: 'tool_result', toolCallId: 'e1', name: 'bash_tool', result: { toolCallId: 'e1', ok: true, content: [{ type: 'text', text: 'out.xlsx written' }] } },
      ...plain('half'),
    ];
    await send('TOOL question');
    await ctx.db.update(messages).set({ status: 'error', errorCode: 'provider_error' }).where(eq(messages.id, (await lastAssistant(chatId)).id));

    provider.script = plain('ok');
    await send('try again');
    const history = provider.seen.at(-1)!.history;
    expect(history.map((t) => `${t.role}:${t.text}`)).toEqual(['user:FILE question', 'user:TOOL question', 'assistant:half']);
    expect(history[0]!.attachments?.map((a) => a.id)).toEqual([fileId]);
    expect(history[2]!.toolCalls?.map((c) => c.id)).toEqual(['e1']);
  });
});

describe('the retry gate counts tool and thinking events (Stage 15 ER-2b)', () => {
  it('a failure after a tool-only round does not call the tool again; the turn ends partial with a typed code', async () => {
    const spy = vi.spyOn(AskUserInputExecutor.prototype, 'execute');
    provider.attempts = [
      async function* (request) {
        const call = { id: 'q1', name: 'ask_user_input_v0', input: { questions: [{ question: 'Which?', options: ['A', 'B'] }] } };
        yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
        const result = await request.toolExecutor!.execute(call, request.signal);
        yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
        throw new ProviderError('Gemini request failed: 502', { retryable: true, statusCode: 502 });
      },
    ];
    const { chatId, send } = await newChat();
    const seenBefore = provider.seen.length;
    const frames = await send('pick one');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(provider.seen.length - seenBefore).toBe(1);
    const done = frames.find((f) => f.event === 'done');
    expect(done?.data).toMatchObject({ partial: true, errorCode: 'partial_after_tool_run', finishReason: 'partial' });
    expect(frames.some((f) => f.event === 'error')).toBe(false);

    const row = await lastAssistant(chatId);
    expect(row).toMatchObject({ status: 'complete', errorCode: 'partial_after_tool_run', finishReason: 'partial' });
    const stored = await ctx.db.select({ id: toolCalls.toolCallId }).from(toolCalls).where(eq(toolCalls.messageId, row.id));
    expect(stored.map((c) => c.id)).toEqual(['q1']);
  });

  it('a transient failure before any step is still retried', async () => {
    provider.attempts = [
      async function* () {
        throw new ProviderError('busy', { retryable: true, statusCode: 503 });
      },
      async function* () {
        yield* plain('second try');
      },
    ];
    const { send } = await newChat();
    const seenBefore = provider.seen.length;
    const frames = await send('hello');
    expect(provider.seen.length - seenBefore).toBe(2);
    expect(frames.at(-1)?.event).toBe('done');
    expect(frames.at(-1)?.data).not.toHaveProperty('partial');
  });

  it('a failure after thinking was shown is not retried', async () => {
    provider.attempts = [
      async function* () {
        yield { type: 'thinking', text: 'Working it out.' };
        throw new ProviderError('busy', { retryable: true, statusCode: 503 });
      },
    ];
    const { send } = await newChat();
    const seenBefore = provider.seen.length;
    const frames = await send('hello');
    expect(provider.seen.length - seenBefore).toBe(1);
    expect(frames.find((f) => f.event === 'error')?.data).toMatchObject({ code: 'provider_error' });
  });
});

describe('Gemini errors through the gateway (Stage 15 ER-2e, ER-2g)', () => {
  const geminiError = (status: number, message: string, statusText: string) =>
    classifyGeminiError(new GeminiApiError({ message: JSON.stringify({ error: { code: status, message, status: statusText } }), status }), 'fake-flash', 'global');

  it('retries a 502 (PROVIDER_MAX_RETRIES times) and never a quota-0 429', async () => {
    const { send } = await newChat();
    let before = provider.seen.length;
    provider.streamError = geminiError(502, 'Bad Gateway', 'UNAVAILABLE');
    let frames = await send('one');
    expect(provider.seen.length - before).toBe(1 + ctx.cfg.PROVIDER_MAX_RETRIES);
    expect(frames.find((f) => f.event === 'error')?.data).toMatchObject({ code: 'provider_error' });

    before = provider.seen.length;
    provider.streamError = geminiError(429, '* Quota exceeded for metric: m, limit: 0, model: gemini-3.8-flash', 'RESOURCE_EXHAUSTED');
    frames = await send('two');
    expect(provider.seen.length - before).toBe(1);
    expect(frames.find((f) => f.event === 'error')?.data).toMatchObject({ code: 'provider_quota_unavailable' });
  });
});
