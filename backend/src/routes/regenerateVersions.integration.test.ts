/**
 * Regenerate keeps the old answer (Stage 5 F4b; ADR-0079, which replaces ADR-0038 §5): a
 * finished answer stays in its chat and the regenerate runs in a new version of the
 * conversation; the answer then shows `1 / 2`, `2 / 2`. The chosen version is stored on the
 * server and the list shows it. A failed or empty answer is still cleared in place.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chats, messages, turns } from '../db/schema.js';
import { createTestApp, parseSse, signUp, type TestContext, type TestUser } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

const answer = (text: string) => [
  { type: 'delta' as const, text },
  { type: 'completed' as const, usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
];

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const headers = () => ({ cookie: user.cookie });

async function newChat(title = 'Versions'): Promise<string> {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: headers(), payload: { title } });
  return (res.json() as { id: string }).id;
}

async function generate(chatId: string, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: headers(), payload: { prompt: 'Say it.', ...payload } });
}

interface MessageDto {
  id: string;
  seq: number;
  role: string;
  text: string;
  status: string;
  versions: { index: number; versions: Array<{ chatId: string }> } | null;
}

async function read(chatId: string): Promise<{ id: string; familyId: string; messages: MessageDto[] }> {
  return (await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: headers() })).json() as { id: string; familyId: string; messages: MessageDto[] };
}

async function listed(): Promise<Array<{ id: string; familyId: string }>> {
  return ((await ctx.app.inject({ url: '/v1/chats?limit=100', headers: headers() })).json() as { items: Array<{ id: string; familyId: string }> }).items;
}

async function regenerateOnce(): Promise<{ chatId: string; versionId: string; oldId: string; frames: ReturnType<typeof parseSse> }> {
  const chatId = await newChat();
  ctx.provider.script = answer('Old answer.');
  expect((await generate(chatId, {})).statusCode).toBe(200);
  const old = (await read(chatId)).messages.find((m) => m.role === 'assistant')!;
  ctx.provider.script = answer('New answer.');
  const res = await generate(chatId, { retryMessageId: old.id });
  expect(res.statusCode).toBe(200);
  const [version] = await ctx.db.select({ id: chats.id }).from(chats).where(eq(chats.parentChatId, chatId));
  return { chatId, versionId: version!.id, oldId: old.id, frames: parseSse(res.body) };
}

describe('regenerate keeps the old answer as a version', () => {
  it('leaves the old answer in its chat and writes the new one in a new version', async () => {
    const { chatId, versionId, oldId, frames } = await regenerateOnce();

    const parent = await read(chatId);
    expect(parent.messages.map((m) => [m.role, m.text, m.status])).toEqual([
      ['user', 'Say it.', 'complete'],
      ['assistant', 'Old answer.', 'complete'],
    ]);
    expect(parent.messages[1]!.id).toBe(oldId);

    const version = await read(versionId);
    expect(version.familyId).toBe(chatId);
    expect(version.messages.map((m) => [m.seq, m.role, m.text, m.status])).toEqual([
      [0, 'user', 'Say it.', 'complete'],
      [1, 'assistant', 'New answer.', 'complete'],
    ]);
    const [row] = await ctx.db.select().from(chats).where(eq(chats.id, versionId));
    expect(row).toMatchObject({ parentChatId: chatId, rootChatId: chatId, forkSeq: 1 });

    // The frames say where the turn runs: ack and start name the new version.
    expect(frames[0]).toMatchObject({ event: 'ack', data: { chatId: versionId } });
    expect(frames.find((f) => f.event === 'start')?.data).toMatchObject({ chatId: versionId });
    const [turn] = await ctx.db.select().from(turns).where(eq(turns.chatId, versionId));
    expect(turn).toMatchObject({ kind: 'regenerate', state: 'done' });
  });

  it('shows the answer as 1 / 2 in the old chat and 2 / 2 in the new one', async () => {
    const { chatId, versionId } = await regenerateOnce();
    const inParent = (await read(chatId)).messages.find((m) => m.role === 'assistant')!.versions;
    const inVersion = (await read(versionId)).messages.find((m) => m.role === 'assistant')!.versions;
    expect(inParent).toEqual({ index: 0, versions: [expect.objectContaining({ chatId }), expect.objectContaining({ chatId: versionId })] });
    expect(inVersion).toEqual({ index: 1, versions: [expect.objectContaining({ chatId }), expect.objectContaining({ chatId: versionId })] });
    // The shared prompt has one version only.
    expect((await read(versionId)).messages.find((m) => m.role === 'user')!.versions).toBeNull();
  });

  it('keeps the choice on the server: the list shows the version chosen last', async () => {
    const { chatId, versionId } = await regenerateOnce();
    // The generate ran in the new version, so it is the one listed.
    let rows = (await listed()).filter((c) => c.familyId === chatId);
    expect(rows.map((c) => c.id)).toEqual([versionId]);

    // Choosing the old answer is stored; the list shows it even though the new version is newer.
    const [was] = await ctx.db.select({ updatedAt: chats.updatedAt }).from(chats).where(eq(chats.id, chatId));
    const put = await ctx.app.inject({ method: 'PUT', url: `/v1/chats/${chatId}/active-version`, headers: headers() });
    expect(put.statusCode).toBe(204);
    const [root] = await ctx.db.select({ activeChatId: chats.activeChatId, updatedAt: chats.updatedAt }).from(chats).where(eq(chats.id, chatId));
    expect(root?.activeChatId).toBe(chatId);
    // A switch is not activity: the conversation keeps its place in the list.
    expect(root?.updatedAt.getTime()).toBe(was!.updatedAt.getTime());
    rows = (await listed()).filter((c) => c.familyId === chatId);
    expect(rows.map((c) => c.id)).toEqual([chatId]);

    // And back.
    await ctx.app.inject({ method: 'PUT', url: `/v1/chats/${versionId}/active-version`, headers: headers() });
    rows = (await listed()).filter((c) => c.familyId === chatId);
    expect(rows.map((c) => c.id)).toEqual([versionId]);
  });

  it('a regenerate of the regenerated answer makes a third version of the same family', async () => {
    const { chatId, versionId } = await regenerateOnce();
    const second = (await read(versionId)).messages.find((m) => m.role === 'assistant')!;
    ctx.provider.script = answer('Third answer.');
    const res = await generate(versionId, { retryMessageId: second.id });
    expect(res.statusCode).toBe(200);
    const family = await ctx.db.select({ id: chats.id, rootChatId: chats.rootChatId }).from(chats).where(eq(chats.rootChatId, chatId));
    expect(family).toHaveLength(2);
    const third = family.find((c) => c.id !== versionId)!.id;
    const shown = (await read(third)).messages.find((m) => m.role === 'assistant')!;
    expect(shown.text).toBe('Third answer.');
    expect(shown.versions?.versions.map((v) => v.chatId)).toEqual([chatId, versionId, third]);
    expect(shown.versions?.index).toBe(2);
  });

  it('clears a failed answer in place, in the same chat', async () => {
    const chatId = await newChat();
    ctx.provider.streamError = new Error('boom');
    try {
      await generate(chatId, {});
    } finally {
      ctx.provider.streamError = null;
    }
    const failed = (await read(chatId)).messages.find((m) => m.role === 'assistant')!;
    expect(failed.status).toBe('error');
    ctx.provider.script = answer('Second try.');
    const res = await generate(chatId, { retryMessageId: failed.id });
    expect(parseSse(res.body)[0]?.data).not.toHaveProperty('chatId');
    const after = await read(chatId);
    expect(after.messages.map((m) => [m.id, m.text, m.status])).toEqual([
      [after.messages[0]!.id, 'Say it.', 'complete'],
      [failed.id, 'Second try.', 'complete'],
    ]);
    expect(await ctx.db.select().from(chats).where(eq(chats.parentChatId, chatId))).toHaveLength(0);
  });

  it('copies the prompt\'s files into the new version and the turn reads the copies', async () => {
    const part = Buffer.from('Notes for the version test.\n');
    const boundary = '----p22versions';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="v.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      part,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...headers(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(up.statusCode).toBe(201);
    const fileId = (up.json() as { id: string }).id;
    const chatId = await newChat();
    ctx.provider.script = answer('Read it.');
    await generate(chatId, { attachmentIds: [fileId] });
    const old = (await read(chatId)).messages.find((m) => m.role === 'assistant')!;
    ctx.provider.script = answer('Read it again.');
    await generate(chatId, { retryMessageId: old.id, attachmentIds: [fileId] });
    const [version] = await ctx.db.select({ id: chats.id }).from(chats).where(eq(chats.parentChatId, chatId));
    const [turn] = await ctx.db.select().from(turns).where(eq(turns.chatId, version!.id));
    expect(turn!.params.attachmentIds).toHaveLength(1);
    expect(turn!.params.attachmentIds[0]).not.toBe(fileId);
    const [prompt] = await ctx.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.chatId, version!.id), eq(messages.role, 'user')))
      .orderBy(asc(messages.seq));
    expect(turn!.userMessageId).toBe(prompt!.id);
  });
});
