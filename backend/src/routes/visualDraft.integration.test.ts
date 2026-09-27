/**
 * A visual is drawn while the model writes it (ADR-0037): the provider's partial call input
 * reaches the browser as `ui_draft` pieces, each continuing the last. Nothing reaches Vertex.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProviderEvent } from '../providers/types.js';
import { visualDrafts } from '../services/generation.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

describe('visual drafts', () => {
  it('sends only what is new of each visual, and nothing for other tools', async () => {
    // A snapshot per event: the fake script is built before it streams, so one shared object
    // would already hold the finished HTML at the first event.
    const grow = (html: string): ProviderEvent => ({
      type: 'tool_input_partial',
      index: 0,
      name: 'show_widget',
      input: { title: 'curve', loading_messages: ['Drawing the curve'], widget_code: html },
    });
    ctx.provider.script = [
      { type: 'tool_input_partial', index: 0, name: 'run_python', input: { code: 'print(1)' } },
      grow('<svg>'),
      grow('<svg><path/>'),
      grow('<svg><path/>'),
      grow('<svg><path/></svg>'),
      { type: 'delta', text: 'Done.' },
      { type: 'completed', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
    ];
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'c' } });
    const chatId = (chat.json() as { id: string }).id;
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt: 'draw' } });
    expect(res.statusCode).toBe(200);

    const drafts = parseSse(res.body)
      .filter((f) => f.event === 'ui_draft')
      .map((f) => f.data);
    expect(drafts).toEqual([
      { type: 'ui_draft', draftId: '0:0', title: 'Drawing the curve', from: 0, text: '<svg>' },
      { type: 'ui_draft', draftId: '0:0', title: 'Drawing the curve', from: 5, text: '<path/>' },
      { type: 'ui_draft', draftId: '0:0', title: 'Drawing the curve', from: 12, text: '</svg>' },
    ]);
  });

  it('drafts a show_widget call once it has code, titled by its first loading message', () => {
    expect(visualDrafts({ title: 'a', loading_messages: ['Sketching', 'Almost'], widget_code: '<p>' }, '3')).toEqual([
      { draftId: '3:0', title: 'Sketching', html: '<p>' },
    ]);
    expect(visualDrafts({ title: 'a', widget_code: '' }, '1')).toEqual([{ draftId: '1:0', title: 'a', html: '' }]);
    expect(visualDrafts({ title: 'a' }, '0')).toEqual([]);
    expect(visualDrafts({}, '0')).toEqual([]);
  });
});
