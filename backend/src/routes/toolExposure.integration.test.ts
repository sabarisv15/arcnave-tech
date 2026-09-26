/**
 * ADR-0006 end to end: what actually reaches the provider for a turn the router used to classify
 * as "no tools needed". The router unit tests prove the decision; these prove the request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

async function sendTurn(ctx: TestContext, user: TestUser, prompt: string) {
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
  return ctx.provider.seen.at(-1)!;
}

describe('tool exposure with tool use on (ADR-0006)', () => {
  let ctx: TestContext;
  let user: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_SKILLS: 'true' });
    user = await signUp(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  for (const prompt of ['hi', 'explain Monte Carlo simulation', 'Count every transaction exactly and classify them']) {
    it(`"${prompt}" reaches the provider with search_tools and load_skill declared`, async () => {
      const request = await sendTurn(ctx, user, prompt);
      const names = (request.tools ?? []).map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['search_tools', 'load_skill']));
    });
  }

  it('advertises skills only alongside a load_skill the model can call (G7)', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(request.systemInstruction).toContain('<available_skills>');
    expect((request.tools ?? []).map((t) => t.name)).toContain('load_skill');
  });

  it('tells the model what is declared and that a direct answer is fine', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(request.systemInstruction).toContain('Declared on this turn: search_tools, load_skill, generate_deliverable');
    expect(request.systemInstruction).toContain('When a direct answer is enough, answer directly without tools.');
  });
});

describe('the prompt and tools a file turn starts with (ADR-0022)', () => {
  let ctx: TestContext;
  let user: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp({
      ENABLE_TOOL_USE: 'true',
      ENABLE_RUN_PYTHON: 'true',
      SANDBOX_ENGINE: 'process',
      ENABLE_MEMORY: 'false',
    });
    user = await signUp(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('declares the tools file work needs, so no search_tools round comes first', async () => {
    const request = await sendTurn(ctx, user, 'itha tally la import panra mari json file ah kudu');
    expect((request.tools ?? []).map((t) => t.name)).toEqual(
      expect.arrayContaining(['search_tools', 'load_skill', 'run_python', 'generate_deliverable']),
    );
  });

  it('says to settle the request first, to answer a file request with a file, and in the user\'s script', async () => {
    const { systemInstruction } = await sendTurn(ctx, user, 'hi');
    expect(systemInstruction).toContain('## Understand the request first');
    expect(systemInstruction).toContain('never with its contents pasted into chat');
    expect(systemInstruction).toContain('any other format (JSON, CSV, XML, TXT, Markdown, HTML, ZIP, images): run_python, writing the file to "output/"');
    expect(systemInstruction).toContain('Reply in the language and script the user writes in');
    expect(systemInstruction).toContain('A skill loaded earlier in this conversation is still in context');
  });

  it('names no tool this turn cannot reach: no memory policy with memory off, no dataset tools', async () => {
    const { systemInstruction } = await sendTurn(ctx, user, 'hi');
    expect(systemInstruction).not.toContain('<memory_policy>');
    expect(systemInstruction).not.toContain('dataset tools');
    expect(systemInstruction).not.toContain('derived dataset versions');
    expect(systemInstruction).toContain('=== DATA ANALYTICS POLICY ===');
  });
});

describe('tool exposure with tool use off (G7, Invariant 1)', () => {
  let ctx: TestContext;
  let user: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp({ ENABLE_TOOL_USE: 'false', ENABLE_SKILLS: 'true' });
    user = await signUp(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('sends no tools and names no tool or skill it cannot reach', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(request.tools ?? []).toEqual([]);
    expect(request.systemInstruction).not.toContain('<available_skills>');
    expect(request.systemInstruction).not.toContain('load_skill');
    expect(request.systemInstruction).not.toContain('search_tools');
  });
});
