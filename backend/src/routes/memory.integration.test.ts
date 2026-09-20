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
});
