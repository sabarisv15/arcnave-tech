/**
 * P06 (NEW-PLAN, D1 F2): the file state machine, the job worker and its lease, intake (sniff,
 * macro / legacy, encrypted), per-type limits, the upload quota, and the parity between the
 * job path and the in-request path. Each `describe` is one exit test of tech-build.1 Part B.
 */
import { eq, sql } from 'drizzle-orm';
import { Workbook } from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments, fileChunks, fileJobs, projectFiles } from '../db/schema.js';
import { FileService } from '../services/attachments/fileJobs.js';
import type { FileStage } from '../services/attachments/pipeline.js';
import { INDEX_VERSION } from '../services/retrieval.js';
import { docxWith, encryptedOoxml, legacyOle2, lyingZip } from '../test/fixtures/archives.js';
import { pdfWithPages, png } from '../test/fixtures/files.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';
import { logger } from '../logger.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Stage hooks a test can hold a job at. */
const holds = new Map<string, (stage: FileStage) => Promise<void>>();

let ctx: TestContext;
let user: TestUser;
const auth = () => ({ cookie: user.cookie });

beforeAll(async () => {
  ctx = await createTestApp({}, undefined, {
    fileWorker: { afterStage: async (id, stage) => holds.get(id)?.(stage) ?? holds.get('*')?.(stage) },
  });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

/** The browser's path up to complete; returns the 202 body. */
async function startAndSend(filename: string, mimeType: string, bytes: Buffer, app = ctx) {
  const started = await app.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: auth(), payload: { filename, mimeType, sizeBytes: bytes.length } });
  expect(started.statusCode).toBe(201);
  const { file, upload } = started.json() as { file: { id: string }; upload: { url: string } };
  const put = await app.app.inject({
    method: 'PUT',
    url: `/v1${upload.url}`,
    headers: { ...auth(), 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  expect(put.statusCode).toBe(204);
  return file.id;
}

async function complete(id: string, app = ctx) {
  return app.app.inject({ method: 'POST', url: `/v1/files/${id}/complete`, headers: auth() });
}

async function read(id: string, app = ctx) {
  return (await app.app.inject({ url: `/v1/files/${id}`, headers: auth() })).json() as Record<string, any>;
}

async function uploadAndSettle(filename: string, mimeType: string, bytes: Buffer) {
  const id = await startAndSend(filename, mimeType, bytes);
  expect((await complete(id)).statusCode).toBe(202);
  await ctx.app.services.files.idle();
  return read(id);
}

/* ------------------------------------------------------------------ 202 + polling */

describe('upload → 202 → states seen by polling', () => {
  it('answers complete with 202 `queued`, and a poll sees each stage before `ready`', async () => {
    const id = await startAndSend('notes.txt', 'text/plain', Buffer.from('the budget is due friday'));
    const seen: string[] = [];
    let release: () => void = () => undefined;
    // At each stage the job waits until the test has polled once and seen that stage.
    holds.set(id, async (stage) => {
      await new Promise<void>((resolve) => {
        release = resolve;
        void read(id).then((dto) => {
          seen.push(String(dto['status']));
          expect(dto['status']).toBe(stage);
          release();
        });
      });
    });
    const res = await complete(id);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'queued', reading: 'none' });
    await ctx.app.services.files.idle();
    holds.delete(id);
    const done = await read(id);
    expect(seen).toEqual(['scanning', 'extracting']);
    expect(done).toMatchObject({ status: 'ready', hasText: true, errorCode: '' });
  });
});

describe('two `complete` calls at once', () => {
  it('queue one job; the other call answers with the row as it is', async () => {
    const id = await startAndSend('twice.txt', 'text/plain', Buffer.from('completed twice'));
    const [a, b] = await Promise.all([complete(id), complete(id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 202]);
    await ctx.app.services.files.idle();
    const jobs = await ctx.db.select().from(fileJobs).where(eq(fileJobs.attachmentId, id));
    expect(jobs).toHaveLength(1);
    expect(await read(id)).toMatchObject({ status: 'ready' });
  });
});

/* ------------------------------------------------------------------ lease */

describe('a worker killed mid-job', () => {
  it('leaves a job another worker resumes once the lease lapses', async () => {
    const deps = { db: ctx.db, storage: ctx.app.services.storage, cfg: ctx.cfg, log: logger };
    let reached!: () => void;
    const atExtract = new Promise<void>((r) => (reached = r));
    const a = new FileService(deps, {
      leaseMs: 300,
      pollMs: 0,
      // A holds the job at `extracting` forever: its process "dies" there.
      afterStage: async (_id, stage) => {
        if (stage === 'extracting') {
          reached();
          await new Promise(() => undefined);
        }
      },
    });
    const b = new FileService(deps, { leaseMs: 300, pollMs: 0 });

    const id = await startAndSend('resume.txt', 'text/plain', Buffer.from('resumed after a crash'));
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    await ctx.db.update(attachments).set({ status: 'queued' }).where(eq(attachments.id, id));
    a.start();
    const jobId = await a.enqueueAttachment(row!);
    await atExtract;
    a.crash();

    // Before the lease lapses nobody may take the job.
    expect(await b.runOnce([jobId])).toBe(false);
    await new Promise((r) => setTimeout(r, 450));
    expect(await b.runOnce([jobId])).toBe(true);

    expect(await read(id)).toMatchObject({ status: 'ready', hasText: true });
    const [job] = await ctx.db.select().from(fileJobs).where(eq(fileJobs.id, jobId));
    expect(job).toMatchObject({ state: 'done', attempts: 2 });
  });
});

/* ------------------------------------------------------------------ concurrency */

describe('uploads no longer serialise', () => {
  it('reads three files at the same time', async () => {
    const ids = await Promise.all(
      ['a', 'b', 'c'].map((n) => startAndSend(`${n}.txt`, 'text/plain', Buffer.from(`file ${n}`))),
    );
    // A barrier at `extracting`: it opens only when all three jobs are inside it at once. With
    // the old one-at-a-time queue the first would wait forever for the other two.
    let inside = 0;
    let open!: () => void;
    const all = new Promise<void>((r) => (open = r));
    for (const id of ids) {
      holds.set(id, async (stage) => {
        if (stage !== 'extracting') return;
        inside += 1;
        if (inside === 3) open();
        await Promise.race([all, new Promise((_, reject) => setTimeout(() => reject(new Error('serialised')), 5000))]);
      });
    }
    await Promise.all(ids.map((id) => complete(id)));
    await ctx.app.services.files.idle();
    for (const id of ids) holds.delete(id);
    for (const id of ids) expect(await read(id)).toMatchObject({ status: 'ready' });
    expect(inside).toBe(3);
  });
});

/* ------------------------------------------------------------------ intake */

describe('intake refuses what the locked rules refuse', () => {
  it('refuses .docm before any byte is sent, with the save-as text', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: auth(), payload: { filename: 'budget.docm', mimeType: '', sizeBytes: 100 } });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ error: { code: 'unsupported_media_type', detail: 'This .docm file contains macros. Save it as DOCX and upload it again.' } });
  });

  it('refuses a macro document renamed .docx, by its content, with the save-as text', async () => {
    const { zipSync } = await import('fflate');
    const macro = Buffer.from(
      zipSync({
        '[Content_Types].xml': new TextEncoder().encode('<Types/>'),
        'word/document.xml': new TextEncoder().encode('<w:document/>'),
        'word/vbaProject.bin': new Uint8Array([1, 2, 3]),
      }),
    );
    const dto = await uploadAndSettle('budget.docx', DOCX, macro);
    expect(dto).toMatchObject({ status: 'failed', errorCode: 'unsupported_type' });
    expect(dto['error']).toContain('Save it as DOCX');
  });

  it('refuses a true OLE2 .xls with the save-as text, and still reads an HTML table named .xls', async () => {
    const legacy = await uploadAndSettle('old.xls', 'application/vnd.ms-excel', legacyOle2());
    expect(legacy).toMatchObject({ status: 'failed', errorCode: 'unsupported_type' });
    expect(legacy['error']).toBe('This .xls file is in an old Office format. Save it as XLSX and upload it again.');

    const html = await uploadAndSettle('portal.xls', 'application/vnd.ms-excel', Buffer.from('<table><tr><td>Seats</td><td>120</td></tr></table>'));
    expect(html).toMatchObject({ status: 'ready', hasText: true });
  });

  it('fails a password-protected XLSX as `encrypted`', async () => {
    const dto = await uploadAndSettle('locked.xlsx', XLSX, encryptedOoxml());
    expect(dto).toMatchObject({ status: 'failed', errorCode: 'encrypted' });
    expect(dto['error']).toContain('Remove the password');
  });

  it('refuses a decompression-bomb DOCX in pre-flight', async () => {
    const bomb = lyingZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.alloc(4096, 0x41), declaredSize: 1024 * 1024 * 1024 },
    ]);
    const dto = await uploadAndSettle('bomb.docx', DOCX, bomb);
    expect(dto).toMatchObject({ status: 'failed', errorCode: 'zip_ratio' });
  });

  it('fails a file whose content does not match its name', async () => {
    const dto = await uploadAndSettle('report.pdf', 'application/pdf', Buffer.from('MZ\u0000\u0000 not a pdf'));
    expect(dto).toMatchObject({ status: 'failed', errorCode: 'unsupported_type' });
  });
});

/* ------------------------------------------------------------------ limits */

describe('per-type limits (N-10) are enforced when an upload starts', () => {
  const start = (filename: string, mimeType: string, sizeBytes: number) =>
    ctx.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: auth(), payload: { filename, mimeType, sizeBytes } });

  it('documents 100 MB, spreadsheets 50 MB, images 20 MB, ZIP 100 MB, audio 500 MB', async () => {
    const MB = 1024 * 1024;
    expect((await start('a.pdf', 'application/pdf', 100 * MB + 1)).statusCode).toBe(413);
    expect((await start('a.pdf', 'application/pdf', 100 * MB)).statusCode).toBe(201);
    expect((await start('a.xlsx', XLSX, 50 * MB + 1)).statusCode).toBe(413);
    expect((await start('a.png', 'image/png', 20 * MB + 1)).statusCode).toBe(413);
    expect((await start('a.png', 'image/png', 20 * MB)).statusCode).toBe(201);
    expect((await start('a.zip', 'application/zip', 100 * MB + 1)).statusCode).toBe(413);
    expect((await start('a.mp3', 'audio/mpeg', 400 * MB)).statusCode).toBe(201);
    const refused = await start('a.xlsx', XLSX, 50 * MB + 1);
    expect((refused.json() as { error: { detail: string } }).error.detail).toContain('50 MB');
  });
});

describe('the per-user upload quota (N-11)', () => {
  it('refuses the upload past the day’s limit with upload_quota_exceeded, before a storage URL', async () => {
    const small = await createTestApp({ UPLOADS_PER_USER_PER_DAY: '2' });
    try {
      const owner = await signUp(small);
      const start = () =>
        small.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: { cookie: owner.cookie }, payload: { filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 3 } });
      expect((await start()).statusCode).toBe(201);
      expect((await start()).statusCode).toBe(201);
      const third = await start();
      expect(third.statusCode).toBe(429);
      expect(third.json()).toMatchObject({ error: { code: 'upload_quota_exceeded', meta: { fileErrorCode: 'quota' } } });
      expect(third.json()).not.toHaveProperty('upload');
    } finally {
      await small.close();
    }
  });
});

/* ------------------------------------------------------------------ retry */

describe('Retry', () => {
  it('reads a failed file again as a new job version', async () => {
    const id = await startAndSend('again.txt', 'text/plain', Buffer.from('second time lucky'));
    await ctx.db.update(attachments).set({ status: 'failed', errorCode: 'timeout' }).where(eq(attachments.id, id));
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/files/${id}/retry`, headers: auth() });
    expect(res.statusCode).toBe(202);
    await ctx.app.services.files.idle();
    expect(await read(id)).toMatchObject({ status: 'ready', errorCode: '' });
  });

  it('refuses to retry a file that did not fail', async () => {
    const dto = await uploadAndSettle('fine.txt', 'text/plain', Buffer.from('fine'));
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/files/${String(dto['id'])}/retry`, headers: auth() });
    expect(res.statusCode).toBe(409);
  });
});

/* ------------------------------------------------------------------ parity */

describe('parity: the job path and the in-request path read every file the same', () => {
  it('gives the same status, code, text and page count for each fixture', async () => {
    const sync = await createTestApp({ FILE_PIPELINE: 'sync' });
    try {
      const owner = await signUp(sync);
      const wb = new Workbook();
      wb.addWorksheet('Sheet1').addRow(['Widgets', 42]);
      const fixtures: Array<[string, string, Buffer]> = [
        ['notes.txt', 'text/plain', Buffer.from('plain words')],
        ['table.csv', 'text/csv', Buffer.from('a,b\n1,2\n')],
        ['readme.md', 'text/markdown', Buffer.from('# Title\n\nbody')],
        ['two.pdf', 'application/pdf', await pdfWithPages(2, ['page one', 'page two'])],
        ['blank.pdf', 'application/pdf', await pdfWithPages(1)],
        ['book.xlsx', XLSX, Buffer.from(await wb.xlsx.writeBuffer())],
        ['letter.docx', DOCX, docxWith('A Tamil letter: வணக்கம்')],
        ['pic.png', 'image/png', png(4, 4)],
        ['wide.png', 'image/png', png(8001, 1)],
        ['locked.xlsx', XLSX, encryptedOoxml()],
        ['many.pdf', 'application/pdf', await pdfWithPages(1001)],
      ];
      for (const [name, mime, bytes] of fixtures) {
        // Jobs path (this file's app).
        const viaJob = await uploadAndSettle(name, mime, bytes);
        // In-request path.
        const started = await sync.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: { cookie: owner.cookie }, payload: { filename: name, mimeType: mime, sizeBytes: bytes.length } });
        const { file, upload } = started.json() as { file: { id: string }; upload: { url: string } };
        await sync.app.inject({ method: 'PUT', url: `/v1${upload.url}`, headers: { cookie: owner.cookie, 'content-type': 'application/octet-stream' }, payload: bytes });
        const done = await sync.app.inject({ method: 'POST', url: `/v1/files/${file.id}/complete`, headers: { cookie: owner.cookie } });
        expect(done.statusCode).toBe(200);
        const viaSync = done.json() as Record<string, unknown>;

        const pick = (d: Record<string, unknown>) => ({
          status: d['status'],
          errorCode: d['errorCode'],
          error: d['error'],
          hasText: d['hasText'],
          pageCount: d['pageCount'],
          reading: d['reading'],
        });
        expect(pick(viaSync), name).toEqual(pick(viaJob));
        const [a] = await ctx.db.select({ t: attachments.extractedText }).from(attachments).where(eq(attachments.id, String(viaJob['id'])));
        const [b] = await sync.db.select({ t: attachments.extractedText }).from(attachments).where(eq(attachments.id, file.id));
        expect(b!.t, name).toBe(a!.t);
      }
    } finally {
      await sync.close();
    }
  });
});

/* ------------------------------------------------------------------ re-index backfill */

describe('project files indexed before the Unicode tokenizer are re-indexed', () => {
  it('a `reindex` job rebuilds an old file’s chunks as NFC and stamps the version', async () => {
    const project = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: auth(), payload: { title: 'old index' } });
    const projectId = (project.json() as { id: string }).id;
    // An NFD Tamil text, stored as the old indexer stored it: version 1, text as extracted.
    const nfd = 'கொ'.normalize('NFD') + 'ண்டு வருவாய்';
    const storageKey = (await import('../services/storage.js')).generateStorageKey(user.id);
    await ctx.app.services.storage.put(storageKey, Buffer.from(nfd), 'text/plain');
    const [pf] = await ctx.db
      .insert(projectFiles)
      .values({ projectId, userId: user.id, filename: 'old.txt', mimeType: 'text/plain', sizeBytes: Buffer.byteLength(nfd), storageKey, status: 'ready', chunkCount: 1 })
      .returning();
    await ctx.db.insert(fileChunks).values({ projectFileId: pf!.id, projectId, ordinal: 0, text: nfd, charCount: nfd.length });

    const worker = new FileService({ db: ctx.db, storage: ctx.app.services.storage, cfg: ctx.cfg, log: logger }, { pollMs: 0 });
    const queued = await worker.enqueueStaleIndexes();
    const mine = (await ctx.db.select({ id: fileJobs.id }).from(fileJobs).where(eq(fileJobs.projectFileId, pf!.id))).map((j) => j.id);
    expect(queued).toEqual(expect.arrayContaining(mine));
    expect(await worker.runOnce(mine)).toBe(true);

    const [after] = await ctx.db.select().from(projectFiles).where(eq(projectFiles.id, pf!.id));
    expect(after!.indexVersion).toBe(INDEX_VERSION);
    const chunks = await ctx.db.select().from(fileChunks).where(eq(fileChunks.projectFileId, pf!.id));
    expect(chunks.map((c) => c.text)).toEqual([nfd.normalize('NFC')]);
    // Enqueueing again is a no-op: one job per file and version.
    await worker.enqueueStaleIndexes();
    const rows = (await ctx.db.execute(sql`select count(*)::int as n from file_jobs where project_file_id = ${pf!.id}`)) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
  });
});
