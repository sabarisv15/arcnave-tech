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
    it(`"${prompt}" reaches the provider with the same declared tools, and nothing to discover`, async () => {
      const request = await sendTurn(ctx, user, prompt);
      const names = (request.tools ?? []).map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['ask_user_input_v0']));
      expect(names).not.toContain('create_artifact');
      expect(names).not.toContain('search_tools');
      expect(names).not.toContain('load_skill');
    });
  }

  it('lists no skill on a turn without the computer: skills are read with view (G7)', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(request.systemInstruction).not.toContain('<available_skills>');
  });

  it('tells the model what is declared and that a direct answer is fine', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(request.systemInstruction).toContain(`Declared on this turn: ${(request.tools ?? []).map((tool) => tool.name).join(', ')}`);
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

  it('declares the computer, and lists each skill at the path view reads it from', async () => {
    const request = await sendTurn(ctx, user, 'itha tally la import panra mari json file ah kudu');
    expect((request.tools ?? []).map((t) => t.name)).toEqual(
      expect.arrayContaining(['bash_tool', 'view', 'create_file', 'str_replace', 'present_files']),
    );
    expect(request.systemInstruction).toContain('<location>/skills/pdf-reading/SKILL.md</location>');
    expect(request.systemInstruction).toContain('view the SKILL.md of every skill that plausibly applies');
  });

  it('says to settle the request first, to answer a file request with a file, and in the user\'s script', async () => {
    const { systemInstruction } = await sendTurn(ctx, user, 'hi');
    expect(systemInstruction).toContain('## Understand the request first');
    expect(systemInstruction).toContain('not with its contents pasted into chat');
    expect(systemInstruction).toContain('Call present_files for every file the user should get');
    expect(systemInstruction).not.toContain('Reply in the language and script the user writes in');
    expect(systemInstruction).toContain('A skill read earlier in this conversation is still in context');
  });

  it('names no tool this turn cannot reach: no memory policy with memory off, no dataset tools', async () => {
    const { systemInstruction } = await sendTurn(ctx, user, 'hi');
    expect(systemInstruction).not.toContain('<memory_policy>');
    expect(systemInstruction).not.toContain('dataset tools');
    expect(systemInstruction).not.toContain('derived dataset versions');
    expect(systemInstruction).not.toContain('memory_read');
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
    expect(request.systemInstruction).not.toContain('bash_tool');
    expect(request.systemInstruction).not.toContain('<computer_use>');
  });
});
