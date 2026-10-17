/**
 * The deletion ledger (Stage 5 P11, Stage 4 G4; ADR-0079): a purge or an account deletion writes
 * `requested` before anything goes and `completed` after the bytes, before the rows, as JSON in
 * object storage under its own prefix. A ledger that cannot be written stops the deletion: the
 * chat stays for the next sweep. Records hold ids, timestamps and counts, never content, and
 * `deleteOwned` (account deletion's byte sweep) never reaches them.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chats, users } from '../db/schema.js';
import { createTestApp, multipart, parseSse, signUp, type TestContext, type TestUser } from '../test/harness.js';
import { DeletionLedger, ledgerKey } from './deletionLedger.js';
import { sweepRetention } from './retention.js';

let ctx: TestContext;
const DAY = 86_400_000;
const quiet = { warn: () => undefined };
const SECRET_TITLE = 'SENTINEL_TITLE_ledger_4c1d';
const SECRET_TEXT = 'SENTINEL_TEXT_ledger_99ae';

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

async function deletedChat(owner: TestUser): Promise<string> {
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: owner.cookie }, payload: { title: SECRET_TITLE } });
  const chatId = (chat.json() as { id: string }).id;
  const part = multipart('secret-name.txt', SECRET_TEXT, 'text/plain');
  const up = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, cookie: owner.cookie }, payload: part.payload });
  const fileId = (up.json() as { id: string }).id;
  const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: owner.cookie }, payload: { prompt: SECRET_TEXT, attachmentIds: [fileId] } });
  expect(parseSse(res.body).at(-1)!.event).toBe('done');
  expect((await ctx.app.inject({ method: 'DELETE', url: `/v1/chats/${chatId}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204);
  return chatId;
}

async function record(key: string): Promise<Record<string, unknown>> {
  return JSON.parse((await ctx.app.services.storage.get(key)).toString('utf8')) as Record<string, unknown>;
}

describe('deletion ledger', () => {
  it('a purge writes requested, then completed, then the rows go; ids and counts only', async () => {
    const owner = await signUp(ctx);
    const chatId = await deletedChat(owner);
    const at = new Date(Date.now() + 31 * DAY);
    const r = await sweepRetention(ctx.db, ctx.app.services.storage, {
      chatPurgeAfterDays: 30,
      unsentUploadTtlHours: 24,
      sandboxStateDays: 30,
      deletionLedger: ctx.app.services.deletionLedger,
    }, at, quiet);
    expect(r.chatsPurged).toBeGreaterThanOrEqual(1);
    expect(await ctx.db.select().from(chats).where(eq(chats.id, chatId))).toHaveLength(0);

    const prefix = ctx.cfg.DELETION_LEDGER_PREFIX;
    const requested = await record(ledgerKey(prefix, { kind: 'chat_purge', phase: 'requested', subjectId: chatId, at }));
    // The file's bytes and its derived objects (a text file is also stored normalised): counted, not named.
    expect(requested).toMatchObject({ kind: 'chat_purge', phase: 'requested', subjectId: chatId, userId: owner.id, counts: { messages: 2 } });
    const objects = (requested.counts as { objects: number }).objects;
    expect(objects).toBeGreaterThanOrEqual(1);
    // `completed` is stamped with the time it was written; find it under the sweep's day or today's.
    const days = [at, new Date()];
    let completed: Record<string, unknown> | undefined;
    for (const d of days) {
      completed = await record(ledgerKey(prefix, { kind: 'chat_purge', phase: 'completed', subjectId: chatId, at: d })).catch(() => undefined);
      if (completed) break;
    }
    expect(completed).toMatchObject({ kind: 'chat_purge', phase: 'completed', subjectId: chatId, counts: { objects, messages: 2 } });

    // No content of any kind: not the title, the prompt, the reply or the file's name.
    for (const body of [requested, completed!]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain(SECRET_TITLE);
      expect(text).not.toContain(SECRET_TEXT);
      expect(text).not.toContain('secret-name');
      expect(Object.keys(body).sort()).toEqual(['at', 'counts', 'kind', 'phase', 'subjectId', 'userId']);
    }
  });

  it('a ledger that cannot be written leaves the chat (and its rows) for the next sweep', async () => {
    const owner = await signUp(ctx);
    const chatId = await deletedChat(owner);
    const at = new Date(Date.now() + 31 * DAY);
    const broken = new DeletionLedger({ put: async () => Promise.reject(Object.assign(new Error('bucket down'), { code: 'ECONNRESET' })) }, ctx.cfg.DELETION_LEDGER_PREFIX);
    await sweepRetention(ctx.db, ctx.app.services.storage, { chatPurgeAfterDays: 30, unsentUploadTtlHours: 24, sandboxStateDays: 30, deletionLedger: broken }, at, quiet);
    expect(await ctx.db.select().from(chats).where(eq(chats.id, chatId))).toHaveLength(1);

    // Only `completed` fails: the bytes may already be gone, the rows stay, and the next sweep finishes.
    let calls = 0;
    const half = new DeletionLedger(
      { put: async (key, data, type) => (++calls === 2 ? Promise.reject(new Error('second write fails')) : ctx.app.services.storage.put(key, data, type)) },
      ctx.cfg.DELETION_LEDGER_PREFIX,
    );
    await sweepRetention(ctx.db, ctx.app.services.storage, { chatPurgeAfterDays: 30, unsentUploadTtlHours: 24, sandboxStateDays: 30, deletionLedger: half }, at, quiet);
    expect(await ctx.db.select().from(chats).where(eq(chats.id, chatId))).toHaveLength(1);

    await sweepRetention(ctx.db, ctx.app.services.storage, { chatPurgeAfterDays: 30, unsentUploadTtlHours: 24, sandboxStateDays: 30, deletionLedger: ctx.app.services.deletionLedger }, at, quiet);
    expect(await ctx.db.select().from(chats).where(eq(chats.id, chatId))).toHaveLength(0);
  });

  it('account deletion writes both records, and its byte sweep never reaches the ledger', async () => {
    const owner = await signUp(ctx);
    await deletedChat(owner);
    const before = new Date();
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/v1/account',
      headers: { cookie: owner.cookie },
      payload: { password: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode).toBe(204);
    expect(await ctx.db.select().from(users).where(eq(users.id, owner.id))).toHaveLength(0);
    const prefix = ctx.cfg.DELETION_LEDGER_PREFIX;
    const requested = await record(ledgerKey(prefix, { kind: 'account_delete', phase: 'requested', subjectId: owner.id, at: before }));
    const completed = await record(ledgerKey(prefix, { kind: 'account_delete', phase: 'completed', subjectId: owner.id, at: before }));
    expect(requested).toMatchObject({ subjectId: owner.id, userId: owner.id, counts: { chats: 1 } });
    expect(completed).toMatchObject({ subjectId: owner.id, counts: { chats: 1 } });
    expect((completed.counts as { objects: number }).objects).toBeGreaterThanOrEqual(1);

    // Running the owner's byte sweep again leaves both records.
    await ctx.app.services.storage.deleteOwned(owner.id);
    const key = ledgerKey(prefix, { kind: 'account_delete', phase: 'completed', subjectId: owner.id, at: before });
    expect(await ctx.app.services.storage.exists(key)).toBe(true);
    // No delete path takes a ledger key: only writing and reading do.
    await expect(ctx.app.services.storage.delete(key)).rejects.toMatchObject({ code: 'storage_error' });
    expect(await ctx.app.services.storage.exists(key)).toBe(true);
  });

  it('account deletion stops before anything goes when the ledger cannot be written', async () => {
    const owner = await signUp(ctx);
    const services = ctx.app.services as { deletionLedger: DeletionLedger };
    const real = services.deletionLedger;
    services.deletionLedger = new DeletionLedger({ put: async () => Promise.reject(new Error('down')) }, real.prefix);
    try {
      const res = await ctx.app.inject({ method: 'DELETE', url: '/v1/account', headers: { cookie: owner.cookie }, payload: { password: 'correct-horse-battery-staple' } });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      services.deletionLedger = real;
    }
    expect(await ctx.db.select().from(users).where(eq(users.id, owner.id))).toHaveLength(1);
  });
});
