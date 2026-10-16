/**
 * Claude keeps one model for a conversation. Under Auto, ArcNave keeps the model the chat last
 * answered with, rather than handing a follow-up to another model. Auto itself always picks
 * Gemini (Stage 7 RT-1, ADR-0076); the keep rule is unchanged (Stage 7 is silent on it) except
 * that Auto never keeps Opus, a manual choice only.
 */
import { afterEach, expect, it } from 'vitest';

import type { TestContext } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function resolved(cookie: string, chatId: string, prompt: string, model = 'Auto'): Promise<string> {
  const response = await ctx!.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie },
    payload: { prompt, model },
  });
  const start = response.body.split('\n').find((l) => l.startsWith('data:') && l.includes('"type":"start"'))!;
  return (JSON.parse(start.slice(5)) as { model: { resolved: string } }).model.resolved;
}

it('keeps the model the chat answered with for an Auto follow-up; a new chat routes to Gemini', async () => {
  ctx = await createTestApp();
  const user = await signUp(ctx);
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'x' } });
  const chatId = (chat.json() as { id: string }).id;

  // A long question under Auto is Gemini: length promotes nothing (RT-1).
  expect(await resolved(user.cookie, chatId, 'a long question '.repeat(200))).toBe('Gemini 3.8 Flash');
  // The user picks Sonnet by name; an Auto follow-up stays with it.
  expect(await resolved(user.cookie, chatId, 'now you', 'Sonnet 5.5')).toBe('Sonnet 5.5');
  expect(await resolved(user.cookie, chatId, 'and then?')).toBe('Sonnet 5.5');

  // A new chat routes afresh.
  const other = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'y' } });
  expect(await resolved(user.cookie, (other.json() as { id: string }).id, 'hi')).toBe('Gemini 3.8 Flash');
});

it('never keeps Opus under Auto: Opus is a manual choice only (Stage 18, ADR-0076)', async () => {
  ctx = await createTestApp();
  const user = await signUp(ctx);
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'x' } });
  const chatId = (chat.json() as { id: string }).id;
  expect(await resolved(user.cookie, chatId, 'hard question', 'Opus 5.5')).toBe('Opus 5.5');
  expect(await resolved(user.cookie, chatId, 'and then?')).toBe('Gemini 3.8 Flash');
});
