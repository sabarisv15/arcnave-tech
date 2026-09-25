/**
 * A long chat keeps its whole conversation and its files, as Claude's does (ADR-0019): no turn
 * cap, and past the trigger the older turns become a summary while the last two stay word for
 * word. The fake provider reports the request sizes; nothing here reaches Vertex.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conversationCompactions, usageRecords } from '../db/schema.js';
import { buildAnthropicMessages } from '../providers/anthropicVertex.js';
import { buildGeminiContents } from '../providers/gemini.js';
import type { GenerationRequest, ProviderEvent } from '../providers/types.js';
import { KEEP_TURNS, SUMMARY_PROMPT, compactionTrigger } from '../services/compaction/autoCompact.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_RUN_PYTHON: 'true', SANDBOX_ENGINE: 'process' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

/**
 * Every answer reports this request size; a summary request answers with a summary. `lastRequest`
 * makes the answer a tool loop whose total is larger than its last request.
 */
function answerWith(inputTokens: number, exact = true, lastRequest?: { inputTokens: number; outputTokens: number }): void {
  ctx.provider.onRequest = async (request) => {
    const summary = request.prompt === SUMMARY_PROMPT;
    ctx.provider.script = [
      { type: 'delta', text: summary ? '<summary>User shared notes.txt (budget 4200); asked about it.</summary>' : 'ok' },
      {
        type: 'completed',
        usage: {
          inputTokens: summary ? 900 : inputTokens,
          outputTokens: 40,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          exact,
          ...(lastRequest && !summary ? { lastRequest } : {}),
        },
        finishReason: 'stop',
      },
    ] satisfies ProviderEvent[];
  };
}

async function newChat(): Promise<{ send: (prompt: string, attachmentIds?: string[]) => Promise<ReturnType<typeof parseSse>> }> {
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'c' } });
  const chatId = (chat.json() as { id: string }).id;
  return {
    send: async (prompt, attachmentIds) => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers: { cookie: user.cookie },
        payload: { prompt, ...(attachmentIds ? { attachmentIds } : {}) },
      });
      expect(res.statusCode).toBe(200);
      return parseSse(res.body);
    },
  };
}

async function upload(name: string, body: string): Promise<string> {
  const part = multipart(name, Buffer.from(body), 'text/plain');
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, cookie: user.cookie }, payload: part.payload });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

const lastMain = (): GenerationRequest => ctx.provider.seen.filter((r) => r.prompt !== SUMMARY_PROMPT).at(-1)!;

describe('long chats (ADR-0019)', () => {
  it('sends every earlier turn, not the last 20 messages, and still lists the first file', async () => {
    answerWith(1000);
    const { send } = await newChat();
    const fileId = await upload('notes.txt', 'budget 4200');
    await send('Question 1 about my notes', [fileId]);
    for (let i = 2; i <= 12; i++) await send(`Question ${String(i)}`);
    await send('Question 13: what was the budget?');

    const req = lastMain();
    expect(req.history).toHaveLength(24);
    expect(req.history[0]!.text).toBe('Question 1 about my notes');
    expect(req.history[0]!.attachments?.map((a) => a.id)).toEqual([fileId]);
    expect(req.prompt).toContain(`fileId: "${fileId}"`);
  });

  it('sends an earlier file\'s whole text on later turns, as Claude keeps a file in context', async () => {
    answerWith(1000);
    const { send } = await newChat();
    const body = `${'first page words. '.repeat(3000)}PAGE-15-MARKER the end`;
    const fileId = await upload('report.txt', body);
    await send('Here is my report', [fileId]);
    await send('Question 2');
    await send('What is on page 15?');

    const old = lastMain().history.flatMap((t) => t.attachments ?? []).find((a) => a.id === fileId)!;
    expect(old.extractedText).toBe(body);
    for (const wire of [JSON.stringify(buildGeminiContents(lastMain())), JSON.stringify(buildAnthropicMessages(lastMain()))]) {
      expect(wire).toContain('PAGE-15-MARKER the end');
    }
  });

  it('compacts once the previous request reached the trigger, keeping the last turns word for word', async () => {
    const { send } = await newChat();
    const fileId = await upload('notes.txt', 'budget 4200');
    answerWith(1000);
    await send('Turn 1 with notes', [fileId]);
    await send('Turn 2');
    await send('Turn 3');
    // The window of the test models is 1M: the trigger is Claude's default, 150,000.
    answerWith(compactionTrigger(ctx.cfg.COMPACTION_TRIGGER_TOKENS, 1_000_000));
    await send('Turn 4');

    const before = ctx.provider.seen.length;
    const frames = await send('Turn 5: what was the budget?');
    const requests = ctx.provider.seen.slice(before);
    expect(requests.map((r) => r.prompt === SUMMARY_PROMPT)).toEqual([true, false]);

    // The summary request carried the turns before the kept ones, and named the file.
    const summarised = requests[0]!.history.map((t) => t.text);
    expect(summarised[0]).toContain('Turn 1 with notes');
    expect(summarised[0]).toContain(`fileId ${fileId}`);
    expect(summarised.join('\n')).not.toContain('Turn 3');

    // The answer's request: the summary, then the last KEEP_TURNS turns exactly.
    const main = requests[1]!;
    expect(main.history.map((t) => t.text)).toEqual(['Turn 3', 'ok', 'Turn 4', 'ok']);
    expect(main.history).toHaveLength(KEEP_TURNS * 2);
    expect(main.systemInstruction).toContain('User shared notes.txt (budget 4200)');
    // The file of a compacted turn is still the chat's.
    expect(main.prompt).toContain(`fileId: "${fileId}"`);

    const labels = frames.filter((f) => f.event === 'research').map((f) => (f.data.event as { label: string }).label);
    expect(labels).toEqual(['Compacting our conversation', 'Conversation compacted']);

    const rows = await ctx.db.select().from(conversationCompactions);
    expect(rows.some((r) => (r.summary as { kind?: string }).kind === 'text')).toBe(true);
    const cost = await ctx.db
      .select()
      .from(usageRecords)
      .where(and(eq(usageRecords.inputTokens, 900), isNull(usageRecords.messageId)));
    expect(cost.length).toBeGreaterThan(0);
    expect(cost[0]!.requestId).toMatch(/:compaction$/);
  });

  it('does not compact below the trigger, nor on token counts the provider did not report', async () => {
    const { send } = await newChat();
    const trigger = compactionTrigger(ctx.cfg.COMPACTION_TRIGGER_TOKENS, 1_000_000);
    for (const [tokens, exact] of [[trigger - 41, true], [trigger * 2, false]] as const) {
      answerWith(1000);
      await send('a');
      await send('b');
      await send('c');
      answerWith(tokens, exact);
      await send('d');
      const before = ctx.provider.seen.length;
      await send('e');
      expect(ctx.provider.seen.slice(before).some((r) => r.prompt === SUMMARY_PROMPT)).toBe(false);
    }
  });

  it('reads the size of the last request, not a tool loop\'s total, which counts the chat once per round', async () => {
    const { send } = await newChat();
    const trigger = compactionTrigger(ctx.cfg.COMPACTION_TRIGGER_TOKENS, 1_000_000);
    answerWith(1000);
    for (const p of ['a', 'b', 'c']) await send(p);
    // 14 requests of 20,000 each: billed 280,000, but the conversation is 20,000 long.
    answerWith(14 * 20_000, true, { inputTokens: 20_000, outputTokens: 40 });
    expect(14 * 20_000).toBeGreaterThan(trigger);
    await send('d');
    const before = ctx.provider.seen.length;
    await send('e');
    expect(ctx.provider.seen.slice(before).some((r) => r.prompt === SUMMARY_PROMPT)).toBe(false);

    // Billing keeps the whole total.
    const [row] = await ctx.db.select().from(usageRecords).where(eq(usageRecords.inputTokens, 14 * 20_000));
    expect(row).toMatchObject({ contextTokens: 20_040, tokensExact: true });
  });

  it('keeps the history whole when no summary comes back', async () => {
    const { send } = await newChat();
    answerWith(1000);
    for (const p of ['a', 'b', 'c']) await send(p);
    answerWith(10_000_000);
    await send('d');
    ctx.provider.onRequest = async (request) => {
      ctx.provider.script = [
        { type: 'delta', text: request.prompt === SUMMARY_PROMPT ? '' : 'ok' },
        { type: 'completed', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
      ];
    };
    const frames = await send('e');
    expect(lastMain().history).toHaveLength(8);
    const labels = frames.filter((f) => f.event === 'research').map((f) => (f.data.event as { label: string }).label);
    expect(labels).toEqual(['Compacting our conversation', 'Conversation not compacted']);
  });
});
