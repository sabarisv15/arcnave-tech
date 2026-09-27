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
      name: 'render_ui',
      input: { blocks: [{ type: 'text', text: 'hi' }, { type: 'visual', title: 'Curve', html }] },
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
      { type: 'ui_draft', draftId: '0:1', title: 'Curve', from: 0, text: '<svg>' },
      { type: 'ui_draft', draftId: '0:1', title: 'Curve', from: 5, text: '<path/>' },
      { type: 'ui_draft', draftId: '0:1', title: 'Curve', from: 12, text: '</svg>' },
    ]);
  });

  it('finds only visual blocks with HTML so far', () => {
    expect(
      visualDrafts({ blocks: [{ type: 'visual', title: 'A', html: '<p>' }, { type: 'visual' }, { type: 'text', text: 'x' }, null, { type: 'visual', html: '' }] }, '3'),
    ).toEqual([
      { draftId: '3:0', title: 'A', html: '<p>' },
      { draftId: '3:4', title: '', html: '' },
    ]);
    expect(visualDrafts({}, '0')).toEqual([]);
  });
});
