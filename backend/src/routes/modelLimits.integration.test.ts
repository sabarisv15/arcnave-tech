/**
 * G18 through the route: a file over the selected model's limit fails with a typed error before
 * any provider call, the budget reservation is given back, and another model with no such
 * verified limit still takes the same file.
 */
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { usageCounters } from '../db/schema.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
  await ctx.app.inject({
    method: 'PATCH',
    url: '/v1/usage/limits',
    headers: { cookie: user.cookie },
    payload: { dailyTokenBudget: 10_000_000 },
  });
});

afterAll(async () => {
  await ctx.close();
});

async function longPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([10, 10]);
  return Buffer.from(await doc.save());
}

describe('G18: provider limits from the selected model', () => {
  it('a 601-page PDF is refused for Claude with provider_payload_limit, and accepted for Gemini', async () => {
    const part = multipart('long.pdf', await longPdf(601), 'application/pdf');
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...part.headers, cookie: user.cookie },
      payload: part.payload,
    });
    expect(upload.statusCode).toBe(201);
    const fileId = (upload.json() as { id: string }).id;

    const newChat = async () =>
      ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } })).json() as { id: string }).id;
    const generate = async (chatId: string, model: string) =>
      ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers: { cookie: user.cookie },
        payload: { prompt: 'Summarise', model, attachmentIds: [fileId] },
      });

    const callsBefore = ctx.provider.seen.length;
    const refused = parseSse((await generate(await newChat(), 'Opus 5')).body).at(-1)!;
    expect(refused).toMatchObject({ event: 'error', data: { code: 'provider_payload_limit' } });
    expect(JSON.stringify(refused.data)).toContain('601');
    expect(ctx.provider.seen.length).toBe(callsBefore);

    // The reservation taken before the check was given back.
    const counters = await ctx.db.select().from(usageCounters).where(eq(usageCounters.userId, user.id));
    expect(counters.length).toBeGreaterThan(0);
    for (const c of counters) expect(c.tokensReserved).toBe(0);

    // A new message for the same file: the Gemini alias has no verified page limit, so no refusal here.
    const accepted = parseSse((await generate(await newChat(), 'Gemini 3.8 Flash')).body).at(-1)!;
    expect(accepted.event).toBe('done');
  });
});
