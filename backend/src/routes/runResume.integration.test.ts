/**
 * A run outlives the connection that started it: dropping the socket mid-answer does not stop
 * the run, and GET /chats/:id/stream replays what was missed and delivers the end.
 */
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;
let base: string;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${String((ctx.app.server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await ctx.close();
});

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true };

function frames(body: string): Array<{ id: number; type: string; text?: string; code?: string }> {
  return body
    .split('\n\n')
    .map((f) => {
      const id = /^id: (\d+)$/m.exec(f)?.[1];
      const data = /^data: (.*)$/m.exec(f)?.[1];
      return id && data ? { id: Number(id), ...(JSON.parse(data) as { type: string }) } : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
}

async function newChat(): Promise<string> {
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
  return (chat.json() as { id: string }).id;
}

describe('run resume', () => {
  it('keeps running after the client disconnects, and a reattach gets every frame and the end', async () => {
    ctx.provider.gapMs = 150;
    ctx.provider.script = [
      { type: 'delta', text: 'one ' },
      { type: 'delta', text: 'two ' },
      { type: 'delta', text: 'three' },
      { type: 'completed', usage, finishReason: 'stop' },
    ];
    const chatId = await newChat();

    const ac = new AbortController();
    const res = await fetch(`${base}/v1/chats/${chatId}/generate`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'count' }),
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await reader.cancel().catch(() => {});

    const again = await fetch(`${base}/v1/chats/${chatId}/stream?after=-1`, { headers: { cookie: user.cookie } });
    expect(again.status).toBe(200);
    const got = frames(await again.text());
    expect(got.map((f) => f.id)).toEqual(got.map((_, i) => i));
    expect(got.filter((f) => f.type === 'delta').map((f) => f.text).join('')).toBe('one two three');
    expect(got.at(-1)?.type).toBe('done');

    const read = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
    const { messages } = read.json() as { messages: Array<{ role: string; status: string; text: string }> };
    expect(messages.filter((m) => m.role === 'assistant').at(-1)).toMatchObject({ status: 'complete', text: 'one two three' });
    ctx.provider.gapMs = 0;
  });

  it('replays only the frames after `after`', async () => {
    ctx.provider.script = [
      { type: 'delta', text: 'a' },
      { type: 'delta', text: 'b' },
      { type: 'completed', usage, finishReason: 'stop' },
    ];
    const chatId = await newChat();
    const first = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt: 'x' } });
    const all = frames(first.body);
    const cut = all.findIndex((f) => f.type === 'delta');
    const again = await ctx.app.inject({ url: `/v1/chats/${chatId}/stream?after=${String(cut)}`, headers: { cookie: user.cookie } });
    expect(frames(again.body)).toEqual(all.slice(cut + 1));
  });

  it('is 404 no_active_run for a chat with no run, and for another user', async () => {
    const chatId = await newChat();
    const none = await ctx.app.inject({ url: `/v1/chats/${chatId}/stream`, headers: { cookie: user.cookie } });
    expect(none.statusCode).toBe(404);
    expect((none.json() as { error: { code: string } }).error.code).toBe('no_active_run');

    const other = await signUp(ctx);
    const denied = await ctx.app.inject({ url: `/v1/chats/${chatId}/stream`, headers: { cookie: other.cookie } });
    expect(denied.statusCode).toBe(404);
  });

  it('stop still aborts a detached run', async () => {
    ctx.provider.gapMs = 200;
    ctx.provider.script = [
      { type: 'delta', text: 'a' },
      { type: 'delta', text: 'b' },
      { type: 'delta', text: 'c' },
      { type: 'completed', usage, finishReason: 'stop' },
    ];
    const chatId = await newChat();
    const ac = new AbortController();
    const res = await fetch(`${base}/v1/chats/${chatId}/generate`, {
      method: 'POST',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x' }),
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await reader.cancel().catch(() => {});

    const stop = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/stop`, headers: { cookie: user.cookie } });
    expect((stop.json() as { stopped: boolean }).stopped).toBe(true);
    const again = await fetch(`${base}/v1/chats/${chatId}/stream`, { headers: { cookie: user.cookie } });
    const got = frames(await again.text());
    expect(got.filter((f) => f.type === 'delta').map((f) => f.text).join('')).not.toBe('abc');
    const read = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
    const { messages } = read.json() as { messages: Array<{ role: string; status: string }> };
    expect(messages.filter((m) => m.role === 'assistant').at(-1)?.status).toBe('stopped');
    ctx.provider.gapMs = 0;
  });
});
