/**
 * A later turn sees the earlier turns' tool calls and results, as Claude's history keeps every
 * tool_use and tool_result (ADR-0022), in full however large the requests grew (ADR-0023). The
 * fake provider scripts the calls; nothing reaches Vertex.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toolCalls } from '../db/schema.js';
import { buildAnthropicMessages } from '../providers/anthropicVertex.js';
import { buildGeminiContents } from '../providers/gemini.js';
import type { GenerationRequest, ProviderEvent } from '../providers/types.js';
import { compactionTrigger, SUMMARY_PROMPT } from '../services/compaction/autoCompact.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_RUN_PYTHON: 'true', SANDBOX_ENGINE: 'process' });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

/** One answer that calls `name` once, signed, and reports this request size. */
function scriptCall(id: string, name: string, output: string, contextTokens = 1000): void {
  ctx.provider.script = [
    { type: 'tool_use', toolCallId: id, name, input: { code: `print('${id}')` }, thoughtSignature: `sig-${id}` },
    { type: 'tool_result', toolCallId: id, name, result: { toolCallId: id, ok: true, content: [{ type: 'text', text: output }] } },
    { type: 'delta', text: `answer ${id}` },
    {
      type: 'completed',
      usage: { inputTokens: contextTokens, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
      finishReason: 'stop',
    },
  ] satisfies ProviderEvent[];
}

async function newChat() {
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'c' } });
  const chatId = (chat.json() as { id: string }).id;
  return {
    chatId,
    send: async (prompt: string) => {
      const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt } });
      expect(res.statusCode).toBe(200);
      return ctx.provider.seen.at(-1)!;
    },
  };
}

const plainAnswer = (): void => {
  ctx.provider.script = [
    { type: 'delta', text: 'ok' },
    { type: 'completed', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
  ];
};

describe('tool calls in the history (ADR-0022)', () => {
  it('gives the next turn the earlier calls and results, and Gemini its signed functionCall back', async () => {
    const { send } = await newChat();
    scriptCall('c1', 'run_python', 'Federal: 244 debits, 33 credits');
    await send('count the entries');
    plainAnswer();
    const request = await send('federal bank la evalo entries?');

    const earlier = request.history[1]!;
    expect(earlier.role).toBe('assistant');
    expect(earlier.toolCalls).toEqual([
      {
        id: 'c1',
        name: 'run_python',
        input: { code: "print('c1')" },
        result: { toolCallId: 'c1', ok: true, content: [{ type: 'text', text: 'Federal: 244 debits, 33 credits' }] },
        thoughtSignature: 'sig-c1',
      },
    ]);

    // run_python is declared on every turn, so the call goes back natively.
    expect((request.tools ?? []).map((t) => t.name)).toContain('run_python');
    const gemini = buildGeminiContents(request);
    expect(gemini[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { id: 'c1', name: 'run_python', args: { code: "print('c1')" } }, thoughtSignature: 'sig-c1' }],
    });
    expect(JSON.stringify(gemini[2])).toContain('functionResponse');
    expect(JSON.stringify(gemini[2])).toContain('244 debits');
    expect(gemini[3]).toEqual({ role: 'model', parts: [{ text: 'answer c1' }] });

    const anthropic = buildAnthropicMessages(request);
    expect(anthropic[1]).toMatchObject({ role: 'assistant', content: [{ type: 'tool_use', id: 'hist_1_0', name: 'run_python' }] });
    expect(anthropic[2]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'hist_1_0', content: 'Federal: 244 debits, 33 credits' }] });
  });

  it('writes a call as text when it cannot go natively: no signature, or a tool this request does not declare', () => {
    const call = { id: 'x', name: 'extract_scanned_table_rows', input: { fileId: 'f' }, result: { toolCallId: 'x', ok: true, content: [{ type: 'text' as const, text: 'ROWS' }] } };
    const request: GenerationRequest = {
      prompt: 'next',
      history: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: 'a', toolCalls: [call] },
      ],
      systemInstruction: '',
      mode: 'chat',
      maxOutputTokens: 100,
      providerModelId: 'm',
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
      tools: [{ name: 'run_python', description: '', inputSchema: { type: 'object' } }],
    };
    for (const wire of [JSON.stringify(buildGeminiContents(request)), JSON.stringify(buildAnthropicMessages(request))]) {
      expect(wire).toContain('[Tool call] extract_scanned_table_rows({\\"fileId\\":\\"f\\"})');
      expect(wire).toContain('[Result] ROWS');
      expect(wire).not.toContain('functionCall');
      expect(wire).not.toContain('tool_use');
    }
  });

  it('keeps every result past 100,000 tokens, and restores one an earlier revision cleared', async () => {
    const { send } = await newChat();
    for (const id of ['k1', 'k2', 'k3', 'k4']) {
      scriptCall(id, 'run_python', `result ${id}`);
      await send(`turn ${id}`);
    }
    // 100,000 was the context-editing trigger ADR-0023 removed; compaction is further off.
    scriptCall('k5', 'run_python', 'result k5', 100_000);
    await send('turn k5');
    await ctx.db.update(toolCalls).set({ resultCleared: true }).where(eq(toolCalls.toolCallId, 'k1'));
    plainAnswer();
    const request = await send('next');

    const results = request.history.flatMap((t) => t.toolCalls ?? []).map((c) => [c.id, c.result.content[0]]);
    expect(results).toEqual(['k1', 'k2', 'k3', 'k4', 'k5'].map((id) => [id, { type: 'text', text: `result ${id}` }]));
  });

  it('gives the summarizer what older turns ran and found, as Claude compacts the whole transcript', async () => {
    const { send } = await newChat();
    scriptCall('s1', 'run_python', 'Federal: 244 debits, 33 credits');
    await send('turn 1');
    plainAnswer();
    await send('turn 2');
    await send('turn 3');
    ctx.provider.script = [
      { type: 'delta', text: 'ok' },
      {
        type: 'completed',
        usage: { inputTokens: compactionTrigger(ctx.cfg.COMPACTION_TRIGGER_TOKENS, 1_000_000), outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
        finishReason: 'stop',
      },
    ];
    await send('turn 4');
    ctx.provider.onRequest = async (request) => {
      ctx.provider.script = [
        { type: 'delta', text: request.prompt === SUMMARY_PROMPT ? '<summary>s</summary>' : 'ok' },
        { type: 'completed', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
      ];
    };
    const before = ctx.provider.seen.length;
    await send('turn 5');
    ctx.provider.onRequest = null;
    const summary = ctx.provider.seen.slice(before).find((r) => r.prompt === SUMMARY_PROMPT)!;
    const text = summary.history.map((t) => t.text).join('\n');
    expect(text).toContain('[Tool call] run_python');
    expect(text).toContain('244 debits');
  });
});
