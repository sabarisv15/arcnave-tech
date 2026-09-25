/**
 * Message attachments: extraction, claiming, deletion, and cleanup.
 *
 * An attachment is uploaded before the message that carries it exists, so the interesting
 * states are "uploaded but unclaimed" and "claimed by a sent message" — the first is garbage
 * to collect, the second must not be deletable.
 */
import { Workbook } from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { attachments } from '../db/schema.js';
import { buildAnthropicMessages } from '../providers/anthropicVertex.js';
import { buildGeminiContents } from '../providers/gemini.js';
import { ProviderError } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { png, pdfWithPages } from '../test/fixtures/files.js';
import { createTestApp, multipart, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const auth = (): { cookie: string } => ({ cookie: user.cookie });

async function upload(
  filename: string,
  content: Buffer | string,
  contentType = 'text/plain',
  headers = auth(),
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const part = multipart(filename, content, contentType);
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: { ...part.headers, ...headers },
    payload: part.payload,
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

/* -------------------------------------------------------------------------- upload */

describe('upload and extraction', () => {
  it('extracts text and says the file has some', async () => {
    const { statusCode, body } = await upload('notes.txt', 'the budget is due friday');
    expect(statusCode).toBe(201);
    expect(body).toMatchObject({
      status: 'ready',
      hasText: true,
      error: '',
      messageId: null,
      filename: 'notes.txt',
    });
  });

  it('marks an image as viewable rather than running text extraction on it', async () => {
    const { statusCode, body } = await upload('pic.png', png(4, 4), 'image/png');

    expect(statusCode).toBe(201);
    expect(body).toMatchObject({ status: 'ready', hasText: false, viewable: true, error: '' });
  });

  it('marks a plain text file as not viewable', async () => {
    const { body } = await upload('notes.txt', 'the budget is due friday');
    expect(body).toMatchObject({ viewable: false, hasText: true });
  });

  it('accepts and extracts a real .xlsx workbook even when the browser sends octet-stream', async () => {
    // The most common real-world case: many browsers don't have the Office Open XML MIME type
    // registered and send application/octet-stream instead, indistinguishable at that point
    // from any other unknown binary — only the .xlsx extension says what this actually is.
    const workbook = new Workbook();
    workbook.addWorksheet('Sheet1').addRow(['Widgets', 42]);
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());

    const { statusCode, body } = await upload('report.xlsx', xlsx, 'application/octet-stream');

    expect(statusCode).toBe(201);
    expect(body).toMatchObject({ status: 'ready', hasText: true, viewable: false });
  });

  it('refuses a file type the workspace does not accept', async () => {
    const { statusCode, body } = await upload('setup.exe', 'MZ', 'application/octet-stream');
    expect(statusCode).toBe(415);
    expect(body).toMatchObject({ error: { code: 'unsupported_media_type' } });
  });

  it('refuses a file larger than the configured ceiling', async () => {
    const tooBig = Buffer.alloc(ctx.cfg.MAX_UPLOAD_BYTES + 1024, 0x61);
    const { statusCode } = await upload('huge.txt', tooBig);
    expect(statusCode).toBe(413);
  });

  it('keeps the whole text of a long file; the model context window, not upload, limits it', async () => {
    const { body } = await upload('long.txt', 'x'.repeat(250_000) + 'END-MARKER');
    expect(body).toMatchObject({ status: 'ready', hasText: true, error: '' });
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, String(body['id'])));
    expect(row!.extractedText).toHaveLength(250_010);
    expect(row!.extractedText!.endsWith('END-MARKER')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- download */

describe('download', () => {
  it('serves as an attachment with nosniff, never inline', async () => {
    const { body } = await upload('page.html', '<script>alert(1)</script>', 'text/html');
    const response = await ctx.app.inject({
      url: `/v1/files/${String(body['id'])}/download`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe('attachment; filename="page.html"');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sanitises a filename that tries to escape the download directory', async () => {
    const { body } = await upload('../../etc/passwd.txt', 'root:x:0:0');
    const response = await ctx.app.inject({
      url: `/v1/files/${String(body['id'])}/download`,
      headers: auth(),
    });

    const disposition = String(response.headers['content-disposition']);
    expect(disposition).not.toContain('..');
    expect(disposition).not.toContain('/');
  });
});

/* -------------------------------------------------------------------------- claiming */

describe('claiming by a message', () => {
  it('attaches to the message it was sent with, and its text reaches the provider', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const { body } = await upload('notes.txt', 'the western route has shade', 'text/plain', headers);
    const attachmentId = String(body['id']);

    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers,
      payload: { title: 'with a file' },
    });
    const chatId = (chat.json() as { id: string }).id;

    const stream = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers,
      payload: { prompt: 'summarise the file', attachmentIds: [attachmentId] },
    });
    expect(parseSse(stream.body).at(-1)!.event).toBe('done');

    // The extracted text was actually put in front of the model, not merely stored: each
    // adapter renders it from the attachment, exactly once (G16).
    const seen = ctx.provider.seen.at(-1)!;
    for (const wire of [JSON.stringify(buildAnthropicMessages(seen)), JSON.stringify(buildGeminiContents(seen))]) {
      expect(wire.split('western route has shade').length - 1).toBe(1);
    }

    // And the row now belongs to the user turn.
    const read = await ctx.app.inject({ url: `/v1/files/${attachmentId}`, headers });
    expect((read.json() as { messageId: string | null }).messageId).not.toBeNull();
  });

  it('refuses to delete a file that is already part of a sent message', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const { body } = await upload('notes.txt', 'some content', 'text/plain', headers);
    const attachmentId = String(body['id']);

    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers,
      payload: { title: 'sent' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${(chat.json() as { id: string }).id}/generate`,
      headers,
      payload: { prompt: 'go', attachmentIds: [attachmentId] },
    });

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/files/${attachmentId}`,
      headers,
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json()).toMatchObject({ error: { code: 'conflict' } });
  });

  it('cannot claim another users upload', async () => {
    const victim = await signUp(ctx);
    const { body } = await upload('secret.txt', 'private notes', 'text/plain', {
      cookie: victim.cookie,
    });

    const attacker = await signUp(ctx);
    const headers = { cookie: attacker.cookie };
    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers,
      payload: { title: 'theft' },
    });

    await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${(chat.json() as { id: string }).id}/generate`,
      headers,
      payload: { prompt: 'read it', attachmentIds: [String(body['id'])] },
    });

    const seen = ctx.provider.seen.at(-1)!;
    expect(`${seen.prompt}\n${seen.systemInstruction}`).not.toContain('private notes');

    // The victim's row is untouched.
    const still = await ctx.app.inject({
      url: `/v1/files/${String(body['id'])}`,
      headers: { cookie: victim.cookie },
    });
    expect((still.json() as { messageId: string | null }).messageId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- lifecycle */

describe('deletion and cleanup', () => {
  it('deletes an unclaimed upload', async () => {
    const { body } = await upload('throwaway.txt', 'changed my mind');
    const id = String(body['id']);

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/files/${id}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);
    expect((await ctx.app.inject({ url: `/v1/files/${id}`, headers: auth() })).statusCode).toBe(404);
  });

  it('collects only stale unclaimed uploads, and only the callers own', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const stale = await upload('old.txt', 'old', 'text/plain', headers);
    const recent = await upload('new.txt', 'new', 'text/plain', headers);

    // Age one row past the cutoff without waiting a day for it.
    await ctx.db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 48 * 3600_000) })
      .where(eq(attachments.id, String(stale.body['id'])));

    const bystander = await signUp(ctx);
    const theirs = await upload('theirs.txt', 'theirs', 'text/plain', { cookie: bystander.cookie });
    await ctx.db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 48 * 3600_000) })
      .where(eq(attachments.id, String(theirs.body['id'])));

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/cleanup',
      headers,
      payload: { olderThanHours: 24 },
    });

    expect(response.json()).toEqual({ deleted: 1 });
    expect(
      (await ctx.app.inject({ url: `/v1/files/${String(recent.body['id'])}`, headers })).statusCode,
    ).toBe(200);
    // Another user's stale upload is not this caller's to collect.
    expect(
      (
        await ctx.app.inject({
          url: `/v1/files/${String(theirs.body['id'])}`,
          headers: { cookie: bystander.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
});

/* -------------------------------------------------------------------------- isolation */

describe('isolation', () => {
  it('hides another users attachment behind a 404', async () => {
    const { body } = await upload('private.txt', 'secrets');
    const intruder = await signUp(ctx);
    const headers = { cookie: intruder.cookie };

    for (const attempt of [
      { method: 'GET' as const, url: `/v1/files/${String(body['id'])}` },
      { method: 'GET' as const, url: `/v1/files/${String(body['id'])}/download` },
      { method: 'DELETE' as const, url: `/v1/files/${String(body['id'])}` },
    ]) {
      expect((await ctx.app.inject({ ...attempt, headers })).statusCode, attempt.url).toBe(404);
    }
  });

  it('requires a session', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/files' })).statusCode).toBe(401);
  });
});

/* -------------------------------------------------------------------------- from project */

describe('picking a file from a project', () => {
  async function createProjectWithFile(): Promise<{ projectId: string; projectFileId: string }> {
    const projectRes = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: auth(),
      payload: { title: 'Multimodal test project' },
    });
    expect(projectRes.statusCode).toBe(201);
    const projectId = (projectRes.json() as { id: string }).id;

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 5),
    ]);
    const part = multipart('scan.png', png, 'image/png');
    const fileRes = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/files`,
      headers: { ...part.headers, ...auth() },
      payload: part.payload,
    });
    expect(fileRes.statusCode).toBe(201);
    return { projectId, projectFileId: (fileRes.json() as { id: string }).id };
  }

  it('attaches an existing project file without re-uploading its bytes', async () => {
    const { projectFileId } = await createProjectWithFile();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/from-project',
      headers: auth(),
      payload: { projectFileId },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      filename: 'scan.png',
      mimeType: 'image/png',
      viewable: true,
      messageId: null,
    });
  });

  it('refuses a project file owned by someone else', async () => {
    const { projectFileId } = await createProjectWithFile();
    const other = await signUp(ctx);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/from-project',
      headers: { cookie: other.cookie },
      payload: { projectFileId },
    });

    expect(response.statusCode).toBe(404);
  });

  it('deleting an attachment sourced from a project file does not delete the project file', async () => {
    const { projectId, projectFileId } = await createProjectWithFile();

    const picked = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/from-project',
      headers: auth(),
      payload: { projectFileId },
    });
    const attachmentId = (picked.json() as { id: string }).id;

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/files/${attachmentId}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);

    // The project file itself, and its stored bytes, must still be there.
    const stillThere = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/files/${projectFileId}/download`,
      headers: auth(),
    });
    expect(stillThere.statusCode).toBe(200);
  });
});

/* -------------------------------------------------------------------------- direct upload */

describe('direct upload (the path the browser uses, for files up to 500 MB)', () => {
  async function begin(filename: string, mimeType: string, sizeBytes: number, headers = auth()) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/uploads',
      headers,
      payload: { filename, mimeType, sizeBytes },
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, any> };
  }

  async function put(url: string, bytes: Buffer, headers = auth()) {
    return ctx.app.inject({
      method: 'PUT',
      url: `/v1${url}`,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
  }

  const complete = (id: string, headers = auth()) =>
    ctx.app.inject({ method: 'POST', url: `/v1/files/${id}/complete`, headers });

  async function uploadDirect(filename: string, mimeType: string, bytes: Buffer, headers = auth()) {
    const started = await begin(filename, mimeType, bytes.length, headers);
    expect(started.statusCode).toBe(201);
    expect((await put(started.body.upload.url, bytes, headers)).statusCode).toBe(204);
    return complete(started.body.file.id, headers);
  }

  it('accepts a file above the one-request limit and reads it on complete', async () => {
    // MAX_UPLOAD_BYTES is 2 MB in the test app; the direct path is bounded by ATTACHMENT_MAX_BYTES.
    const text = Buffer.from('total 4521\n'.repeat(300_000));
    const started = await begin('big.txt', 'text/plain', text.length);
    expect(started.statusCode).toBe(201);
    expect(started.body.file).toMatchObject({ status: 'uploading', reading: 'none' });
    expect(started.body.upload).toMatchObject({ method: 'PUT', withCredentials: true });

    expect((await put(started.body.upload.url, text)).statusCode).toBe(204);
    const done = await complete(started.body.file.id);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ status: 'ready', hasText: true, reading: 'text', sizeBytes: text.length });
  });

  it('reports PDF pages and reads a PDF of up to 100 pages as text and page images', async () => {
    const done = await uploadDirect('statement.pdf', 'application/pdf', await pdfWithPages(2, ['Opening balance 100']));
    expect(done.json()).toMatchObject({ status: 'ready', pageCount: 2, reading: 'text+visual', hasText: true });
  });

  it('refuses a file over 500 MB before any byte is sent', async () => {
    const started = await begin('huge.pdf', 'application/pdf', 500 * 1024 * 1024 + 1);
    expect(started.statusCode).toBe(413);
    expect(started.body.error.code).toBe('payload_too_large');
  });

  it('accepts the ODT, RTF and EPUB files Claude accepts', async () => {
    for (const [filename, mimeType] of [
      ['a.odt', 'application/vnd.oasis.opendocument.text'],
      ['a.rtf', 'application/rtf'],
      ['a.epub', 'application/epub+zip'],
    ] as const) {
      expect((await begin(filename, mimeType, 10)).statusCode).toBe(201);
    }
  });

  it('removes a PDF over 1,000 pages and says why', async () => {
    const done = await uploadDirect('huge.pdf', 'application/pdf', await pdfWithPages(1001));
    expect(done.statusCode).toBe(413);
    expect(done.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    expect((done.json() as { error: { detail: string } }).error.detail).toContain('1,001 pages');
  });

  it('removes an image over 8000 pixels and says why', async () => {
    const done = await uploadDirect('wide.png', 'image/png', png(8001, 1));
    expect(done.statusCode).toBe(413);
    expect((done.json() as { error: { detail: string } }).error.detail).toContain('8001×1');
  });

  it('refuses to finish an upload whose bytes did not all arrive', async () => {
    const started = await begin('short.txt', 'text/plain', 100);
    expect((await put(started.body.upload.url, Buffer.from('only forty bytes arrived here..........'))).statusCode).toBe(409);
    const read = await ctx.app.inject({ url: `/v1/files/${started.body.file.id}`, headers: auth() });
    expect(read.statusCode).toBe(404);
  });

  it('refuses to complete before the bytes are sent', async () => {
    const started = await begin('never.txt', 'text/plain', 10);
    const done = await complete(started.body.file.id);
    expect(done.statusCode).toBe(409);
    expect(done.json()).toMatchObject({ error: { code: 'upload_incomplete' } });
  });

  it('will not send a message with a file that is still uploading', async () => {
    const started = await begin('pending.txt', 'text/plain', 10);
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth(), payload: { title: 'pending' } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${(chat.json() as { id: string }).id}/generate`,
      headers: auth(),
      payload: { prompt: 'read it', attachmentIds: [started.body.file.id] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'upload_incomplete' } });
  });

  it("does not let another user send bytes into someone else's upload", async () => {
    const started = await begin('mine.txt', 'text/plain', 5);
    const other = await signUp(ctx);
    expect((await put(started.body.upload.url, Buffer.from('hello'), { cookie: other.cookie })).statusCode).toBe(404);
  });

  it('holds a chat to 20 files', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers, payload: { title: 'many' } });
    const chatId = (chat.json() as { id: string }).id;
    const send = async (count: number) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const { body } = await upload(`f${String(i)}.txt`, `file ${String(i)}`, 'text/plain', headers);
        ids.push(String(body['id']));
      }
      return ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers,
        payload: { prompt: 'files', attachmentIds: ids },
      });
    };
    expect((await send(10)).statusCode).toBe(200);
    expect((await send(10)).statusCode).toBe(200);
    const over = await send(1);
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ error: { code: 'too_many_files' } });
  });
});

/* -------------------------------------------------------------------------- PDFs at send time */

describe('a PDF sent to a model (ADR-0013: page images and text, as in Claude)', () => {
  async function send(pdf: Buffer): Promise<ReturnType<typeof ctx.provider.seen.at>> {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const part = multipart('statement.pdf', pdf, 'application/pdf');
    const up = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...headers }, payload: part.payload });
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers, payload: { title: 'pdf' } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${(chat.json() as { id: string }).id}/generate`,
      headers,
      payload: { prompt: 'read it', attachmentIds: [(up.json() as { id: string }).id] },
    });
    expect(parseSse(res.body).at(-1)!.event).toBe('done');
    return ctx.provider.seen.at(-1);
  }

  it('sends each page as an image with its text, to Gemini and Claude alike, and never the PDF', async () => {
    const seen = (await send(await pdfWithPages(2, ['Opening balance 100', 'Closing 250'])))!;
    const pdf = seen.attachments!.find((a) => a.mimeType === 'application/pdf')!;
    expect(pdf.base64).toBeUndefined();
    expect(pdf.pages).toHaveLength(2);

    for (const wire of [JSON.stringify(buildGeminiContents(seen)), JSON.stringify(buildAnthropicMessages(seen))]) {
      expect(wire).toContain('image/jpeg');
      expect(wire).not.toContain('"application/pdf"');
      expect(wire).toContain('Text of page 1:\\nOpening balance 100');
      expect(wire).toContain('\\"statement.pdf\\" page 2 of 2');
    }
  });

  it('sends a PDF over 100 pages as text only, and says so', async () => {
    const seen = (await send(await pdfWithPages(101, ['Intro words'])))!;
    for (const wire of [JSON.stringify(buildGeminiContents(seen)), JSON.stringify(buildAnthropicMessages(seen))]) {
      expect(wire).not.toContain('image/jpeg');
      expect(wire).toContain('PDFs over 100 pages are read as text only');
      expect(wire).toContain('Intro words');
    }
  });

  it('when the context overflows, retries once without earlier page images, keeping their text', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const part = multipart('statement.pdf', await pdfWithPages(2, ['Opening balance 100', 'Closing 250']), 'application/pdf');
    const up = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...headers }, payload: part.payload });
    const chatId = ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers, payload: { title: 'pdf' } })).json() as { id: string }).id;
    const turn = (payload: object) => ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers, payload });
    expect(parseSse((await turn({ prompt: 'read it', attachmentIds: [(up.json() as { id: string }).id] })).body).at(-1)!.event).toBe('done');

    const before = ctx.provider.seen.length;
    let calls = 0;
    ctx.provider.onRequest = async () => {
      if (++calls === 1) throw new ProviderError('input token count exceeds the maximum', { code: 'context_overflow' });
    };
    try {
      expect(parseSse((await turn({ prompt: 'what was the closing balance?' })).body).at(-1)!.event).toBe('done');
    } finally {
      ctx.provider.onRequest = null;
    }

    const [first, retry] = ctx.provider.seen.slice(before);
    const pdfIn = (req: typeof first) => req!.history.flatMap((t) => t.attachments ?? []).find((a) => a.mimeType === 'application/pdf');
    expect(pdfIn(first)?.pages).toHaveLength(2);
    expect(pdfIn(retry)?.pages).toBeUndefined();
    expect(pdfIn(retry)?.extractedText).toContain('Closing 250');
  });
});
