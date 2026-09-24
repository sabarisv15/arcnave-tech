/**
 * ADR-0006 end to end: what actually reaches the provider for a turn the router used to classify
 * as "no tools needed". The router unit tests prove the decision; these prove the request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

async function sendTurn(ctx: TestContext, user: TestUser, prompt: string) {
  const chat = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers: { cookie: user.cookie },
    payload: { title: 'New conversation' },
  });
  const chatId = (chat.json() as { id: string }).id;
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie: user.cookie },
    payload: { prompt },
  });
  expect(response.statusCode).toBe(200);
  return ctx.provider.seen.at(-1)!;
}

describe('tool exposure with tool use on (ADR-0006)', () => {
  let ctx: TestContext;
  let user: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true' });
    user = await signUp(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  for (const prompt of ['hi', 'explain Monte Carlo simulation', 'Count every transaction exactly and classify them']) {
    it(`"${prompt}" reaches the provider with search_tools and load_skill declared`, async () => {
      const request = await sendTurn(ctx, user, prompt);
      const names = (request.tools ?? []).map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['search_tools', 'load_skill']));
    });
  }

  it('advertises skills only alongside a load_skill the model can call (G7)', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(request.systemInstruction).toContain('<available_skills>');
    expect((request.tools ?? []).map((t) => t.name)).toContain('load_skill');
  });

  it('tells the model what is declared and that a direct answer is fine', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(request.systemInstruction).toContain('Declared on every turn: search_tools and load_skill');
    expect(request.systemInstruction).toContain('When a direct answer is enough, answer directly without tools.');
  });
});

describe('tool exposure with tool use off (G7, Invariant 1)', () => {
  let ctx: TestContext;
  let user: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp({ ENABLE_TOOL_USE: 'false', ENABLE_SKILLS: 'true' });
    user = await signUp(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('sends no tools and names no tool or skill it cannot reach', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(request.tools ?? []).toEqual([]);
    expect(request.systemInstruction).not.toContain('<available_skills>');
    expect(request.systemInstruction).not.toContain('load_skill');
    expect(request.systemInstruction).not.toContain('search_tools');
  });
});
