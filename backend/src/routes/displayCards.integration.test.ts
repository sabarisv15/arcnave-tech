/**
 * A display card and a show_widget visual, end to end (ADR-0048): drawn where the call was made,
 * kept with the reply, and shown the same on a public share. The fake provider drives the real
 * tool executor the way an adapter does; nothing reaches Vertex.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProviderEvent, ToolCall } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_GENERATIVE_UI: 'true' });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const recipe = {
  title: 'Toast',
  ingredients: [{ id: '0001', name: 'bread slices', amount: 2 }],
  steps: [{ id: 's1', title: 'Toast', content: 'Toast {0001}.', timer_seconds: 120 }],
};
const svg = '<svg viewBox="0 0 10 10"><rect class="node"/></svg>';

describe('display cards and visuals in a reply', () => {
  it('streams each where it was called, keeps it with the reply, and shares it', async () => {
    const calls: ToolCall[] = [
      { id: 'card-1', name: 'recipe_display_v0', input: recipe },
      { id: 'vis-1', name: 'show_widget', input: { title: 'box', loading_messages: ['Drawing'], widget_code: svg } },
    ];
    const events: ProviderEvent[] = [];
    ctx.provider.onRequest = async (request) => {
      expect((request.tools ?? []).map((t) => t.name)).toEqual(expect.arrayContaining(['recipe_display_v0', 'show_widget', 'read_me']));
      for (const call of calls) {
        const result = await request.toolExecutor!.execute(call, request.signal);
        expect(result.ok, JSON.stringify(result.content)).toBe(true);
        events.push({ type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input }, { type: 'tool_result', toolCallId: call.id, name: call.name, result });
      }
    };
    // The script is read after onRequest has run, so it can hold the real results.
    ctx.provider.script = new Proxy([] as ProviderEvent[], {
      get: (_t, key) => {
        const all: ProviderEvent[] = [
          { type: 'delta', text: 'Here it is.' },
          ...events,
          { type: 'completed', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
        ];
        const v = Reflect.get(all, key);
        return typeof v === 'function' ? v.bind(all) : v;
      },
    });

    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'c' } });
    const chatId = (chat.json() as { id: string }).id;
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt: 'toast recipe' } });
    expect(res.statusCode).toBe(200);
    ctx.provider.onRequest = null;

    const blocks = parseSse(res.body)
      .filter((f) => f.event === 'ui_block')
      .map((f) => (f.data as { block: Record<string, unknown> }).block);
    expect(blocks).toMatchObject([
      { blockId: 'display_card-1', type: 'display', tool: 'recipe_display_v0', data: recipe },
      { type: 'visual', title: 'box', html: svg },
    ]);

    // Kept with the reply: its segments place each block after the call that made it.
    const got = (await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } })).json() as {
      messages: Array<{ role: string; segments: Array<{ type: string; blockIds?: string[] }> | null; toolCalls: Array<{ name: string }> }>;
    };
    const reply = got.messages.find((m) => m.role === 'assistant')!;
    const ui = reply.segments!.filter((s) => s.type === 'ui').flatMap((s) => s.blockIds);
    expect(ui).toEqual(['display_card-1', blocks[1]!['blockId']]);
    expect(reply.toolCalls.map((c) => c.name)).toEqual(['recipe_display_v0', 'show_widget']);

    // Shared: the card is rebuilt from its call, the visual's markup from its code.
    const link = (await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/share`, headers: { cookie: user.cookie } })).json() as { token: string };
    const pub = (await ctx.app.inject({ url: `/v1/public/share/${link.token}`, remoteAddress: '10.9.9.9' })).json() as {
      messages: Array<{ role: string; uiBlocks: Array<Record<string, unknown>> }>;
    };
    expect(pub.messages.find((m) => m.role === 'assistant')!.uiBlocks).toMatchObject([
      { blockId: 'display_card-1', type: 'display', tool: 'recipe_display_v0', data: recipe },
      { type: 'visual', title: 'box', html: svg },
    ]);
  });
});
