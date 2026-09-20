/**
 * `SemaphoreSandboxClient` against a fake `SandboxClient` and a fake `SandboxSemaphore` — this
 * decorator's whole job is claim-before/release-after sequencing, not Postgres correctness (that
 * lives in `semaphore.test.ts` against real Postgres), so a fake semaphore is the right double
 * here.
 */
import { describe, expect, it } from 'vitest';

import type { SandboxClient, SandboxExecutionResult } from './client.js';
import type { SandboxSemaphore } from './semaphore.js';
import { SemaphoreSandboxClient } from './semaphoreSandboxClient.js';

function fakeClient(
  impl: (code: string, signal: AbortSignal) => Promise<SandboxExecutionResult>,
): SandboxClient {
  return { runPython: impl };
}

function fakeSemaphore(claimId: string | null): { semaphore: SandboxSemaphore; released: string[] } {
  const released: string[] = [];
  const semaphore = {
    claim: async () => claimId,
    release: async (id: string) => {
      released.push(id);
    },
  } as unknown as SandboxSemaphore;
  return { semaphore, released };
}

describe('SemaphoreSandboxClient.runPython', () => {
  it('claims before calling the inner client and releases on success', async () => {
    const { semaphore, released } = fakeSemaphore('claim-1');
    const calls: string[] = [];
    const client = new SemaphoreSandboxClient(
      fakeClient(async (code) => {
        calls.push(code);
        return { outputs: [] };
      }),
      semaphore,
    );
    const result = await client.runPython('print(1)', new AbortController().signal);
    expect(result).toEqual({ outputs: [] });
    expect(calls).toEqual(['print(1)']);
    expect(released).toEqual(['claim-1']);
  });

  it('releases the claim even when the inner client throws', async () => {
    const { semaphore, released } = fakeSemaphore('claim-2');
    const client = new SemaphoreSandboxClient(
      fakeClient(async () => {
        throw new Error('sandbox failed');
      }),
      semaphore,
    );
    await expect(client.runPython('1/0', new AbortController().signal)).rejects.toThrow('sandbox failed');
    expect(released).toEqual(['claim-2']);
  });

  it('rejects without calling the inner client when the semaphore is at capacity', async () => {
    const { semaphore, released } = fakeSemaphore(null);
    let innerCalled = false;
    const client = new SemaphoreSandboxClient(
      fakeClient(async () => {
        innerCalled = true;
        return { outputs: [] };
      }),
      semaphore,
    );
    await expect(client.runPython('print(1)', new AbortController().signal)).rejects.toThrow(
      /at capacity/,
    );
    expect(innerCalled).toBe(false);
    expect(released).toEqual([]);
  });
});
