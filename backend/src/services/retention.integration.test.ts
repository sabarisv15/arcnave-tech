/**
 * Deleted chats leave the back end within 30 days, as in Claude; unsent uploads after a day.
 * Runs the real routes and local storage, and moves the sweep's clock instead of the rows'.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments, chats, messages } from '../db/schema.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, parseSse, signUp } from '../test/harness.js';
import { sweepRetention } from './retention.js';

let ctx: TestContext;
let user: TestUser;
const policy = { chatPurgeAfterDays: 30, unsentUploadTtlHours: 24 };
const DAY = 86_400_000;
const quiet = { warn: () => undefined };

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const headers = () => ({ cookie: user.cookie });

async function upload(name: string, text: string): Promise<{ id: string; storageKey: string }> {
  const part = multipart(name, text, 'text/plain');
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...headers() }, payload: part.payload });
  const id = (res.json() as { id: string }).id;
  const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
  return { id, storageKey: row!.storageKey };
}

async function chatWith(attachmentIds: string[]): Promise<string> {
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: headers(), payload: { title: 'r' } });
  const chatId = (chat.json() as { id: string }).id;
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: headers(),
    payload: { prompt: 'read', attachmentIds },
  });
  expect(parseSse(res.body).at(-1)!.event).toBe('done');
  return chatId;
}

const stored = (key: string) => ctx.app.services.storage.exists(key);

describe('deleted chats', () => {
  it('stay for 30 days after deletion, then lose their rows and uploaded files', async () => {
    const file = await upload('notes.txt', 'keep me for a while');
    const chatId = await chatWith([file.id]);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/v1/chats/${chatId}`, headers: headers() })).statusCode).toBe(204);

    // Day 29: hidden from the user, still in the back end.
    await sweepRetention(ctx.db, ctx.app.services.storage, policy, new Date(Date.now() + 29 * DAY), quiet);
    expect(await ctx.db.select().from(chats).where(eq(chats.id, chatId))).toHaveLength(1);
    expect(await stored(file.storageKey)).toBe(true);

    // Day 31: gone, bytes included.
    const r = await sweepRetention(ctx.db, ctx.app.services.storage, policy, new Date(Date.now() + 31 * DAY), quiet);
    expect(r.chatsPurged).toBeGreaterThanOrEqual(1);
    expect(await ctx.db.select().from(chats).where(eq(chats.id, chatId))).toHaveLength(0);
    expect(await ctx.db.select().from(messages).where(eq(messages.chatId, chatId))).toHaveLength(0);
    expect(await ctx.db.select().from(attachments).where(eq(attachments.id, file.id))).toHaveLength(0);
    expect(await stored(file.storageKey)).toBe(false);
  });

  it('never touches a chat that was not deleted, however old', async () => {
    const file = await upload('live.txt', 'still in use');
    const chatId = await chatWith([file.id]);
    await sweepRetention(ctx.db, ctx.app.services.storage, policy, new Date(Date.now() + 5 * 365 * DAY), quiet);
    expect(await ctx.db.select().from(chats).where(eq(chats.id, chatId))).toHaveLength(1);
    expect(await stored(file.storageKey)).toBe(true);
  });

  it('keeps the bytes of a file picked from a project; they belong to the project', async () => {
    const project = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: headers(), payload: { title: 'p' } });
    const projectId = (project.json() as { id: string }).id;
    const part = multipart('shared.txt', 'project knowledge', 'text/plain');
    const pf = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/files`,
      headers: { ...part.headers, ...headers() },
      payload: part.payload,
    });
    const projectFileId = (pf.json() as { id: string }).id;
    const picked = await ctx.app.inject({ method: 'POST', url: '/v1/files/from-project', headers: headers(), payload: { projectFileId } });
    const attachmentId = (picked.json() as { id: string }).id;
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, attachmentId));

    const chatId = await chatWith([attachmentId]);
    await ctx.app.inject({ method: 'DELETE', url: `/v1/chats/${chatId}`, headers: headers() });
    await sweepRetention(ctx.db, ctx.app.services.storage, policy, new Date(Date.now() + 31 * DAY), quiet);

    expect(await ctx.db.select().from(chats).where(eq(chats.id, chatId))).toHaveLength(0);
    expect(await stored(row!.storageKey)).toBe(true);
  });
});

describe('unsent uploads', () => {
  it('are removed after a day, bytes included', async () => {
    const file = await upload('draft.txt', 'never sent');
    await sweepRetention(ctx.db, ctx.app.services.storage, policy, new Date(Date.now() + 23 * 3_600_000), quiet);
    expect(await stored(file.storageKey)).toBe(true);

    await sweepRetention(ctx.db, ctx.app.services.storage, policy, new Date(Date.now() + 25 * 3_600_000), quiet);
    expect(await ctx.db.select().from(attachments).where(eq(attachments.id, file.id))).toHaveLength(0);
    expect(await stored(file.storageKey)).toBe(false);
  });

  it('the manual cleanup reports how many it removed', async () => {
    const other = await signUp(ctx);
    const part = multipart('old.txt', 'x', 'text/plain');
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, cookie: other.cookie }, payload: part.payload });
    const id = (res.json() as { id: string }).id;
    await ctx.db.update(attachments).set({ createdAt: new Date(Date.now() - 2 * DAY) }).where(eq(attachments.id, id));
    // The frontend sends an empty body; the route's default cutoff applies.
    const cleaned = await ctx.app.inject({ method: 'POST', url: '/v1/files/cleanup', headers: { cookie: other.cookie }, payload: {} });
    expect(cleaned.json()).toEqual({ deleted: 1 });
  });

  it("the manual cleanup of an unsent pick from a project leaves the project's bytes alone", async () => {
    const owner = await signUp(ctx);
    const h = { cookie: owner.cookie };
    const project = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: h, payload: { title: 'p' } });
    const projectId = (project.json() as { id: string }).id;
    const part = multipart('kb.txt', 'project knowledge', 'text/plain');
    const pf = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${projectId}/files`, headers: { ...part.headers, ...h }, payload: part.payload });
    const picked = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/from-project',
      headers: h,
      payload: { projectFileId: (pf.json() as { id: string }).id },
    });
    const id = (picked.json() as { id: string }).id;
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
    await ctx.db.update(attachments).set({ createdAt: new Date(Date.now() - 2 * DAY) }).where(eq(attachments.id, id));

    await ctx.app.inject({ method: 'POST', url: '/v1/files/cleanup', headers: h, payload: {} });
    expect(await stored(row!.storageKey)).toBe(true);
  });
});
