/**
 * tech-build.3 Part D: the fixes from the independent review of the file pipeline (ADR-0066).
 *
 * - D0a: a real password-protected .xlsx (msoffcrypto-tool, password "test") ends `encrypted`;
 * - D3 (N3): the move out of `uploading` and the job insert are one transaction, and a file
 *   orphaned in `queued` gets a job on its next poll;
 * - D4 (N4): `complete` never reads the object; the job computes the checksum, after checking
 *   the generation;
 * - D5 (N5): a text file that mentions `%PDF-` is text; a PDF with junk before its header is a PDF;
 * - D6 (M1): at most one large job per instance; working copies go under FILE_TMP_DIR;
 * - M3: a workbook that failed the pre-flight is never parsed by the preview.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attachments, fileJobs } from '../db/schema.js';
import type { FileStage } from '../services/attachments/pipeline.js';
import { generateStorageKey } from '../services/storage.js';
import { lyingZip } from '../test/fixtures/archives.js';
import { pdfWithPages } from '../test/fixtures/files.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp, sleep } from '../test/harness.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/ops/build-2-fixtures');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const holds = new Map<string, (stage: FileStage) => Promise<void>>();
let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({}, undefined, { fileWorker: { afterStage: async (id, stage) => holds.get(id)?.(stage) } });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

/** Uploads the bytes by the browser's path, without `complete`: the row stays `uploading`. */
async function sendBytes(c: TestContext, u: TestUser, filename: string, mimeType: string, bytes: Buffer): Promise<string> {
  const started = await c.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: { cookie: u.cookie }, payload: { filename, mimeType, sizeBytes: bytes.length } });
  expect(started.statusCode).toBe(201);
  const body = started.json() as { file: { id: string }; upload: { url: string } };
  const put = await c.app.inject({ method: 'PUT', url: `/v1${body.upload.url}`, headers: { cookie: u.cookie, 'content-type': 'application/octet-stream' }, payload: bytes });
  expect(put.statusCode).toBe(204);
  return body.file.id;
}

function complete(c: TestContext, u: TestUser, id: string) {
  return c.app.inject({ method: 'POST', url: `/v1/files/${id}/complete`, headers: { cookie: u.cookie } });
}

async function upload(filename: string, mimeType: string, bytes: Buffer): Promise<typeof attachments.$inferSelect> {
  const id = await sendBytes(ctx, user, filename, mimeType, bytes);
  expect((await complete(ctx, user, id)).statusCode).toBe(202);
  await ctx.app.services.files.idle();
  const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
  return row!;
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/* ------------------------------------------------------------------ D0a */

describe('a real password-protected workbook (D0a)', () => {
  it('ends `failed` with errorCode `encrypted`', async () => {
    const bytes = await readFile(path.join(FIXTURES, '11-encrypted-password-test.xlsx'));
    // The fixture is a genuine MS-OFFCRYPTO file: OLE2 magic, and an EncryptedPackage stream.
    expect(bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(true);
    expect(bytes.includes(Buffer.from('EncryptedPackage', 'utf16le'))).toBe(true);
    const row = await upload('budget-locked.xlsx', XLSX, bytes);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'encrypted' });
  });
});

/* ------------------------------------------------------------------ D3 */

describe('complete is atomic (D3, review N3)', () => {
  it('a failed enqueue leaves the file `uploading` with no job, and complete can be called again', async () => {
    const files = ctx.app.services.files;
    const real = files.enqueueAttachment.bind(files);
    // The failure comes after the job insert and the status move: only a rollback undoes them.
    const spy = vi.spyOn(files, 'enqueueAttachment').mockImplementationOnce(async (row, tx) => {
      await real(row, tx);
      throw new Error('injected enqueue failure');
    });
    try {
      const id = await sendBytes(ctx, user, 'atomic.txt', 'text/plain', Buffer.from('read me once the queue works'));
      const first = await complete(ctx, user, id);
      expect(first.statusCode).toBe(500);
      const [stuck] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
      expect(stuck!.status).toBe('uploading');
      expect(await ctx.db.select().from(fileJobs).where(eq(fileJobs.attachmentId, id))).toHaveLength(0);

      const second = await complete(ctx, user, id);
      expect(second.statusCode).toBe(202);
      await files.idle();
      const [done] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
      expect(done!.status).toBe('ready');
    } finally {
      spy.mockRestore();
    }
  });

  it('a file orphaned in `queued` past the grace period gets a job on its next poll; a fresh one does not', async () => {
    const make = async (ageMs: number) => {
      const storageKey = generateStorageKey(user.id);
      const bytes = Buffer.from(`orphaned bytes ${String(ageMs)}`);
      await ctx.app.services.storage.put(storageKey, bytes, 'text/plain');
      const [row] = await ctx.db
        .insert(attachments)
        .values({
          userId: user.id,
          filename: 'orphan.txt',
          mimeType: 'text/plain',
          sizeBytes: bytes.length,
          storageKey,
          status: 'queued',
          objectGeneration: (await ctx.app.services.storage.generation(storageKey)) ?? '',
          createdAt: new Date(Date.now() - ageMs),
        })
        .returning();
      return row!.id;
    };
    const old = await make(ctx.cfg.FILE_ORPHAN_GRACE_MS + 60_000);
    const fresh = await make(0);

    const polled = await ctx.app.inject({ url: `/v1/files/${old}`, headers: { cookie: user.cookie } });
    expect(polled.statusCode).toBe(200);
    await ctx.app.services.files.idle();
    expect(await ctx.db.select().from(fileJobs).where(eq(fileJobs.attachmentId, old))).toHaveLength(1);
    const [read] = await ctx.db.select().from(attachments).where(eq(attachments.id, old));
    expect(read!.status).toBe('ready');

    await ctx.app.inject({ url: `/v1/files/${fresh}`, headers: { cookie: user.cookie } });
    expect(await ctx.db.select().from(fileJobs).where(eq(fileJobs.attachmentId, fresh))).toHaveLength(0);

    // A second poll of the reconciled file queues nothing more.
    await ctx.app.inject({ url: `/v1/files/${old}`, headers: { cookie: user.cookie } });
    expect(await ctx.db.select().from(fileJobs).where(eq(fileJobs.attachmentId, old))).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ D4 */

describe('the checksum is the job’s, not the request’s (D4, review N4)', () => {
  it('complete never opens the object; the job puts the SHA-256 on the row', async () => {
    const files = ctx.app.services.files;
    const storage = ctx.app.services.storage;
    const bytes = Buffer.from('checksummed by the job, never by the request');
    const id = await sendBytes(ctx, user, 'sum.txt', 'text/plain', bytes);
    await files.stop(); // the job must not run inside the spy window
    const reads = [vi.spyOn(storage, 'openRead'), vi.spyOn(storage, 'get'), vi.spyOn(storage, 'downloadTo')];
    try {
      const done = await complete(ctx, user, id);
      expect(done.statusCode).toBe(202);
      for (const spy of reads) expect(spy).not.toHaveBeenCalled();
      const [queued] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
      expect(queued).toMatchObject({ status: 'queued', checksumSha256: '' });
      expect(queued!.objectGeneration).not.toBe('');
    } finally {
      for (const spy of reads) spy.mockRestore();
      files.start();
    }
    await files.idle();
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    expect(row).toMatchObject({ status: 'ready', checksumSha256: sha256(bytes) });
  });

  it('an object replaced between complete and the job fails `corrupt`, before any scan', async () => {
    const files = ctx.app.services.files;
    const id = await sendBytes(ctx, user, 'swap.txt', 'text/plain', Buffer.from('the bytes complete saw'));
    await files.stop();
    const stages: FileStage[] = [];
    holds.set(id, async (stage) => void stages.push(stage));
    try {
      expect((await complete(ctx, user, id)).statusCode).toBe(202);
      const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
      await sleep(20);
      await ctx.app.services.storage.put(row!.storageKey, Buffer.from('other bytes, same size!'), 'text/plain');
    } finally {
      files.start();
    }
    await files.idle();
    holds.delete(id);
    const [after] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    expect(after).toMatchObject({ status: 'failed', errorCode: 'corrupt', checksumSha256: '' });
    expect(after!.error).toContain('changed after it was uploaded');
    expect(stages).not.toContain('scanning');
  });
});

/* ------------------------------------------------------------------ D5 */

describe('%PDF- counts anywhere only for a declared PDF (D5, review N5)', () => {
  const mention = 'line 1\nline 2\nline 3\nline 4\nThe header %PDF-1.7 starts every PDF file.\nline 6\n';
  it.each([
    ['notes.md', 'text/markdown', `# Notes\n${mention}`],
    ['table.csv', 'text/csv', `name,value\n${mention.replace(/\n/g, ',x\n')}`],
    ['plain.txt', 'text/plain', mention],
  ])('%s that mentions %%PDF- at line 5 is read as text', async (name, mime, text) => {
    const row = await upload(name, mime, Buffer.from(text));
    expect(row).toMatchObject({ status: 'ready', errorCode: '' });
    expect(row.extractedText).toContain('%PDF-1.7');
  });

  it('a real PDF with junk before its header, declared .pdf, still reads', async () => {
    const pdf = await pdfWithPages(2, ['Junk before the header']);
    const row = await upload('junk.pdf', 'application/pdf', Buffer.concat([Buffer.from('JUNKJUNKJUNK\n'), pdf]));
    expect(row).toMatchObject({ status: 'ready', pageCount: 2 });
  });
});

/* ------------------------------------------------------------------ M3 (preview) */

describe('a workbook that failed the pre-flight is never parsed by the preview (M3)', () => {
  it('answers file_not_ready instead of opening it', async () => {
    const bomb = lyingZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') },
      { name: 'xl/media/blob.bin', data: Buffer.alloc(3 * 1024 * 1024), method: 8, declaredSize: 1024 },
    ]);
    const row = await upload('bomb.xlsx', XLSX, bomb);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'zip_ratio' });
    const preview = await ctx.app.inject({ url: `/v1/files/${row.id}/preview`, headers: { cookie: user.cookie } });
    expect(preview.json()).toMatchObject({ error: { code: 'file_not_ready' } });
  });
});

/* ------------------------------------------------------------------ D6 */

/**
 * Two files held at their first stage for a while: does the other one run meanwhile? `seen`
 * records, at each held stage, whether another of the pair was running.
 */
async function runPair(
  c: TestContext,
  u: TestUser,
  holdMap: Map<string, (s: FileStage) => Promise<void>>,
  file: { names: [string, string]; mime: string; bytes: Buffer } = { names: ['large-a.txt', 'large-b.txt'], mime: 'text/plain', bytes: Buffer.from('word '.repeat(600)) }, // 3,000 bytes
): Promise<{ overlap: boolean; ids: string[] }> {
  const ids = [await sendBytes(c, u, file.names[0], file.mime, file.bytes), await sendBytes(c, u, file.names[1], file.mime, file.bytes)];
  let overlap = false;
  for (const id of ids) {
    holdMap.set(id, async (stage) => {
      if (stage !== 'scanning') return;
      for (let i = 0; i < 8; i++) {
        const others = ids.filter((x) => x !== id);
        const running = await c.db.select().from(fileJobs).where(and(inArray(fileJobs.attachmentId, others), eq(fileJobs.state, 'running')));
        if (running.length > 0) overlap = true;
        await sleep(50);
      }
    });
  }
  for (const id of ids) expect((await complete(c, u, id)).statusCode).toBe(202);
  await c.app.services.files.idle();
  for (const id of ids) holdMap.delete(id);
  return { overlap, ids };
}

describe('at most one large job per instance (D6, review M1)', () => {
  let large: TestContext;
  let largeUser: TestUser;
  const largeHolds = new Map<string, (stage: FileStage) => Promise<void>>();
  beforeAll(async () => {
    large = await createTestApp({ FILE_LARGE_JOB_BYTES: '1000', FILE_WORKER_CONCURRENCY: '3' }, undefined, {
      fileWorker: { afterStage: async (id, stage) => largeHolds.get(id)?.(stage) },
    });
    largeUser = await signUp(large);
  });
  afterAll(async () => {
    await large.close();
  });

  it('two large jobs queued never run together, and both finish', async () => {
    const { overlap, ids } = await runPair(large, largeUser, largeHolds);
    expect(overlap).toBe(false);
    const rows = await large.db.select().from(attachments).where(inArray(attachments.id, ids));
    expect(rows.map((r) => r.status)).toEqual(['ready', 'ready']);
  });

  it('control: under the threshold the same pair does run together (the check can see overlap)', async () => {
    const { overlap } = await runPair(ctx, user, holds);
    expect(overlap).toBe(true);
  });
});

/* ------------------------------------------------------------------ review round 1 */

describe('the preview never parses a workbook the isolated parser could not read (review R3#3)', () => {
  it('a ready workbook with a not_extracted note answers preview_unsupported', async () => {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    wb.addWorksheet('Sheet1').addRow(['Rent', 25000]);
    const row = await upload('heavy.xlsx', XLSX, Buffer.from(await wb.xlsx.writeBuffer()));
    expect(row.status).toBe('ready');
    // Control: the same ready workbook previews while it carries no note.
    const before = await ctx.app.inject({ url: `/v1/files/${row.id}/preview`, headers: { cookie: user.cookie } });
    expect(before.statusCode).toBe(200);
    // The row exactly as readParsed leaves it when the child ran out of its heap
    // (ExtractionOutOfMemory → ready with `not_extracted`): a heap overflow is not reproducible
    // at test size, so the outcome is written as the pipeline writes it.
    const note = { code: 'not_extracted' as const, detail: 'This file is too large to read its text here. It is stored, and code can still open it.' };
    await ctx.db.update(attachments).set({ warnings: [note], error: note.detail, extractedText: null }).where(eq(attachments.id, row.id));
    const preview = await ctx.app.inject({ url: `/v1/files/${row.id}/preview`, headers: { cookie: user.cookie } });
    expect(preview.statusCode).toBe(422);
    expect(preview.json()).toMatchObject({ error: { code: 'preview_unsupported' } });
  });
});

/**
 * A ZIP's expansion is a large job only when what it unpacks to is (ADR-0070, superseding build-3
 * decision #10, review CR2-5): Stage 9 G30, "a small file never waits behind a large one".
 * FILE_LARGE_JOB_BYTES is 1,000 here; the large file (3,000 bytes) is held at its first stage
 * so it keeps the instance's large slot for the whole check.
 */
describe('a ZIP counts as a large job only when it unpacks past FILE_LARGE_JOB_BYTES (ADR-0070, CR2-5)', () => {
  let app: TestContext;
  let u: TestUser;
  const zipHolds = new Map<string, (stage: FileStage) => Promise<void>>();
  const enc = (s: string) => new TextEncoder().encode(s);
  beforeAll(async () => {
    app = await createTestApp({ FILE_LARGE_JOB_BYTES: '1000', FILE_WORKER_CONCURRENCY: '3' }, undefined, {
      fileWorker: { afterStage: async (id, stage) => zipHolds.get(id)?.(stage) },
    });
    u = await signUp(app);
  });
  afterAll(async () => {
    await app.close();
  });

  async function until(check: () => Promise<boolean>, ms: number): Promise<boolean> {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (await check()) return true;
      await sleep(25);
    }
    return check();
  }

  /** Starts a large file and holds it at `scanning` until `release` (or 10 s). */
  async function holdLargeJob(): Promise<{ id: string; release: () => void }> {
    const id = await sendBytes(app, u, 'large.txt', 'text/plain', Buffer.from('word '.repeat(600)));
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let held = false;
    zipHolds.set(id, async (stage) => {
      if (stage !== 'scanning') return;
      held = true;
      await Promise.race([released, sleep(10_000)]);
    });
    expect((await complete(app, u, id)).statusCode).toBe(202);
    expect(await until(async () => held, 5_000)).toBe(true);
    return { id, release };
  }

  const jobOf = async (attachmentId: string) => (await app.db.select().from(fileJobs).where(eq(fileJobs.attachmentId, attachmentId)))[0];
  const rowOf = async (id: string) => (await app.db.select().from(attachments).where(eq(attachments.id, id)))[0]!;

  it('a small ZIP is claimed and completes while a large job holds the slot', async () => {
    const { zipSync } = await import('fflate');
    const large = await holdLargeJob();
    try {
      const zip = Buffer.from(zipSync({ 'a.txt': enc('member a'), 'b.txt': enc('member b') }));
      expect(zip.length).toBeLessThan(1000);
      const zipId = await sendBytes(app, u, 'small.zip', 'application/zip', zip);
      expect((await complete(app, u, zipId)).statusCode).toBe(202);
      const readyWhileHeld = await until(async () => (await rowOf(zipId)).status === 'ready', 6_000);
      const largeStillRunning = (await jobOf(large.id))?.state === 'running';
      expect(readyWhileHeld).toBe(true);
      expect(largeStillRunning).toBe(true);
      expect((await jobOf(zipId))?.lane).toBe('fast');
    } finally {
      large.release();
      await app.app.services.files.idle();
    }
    expect((await rowOf(large.id)).status).toBe('ready');
  });

  it('a ZIP that unpacks past the limit waits for the slot: deferred, never concurrent, its attempt not burned', async () => {
    const { zipSync } = await import('fflate');
    const large = await holdLargeJob();
    let zipId = '';
    try {
      // 6,000 bytes unpacked, a few hundred stored: small by its own size, large by its members.
      const zip = Buffer.from(zipSync({ 'a.txt': enc('a'.repeat(6_000)) }));
      expect(zip.length).toBeLessThan(1000);
      zipId = await sendBytes(app, u, 'packed.zip', 'application/zip', zip);
      expect((await complete(app, u, zipId)).statusCode).toBe(202);
      // Claimed (it is small), then put back once its directory says it unpacks past the limit.
      expect(await until(async () => (await jobOf(zipId))?.lane === 'large', 6_000)).toBe(true);
      // While the large job runs, the ZIP stays queued: not re-claimed, no member written.
      await sleep(500);
      const waiting = await jobOf(zipId);
      expect(waiting).toMatchObject({ state: 'queued', lane: 'large', attempts: 0 });
      expect((await rowOf(zipId)).status).toBe('queued');
      expect(await app.db.select().from(attachments).where(eq(attachments.parentAttachmentId, zipId))).toHaveLength(0);
      expect((await jobOf(large.id))?.state).toBe('running');
    } finally {
      large.release();
      await app.app.services.files.idle();
    }
    // Once the slot is free it runs, on its first counted attempt.
    expect((await rowOf(zipId)).status).toBe('ready');
    expect(await jobOf(zipId)).toMatchObject({ state: 'done', lane: 'large', attempts: 1 });
    expect(await app.db.select().from(attachments).where(eq(attachments.parentAttachmentId, zipId))).toHaveLength(1);
  });
});

/**
 * A ZIP claimed in the fast lane by its stored size that turns out to unpack past
 * FILE_LARGE_JOB_BYTES leaves the slot kept for small files (Stage 9 G30, review build-3-fix r1):
 * it counts as normal work from then on, so the pump does not fill that slot with normal jobs.
 * Concurrency 3 (two normal slots, one fast); fast lane up to 500 bytes, large above 100,000.
 * Before the fix the ZIP still counted as fast, two normal jobs ran beside it, and the small file
 * waited behind the expansion.
 */
describe('a fast-lane ZIP that expands large gives up the fast slot (G30, build-3-fix r1)', () => {
  let app: TestContext;
  let u: TestUser;
  const holds = new Map<string, (stage: FileStage) => Promise<void>>();
  const enc = (s: string) => new TextEncoder().encode(s);
  beforeAll(async () => {
    app = await createTestApp({ FILE_LARGE_JOB_BYTES: '100000', FILE_FAST_LANE_MAX_BYTES: '500', FILE_WORKER_CONCURRENCY: '3' }, undefined, {
      fileWorker: { afterStage: async (id, stage) => holds.get(id)?.(stage) },
    });
    u = await signUp(app);
  });
  afterAll(async () => {
    await app.close();
  });

  async function until(check: () => Promise<boolean>, ms: number): Promise<boolean> {
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (await check()) return true;
      await sleep(25);
    }
    return check();
  }
  const rowOf = async (id: string) => (await app.db.select().from(attachments).where(eq(attachments.id, id)))[0]!;
  const jobOf = async (attachmentId: string) => (await app.db.select().from(fileJobs).where(eq(fileJobs.attachmentId, attachmentId)))[0];

  it('a small file still runs while the ZIP expands and a normal job runs', async () => {
    const { zipSync } = await import('fflate');
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const timeout = sleep(10_000);
    // Hold the ZIP inside its expansion, after it took the large slot: its member upload waits.
    const storage = app.app.services.storage;
    const putStream = storage.putStream.bind(storage);
    let expanding = false;
    const spy = vi.spyOn(storage, 'putStream').mockImplementation(async (...args: Parameters<typeof storage.putStream>) => {
      if (args[2] === 200_000) {
        expanding = true;
        await Promise.race([released, timeout]);
      }
      return putStream(...args);
    });
    const held: string[] = [];
    const holdAtScanning = (id: string) =>
      holds.set(id, async (stage) => {
        if (stage !== 'scanning') return;
        held.push(id);
        await Promise.race([released, timeout]);
      });
    try {
      const zip = Buffer.from(zipSync({ 'a.txt': enc('a'.repeat(200_000)) }, { level: 9 }));
      expect(zip.length).toBeLessThan(500);
      const zipId = await sendBytes(app, u, 'packed.zip', 'application/zip', zip);
      expect((await complete(app, u, zipId)).statusCode).toBe(202);
      expect(await until(async () => expanding, 6_000)).toBe(true);
      expect((await jobOf(zipId))?.lane).toBe('fast');

      // Two normal-lane files (above 500 bytes, below the large limit), each held at `scanning`.
      const n1 = await sendBytes(app, u, 'n1.txt', 'text/plain', Buffer.from('word '.repeat(200)));
      const n2 = await sendBytes(app, u, 'n2.txt', 'text/plain', Buffer.from('term '.repeat(200)));
      holdAtScanning(n1);
      holdAtScanning(n2);
      expect((await complete(app, u, n1)).statusCode).toBe(202);
      expect(await until(async () => held.includes(n1), 5_000)).toBe(true);
      expect((await complete(app, u, n2)).statusCode).toBe(202);
      // The ZIP now counts as normal work: the second normal file is not claimed, the fast slot
      // stays free. Judged after the small file (queued later) is read, so the pump has run.
      const small = await sendBytes(app, u, 'small.txt', 'text/plain', Buffer.from('tiny note'));
      expect((await complete(app, u, small)).statusCode).toBe(202);
      expect(await until(async () => (await rowOf(small)).status === 'ready', 6_000)).toBe(true);
      expect((await jobOf(n2))?.state).toBe('queued');
      expect(held).not.toContain(n2);
      expect(expanding && (await jobOf(zipId))?.state === 'running').toBe(true);
    } finally {
      release();
      await app.app.services.files.idle();
      spy.mockRestore();
    }
  });

  it('with every normal slot taken, a fast-lane ZIP that expands large waits instead: deferred, attempt given back', async () => {
    const { zipSync } = await import('fflate');
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const timeout = sleep(10_000);
    const held: string[] = [];
    const holdAtScanning = (id: string) =>
      holds.set(id, async (stage) => {
        if (stage !== 'scanning') return;
        held.push(id);
        await Promise.race([released, timeout]);
      });
    let zipId = '';
    try {
      // Both normal slots taken (concurrency 3 keeps one for the fast lane).
      const n1 = await sendBytes(app, u, 'm1.txt', 'text/plain', Buffer.from('word '.repeat(200)));
      const n2 = await sendBytes(app, u, 'm2.txt', 'text/plain', Buffer.from('term '.repeat(200)));
      holdAtScanning(n1);
      holdAtScanning(n2);
      expect((await complete(app, u, n1)).statusCode).toBe(202);
      expect((await complete(app, u, n2)).statusCode).toBe(202);
      expect(await until(async () => held.includes(n1) && held.includes(n2), 5_000)).toBe(true);

      const zip = Buffer.from(zipSync({ 'a.txt': enc('b'.repeat(200_000)) }, { level: 9 }));
      expect(zip.length).toBeLessThan(500);
      zipId = await sendBytes(app, u, 'later.zip', 'application/zip', zip);
      expect((await complete(app, u, zipId)).statusCode).toBe(202);
      // Claimed in the fast slot, then put back: it would take a normal slot that is not free.
      expect(await until(async () => (await jobOf(zipId))?.lane === 'large', 6_000)).toBe(true);
      expect(await jobOf(zipId)).toMatchObject({ state: 'queued', lane: 'large', attempts: 0 });
      expect(await app.db.select().from(attachments).where(eq(attachments.parentAttachmentId, zipId))).toHaveLength(0);
    } finally {
      release();
      await app.app.services.files.idle();
    }
    expect((await rowOf(zipId)).status).toBe('ready');
    expect(await jobOf(zipId)).toMatchObject({ state: 'done', lane: 'large', attempts: 1 });
  });
});

describe('the orphan reconcile does not bypass the attempt limit (review R3#5)', () => {
  it('a queued file whose only job runs on a lapsed lease with attempts spent gets no new job and fails `timeout`', async () => {
    const storageKey = generateStorageKey(user.id);
    const bytes = Buffer.from('spent all its attempts');
    await ctx.app.services.storage.put(storageKey, bytes, 'text/plain');
    const long = new Date(Date.now() - ctx.cfg.FILE_ORPHAN_GRACE_MS - 120_000);
    const [row] = await ctx.db
      .insert(attachments)
      .values({ userId: user.id, filename: 'spent.txt', mimeType: 'text/plain', sizeBytes: bytes.length, storageKey, status: 'queued', createdAt: long })
      .returning();
    await ctx.db.insert(fileJobs).values({
      userId: user.id,
      attachmentId: row!.id,
      kind: 'attachment',
      version: 1,
      lane: 'fast',
      state: 'running',
      attempts: 3,
      maxAttempts: 3,
      leaseOwner: 'dead-worker',
      leaseExpiresAt: long,
      updatedAt: long,
    });
    await ctx.app.inject({ url: `/v1/files/${row!.id}`, headers: { cookie: user.cookie } });
    await ctx.app.services.files.idle();
    const jobs = await ctx.db.select().from(fileJobs).where(eq(fileJobs.attachmentId, row!.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: 'failed', errorCode: 'timeout' });
    const [after] = await ctx.db.select().from(attachments).where(eq(attachments.id, row!.id));
    expect(after).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  });
});

describe('working copies go under FILE_TMP_DIR (D6, review M1)', () => {
  it('the job’s directory is made under the configured root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'arcnave-tmpdir-test-'));
    const seen: string[] = [];
    const work = path.join(root, 'work');
    const app = await createTestApp({ FILE_TMP_DIR: work }, undefined, {
      fileWorker: {
        afterStage: async (_id, stage) => {
          if (stage === 'scanning') seen.push(...(await readdir(work)));
        },
      },
    });
    try {
      const u = await signUp(app);
      const id = await sendBytes(app, u, 'where.txt', 'text/plain', Buffer.from('where do my copies live'));
      expect((await complete(app, u, id)).statusCode).toBe(202);
      await app.app.services.files.idle();
      expect(seen.some((n) => n.startsWith('arcnave-job-'))).toBe(true);
      // Removed when the job ends.
      expect((await readdir(work)).filter((n) => n.startsWith('arcnave-job-'))).toEqual([]);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
