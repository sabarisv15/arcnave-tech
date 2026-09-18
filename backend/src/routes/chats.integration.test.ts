/**
 * Streaming generation: SSE framing, persistence, cancellation, budgets, and usage.
 *
 * The provider is faked, so nothing here reaches Vertex. What is real is everything between
 * the HTTP request and the provider boundary — which is where the behaviour that is hard to
 * get right lives: a row that must exist before the first token, a cancellation that must
 * reach the provider rather than merely stop the writer, and a usage record that must be
 * written even when the run failed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, FakeProvider, multipart, parseSse, signUp, sleep, sseText } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});

afterEach(() => {
  // Each test owns the script; reset so one test's edits cannot leak into the next.
  const fresh = new FakeProvider();
  ctx.provider.script = fresh.script;
  ctx.provider.gapMs = 0;
  ctx.provider.streamError = null;
  ctx.provider.probeError = null;
  ctx.provider.grounding = true;
  ctx.provider.codeExecutionSupported = false;
});

afterAll(async () => {
  await ctx.close();
});

const auth = (): { cookie: string } => ({ cookie: user.cookie });

async function newChat(headers = auth()): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers,
    payload: { title: 'New conversation' },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

function generate(
  chatId: string,
  payload: Record<string, unknown> = {},
  headers = auth(),
): Promise<{ statusCode: number; body: string }> {
  return ctx.app
    .inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers,
      payload: { prompt: 'What is in the notes?', ...payload },
    })
    .then((r) => ({ statusCode: r.statusCode, body: r.body }));
}

interface Transcript {
  messages: Array<{
    id: string;
    role: string;
    text: string;
    status: string;
    errorCode: string | null;
    modelAlias: string | null;
    finishReason: string | null;
  }>;
}

async function transcript(chatId: string, headers = auth()): Promise<Transcript> {
  const response = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers });
  return response.json() as Transcript;
}

/* -------------------------------------------------------------------------- happy path */

describe('streaming generation', () => {
  it('streams start, deltas, and done, in that order', async () => {
    const chatId = await newChat();
    const { statusCode, body } = await generate(chatId);

    expect(statusCode).toBe(200);
    const frames = parseSse(body);
    const events = frames.map((f) => f.event);

    expect(events[0]).toBe('start');
    expect(events.at(-1)).toBe('done');
    expect(events).toContain('delta');
    expect(sseText(frames)).toBe('Hello, world.');
  });

  it('sends CORS headers on the SSE response for an allowed origin', async () => {
    // The SSE handler writes its response headers via `reply.raw.writeHead`, bypassing
    // Fastify's reply pipeline entirely — which is where `@fastify/cors` normally injects
    // these. A regression here is invisible whenever frontend and API are same-origin, and a
    // hard failure (browser blocks the response before any event body is read) the moment
    // they are not. See mistakes.md.
    const chatId = await newChat();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { ...auth(), origin: 'http://localhost:5173' },
      payload: { prompt: 'What is in the notes?' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('omits the CORS origin header for an origin that is not allow-listed', async () => {
    const chatId = await newChat();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { ...auth(), origin: 'https://not-arcnave.example' },
      payload: { prompt: 'What is in the notes?' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('names the model that answered in the start frame', async () => {
    const chatId = await newChat();
    const frames = parseSse((await generate(chatId, { model: 'Opus 5' })).body);
    const start = frames.find((f) => f.event === 'start')!;

    expect(start.data).toMatchObject({
      chatId,
      model: { requested: 'Opus 5', resolved: 'Opus 5', providerModelId: 'fake-opus' },
    });
    expect(String(start.data['messageId'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports the routing rule when the request asked for Auto', async () => {
    const chatId = await newChat();
    const frames = parseSse((await generate(chatId)).body);
    const model = (frames.find((f) => f.event === 'start')!.data as {
      model: { requested: string; routing?: { rule: string; considered: string[] } };
    }).model;

    expect(model.requested).toBe('Auto');
    expect(model.routing?.rule).toBeTruthy();
    expect(model.routing?.considered.length).toBeGreaterThan(0);
  });

  it('persists both turns, so a reload shows the answer', async () => {
    const chatId = await newChat();
    await generate(chatId, { prompt: 'Remember this' });

    const { messages } = await transcript(chatId);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', text: 'Remember this', status: 'complete' });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      text: 'Hello, world.',
      status: 'complete',
      finishReason: 'stop',
    });
  });

  it('titles the chat from the first message', async () => {
    const chatId = await newChat();
    await generate(chatId, { prompt: 'Draft the Q3 budget memo' });

    const response = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: auth() });
    expect((response.json() as { title: string }).title).toBe('Draft the Q3 budget memo');
  });

  it('passes prior turns to the provider as history', async () => {
    const chatId = await newChat();
    await generate(chatId, { prompt: 'first question' });
    await generate(chatId, { prompt: 'second question' });

    const lastRequest = ctx.provider.seen.at(-1)!;
    expect(lastRequest.prompt).toBe('second question');
    expect(lastRequest.history.map((t) => t.text)).toContain('first question');
  });
});

/* -------------------------------------------------------------------------- code execution */

describe('code execution', () => {
  it('refuses when the resolved provider has no code-execution tool, rather than silently skipping it', async () => {
    ctx.provider.codeExecutionSupported = false;
    const chatId = await newChat();
    const frames = parseSse((await generate(chatId, { codeExecution: true })).body);

    // The response is already committed as 200 text/event-stream by the time this is thrown.
    expect(frames.at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'capability_unavailable' },
    });
  });

  it('passes the flag to the provider and forwards its code events as SSE frames', async () => {
    ctx.provider.codeExecutionSupported = true;
    ctx.provider.script = [
      { type: 'code', code: 'print(2 + 2)', output: '4' },
      { type: 'delta', text: 'The answer is 4.' },
      {
        type: 'completed',
        usage: { inputTokens: 5, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
        finishReason: 'stop',
      },
    ];
    const chatId = await newChat();
    const frames = parseSse((await generate(chatId, { codeExecution: true })).body);

    expect(frames.find((f) => f.event === 'code')?.data).toMatchObject({
      code: 'print(2 + 2)',
      output: '4',
    });
    expect(ctx.provider.seen.at(-1)!.codeExecution).toBe(true);
  });

  it('never enables it unasked, even when the provider supports it', async () => {
    ctx.provider.codeExecutionSupported = true;
    const chatId = await newChat();
    await generate(chatId);

    expect(ctx.provider.seen.at(-1)!.codeExecution).toBe(false);
  });
});

/* -------------------------------------------------------------------------- usage */

describe('usage recording', () => {
  it('writes the providers own token counts and marks them exact', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const chatId = await newChat(headers);
    await generate(chatId, {}, headers);

    const response = await ctx.app.inject({
      url: `/v1/usage/messages?chatId=${chatId}`,
      headers,
    });
    const items = (response.json() as { items: Array<Record<string, unknown>> }).items;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      exact: true,
      status: 'complete',
      providerModelId: expect.stringContaining('fake-') as unknown,
    });
    // No pricing table in the test environment, so cost is unknown — not free.
    expect(items[0]!['costUsd']).toBeNull();
  });

  it('labels counts as inexact when the provider reports nothing', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    ctx.provider.script = [
      { type: 'delta', text: 'answer' },
      {
        type: 'completed',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          exact: false,
        },
        finishReason: 'stop',
      },
    ];

    const chatId = await newChat(headers);
    await generate(chatId, {}, headers);

    const response = await ctx.app.inject({
      url: `/v1/usage/messages?chatId=${chatId}`,
      headers,
    });
    const items = (response.json() as { items: Array<{ exact: boolean; totalTokens: number }> }).items;
    expect(items[0]).toMatchObject({ exact: false, totalTokens: 0 });
  });

  it('rolls into the summary totals', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    await generate(await newChat(headers), {}, headers);

    const summary = await ctx.app.inject({ url: '/v1/usage', headers });
    const body = summary.json() as {
      today: { totalTokens: number; requests: number };
      byModel: Array<{ key: string | null; totalTokens: number }>;
    };

    expect(body.today).toMatchObject({ totalTokens: 18, requests: 1 });
    expect(body.byModel.some((m) => m.totalTokens === 18)).toBe(true);
  });

  it('exports a real row to CSV once a generation has happened', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    await generate(await newChat(headers), {}, headers);

    const response = await ctx.app.inject({ url: '/v1/usage/export', headers });
    const lines = response.body.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(',18,');
    expect(lines[1]).toContain('complete');
    // Trailing empty cost cell: unpriced, not zero.
    expect(lines[1]!.includes(',,')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- failure */

describe('failure handling', () => {
  it('delivers a provider failure as an error frame, not a status code', async () => {
    ctx.provider.streamError = new Error('upstream exploded');
    const chatId = await newChat();
    const { statusCode, body } = await generate(chatId);

    // The response is already committed as 200 text/event-stream by the time this happens.
    expect(statusCode).toBe(200);
    const frames = parseSse(body);
    expect(frames.at(-1)!.event).toBe('error');
    // The upstream message is not echoed to the client.
    expect(body).not.toContain('upstream exploded');
  });

  it('leaves the assistant row in error, never stuck generating', async () => {
    ctx.provider.streamError = new Error('upstream exploded');
    const chatId = await newChat();
    await generate(chatId);

    const { messages } = await transcript(chatId);
    const assistant = messages.find((m) => m.role === 'assistant')!;
    expect(assistant.status).toBe('error');
    expect(assistant.errorCode).not.toBeNull();
    expect(assistant.status).not.toBe('generating');
  });

  it('records the failed attempt in usage rather than losing it', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    ctx.provider.streamError = new Error('upstream exploded');

    const chatId = await newChat(headers);
    await generate(chatId, {}, headers);

    const response = await ctx.app.inject({ url: '/v1/usage/export', headers });
    expect(response.body).toContain('error');
  });

  it('reports no_model_available when nothing is configured, and closes the row', async () => {
    const bare = await createTestApp({
      MODEL_GEMINI_FLASH: '',
      MODEL_SONNET: '',
      MODEL_OPUS: '',
      MODEL_GPT_OSS: '',
    });
    try {
      const owner = await signUp(bare);
      const headers = { cookie: owner.cookie };
      const chat = await bare.app.inject({
        method: 'POST',
        url: '/v1/chats',
        headers,
        payload: { title: 'no models' },
      });
      const chatId = (chat.json() as { id: string }).id;

      const stream = await bare.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers,
        payload: { prompt: 'hello' },
      });

      const frames = parseSse(stream.body);
      expect(frames.at(-1)).toMatchObject({
        event: 'error',
        data: { code: 'no_model_available' },
      });

      const read = await bare.app.inject({ url: `/v1/chats/${chatId}`, headers });
      const assistant = (read.json() as Transcript).messages.find((m) => m.role === 'assistant')!;
      expect(assistant).toMatchObject({ status: 'error', errorCode: 'no_model_available' });
    } finally {
      await bare.close();
    }
  });
});

/* -------------------------------------------------------------------------- cancellation */

describe('cancellation', () => {
  it('stops a run in flight from a different connection', async () => {
    ctx.provider.gapMs = 120;
    ctx.provider.script = [
      { type: 'delta', text: 'one ' },
      { type: 'delta', text: 'two ' },
      { type: 'delta', text: 'three ' },
      { type: 'delta', text: 'four ' },
      {
        type: 'completed',
        usage: {
          inputTokens: 5,
          outputTokens: 4,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          exact: true,
        },
        finishReason: 'stop',
      },
    ];

    const chatId = await newChat();
    const running = generate(chatId);
    await sleep(200);

    const stop = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/stop`,
      headers: auth(),
    });
    expect(stop.json()).toEqual({ stopped: true });

    const { body } = await running;
    // Cut short: the full script would have produced all four words.
    expect(sseText(parseSse(body))).not.toContain('four');
  });

  it('reports nothing to stop on an idle chat', async () => {
    const chatId = await newChat();
    const stop = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/stop`,
      headers: auth(),
    });
    expect(stop.json()).toEqual({ stopped: false });
  });

  it('refuses a second run on a chat that is already generating', async () => {
    ctx.provider.gapMs = 150;
    const chatId = await newChat();
    const first = generate(chatId);
    await sleep(80);

    const second = await generate(chatId);
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain('run_in_progress');

    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/stop`, headers: auth() });
    await first;
  });

  it('frees the chat again once the run ends', async () => {
    const chatId = await newChat();
    await generate(chatId);
    // If the run were not cleared from activeRuns, this would be a 409.
    expect((await generate(chatId)).statusCode).toBe(200);
  });
});

/* -------------------------------------------------------------------------- budgets */

describe('budget enforcement', () => {
  it('blocks the next request once the budget is spent, before calling the provider', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };

    // The fake reports 18 tokens per run, so a budget of 10 is already over after one.
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers,
      payload: { dailyTokenBudget: 10 },
    });

    const chatId = await newChat(headers);
    const first = await generate(chatId, {}, headers);
    expect(parseSse(first.body).at(-1)!.event).toBe('done');

    const callsBefore = ctx.provider.seen.length;
    const second = await generate(chatId, { prompt: 'again' }, headers);

    expect(parseSse(second.body).at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'budget_exceeded' },
    });
    // The point of reserving rather than checking afterwards: no provider call was made.
    expect(ctx.provider.seen.length).toBe(callsBefore);
  });

  it('says which budget and by how much', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers,
      payload: { dailyTokenBudget: 10 },
    });

    const chatId = await newChat(headers);
    await generate(chatId, {}, headers);
    const blocked = await generate(chatId, { prompt: 'again' }, headers);

    expect(blocked.body).toContain('daily');
  });

  it('does not block when no budget is set', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const chatId = await newChat(headers);

    await generate(chatId, {}, headers);
    const second = await generate(chatId, { prompt: 'again' }, headers);
    expect(parseSse(second.body).at(-1)!.event).toBe('done');
  });
});

/* -------------------------------------------------------------------------- retry & branch */

describe('retry and branch', () => {
  it('reuses the assistant row on retry instead of appending a new pair', async () => {
    const chatId = await newChat();
    await generate(chatId);

    const before = await transcript(chatId);
    const assistantId = before.messages.find((m) => m.role === 'assistant')!.id;

    ctx.provider.script = [
      { type: 'delta', text: 'a better answer' },
      {
        type: 'completed',
        usage: {
          inputTokens: 3,
          outputTokens: 3,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          exact: true,
        },
        finishReason: 'stop',
      },
    ];
    await generate(chatId, { retryMessageId: assistantId });

    const after = await transcript(chatId);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.messages.find((m) => m.id === assistantId)).toMatchObject({
      text: 'a better answer',
      status: 'complete',
    });
  });

  it('refuses to retry a user message', async () => {
    const chatId = await newChat();
    await generate(chatId);
    const { messages } = await transcript(chatId);
    const userMessageId = messages.find((m) => m.role === 'user')!.id;

    const response = await generate(chatId, { retryMessageId: userMessageId });
    expect(response.body).toContain('validation_error');
  });

  it('copies history into a branch without linking the two chats', async () => {
    const chatId = await newChat();
    await generate(chatId, { prompt: 'original question' });

    const branch = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/branch`,
      headers: auth(),
      payload: {},
    });
    expect(branch.statusCode).toBe(201);

    const branchId = (branch.json() as { id: string }).id;
    const copied = await transcript(branchId);
    expect(copied.messages.map((m) => m.text)).toContain('original question');

    // Editing the branch must not touch the original.
    await generate(branchId, { prompt: 'only in the branch' });
    const original = await transcript(chatId);
    expect(original.messages.map((m) => m.text)).not.toContain('only in the branch');
  });
});

/* -------------------------------------------------------------------------- isolation */

describe('isolation', () => {
  it('refuses to generate into another users chat', async () => {
    const chatId = await newChat();
    const intruder = await signUp(ctx);
    const response = await generate(chatId, {}, { cookie: intruder.cookie });
    expect(response.statusCode).toBe(404);
  });

  it('refuses to stop another users run', async () => {
    const chatId = await newChat();
    const intruder = await signUp(ctx);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/stop`,
      headers: { cookie: intruder.cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

/* -------------------------------------------------------------------------- vision */

describe('vision capability gate', () => {
  it('refuses to send an image to a model that cannot see it', async () => {
    const chatId = await newChat();
    const part = multipart(
      'photo.png',
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]),
      'image/png',
    );
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...part.headers, ...auth() },
      payload: part.payload,
    });
    expect(upload.statusCode).toBe(201);
    const attachmentId = (upload.json() as { id: string }).id;

    const response = await generate(chatId, {
      model: 'GPT-OSS 120B',
      attachmentIds: [attachmentId],
    });

    expect(response.statusCode).toBe(200);
    const frames = parseSse(response.body);
    const errorFrame = frames.find((f) => f.event === 'error');
    expect(errorFrame?.data['code']).toBe('capability_unavailable');
  });
});

describe('attachments carried across turns', () => {
  it('re-sends an image attached in an earlier turn on a later one', async () => {
    const chatId = await newChat();
    const part = multipart(
      'photo.png',
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 2)]),
      'image/png',
    );
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...part.headers, ...auth() },
      payload: part.payload,
    });
    const attachmentId = (upload.json() as { id: string }).id;

    const first = await generate(chatId, { prompt: 'What is in this photo?', attachmentIds: [attachmentId] });
    expect(first.statusCode).toBe(200);

    const second = await generate(chatId, { prompt: 'Describe it again, differently.' });
    expect(second.statusCode).toBe(200);

    // provider.seen[0] is the first turn's request, [1] is the second's.
    const secondRequest = ctx.provider.seen[ctx.provider.seen.length - 1]!;
    const carried = secondRequest.history.find((t) => (t.attachments?.length ?? 0) > 0);
    expect(carried?.attachments?.[0]).toMatchObject({ mimeType: 'image/png' });
  });
});
