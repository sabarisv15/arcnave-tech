import { afterEach, describe, expect, it } from 'vitest';

import { messages } from '../db/schema.js';
import type { TestContext } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('GET /v1/models reasoningEfforts', () => {
  it('lists reasoningEfforts for each model and safe intersection for Auto when unresolved', async () => {
    ctx = await createTestApp();
    const user = await signUp(ctx);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      auto: { alias: string; reasoningEfforts: string[] };
      models: Array<{ alias: string; reasoningEfforts: string[] }>;
    };

    // Auto when chat model is not known yet: lists only the levels that every Auto candidate supports (CLAUDE.md Invariant 1)
    // Gemini 3.8 Flash supports low, medium, high; Sonnet 5 supports low, medium, high, xhigh, max.
    // The intersection must NOT contain xhigh or max.
    expect(body.auto.reasoningEfforts).toEqual(['low', 'medium', 'high']);

    const sonnet = body.models.find((m) => m.alias === 'Sonnet 5');
    expect(sonnet).toBeDefined();
    expect(sonnet!.reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);

    const gemini = body.models.find((m) => m.alias === 'Gemini 3.8 Flash');
    expect(gemini).toBeDefined();
    expect(gemini!.reasoningEfforts).toEqual(['low', 'medium', 'high']);

    const gpt = body.models.find((m) => m.alias === 'GPT-OSS 120B');
    expect(gpt).toBeDefined();
    expect(gpt!.reasoningEfforts).toEqual([]);
  });

  it('lists the levels of the resolved model for Auto when chatId is provided and chat has a model', async () => {
    ctx = await createTestApp();
    const user = await signUp(ctx);

    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: { cookie: user.cookie },
      payload: { title: 'Test Chat' },
    });
    const chatId = (chat.json() as { id: string }).id;

    // Simulate an assistant message that used Sonnet 5
    await ctx.db.insert(messages).values({
      chatId,
      userId: user.id,
      seq: 0,
      role: 'assistant',
      text: 'Hello from Sonnet',
      modelAlias: 'Sonnet 5',
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/models?chatId=${chatId}`,
      headers: { cookie: user.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      auto: { alias: string; reasoningEfforts: string[] };
    };

    // Because the chat resolved to Sonnet 5, Auto reflects Sonnet 5's levels
    expect(body.auto.reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it("ignores another user's chatId instead of reading their chat's model", async () => {
    ctx = await createTestApp();
    const owner = await signUp(ctx, 'Owner');
    const other = await signUp(ctx, 'Other');
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: owner.cookie }, payload: { title: 'Private' } });
    const chatId = (chat.json() as { id: string }).id;
    await ctx.db.insert(messages).values({ chatId, userId: owner.id, seq: 0, role: 'assistant', text: 'x', modelAlias: 'Sonnet 5' });

    const asOther = await ctx.app.inject({ method: 'GET', url: `/v1/models?chatId=${chatId}`, headers: { cookie: other.cookie } });
    const asOwner = await ctx.app.inject({ method: 'GET', url: `/v1/models?chatId=${chatId}`, headers: { cookie: owner.cookie } });
    // The other user sees the no-chat answer (every candidate's shared levels), not Sonnet 5's.
    expect((asOther.json() as { auto: { reasoningEfforts: string[] } }).auto.reasoningEfforts).toEqual(['low', 'medium', 'high']);
    expect((asOwner.json() as { auto: { reasoningEfforts: string[] } }).auto.reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
});
