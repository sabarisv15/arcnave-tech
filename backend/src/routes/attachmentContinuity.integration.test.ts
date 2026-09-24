/**
 * Phase 2 of the tools pipeline plan: attachments keep one identity (G26) and reach the sandbox
 * by fileId, on the chat path and the AgentLoop path, for this turn's files and earlier ones.
 *
 * The provider is faked; its `onRequest` hook calls the real `toolExecutor` from the request,
 * which is exactly what a provider adapter does when the model emits a `run_python` call. The
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
    ENABLE_AGENT_LOOP: 'true',
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

/** Run one run_python call through the request's real executor, on the first request only. */
function runPythonOnce(input: Record<string, unknown>): { result: () => ToolResult; toolNames: () => string[] } {
  return runToolOnce('run_python', input);
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

const readAll = (paths: string[]) =>
  paths.map((p) => `print(open(${JSON.stringify(p)}).read().strip())`).join('\n');

describe('G26: attachments reach the sandbox by fileId', () => {
  it('chat path: this turn\'s attachment is materialised into input/', async () => {
    const fileId = await upload(user, 'sales.csv', 'month,total\njan,10');
    const chatId = await newChat();
    const run = runPythonOnce({ code: readAll(['input/sales.csv']), input_files: [fileId] });
    await generate(chatId, { prompt: 'Sum the totals', attachmentIds: [fileId] });

    const result = run.result();
    expect(result.ok).toBe(true);
    expect(data(result).stdout).toContain('jan,10');
    expect(data(result).inputFiles).toEqual([{ fileId, path: 'input/sales.csv' }]);
  });

  it('historical attachment: a turn-1 file is materialised on turn 2 by its fileId', async () => {
    const fileId = await upload(user, 'ledger.csv', 'row,amount\n1,99');
    const chatId = await newChat();
    await generate(chatId, { prompt: 'Here is my ledger', attachmentIds: [fileId] });

    const run = runPythonOnce({ code: readAll(['input/ledger.csv']), input_files: [fileId] });
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
    const run = runPythonOnce({ code: readAll(['input/data.csv', suffixed]), input_files: [first, second] });
    await generate(chatId, { prompt: 'Compare them', attachmentIds: [first, second] });

    const result = run.result();
    expect(result.ok).toBe(true);
    expect(data(result).inputFiles).toEqual([
      { fileId: first, path: 'input/data.csv' },
      { fileId: second, path: suffixed },
    ]);
    expect(data(result).stdout).toBe('first-file\nsecond-file\n');
  });

  it('another user\'s fileId is refused and nothing is materialised', async () => {
    const foreign = await upload(other, 'secret.csv', 'not yours');
    const chatId = await newChat();
    const run = runPythonOnce({ code: 'print(1)', input_files: [foreign] });
    await generate(chatId, { prompt: 'Read it' });

    const result = run.result();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.content)).toContain('was not found, or you do not have access to it');
  });

  it('AgentLoop path: an attachment is materialised the same way', async () => {
    const fileId = await upload(user, 'agent.csv', 'agent-row');
    const chatId = await newChat();
    const run = runPythonOnce({ code: readAll(['input/agent.csv']), input_files: [fileId] });
    // Research mode routes to AgentLoop. "python" is in the prompt because AgentLoop still
    // gates run_python on wording until Phase 4 (G4).
    await generate(chatId, { prompt: 'Use python to read this file', mode: 'research', attachmentIds: [fileId] });

    const result = run.result();
    expect(result.ok).toBe(true);
    expect(data(result).stdout).toContain('agent-row');
    // Goal tools are only declared by AgentLoop, so this proves which path served the turn.
    expect(run.toolNames()).toContain('get_goal');
  });
});

describe('G6: earlier-turn attachments count as available', () => {
  const findReader = () => runToolOnce('search_tools', { query: 'read uploaded file attachment' });

  it('turn 2 without a new upload can still discover read_uploaded_file', async () => {
    const fileId = await upload(user, 'notes.csv', 'a,b');
    const chatId = await newChat();
    await generate(chatId, { prompt: 'Here is a file', attachmentIds: [fileId] });

    const search = findReader();
    await generate(chatId, { prompt: 'Now use that file' });
    expect(JSON.stringify(search.result().content)).toContain('read_uploaded_file');
  });

  it('a chat that never had an attachment does not offer it', async () => {
    const chatId = await newChat();
    const search = findReader();
    await generate(chatId, { prompt: 'Hello there' });
    expect(JSON.stringify(search.result().content)).not.toContain('read_uploaded_file');
  });
});
