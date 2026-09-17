/**
 * Message attachments: extraction, claiming, deletion, and cleanup.
 *
 * An attachment is uploaded before the message that carries it exists, so the interesting
 * states are "uploaded but unclaimed" and "claimed by a sent message" — the first is garbage
 * to collect, the second must not be deletable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { attachments } from '../db/schema.js';
import type { TestContext, TestUser } from '../test/harness.js';
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

  it('stores a file it cannot read as unsupported, with the reason, rather than rejecting it', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 3),
    ]);
    const { statusCode, body } = await upload('pic.png', png, 'image/png');

    expect(statusCode).toBe(201);
    expect(body).toMatchObject({ status: 'unsupported', hasText: false });
    expect(String(body['error'])).toContain('not indexed');
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

  it('truncates very long text and says so rather than sending a silently clipped file', async () => {
    // 200_000 is the extraction cap in the route.
    const { body } = await upload('long.txt', 'x'.repeat(250_000));
    expect(body).toMatchObject({ status: 'ready', hasText: true });
    expect(String(body['error'])).toContain('first');
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

    // The extracted text was actually put in front of the model, not merely stored.
    const seen = ctx.provider.seen.at(-1)!;
    expect(`${seen.prompt}\n${seen.systemInstruction}`).toContain('western route has shade');

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
