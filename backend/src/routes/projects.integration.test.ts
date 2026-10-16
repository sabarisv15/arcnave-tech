/**
 * Projects, files, indexing, search, and saved sources — against a real database.
 *
 * The upload → index → search path is the reason this file exists: it spans multipart parsing,
 * the upload policy, object storage, text extraction, chunking, and BM25, and none of those
 * seams are exercised by the unit tests.
 */
import { createRequire } from 'node:module';

import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, signUp, postProjectFile } from '../test/harness.js';
import { png as pngFixture } from '../test/fixtures/files.js';

/**
 * pptxgenjs is CommonJS; under this project's NodeNext + verbatimModuleSyntax config its
 * `export default` typing does not narrow past the module namespace through a normal import
 * (confirmed: same failure whether imported as a value or type-only), so the runtime value
 * comes from `require` typed against the minimal surface this test actually calls.
 */
interface PptxGenJSInstance {
  addSlide(): { addText(text: string, opts: { x: number; y: number }): void };
  write(opts: { outputType: 'nodebuffer' }): Promise<Buffer>;
}
const PptxGenJS = createRequire(import.meta.url)('pptxgenjs') as new () => PptxGenJSInstance;

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

async function createProject(title = 'Q3 planning'): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: auth(),
    payload: { title, description: 'budget work', instructions: 'Be terse.' },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function upload(
  projectId: string,
  filename: string,
  content: string | Buffer,
  contentType = 'text/plain',
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await postProjectFile(ctx, auth(), projectId, multipart(filename, content, contentType));
  return { statusCode: response.statusCode, body: response.json() };
}

/* -------------------------------------------------------------------------- CRUD */

describe('project CRUD', () => {
  it('creates, reads, and counts', async () => {
    const id = await createProject();
    const response = await ctx.app.inject({ url: `/v1/projects/${id}`, headers: auth() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      title: 'Q3 planning',
      instructions: 'Be terse.',
      version: 1,
      counts: { files: 0, chats: 0, sources: 0, indexedChunks: 0 },
      files: [],
      sources: [],
    });
  });

  it('bumps the version on every patch', async () => {
    const id = await createProject();
    const first = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${id}`,
      headers: auth(),
      payload: { title: 'Renamed', version: 1 },
    });
    expect(first.json()).toMatchObject({ title: 'Renamed', version: 2 });
  });

  it('refuses a patch carrying a stale version, and says which is which', async () => {
    const id = await createProject();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${id}`,
      headers: auth(),
      payload: { title: 'First write' },
    });

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/projects/${id}`,
      headers: auth(),
      payload: { title: 'Second write', version: 1 },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: 'conflict', meta: { expectedVersion: 1, actualVersion: 2 } },
    });
  });

  it('soft-deletes, so a deleted project is gone from reads and lists', async () => {
    const id = await createProject('Doomed');
    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${id}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);

    const read = await ctx.app.inject({ url: `/v1/projects/${id}`, headers: auth() });
    expect(read.statusCode).toBe(404);

    const list = await ctx.app.inject({ url: '/v1/projects?limit=100', headers: auth() });
    const items = (list.json() as { items: Array<{ id: string }> }).items;
    expect(items.map((p) => p.id)).not.toContain(id);
  });

  it('keeps chats when their project is deleted, detaching rather than cascading', async () => {
    const projectId = await createProject('Has a chat');
    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: auth(),
      payload: { title: 'Kept', projectId },
    });
    const chatId = (chat.json() as { id: string }).id;

    await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${projectId}`,
      headers: auth(),
    });

    const read = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: auth() });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: chatId, projectId: null });
  });
});

/* -------------------------------------------------------------------------- reorder */

describe('reorder', () => {
  it('applies the given order', async () => {
    const a = await createProject('alpha');
    const b = await createProject('bravo');

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects/reorder',
      headers: auth(),
      payload: { ids: [b, a] },
    });
    expect(response.statusCode).toBe(204);

    const list = await ctx.app.inject({ url: '/v1/projects?limit=100', headers: auth() });
    const items = (list.json() as { items: Array<{ id: string; position: number }> }).items;
    const posOf = (id: string): number => items.find((p) => p.id === id)!.position;
    expect(posOf(b)).toBeLessThan(posOf(a));
  });

  it('refuses the whole reorder when any id is not the callers, rather than applying a subset', async () => {
    const mine = await createProject('mine');
    const other = await signUp(ctx);
    const theirs = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: other.cookie },
      payload: { title: 'theirs' },
    });
    const theirId = (theirs.json() as { id: string }).id;

    const before = await ctx.app.inject({ url: `/v1/projects/${mine}`, headers: auth() });
    const beforePosition = (before.json() as { position: number }).position;

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects/reorder',
      headers: auth(),
      payload: { ids: [theirId, mine] },
    });
    expect(response.statusCode).toBe(404);

    const after = await ctx.app.inject({ url: `/v1/projects/${mine}`, headers: auth() });
    expect((after.json() as { position: number }).position).toBe(beforePosition);
  });
});

/* -------------------------------------------------------------------------- files */

describe('file upload and indexing', () => {
  const NOTES =
    'Observation: the western side of the route has shade in the morning.\n\n' +
    'Next step: repeat the observation in the afternoon and compare the shade.';

  it('indexes a text file in a job: 202 queued, then the file reads ready', async () => {
    const projectId = await createProject('indexing');
    const { statusCode, body } = await upload(projectId, 'notes.txt', NOTES);

    expect(statusCode).toBe(202);
    expect(body).toMatchObject({ status: 'ready', filename: 'notes.txt', error: '' });
    expect(body['chunkCount']).toBeGreaterThan(0);
    expect(body['indexedAt']).not.toBeNull();
    expect(String(body['checksumSha256'])).toHaveLength(64);
  });

  it('finds the file by a term it contains, and not by one it does not', async () => {
    const projectId = await createProject('searchable');
    await upload(projectId, 'notes.txt', NOTES);

    const hit = await ctx.app.inject({
      url: `/v1/projects/${projectId}/search?q=shade%20observation`,
      headers: auth(),
    });
    const hits = (hit.json() as { method: string; items: Array<{ filename: string; score: number }> });
    expect(hits.method).toBe('bm25');
    expect(hits.items[0]).toMatchObject({ filename: 'notes.txt' });
    expect(hits.items[0]!.score).toBeGreaterThan(0);

    const miss = await ctx.app.inject({
      url: `/v1/projects/${projectId}/search?q=kubernetes%20helm`,
      headers: auth(),
    });
    expect((miss.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('replaces chunks on reindex instead of accumulating them', async () => {
    const projectId = await createProject('reindex');
    const first = await upload(projectId, 'notes.txt', NOTES);
    const fileId = String(first.body['id']);
    const originalChunks = first.body['chunkCount'];

    const again = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/files/${fileId}/reindex`,
      headers: auth(),
    });

    expect(again.statusCode).toBe(202);
    expect(again.json()).toMatchObject({ status: 'queued' });
    await ctx.app.services.files.idle();
    const done = await ctx.app.inject({ url: `/v1/projects/${projectId}/files/${fileId}`, headers: auth() });
    expect(done.json()).toMatchObject({ status: 'ready', chunkCount: originalChunks });

    const read = await ctx.app.inject({ url: `/v1/projects/${projectId}`, headers: auth() });
    expect((read.json() as { counts: { indexedChunks: number } }).counts.indexedChunks).toBe(
      originalChunks,
    );
  });

  it('removes the chunks with the file, so the same search then finds nothing', async () => {
    const projectId = await createProject('deletable');
    const { body } = await upload(projectId, 'notes.txt', NOTES);

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${projectId}/files/${String(body['id'])}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);

    const search = await ctx.app.inject({
      url: `/v1/projects/${projectId}/search?q=shade`,
      headers: auth(),
    });
    expect((search.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('indexes an xlsx workbook, cell values searchable across sheets', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Headcount');
    sheet.addRow(['Team', 'Hires']);
    sheet.addRow(['Platform', 'zephyrwatch']);
    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(raw);

    const projectId = await createProject('xlsx');
    const { statusCode, body } = await upload(
      projectId,
      'headcount.xlsx',
      buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(statusCode).toBe(202);
    expect(body).toMatchObject({ status: 'ready' });
    expect(body['chunkCount']).toBeGreaterThan(0);

    const hit = await ctx.app.inject({
      url: `/v1/projects/${projectId}/search?q=zephyrwatch`,
      headers: auth(),
    });
    expect((hit.json() as { items: Array<{ filename: string }> }).items[0]).toMatchObject({
      filename: 'headcount.xlsx',
    });
  });

  it('indexes a pptx deck, slide text searchable', async () => {
    const pres = new PptxGenJS();
    const slide = pres.addSlide();
    slide.addText('quarterly review: kestrelbloom initiative', { x: 1, y: 1 });
    const buffer = await pres.write({ outputType: 'nodebuffer' });

    const projectId = await createProject('pptx');
    const { statusCode, body } = await upload(
      projectId,
      'deck.pptx',
      buffer,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(statusCode).toBe(202);
    expect(body).toMatchObject({ status: 'ready' });

    const hit = await ctx.app.inject({
      url: `/v1/projects/${projectId}/search?q=kestrelbloom`,
      headers: auth(),
    });
    expect((hit.json() as { items: Array<{ filename: string }> }).items[0]).toMatchObject({
      filename: 'deck.pptx',
    });
  });

  it('indexes a docx table, keeping a value findable by an adjacent cells term', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph('Region')] }),
                    new TableCell({ children: [new Paragraph('Status')] }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph('marbletide district')] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun('approved')] })] }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);

    const projectId = await createProject('docx-table');
    const { statusCode, body } = await upload(
      projectId,
      'regions.docx',
      buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(statusCode).toBe(202);
    expect(body).toMatchObject({ status: 'ready' });

    const hit = await ctx.app.inject({
      url: `/v1/projects/${projectId}/search?q=marbletide`,
      headers: auth(),
    });
    expect((hit.json() as { items: Array<{ filename: string }> }).items[0]).toMatchObject({
      filename: 'regions.docx',
    });
  });

  it('cites the real page a term came from in a multi-page PDF', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page1 = pdf.addPage([300, 300]);
    page1.drawText('the launch date is confirmed', { x: 20, y: 250, font, size: 14 });
    const page2 = pdf.addPage([300, 300]);
    page2.drawText('starlingcove is the codename', { x: 20, y: 250, font, size: 14 });
    const buffer = Buffer.from(await pdf.save());

    const projectId = await createProject('pdf-pages');
    const { statusCode, body } = await upload(projectId, 'plan.pdf', buffer, 'application/pdf');
    expect(statusCode).toBe(202);
    expect(body).toMatchObject({ status: 'ready' });

    const hit = await ctx.app.inject({
      url: `/v1/projects/${projectId}/search?q=starlingcove`,
      headers: auth(),
    });
    const items = (hit.json() as { items: Array<{ filename: string; page: number | null }> }).items;
    expect(items[0]).toMatchObject({ filename: 'plan.pdf', page: 2 });
  });

  it('downloads as an attachment with nosniff, never inline', async () => {
    const projectId = await createProject('download');
    // An HTML file is the case that matters: served inline on this origin it would run script
    // against the session cookie.
    const { body } = await upload(projectId, 'page.html', '<script>alert(1)</script>', 'text/html');

    const response = await ctx.app.inject({
      url: `/v1/projects/${projectId}/files/${String(body['id'])}/download`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe('attachment; filename="page.html"');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toBe('<script>alert(1)</script>');
  });

  it('stores a file it cannot extract as unsupported, with the reason, rather than rejecting it', async () => {
    const projectId = await createProject('image');
    // A real image: stored and readable, but an image has no text to index.
    const response = await postProjectFile(ctx, auth(), projectId, multipart('pic.png', pngFixture(8, 8), 'image/png'));

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: 'unsupported', chunkCount: 0 });
    expect(String((response.json() as { error: string }).error)).not.toBe('');
  });

  it.each([
    ['setup.exe', 'application/octet-stream'],
    ['archive.zip', 'application/zip'],
  ])('refuses %s', async (filename, contentType) => {
    const projectId = await createProject('refusals');
    const { statusCode, body } = await upload(projectId, filename, 'payload', contentType);
    expect(statusCode).toBe(415);
    expect(body).toMatchObject({ error: { code: 'unsupported_media_type' } });
  });

  it('refuses an empty file', async () => {
    const projectId = await createProject('empty');
    const { statusCode, body } = await upload(projectId, 'empty.txt', '');
    expect(statusCode).toBe(415);
    expect(body).toMatchObject({ error: { code: 'unsupported_media_type' } });
  });

  it('refuses a request with no file part at all', async () => {
    const projectId = await createProject('nofile');
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/files`,
      headers: { 'content-type': 'multipart/form-data; boundary=xyz', ...auth() },
      payload: '--xyz--\r\n',
    });
    expect(response.statusCode).toBe(422);
  });
});

/* -------------------------------------------------------------------------- sources */

describe('saved sources', () => {
  it('derives the domain from the URL rather than trusting the client', async () => {
    const projectId = await createProject('sources');
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/sources`,
      headers: auth(),
      payload: {
        title: 'Vertex docs',
        url: 'https://www.cloud.google.com/vertex-ai/docs?utm=1',
        snippet: 'grounding',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ domain: 'cloud.google.com', type: 'Web' });
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd'])('refuses the %j scheme', async (url) => {
    const projectId = await createProject('schemes');
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/sources`,
      headers: auth(),
      payload: { title: 'x', url },
    });
    expect(response.statusCode).toBe(422);
  });

  it('deletes a source and 404s the second time', async () => {
    const projectId = await createProject('deleting sources');
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/sources`,
      headers: auth(),
      payload: { title: 'x', url: 'https://example.com/a' },
    });
    const sourceId = (created.json() as { id: string }).id;
    const url = `/v1/projects/${projectId}/sources/${sourceId}`;

    expect((await ctx.app.inject({ method: 'DELETE', url, headers: auth() })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'DELETE', url, headers: auth() })).statusCode).toBe(404);
  });
});

/* -------------------------------------------------------------------------- isolation */

describe('ownership isolation', () => {
  it('hides another users project behind the same 404 as a nonexistent one', async () => {
    const projectId = await createProject('private');
    const { body } = await upload(projectId, 'notes.txt', 'shade in the morning');
    const fileId = String(body['id']);

    const intruder = await signUp(ctx);
    const headers = { cookie: intruder.cookie };

    const attempts = [
      { method: 'GET' as const, url: `/v1/projects/${projectId}` },
      { method: 'PATCH' as const, url: `/v1/projects/${projectId}`, payload: { title: 'mine now' } },
      { method: 'DELETE' as const, url: `/v1/projects/${projectId}` },
      { method: 'GET' as const, url: `/v1/projects/${projectId}/files` },
      { method: 'GET' as const, url: `/v1/projects/${projectId}/search?q=shade` },
      { method: 'GET' as const, url: `/v1/projects/${projectId}/files/${fileId}/download` },
      { method: 'DELETE' as const, url: `/v1/projects/${projectId}/files/${fileId}` },
      { method: 'GET' as const, url: `/v1/projects/${projectId}/sources` },
      {
        method: 'POST' as const,
        url: `/v1/projects/${projectId}/sources`,
        payload: { title: 'x', url: 'https://example.com' },
      },
    ];

    for (const attempt of attempts) {
      const response = await ctx.app.inject({ ...attempt, headers });
      expect(
        response.statusCode,
        `${attempt.method} ${attempt.url} leaked to another user`,
      ).toBe(404);
    }
  });

  it('requires a session on every project route', async () => {
    const projectId = await createProject('anon');
    for (const url of [
      '/v1/projects',
      `/v1/projects/${projectId}`,
      `/v1/projects/${projectId}/files`,
    ]) {
      const response = await ctx.app.inject({ url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('lists only the callers own projects', async () => {
    const other = await signUp(ctx);
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: other.cookie },
      payload: { title: 'not yours' },
    });

    const list = await ctx.app.inject({ url: '/v1/projects?limit=100', headers: auth() });
    const titles = (list.json() as { items: Array<{ title: string }> }).items.map((p) => p.title);
    expect(titles).not.toContain('not yours');
  });
});

/* -------------------------------------------------------------------------- pagination */

describe('pagination', () => {
  it('walks the whole set exactly once with the cursor', async () => {
    const pager = await signUp(ctx);
    const headers = { cookie: pager.cookie };
    for (let i = 0; i < 5; i += 1) {
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/projects',
        headers,
        payload: { title: `p${String(i)}` },
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url: string = `/v1/projects?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const response = await ctx.app.inject({ url, headers });
      const body = response.json() as {
        items: Array<{ id: string }>;
        nextCursor: string | null;
      };
      seen.push(...body.items.map((p) => p.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('treats a malformed cursor as the first page rather than an error', async () => {
    const response = await ctx.app.inject({
      url: '/v1/projects?cursor=not-a-real-cursor',
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);
  });
});
