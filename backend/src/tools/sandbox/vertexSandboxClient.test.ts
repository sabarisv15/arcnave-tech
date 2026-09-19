/**
 * VertexSandboxClient against a fake `fetch` — this is an HTTP client, so its own tests prove
 * request shapes and response parsing, never a real call. Live verification against the real
 * Preview API is tracked separately, blocked on GCP access this environment does not have.
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
  it('creates a reasoning engine, a sandbox, executes, decodes output, then deletes both', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method });
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
    expect(calls.some((c) => c.url.includes('sandboxEnvironments') && c.method === 'POST')).toBe(true);
  });

  it('still deletes the reasoning engine and sandbox when execute fails', async () => {
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
