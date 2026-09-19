/**
 * `CodeExecutionToolExecutor` against a fake `SandboxClient` — this executor's whole job is
 * shaping the call/result, not talking to a database, so a real Postgres harness (as
 * `ProjectToolExecutor`'s tests use) would prove nothing extra here.
 */
import { describe, expect, it } from 'vitest';

import type { SandboxClient, SandboxExecutionResult } from './sandbox/client.js';
import { CodeExecutionToolExecutor } from './codeExecutionExecutor.js';

function fakeClient(
  impl: (code: string, signal: AbortSignal) => Promise<SandboxExecutionResult>,
): SandboxClient {
  return { runPython: impl };
}

describe('CodeExecutionToolExecutor.execute', () => {
  it('returns bounded json content on a successful run', async () => {
    const executor = new CodeExecutionToolExecutor(
      fakeClient(async () => ({
        outputs: [{ mimeType: 'application/json', text: JSON.stringify({ msg_out: 'hi\n', msg_err: '' }) }],
      })),
      8000,
    );
    const result = await executor.execute(
      { id: 'call-1', name: 'run_python', input: { code: 'print("hi")' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    const block = result.content[0];
    if (!block || block.type !== 'json') throw new Error('expected a json content block');
    expect(block.data).toMatchObject({ stdout: 'hi\n', stderr: '', truncated: false });
  });

  it('rejects a missing code field without throwing', async () => {
    const executor = new CodeExecutionToolExecutor(
      fakeClient(async () => ({ outputs: [] })),
      8000,
    );
    const result = await executor.execute(
      { id: 'call-2', name: 'run_python', input: {} },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('Invalid input');
  });

  it('turns a SandboxClient rejection into a failed result, never a throw', async () => {
    const executor = new CodeExecutionToolExecutor(
      fakeClient(async () => {
        throw new Error('sandbox quota exceeded');
      }),
      8000,
    );
    const result = await executor.execute(
      { id: 'call-3', name: 'run_python', input: { code: '1/0' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('sandbox quota exceeded');
  });

  it('truncates output longer than the configured max and flags it', async () => {
    const executor = new CodeExecutionToolExecutor(
      fakeClient(async () => ({
        outputs: [{ mimeType: 'application/json', text: JSON.stringify({ msg_out: 'x'.repeat(100), msg_err: '' }) }],
      })),
      10,
    );
    const result = await executor.execute(
      { id: 'call-4', name: 'run_python', input: { code: 'print("x" * 100)' } },
      new AbortController().signal,
    );
    const block = result.content[0];
    if (!block || block.type !== 'json') throw new Error('expected a json content block');
    const data = block.data as { stdout: string; truncated: boolean };
    expect(data.stdout.length).toBeLessThanOrEqual(10);
    expect(data.truncated).toBe(true);
  });

  it('refuses to run when the signal is already aborted, without calling the client', async () => {
    let called = false;
    const executor = new CodeExecutionToolExecutor(
      fakeClient(async () => {
        called = true;
        return { outputs: [] };
      }),
      8000,
    );
    const controller = new AbortController();
    controller.abort();
    const result = await executor.execute(
      { id: 'call-5', name: 'run_python', input: { code: 'print(1)' } },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('aborted');
    expect(called).toBe(false);
  });
});
