/**
 * The system prompt may only name tools the turn can use. A prompt that tells the model to call
 * a tool the turn lacks, or offers research guidance with web search off, promises what the request cannot
 * keep (Invariant 1). The audit of 2026-09-26 found both; this test keeps them found.
 */
import { afterEach, describe, expect, it } from 'vitest';

import * as definitions from '../tools/definitions.js';
import type { TestContext } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

const TOOL_NAMES = [
  ...new Set(
    [...Object.values(definitions), definitions.codeToolDefinitions(true)]
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((v) => Boolean(v && typeof v === 'object' && 'name' in v && 'inputSchema' in v))
      .map((d) => (d as { name: string }).name),
  ),
];

interface Trace {
  allowedTools: string[];
}

async function turn(ctx: TestContext, prompt: string): Promise<{ system: string; allowed: Set<string>; grounded: boolean; declared: Set<string> }> {
  const user = await signUp(ctx);
  const chat = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers: { cookie: user.cookie },
    payload: { title: 'New conversation' },
  });
  const chatId = (chat.json() as { id: string }).id;
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie: user.cookie },
    payload: { prompt },
  });
  expect(response.statusCode).toBe(200);
  const traceLine = response.body
    .split('\n')
    .find((l) => l.startsWith('data:') && l.includes('"type":"debug"'));
  expect(traceLine, 'the turn emits its debug trace').toBeDefined();
  const trace = (JSON.parse(traceLine!.slice(5)) as { trace: Trace }).trace;
  const seen = ctx.provider.seen.at(-1)!;
  return {
    system: seen.systemInstruction ?? '',
    allowed: new Set(trace.allowedTools),
    grounded: seen.grounded,
    declared: new Set((seen.tools ?? []).map((t) => t.name)),
  };
}

function namedTools(system: string): string[] {
  return TOOL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(system));
}

const CONFIGS: Record<string, Record<string, string>> = {
  'tools and skills only': { ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true' },
  'with web': { ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true', ENABLE_WEB: 'true' },
  'with memory': { ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true', ENABLE_MEMORY: 'true' },
  'with generative UI': { ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true', ENABLE_GENERATIVE_UI: 'true' },
  'everything on': {
    ENABLE_TOOL_USE: 'true',
    ENABLE_SKILLS: 'true',
    ENABLE_WEB: 'true',
    ENABLE_MEMORY: 'true',
    ENABLE_GENERATIVE_UI: 'true',
    ENABLE_RUN_PYTHON: 'true',
  },
  'everything on, live search, no built-in search': {
    ENABLE_TOOL_USE: 'true',
    ENABLE_SKILLS: 'true',
    ENABLE_WEB: 'true',
    ENABLE_RUN_PYTHON: 'true',
    SERPAPI_API_KEY: 'test-key',
  },
};

describe('the system prompt names only tools the turn allows', () => {
  let ctx: TestContext | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('finds the tool names it checks', () => {
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['web_search', 'bash_tool', 'view', 'memory_read', 'conversation_search']));
  });

  for (const [label, env] of Object.entries(CONFIGS)) {
    it(label, async () => {
      ctx = await createTestApp(env);
      const { system, allowed, declared } = await turn(ctx, 'hi');
      const unavailable = namedTools(system).filter((name) => !allowed.has(name));
      expect(unavailable).toEqual([]);
      // "You have access to the X tool" is a promise the model acts on at once; it holds only
      // for a declared tool (a model calls only what is declared).
      const promised = [...system.matchAll(/access to the `?(\w+)`? tool/g)].map((m) => m[1]!);
      expect(promised.filter((name) => !declared.has(name))).toEqual([]);
    });
  }

  it('declares one web search: the built-in one when it is on, never a placeholder (ADR-0048)', async () => {
    // Built-in search on, no search provider: no web_search function (Anthropic rejects two tools
    // named web_search) and no image_search (nothing could answer it).
    ctx = await createTestApp(CONFIGS['with web']!);
    let t = await turn(ctx, 'hi');
    expect(t.grounded).toBe(true);
    expect([...t.declared]).toContain('web_fetch');
    expect([...t.declared]).not.toContain('web_search');
    expect([...t.declared]).not.toContain('image_search');
    expect(t.system).toContain('the built-in search\'s results are not links you can fetch');
    await ctx.close();

    // Built-in search on and a live provider: images come from the provider, search stays built in.
    ctx = await createTestApp({ ...CONFIGS['with web']!, SERPAPI_API_KEY: 'test-key' });
    t = await turn(ctx, 'hi');
    expect([...t.declared]).not.toContain('web_search');
    expect([...t.declared]).toContain('image_search');
    await ctx.close();

    // No built-in search: the provider's web_search is the search.
    ctx = await createTestApp(CONFIGS['everything on, live search, no built-in search']!);
    ctx.provider.grounding = false;
    t = await turn(ctx, 'hi');
    expect(t.grounded).toBe(false);
    expect([...t.declared]).toEqual(expect.arrayContaining(['web_search', 'web_fetch', 'image_search']));
    expect(t.system).toContain('Use web_search when information is');
    expect(t.system).not.toContain('not links you can fetch');
  });

  it('does not offer research guidance while web search is off', async () => {
    ctx = await createTestApp(CONFIGS['tools and skills only']!);
    const { system } = await turn(ctx, 'hi');
    expect(system).not.toContain('<research>');
  });

  it('offers them once web search is on', async () => {
    ctx = await createTestApp(CONFIGS['with web']!);
    const { system } = await turn(ctx, 'hi');
    expect(system).toContain('<research>');
  });

  it('gives the current date', async () => {
    ctx = await createTestApp(CONFIGS['tools and skills only']!);
    const { system } = await turn(ctx, 'hi');
    expect(system).toMatch(/The current date is \w+day, \w+ \d{1,2}, \d{4} \(time zone UTC\)\./);
  });

  it('offers the model its web search in Chat when the web is on, and says so without a discovery step', async () => {
    ctx = await createTestApp(CONFIGS['with web']!);
    const { system, grounded } = await turn(ctx, 'hi');
    expect(grounded).toBe(true);
    expect(system).toContain('web search (built in: search whenever it helps');
    expect(system).toContain('Search the web when information is');
  });

  it('does not offer web search in Chat while the web is off', async () => {
    ctx = await createTestApp(CONFIGS['tools and skills only']!);
    const { grounded } = await turn(ctx, 'hi');
    expect(grounded).toBe(false);
  });
});
