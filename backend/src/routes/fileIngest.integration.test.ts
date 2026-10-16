/**
 * tech-build.2 Part 0: jobs that move without background CPU, and one ingest path.
 *
 * - a poll request advances a queued job with polling off (P06 gap a);
 * - a starved heartbeat does not hand a healthy job to a second worker, and a worker that did
 *   lose its job writes nothing (the run is idempotent per version);
 * - a project-file upload and a chat attachment of the same bytes produce the same derivative
 *   (P06 gap b, D1 #20).
 */
import { eq } from 'drizzle-orm';
import { Workbook } from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments, fileDerivativePages, fileDerivatives, fileJobs } from '../db/schema.js';
import { logger } from '../logger.js';
import { FileService } from '../services/attachments/fileJobs.js';
import type { FileStage } from '../services/attachments/pipeline.js';
import { docxWith } from '../test/fixtures/archives.js';
import { pdfWithPages } from '../test/fixtures/files.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, postProjectFile, signUp, sleep } from '../test/harness.js';

const holds = new Map<string, (stage: FileStage) => Promise<void>>();
let ctx: TestContext;
let user: TestUser;
const auth = (u = user) => ({ cookie: u.cookie });

beforeAll(async () => {
  ctx = await createTestApp({ FILE_POLL_HOLD_MS: '10000' }, undefined, {
    fileWorker: { afterStage: async (id, stage) => holds.get(id)?.(stage) },
  });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

/** Uploads the bytes by the browser's path, without `complete`: the row stays `uploading`. */
async function sendBytes(filename: string, mimeType: string, bytes: Buffer, u = user): Promise<string> {
  const started = await ctx.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: auth(u), payload: { filename, mimeType, sizeBytes: bytes.length } });
  expect(started.statusCode).toBe(201);
  const body = started.json() as { file: { id: string }; upload: { url: string } };
  const put = await ctx.app.inject({ method: 'PUT', url: `/v1${body.upload.url}`, headers: { ...auth(u), 'content-type': 'application/octet-stream' }, payload: bytes });
  expect(put.statusCode).toBe(204);
  return body.file.id;
}

async function uploadChat(filename: string, mimeType: string, bytes: Buffer, u = user): Promise<string> {
  const id = await sendBytes(filename, mimeType, bytes, u);
  const done = await ctx.app.inject({ method: 'POST', url: `/v1/files/${id}/complete`, headers: auth(u) });
  expect(done.statusCode).toBe(202);
  await ctx.app.services.files.idle();
  return id;
}

/* ------------------------------------------------------------------ Part 0a */

describe('a poll request moves a queued job (request-based CPU, ADR-0063)', () => {
  it('advances a job queued by another instance, with polling off, inside the poll request', async () => {
    const id = await sendBytes('polled.txt', 'text/plain', Buffer.from('read because someone asked'));
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    // Another instance queued it and then lost its CPU: its worker never runs (not started).
    const other = new FileService({ db: ctx.db, storage: ctx.app.services.storage, cfg: ctx.cfg, log: logger }, { pollMs: 0 });
    const jobId = await other.enqueueAttachment(row!);
    await sleep(300);
    const [waiting] = await ctx.db.select().from(fileJobs).where(eq(fileJobs.id, jobId));
    expect(waiting).toMatchObject({ state: 'queued', attempts: 0 });

    // The app's worker polls nothing (FILE_WORKER_POLL_MS=0): only the poll can move the job.
    const polled = await ctx.app.inject({ url: `/v1/files/${id}`, headers: auth() });
    expect(polled.statusCode).toBe(200);
    expect(polled.json()).not.toMatchObject({ status: 'queued' });
    const [taken] = await ctx.db.select().from(fileJobs).where(eq(fileJobs.id, jobId));
    expect(taken!.attempts).toBe(1);
    expect(taken!.leaseOwner === ctx.app.services.files.owner || taken!.state === 'done').toBe(true);

    await ctx.app.services.files.idle();
    const done = await ctx.app.inject({ url: `/v1/files/${id}`, headers: auth() });
    expect(done.json()).toMatchObject({ status: 'ready', hasText: true });
  });

  it('a settled file answers at once, without holding the request', async () => {
    const id = await uploadChat('settled.txt', 'text/plain', Buffer.from('already read'));
    const started = Date.now();
    const res = await ctx.app.inject({ url: `/v1/files/${id}`, headers: auth() });
    expect(res.json()).toMatchObject({ status: 'ready' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('the lease (ADR-0063)', () => {
  const deps = () => ({ db: ctx.db, storage: ctx.app.services.storage, cfg: ctx.cfg, log: logger });

  it('is renewed at every stage, so a job with a starved heartbeat is not taken by a second worker', async () => {
    const id = await sendBytes('starved.txt', 'text/plain', Buffer.from('the heartbeat never fires'));
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    // No heartbeat at all; each stage takes longer than half the lease, two stages longer than it.
    const a = new FileService(deps(), { leaseMs: 600, pollMs: 0, heartbeatMs: 0, afterStage: async () => sleep(400) });
    const b = new FileService(deps(), { leaseMs: 600, pollMs: 0 });
    a.start();
    const jobId = await a.enqueueAttachment(row!);
    for (let i = 0; i < 8; i++) {
      await sleep(100);
      expect(await b.runOnce([jobId])).toBe(false);
    }
    await a.idle();
    const [job] = await ctx.db.select().from(fileJobs).where(eq(fileJobs.id, jobId));
    expect(job).toMatchObject({ state: 'done', attempts: 1 });
    const [file] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    expect(file!.status).toBe('ready');
    await a.stop();
  });

  it('a worker that lost its job to another writes nothing: one result, one derivative', async () => {
    const id = await sendBytes('lost.txt', 'text/plain', Buffer.from('two workers, one answer'));
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atExtract = new Promise<void>((r) => (reached = r));
    const a = new FileService(deps(), {
      leaseMs: 300,
      pollMs: 0,
      heartbeatMs: 0,
      afterStage: async (_id, stage) => {
        if (stage === 'extracting') {
          reached();
          await held;
        }
      },
    });
    const b = new FileService(deps(), { leaseMs: 300, pollMs: 0 });
    a.start();
    const jobId = await a.enqueueAttachment(row!);
    await atExtract;
    await sleep(450);
    // A's lease lapsed (no heartbeat): B takes the job over and finishes it.
    expect(await b.runOnce([jobId])).toBe(true);
    const [afterB] = await ctx.db.select().from(fileJobs).where(eq(fileJobs.id, jobId));
    expect(afterB).toMatchObject({ state: 'done', attempts: 2 });
    // A wakes up and carries on; every write it would make is fenced off.
    release();
    await a.idle();
    const derivs = await ctx.db.select().from(fileDerivatives).where(eq(fileDerivatives.attachmentId, id));
    expect(derivs).toHaveLength(1);
    const [file] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    expect(file).toMatchObject({ status: 'ready', extractedText: 'two workers, one answer' });
    await a.stop();
  });
});

/* ------------------------------------------------------------------ Part 0b */

describe('one ingest path (D1 #20)', () => {
  it('a project-file upload and a chat attachment produce the same derivative', { timeout: 120_000 }, async () => {
    // Two users, so the second upload does not simply reuse the first one's derivative (G3).
    const chatUser = await signUp(ctx);
    const projectUser = await signUp(ctx);
    const project = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: auth(projectUser), payload: { title: 'parity' } });
    const projectId = (project.json() as { id: string }).id;
    const wb = new Workbook();
    wb.addWorksheet('Budget').addRow(['Item', 'Amount']);
    wb.getWorksheet('Budget')!.addRow(['Rent', 12000]);
    const fixtures: Array<[string, string, Buffer]> = [
      ['notes.txt', 'text/plain', Buffer.from('Notes\n\nThe meeting moved to Friday.')],
      ['table.csv', 'text/csv', Buffer.from('name,amount\nrent,12000\n')],
      ['report.pdf', 'application/pdf', await pdfWithPages(2, ['Revenue grew', 'Costs fell'])],
      ['budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await wb.xlsx.writeBuffer())],
      ['letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxWith('A Tamil letter: வணக்கம்')],
    ];
    for (const [name, mime, bytes] of fixtures) {
      const chatId = await uploadChat(name, mime, bytes, chatUser);
      const pf = await postProjectFile(ctx, auth(projectUser), projectId, multipart(name, bytes, mime));
      expect(pf.json()).toMatchObject({ status: 'ready' });
      const [c] = await ctx.db.select().from(fileDerivatives).where(eq(fileDerivatives.attachmentId, chatId));
      const [p] = await ctx.db.select().from(fileDerivatives).where(eq(fileDerivatives.projectFileId, String(pf.json()['id'])));
      expect(c, name).toBeDefined();
      expect(p, name).toBeDefined();
      const md = async (key: string | null) => (key ? (await ctx.app.services.storage.get(key)).toString('utf8') : '');
      expect(await md(p!.markdownKey), name).toBe(await md(c!.markdownKey));
      expect(p!.kind).toBe(c!.kind);
      expect(p!.extractorVersion).toBe(c!.extractorVersion);
      expect(p!.tokenCounts).toEqual(c!.tokenCounts);
      expect(p!.warnings).toEqual(c!.warnings);
      const pages = async (d: string) =>
        (await ctx.db.select().from(fileDerivativePages).where(eq(fileDerivativePages.derivativeId, d)).orderBy(fileDerivativePages.ordinal)).map((u) => ({ ...u, derivativeId: '' }));
      expect(await pages(p!.id), name).toEqual(await pages(c!.id));
    }
  });
});
