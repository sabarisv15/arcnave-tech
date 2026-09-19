/**
 * CloudRunSandboxClient against a fake `fetch` — this is an HTTP client, so its tests prove
 * request shapes, Operation/Execution polling, and result-log correlation, never a real GCP call.
 */
import { describe, expect, it, vi } from 'vitest';

import { CloudRunSandboxClient } from './cloudRunSandboxClient.js';

const RESULT_PREFIX = 'ARCNAVE_SANDBOX_RESULT:';

// runPython generates a fresh execution id per call via crypto.randomUUID(); pinning it lets the
// fake Cloud Logging responses below embed a matching executionId deterministically.
vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
  'exec-1' as `${string}-${string}-${string}-${string}-${string}`,
);

function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(
  fetchMock: typeof fetch,
  overrides: Partial<{
    maxCodeBytes: number;
    codeTimeoutMs: number;
    orchestrationTimeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
  }> = {},
): CloudRunSandboxClient {
  return new CloudRunSandboxClient(
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
      ...overrides,
    },
    fetchMock,
  );
}

function resultLine(
  overrides: Partial<{
    executionId: string;
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    timedOut: boolean;
  }> = {},
): string {
  return (
    RESULT_PREFIX +
    JSON.stringify({
      type: 'arcnave.run_python.result.v1',
      executionId: 'exec-1',
      ok: true,
      exitCode: 0,
      stdout: 'hello\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      durationMs: 41,
      ...overrides,
    })
  );
}

function runningFullFlowFetch(logEntries: () => { textPayload?: string }[]) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.endsWith(':run')) {
      return jsonResponse({
        done: true,
        response: { name: 'projects/p/locations/us-central1/jobs/arcnave-python-sandbox/executions/e1' },
      });
    }
    if (u.includes('/jobs/arcnave-python-sandbox/executions/e1') && method === 'GET') {
      return jsonResponse({
        name: 'projects/p/locations/us-central1/jobs/arcnave-python-sandbox/executions/e1',
        completionTime: '2026-09-19T00:00:00Z',
        succeededCount: 1,
        failedCount: 0,
        cancelledCount: 0,
      });
    }
    if (u.endsWith('/entries:list') && method === 'POST') {
      return jsonResponse({ entries: logEntries() });
    }
    throw new Error(`unexpected call: ${method} ${u}`);
  });
}

describe('CloudRunSandboxClient.runPython — size guard', () => {
  it('rejects code over maxCodeBytes without making any request', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch, { maxCodeBytes: 10 });
    await expect(client.runPython('x'.repeat(11), new AbortController().signal)).rejects.toThrow(/10-byte/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts code exactly at maxCodeBytes (does not reject on size)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network reached — not what this test checks');
    });
    const client = makeClient(fetchMock as unknown as typeof fetch, { maxCodeBytes: 5 });
    await expect(client.runPython('x'.repeat(5), new AbortController().signal)).rejects.toThrow(
      'network reached — not what this test checks',
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('propagates an already-aborted signal without making any request', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(client.runPython('x', controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('CloudRunSandboxClient — job launch and Operation resolution', () => {
  it('POSTs jobs:run with base64 code, code timeout, and execution id as container overrides', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({
        url: u,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
      });
      if (u.endsWith(':run')) {
        return jsonResponse({
          name: 'projects/p/locations/us-central1/operations/op1',
          done: true,
          response: { name: 'projects/p/locations/us-central1/jobs/arcnave-python-sandbox/executions/e1' },
        });
      }
      throw new Error(`unexpected call: ${u}`);
    });

    const client = makeClient(fetchMock as unknown as typeof fetch);
    const op = await (
      client as unknown as {
        runJob(executionId: string, code: string, signal: AbortSignal): Promise<unknown>;
      }
    ).runJob('exec-1', 'print(1)', new AbortController().signal);
    expect(op).toBeDefined();

    const runCall = calls.find((c) => c.url.endsWith(':run'));
    expect(runCall?.body).toEqual({
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: 'RUN_PYTHON_CODE_B64', value: b64('print(1)') },
              { name: 'RUN_PYTHON_CODE_TIMEOUT_MS', value: '10000' },
              { name: 'RUN_PYTHON_EXECUTION_ID', value: 'exec-1' },
            ],
          },
        ],
        taskCount: 1,
      },
    });
  });

  it('resolveExecutionName reads the execution name straight off a done Operation response', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const name = await (
      client as unknown as {
        resolveExecutionName(op: unknown, signal: AbortSignal): Promise<string>;
      }
    ).resolveExecutionName(
      { done: true, response: { name: 'projects/p/locations/us-central1/jobs/j/executions/e1' } },
      new AbortController().signal,
    );
    expect(name).toBe('projects/p/locations/us-central1/jobs/j/executions/e1');
  });

  it('resolveExecutionName polls the Operation until its metadata carries an execution name', async () => {
    let polls = 0;
    const fetchMock = vi.fn(async () => {
      polls += 1;
      if (polls < 2) {
        return jsonResponse({ name: 'operations/op1', done: false });
      }
      return jsonResponse({
        name: 'operations/op1',
        done: false,
        metadata: { name: 'projects/p/locations/us-central1/jobs/j/executions/e1' },
      });
    });
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const name = await (
      client as unknown as {
        resolveExecutionName(op: unknown, signal: AbortSignal): Promise<string>;
      }
    ).resolveExecutionName({ name: 'operations/op1', done: false }, new AbortController().signal);
    expect(name).toBe('projects/p/locations/us-central1/jobs/j/executions/e1');
    expect(polls).toBe(2);
  });

  it('resolveExecutionName throws if the Operation finishes with no execution name anywhere', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(
      (
        client as unknown as {
          resolveExecutionName(op: unknown, signal: AbortSignal): Promise<string>;
        }
      ).resolveExecutionName({ done: true }, new AbortController().signal),
    ).rejects.toThrow(/no execution name/);
  });
});

describe('CloudRunSandboxClient — Execution polling and terminal state', () => {
  it('polls executions.get until completionTime is set', async () => {
    let polls = 0;
    const fetchMock = vi.fn(async () => {
      polls += 1;
      if (polls < 3) {
        return jsonResponse({ name: 'projects/p/locations/us-central1/jobs/j/executions/e1' });
      }
      return jsonResponse({
        name: 'projects/p/locations/us-central1/jobs/j/executions/e1',
        completionTime: '2026-09-19T00:00:00Z',
        succeededCount: 1,
        failedCount: 0,
        cancelledCount: 0,
      });
    });
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const execution = await (
      client as unknown as {
        pollExecutionUntilTerminal(name: string, signal: AbortSignal): Promise<{ completionTime?: string }>;
      }
    ).pollExecutionUntilTerminal(
      'projects/p/locations/us-central1/jobs/j/executions/e1',
      new AbortController().signal,
    );
    expect(execution.completionTime).toBe('2026-09-19T00:00:00Z');
    expect(polls).toBe(3);
  });

  it('assertSucceeded passes when succeededCount is 1', () => {
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    expect(() =>
      (client as unknown as { assertSucceeded(e: unknown): void }).assertSucceeded({
        name: 'e1',
        completionTime: 't',
        succeededCount: 1,
        failedCount: 0,
        cancelledCount: 0,
      }),
    ).not.toThrow();
  });

  it('assertSucceeded throws with the condition message when failedCount is 1', () => {
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    expect(() =>
      (client as unknown as { assertSucceeded(e: unknown): void }).assertSucceeded({
        name: 'e1',
        completionTime: 't',
        succeededCount: 0,
        failedCount: 1,
        cancelledCount: 0,
        conditions: [
          { type: 'Completed', state: 'CONDITION_FAILED', reason: 'NON_ZERO_EXIT_CODE', message: 'container exited 1' },
        ],
      }),
    ).toThrow(/container exited 1/);
  });

  it('assertSucceeded throws for a cancelled execution', () => {
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    expect(() =>
      (client as unknown as { assertSucceeded(e: unknown): void }).assertSucceeded({
        name: 'e1',
        completionTime: 't',
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 1,
        conditions: [{ message: 'CANCELLED' }],
      }),
    ).toThrow(/CANCELLED/);
  });
});

describe('CloudRunSandboxClient.runPython — full flow', () => {
  it('runs the whole flow and maps the result line into msg_out/msg_err outputs', async () => {
    const fetchMock = runningFullFlowFetch(() => [{ textPayload: resultLine() }]);
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const result = await client.runPython('print("hello")', new AbortController().signal);
    expect(result.outputs).toEqual([
      { mimeType: 'application/json', text: JSON.stringify({ msg_out: 'hello\n', msg_err: '' }) },
    ]);
  });

  it('retries the log poll when the result line appears a few polls late', async () => {
    let logPolls = 0;
    const fetchMock = runningFullFlowFetch(() => {
      logPolls += 1;
      return logPolls < 3 ? [] : [{ textPayload: resultLine() }];
    });
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const result = await client.runPython('print("hello")', new AbortController().signal);
    expect(result.outputs[0]?.text).toContain('hello');
    expect(logPolls).toBeGreaterThanOrEqual(3);
  });

  it('ignores a log entry whose embedded executionId does not match, and picks the correct one', async () => {
    const fetchMock = runningFullFlowFetch(() => [
      { textPayload: resultLine({ executionId: 'some-other-execution', stdout: 'WRONG\n' }) },
      { textPayload: resultLine({ executionId: 'exec-1', stdout: 'right\n' }) },
    ]);
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const result = await client.runPython('print("right")', new AbortController().signal);
    expect(result.outputs[0]?.text).toContain('right');
    expect(result.outputs[0]?.text).not.toContain('WRONG');
  });

  it('throws if no matching result line ever appears within the bounded retry window', async () => {
    const fetchMock = runningFullFlowFetch(() => []);
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.runPython('print(1)', new AbortController().signal)).rejects.toThrow(
      /no matching result log/,
    );
  });

  it('skips a malformed (non-JSON) result line and keeps looking', async () => {
    const fetchMock = runningFullFlowFetch(() => [
      { textPayload: RESULT_PREFIX + '{not json' },
      { textPayload: resultLine() },
    ]);
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const result = await client.runPython('print("hello")', new AbortController().signal);
    expect(result.outputs[0]?.text).toContain('hello');
  });

  it('throws when the execution itself reports failure, without ever polling logs', async () => {
    let logCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith(':run')) {
        return jsonResponse({
          done: true,
          response: { name: 'projects/p/locations/us-central1/jobs/arcnave-python-sandbox/executions/e1' },
        });
      }
      if (u.includes('/executions/e1') && method === 'GET') {
        return jsonResponse({
          name: 'projects/p/locations/us-central1/jobs/arcnave-python-sandbox/executions/e1',
          completionTime: '2026-09-19T00:00:00Z',
          succeededCount: 0,
          failedCount: 1,
          cancelledCount: 0,
          conditions: [{ message: 'container exited 137' }],
        });
      }
      if (u.endsWith('/entries:list')) {
        logCalls += 1;
        return jsonResponse({ entries: [] });
      }
      throw new Error(`unexpected call: ${method} ${u}`);
    });
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.runPython('print(1)', new AbortController().signal)).rejects.toThrow(/container exited 137/);
    expect(logCalls).toBe(0);
  });
});

describe('CloudRunSandboxClient — runWithOverrides request shape', () => {
  it('always sends overrides on the jobs:run call (regression guard for the IAM permission requirement)', async () => {
    const fetchMock = runningFullFlowFetch(() => [{ textPayload: resultLine() }]);
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await client.runPython('print("hello")', new AbortController().signal);
    const runCallArgs = (fetchMock.mock.calls as [string, RequestInit][]).find(([url]) => url.endsWith(':run'));
    expect(runCallArgs).toBeDefined();
    const body = JSON.parse(runCallArgs![1].body as string) as { overrides?: unknown };
    expect(body.overrides).toBeDefined();
  });
});

describe('CloudRunSandboxClient — orchestration timeout', () => {
  it('aborts and throws once orchestrationTimeoutMs elapses, independent of codeTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });
      const client = makeClient(fetchMock as unknown as typeof fetch, {
        codeTimeoutMs: 10_000,
        orchestrationTimeoutMs: 5_000,
      });
      const resultPromise = client.runPython('while True: pass', new AbortController().signal);
      const assertion = expect(resultPromise).rejects.toThrow(/5000ms deadline/);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends codeTimeoutMs to the container even though it is smaller than orchestrationTimeoutMs', async () => {
    const calls: unknown[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith(':run')) {
        calls.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
        return jsonResponse({
          done: true,
          response: { name: 'projects/p/locations/us-central1/jobs/j/executions/e1' },
        });
      }
      throw new Error('stop here — this test only checks the outgoing jobs:run body');
    });
    const client = makeClient(fetchMock as unknown as typeof fetch, {
      codeTimeoutMs: 7_000,
      orchestrationTimeoutMs: 45_000,
    });
    await expect(client.runPython('print(1)', new AbortController().signal)).rejects.toThrow();
    const envVars = (
      calls[0] as { overrides: { containerOverrides: { env: { name: string; value: string }[] }[] } }
    ).overrides.containerOverrides[0]!.env;
    expect(envVars).toContainEqual({ name: 'RUN_PYTHON_CODE_TIMEOUT_MS', value: '7000' });
  });
});
