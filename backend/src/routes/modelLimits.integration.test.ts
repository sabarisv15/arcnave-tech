/**
 * G18 through the route: a file over the selected model's limit fails with a typed error before
 * any provider call, the budget reservation is given back, and another model with no such
 * verified limit still takes the same file.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { usageCounters } from '../db/schema.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, parseSse, signUp } from '../test/harness.js';

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

/** A PNG of random grey noise: it does not compress, so its size is what it looks like. */
function noisePng(side: number): Buffer {
  const row = side + 1;
  const raw = crypto.randomBytes(row * side);
  for (let y = 0; y < side; y++) raw[y * row] = 0; // filter byte: none
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr.writeUInt8(8, 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const newChat = async () =>
  ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } })).json() as { id: string }).id;
const generate = async (chatId: string, model: string, fileId: string) =>
  ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie: user.cookie },
    payload: { prompt: 'Summarise', model, attachmentIds: [fileId] },
  });
/** The browser's path: start, send the bytes, complete. It takes files over the multipart cap. */
async function uploadFile(name: string, bytes: Buffer, mime: string): Promise<string> {
  const headers = { cookie: user.cookie };
  const started = await ctx.app.inject({
    method: 'POST',
    url: '/v1/files/uploads',
    headers,
    payload: { filename: name, mimeType: mime, sizeBytes: bytes.length },
  });
  expect(started.statusCode).toBe(201);
  const { file, upload } = started.json() as { file: { id: string }; upload: { url: string } };
  const put = await ctx.app.inject({
    method: 'PUT',
    url: `/v1${upload.url}`,
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  expect(put.statusCode).toBe(204);
  const done = await ctx.app.inject({ method: 'POST', url: `/v1/files/${file.id}/complete`, headers });
  expect(done.statusCode).toBe(200);
  return file.id;
}

describe('G18: provider limits from the selected model', () => {
  it('an image over Claude-on-Vertex\'s 5 MB is refused with provider_payload_limit before any call, and accepted for Gemini', async () => {
    const fileId = await uploadFile('noise.png', noisePng(2000), 'image/png');

    const callsBefore = ctx.provider.seen.length;
    const refused = parseSse((await generate(await newChat(), 'Opus 5.5', fileId)).body).at(-1)!;
    expect(refused).toMatchObject({ event: 'error', data: { code: 'provider_payload_limit' } });
    expect(ctx.provider.seen.length).toBe(callsBefore);

    // The reservation taken before the check was given back.
    const counters = await ctx.db.select().from(usageCounters).where(eq(usageCounters.userId, user.id));
    expect(counters.length).toBeGreaterThan(0);
    for (const c of counters) expect(c.tokensReserved).toBe(0);

    const accepted = parseSse((await generate(await newChat(), 'Gemini 3.8 Flash', fileId)).body).at(-1)!;
    expect(accepted.event).toBe('done');
  });

  it('a 601-page PDF goes to Claude as text, so its 600-page PDF limit does not apply (ADR-0013)', async () => {
    const fileId = await uploadFile('long.pdf', await longPdf(601), 'application/pdf');
    const done = parseSse((await generate(await newChat(), 'Opus 5.5', fileId)).body).at(-1)!;
    expect(done.event).toBe('done');
    const sent = ctx.provider.seen.at(-1)!.attachments!.find((a) => a.id === fileId)!;
    expect(sent).toMatchObject({ textOnlyPageCount: 601 });
    expect(sent.base64).toBeUndefined();
  });
});
