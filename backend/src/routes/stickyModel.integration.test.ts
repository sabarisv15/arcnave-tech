/**
 * Claude keeps one model for a conversation. Under Auto, ArcNave picks a model on the first turn
 * and keeps it for the chat, rather than handing a follow-up to a different tier.
 */
import { afterEach, expect, it } from 'vitest';

import type { TestContext } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function resolved(cookie: string, chatId: string, prompt: string): Promise<string> {
  const response = await ctx!.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie },
    payload: { prompt, model: 'Auto' },
  });
  const start = response.body.split('\n').find((l) => l.startsWith('data:') && l.includes('"type":"start"'))!;
  return (JSON.parse(start.slice(5)) as { model: { resolved: string } }).model.resolved;
}

it('keeps the model Auto chose on the first turn for the rest of the chat', async () => {
  ctx = await createTestApp({ AUTO_ROUTE_LONG_PROMPT_CHARS: '50' });
  const user = await signUp(ctx);
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'x' } });
  const chatId = (chat.json() as { id: string }).id;

  const first = await resolved(user.cookie, chatId, 'a long question '.repeat(10));
  expect(first).toBe('Sonnet 5.5'); // long_prompt → balanced
  // A short follow-up alone would route to economy; the chat keeps its model.
  expect(await resolved(user.cookie, chatId, 'and then?')).toBe('Sonnet 5.5');

  // A new chat routes afresh.
  const other = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'y' } });
  expect(await resolved(user.cookie, (other.json() as { id: string }).id, 'hi')).toBe('Gemini 3.8 Flash');
});
