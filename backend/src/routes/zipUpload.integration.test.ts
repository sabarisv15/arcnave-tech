/**
 * P14 (NEW-PLAN, D1 #1; Stage 9 ZIP, Stage 1 FT-4, Stage 16 FL-2, UD-2): a ZIP is inspected
 * from its central directory, refused with one code per UD-2 case, or unpacked into member
 * attachments that each go through the normal pipeline.
 */
import { eq } from 'drizzle-orm';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments } from '../db/schema.js';
import { lyingZip } from '../test/fixtures/archives.js';
import { pdfWithPages } from '../test/fixtures/files.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;
const auth = () => ({ cookie: user.cookie });
const enc = (s: string) => new TextEncoder().encode(s);

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

/** The browser's path: start, PUT, complete (202), then wait for the job. */
async function uploadZip(bytes: Buffer, name = 'files.zip') {
  const started = await ctx.app.inject({ method: 'POST', url: '/v1/files/uploads', headers: auth(), payload: { filename: name, mimeType: 'application/zip', sizeBytes: bytes.length } });
  expect(started.statusCode).toBe(201);
  const { file, upload } = started.json() as { file: { id: string }; upload: { url: string } };
  await ctx.app.inject({ method: 'PUT', url: `/v1${upload.url}`, headers: { ...auth(), 'content-type': 'application/octet-stream' }, payload: bytes });
  expect((await ctx.app.inject({ method: 'POST', url: `/v1/files/${file.id}/complete`, headers: auth() })).statusCode).toBe(202);
  await ctx.app.services.files.idle();
  return (await ctx.app.inject({ url: `/v1/files/${file.id}`, headers: auth() })).json() as Record<string, any>;
}

describe('UD-2: each unsafe ZIP is refused with its own code, and leaves no members', () => {
  const cases: Array<[string, () => Buffer | Promise<Buffer>, string]> = [
    ['a ZIP inside the ZIP', () => Buffer.from(zipSync({ 'inner.zip': zipSync({ 'a.txt': enc('a') }), 'b.txt': enc('b') })), 'zip_nested'],
    ['a ZIP renamed inside the ZIP', () => Buffer.from(zipSync({ 'notes.txt': zipSync({ 'a.txt': enc('a') }) })), 'zip_nested'],
    ['a path that leaves the archive (zip-slip)', () => lyingZip([{ name: '../../etc/evil.txt', data: enc('x') }]), 'zip_unsafe_path'],
    ['an absolute path', () => lyingZip([{ name: '/etc/evil.txt', data: enc('x') }]), 'zip_unsafe_path'],
    ['a symlink member', () => lyingZip([{ name: 'link.txt', data: enc('/etc/passwd'), unixMode: 0o120777 }]), 'zip_symlink'],
    [
      'a bomb by its declared ratio',
      () => lyingZip([{ name: 'big.txt', data: Buffer.alloc(4096, 0x61), declaredSize: 400 * 1024 * 1024 }]),
      'zip_ratio',
    ],
    [
      'a member that inflates past what it declared',
      () => lyingZip([{ name: 'liar.txt', data: Buffer.alloc(3 * 1024 * 1024, 0x61), method: 8, declaredSize: 10 }]),
      'zip_ratio',
    ],
    [
      'more than 20 members',
      () => Buffer.from(zipSync(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${String(i)}.txt`, enc(String(i))])))),
      'zip_too_many_members',
    ],
    ['an encrypted member', () => lyingZip([{ name: 'secret.txt', data: enc('xx'), flags: 0x1 }]), 'zip_encrypted'],
    ['a member of a type that is not allowed', () => Buffer.from(zipSync({ 'setup.exe': enc('MZ'), 'a.txt': enc('a') })), 'zip_member_type'],
    [
      'more than 500 MB unpacked',
      () => lyingZip(Array.from({ length: 6 }, (_, i) => ({ name: `p${String(i)}.txt`, data: Buffer.alloc(1024 * 1024, 0x61), declaredSize: 90 * 1024 * 1024 }))),
      'zip_too_large_unpacked',
    ],
  ];

  it.each(cases)('%s', async (_label, build, code) => {
    const dto = await uploadZip(await build());
    expect(dto).toMatchObject({ status: 'failed', errorCode: code, memberIds: [] });
    const members = await ctx.db.select().from(attachments).where(eq(attachments.parentAttachmentId, String(dto['id'])));
    expect(members).toHaveLength(0);
  });
});

describe('a valid ZIP becomes member files that go through the normal pipeline', () => {
  it('unpacks members into their own attachments, each read and ready to send', async () => {
    const pdf = await pdfWithPages(2, ['ZIPPDFMARKER one', 'two']);
    const zip = Buffer.from(
      zipSync({
        'docs/notes.txt': enc('ZIPTEXTMARKER inside the zip'),
        'docs/report.pdf': pdf,
        '__MACOSX/docs/._notes.txt': enc('resource fork'),
        'docs/': new Uint8Array(0),
      }),
    );
    const parent = await uploadZip(zip);
    expect(parent, JSON.stringify(parent)).toMatchObject({ status: 'ready', errorCode: '' });
    expect(parent['memberIds']).toHaveLength(2);
    expect(parent['warnings']).toEqual([expect.objectContaining({ code: 'zip_members' })]);

    const members = await Promise.all(
      (parent['memberIds'] as string[]).map(async (id) => (await ctx.app.inject({ url: `/v1/files/${id}`, headers: auth() })).json() as Record<string, any>),
    );
    const byName = Object.fromEntries(members.map((m) => [m['filename'], m]));
    expect(byName['docs/notes.txt']).toMatchObject({ status: 'ready', hasText: true, parentId: parent['id'], mimeType: 'text/plain' });
    expect(byName['docs/report.pdf']).toMatchObject({ status: 'ready', pageCount: 2, reading: 'text+visual', mimeType: 'application/pdf' });

    // The members are sent like any file; the model reads their text.
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth(), payload: { title: 'zip' } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${(chat.json() as { id: string }).id}/generate`,
      headers: auth(),
      payload: { prompt: 'summarise', attachmentIds: parent['memberIds'] },
    });
    expect(res.statusCode).toBe(200);
    const sent = ctx.provider.seen.at(-1)!.attachments!;
    expect(sent.find((a) => a.filename === 'docs/notes.txt')?.extractedText).toContain('ZIPTEXTMARKER');
  });

  it('reads a small ZIP in the request on the multipart path too', async () => {
    const part = multipart('small.zip', Buffer.from(zipSync({ 'a.csv': enc('x,y\n1,2\n') })), 'application/zip');
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...auth() }, payload: part.payload });
    expect(res.statusCode).toBe(201);
    const parent = res.json() as Record<string, any>;
    expect(parent['memberIds']).toHaveLength(1);
    const member = (await ctx.app.inject({ url: `/v1/files/${String(parent['memberIds'][0])}`, headers: auth() })).json() as Record<string, any>;
    expect(member).toMatchObject({ status: 'ready', hasText: true, filename: 'a.csv' });
  });

  it('removing an unsent ZIP removes its unsent members', async () => {
    const parent = await uploadZip(Buffer.from(zipSync({ 'a.txt': enc('a'), 'b.txt': enc('b') })));
    const del = await ctx.app.inject({ method: 'DELETE', url: `/v1/files/${String(parent['id'])}`, headers: auth() });
    expect(del.statusCode).toBe(204);
    for (const id of parent['memberIds'] as string[]) {
      expect((await ctx.app.inject({ url: `/v1/files/${id}`, headers: auth() })).statusCode).toBe(404);
    }
  });
});
