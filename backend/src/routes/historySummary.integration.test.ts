/**
 * P13 exit test (ADR-0080): the history summary, the history window, the title job and the router
 * shadow, through the real routes and a real Postgres, with the fake provider standing in for the
 * chat model, the count API and the helper (Claude Haiku 5.5). Nothing here reaches a provider.
 *
 * The fake count API answers 4,500 tokens for any text carrying BIG, 1,000 for the fixed part (the
 * only text over 10,000 characters), else one per 4 characters. The trigger is then
 * 0.6 × (48,000 − 1,000) = 28,200: six marked exchanges (27,000) stay below it, the seventh crosses
 * it, and exactly the turns before the newest six are covered.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { chats, messages, modelCalls, summaries } from '../db/schema.js';
import { setDb } from '../db/client.js';
import type { GenerationRequest, HelperRequest, HelperResult, Turn } from '../providers/types.js';
import { withoutFailedExchanges } from '../services/history/failedExchanges.js';
import { cleanTitle } from '../services/helpers/titleJob.js';
import { renderRecovery } from '../services/helpers/helperPrompts.js';
import { matchEnum, ROUTER_INTENTS } from '../services/routing/routerShadow.js';
import { groupExchanges, selectWindow } from '../services/summary/historyWindow.js';
import { clearTokenCountCache } from '../services/summary/tokenCounts.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, parseSse, promptOf, signUp } from '../test/harness.js';

const BIG = 'BIG';
const countBig = (text: string): number => (text.includes(BIG) ? 4_500 : text.length > 10_000 ? 1_000 : Math.ceil(text.length / 4));
/** Text that must never appear in a job's log line (Stage 17 NO_CONTENT). */
const SENTINEL = 'SENTINEL-7f3a';
const SUMMARY_TEXT = `- ${SENTINEL} The user asked about <b>budgets</b>; decided 4200.`;

let ctx: TestContext;
let user: TestUser;
let logLines: unknown[] = [];

function usageOf(input: number, output: number): HelperResult['usage'] {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true };
}

/** The helper fake: a title for the title prompt, a summary for the summary prompt. */
function helperAnswers(over: Partial<{ title: string; summary: string; finish: string; fail: boolean }> = {}) {
  ctx.provider.helperHandler = async (req) => {
    if (over.fail) throw new Error('helper down');
    const isTitle = req.system.startsWith('Write a short title');
    return {
      text: isTitle ? (over.title ?? `"Budget ${SENTINEL} chat".`) : (over.summary ?? SUMMARY_TEXT),
      usage: usageOf(400, 30),
      finishReason: over.finish ?? 'end_turn',
    };
  };
}

function spyLogs(target: TestContext): void {
  const log = (target.app.services.helperJobs as unknown as { deps: { log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void } } }).deps.log;
  for (const level of ['info', 'warn'] as const) {
    vi.spyOn(log, level).mockImplementation((...args: unknown[]) => {
      logLines.push(args[0]);
    });
  }
}

async function newChat(c: TestContext = ctx, u: TestUser = user): Promise<string> {
  const res = await c.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: u.cookie }, payload: { title: 'c' } });
  return (res.json() as { id: string }).id;
}

async function send(chatId: string, prompt: string, c: TestContext = ctx, u: TestUser = user, extra: Record<string, unknown> = {}) {
  const res = await c.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: u.cookie }, payload: { prompt, ...extra } });
  expect(res.statusCode).toBe(200);
  // The jobs run after the settle, in the background; the test waits for them to end.
  await c.app.services.helperJobs.idle();
  return parseSse(res.body);
}

const lastChatRequest = (c: TestContext = ctx): GenerationRequest => c.provider.seen.at(-1)!;
const historyTexts = (r: GenerationRequest): string[] => r.history.map((t: Turn) => `${t.role}:${t.text}`);

async function summaryRows(chatId: string) {
  return ctx.db.select().from(summaries).where(eq(summaries.chatId, chatId)).orderBy(asc(summaries.summaryVersion));
}

async function assistantSeq(chatId: string, seq: number) {
  const [row] = await ctx.db.select().from(messages).where(and(eq(messages.chatId, chatId), eq(messages.seq, seq)));
  return row!;
}

beforeAll(async () => {
  ctx = await createTestApp({});
  user = await signUp(ctx);
  ctx.provider.tokenCount = countBig;
  spyLogs(ctx);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await ctx.close();
});
beforeEach(() => {
  clearTokenCountCache();
  ctx.provider.tokenCount = countBig;
  ctx.provider.script = [
    { type: 'delta', text: `Answer ${SENTINEL}.` },
    { type: 'completed', usage: usageOf(11, 7), finishReason: 'stop' },
  ];
  helperAnswers();
});

describe('the rolling summary (N-77) and the window (N-16)', () => {
  let chatId: string;

  it('writes no row below the trigger', async () => {
    chatId = await newChat();
    for (let i = 1; i <= 6; i += 1) await send(chatId, `Q${String(i)} ${BIG} ${SENTINEL}`);
    // Six exchanges of 4,500 (27,000) stay below the trigger (28,200).
    expect(await summaryRows(chatId)).toEqual([]);
    expect(ctx.provider.helperSeen.filter((r) => r.system.startsWith('Summarise'))).toHaveLength(0);
    const small = await newChat();
    await send(small, 'short question');
    await send(small, 'another short one');
    expect(await summaryRows(small)).toEqual([]);
    expect(logLines).toContainEqual(expect.objectContaining({ code: 'summary_skipped', reason: 'below_trigger' }));
  });

  it('above the trigger writes one row covering exactly the uncovered turns before the newest six', async () => {
    await send(chatId, `Q7 ${BIG} ${SENTINEL}`);
    const rows = await summaryRows(chatId);
    expect(rows).toHaveLength(1);
    // Exchange 1 (seq 0, 1) is covered; exchanges 2–7 stay word for word.
    expect(rows[0]).toMatchObject({ summaryVersion: 1, coversUptoSeq: 1, status: 'ready', text: SUMMARY_TEXT });
    expect(rows[0]!.coversUptoMessageId).toBe((await assistantSeq(chatId, 1)).id);
    // The helper read exchange 1 and nothing after it.
    const input = ctx.provider.helperSeen.filter((r) => r.system.startsWith('Summarise')).at(-1)!;
    expect(input.text).toContain('Q1 BIG');
    expect(input.text).not.toContain('Q2 BIG');
    expect(input).toMatchObject({ maxOutputTokens: 1_200, thinking: 'off' });
    expect(logLines).toContainEqual(expect.objectContaining({ code: 'summary_written', chatId, summaryVersion: 1, coversUptoSeq: 1, inputTokens: 400, outputTokens: 30 }));
  });

  it('the next request carries the escaped summary and the six turns after it, and is stamped', async () => {
    await send(chatId, `Q8 ${BIG}`);
    const request = ctx.provider.seen.filter((r) => r.prompt.includes('Q8 BIG')).at(-1)!;
    expect(historyTexts(request).filter((t) => t.startsWith('user:')).map((t) => t.split(' ')[0])).toEqual(
      ['user:Q2', 'user:Q3', 'user:Q4', 'user:Q5', 'user:Q6', 'user:Q7'],
    );
    const prompt = promptOf(request);
    expect(prompt).toContain('<earlier_conversation_summary covers_upto="1" version="1">');
    expect(prompt).toContain('&lt;b>budgets&lt;/b>');
    expect(prompt).not.toContain('<b>budgets</b>');
    const answered = await assistantSeq(chatId, 15);
    expect(answered).toMatchObject({ historyTurns: 6, historyDroppedTurns: 0, summaryVersion: 1, ctxCountSource: 'provider', overBudget: false, registryVersion: null });
    // fixed 1,000 + the message 4,500 + six exchanges of 4,500 + the summary.
    expect(answered.ctxTokens).toBeGreaterThan(32_500);
    expect(answered.ctxFixedTokens).toBe(1_000);
    expect(answered.promptVersion).toMatch(/^[0-9a-f]{12}$/);
    // Turn 8 itself crossed the trigger again: v2 covers exchange 2 (seq 3).
    expect((await summaryRows(chatId)).map((r) => [r.summaryVersion, r.coversUptoSeq])).toEqual([[1, 1], [2, 3]]);
    // v2's input led with v1, escaped, so the new summary replaces it.
    const v2Input = ctx.provider.helperSeen.filter((r) => r.system.startsWith('Summarise')).at(-1)!;
    expect(v2Input.text).toContain('<earlier_conversation_summary version="1">');
    expect(v2Input.text).toContain('&lt;b>budgets');
  });

  it('a branch keeps a summary only up to the fork; a fork inside the covered range does not use it', async () => {
    // Fork at seq 2 (exchange 2's question): v1 (seq 1) is before the fork, v2 (seq 3) is past it.
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/branch`, headers: { cookie: user.cookie }, payload: { editSeq: 2 } });
    expect(res.statusCode).toBe(201);
    const branchId = (res.json() as { id: string }).id;
    const copied = await summaryRows(branchId);
    expect(copied.map((r) => [r.summaryVersion, r.coversUptoSeq])).toEqual([[1, 1]]);
    // The copy points at the branch's own copy of the message, not the source chat's.
    expect(copied[0]!.coversUptoMessageId).toBe((await assistantSeq(branchId, 1)).id);
    await send(branchId, 'edited question');
    const prompt = promptOf(lastChatRequest());
    expect(prompt).toContain('covers_upto="1" version="1"');
    expect(prompt).not.toContain('version="2"');
    expect(lastChatRequest().history).toEqual([]);

    // Fork at seq 0: the covered message is not kept, so no summary is copied or used.
    const early = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/branch`, headers: { cookie: user.cookie }, payload: { editSeq: 0 } });
    const earlyId = (early.json() as { id: string }).id;
    expect(await summaryRows(earlyId)).toEqual([]);
    await send(earlyId, 'a fresh start');
    expect(promptOf(lastChatRequest())).not.toContain('earlier_conversation_summary');
  });

  it('a summary whose message is not in this chat, or not below the current message, is not used', async () => {
    const other = await newChat();
    await send(other, 'first');
    // A row pointing at another chat's message is ignored by the join on the message's own chat.
    const foreign = await assistantSeq(chatId, 1);
    await ctx.db.insert(summaries).values({ chatId: other, coversUptoMessageId: foreign.id, coversUptoSeq: 1, summaryVersion: 9, text: 'foreign', model: 'm' });
    await send(other, 'second');
    expect(promptOf(lastChatRequest())).not.toContain('foreign');
    expect(historyTexts(lastChatRequest())).toHaveLength(2);
  });
});

describe('failures leave the history whole', () => {
  it('a failed or cut summary call writes nothing, and every turn is still sent', async () => {
    const chatId = await newChat();
    helperAnswers({ fail: true });
    for (let i = 1; i <= 7; i += 1) await send(chatId, `F${String(i)} ${BIG}`);
    expect(await summaryRows(chatId)).toEqual([]);
    helperAnswers({ finish: 'max_tokens' });
    await send(chatId, `F8 ${BIG}`);
    expect(await summaryRows(chatId)).toEqual([]);
    expect(logLines).toContainEqual(expect.objectContaining({ code: 'summary_skipped', reason: 'truncated' }));
    // Ours (owner item): with no summary, a turn older than six is not dropped.
    helperAnswers();
    ctx.provider.tokenCount = null; // count API down: the job does not run either
    await send(chatId, 'F9 last');
    expect(historyTexts(lastChatRequest()).filter((t) => t.startsWith('user:'))).toHaveLength(8);
    expect(await summaryRows(chatId)).toEqual([]);
    expect(await assistantSeq(chatId, 17)).toMatchObject({ ctxCountSource: 'none', ctxTokens: null, overBudget: null });
    expect(logLines).toContainEqual(expect.objectContaining({ code: 'summary_skipped', reason: 'count_unavailable' }));
  });
});

describe('the title job (HP-TITLE, N-76)', () => {
  async function chatRow(id: string) {
    const [row] = await ctx.db.select({ title: chats.title, titleSource: chats.titleSource }).from(chats).where(eq(chats.id, id));
    return row!;
  }

  it('names the chat once, after the first completed turn', async () => {
    const chatId = await newChat();
    await send(chatId, `Plan the ${SENTINEL} budget for the trip please`);
    expect(await chatRow(chatId)).toEqual({ title: `Budget ${SENTINEL} chat`, titleSource: 'generated' });
    const titleCall = ctx.provider.helperSeen.filter((r) => r.system.startsWith('Write a short title')).at(-1)!;
    expect(titleCall).toMatchObject({ maxOutputTokens: 40, thinking: 'off' });
    expect(titleCall.text).toContain('<first_message>');
    // The helper call has its own ledger row (ADR-0079 / ADR-0080), with no usage record.
    const ledger = await ctx.db
      .select({ role: modelCalls.role, usageRecordId: modelCalls.usageRecordId, provider: modelCalls.provider })
      .from(modelCalls)
      .where(and(eq(modelCalls.chatId, chatId), eq(modelCalls.role, 'title')));
    expect(ledger).toEqual([{ role: 'title', usageRecordId: null, provider: 'anthropic' }]);
    // A regenerate of the first answer and a second turn do not rename it again.
    helperAnswers({ title: 'Another title' });
    const [answer] = await ctx.db.select({ id: messages.id }).from(messages).where(and(eq(messages.chatId, chatId), eq(messages.seq, 1)));
    await send(chatId, 'x', ctx, user, { retryMessageId: answer!.id });
    await send(chatId, 'second question');
    expect((await chatRow(chatId)).title).toBe(`Budget ${SENTINEL} chat`);
  });

  it('a rename wins the race: the job compares and sets on the placeholder only', async () => {
    const chatId = await newChat();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    ctx.provider.helperHandler = async (req: HelperRequest) => {
      if (req.system.startsWith('Write a short title')) await gate;
      return { text: 'Generated name', usage: usageOf(1, 1), finishReason: 'end_turn' };
    };
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { prompt: 'name me' } });
    expect(res.statusCode).toBe(200);
    // The job is waiting on the model; the user renames the chat meanwhile.
    const patch = await ctx.app.inject({ method: 'PATCH', url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie }, payload: { title: 'My own name' } });
    expect(patch.statusCode).toBe(200);
    release();
    await ctx.app.services.helperJobs.idle();
    expect(await chatRow(chatId)).toEqual({ title: 'My own name', titleSource: 'user' });
    expect(logLines).toContainEqual(expect.objectContaining({ code: 'title_skipped', reason: 'renamed', chatId }));
  });

  it('cleans what the model wrote: one line, no markup or quotes, no trailing period, 60 code points', () => {
    expect(cleanTitle('**"Trip to Japan."**\nmore')).toBe('Trip to Japan');
    expect(cleanTitle('Title: <b>Budget</b> plan…')).toBe('Budget plan');
    expect(Array.from(cleanTitle('😀'.repeat(80)))).toHaveLength(60);
    expect(cleanTitle('   \n  ')).toBe('');
  });
});

describe('the helper is never substituted (Invariant 1)', () => {
  it('without a helper model the jobs are skipped with a code, and no other model is called', async () => {
    const off = await createTestApp({ MODEL_HAIKU: '' });
    try {
      spyLogs(off);
      off.provider.tokenCount = countBig;
      off.provider.helperHandler = async () => ({ text: 'never', usage: usageOf(1, 1), finishReason: 'end_turn' });
      const u = await signUp(off);
      const chatId = await newChat(off, u);
      for (let i = 1; i <= 7; i += 1) await send(chatId, `H${String(i)} ${BIG}`, off, u);
      expect(off.provider.helperSeen).toEqual([]);
      // One chat request per turn, nothing else on the stream path.
      expect(off.provider.seen).toHaveLength(7);
      expect(logLines).toContainEqual(expect.objectContaining({ code: 'title_skipped', reason: 'helper_unavailable', chatId }));
      expect(logLines).toContainEqual(expect.objectContaining({ code: 'summary_skipped', reason: 'helper_unavailable', chatId }));
    } finally {
      await off.close();
      setDb(ctx.db, ctx.sql);
    }
  });
});

describe('the router shadow (RT-2, N-69)', () => {
  it('off: zero classify calls', async () => {
    const before = ctx.provider.helperSeen.length;
    const chatId = await newChat();
    await send(chatId, 'hello');
    expect(ctx.provider.helperSeen.slice(before).filter((r) => r.schema)).toEqual([]);
  });

  it('on: one coded log line, never awaited, and the model the rules picked is unchanged', async () => {
    const on = await createTestApp({ ROUTER_SHADOW: 'true' });
    try {
      spyLogs(on);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let gated = true;
      on.provider.helperHandler = async (req) => {
        if (req.schema) {
          if (gated) await gate;
          return { text: '{"intent":"Chat","tier":"QUALITY"}', usage: usageOf(50, 9), finishReason: 'end_turn' };
        }
        return { text: 'T', usage: usageOf(1, 1), finishReason: 'end_turn' };
      };
      const u = await signUp(on);
      const chatId = await newChat(on, u);
      const res = await on.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: u.cookie }, payload: { prompt: `route ${SENTINEL}` } });
      // The answer is complete while the router is still waiting: it was never awaited.
      const frames = parseSse(res.body);
      expect(frames.some((f) => f.event === 'done')).toBe(true);
      const start = frames.find((f) => f.event === 'start')!.data as { model: { resolved: string } };
      expect(start.model.resolved).toBe('Gemini 3.8 Flash');
      release();
      await on.app.services.helperJobs.idle();
      const lineOf = (id: string) => logLines.filter((l) => (l as { code?: string }).code === 'router_shadow' && (l as { chatId?: string }).chatId === id);
      // One line; `ok`, or `timeout` when the gated turn took longer than N-69's 1.5 s.
      expect(lineOf(chatId)).toEqual([expect.objectContaining({ resolvedAlias: 'Gemini 3.8 Flash', status: expect.stringMatching(/^(ok|timeout)$/) })]);

      // Ungated: the decision is parsed (enums matched without regard to case) and logged.
      gated = false;
      const second = await newChat(on, u);
      await send(second, 'route again', on, u);
      const classify = on.provider.helperSeen.filter((r) => r.schema);
      expect(classify).toHaveLength(2);
      expect(classify[1]).toMatchObject({ maxOutputTokens: 1_024, thinking: 'off', reasoningEffort: 'low' });
      expect(lineOf(second)).toEqual([
        expect.objectContaining({ status: 'ok', intent: 'chat', tier: 'quality', resolvedAlias: 'Gemini 3.8 Flash', inputTokens: 50, outputTokens: 9 }),
      ]);
      // A tier of "quality" changed nothing: the stored answers are Gemini's.
      const answered = await on.db.select({ alias: messages.modelAlias }).from(messages).where(and(eq(messages.role, 'assistant'), eq(messages.userId, u.id)));
      expect(answered.map((r) => r.alias)).toEqual(['Gemini 3.8 Flash', 'Gemini 3.8 Flash']);
    } finally {
      await on.close();
      setDb(ctx.db, ctx.sql);
    }
  });

  it('matches an enum without regard to case, and nothing else', () => {
    expect(matchEnum(' FILES ', ROUTER_INTENTS)).toBe('files');
    expect(matchEnum('filez', ROUTER_INTENTS)).toBeNull();
    expect(matchEnum(3, ROUTER_INTENTS)).toBeNull();
  });
});

describe('HIST-WINDOW, table-driven (N-16 6, N-75 floor 2, N-03 budget)', () => {
  type Row = { id: string; role: 'user' | 'assistant'; text: string; seq: number; status: string };
  /** n exchanges, oldest first; `status` per exchange overrides the answer's status. */
  function rows(n: number, statusOf: Record<number, string> = {}, textOf: Record<number, string> = {}): Row[] {
    return Array.from({ length: n }, (_, i) => [
      { id: `u${String(i)}`, role: 'user' as const, text: `q${String(i)}`, seq: 2 * i, status: 'complete' },
      { id: `a${String(i)}`, role: 'assistant' as const, text: textOf[i] ?? `a${String(i)}`, seq: 2 * i + 1, status: statusOf[i] ?? 'complete' },
    ]).flat();
  }
  const toTurns = (r: Row[]): Turn[] => withoutFailedExchanges(r, new Map()).map((m) => ({ role: m.role, text: m.text }));

  it.each([
    // name, exchanges, per-exchange tokens, fixed, budget, keepUncovered → kept, dropped, overBudget
    { name: 'all fit, stage rule caps at 6', n: 9, each: 100, fixed: 1_000, budget: 48_000, keep: false, kept: 6, dropped: 3, over: false },
    { name: 'all fit, ours keeps uncovered', n: 9, each: 100, fixed: 1_000, budget: 48_000, keep: true, kept: 9, dropped: 0, over: false },
    { name: 'over budget drops oldest down to fit', n: 6, each: 10_000, fixed: 10_000, budget: 48_000, keep: true, kept: 3, dropped: 3, over: false },
    { name: 'floor 2 is sent even over budget', n: 6, each: 30_000, fixed: 10_000, budget: 48_000, keep: true, kept: 2, dropped: 4, over: true },
    { name: 'one exchange alone over budget stays', n: 1, each: 60_000, fixed: 0, budget: 48_000, keep: true, kept: 1, dropped: 0, over: true },
  ])('$name', ({ n, each, fixed, budget, keep, kept, dropped, over }) => {
    const exchanges = groupExchanges(toTurns(rows(n)));
    const r = selectWindow({ exchanges, exchangeTokens: exchanges.map(() => each), fixedTokens: fixed, promptTokens: 0, summaryTokens: 0, budget, maxTurns: 6, floor: 2, keepUncovered: keep });
    expect([r.kept.length, r.dropped, r.overBudget]).toEqual([kept, dropped, over]);
    // The newest exchanges are the ones kept.
    expect(r.kept.at(-1)?.[0]?.text).toBe(`q${String(n - 1)}`);
  });

  it.each<{ name: string; status: Record<number, string>; text: Record<number, string>; exchanges: number }>([
    { name: 'a blocked (error) answer and its question are out', status: { 1: 'error' }, text: {}, exchanges: 2 },
    { name: 'an empty answer and its question are out', status: {}, text: { 0: '   ' }, exchanges: 2 },
  ])('$name', ({ status, text, exchanges }) => {
    const turns = toTurns(rows(3, status, text));
    expect(groupExchanges(turns)).toHaveLength(exchanges);
  });

  it('with no count nothing is dropped for size, and the stamp says so', () => {
    const exchanges = groupExchanges(toTurns(rows(8)));
    const r = selectWindow({ exchanges, exchangeTokens: null, fixedTokens: null, promptTokens: null, summaryTokens: 0, budget: 10, maxTurns: 6, floor: 2, keepUncovered: true });
    expect([r.kept.length, r.totalTokens, r.overBudget]).toEqual([8, null, null]);
  });
});

describe('REC: the continuation text (Stage 6 doc-sync 2026-10-12)', () => {
  it('renders the text file, then the escaped partial in <previous_response>', () => {
    const r = renderRecovery('It ended at <tag>');
    expect(r.version).toBe('continue-v1');
    expect(r.text.startsWith('Your previous response was interrupted.')).toBe(true);
    expect(r.text.endsWith('<previous_response>\nIt ended at &lt;tag>\n</previous_response>')).toBe(true);
  });
});

describe('the jobs log ids, codes and counts only (Stage 17 NO_CONTENT)', () => {
  it('no log line of any job carries user, file, summary or title text', () => {
    expect(logLines.length).toBeGreaterThan(10);
    const text = JSON.stringify(logLines);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('budgets');
    expect(text).not.toContain('BIG');
    // The lines are what they claim: each has a code.
    for (const line of logLines) expect((line as { code?: unknown }).code).toEqual(expect.any(String));
  });
});
