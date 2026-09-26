import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryService, MemoryConcurrencyError } from '../services/memory/memoryService.js';
import { MemoryToolExecutor } from '../tools/memoryExecutor.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

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
    expect(found.key).toBe('code_style');
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

  it('formats standing memories within character cap', async () => {
    await memoryService.createMemory({
      userId: user.id,
      key: 'standing_1',
      content: 'Concise answers only.',
      isStanding: true,
    });
    await memoryService.createMemory({
      userId: user.id,
      key: 'standing_2',
      content: 'Never use markdown tables.',
      isStanding: true,
    });

    const standing = await memoryService.getStandingMemories(user.id);
    expect(standing).toContain('standing_1: Concise answers only.');
    expect(standing).toContain('standing_2: Never use markdown tables.');
  });

  it('executes memory tools via MemoryToolExecutor', async () => {
    const executor = new MemoryToolExecutor(memoryService, user.id);
    const signal = new AbortController().signal;

    // 1. Search memory
    const searchRes = await executor.execute(
      {
        id: 'call_search',
        name: 'search_memory',
        input: { query: 'TypeScript' },
      },
      signal,
    );
    expect(searchRes.ok).toBe(true);
    const searchData = (searchRes.content[0] as { data: { results: Array<{ key: string }> } }).data;
    expect(searchData.results.some((r) => r.key === 'code_style')).toBe(true);

    const targetMemoryId = (searchRes.content[0] as { data: { results: Array<{ memoryId: string; key: string }> } }).data.results.find(
      (r) => r.key === 'code_style',
    )!.memoryId;

    // 2. Read memory
    const readRes = await executor.execute(
      {
        id: 'call_read',
        name: 'read_memory',
        input: { memoryId: targetMemoryId },
      },
      signal,
    );
    expect(readRes.ok).toBe(true);
    const readData = (readRes.content[0] as { data: { key: string; content: string } }).data;
    expect(readData.key).toBe('code_style');

    // 3. Forget memory
    const forgetRes = await executor.execute(
      {
        id: 'call_forget',
        name: 'forget_memory',
        input: { memoryId: targetMemoryId },
      },
      signal,
    );
    expect(forgetRes.ok).toBe(true);
    const forgetData = (forgetRes.content[0] as { data: { forgotten: boolean } }).data;
    expect(forgetData.forgotten).toBe(true);

    // Verify it is gone from active memory
    const checkGone = await memoryService.getMemoryById(user.id, targetMemoryId);
    expect(checkGone).toBeNull();
  });
  it('saves a topic, replaces it on a second save, and forgets it by name (ADR-0025)', async () => {
    const u = await signUp(ctx);
    const exec = new MemoryToolExecutor(memoryService, u.id, null);
    const signal = new AbortController().signal;
    const first = await exec.execute(
      { id: 'c1', name: 'save_memory', input: { topic: 'Work', content: 'Auditor at a bank.' } },
      signal,
    );
    expect(first.ok).toBe(true);
    const second = await exec.execute(
      { id: 'c2', name: 'save_memory', input: { topic: 'work', content: 'Auditor at KVB; reconciles statements.' } },
      signal,
    );
    expect(second.ok).toBe(true);
    const context = await memoryService.getMemoryContext(u.id, null, 8000);
    expect(context.text).toBe('- Work: Auditor at KVB; reconciles statements.');

    const forgot = await exec.execute({ id: 'c3', name: 'forget_memory', input: { topic: 'WORK' } }, signal);
    expect(forgot.ok).toBe(true);
  });

  it('refuses a project-scoped save outside a project', async () => {
    const u = await signUp(ctx);
    const exec = new MemoryToolExecutor(memoryService, u.id, null);
    const res = await exec.execute(
      { id: 'c1', name: 'save_memory', input: { topic: 'X', content: 'y', scope: 'project' } },
      new AbortController().signal,
    );
    expect(res.ok).toBe(false);
  });

  it('finds a memory when any word of the query matches, not only all of them (C5)', async () => {
    const u = await signUp(ctx);
    await memoryService.createMemory({ userId: u.id, key: 'Banks', content: 'Statements come from KVB.' });
    const hits = await memoryService.searchMemory(u.id, {
      query: 'federal la evlo entries and kvb la evlo entries?',
    });
    expect(hits.map((h) => h.key)).toContain('Banks');
    expect(await memoryService.searchMemory(u.id, { query: '?? !!' })).toEqual([]);
  });

  it('starts a conversation from every topic, within the cap, and says how many were left out', async () => {
    const u = await signUp(ctx);
    for (let i = 0; i < 5; i++) {
      await memoryService.createMemory({ userId: u.id, key: `Topic ${String(i)}`, content: 'x'.repeat(50) });
    }
    const all = await memoryService.getMemoryContext(u.id, null, 10_000);
    expect(all.included).toBe(5);
    expect(all.omitted).toBe(0);
    const capped = await memoryService.getMemoryContext(u.id, null, 150);
    expect(capped.included).toBe(2);
    expect(capped.omitted).toBe(3);
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

  it('puts every topic in the system prompt, the same text each turn', async () => {
    const u = await signUp(ctx);
    await memoryService.createMemory({ userId: u.id, key: 'Work', content: 'Auditor at KVB.' });
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
      systems.push(ctx.provider.seen.at(-1)!.systemInstruction ?? '');
    }
    const memoryBlock = (s: string) => s.slice(s.indexOf('<memory>'), s.indexOf('</memory>'));
    expect(systems[0]).toContain('- Work: Auditor at KVB.');
    expect(memoryBlock(systems[0]!)).toBe(memoryBlock(systems[1]!));
    expect(systems[0]).toContain('<memory_policy>');
  });
  it('searches earlier chats: outside projects from outside, one project from inside, never this chat (C6)', async () => {
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
      const exec = new MemoryToolExecutor(memoryService, u.id, projectId, chatId);
      const res = await exec.execute({ id: 's', name: 'search_chats', input: { query: 'kvb debits' } }, new AbortController().signal);
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
});
