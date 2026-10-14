/**
 * A tool loop that runs out of steps with no text is answered by one more request without tools.
 * Live (turn 531d000c, 2026-09-28): that request was told to answer "from the tool results above"
 * while it carried none of them, and its "stop" replaced "tool_limit", so the Continue button
 * never showed. The fake provider scripts both requests; nothing reaches Vertex.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProviderEvent } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_RUN_PYTHON: 'true', SANDBOX_ENGINE: 'process' });
  user = await signUp(ctx);
});
afterAll(async () => {
  ctx.provider.onRequest = null;
  await ctx.close();
});

/** The one request after the loop that asks for the answer without tools. */
const isForcedAnswer = (prompt: string): boolean => prompt.includes('[System Instruction: Answer the user now');

const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true };

describe('a turn that used every tool step', () => {
  it('answers from this turn\'s tool results and keeps tool_limit so Continue is offered', async () => {
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
    const chatId = (chat.json() as { id: string }).id;
    const before = ctx.provider.seen.length;

    ctx.provider.script = [
      { type: 'tool_use', toolCallId: 'c1', name: 'bash_tool', input: { command: 'python3 count.py', description: 'count rows' } },
      {
        type: 'tool_result',
        toolCallId: 'c1',
        name: 'bash_tool',
        result: { toolCallId: 'c1', ok: true, content: [{ type: 'text', text: 'KVB rows: 48; Federal rows: 277' }] },
      },
      { type: 'completed', usage, finishReason: 'tool_limit' },
    ] satisfies ProviderEvent[];
    ctx.provider.onRequest = async (request) => {
      if (isForcedAnswer(request.prompt)) {
        ctx.provider.script = [
          { type: 'delta', text: 'KVB has 48 entries and Federal has 277.' },
          { type: 'completed', usage, finishReason: 'stop' },
        ];
      }
    };

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { cookie: user.cookie },
      payload: { prompt: 'how many entries in kvb and federal?' },
    });
    expect(res.statusCode).toBe(200);
    ctx.provider.onRequest = null;

    const synthesis = ctx.provider.seen.slice(before).find((r) => isForcedAnswer(r.prompt))!;
    expect(synthesis.tools ?? []).toEqual([]);
    expect(synthesis.prompt).toContain('how many entries in kvb and federal?');
    expect(synthesis.prompt).toContain('<this_turn_tool_steps>');
    expect(synthesis.prompt).toContain('Federal rows: 277');
    expect(synthesis.prompt).toContain("this turn's tool steps above");

    const got = await ctx.app.inject({ method: 'GET', url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
    const messages = (got.json() as { messages: { role: string; text: string; status: string; finishReason: string | null }[] }).messages;
    const answer = messages.find((m) => m.role === 'assistant')!;
    expect(answer.status).toBe('complete');
    expect(answer.text).toBe('KVB has 48 entries and Federal has 277.');
    expect(answer.finishReason).toBe('tool_limit');
  });

  it('a loop that ended cleanly with no text keeps the forced answer\'s own finish reason', async () => {
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't2' } });
    const chatId = (chat.json() as { id: string }).id;
    const before = ctx.provider.seen.length;

    ctx.provider.script = [{ type: 'completed', usage, finishReason: 'stop' }];
    ctx.provider.onRequest = async (request) => {
      if (isForcedAnswer(request.prompt)) {
        ctx.provider.script = [
          { type: 'delta', text: 'Here it is.' },
          { type: 'completed', usage, finishReason: 'max_tokens' },
        ];
      }
    };

    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt: 'hi' } });
    ctx.provider.onRequest = null;

    // No tool ran, so the forced request carries no tool-step block.
    const forced = ctx.provider.seen.slice(before).find((r) => isForcedAnswer(r.prompt))!;
    expect(forced.prompt).not.toContain('<this_turn_tool_steps>');
    const got = await ctx.app.inject({ method: 'GET', url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
    const answer = (got.json() as { messages: { role: string; finishReason: string | null }[] }).messages.find((m) => m.role === 'assistant')!;
    expect(answer.finishReason).toBe('max_tokens');
  });
});
