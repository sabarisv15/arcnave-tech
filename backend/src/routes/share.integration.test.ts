/**
 * Public share links (ADR-0039): what a stranger with the link can read, and what never leaves.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments, messages, toolCalls } from '../db/schema.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';
import { newShareToken } from './share.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE: '5' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const auth = () => ({ cookie: user.cookie });

async function chatWithReply(prompt = 'What is compound interest?'): Promise<string> {
  const c = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth(), payload: { title: 'Interest' } });
  const chatId = (c.json() as { id: string }).id;
  const g = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: auth(), payload: { prompt } });
  expect(g.statusCode).toBe(200);
  return chatId;
}

async function share(chatId: string): Promise<{ id: string; token: string; path: string }> {
  const r = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/share`, headers: auth() });
  expect(r.statusCode).toBe(200);
  return r.json() as { id: string; token: string; path: string };
}

// Public reads come from different addresses, so the rate-limit test alone exhausts its budget.
let ipCounter = 0;
const readPublic = (token: string, ip = `10.0.0.${++ipCounter % 250}`) =>
  ctx.app.inject({ url: `/v1/public/share/${token}`, remoteAddress: ip });

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

describe('sharing a chat', () => {
  it('opens without an account and shows only the allowed fields', async () => {
    const chatId = await chatWithReply();
    const [assistant] = await ctx.db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(messages.seq).offset(1);
    const [userMsg] = await ctx.db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(messages.seq).limit(1);
    // Private things attached to the conversation, which must not appear.
    await ctx.db.update(messages).set({ thinking: 'SECRET-THOUGHT' }).where(eq(messages.id, assistant!.id));
    await ctx.db.insert(toolCalls).values({
      messageId: assistant!.id,
      ordinal: 0,
      toolCallId: 't1',
      name: 'search_memory',
      input: { query: 'SECRET-INPUT' },
      content: [{ type: 'text', text: 'SECRET-OUTPUT' }],
      ok: true,
    });
    await ctx.db.insert(attachments).values({
      userId: user.id,
      messageId: userMsg!.id,
      filename: 'SECRET-FILE.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      storageKey: 'x',
    });

    const link = await share(chatId);
    expect(link.path).toBe(`/s/${link.token}`);
    const r = await readPublic(link.token);
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-robots-tag']).toContain('noindex');
    expect(r.headers['cache-control']).toBe('no-store');

    const body = r.json() as { type: string; messages: Array<{ role: string; text: string }> };
    expect(body.type).toBe('chat');
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect([...keysOf(body)].sort()).toEqual(
      ['artifact', 'createdAt', 'messages', 'role', 'sharedAt', 'sources', 'text', 'title', 'type', 'uiBlocks'].sort(),
    );
    expect(r.body).not.toMatch(/SECRET|search_memory|@test/);
  });

  it('shows the snapshot until the owner updates it, on the same link', async () => {
    const chatId = await chatWithReply('first');
    const link = await share(chatId);
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: auth(), payload: { prompt: 'second, private' } });

    let body = (await readPublic(link.token)).json() as { messages: Array<{ text: string }> };
    expect(body.messages.map((m) => m.text)).not.toContain('second, private');

    const again = await share(chatId);
    expect(again.token).toBe(link.token);
    body = (await readPublic(link.token)).json() as { messages: Array<{ text: string }> };
    expect(body.messages.map((m) => m.text)).toContain('second, private');
  });

  it('stops opening once turned off, and when the chat is deleted', async () => {
    const chatId = await chatWithReply();
    const link = await share(chatId);
    const off = await ctx.app.inject({ method: 'DELETE', url: `/v1/share-links/${link.id}`, headers: auth() });
    expect(off.statusCode).toBe(204);
    const r = await readPublic(link.token);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: 'share_not_found' } });

    const other = await share(chatId);
    expect(other.token).not.toBe(link.token);
    await ctx.app.inject({ method: 'DELETE', url: `/v1/chats/${chatId}`, headers: auth() });
    expect((await readPublic(other.token)).statusCode).toBe(404);
  });

  it('lists the owner’s live links, and only theirs', async () => {
    const chatId = await chatWithReply();
    const link = await share(chatId);
    const mine = await ctx.app.inject({ url: `/v1/share-links?targetType=chat&targetId=${chatId}`, headers: auth() });
    expect((mine.json() as { items: Array<{ id: string; title: string }> }).items).toEqual([
      expect.objectContaining({ id: link.id, targetType: 'chat', targetId: chatId }),
    ]);

    const stranger = await signUp(ctx);
    const theirs = await ctx.app.inject({ url: '/v1/share-links', headers: { cookie: stranger.cookie } });
    expect((theirs.json() as { items: unknown[] }).items).toEqual([]);
    const steal = await ctx.app.inject({ method: 'DELETE', url: `/v1/share-links/${link.id}`, headers: { cookie: stranger.cookie } });
    expect(steal.statusCode).toBe(404);
    const shareTheirs = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/share`, headers: { cookie: stranger.cookie } });
    expect(shareTheirs.statusCode).toBe(404);
  });

  it('refuses to share a chat with no finished reply', async () => {
    const c = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth(), payload: { title: 'Empty' } });
    const r = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${(c.json() as { id: string }).id}/share`, headers: auth() });
    expect(r.json()).toMatchObject({ error: { code: 'share_empty' } });
  });
});

describe('sharing an artifact', () => {
  it('shows the version shared, not later edits, until updated', async () => {
    const a = await ctx.app.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers: auth(),
      payload: { title: 'Plan', kind: 'document', content: '# Version one' },
    });
    const id = (a.json() as { id: string }).id;
    const link = (await ctx.app.inject({ method: 'POST', url: `/v1/artifacts/${id}/share`, headers: auth() })).json() as {
      token: string;
    };
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${id}/versions`,
      headers: auth(),
      payload: { content: '# Version two' },
    });
    let body = (await readPublic(link.token)).json() as { type: string; artifact: { content: string; version: number } };
    expect(body).toMatchObject({ type: 'artifact', artifact: { content: '# Version one', version: 1, kind: 'document' } });

    await ctx.app.inject({ method: 'POST', url: `/v1/artifacts/${id}/share`, headers: auth() });
    body = (await readPublic(link.token)).json() as typeof body;
    expect(body.artifact).toMatchObject({ content: '# Version two', version: 2 });
  });
});

describe('share tokens', () => {
  it('are 256 random bits, unrelated to any id', () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('are rate limited per address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await readPublic('x'.repeat(43), '192.0.2.77')).statusCode);
    expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(statuses.at(-1)).toBe(429);
  });
});
