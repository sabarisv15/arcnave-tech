/**
 * tech-build.2 Part A (P09) exit tests: OCR per page, audio in timed segments, images as a
 * normalised copy. Every provider is the harness fake (no OCR or transcription is real).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments, fileChunks, fileDerivativePages, fileDerivatives } from '../db/schema.js';
import { pdfWithPages } from '../test/fixtures/files.js';
import { buildScannedPdf } from '../test/fixtures/scannedPdf.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, parseSse, postProjectFile, signUp } from '../test/harness.js';

const run = promisify(execFile);

let ctx: TestContext;
let user: TestUser;
const auth = () => ({ cookie: user.cookie });

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

async function uploadChat(filename: string, mimeType: string, bytes: Buffer): Promise<string> {
  const started = await ctx.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: auth(), payload: { filename, mimeType, sizeBytes: bytes.length } });
  expect(started.statusCode).toBe(201);
  const body = started.json() as { file: { id: string }; upload: { url: string } };
  const put = await ctx.app.inject({ method: 'PUT', url: `/v1${body.upload.url}`, headers: { ...auth(), 'content-type': 'application/octet-stream' }, payload: bytes });
  expect(put.statusCode).toBe(204);
  expect((await ctx.app.inject({ method: 'POST', url: `/v1/files/${body.file.id}/complete`, headers: auth() })).statusCode).toBe(202);
  await ctx.app.services.files.idle();
  return body.file.id;
}

async function pagesOf(where: { attachmentId?: string; projectFileId?: string }) {
  const [d] = await ctx.db
    .select()
    .from(fileDerivatives)
    .where(where.attachmentId ? eq(fileDerivatives.attachmentId, where.attachmentId) : eq(fileDerivatives.projectFileId, where.projectFileId!));
  const pages = await ctx.db.select().from(fileDerivativePages).where(eq(fileDerivativePages.derivativeId, d!.id)).orderBy(fileDerivativePages.ordinal);
  return { derivative: d!, pages };
}

/** The OCR prompts sent since `from`, and the page numbers each named. */
function ocrCalls(from: number): number[][] {
  return ctx.provider.readSeen
    .slice(from)
    .map((c) => /numbered ([\d, ]+)\./.exec(c.prompt)?.[1])
    .filter((n): n is string => Boolean(n))
    .map((n) => n.split(',').map((x) => Number(x.trim())));
}

/* ------------------------------------------------------------------ OCR */

describe('OCR per page (OCR-M11)', () => {
  it('reads the scanned fixture page by page into a project, where search finds it with its page', async () => {
    const before = ctx.provider.readSeen.length;
    // buildScannedPdf was unused until now: pages that are only images, no text layer.
    const pdf = await buildScannedPdf([[['Statement', 'March']], [['Closing', 'balance', '250']]]);
    ctx.provider.readHandler = async (_parts, prompt) => {
      const nums = /numbered ([\d, ]+)\./.exec(prompt)![1]!.split(',').map((n) => n.trim());
      return { text: nums.map((n) => `=== PAGE ${n} ===\n${n === '2' ? 'Closing balance 250 quetzalscan' : 'Statement March'}`).join('\n'), finishReason: 'STOP', model: 'fake-ocr-7' };
    };
    try {
      const project = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: auth(), payload: { title: 'scans' } });
      const projectId = (project.json() as { id: string }).id;
      const res = await postProjectFile(ctx, auth(), projectId, multipart('statement.pdf', pdf, 'application/pdf'));
      expect(res.json()).toMatchObject({ status: 'ready' });
      const fileId = String(res.json()['id']);

      const { pages } = await pagesOf({ projectFileId: fileId });
      expect(pages.map((p) => [p.label, p.source, p.ocrEngine, p.ocrVersion])).toEqual([
        ['p. 1', 'ocr', 'gemini', 'fake-ocr-7'],
        ['p. 2', 'ocr', 'gemini', 'fake-ocr-7'],
      ]);
      expect(ocrCalls(before)).toEqual([[1, 2]]);

      const search = await ctx.app.inject({ url: `/v1/projects/${projectId}/search?q=quetzalscan`, headers: auth() });
      const hits = (search.json() as { items: Array<{ filename: string; page: number | null }> }).items;
      expect(hits[0]).toMatchObject({ filename: 'statement.pdf', page: 2 });
      const chunks = await ctx.db.select().from(fileChunks).where(eq(fileChunks.projectFileId, fileId));
      expect(chunks.map((c) => c.page).sort()).toEqual([1, 2]);
    } finally {
      ctx.provider.readHandler = null;
    }
  });

  it('keeps a mixed PDF’s text page as text and OCRs only its scanned page', async () => {
    const before = ctx.provider.readSeen.length;
    const text = await PDFDocument.create();
    const font = await text.embedFont(StandardFonts.Helvetica);
    text.addPage([600, 400]).drawText('Typed page: invoice total 4,800 rupees', { x: 20, y: 360, size: 12, font });
    const scanned = await PDFDocument.load(await buildScannedPdf([[['Handwritten', 'receipt']]]));
    const [copied] = await text.copyPages(scanned, [0]);
    text.addPage(copied);
    const id = await uploadChat('mixed.pdf', 'application/pdf', Buffer.from(await text.save()));

    const { pages } = await pagesOf({ attachmentId: id });
    expect(pages.map((p) => p.source)).toEqual(['text', 'ocr']);
    expect(pages[0]!.text).toContain('invoice total 4,800 rupees');
    expect(ocrCalls(before)).toEqual([[2]]);
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    expect(row!.extractedText).toContain('--- Page 1 ---\nTyped page: invoice total 4,800 rupees');
    expect(row!.extractedText).toContain('--- Page 2 ---\nPage 2 text read by the fake OCR.');
  });

  it('reads a 150-page scan whole, in batches of at most 15 pages', { timeout: 180_000 }, async () => {
    const before = ctx.provider.readSeen.length;
    const pdf = await buildScannedPdf(Array.from({ length: 150 }, (_, i) => [[`Page`, `${String(i + 1)}`, 'entry']]));
    const id = await uploadChat('long-scan.pdf', 'application/pdf', pdf);
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    expect(row).toMatchObject({ status: 'ready', pageCount: 150 });
    const { pages } = await pagesOf({ attachmentId: id });
    expect(pages).toHaveLength(150);
    expect(pages.every((p) => p.source === 'ocr' && p.text.length > 0)).toBe(true);
    const calls = ocrCalls(before);
    expect(calls).toHaveLength(10);
    expect(Math.max(...calls.map((c) => c.length))).toBeLessThanOrEqual(15);
    expect(calls.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(row!.extractedText).toContain('--- Page 150 ---');
  });

  it('retries a cut batch once, then marks its pages failed with an ocr_partial warning', async () => {
    let calls = 0;
    ctx.provider.readHandler = async () => {
      calls += 1;
      return { text: '=== PAGE 1 ===\nhalf', finishReason: 'MAX_TOKENS', model: 'fake' };
    };
    try {
      const id = await uploadChat('cut.pdf', 'application/pdf', await buildScannedPdf([[['Cut', 'off']]]));
      expect(calls).toBe(2);
      const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
      expect(row!.status).toBe('ready');
      expect(row!.warnings.map((w) => w.code)).toContain('ocr_partial');
      const { pages } = await pagesOf({ attachmentId: id });
      expect(pages[0]!.source).toBe('failed');
    } finally {
      ctx.provider.readHandler = null;
    }
  });
});

/* ------------------------------------------------------------------ audio */

describe('audio in timed segments (AUDIO / M10)', () => {
  it('transcribes a 40 MB recording piece by piece, each piece a segment with its timestamps', { timeout: 120_000 }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'audio-fixture-'));
    try {
      const wav = path.join(dir, 'meeting.wav');
      // 238 s of 44.1 kHz stereo 16-bit PCM: 41,983,244 bytes.
      await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=238', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', wav]);
      const bytes = await readFile(wav);
      expect(bytes.length).toBeGreaterThan(40 * 1024 * 1024 - 1);
      let n = 0;
      ctx.provider.readHandler = async (parts) => {
        n += 1;
        expect(parts[0]).toMatchObject({ mimeType: 'audio/mpeg' });
        return { text: `spoken words of piece ${String(n)}`, finishReason: 'STOP', model: 'fake-audio' };
      };
      const id = await uploadChat('meeting.wav', 'audio/wav', bytes);
      const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
      expect(row!.status).toBe('ready');
      const { derivative, pages } = await pagesOf({ attachmentId: id });
      expect(derivative.kind).toBe('audio');
      expect(pages.map((p) => [p.label, p.tStartMs, p.tEndMs, p.source])).toEqual([
        ['00:00–01:30', 0, 90_000, 'transcript'],
        ['01:30–03:00', 90_000, 180_000, 'transcript'],
        ['03:00–03:58', 180_000, 238_000, 'transcript'],
      ]);
      expect(row!.extractedText).toMatch(/^\[00:00–01:30\] spoken words of piece \d/);
      expect(n).toBe(3);
    } finally {
      ctx.provider.readHandler = null;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ images */

describe('images as a normalised copy (IMAGES, CLAUDE-IMG)', () => {
  it('sends an 8 MB JPEG with GPS EXIF to Claude without error, as a copy with no GPS', { timeout: 60_000 }, async () => {
    const w = 3500;
    const h = 2650;
    const original = await sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 92 })
      .withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 5/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '80/1 16/1 0/1' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(original.length).toBeGreaterThan(7.5 * 1024 * 1024);
    const gpsTag = Buffer.from([0x88, 0x25]);
    const meta = await sharp(original).metadata();
    expect(meta.exif?.includes(gpsTag) || meta.exif?.includes(Buffer.from([0x25, 0x88]))).toBe(true);

    const id = await uploadChat('site-photo.jpg', 'image/jpeg', original);
    const { derivative } = await pagesOf({ attachmentId: id });
    expect(derivative.normalizedKey).toBeTruthy();
    const stored = await ctx.app.services.storage.get(derivative.normalizedKey!);
    const storedMeta = await sharp(stored).metadata();
    expect(storedMeta.exif).toBeUndefined();
    expect(stored.includes(Buffer.from('TestCam'))).toBe(false);
    // Rotated by its EXIF orientation (6: 90°), so it is portrait now, within 2,576 px.
    expect(storedMeta.height).toBe(2576);
    expect(storedMeta.width).toBeLessThan(2576);
    // The original is kept as uploaded.
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    expect((await ctx.app.services.storage.get(row!.storageKey)).equals(original)).toBe(true);

    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth(), payload: { title: 'photo' } });
    const chatId = (chat.json() as { id: string }).id;
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: auth(), payload: { prompt: 'What is in this photo?', model: 'Sonnet 5.5', attachmentIds: [id] } });
    expect(parseSse(res.body).at(-1)!.event).toBe('done');
    const sent = ctx.provider.seen.at(-1)!.attachments!.find((a) => a.id === id)!;
    expect(sent.mimeType).toBe('image/jpeg');
    expect(Buffer.byteLength(sent.base64!, 'utf8')).toBeLessThanOrEqual(5_242_880);
    expect(Buffer.from(sent.base64!, 'base64').equals(stored)).toBe(true);
  });

  it('sends each image at ≤ 2,000 px when a request carries more than 20 images', { timeout: 60_000 }, async () => {
    // N-10 allows 20 files per chat, so the 21st and 22nd images are a PDF's page images.
    const ids: string[] = [];
    for (let i = 0; i < 19; i++) {
      const img = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: i * 10, g: 80, b: 120 } } }).jpeg().toBuffer();
      ids.push(await uploadChat(`p${String(i)}.jpg`, 'image/jpeg', img));
    }
    ids.push(await uploadChat('three.pdf', 'application/pdf', await pdfWithPages(3, ['one', 'two', 'three'])));
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth(), payload: { title: 'many' } });
    const chatId = (chat.json() as { id: string }).id;
    // Two turns (N-10: ≤ 10 files per message); the second request carries all 22 images.
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: auth(), payload: { prompt: 'first ten', attachmentIds: ids.slice(0, 10) } });
    const first = ctx.provider.seen.at(-1)!.attachments!;
    expect((await sharp(Buffer.from(first[0]!.base64!, 'base64')).metadata()).width).toBe(2400);
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: auth(), payload: { prompt: 'the rest', attachmentIds: ids.slice(10) } });
    const req = ctx.provider.seen.at(-1)!;
    const all = [...req.attachments!, ...req.history.flatMap((t) => t.attachments ?? [])];
    const images = all.filter((a) => a.mimeType.startsWith('image/') && a.base64);
    expect(images.length).toBe(19);
    expect(all.find((a) => a.pages)?.pages?.filter((p) => p.image)).toHaveLength(3);
    for (const a of images) expect((await sharp(Buffer.from(a.base64!, 'base64')).metadata()).width).toBeLessThanOrEqual(2000);
  });
});
