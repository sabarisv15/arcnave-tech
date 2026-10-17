/**
 * Data controls (ADR-0040): memory in and out, a full export, and deleting the account so that
 * nothing of it is left in any table or in storage.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseImportText } from '../services/memory/memoryTransfer.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, signUp } from '../test/harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

const PASSWORD = 'correct-horse-battery-staple';

async function freshUser(): Promise<TestUser> {
  return signUp(ctx);
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else out.push(path);
  }
  return out;
}

describe('memory import and export', () => {
  it('reads what another assistant lists, one memory per line', () => {
    const items = parseImportText(
      '# What I remember\n[2026-01-04] - Prefers answers in Tamil\n- Works as a CA in Chennai\n2. Uses Tally\n\n  \n',
    );
    expect(items.map((i) => i.content)).toEqual(['Prefers answers in Tamil', 'Works as a CA in Chennai', 'Uses Tally']);
    expect(items[0]!.key).toBe('Prefers answers in Tamil');
  });

  it('round-trips an export, and skips what is already held', async () => {
    const user = await freshUser();
    const auth = { cookie: user.cookie };
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/v1/memory/import',
      headers: auth,
      payload: { text: '- Likes short answers\n- Likes short answers\n- Lives in Madurai' },
    });
    expect(first.json()).toEqual({ added: 2, skipped: 1 });

    const exported = await ctx.app.inject({ url: '/v1/memory/export', headers: auth });
    const data = exported.json() as { version: number; items: Array<{ content: string }> };
    expect(data.version).toBe(1);
    expect(data.items.map((i) => i.content).sort()).toEqual(['Likes short answers', 'Lives in Madurai']);

    // Into a new account, the export is taken whole; into the same one, all of it is skipped.
    const other = await freshUser();
    const into = await ctx.app.inject({ method: 'POST', url: '/v1/memory/import', headers: { cookie: other.cookie }, payload: { data } });
    expect(into.json()).toEqual({ added: 2, skipped: 0 });
    const again = await ctx.app.inject({ method: 'POST', url: '/v1/memory/import', headers: auth, payload: { data } });
    expect(again.json()).toEqual({ added: 0, skipped: 2 });
  });

  it('refuses an import with nothing in it', async () => {
    const user = await freshUser();
    const r = await ctx.app.inject({ method: 'POST', url: '/v1/memory/import', headers: { cookie: user.cookie }, payload: { text: '\n\n#' } });
    expect(r.json()).toMatchObject({ error: { code: 'validation_error' } });
  });
});

describe('account export', () => {
  it('zips conversations, artifacts, memory and settings, for the owner only', async () => {
    const user = await freshUser();
    const auth = { cookie: user.cookie };
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth, payload: { title: 'Budget' } });
    const chatId = (chat.json() as { id: string }).id;
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: auth, payload: { prompt: 'Plan my budget' } });
    await ctx.app.inject({ method: 'POST', url: '/v1/artifacts', headers: auth, payload: { title: 'Plan', content: '# Budget plan' } });
    await ctx.app.inject({ method: 'POST', url: '/v1/memory/import', headers: auth, payload: { text: '- Saves 20% each month' } });

    const made = await ctx.app.inject({ method: 'POST', url: '/v1/account/export', headers: auth });
    expect(made.statusCode).toBe(201);
    const { downloadPath, expiresAt } = made.json() as { downloadPath: string; expiresAt: string };
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);

    const stranger = await freshUser();
    expect((await ctx.app.inject({ url: `/v1${downloadPath}`, headers: { cookie: stranger.cookie } })).statusCode).toBe(404);

    const zip = await ctx.app.inject({ url: `/v1${downloadPath}`, headers: auth });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(zip.rawPayload));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['README.txt', 'account.json', 'preferences.json', 'memory.json', 'conversations.json', 'projects.json']),
    );
    const conversations = JSON.parse(strFromU8(files['conversations.json']!)) as Array<{ messages: Array<{ text: string }> }>;
    expect(conversations[0]!.messages.map((m) => m.text)).toContain('Plan my budget');
    const artifact = Object.keys(files).find((f) => f.startsWith('artifacts/Plan-') && f.endsWith('/v1.md'));
    expect(artifact && strFromU8(files[artifact]!)).toBe('# Budget plan');
    expect(strFromU8(files['memory.json']!)).toContain('Saves 20% each month');
    expect(strFromU8(files['account.json']!)).not.toContain('passwordHash');
  });
});

describe('account deletion', () => {
  it('refuses a wrong password with its own code, and keeps the account', async () => {
    const user = await freshUser();
    const r = await ctx.app.inject({ method: 'DELETE', url: '/v1/account', headers: { cookie: user.cookie }, payload: { password: 'not-the-password' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: { code: 'password_incorrect' } });
    const me = await ctx.app.inject({ url: '/v1/auth/me', headers: { cookie: user.cookie } });
    expect((me.json() as { user: { id: string } | null }).user?.id).toBe(user.id);
  });

  it('leaves no row in any table and no stored object, and the login stops working', async () => {
    const user = await freshUser();
    const auth = { cookie: user.cookie };
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: auth, payload: { title: 'Everything' } });
    const chatId = (chat.json() as { id: string }).id;
    const form = multipart('notes.txt', 'some notes');
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files',
      payload: form.payload,
      headers: { ...form.headers, ...auth },
    });
    expect(upload.statusCode).toBe(201);
    const fileId = (upload.json() as { id: string }).id;
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: auth, payload: { prompt: 'Read it', attachmentIds: [fileId] } });
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/share`, headers: auth });
    await ctx.app.inject({ method: 'POST', url: '/v1/memory/import', headers: auth, payload: { text: '- A fact' } });
    await ctx.app.inject({ method: 'POST', url: '/v1/account/export', headers: auth });
    const before = (await listFiles(ctx.storageRoot)).filter((p) => p.includes(user.id));
    expect(before.length).toBeGreaterThanOrEqual(2); // the upload and the export

    const del = await ctx.app.inject({ method: 'DELETE', url: '/v1/account', headers: auth, payload: { password: PASSWORD } });
    expect(del.statusCode).toBe(204);

    // Every table with a user_id column, found from the database rather than a list kept here.
    const tables = await ctx.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'`,
    );
    expect(tables.length).toBeGreaterThan(10);
    for (const { table_name } of tables) {
      const [row] = await ctx.db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table_name)} where user_id = ${user.id}`,
      );
      expect(row!.n, table_name).toBe(0);
    }
    const [chatLeft] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from messages where chat_id = ${chatId}`);
    expect(chatLeft!.n).toBe(0);
    // P22 (ADR-0079): the deletion ledger's two records are the one thing meant to outlive the
    // account (ids and counts only, under their own prefix); nothing else names the user.
    const left = (await listFiles(ctx.storageRoot)).filter((p) => p.includes(user.id));
    const ledger = `/${ctx.cfg.DELETION_LEDGER_PREFIX}/`;
    expect(left.filter((p) => !p.includes(ledger))).toEqual([]);
    expect(left.map((p) => p.slice(p.lastIndexOf('-') + 1)).sort()).toEqual(['completed.json', 'requested.json']);

    // The session went with the account.
    const me = await ctx.app.inject({ url: '/v1/auth/me', headers: auth });
    expect((me.json() as { user: unknown }).user).toBeNull();
    const login = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: PASSWORD } });
    expect(login.statusCode).toBe(401);
  });
});
