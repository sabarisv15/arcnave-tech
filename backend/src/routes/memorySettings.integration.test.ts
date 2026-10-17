/**
 * Memory and past-chat search are each the user's own setting (ADR-0052). The model is told it
 * cannot turn them off and names the setting; the setting has to exist and has to work, or that
 * sentence is a promise the product does not keep (Invariant 1). Off means no tool and no policy
 * text is sent, not merely an instruction to refrain.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp, promptOf } from '../test/harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_MEMORY: 'true' });
});
afterAll(async () => {
  await ctx.close();
});

async function prefs(user: TestUser) {
  const res = await ctx.app.inject({ method: 'GET', url: '/v1/preferences', headers: { cookie: user.cookie } });
  expect(res.statusCode).toBe(200);
  return res.json() as { memoryEnabled: boolean; chatSearchEnabled: boolean; version: number };
}

async function turn(user: TestUser) {
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
  const chatId = (chat.json() as { id: string }).id;
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie: user.cookie },
    payload: { prompt: 'hi' },
  });
  expect(res.statusCode).toBe(200);
  const seen = ctx.provider.seen.at(-1)!;
  return { system: promptOf(seen), declared: new Set((seen.tools ?? []).map((t) => t.name)) };
}

describe('memory and past-chat search are user settings', () => {
  it('are both on for a new account, and the model is told where each is switched off', async () => {
    const user = await signUp(ctx);
    const p = await prefs(user);
    expect(p.memoryEnabled).toBe(true);
    expect(p.chatSearchEnabled).toBe(true);

    const { system, declared } = await turn(user);
    expect(declared.has('memory_read')).toBe(true);
    expect(declared.has('conversation_search')).toBe(true);
    // v3 (ADR-0075): the memory rules are in the base; the memory-file rules and the snapshot
    // ride with the memory tools, the past-chat rules with theirs.
    expect(system).toContain('memory="on"');
    expect(system).toContain('<memory_files>');
    expect(system).toContain('<memory_snapshot version="');
    expect(system).toContain('<past_chats_policy>');
    expect(system).toContain('"Search and reference past chats" in Settings > Personalization');
  });

  it('memory off sends no memory tool and no memory text, and leaves past-chat search as set', async () => {
    const user = await signUp(ctx);
    const { version } = await prefs(user);
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: { cookie: user.cookie },
      payload: { memoryEnabled: false, version },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { memoryEnabled: boolean }).memoryEnabled).toBe(false);

    const { system, declared } = await turn(user);
    for (const t of ['memory_list', 'memory_read', 'memory_write', 'memory_append', 'memory_str_replace', 'memory_delete']) {
      expect(declared.has(t), t).toBe(false);
    }
    expect(system).not.toContain('<memory_files>');
    expect(system).not.toContain('<memory_listing>');
    expect(system).not.toContain('<memory_snapshot version="');
    expect(system).toContain('memory="off"');
    expect(declared.has('conversation_search')).toBe(true);
    expect(system).toContain('<past_chats_policy>');
  });

  it('past-chat search off sends none of its tools or rules, and leaves memory on', async () => {
    const user = await signUp(ctx);
    const { version } = await prefs(user);
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: { cookie: user.cookie },
      payload: { chatSearchEnabled: false, version },
    });

    const { system, declared } = await turn(user);
    for (const t of ['conversation_search', 'read_conversation', 'recent_chats']) expect(declared.has(t), t).toBe(false);
    expect(system).not.toContain('<past_chats_policy>');
    expect(declared.has('memory_read')).toBe(true);
    expect(system).toContain('<memory_files>');
  });
});
