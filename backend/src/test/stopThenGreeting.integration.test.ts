/**
 * Owner case `stop_then_greeting` (tech-p03, extra cases): what the model is sent after a Stop.
 *
 * The user asks for a long essay, stops it part-way, then sends "hai". Live, Gemini 3.8 Flash
 * was observed continuing the essay. This test does not judge the model; it proves what the
 * request carries, through the real history loader and the real stop route, with a fake
 * provider. Until P11 the stopped partial went back as an ordinary assistant turn with nothing
 * saying it was stopped; P11 (ADR-0081, ours) adds a cut marker after its text, so the model is
 * told the answer did not finish. Updated deliberately: the history assertion flipped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { messages } from '../db/schema.js';
import { asc, eq } from 'drizzle-orm';
import { loadExtraCases } from '../../evals/prompt-kit/kit.js';
import { createTestApp, signUp } from './harness.js';
import { CUT_MARKERS } from '../services/history/failedExchanges.js';
import { answer, AttemptsProvider, generate, newChat, type Session } from './turnSnapshot.js';

describe('stop_then_greeting: a stopped partial answer in the next request', () => {
  const provider = new AttemptsProvider();
  const s = {} as Session;

  beforeAll(async () => {
    s.ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' }, provider);
    s.user = await signUp(s.ctx);
  });
  afterAll(async () => {
    await s.ctx.close();
  });

  it('keeps the stopped partial in history with its cut marker, and sends "hai" as the prompt', async () => {
    const extra = loadExtraCases().find((c) => c.id === 'stop_then_greeting')!;
    const [ask, partialTurn] = extra.history!;
    const partial = partialTurn!.text;
    const chatId = await newChat(s);

    // Turn 1: the essay request. The answer starts, then the user presses Stop.
    provider.attempts = [
      async function* (request) {
        yield { type: 'delta', text: partial };
        await s.ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/stop`, headers: { cookie: s.user.cookie } });
        if (request.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        yield* answer('Never sent.');
      },
    ];
    const first = await generate(s, chatId, { prompt: ask!.text });
    expect(first.frames.map((f) => f.event)).not.toContain('done');

    const rows = await s.ctx.db.select({ role: messages.role, status: messages.status, text: messages.text }).from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.seq));
    expect(rows.map((r) => `${r.role}:${r.status}`)).toEqual(['user:complete', 'assistant:stopped']);
    expect(rows[1]!.text).toBe(partial);

    // Turn 2: "hai". The request the provider gets.
    provider.attempts = [];
    provider.script = answer('Hai! Eppadi irukkeenga?');
    const before = provider.seen.length;
    const second = await generate(s, chatId, { prompt: extra.user });
    expect(second.statusCode).toBe(200);
    const request = provider.seen.slice(before).at(-1)!;

    expect(request.prompt).toBe('hai');
    expect(request.history.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(request.history[0]!.text).toBe(ask!.text);
    // The stopped partial reaches the model word for word, then the marker that says it was stopped.
    expect(request.history[1]!.text).toBe(`${partial}\n\n${CUT_MARKERS.stopped}`);
    expect(request.history[1]!.text.startsWith(partial)).toBe(true);
    // Nothing in the system instruction tells the model about an unfinished earlier answer.
    expect(request.systemInstruction).not.toMatch(/was stopped|unfinished earlier|stopped by the user/i);
  });
});
