/**
 * Versions of a conversation (ADR-0038): editing a prompt makes another version of the same
 * chat, `GET /chats/:id` lists the versions of each prompt, and the chat list shows one row.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments, chats, messages } from '../db/schema.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

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

interface Versions {
  index: number;
  versions: Array<{ chatId: string; createdAt: string }>;
}
interface Detail {
  id: string;
  familyId: string;
  title: string;
  messages: Array<{ id: string; seq: number; role: string; text: string; versions: Versions | null }>;
}

async function newChat(title = 'Trip plan'): Promise<string> {
  const r = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth(), payload: { title } });
  return (r.json() as { id: string }).id;
}

async function say(chatId: string, prompt: string): Promise<void> {
  const r = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: auth(),
    payload: { prompt },
  });
  expect(r.statusCode).toBe(200);
}

async function read(chatId: string): Promise<Detail> {
  const r = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: auth() });
  expect(r.statusCode).toBe(200);
  return r.json() as Detail;
}

async function edit(chatId: string, editSeq: number, prompt: string): Promise<string> {
  const r = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/branch`,
    headers: auth(),
    payload: { editSeq },
  });
  expect(r.statusCode).toBe(201);
  const id = (r.json() as { id: string }).id;
  await say(id, prompt);
  return id;
}

async function listIds(): Promise<string[]> {
  const r = await ctx.app.inject({ url: '/v1/chats?limit=100', headers: auth() });
  return (r.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);
}

describe('versions of an edited prompt', () => {
  it('lists every version of a prompt edited twice, each with its own answers', async () => {
    const first = await newChat();
    await say(first, 'Plan a trip');
    await say(first, 'Two days in Madurai');

    const second = await edit(first, 2, 'Three days in Madurai');
    const third = await edit(second, 2, 'Four days in Madurai');

    for (const [chatId, index, prompt] of [
      [first, 0, 'Two days in Madurai'],
      [second, 1, 'Three days in Madurai'],
      [third, 2, 'Four days in Madurai'],
    ] as const) {
      const detail = await read(chatId);
      const edited = detail.messages.find((m) => m.seq === 2)!;
      expect(edited.text).toBe(prompt);
      expect(edited.versions).toMatchObject({ index });
      expect(edited.versions!.versions.map((v) => v.chatId)).toEqual([first, second, third]);
      // The prompt before the edit is shared, so it has one version and no switcher.
      expect(detail.messages.find((m) => m.seq === 0)!.versions).toBeNull();
      expect(detail.familyId).toBe(first);
      expect(detail.messages).toHaveLength(4);
    }
  });

  it('shows one row per conversation: the version used last', async () => {
    const first = await newChat();
    await say(first, 'Hello');
    const second = await edit(first, 0, 'Hello there');

    const ids = await listIds();
    expect(ids).toContain(second);
    expect(ids).not.toContain(first);

    // Using the first version again brings it back as the row.
    await say(first, 'And then?');
    const after = await listIds();
    expect(after).toContain(first);
    expect(after).not.toContain(second);
  });

  it('versions a first prompt too', async () => {
    const first = await newChat();
    await say(first, 'Hi');
    const second = await edit(first, 0, 'Hey');
    const detail = await read(second);
    expect(detail.messages[0]!.versions).toMatchObject({ index: 1 });
    expect(detail.messages[0]!.versions!.versions).toHaveLength(2);
  });

  it('deletes the conversation with all its versions', async () => {
    const first = await newChat();
    await say(first, 'A');
    const second = await edit(first, 0, 'B');
    const third = await edit(first, 0, 'C');

    const del = await ctx.app.inject({ method: 'DELETE', url: `/v1/chats/${second}`, headers: auth() });
    expect(del.statusCode).toBe(204);

    const ids = await listIds();
    for (const id of [first, second, third]) {
      expect(ids).not.toContain(id);
      const r = await ctx.app.inject({ url: `/v1/chats/${id}`, headers: auth() });
      expect(r.statusCode).toBe(404);
    }
  });

  it('never offers a deleted version', async () => {
    const first = await newChat();
    await say(first, 'A');
    const second = await edit(first, 0, 'B');
    const third = await edit(first, 0, 'C');
    // Only reachable by the data, not the route: a version whose row is gone.
    await ctx.db.update(chats).set({ deletedAt: new Date() }).where(eq(chats.id, second));

    const detail = await read(third);
    expect(detail.messages[0]!.versions!.versions.map((v) => v.chatId)).toEqual([first, third]);
  });

  it('renames every version together', async () => {
    const first = await newChat('Old name');
    await say(first, 'A');
    const second = await edit(first, 0, 'B');
    const r = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/chats/${second}`,
      headers: auth(),
      payload: { title: 'New name' },
    });
    expect(r.statusCode).toBe(200);
    expect((await read(first)).title).toBe('New name');
  });

  it('copies the files of earlier turns into the new version', async () => {
    const first = await newChat();
    await say(first, 'Read this');
    await say(first, 'Now summarise');
    const [userRow] = await ctx.db.select().from(messages).where(eq(messages.chatId, first)).limit(1);
    await ctx.db.insert(attachments).values({
      userId: user.id,
      messageId: userRow!.id,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
      storageKey: `uploads/${user.id}/notes.txt`,
    });

    const second = await edit(first, 2, 'Now list the points');
    const copied = await ctx.db
      .select({ key: attachments.storageKey })
      .from(attachments)
      .innerJoin(messages, eq(messages.id, attachments.messageId))
      .where(eq(messages.chatId, second));
    expect(copied).toEqual([{ key: `uploads/${user.id}/notes.txt` }]);
  });

  it('refuses an edit seq that is not a prompt', async () => {
    const first = await newChat();
    await say(first, 'A');
    const r = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${first}/branch`,
      headers: auth(),
      payload: { editSeq: 1 },
    });
    expect(r.statusCode).toBe(404);
  });

  it('never lists another user’s chat as a version', async () => {
    const first = await newChat();
    await say(first, 'A');
    const intruder = await signUp(ctx);
    const r = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${first}/branch`,
      headers: { cookie: intruder.cookie },
      payload: { editSeq: 0 },
    });
    expect(r.statusCode).toBe(404);
  });
});
