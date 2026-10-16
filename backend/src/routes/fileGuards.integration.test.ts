/**
 * P01 (NEW-PLAN, D1 F1): the file-pipeline guards that stop content being lost or corrupted.
 * Each `describe` is one exit test of task tech-build.1 Part A.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { attachments, projectFiles } from '../db/schema.js';
import { clearPdfPageCache, pdfForModel } from '../services/attachments/pdfPages.js';
import { tokenize } from '../services/retrieval.js';
import { docxWith } from '../test/fixtures/archives.js';
import { pdfWithPages } from '../test/fixtures/files.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, postProjectFile, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;
const auth = () => ({ cookie: user.cookie });

beforeAll(async () => {
  // Project files above the 400-chunk mark need a few MB in one request.
  ctx = await createTestApp({ MAX_UPLOAD_BYTES: String(8 * 1024 * 1024) });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

async function newProject(): Promise<string> {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: auth(), payload: { title: 'P01' } });
  return (res.json() as { id: string }).id;
}

async function projectUpload(projectId: string, filename: string, content: Buffer | string, mime = 'text/plain') {
  const part = multipart(filename, content, mime);
  const res = await postProjectFile(ctx, auth(), projectId, part);
  return { statusCode: res.statusCode, body: res.json() as Record<string, any> };
}

async function chatUpload(filename: string, content: Buffer | string, mime = 'text/plain') {
  const part = multipart(filename, content, mime);
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...auth() }, payload: part.payload });
  return res.json() as Record<string, any>;
}

async function newChat(projectId?: string): Promise<string> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers: auth(),
    payload: { title: 'files', ...(projectId ? { projectId } : {}) },
  });
  return (res.json() as { id: string }).id;
}

const generate = (chatId: string, attachmentIds: string[], prompt = 'read it') =>
  ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: auth(), payload: { prompt, attachmentIds } });

/* ------------------------------------------------------------------ Unicode search (D1 #12a) */

describe('project search finds Tamil and Hindi (LANG-1: Unicode tokens, NFC)', () => {
  it('finds a Tamil chunk and a Hindi chunk by a word in each', async () => {
    const projectId = await newProject();
    const tamil = 'இந்த அறிக்கை வருவாய் பற்றியது. மொத்த வருவாய் பன்னிரண்டு லட்சம்.';
    const hindi = 'यह रिपोर्ट राजस्व के बारे में है। कुल राजस्व बारह लाख है।';
    expect((await projectUpload(projectId, 'tamil.txt', tamil)).body).toMatchObject({ status: 'ready' });
    expect((await projectUpload(projectId, 'hindi.txt', hindi)).body).toMatchObject({ status: 'ready' });

    const search = async (q: string) =>
      (await ctx.app.inject({ url: `/v1/projects/${projectId}/search?q=${encodeURIComponent(q)}`, headers: auth() })).json() as {
        items: Array<{ filename: string }>;
      };
    expect((await search('வருவாய்')).items.map((i) => i.filename)).toEqual(['tamil.txt']);
    expect((await search('राजस्व')).items.map((i) => i.filename)).toEqual(['hindi.txt']);
  });

  it('keeps combining marks inside a word and treats NFC and NFD forms as one token', () => {
    // "क़" written precomposed and decomposed is the same word to the user.
    expect(tokenize('क़लम')).toEqual(tokenize('क़लम'));
    expect(tokenize('வணக்கம் உலகம்')).toEqual(['வணக்கம்', 'உலகம்']);
  });
});

/* ------------------------------------------------------------------ chunk cap (D1 #12b, E4) */

describe('the chunk cap is ~2,000 and never silent (E4)', () => {
  // Each paragraph is longer than one ~800-token chunk (ADR-0063), so it is one chunk of its own.
  const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${String(i)} ${'word '.repeat(700)}`).join('\n\n');

  it('indexes a file past the old 400-chunk cap whole, with no warning', async () => {
    const projectId = await newProject();
    const { body } = await projectUpload(projectId, 'long.txt', paragraphs(450));
    expect(body.status).toBe('ready');
    expect(body.chunkCount).toBeGreaterThan(400);
    expect(body.warnings).toEqual([]);
  });

  it('reports a visible `chunk_cap` warning on a file over the cap', async () => {
    const projectId = await newProject();
    const { body } = await projectUpload(projectId, 'huge.txt', paragraphs(2100));
    expect(body.status).toBe('ready');
    expect(body.chunkCount).toBe(2000);
    expect(body.warnings).toEqual([expect.objectContaining({ code: 'chunk_cap' })]);
    expect(body.warnings[0].detail).toContain('2,000');
  });
});

/* ------------------------------------------------------------------ claim guard (D1 #18) */

describe('an attachment is claimed once (message_id IS NULL)', () => {
  it('refuses to claim a file already in a sent message with 409 file_already_attached', async () => {
    const file = await chatUpload('once.txt', 'claimed once');
    const chatA = await newChat();
    expect((await generate(chatA, [file.id])).statusCode).toBe(200);

    const chatB = await newChat();
    const again = await generate(chatB, [file.id]);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'file_already_attached' } });
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, file.id));
    // Still in the first message, not moved.
    expect(row!.messageId).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ project delete (D1 #17) */

describe('deleting a project file keeps bytes a chat still reads', () => {
  it('leaves a picked, sent attachment readable in the sandbox workspace', async () => {
    const projectId = await newProject();
    const { body: pf } = await projectUpload(projectId, 'notes.txt', 'picked into a chat');
    const picked = await ctx.app.inject({ method: 'POST', url: '/v1/files/from-project', headers: auth(), payload: { projectFileId: pf.id } });
    const att = picked.json() as { id: string };
    expect((await generate(await newChat(), [att.id])).statusCode).toBe(200);

    const del = await ctx.app.inject({ method: 'DELETE', url: `/v1/projects/${projectId}/files/${pf.id}`, headers: auth() });
    expect(del.statusCode).toBe(204);

    // What the sandbox does with a conversation file: place it in input/ from storage.
    const runtime = ctx.app.services.executionRuntime;
    const workspace = await runtime.createWorkspace(`p01-${att.id}`);
    try {
      const placed = await runtime.materializeAttachment(workspace, att.id, user.id, ctx.db, ctx.app.services.storage);
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(placed.path, 'utf8')).toBe('picked into a chat');
    } finally {
      await runtime.cleanupWorkspace(workspace);
    }
  });
});

/* ------------------------------------------------------------------ picked file (D1 #19) */

describe('a picked project file carries its text, page count and status', () => {
  it('sends a picked project DOCX to a no-sandbox turn as text', async () => {
    const projectId = await newProject();
    const { body: pf } = await projectUpload(
      projectId,
      'letter.docx',
      docxWith('Quarterly revenue was PICKEDMARKER9931 lakh.'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(pf.status).toBe('ready');
    const picked = await ctx.app.inject({ method: 'POST', url: '/v1/files/from-project', headers: auth(), payload: { projectFileId: pf.id } });
    expect(picked.statusCode).toBe(201);
    expect(picked.json()).toMatchObject({ status: 'ready', hasText: true, reading: 'text' });

    // The default test app has no sandbox, so the turn must carry the text itself.
    expect((await generate(await newChat(), [(picked.json() as { id: string }).id])).statusCode).toBe(200);
    const sent = ctx.provider.seen.at(-1)!.attachments!.find((a) => a.filename === 'letter.docx');
    expect(sent?.extractedText).toContain('PICKEDMARKER9931');
  });

  it('counts a picked PDF’s pages', async () => {
    const projectId = await newProject();
    const { body: pf } = await projectUpload(projectId, 'two.pdf', await pdfWithPages(2, ['one', 'two']), 'application/pdf');
    const picked = await ctx.app.inject({ method: 'POST', url: '/v1/files/from-project', headers: auth(), payload: { projectFileId: pf.id } });
    expect(picked.json()).toMatchObject({ pageCount: 2, reading: 'text+visual' });
  });

  it('refuses to pick a project file that is still indexing, with file_not_ready', async () => {
    const projectId = await newProject();
    const { body: pf } = await projectUpload(projectId, 'later.txt', 'not yet');
    await ctx.db.update(projectFiles).set({ status: 'indexing' }).where(eq(projectFiles.id, pf.id));
    const picked = await ctx.app.inject({ method: 'POST', url: '/v1/files/from-project', headers: auth(), payload: { projectFileId: pf.id } });
    expect(picked.statusCode).toBe(409);
    expect(picked.json()).toMatchObject({ error: { code: 'file_not_ready' } });
  });
});

/* ------------------------------------------------------------------ send gate (D1 #2) */

describe('generate refuses a file that is not ready (409 file_not_ready)', () => {
  it('refuses a failed file', async () => {
    const file = await chatUpload('broken.pdf', await pdfWithPages(1), 'application/pdf');
    await ctx.db.update(attachments).set({ status: 'failed', errorCode: 'corrupt' }).where(eq(attachments.id, file.id));
    const res = await generate(await newChat(), [file.id]);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'file_not_ready', meta: { files: [{ id: file.id, status: 'failed' }] } } });
  });

  it('refuses a file still being read', async () => {
    const file = await chatUpload('slow.txt', 'still reading');
    await ctx.db.update(attachments).set({ status: 'extracting' }).where(eq(attachments.id, file.id));
    const res = await generate(await newChat(), [file.id]);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'file_not_ready' } });
  });
});

/* ------------------------------------------------------------------ corrupt PDF (D1 #34) */

describe('a corrupt PDF in history reaches the model as `unreadable`', () => {
  it('is unreadable with a reason, not "storage unavailable", on a later turn', async () => {
    const file = await chatUpload('statement.pdf', await pdfWithPages(1, ['Opening balance']), 'application/pdf');
    expect(file.status).toBe('ready');
    const chatId = await newChat();
    expect((await generate(chatId, [file.id])).statusCode).toBe(200);

    // The stored bytes go bad after the first turn.
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, file.id));
    await ctx.app.services.storage.put(row!.storageKey, Buffer.from('%PDF-1.7 this is not a pdf'), 'application/pdf');
    clearPdfPageCache();

    expect((await generate(chatId, [], 'and now?')).statusCode).toBe(200);
    const request = ctx.provider.seen.at(-1)!;
    const inHistory = request.history.flatMap((t) => t.attachments ?? []).find((a) => a.id === file.id);
    expect(inHistory).toMatchObject({ omittedReason: 'unreadable' });
  });

  it('reports a pdftotext failure as unreadable (the page count read, the text did not)', async () => {
    // A pdftotext that always fails, ahead of the real one on PATH.
    const bin = await mkdtemp(path.join(os.tmpdir(), 'arcnave-fakebin-'));
    const fake = path.join(bin, 'pdftotext');
    await writeFile(fake, '#!/bin/sh\necho "Syntax Error: broken xref" >&2\nexit 1\n');
    await chmod(fake, 0o755);
    const original = process.env.PATH;
    process.env.PATH = `${bin}:${original ?? ''}`;
    try {
      clearPdfPageCache();
      const out = await pdfForModel(await pdfWithPages(1, ['x']));
      expect(out).toMatchObject({ kind: 'unreadable', reason: expect.stringContaining('broken xref') });
    } finally {
      process.env.PATH = original;
      await rm(bin, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ error codes (D1 #23) */

describe('failures carry an ER-9 code and our own copy', () => {
  it('a damaged DOCX is `corrupt` with no parser message in what the user sees', async () => {
    const body = await chatUpload(
      'bad.docx',
      docxWith('x').subarray(0, 60),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(body.status).toBe('failed');
    expect(body.errorCode).toBe('corrupt');
    expect(body.error).not.toMatch(/Error|undefined|at /);
  });
});
