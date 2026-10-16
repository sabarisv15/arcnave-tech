/**
 * Build-3 decision #14 (ADR-0070), end to end: a sandbox with a staging bucket and no signing
 * account (SANDBOX_SIGNING_SA) fails a run that moves a file with the stable code
 * `sandbox_misconfigured`, which reaches the browser on the `tool_result` frame (Invariant 5).
 *
 * The chain: the real CloudRunSandboxClient (fake fetch and storage, no GCP call) inside the real
 * CodeExecutionToolExecutor produces the tool result; the turn streams that result through the
 * real generate route, whose provider is the harness fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CATALOG } from '../errors.js';
import { CodeExecutionToolExecutor } from '../tools/codeExecutionExecutor.js';
import { CloudRunSandboxClient } from '../tools/sandbox/cloudRunSandboxClient.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

function misconfiguredClient(): { client: CloudRunSandboxClient; calls: () => number; staged: string[] } {
  let calls = 0;
  const staged: string[] = [];
  const storage = {
    bucket: () => ({
      file: (name: string) => ({
        save: async () => {
          staged.push(name);
        },
      }),
      deleteFiles: async () => undefined,
    }),
  };
  const client = new CloudRunSandboxClient(
    {
      project: 'p',
      location: 'us-central1',
      jobName: 'arcnave-python-sandbox',
      getAccessToken: async () => 'fake-token',
      maxCodeBytes: 20 * 1024,
      codeTimeoutMs: 10_000,
      orchestrationTimeoutMs: 45_000,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      stagingBucket: 'test-staging-bucket',
      storageClient: storage as never,
    },
    (async () => {
      calls += 1;
      throw new Error('no network in tests');
    }) as unknown as typeof fetch,
  );
  return { client, calls: () => calls, staged };
}

describe('sandbox staging without a signing account (ADR-0070, decision #14)', () => {
  it('present_files fails with sandbox_misconfigured, and the code reaches the tool_result frame', async () => {
    const sandbox = misconfiguredClient();
    const executor = new CodeExecutionToolExecutor(sandbox.client, 8_000);
    const result = await executor.execute(
      { id: 'call-1', name: 'present_files', input: { filepaths: ['/mnt/user-data/outputs/chart.png'] } },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, errorCode: 'sandbox_misconfigured' });
    // The model is told why, in words it can pass on.
    expect((result.content[0] as { text: string }).text).toContain('SANDBOX_SIGNING_SA');
    // Nothing was staged and no job was launched.
    expect(sandbox.staged).toEqual([]);
    expect(sandbox.calls()).toBe(0);
    // A stable code with an entry in the catalog the frontend mirrors.
    expect(ERROR_CATALOG).toHaveProperty('sandbox_misconfigured');

    const created = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'Sandbox' } });
    const chatId = (created.json() as { id: string }).id;
    ctx.provider.script = [
      { type: 'tool_use', toolCallId: 'call-1', name: 'present_files', input: { filepaths: ['/mnt/user-data/outputs/chart.png'] } },
      { type: 'tool_result', toolCallId: 'call-1', name: 'present_files', result },
      { type: 'delta', text: 'The file could not be shared.' },
      { type: 'completed', usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
    ];
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { cookie: user.cookie },
      payload: { prompt: 'Make me a chart' },
    });
    expect(response.statusCode).toBe(200);
    const frame = parseSse(response.body).find((f) => f.event === 'tool_result');
    expect(frame?.data).toMatchObject({ ok: false, errorCode: 'sandbox_misconfigured' });
  });

  it('a failure without a code carries no errorCode on the frame', async () => {
    const executor = new CodeExecutionToolExecutor(
      {
        runPython: async () => {
          throw new Error('sandbox quota exceeded');
        },
      },
      8_000,
    );
    const result = await executor.execute({ id: 'b', name: 'bash_tool', input: { command: 'ls', description: 'x' } }, new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('errorCode');
  });
});
