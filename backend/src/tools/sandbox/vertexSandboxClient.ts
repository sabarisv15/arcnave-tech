/**
 * Runs Python in a fresh, single-use Vertex AI Agent Engine "Code Execution" sandbox over raw
 * REST — this resource (`reasoningEngines`/`sandboxEnvironments`) has no Node/TypeScript SDK as
 * of this writing (only a Python SDK; see `googleapis/js-genai#2185`), so this follows the same
 * pattern `gptOssVertex.ts` already uses for a Vertex surface with no first-class client: ADC
 * via `google-auth-library`, plain `fetch`, and the documented REST shape.
 *
 * Lifecycle per call: create reasoning engine → create sandbox → execute → delete sandbox →
 * delete reasoning engine. Both deletes run in a `finally` so a failed execution never leaks a
 * running sandbox. This is Preview infrastructure — the REST shape here was read directly from
 * Google's own reference docs (`projects.locations.reasoningEngines.sandboxEnvironments`), not
 * inferred from the Python-SDK quickstart, but Preview APIs are more likely to drift than GA
 * ones; a real call verifying this shape is still outstanding (see docs/checkpoints/CURRENT.md).
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
  /** Sandbox `ttl`, in milliseconds — the expiration the sandbox itself enforces if our own
   *  cleanup somehow never runs. Independent of RUN_PYTHON_TIMEOUT_MS's client-side execute
   *  deadline, though callers typically pass the same value for both. */
  ttlMs?: number;
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

  static withAdc(project: string, location: string, ttlMs: number): VertexSandboxClient {
    const auth = new GoogleAuth({ scopes: [SCOPE] });
    return new VertexSandboxClient({
      project,
      location,
      ttlMs,
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

    const reasoningEngineName = await this.createReasoningEngine(signal);
    let sandboxName: string | undefined;
    try {
      sandboxName = await this.createSandbox(reasoningEngineName, signal);
      const outputs = await this.execute(sandboxName, code, signal);
      return { outputs };
    } finally {
      if (sandboxName) await this.deleteQuietly(sandboxName);
      await this.deleteQuietly(reasoningEngineName);
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
    const ttlSeconds = Math.ceil(this.ttlMs() / 1000);
    const op = await this.postForOperation(
      url,
      {
        displayName: 'arcnave-run-python',
        spec: { codeExecutionEnvironment: { codeLanguage: 'LANGUAGE_PYTHON' } },
        ttl: `${String(ttlSeconds)}s`,
      },
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
      // Best-effort cleanup: a failed delete leaks a Preview-tier sandbox that expires on its
      // own `ttl`, but must never mask the caller's real execute error — see runPython's finally.
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

  private ttlMs(): number {
    return this.deps.ttlMs ?? 60_000;
  }
}
