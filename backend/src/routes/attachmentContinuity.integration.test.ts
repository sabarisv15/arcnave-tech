/**
 * Phase 2 of the tools pipeline plan: attachments keep one identity (G26) and reach the sandbox
 * by fileId, for this turn's files and earlier ones.
 *
 * The provider is faked; its `onRequest` hook calls the real `toolExecutor` from the request,
 * which is exactly what a provider adapter does when the model emits a `bash_tool` call. The
 * sandbox is the real local process sandbox, so a file is only "materialised" if Python can
 * actually open it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GenerationRequest, ToolResult } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;
let other: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({
    ENABLE_TOOL_USE: 'true',
    ENABLE_RUN_PYTHON: 'true',
    SANDBOX_ENGINE: 'process',
  });
  user = await signUp(ctx);
  other = await signUp(ctx, 'Other');
});

afterEach(() => {
  ctx.provider.onRequest = null;
});

afterAll(async () => {
  await ctx.close();
});

async function upload(owner: TestUser, filename: string, content: string): Promise<string> {
  const part = multipart(filename, content, 'text/csv');
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: { ...part.headers, cookie: owner.cookie },
    payload: part.payload,
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function newChat(): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers: { cookie: user.cookie },
    payload: { title: 'New conversation' },
  });
  return (response.json() as { id: string }).id;
}

async function generate(chatId: string, payload: Record<string, unknown>): Promise<void> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie: user.cookie },
    payload,
  });
  expect(response.statusCode).toBe(200);
}

/** Run one bash_tool call through the request's real executor, on the first request only. */
function runBashOnce(command: string): { result: () => ToolResult; toolNames: () => string[] } {
  return runToolOnce('bash_tool', { command, description: 'read the files' });
}

function runToolOnce(
  name: string,
  input: Record<string, unknown>,
): { result: () => ToolResult; toolNames: () => string[] } {
  let captured: ToolResult | undefined;
  let names: string[] = [];
  ctx.provider.onRequest = async (request: GenerationRequest) => {
    if (captured || !request.toolExecutor) return;
    names = (request.tools ?? []).map((t) => t.name);
    captured = await request.toolExecutor.execute(
      { id: 'call-1', name, input },
      new AbortController().signal,
    );
  };
  return {
    result: () => {
      expect(captured, `${name} was never executed`).toBeDefined();
      return captured!;
    },
    toolNames: () => names,
  };
}

function data(result: ToolResult): { stdout: string; inputFiles?: Array<{ fileId: string; path: string }> } {
  const json = result.content.find((c) => c.type === 'json') as { data: unknown } | undefined;
  return json!.data as { stdout: string; inputFiles?: Array<{ fileId: string; path: string }> };
}

const readAll = (paths: string[]) => paths.map((p) => `cat ${p}; echo`).join('; ');

describe('G26: every file of the chat is on the computer at its manifest path', () => {
  it('every conversation file is already in input/ at the manifest path', async () => {
    const older = await upload(user, 'old ledger.csv', 'older-file');
    const chatId = await newChat();
    await generate(chatId, { prompt: 'Here is the old one', attachmentIds: [older] });
    const current = await upload(user, 'sales.csv', 'current-file');

    let prompt = '';
    const run = runBashOnce(readAll(['input/old_ledger.csv', 'input/sales.csv']));
    const capture = ctx.provider.onRequest!;
    ctx.provider.onRequest = async (request: GenerationRequest) => {
      prompt ||= request.prompt;
      await capture(request);
    };
    await generate(chatId, { prompt: 'Compare both files', attachmentIds: [current] });

    expect(prompt).toContain('path: input/old_ledger.csv');
    expect(prompt).toContain('path: input/sales.csv');
    expect(prompt).toContain('also on the computer at its path');
    const result = run.result();
    expect(result.ok).toBe(true);
    expect(data(result).stdout).toBe('older-file\ncurrent-file\n');
  });

  it('chat path: this turn\'s attachment is in input/', async () => {
    const fileId = await upload(user, 'sales.csv', 'month,total\njan,10');
    const chatId = await newChat();
    const run = runBashOnce(readAll(['input/sales.csv']));
    await generate(chatId, { prompt: 'Sum the totals', attachmentIds: [fileId] });

    const result = run.result();
    expect(result.ok).toBe(true);
    expect(data(result).stdout).toContain('jan,10');
  });

  it('historical attachment: a turn-1 file is still in input/ on turn 2', async () => {
    const fileId = await upload(user, 'ledger.csv', 'row,amount\n1,99');
    const chatId = await newChat();
    await generate(chatId, { prompt: 'Here is my ledger', attachmentIds: [fileId] });

    const run = runBashOnce(readAll(['input/ledger.csv']));
    await generate(chatId, { prompt: 'Use that file and count the rows' });

    const result = run.result();
    expect(result.ok).toBe(true);
    expect(data(result).stdout).toContain('1,99');
  });

  it('two files with the same filename stay distinct, resolved by fileId', async () => {
    const first = await upload(user, 'data.csv', 'first-file');
    const second = await upload(user, 'data.csv', 'second-file');
    const chatId = await newChat();
    const suffixed = `input/data_${second.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}.csv`;
    const run = runBashOnce(readAll(['input/data.csv', suffixed]));
    await generate(chatId, { prompt: 'Compare them', attachmentIds: [first, second] });

    const result = run.result();
    expect(result.ok).toBe(true);
    expect(data(result).stdout).toBe('first-file\nsecond-file\n');
  });

  it('another user\'s file never reaches this chat\'s input/', async () => {
    await upload(other, 'secret.csv', 'not yours');
    const chatId = await newChat();
    const mine = await upload(user, 'mine.csv', 'mine');
    const run = runBashOnce('ls input/');
    await generate(chatId, { prompt: 'Read it', attachmentIds: [mine] });

    const result = run.result();
    expect(result.ok).toBe(true);
    expect(data(result).stdout).toContain('mine.csv');
    expect(data(result).stdout).not.toContain('secret.csv');
  });
});
