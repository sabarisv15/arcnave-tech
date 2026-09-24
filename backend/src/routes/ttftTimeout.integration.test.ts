/**
 * A provider that never sends its first event within the budget is a retryable timeout: the
 * turn retries, then ends as `provider_timeout` with an error event, never as a user cancel.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ PROVIDER_TTFT_BUDGET_MS: '50', PROVIDER_MAX_RETRIES: '1' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('turn deadline', () => {
  it('a turn past TURN_DEADLINE_MS ends as turn_deadline_exceeded, not a user cancel', async () => {
    const slow = await createTestApp({ TURN_DEADLINE_MS: '2000', PROVIDER_TTFT_BUDGET_MS: '60000' });
    try {
      const u = await signUp(slow);
      // Well past the setup time of a cold test app, so the deadline lands mid-stream.
      slow.provider.gapMs = 1000;
      slow.provider.script = [
        { type: 'delta', text: 'a' },
        { type: 'delta', text: 'b' },
        { type: 'delta', text: 'c' },
        { type: 'completed', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
      ];
      const chat = await slow.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: u.cookie }, payload: { title: 't' } });
      const chatId = (chat.json() as { id: string }).id;
      const res = await slow.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers: { cookie: u.cookie },
        payload: { prompt: 'hello' },
      });
      const events = res.body
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice(6)) as { type: string; code?: string });
      expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'turn_deadline_exceeded' });
      const read = await slow.app.inject({ url: `/v1/chats/${chatId}`, headers: { cookie: u.cookie } });
      const { messages } = read.json() as { messages: Array<{ role: string; status: string }> };
      expect(messages.filter((m) => m.role === 'assistant').at(-1)).toMatchObject({ status: 'error' });
    } finally {
      await slow.close();
    }
  });
});

describe('first-token timeout', () => {
  it('retries, then streams provider_timeout and stores the turn as an error', async () => {
    const before = ctx.provider.seen.length;
    ctx.provider.onRequest = (request) =>
      new Promise<void>((resolve) => {
        if (request.signal.aborted) return resolve();
        request.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
    const chatId = (chat.json() as { id: string }).id;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { cookie: user.cookie },
      payload: { prompt: 'hello' },
    });
    ctx.provider.onRequest = null;
    const events = res.body
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as { type: string; code?: string });
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_timeout' });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(ctx.provider.seen.length - before).toBe(2);

    const read = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
    const { messages } = read.json() as { messages: Array<{ role: string; status: string }> };
    expect(messages.filter((m) => m.role === 'assistant').at(-1)).toMatchObject({ status: 'error' });
  });
});
