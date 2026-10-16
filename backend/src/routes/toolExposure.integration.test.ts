/**
 * ADR-0006 end to end: what actually reaches the provider for a turn the router used to classify
 * as "no tools needed". The router unit tests prove the decision; these prove the request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp, promptOf } from '../test/harness.js';

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
    expect(promptOf(request)).not.toContain('<available_skills>\n');
  });

  it('tells the model which capabilities are on, and that a direct answer is fine (v3, CP-1)', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    expect(promptOf(request)).toContain('<capabilities_state web_search="off" fetch_url="off" file_search="off" run_code="off" memory="on"');
    expect(promptOf(request)).toContain('- Use a tool only when the task needs it.');
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
    expect(promptOf(request)).toContain('path="/skills/pdf-reading/SKILL.md"');
    expect(promptOf(request)).toContain('view the SKILL.md of each skill the task needs');
  });

  it('says to make an artifact when a file is asked for, to present it, and has no language rule (CXD-1)', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    const prompt = promptOf(request);
    expect(prompt).toContain('or when the user asks for a file, chart, deck, sheet or page');
    expect(prompt).toContain('Call present_files for every file the user should get');
    expect(prompt).not.toContain('Reply in the language and script the user writes in');
    expect(prompt).toContain('A skill read earlier in this conversation is still in context');
  });

  it('names no tool this turn cannot reach: memory off is stated, no memory-file rules, no dataset tools', async () => {
    const request = await sendTurn(ctx, user, 'hi');
    const prompt = promptOf(request);
    expect(prompt).not.toContain('<memory_files>');
    expect(prompt).not.toContain('dataset tools');
    expect(prompt).not.toContain('derived dataset versions');
    // The v3 base names memory_read in its memory rules; the flag says memory is off (CP-1).
    expect(prompt).toContain('memory="off"');
    expect((request.tools ?? []).map((t) => t.name)).not.toContain('memory_read');
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
    const prompt = promptOf(request);
    expect(prompt).not.toContain('<available_skills>\n');
    expect(prompt).toContain('run_code="off"');
    expect(prompt).not.toContain('<computer_use>');
    expect(prompt).not.toContain('<uploaded_files>');
  });
});
