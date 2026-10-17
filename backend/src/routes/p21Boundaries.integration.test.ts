/**
 * P21 (ADR-0082): per-route body limits (Stage 4 C4) and the auth read path without a write on
 * every request (D3 A-25). Behaviour-neutral: nothing a route accepted before P21 becomes a 413.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sessions } from '../db/schema.js';
import { NUMBERS } from '../config/numbers.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, postProjectFile, signUp, sleep } from '../test/harness.js';
import { jsonBodyLimit } from './bodyLimits.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_MEMORY: 'true' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const MIB = 1024 * 1024;

describe('C4 per-route body limits', () => {
  it('refuses a 2 MiB JSON body on a route that sets no limit with 413 payload_too_large', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'x', pad: 'a'.repeat(2 * MIB) }),
    });
    expect(res.statusCode).toBe(413);
    expect((res.json() as { error: { code: string } }).error.code).toBe('payload_too_large');
  });

  it('still takes a multipart upload above 1 MiB (the upload route keeps the upload limit)', async () => {
    const project = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: { cookie: user.cookie }, payload: { title: 'p21' } })).json() as { id: string };
    const big = `${'line of project notes\n'.repeat(Math.ceil((1.5 * MIB) / 22))}`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(1.4 * MIB);
    const res = await postProjectFile(ctx, { cookie: user.cookie }, project.id, multipart('notes.txt', big));
    expect(res.statusCode).toBe(202);
  });

  it('still takes the largest prompt the generate schema allows (N-02), whatever its characters', async () => {
    const chat = (await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: {} })).json() as { id: string };
    // U+0001 is escaped to six bytes in JSON: the worst case for the 1 MiB default.
    const prompt = '\u0001'.repeat(NUMBERS.PROMPT_MAX_CHARS.value);
    const body = JSON.stringify({ prompt });
    expect(Buffer.byteLength(body)).toBeGreaterThan(500_000);
    expect(Buffer.byteLength(body)).toBeLessThan(MIB);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chat.id}/generate`,
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  });

  it('still takes an artifact at its content limit (N-39) in multi-byte characters, above 1 MiB', async () => {
    const content = '€'.repeat(NUMBERS.ARTIFACT_MAX_CHARS.value);
    const body = JSON.stringify({ title: 'Big', content });
    expect(Buffer.byteLength(body)).toBeGreaterThan(MIB);
    expect(Buffer.byteLength(body)).toBeLessThan(jsonBodyLimit(NUMBERS.ARTIFACT_MAX_CHARS.value));
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    const version = await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${id}/versions`,
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ content }),
    });
    expect(version.statusCode).toBe(201);
  });

  it('still takes a memory import above 1 MiB', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ key: `/topics/p21-${String(i)}.md`, content: `- note ${String(i)} ${'the quick note '.repeat(1_260)}` }));
    const body = JSON.stringify({ data: { version: 1, items } });
    expect(Buffer.byteLength(body)).toBeGreaterThan(MIB);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/memory/import',
      headers: { cookie: user.cookie, 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { added: number }).added).toBe(60);
  });
});

describe('A-25 the auth read path', () => {
  async function lastSeen(userId: string): Promise<number> {
    const [row] = await ctx.db.select({ at: sessions.lastSeenAt }).from(sessions).where(eq(sessions.userId, userId)).limit(1);
    return row!.at.getTime();
  }

  it('writes last_seen_at once, not on every request', async () => {
    const u = await signUp(ctx);
    const anHourAgo = new Date(Date.now() - 3_600_000);
    await ctx.db.update(sessions).set({ lastSeenAt: anHourAgo }).where(eq(sessions.userId, u.id));

    expect((await ctx.app.inject({ url: '/v1/auth/me', headers: { cookie: u.cookie } })).statusCode).toBe(200);
    // The write is fire-and-forget: wait for it to land.
    let first = await lastSeen(u.id);
    for (let i = 0; i < 50 && first === anHourAgo.getTime(); i++) {
      await sleep(20);
      first = await lastSeen(u.id);
    }
    expect(first).toBeGreaterThan(anHourAgo.getTime());

    expect((await ctx.app.inject({ url: '/v1/auth/me', headers: { cookie: u.cookie } })).statusCode).toBe(200);
    await sleep(300);
    // Inside SESSION_LAST_SEEN_WRITE_MS the second request read the session and wrote nothing.
    expect(await lastSeen(u.id)).toBe(first);
  });
});
