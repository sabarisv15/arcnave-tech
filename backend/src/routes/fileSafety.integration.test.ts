/**
 * tech-build.2 Part C (P19, the part that needs no sandbox): the clamd INSTREAM scanner and the
 * PDF active-content strip.
 *
 * The scanner is tested against a small clamd stand-in speaking the real INSTREAM protocol over
 * TCP (clamd(8)): it reads the length-prefixed chunks and answers FOUND for the EICAR test
 * string, as ClamAV does. No clamd is deployed here (infra, the owner's). The EICAR string is
 * assembled at runtime so no file in the repo carries it whole: an antivirus on a developer's
 * machine would otherwise quarantine this test.
 */
import net from 'node:net';

import { eq } from 'drizzle-orm';
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments, fileDerivatives } from '../db/schema.js';
import { ClamdScanner } from '../services/attachments/scanner.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');

/** A clamd stand-in: INSTREAM only. `mode` makes it answer as an over-limit or broken daemon. */
function fakeClamd(): Promise<{ port: number; close: () => Promise<void>; streams: number[]; mode: { value: 'scan' | 'limit' } }> {
  const streams: number[] = [];
  const mode = { value: 'scan' as 'scan' | 'limit' };
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let commandDone = false;
    let body = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!commandDone) {
        const end = buf.indexOf(0);
        if (end === -1) return;
        if (buf.subarray(0, end).toString() !== 'zINSTREAM') return socket.end('UNKNOWN COMMAND\0');
        commandDone = true;
        buf = buf.subarray(end + 1);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          streams.push(body.length);
          if (mode.value === 'limit') return socket.end('INSTREAM size limit exceeded. ERROR\0');
          return socket.end(body.includes(Buffer.from(EICAR)) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
        }
        if (buf.length < 4 + len) return;
        body = Buffer.concat([body, buf.subarray(4, 4 + len)]);
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, streams, mode, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

let clamd: Awaited<ReturnType<typeof fakeClamd>>;
let ctx: TestContext;
let user: TestUser;
const auth = () => ({ cookie: user.cookie });

beforeAll(async () => {
  clamd = await fakeClamd();
  ctx = await createTestApp({ FILE_SCANNER: 'clamd', CLAMD_HOST: '127.0.0.1', CLAMD_PORT: String(clamd.port) });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
  await clamd.close();
});

async function uploadChat(filename: string, mimeType: string, bytes: Buffer): Promise<string> {
  const started = await ctx.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: auth(), payload: { filename, mimeType, sizeBytes: bytes.length } });
  const body = started.json() as { file: { id: string }; upload: { url: string } };
  await ctx.app.inject({ method: 'PUT', url: `/v1${body.upload.url}`, headers: { ...auth(), 'content-type': 'application/octet-stream' }, payload: bytes });
  expect((await ctx.app.inject({ method: 'POST', url: `/v1/files/${body.file.id}/complete`, headers: auth() })).statusCode).toBe(202);
  await ctx.app.services.files.idle();
  return body.file.id;
}

const fileOf = async (id: string) => (await ctx.db.select().from(attachments).where(eq(attachments.id, id)))[0]!;

describe('malware scan (Stage 9 SCAN, clamd INSTREAM)', () => {
  it('fails the EICAR test file as malware, before anything reads it', async () => {
    const before = clamd.streams.length;
    const id = await uploadChat('eicar.txt', 'text/plain', Buffer.from(EICAR));
    expect(clamd.streams.length).toBe(before + 1);
    expect(clamd.streams.at(-1)).toBe(EICAR.length);
    expect(await fileOf(id)).toMatchObject({ status: 'failed', errorCode: 'malware', extractedText: null });
    const dto = (await ctx.app.inject({ url: `/v1/files/${id}`, headers: auth() })).json() as { errorCode: string; error: string };
    expect(dto).toMatchObject({ errorCode: 'malware', error: 'This file was removed because it looks harmful.' });
  });

  it('passes a clean file, and records which scanner read it', async () => {
    const id = await uploadChat('clean.txt', 'text/plain', Buffer.from('nothing to see here'));
    expect(await fileOf(id)).toMatchObject({ status: 'ready' });
    const [d] = await ctx.db.select().from(fileDerivatives).where(eq(fileDerivatives.attachmentId, id));
    expect(d!.sidecar['scanner']).toBe('clamd');
  });

  it('fails as scan_incomplete when clamd cannot scan the whole stream', async () => {
    clamd.mode.value = 'limit';
    try {
      const id = await uploadChat('big-ish.txt', 'text/plain', Buffer.from('more than clamd will take'));
      expect(await fileOf(id)).toMatchObject({ status: 'failed', errorCode: 'scan_incomplete' });
    } finally {
      clamd.mode.value = 'scan';
    }
  });

  it('fails as scan_incomplete, never as clean, when clamd cannot be reached or the file is over its limit', async () => {
    const down = new ClamdScanner({ host: '127.0.0.1', port: 1, timeoutMs: 2000, maxBytes: 1_000_000 });
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-'));
    try {
      const f = path.join(dir, 'a.txt');
      await fs.writeFile(f, 'hello');
      await expect(down.scan(f)).rejects.toMatchObject({ code: 'scan_incomplete' });
      const tiny = new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 2000, maxBytes: 3 });
      await expect(tiny.scan(f)).rejects.toMatchObject({ code: 'scan_incomplete' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('PDF active content (Stage 9 SCAN, D1 #22)', () => {
  it('strips an OpenAction script, document JavaScript and link actions from the stored copy', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText('Invoice 2026-118, total 4,500', { x: 20, y: 250, size: 12, font });
    const js = (code: string) => doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of(code) });
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(js('app.alert("opened")')));
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ JavaScript: doc.context.obj({ Names: [PDFString.of('x'), doc.context.register(js('app.alert(2)'))] }) }));
    page.node.set(PDFName.of('AA'), doc.context.obj({ O: doc.context.register(js('app.alert(3)')) }));
    const link = doc.context.register(
      doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], A: doc.context.obj({ S: 'Launch', F: PDFString.of('calc.exe') }) }),
    );
    page.node.set(PDFName.of('Annots'), doc.context.obj([link]));
    // Without object streams, so the actions sit in the file as plain text, as most do.
    const original = Buffer.from(await doc.save({ useObjectStreams: false }));
    expect(original.includes(Buffer.from('/OpenAction'))).toBe(true);

    const id = await uploadChat('invoice.pdf', 'application/pdf', original);
    const row = await fileOf(id);
    expect(row.status).toBe('ready');
    expect(row.warnings.map((w) => w.code)).toContain('active_content_removed');
    expect(row.extractedText).toContain('Invoice 2026-118, total 4,500');

    const stored = await ctx.app.services.storage.get(row.storageKey);
    const back = await PDFDocument.load(stored);
    expect(back.catalog.has(PDFName.of('OpenAction'))).toBe(false);
    expect(back.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.has(PDFName.of('JavaScript')) ?? false).toBe(false);
    expect(back.getPages()[0]!.node.has(PDFName.of('AA'))).toBe(false);
    for (const marker of ['/JavaScript', '/Launch', 'app.alert']) expect(stored.includes(Buffer.from(marker))).toBe(false);
    // The size and generation on the row follow the stripped copy, so the next read is not refused.
    expect(row.sizeBytes).toBe(stored.length);
    const download = await ctx.app.inject({ url: `/v1/files/${id}/download`, headers: auth() });
    expect(Buffer.from(download.rawPayload).equals(stored)).toBe(true);
    const [d] = await ctx.db.select().from(fileDerivatives).where(eq(fileDerivatives.attachmentId, id));
    expect(d!.sidecar['activeContentRemoved']).toEqual(expect.arrayContaining(['OpenAction', 'JavaScript', 'AA', 'A']));
  });

  it('leaves a PDF with nothing active as uploaded', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const original = Buffer.from(await doc.save());
    const id = await uploadChat('plain.pdf', 'application/pdf', original);
    const row = await fileOf(id);
    expect((await ctx.app.services.storage.get(row.storageKey)).equals(original)).toBe(true);
    expect(row.warnings.map((w) => w.code)).not.toContain('active_content_removed');
  });
});
