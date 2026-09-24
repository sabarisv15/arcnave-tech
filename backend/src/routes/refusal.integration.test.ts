/**
 * G13 through the route: a provider refusal ends the turn as the typed `model_refused` error,
 * the message is stored as an error, and no `done` claims a completion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('provider refusal (G13)', () => {
  it('streams model_refused with the category and never a done event', async () => {
    ctx.provider.script = [
      { type: 'delta', text: 'Partial' },
      { type: 'refusal', category: 'cyber', explanation: null },
      {
        type: 'completed',
        usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
        finishReason: 'refusal',
      },
    ];
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
    const chatId = (chat.json() as { id: string }).id;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { cookie: user.cookie },
      payload: { prompt: 'something' },
    });
    const events = res.body
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as { type: string; code?: string; detail?: string });
    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ code: 'model_refused' });
    expect(error!.detail).toContain('cyber');
    expect(events.some((e) => e.type === 'done')).toBe(false);

    const read = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
    const { messages } = read.json() as { messages: Array<{ role: string; status: string; error: string | null }> };
    expect(messages.filter((m) => m.role === 'assistant').at(-1)).toMatchObject({ status: 'error' });
  });
});
