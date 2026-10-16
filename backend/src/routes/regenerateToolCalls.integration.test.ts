/**
 * Regenerating a reply clears the old attempt's tool calls (tech-build.3 review R1#2).
 *
 * A tool call is stored with `onConflictDoNothing` on (message, ordinal). Before the fix,
 * `resetForRetry` kept the old attempt's rows, so the new attempt's calls were dropped, the old
 * ones stayed attached to the new text, and the next turn replayed them as history.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { messages, toolCalls } from '../db/schema.js';
import type { ProviderEvent } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true };

function toolTurn(id: string, question: string, answer: string): ProviderEvent[] {
  const input = { questions: [{ question, options: ['A', 'B'] }] };
  return [
    { type: 'tool_use', toolCallId: id, name: 'ask_user_input_v0', input },
    {
      type: 'tool_result',
      toolCallId: id,
      name: 'ask_user_input_v0',
      result: { toolCallId: id, ok: true, content: [{ type: 'json', data: { asked: question } }] },
    },
    { type: 'delta', text: answer },
    { type: 'completed', usage, finishReason: 'stop' },
  ];
}

describe('regenerate clears the old attempt\'s tool calls', () => {
  it('keeps only the new attempt\'s call, and the next turn replays only that one', async () => {
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'r' } });
    const chatId = (chat.json() as { id: string }).id;
    const send = async (payload: Record<string, unknown>) => {
      const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload });
      expect(res.statusCode).toBe(200);
      expect(parseSse(res.body).at(-1)?.event).toBe('done');
    };

    ctx.provider.script = toolTurn('call_old', 'Old question?', 'Old answer.');
    await send({ prompt: 'Choose for me.' });
    const [assistant] = await ctx.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant')));

    ctx.provider.script = toolTurn('call_new', 'New question?', 'New answer.');
    await send({ prompt: 'Choose for me.', retryMessageId: assistant!.id });

    const rows = await ctx.db
      .select({ toolCallId: toolCalls.toolCallId, input: toolCalls.input, content: toolCalls.content })
      .from(toolCalls)
      .where(eq(toolCalls.messageId, assistant!.id))
      .orderBy(asc(toolCalls.ordinal));
    expect(rows).toEqual([
      {
        toolCallId: 'call_new',
        input: { questions: [{ question: 'New question?', options: ['A', 'B'] }] },
        content: [{ type: 'json', data: { asked: 'New question?' } }],
      },
    ]);

    ctx.provider.script = [{ type: 'delta', text: 'ok' }, { type: 'completed', usage, finishReason: 'stop' }];
    await send({ prompt: 'Next.' });
    const replayed = ctx.provider.seen.at(-1)!.history.flatMap((t) => t.toolCalls ?? []).map((c) => c.id);
    expect(replayed).toEqual(['call_new']);
  });
});
