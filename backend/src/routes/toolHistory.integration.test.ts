/**
 * A later turn sees the earlier turns' tool calls and results, as Claude's history keeps every
 * tool_use and tool_result (ADR-0022), in full however large the requests grew (ADR-0023). The
 * fake provider scripts the calls; nothing reaches Vertex.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toolCalls } from '../db/schema.js';
import { buildAnthropicMessages } from '../providers/anthropic.js';
import { buildGeminiContents } from '../providers/gemini.js';
import type { GenerationRequest, ProviderEvent } from '../providers/types.js';
import { compactionTrigger, SUMMARY_PROMPT } from '../services/compaction/autoCompact.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp, promptOf } from '../test/harness.js';
import { setDb } from '../db/client.js';

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

/** The compaction runs only with the history summary off (ADR-0080): these tests get their own app. */
async function withCompactionApp(run: () => Promise<void>): Promise<void> {
  const main = { ctx, user };
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_RUN_PYTHON: 'true', SANDBOX_ENGINE: 'process', ENABLE_HISTORY_SUMMARY: 'false' });
  try {
    user = await signUp(ctx);
    await run();
  } finally {
    await ctx.close();
    ({ ctx, user } = main);
    // createTestApp pointed the process-wide handle at the closed app's pool; point it back.
    setDb(ctx.db, ctx.sql);
  }
}

const plainAnswer = (): void => {
  ctx.provider.script = [
    { type: 'delta', text: 'ok' },
    { type: 'completed', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
  ];
};

describe('tool calls in the history (ADR-0022)', () => {
  it('stops split textual tool protocol before its HTML reaches the stream or transcript', async () => {
    const { chatId } = await newChat();
    ctx.provider.script = [
      { type: 'delta', text: 'Here is the calculator.\n[Tool ca' },
      { type: 'delta', text: 'll] render_ui({html:"PRIVATE_HTML"})' },
    ];
    const response = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt: 'Show a calculator' } });
    expect(response.body).toContain('tool_protocol_in_text');
    expect(response.body).not.toContain('PRIVATE_HTML');
    expect(response.body).not.toContain('[Tool ca');
    const persisted = await ctx.app.inject({ method: 'GET', url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
    expect(persisted.statusCode).toBe(200);
    expect(persisted.body).toContain('tool_protocol_in_text');
    expect(persisted.body).not.toContain('PRIVATE_HTML');
    plainAnswer();
  });

  it('gives the next turn the earlier calls and results, and Gemini its signed functionCall back', async () => {
    const { send } = await newChat();
    scriptCall('c1', 'bash_tool', 'Federal: 244 debits, 33 credits');
    await send('count the entries');
    plainAnswer();
    const request = await send('federal bank la evalo entries?');

    const earlier = request.history[1]!;
    expect(earlier.role).toBe('assistant');
    expect(earlier.toolCalls).toEqual([
      {
        id: 'c1',
        name: 'bash_tool',
        input: { code: "print('c1')" },
        result: { toolCallId: 'c1', ok: true, content: [{ type: 'text', text: 'Federal: 244 debits, 33 credits' }] },
        thoughtSignature: 'sig-c1',
      },
    ]);

    // bash_tool is declared on every turn, so the call goes back natively.
    expect((request.tools ?? []).map((t) => t.name)).toContain('bash_tool');
    const gemini = buildGeminiContents(request);
    expect(gemini[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { id: 'c1', name: 'bash_tool', args: { code: "print('c1')" } }, thoughtSignature: 'sig-c1' }],
    });
    expect(JSON.stringify(gemini[2])).toContain('functionResponse');
    expect(JSON.stringify(gemini[2])).toContain('244 debits');
    expect(gemini[3]).toEqual({ role: 'model', parts: [{ text: 'answer c1' }] });

    const anthropic = buildAnthropicMessages(request);
    expect(anthropic[1]).toMatchObject({ role: 'assistant', content: [{ type: 'tool_use', id: 'hist_1_0', name: 'bash_tool' }] });
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
      tools: [{ name: 'bash_tool', description: '', inputSchema: { type: 'object' } }],
    };
    for (const wire of [JSON.stringify(buildGeminiContents(request)), JSON.stringify(buildAnthropicMessages(request))]) {
      expect(wire).toContain('Historical execution data');
      expect(wire).toContain('extract_scanned_table_rows');
      expect(wire).toContain('ROWS');
      expect(wire).not.toContain('[Tool call]');
      expect(wire).not.toContain('functionCall');
      expect(wire).not.toContain('tool_use');
    }
  });

  it('keeps every result past 100,000 tokens, and restores one an earlier revision cleared', async () => {
    const { send } = await newChat();
    for (const id of ['k1', 'k2', 'k3', 'k4']) {
      scriptCall(id, 'bash_tool', `result ${id}`);
      await send(`turn ${id}`);
    }
    // 100,000 was the context-editing trigger ADR-0023 removed; compaction is further off.
    scriptCall('k5', 'bash_tool', 'result k5', 100_000);
    await send('turn k5');
    await ctx.db.update(toolCalls).set({ resultCleared: true }).where(eq(toolCalls.toolCallId, 'k1'));
    plainAnswer();
    const request = await send('next');

    const results = request.history.flatMap((t) => t.toolCalls ?? []).map((c) => [c.id, c.result.content[0]]);
    expect(results).toEqual(['k1', 'k2', 'k3', 'k4', 'k5'].map((id) => [id, { type: 'text', text: `result ${id}` }]));
  });

  it('gives the summarizer what older turns ran and found, as Claude compacts the whole transcript', () => withCompactionApp(async () => {
    const { send } = await newChat();
    scriptCall('s1', 'bash_tool', 'Federal: 244 debits, 33 credits');
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
    expect(text).toContain('bash_tool');
    expect(text).toContain('244 debits');
  }));
  it('gives a skill read before a compaction back in full after it (ADR-0027)', () => withCompactionApp(async () => {
    const { send } = await newChat();
    ctx.provider.script = [
      { type: 'tool_use', toolCallId: 'ls1', name: 'view', input: { path: '/skills/pdf/SKILL.md', description: 'read the skill' }, thoughtSignature: 'sig-ls1' },
      { type: 'tool_result', toolCallId: 'ls1', name: 'view', result: { toolCallId: 'ls1', ok: true, content: [{ type: 'text', text: 'pdf skill' }] } },
      { type: 'delta', text: 'read it' },
      { type: 'completed', usage: { inputTokens: 1000, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
    ] satisfies ProviderEvent[];
    await send('turn 1');
    plainAnswer();
    const beforeCompaction = await send('turn 2');
    expect(promptOf(beforeCompaction)).not.toContain('### Skill read earlier: /skills/pdf/SKILL.md');
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
    const after = await send('turn 5');
    ctx.provider.onRequest = null;
    expect(after.history.some((t) => t.toolCalls?.some((c) => c.name === 'view'))).toBe(false);
    expect(promptOf(after)).toContain('### Skill read earlier: /skills/pdf/SKILL.md');
  }));

  it('replays a turn-ending ask_user_input_v0 call and its {status:"shown"} result on the next turn (ADR-0034)', async () => {
    const { send } = await newChat();
    const optionsInput = { questions: [{ question: 'Where would you like to go?', options: ['Japan', 'Italy'] }] };
    ctx.provider.script = [
      { type: 'delta', text: 'Let us narrow down your trip.' },
      { type: 'tool_use', toolCallId: 'opt-1', name: 'ask_user_input_v0', input: optionsInput, thoughtSignature: 'sig-opt-1' },
      {
        type: 'tool_result',
        toolCallId: 'opt-1',
        name: 'ask_user_input_v0',
        result: { toolCallId: 'opt-1', ok: true, content: [{ type: 'json', data: { status: 'shown' } }] },
      },
      { type: 'completed', usage: { inputTokens: 100, outputTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
    ] satisfies ProviderEvent[];
    await send('help me plan a trip, ask me what you need');

    plainAnswer();
    const request = await send('Japan');

    const earlier = request.history[1]!;
    expect(earlier.role).toBe('assistant');
    expect(earlier.toolCalls).toEqual([
      {
        id: 'opt-1',
        name: 'ask_user_input_v0',
        input: optionsInput,
        result: { toolCallId: 'opt-1', ok: true, content: [{ type: 'json', data: { status: 'shown' } }] },
        thoughtSignature: 'sig-opt-1',
      },
    ]);
    expect((request.tools ?? []).map((t) => t.name)).toContain('ask_user_input_v0');

    const gemini = buildGeminiContents(request);
    expect(gemini[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { id: 'opt-1', name: 'ask_user_input_v0', args: optionsInput }, thoughtSignature: 'sig-opt-1' }],
    });
    expect(JSON.stringify(gemini[2])).toContain('"status":"shown"');

    const anthropic = buildAnthropicMessages(request);
    expect(anthropic[1]).toMatchObject({ role: 'assistant', content: [{ type: 'tool_use', id: 'hist_1_0', name: 'ask_user_input_v0' }] });
    expect(anthropic[2]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'hist_1_0', content: '{"status":"shown"}' }] });
  });
});
