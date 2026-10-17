import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSql } from '../db/client.js';
import { memoryService, MemoryConcurrencyError } from '../services/memory/memoryService.js';
import { MemoryToolExecutor } from '../tools/memoryExecutor.js';
import { ChatToolExecutor } from '../tools/chatExecutor.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp, promptOf } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;
let otherUser: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({
    ENABLE_MEMORY: 'true',
    ENABLE_TOOL_USE: 'true',
  });
  user = await signUp(ctx);
  otherUser = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const auth = (u = user): { cookie: string } => ({ cookie: u.cookie });

describe('Phase 5.2 Memory Integration & Tools', () => {
  it('creates and lists persistent memory items', async () => {
    const item = await memoryService.createMemory({
      userId: user.id,
      scope: 'global',
      kind: 'preference',
      key: 'code_style',
      content: 'Always use TypeScript with strict null checks.',
      summary: 'TypeScript strict null checks preference',
      isStanding: true,
    });

    expect(item.id).toBeDefined();
    expect(item.version).toBe(1);
    expect(item.isStanding).toBe(true);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/v1/memory',
      headers: auth(),
    });

    expect(listRes.statusCode).toBe(200);
    const body = listRes.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    const found = body.items.find((i: { id: string }) => i.id === item.id);
    expect(found).toBeDefined();
    expect(found.key).toBe('/topics/code-style.md');
    expect(found.content).toBe('Always use TypeScript with strict null checks.');
  });

  it('rejects storing secrets in memory', async () => {
    await expect(
      memoryService.createMemory({
        userId: user.id,
        key: 'db_secret',
        content: 'Connect via postgres://admin:supersecretpass@db.example.com:5432/main',
      }),
    ).rejects.toThrow(/Cannot store memory containing sensitive secrets/);
  });

  it('enforces optimistic concurrency control on update', async () => {
    const item = await memoryService.createMemory({
      userId: user.id,
      scope: 'global',
      key: 'editor_preference',
      content: 'Prefers VSCode',
      summary: 'VSCode preference',
    });

    // Successful update with expectedVersion = 1
    const updated = await memoryService.updateMemory(user.id, item.id, 1, {
      content: 'Prefers Neovim with Lua configs',
    });
    expect(updated.version).toBe(2);
    expect(updated.content).toBe('Prefers Neovim with Lua configs');

    // Stale update with expectedVersion = 1 should fail
    await expect(
      memoryService.updateMemory(user.id, item.id, 1, {
        content: 'Prefers Emacs',
      }),
    ).rejects.toThrow(MemoryConcurrencyError);
  });

  it('enforces user isolation: other user cannot see or update memories', async () => {
    const item = await memoryService.createMemory({
      userId: user.id,
      key: 'secret_hobby',
      content: 'Plays chess in the morning',
    });

    // Other user lists memories: should not include item
    const otherList = await ctx.app.inject({
      method: 'GET',
      url: '/v1/memory',
      headers: auth(otherUser),
    });
    const otherBody = otherList.json();
    expect(otherBody.items.some((i: { id: string }) => i.id === item.id)).toBe(false);

    // Other user attempts to update: not found
    await expect(
      memoryService.updateMemory(otherUser.id, item.id, 1, { content: 'Hacked' }),
    ).rejects.toThrow(/not found/i);
  });

  it('writes, reads, edits, appends and deletes memory files against their version (ADR-0047)', async () => {
    const u = await signUp(ctx);
    const exec = new MemoryToolExecutor(memoryService, u.id, null);
    const signal = new AbortController().signal;
    const call = async (name: string, input: Record<string, unknown>) => {
      const res = await exec.execute({ id: name, name, input }, signal);
      return { ok: res.ok, data: (res.content[0] as { data: Record<string, unknown> }).data };
    };
    const file = '---\nname: work\ndescription: The user\'s job\n---\n- Auditor at a bank.';

    const created = await call('memory_write', { path: '/topics/work.md', content: file, if_version: 'new' });
    expect(created.ok).toBe(true);
    const v1 = created.data.version as string;
    expect(v1).toMatch(/^[0-9a-f]{12}$/);

    // new on an existing path is refused and hands back what is there.
    const again = await call('memory_write', { path: '/topics/work.md', content: 'x', if_version: 'new' });
    expect(again.ok).toBe(false);
    expect((again.data.current as { content: string }).content).toBe(file);

    const edited = await call('memory_str_replace', {
      path: '/topics/work.md', old_str: 'Auditor at a bank.', new_str: 'Auditor at KVB.', if_version: v1,
    });
    expect(edited.ok).toBe(true);
    const v2 = edited.data.version as string;

    // A stale version loses, and the current file comes back to merge.
    const stale = await call('memory_append', { path: '/topics/work.md', content: '- Reconciles statements.', if_version: v1 });
    expect(stale.ok).toBe(false);
    expect((stale.data.current as { version: string }).version).toBe(v2);

    const appended = await call('memory_append', { path: '/topics/work.md', content: '- Reconciles statements.', if_version: v2 });
    expect(appended.ok).toBe(true);

    const read = await call('memory_read', { path: ['/topics/work.md', '/nope.md'] });
    const files = read.data.files as Array<{ path: string; content?: string; error?: string; version?: string }>;
    expect(files[0]!.content).toBe(file.replace('Auditor at a bank.', 'Auditor at KVB.') + '\n- Reconciles statements.');
    expect(files[1]!.error).toContain('does not exist');

    const listed = await call('memory_list', { include_preview: true });
    expect(listed.data.files).toEqual([
      expect.objectContaining({ path: '/topics/work.md', preview: "The user's job" }),
    ]);

    const deleted = await call('memory_delete', { path: '/topics/work.md', if_version: files[0]!.version });
    expect(deleted.ok).toBe(true);
    expect((await call('memory_list', {})).data.files).toEqual([]);
  });

  it('refuses secrets, bad paths and a replace that is not unique', async () => {
    const u = await signUp(ctx);
    const exec = new MemoryToolExecutor(memoryService, u.id, null);
    const signal = new AbortController().signal;
    const res = (name: string, input: Record<string, unknown>) => exec.execute({ id: name, name, input }, signal);
    expect((await res('memory_write', { path: 'no-slash.md', content: 'x', if_version: 'new' })).ok).toBe(false);
    expect((await res('memory_write', { path: '/a/../b.md', content: 'x', if_version: 'new' })).ok).toBe(false);
    expect(
      (await res('memory_write', { path: '/k.md', content: 'key AKIAIOSFODNN7EXAMPLE', if_version: 'new' })).ok,
    ).toBe(false);
    const made = await res('memory_write', { path: '/t.md', content: '- a\n- a', if_version: 'new' });
    const version = ((made.content[0] as { data: { version: string } }).data).version;
    expect((await res('memory_str_replace', { path: '/t.md', old_str: '- a', new_str: '- b', if_version: version })).ok).toBe(false);
  });

  it('keeps a project\'s memory separate from the user\'s', async () => {
    const u = await signUp(ctx);
    const project = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: auth(u), payload: { title: 'p' } })).json() as { id: string };
    const signal = new AbortController().signal;
    const inProject = new MemoryToolExecutor(memoryService, u.id, project.id);
    await inProject.execute({ id: 'w', name: 'memory_write', input: { path: '/projects/p.md', content: '- p', if_version: 'new' } }, signal);
    const outside = await memoryService.listFiles(u.id, null);
    expect(outside.files).toEqual([]);
    expect((await memoryService.listFiles(u.id, project.id)).files.map((f) => f.path)).toEqual(['/projects/p.md']);
  });

  it('lets the user add and edit a topic, with a version check (ADR-0025)', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/memory',
      headers: auth(),
      payload: { key: 'Writing style', content: 'Short answers.' },
    });
    expect(created.statusCode).toBe(200);
    const item = created.json() as { id: string; version: number };

    const edited = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/memory/${item.id}`,
      headers: auth(),
      payload: { expectedVersion: item.version, content: 'Short answers in Tanglish.' },
    });
    expect(edited.statusCode).toBe(200);
    expect((edited.json() as { content: string }).content).toBe('Short answers in Tanglish.');

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/memory/${item.id}`,
      headers: auth(),
      payload: { expectedVersion: item.version, content: 'Long answers.' },
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { error: { code: string } }).error.code).toBe('conflict');

    const foreign = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/memory/${item.id}`,
      headers: auth(otherUser),
      payload: { expectedVersion: 2, content: 'hijack' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('starts every conversation from the listing and the profile, the same text each turn', async () => {
    const u = await signUp(ctx);
    await memoryService.writeFile(u.id, null, '/profile.md', '---\nname: profile\ndescription: Who the user is\n---\n- Auditor at KVB.', 'new');
    await memoryService.writeFile(u.id, null, '/topics/banks.md', '---\nname: banks\ndescription: Banks the user works with\n---\n- KVB', 'new');
    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: auth(u),
      payload: { title: 'New conversation' },
    });
    const chatId = (chat.json() as { id: string }).id;
    const systems: string[] = [];
    for (const prompt of ['hi', 'what is 2 + 2?']) {
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers: auth(u),
        payload: { prompt },
      });
      systems.push(promptOf(ctx.provider.seen.at(-1)!));
    }
    const memoryBlock = (s: string) => s.slice(s.indexOf('<memory_snapshot '), s.indexOf('</memory_snapshot>'));
    expect(systems[0]).toContain('/topics/banks.md — Banks the user works with');
    expect(systems[0]).toContain('<profile_document>\n---\nname: profile');
    expect(memoryBlock(systems[0]!).length).toBeGreaterThan(50);
    expect(memoryBlock(systems[0]!)).toBe(memoryBlock(systems[1]!));
    expect(systems[0]).toContain('<memory_files>');
  });

  it('conversation_search: outside projects from outside, one project from inside, never this chat (C6)', async () => {
    const u = await signUp(ctx);
    const h = auth(u);
    const project = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: h, payload: { title: 'p' } })).json() as { id: string };
    const chatIn = async (title: string, projectId?: string) =>
      ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: h, payload: { title, ...(projectId ? { projectId } : {}) } })).json() as { id: string }).id;
    const say = (chatId: string, prompt: string) =>
      ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: h, payload: { prompt } });
    const plain = await chatIn('Plain chat');
    const inProject = await chatIn('Project chat', project.id);
    const current = await chatIn('Current chat');
    await say(plain, 'The KVB reconciliation had 244 debits');
    await say(inProject, 'The KVB project totals were checked');
    await say(current, 'KVB again here');

    const run = async (projectId: string | null, chatId: string) => {
      const exec = new ChatToolExecutor(u.id, projectId, chatId);
      const res = await exec.execute({ id: 's', name: 'conversation_search', input: { query: 'kvb debits' } }, new AbortController().signal);
      expect(res.ok).toBe(true);
      return ((res.content[0] as { data: { results: { chatId: string; excerpt: string }[] } }).data.results);
    };
    const outside = await run(null, current);
    expect(outside.map((r) => r.chatId)).toEqual([plain]);
    expect(outside[0]!.excerpt).toContain('KVB');
    const inside = await run(project.id, inProject);
    expect(inside).toEqual([]);
    const fromOtherProjectChat = await run(project.id, current);
    expect(fromOtherProjectChat.map((r) => r.chatId)).toEqual([inProject]);
  });

  it('read_conversation opens a hit in its own chat only, and recent_chats lists newest first', async () => {
    const u = await signUp(ctx);
    const h = auth(u);
    const chatIn = async (title: string) =>
      ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: h, payload: { title } })).json() as { id: string }).id;
    const first = await chatIn('First');
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${first}/generate`, headers: h, payload: { prompt: 'Federal bank had 277 entries' } });
    const second = await chatIn('Second');
    await ctx.app.inject({ method: 'POST', url: `/v1/chats/${second}/generate`, headers: h, payload: { prompt: 'hello there' } });
    const exec = new ChatToolExecutor(u.id, null, second);
    const signal = new AbortController().signal;

    const hit = await exec.execute({ id: 's', name: 'conversation_search', input: { query: 'federal entries' } }, signal);
    const results = (hit.content[0] as { data: { results: { chatId: string; pageToken: string }[] } }).data.results;
    expect(results[0]!.chatId).toBe(first);

    const page = await exec.execute(
      { id: 'r', name: 'read_conversation', input: { conversation_id: first, page_token: results[0]!.pageToken } },
      signal,
    );
    expect(page.ok).toBe(true);
    const turns = (page.content[0] as { data: { turns: { role: string; text: string }[] } }).data.turns;
    expect(turns[0]!.role).toBe('user');
    expect(turns[0]!.text).toContain('277');

    const foreign = new ChatToolExecutor(otherUser.id, null, null);
    const denied = await foreign.execute({ id: 'r', name: 'read_conversation', input: { conversation_id: first } }, signal);
    expect(denied.ok).toBe(false);

    // The current chat is left out; the other one comes back.
    const recent = await exec.execute({ id: 'n', name: 'recent_chats', input: { n: 5 } }, signal);
    const chats = (recent.content[0] as { data: { chats: { chatId: string; excerpt: string }[] } }).data.chats;
    expect(chats.map((c) => c.chatId)).toEqual([first]);
    expect(chats[0]!.excerpt).toContain('Federal');
  });

  it('moves a topic saved before into a file path, and gives two that slug alike their own (migration 0022)', async () => {
    const u = await signUp(ctx);
    // Written as the code before this change stored them: the topic name as the key.
    for (const key of ['Work', 'work', 'Bank statement project', '!!!']) {
      await getSql()`INSERT INTO memory_items (user_id, key, content) VALUES (${u.id}, ${key}, ${`- ${key}`})`;
    }
    await memoryService.writeFile(u.id, null, '/profile.md', '- kept', 'new');
    await getSql().unsafe(readFileSync(path.resolve(__dirname, '../../drizzle/0022_memory_files.sql'), 'utf8'));
    const { files } = await memoryService.listFiles(u.id, null);
    expect(files.map((f) => f.path)).toEqual([
      '/profile.md',
      '/topics/bank-statement-project.md',
      '/topics/note.md',
      '/topics/work-2.md',
      '/topics/work.md',
    ]);
    expect((await memoryService.readFile(u.id, null, '/topics/work.md'))!.content).toBe('- Work');
  });
});
