/**
 * As Claude's SDK: no first-token cutoff, so a slow request is waited for; a request that fails
 * with a timeout is retried, then ends as `provider_timeout` with an error event, never as a
 * user cancel (ADR-0024).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProviderError } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ PROVIDER_MAX_RETRIES: '1' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('turn deadline', () => {
  it('a turn past TURN_DEADLINE_MS ends as turn_deadline_exceeded, not a user cancel', async () => {
    const slow = await createTestApp({ TURN_DEADLINE_MS: '2000' });
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

const done = (text: string) => [
  { type: 'delta' as const, text },
  { type: 'completed' as const, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
];

async function generate(prompt: string) {
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
  const chatId = (chat.json() as { id: string }).id;
  const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt } });
  const events = res.body
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as { type: string; code?: string });
  const read = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
  const { messages } = read.json() as { messages: Array<{ role: string; status: string }> };
  return { events, last: messages.filter((m) => m.role === 'assistant').at(-1) };
}

describe('provider timeouts, as Claude\'s SDK', () => {
  it('waits for a slow first event instead of cutting it off and retrying', async () => {
    const before = ctx.provider.seen.length;
    // 12 s was the old cutoff; any wait past a fixed budget used to abort. 1.5 s stands in for it.
    ctx.provider.onRequest = () => new Promise((resolve) => setTimeout(resolve, 1_500));
    ctx.provider.script = done('late but fine');
    const { events, last } = await generate('big follow-up');
    ctx.provider.onRequest = null;
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(ctx.provider.seen.length - before).toBe(1);
    expect(last).toMatchObject({ status: 'complete' });
  });

  it('retries a request that timed out, then streams provider_timeout and stores an error', async () => {
    const before = ctx.provider.seen.length;
    ctx.provider.streamError = new ProviderError('Gemini request timed out', { code: 'provider_timeout', retryable: true });
    const { events, last } = await generate('hello');
    ctx.provider.streamError = null;
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_timeout' });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(ctx.provider.seen.length - before).toBe(2);
    expect(last).toMatchObject({ status: 'error' });
  });

  it('treats an abort the caller did not request as a timeout, never as Stop', async () => {
    ctx.provider.streamError = new DOMException('The operation was aborted.', 'AbortError');
    const { events, last } = await generate('hello');
    ctx.provider.streamError = null;
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_timeout' });
    expect(last).toMatchObject({ status: 'error' });
  });
});
