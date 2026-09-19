/**
 * VertexSandboxClient against a fake `fetch` — this is an HTTP client, so its own tests prove
 * request shapes and response parsing, never a real call. This is the best-evidenced of five
 * shapes tried live against the real Preview API — `sandboxEnvironments.execute` (not
 * `executeCode`) with an `{ inputs: [Chunk] }` body — see mistakes.md, 2026-09-19 for the full
 * account and whether it was ever confirmed actually working.
 */
import { describe, expect, it, vi } from 'vitest';

import { VertexSandboxClient } from './vertexSandboxClient.js';

function b64(s: string): string {
  return Buffer.from(s).toString('base64');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchMock: typeof fetch): VertexSandboxClient {
  return new VertexSandboxClient(
    { project: 'p', location: 'us-central1', getAccessToken: async () => 'fake-token' },
    fetchMock,
  );
}

describe('VertexSandboxClient.runPython', () => {
  it('creates a reasoning engine, a sandbox, executes on the sandbox, decodes output, then deletes both', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({
        url: u,
        method,
        ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
      });
      if (u.endsWith('/reasoningEngines') && method === 'POST') {
        return jsonResponse({
          name: 'projects/p/locations/us-central1/operations/op1',
          done: true,
          response: { name: 'projects/p/locations/us-central1/reasoningEngines/re1' },
        });
      }
      if (u.endsWith('/sandboxEnvironments') && method === 'POST') {
        return jsonResponse({
          name: 'projects/p/locations/us-central1/operations/op2',
          done: true,
          response: {
            name: 'projects/p/locations/us-central1/reasoningEngines/re1/sandboxEnvironments/sb1',
          },
        });
      }
      if (u.endsWith(':execute')) {
        return jsonResponse({
          outputs: [
            {
              mimeType: 'application/json',
              data: b64(JSON.stringify({ msg_out: 'hello\n', msg_err: '' })),
            },
          ],
        });
      }
      if (method === 'DELETE') {
        return jsonResponse({});
      }
      throw new Error(`unexpected call: ${method} ${u}`);
    });

    const client = makeClient(fetchMock as unknown as typeof fetch);
    const result = await client.runPython('print("hello")', new AbortController().signal);

    expect(result.outputs).toEqual([
      { mimeType: 'application/json', text: JSON.stringify({ msg_out: 'hello\n', msg_err: '' }) },
    ]);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
    expect(calls[0]!.url).toContain('reasoningEngines');
    expect(calls.some((c) => c.url.endsWith('/sandboxEnvironments') && c.method === 'POST')).toBe(
      true,
    );
    const executeCall = calls.find(
      (c) => c.url.endsWith(':execute') && !c.url.endsWith(':executeCode') && c.method === 'POST',
    );
    expect(executeCall?.body).toEqual({
      inputs: [{ mimeType: 'text/x-python', data: b64('print("hello")') }],
    });
  });

  it('still deletes the sandbox and reasoning engine when execute fails', async () => {
    let deletes = 0;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/reasoningEngines') && method === 'POST') {
        return jsonResponse({
          done: true,
          response: { name: 'projects/p/locations/us-central1/reasoningEngines/re1' },
        });
      }
      if (u.endsWith('/sandboxEnvironments') && method === 'POST') {
        return jsonResponse({
          done: true,
          response: {
            name: 'projects/p/locations/us-central1/reasoningEngines/re1/sandboxEnvironments/sb1',
          },
        });
      }
      if (u.endsWith(':execute')) return jsonResponse({ error: { message: 'boom' } }, 500);
      if (method === 'DELETE') {
        deletes += 1;
        return jsonResponse({});
      }
      throw new Error('unexpected call');
    });

    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.runPython('1/0', new AbortController().signal)).rejects.toThrow();
    expect(deletes).toBe(2);
  });

  it('propagates an already-aborted signal without making any request', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(client.runPython('x', controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts and throws once the internal timeout elapses, even with no signal from the caller', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });

      const client = new VertexSandboxClient(
        {
          project: 'p',
          location: 'us-central1',
          getAccessToken: async () => 'fake-token',
          timeoutMs: 5_000,
        },
        fetchMock as unknown as typeof fetch,
      );

      const resultPromise = client.runPython('while True: pass', new AbortController().signal);
      const assertion = expect(resultPromise).rejects.toThrow(/5000ms deadline/);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces a non-2xx reasoning-engine creation failure without calling execute', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/reasoningEngines') && method === 'POST') {
        return jsonResponse({ error: { message: 'quota exceeded' } }, 429);
      }
      throw new Error(`unexpected call: ${method} ${u}`);
    });
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(client.runPython('x', new AbortController().signal)).rejects.toThrow();
  });
});
