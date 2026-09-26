/**
 * The system prompt may only name tools the turn can use. A prompt that tells the model to call
 * get_goal, or offers a research skill with web search off, promises what the request cannot
 * keep (Invariant 1). The audit of 2026-09-26 found both; this test keeps them found.
 */
import { afterEach, describe, expect, it } from 'vitest';

import * as definitions from '../tools/definitions.js';
import type { TestContext } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

const TOOL_NAMES = [
  ...new Set(
    Object.values(definitions)
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((v) => Boolean(v && typeof v === 'object' && 'name' in v && 'inputSchema' in v))
      .map((d) => (d as { name: string }).name),
  ),
];

interface Trace {
  allowedTools: string[];
}

async function turn(ctx: TestContext, prompt: string): Promise<{ system: string; allowed: Set<string> }> {
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
  return { system: ctx.provider.seen.at(-1)!.systemInstruction ?? '', allowed: new Set(trace.allowedTools) };
}

function namedTools(system: string): string[] {
  return TOOL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(system));
}

const CONFIGS: Record<string, Record<string, string>> = {
  'tools and skills only': { ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true' },
  'with web': { ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true', ENABLE_WEB: 'true' },
  'with memory': { ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true', ENABLE_MEMORY: 'true' },
  'with generative UI': { ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true', ENABLE_GENERATIVE_UI: 'true' },
};

describe('the system prompt names only tools the turn allows', () => {
  let ctx: TestContext | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('finds the tool names it checks', () => {
    expect(TOOL_NAMES).toEqual(expect.arrayContaining(['search_tools', 'get_goal', 'web_search', 'run_python']));
  });

  for (const [label, env] of Object.entries(CONFIGS)) {
    it(label, async () => {
      ctx = await createTestApp(env);
      const { system, allowed } = await turn(ctx, 'hi');
      const unavailable = namedTools(system).filter((name) => !allowed.has(name));
      expect(unavailable).toEqual([]);
    });
  }

  it('does not offer the research skill, or research guidance, while web search is off', async () => {
    ctx = await createTestApp(CONFIGS['tools and skills only']!);
    const { system } = await turn(ctx, 'hi');
    expect(system).not.toContain('research-deep-dive');
    expect(system).not.toContain('<research>');
  });

  it('offers them once web search is on', async () => {
    ctx = await createTestApp(CONFIGS['with web']!);
    const { system } = await turn(ctx, 'hi');
    expect(system).toContain('- research-deep-dive:');
    expect(system).toContain('<research>');
  });

  it('gives the current date', async () => {
    ctx = await createTestApp(CONFIGS['tools and skills only']!);
    const { system } = await turn(ctx, 'hi');
    expect(system).toMatch(/The current date is \w+day, \w+ \d{1,2}, \d{4} \(time zone UTC\)\./);
  });
});
