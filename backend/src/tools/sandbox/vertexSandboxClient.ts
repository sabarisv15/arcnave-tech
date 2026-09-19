/**
 * Runs Python in a fresh, single-use Vertex AI Agent Engine "Code Execution" sandbox over raw
 * REST — this resource has no Node/TypeScript SDK as of this writing (only a Python SDK; see
 * `googleapis/js-genai#2185`), so this follows the same pattern `gptOssVertex.ts` already uses
 * for a Vertex surface with no first-class client: ADC via `google-auth-library`, plain `fetch`,
 * and the documented REST shape.
 *
 * Lifecycle per call: create reasoning engine → create sandbox (`spec.codeExecutionEnvironment`)
 * → `sandboxEnvironments.execute` (NOT `executeCode` — that suffix belongs to the separate,
 * differently-shaped `reasoningEngines.executeCode` stateless method, confirmed not to work
 * either) with an `{ inputs: [Chunk] }` body → delete sandbox → delete reasoning engine.
 *
 * This is the best-evidenced of five distinct shapes tried live — see `mistakes.md`, 2026-09-19,
 * for the full account. It is the only one where Google's own error response implies the field
 * *name* is accepted (a generic "invalid argument" rather than an explicit "Unknown name ..."
 * the other four shapes all got for their wrong field). It is still **not confirmed working** —
 * `ENABLE_RUN_PYTHON` must stay `false` until an actual successful execution is observed, not
 * just a more plausible-looking rejection. Delete runs in a `finally` so a failed execution
 * never leaks a running sandbox.
 */
import { GoogleAuth } from 'google-auth-library';

import { ProviderError } from '../../providers/types.js';
import type { SandboxClient, SandboxExecutionResult } from './client.js';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const POLL_INTERVAL_MS = 500;

interface AccessTokenSource {
  getAccessToken(): Promise<string>;
}

interface VertexSandboxClientDeps {
  project: string;
  location: string;
  getAccessToken: AccessTokenSource['getAccessToken'];
  /** Client-side deadline on the whole create -> execute round trip, enforced by an internal
   *  `AbortController` combined with the caller's own signal — the only deadline in this path,
   *  since `executeCode` is stateless and has no server-side `ttl` of its own. */
  timeoutMs?: number;
}

interface Operation {
  done?: boolean;
  name?: string;
  error?: { message?: string };
  response?: { name?: string };
}

function hostFor(location: string): string {
  return location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`;
}

function base64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

function fromBase64(s: string): string {
  return Buffer.from(s, 'base64').toString('utf-8');
}

export class VertexSandboxClient implements SandboxClient {
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly deps: VertexSandboxClientDeps,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.host = hostFor(deps.location);
    this.fetchImpl = fetchImpl;
  }

  static withAdc(project: string, location: string, timeoutMs: number): VertexSandboxClient {
    const auth = new GoogleAuth({ scopes: [SCOPE] });
    return new VertexSandboxClient({
      project,
      location,
      timeoutMs,
      getAccessToken: async () => {
        const token = await auth.getAccessToken();
        if (!token) throw new Error('Application Default Credentials returned no access token');
        return token;
      },
    });
  }

  async runPython(code: string, signal: AbortSignal): Promise<SandboxExecutionResult> {
    if (signal.aborted) {
      throw new ProviderError('The request was aborted before the sandbox started.', {
        code: 'provider_error',
      });
    }

    // The caller's signal alone never bounds this call: nothing else in the request chain
    // enforces a deadline on the create -> execute round trip, so a slow or stuck Preview API
    // hangs the whole generate request indefinitely (see mistakes.md, 2026-09-19).
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort();
    }, this.timeoutMs());
    const combined = AbortSignal.any([signal, timeoutController.signal]);

    try {
      const reasoningEngineName = await this.createReasoningEngine(combined);
      let sandboxName: string | undefined;
      try {
        sandboxName = await this.createSandbox(reasoningEngineName, combined);
        const outputs = await this.execute(sandboxName, code, combined);
        return { outputs };
      } finally {
        if (sandboxName) await this.deleteQuietly(sandboxName);
        await this.deleteQuietly(reasoningEngineName);
      }
    } catch (err) {
      if (timeoutController.signal.aborted && !signal.aborted) {
        throw new ProviderError(
          `Sandbox execution exceeded its ${String(this.timeoutMs())}ms deadline.`,
          { code: 'provider_error' },
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async createReasoningEngine(signal: AbortSignal): Promise<string> {
    const url = `${this.host}/v1/projects/${this.deps.project}/locations/${this.deps.location}/reasoningEngines`;
    const op = await this.postForOperation(url, { displayName: 'arcnave-run-python' }, signal);
    const name = op.response?.name;
    if (!name) {
      throw new ProviderError('Sandbox reasoning-engine creation returned no resource name.', {
        code: 'provider_error',
      });
    }
    return name;
  }

  private async createSandbox(reasoningEngineName: string, signal: AbortSignal): Promise<string> {
    const url = `${this.host}/v1/${reasoningEngineName}/sandboxEnvironments`;
    const op = await this.postForOperation(
      url,
      { spec: { codeExecutionEnvironment: { codeLanguage: 'LANGUAGE_PYTHON' } } },
      signal,
    );
    const name = op.response?.name;
    if (!name) {
      throw new ProviderError('Sandbox creation returned no resource name.', {
        code: 'provider_error',
      });
    }
    return name;
  }

  private async execute(
    sandboxName: string,
    code: string,
    signal: AbortSignal,
  ): Promise<{ mimeType: string; text: string }[]> {
    const url = `${this.host}/v1/${sandboxName}:execute`;
    const res = await this.request(
      url,
      'POST',
      { inputs: [{ mimeType: 'text/x-python', data: base64(code) }] },
      signal,
    );
    const body = (await res.json()) as { outputs?: { mimeType: string; data: string }[] };
    return (body.outputs ?? []).map((o) => ({ mimeType: o.mimeType, text: fromBase64(o.data) }));
  }

  private async deleteQuietly(name: string): Promise<void> {
    try {
      await this.request(`${this.host}/v1/${name}`, 'DELETE', undefined, new AbortController().signal);
    } catch {
      // Best-effort cleanup: a failed delete leaks a Preview-tier reasoning engine, but must
      // never mask the caller's real execute error — see runPython's finally.
    }
  }

  private async postForOperation(
    url: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Operation> {
    const res = await this.request(url, 'POST', body, signal);
    let op = (await res.json()) as Operation;
    op = await this.pollUntilDone(op, signal);
    if (op.error) {
      throw new ProviderError(`Sandbox operation failed: ${op.error.message ?? 'unknown error'}`, {
        code: 'provider_error',
      });
    }
    return op;
  }

  private async pollUntilDone(op: Operation, signal: AbortSignal): Promise<Operation> {
    let current = op;
    while (!current.done) {
      if (signal.aborted) {
        throw new ProviderError('The request was aborted while waiting on a sandbox operation.', {
          code: 'provider_error',
        });
      }
      if (!current.name) {
        throw new ProviderError('Sandbox operation has neither a result nor a name to poll.', {
          code: 'provider_error',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const res = await this.request(`${this.host}/v1/${current.name}`, 'GET', undefined, signal);
      current = (await res.json()) as Operation;
    }
    return current;
  }

  private async request(
    url: string,
    method: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    const token = await this.deps.getAccessToken();
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(`Sandbox API ${method} ${url} returned ${String(res.status)}: ${text}`, {
        code: 'provider_error',
        statusCode: res.status,
      });
    }
    return res;
  }

  private timeoutMs(): number {
    return this.deps.timeoutMs ?? 60_000;
  }
}
