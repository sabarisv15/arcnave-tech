/**
 * Runs Python in a fresh, single-use Cloud Run Job execution (`arcnave-python-sandbox`) —
 * replaces `VertexSandboxClient` (Vertex AI Agent Engine Code Execution, Preview-only, never
 * confirmed working across five tried REST shapes; see mistakes.md, 2026-09-19, and
 * docs/decisions/0005-cloud-run-sandbox.md for why). Follows the same pattern as that client and
 * `gptOssVertex.ts`: raw REST over ADC via `google-auth-library`, no Node SDK, since this is the
 * Cloud Run Admin API v2 + Cloud Logging, not a first-class client library surface here.
 *
 * Lifecycle per call: `jobs:run` (Admin API v2) → poll the returned long-running Operation to
 * resolve an Execution name → poll that Execution to a terminal state via its real v2 fields
 * (`completionTime` + `succeededCount`/`failedCount`/`cancelledCount` + `conditions[]` — there is
 * no `status` enum on this resource) → poll Cloud Logging for the runner's single
 * `ARCNAVE_SANDBOX_RESULT:` line, correlated on both the real Cloud Run execution identity and an
 * embedded `RUN_PYTHON_EXECUTION_ID` (never the UUID text match alone).
 *
 * Two independent timeouts: `codeTimeoutMs` is passed into the container as
 * `RUN_PYTHON_CODE_TIMEOUT_MS` and bounds only the user's Python subprocess; `orchestrationTimeoutMs`
 * is enforced here, client-side, across the whole round trip via an internal `AbortController`
 * combined with the caller's signal through `AbortSignal.any(...)` — the same pattern
 * `VertexSandboxClient.runPython` already used for its single timeout.
 */
import { GoogleAuth } from 'google-auth-library';

import { ProviderError } from '../../providers/types.js';
import type { SandboxClient, SandboxExecutionResult } from './client.js';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const RUN_HOST = 'https://run.googleapis.com';
const LOGGING_HOST = 'https://logging.googleapis.com';
const RESULT_PREFIX = 'ARCNAVE_SANDBOX_RESULT:';
const OPERATION_POLL_INTERVAL_MS = 1_000;
const EXECUTION_POLL_INTERVAL_MS = 1_000;
const LOG_POLL_ATTEMPTS = 10;
const LOG_POLL_INTERVAL_MS = 1_000;

export interface CloudRunSandboxClientDeps {
  project: string;
  location: string;
  jobName: string;
  getAccessToken: () => Promise<string>;
  /** Raw UTF-8 byte ceiling on submitted code, enforced before any network call. Default 20 KiB
   *  — Cloud Run's 32,768-byte-per-env-var limit minus base64's ~33% expansion minus headroom. */
  maxCodeBytes: number;
  /** Passed into the container as RUN_PYTHON_CODE_TIMEOUT_MS — bounds only the user's Python
   *  subprocess. Never reused as the client-side orchestration deadline below. */
  codeTimeoutMs: number;
  /** Client-side deadline covering the entire jobs:run -> Operation -> Execution -> Cloud
   *  Logging round trip. Must stay comfortably larger than codeTimeoutMs plus realistic Cloud
   *  Run scheduling and Cloud Logging indexing lag. */
  orchestrationTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

interface Operation {
  name?: string;
  done?: boolean;
  metadata?: { name?: string };
  response?: { name?: string };
  error?: { message?: string };
}

interface Condition {
  type?: string;
  state?: string;
  reason?: string;
  message?: string;
}

interface Execution {
  name: string;
  completionTime?: string;
  succeededCount?: number;
  failedCount?: number;
  cancelledCount?: number;
  conditions?: Condition[];
}

interface SandboxResultLine {
  type: string;
  executionId: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

function base64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CloudRunSandboxClient implements SandboxClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly deps: CloudRunSandboxClientDeps,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  static withAdc(
    project: string,
    location: string,
    jobName: string,
    opts: Omit<CloudRunSandboxClientDeps, 'project' | 'location' | 'jobName' | 'getAccessToken'>,
  ): CloudRunSandboxClient {
    const auth = new GoogleAuth({ scopes: [SCOPE] });
    return new CloudRunSandboxClient({
      project,
      location,
      jobName,
      ...opts,
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

    const codeBytes = Buffer.byteLength(code, 'utf-8');
    if (codeBytes > this.deps.maxCodeBytes) {
      throw new ProviderError(
        `Submitted code is ${String(codeBytes)} bytes, exceeding the ${String(this.deps.maxCodeBytes)}-byte sandbox limit.`,
        { code: 'provider_error' },
      );
    }

    // The caller's signal alone never bounds this call — nothing else in the chain enforces a
    // deadline on jobs:run -> Operation -> Execution -> Cloud Logging, so a slow or stuck step
    // would otherwise hang the whole generate request indefinitely (the exact failure mode
    // VertexSandboxClient hit in production; see mistakes.md, 2026-09-19).
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort();
    }, this.deps.orchestrationTimeoutMs);
    const combined = AbortSignal.any([signal, timeoutController.signal]);

    try {
      const executionId = crypto.randomUUID();
      const operation = await this.runJob(executionId, code, combined);
      const executionName = await this.resolveExecutionName(operation, combined);
      const execution = await this.pollExecutionUntilTerminal(executionName, combined);
      this.assertSucceeded(execution);
      const resultLine = await this.pollForResultLine(execution.name, executionId, combined);
      return {
        outputs: [
          {
            mimeType: 'application/json',
            text: JSON.stringify({ msg_out: resultLine.stdout, msg_err: resultLine.stderr }),
          },
        ],
      };
    } catch (err) {
      if (timeoutController.signal.aborted && !signal.aborted) {
        throw new ProviderError(
          `Sandbox orchestration exceeded its ${String(this.deps.orchestrationTimeoutMs)}ms deadline.`,
          { code: 'provider_error' },
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runJob(executionId: string, code: string, signal: AbortSignal): Promise<Operation> {
    const url = `${RUN_HOST}/v2/projects/${this.deps.project}/locations/${this.deps.location}/jobs/${this.deps.jobName}:run`;
    const body = {
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: 'RUN_PYTHON_CODE_B64', value: base64(code) },
              { name: 'RUN_PYTHON_CODE_TIMEOUT_MS', value: String(this.deps.codeTimeoutMs) },
              { name: 'RUN_PYTHON_EXECUTION_ID', value: executionId },
            ],
          },
        ],
        taskCount: 1,
      },
    };
    const res = await this.request(url, 'POST', body, signal);
    return (await res.json()) as Operation;
  }

  private async resolveExecutionName(op: Operation, signal: AbortSignal): Promise<string> {
    let current = op;
    for (;;) {
      if (current.response?.name) return current.response.name;
      if (current.metadata?.name) return current.metadata.name;
      if (current.done) {
        throw new ProviderError('Sandbox job run operation completed with no execution name.', {
          code: 'provider_error',
        });
      }
      if (signal.aborted) {
        throw new ProviderError('The request was aborted while waiting on the sandbox run operation.', {
          code: 'provider_error',
        });
      }
      if (!current.name) {
        throw new ProviderError(
          'Sandbox job run operation has neither an execution name nor an operation name to poll.',
          { code: 'provider_error' },
        );
      }
      await sleep(OPERATION_POLL_INTERVAL_MS);
      const res = await this.request(`${RUN_HOST}/v2/${current.name}`, 'GET', undefined, signal);
      current = (await res.json()) as Operation;
    }
  }

  private async pollExecutionUntilTerminal(executionName: string, signal: AbortSignal): Promise<Execution> {
    for (;;) {
      if (signal.aborted) {
        throw new ProviderError('The request was aborted while waiting on the sandbox execution.', {
          code: 'provider_error',
        });
      }
      const res = await this.request(`${RUN_HOST}/v2/${executionName}`, 'GET', undefined, signal);
      const execution = (await res.json()) as Execution;
      if (execution.completionTime) return execution;
      await sleep(EXECUTION_POLL_INTERVAL_MS);
    }
  }

  private assertSucceeded(execution: Execution): void {
    if ((execution.succeededCount ?? 0) >= 1) return;
    const reason =
      execution.conditions
        ?.map((c) => c.message)
        .filter((m): m is string => Boolean(m))
        .join('; ') || 'unknown reason';
    throw new ProviderError(`Sandbox execution did not succeed: ${reason}`, {
      code: 'provider_error',
    });
  }

  private async pollForResultLine(
    executionName: string,
    executionId: string,
    signal: AbortSignal,
  ): Promise<SandboxResultLine> {
    const parts = executionName.split('/');
    const jobIdx = parts.indexOf('jobs');
    const execIdx = parts.indexOf('executions');
    const jobId = parts[jobIdx + 1];
    const executionShortName = parts[execIdx + 1];

    for (let attempt = 0; attempt < LOG_POLL_ATTEMPTS; attempt += 1) {
      if (signal.aborted) {
        throw new ProviderError('The request was aborted while waiting on the sandbox result log.', {
          code: 'provider_error',
        });
      }
      const filter = [
        'resource.type="cloud_run_job"',
        `resource.labels.job_name="${String(jobId)}"`,
        `labels."run.googleapis.com/execution_name"="${String(executionShortName)}"`,
        `textPayload:"${RESULT_PREFIX}"`,
      ].join('\n');
      const res = await this.request(
        `${LOGGING_HOST}/v2/entries:list`,
        'POST',
        {
          resourceNames: [`projects/${this.deps.project}`],
          filter,
          orderBy: 'timestamp desc',
          pageSize: 10,
        },
        signal,
      );
      const body = (await res.json()) as { entries?: { textPayload?: string }[] };
      for (const entry of body.entries ?? []) {
        const line = entry.textPayload ?? '';
        const idx = line.indexOf(RESULT_PREFIX);
        if (idx === -1) continue;
        let parsed: SandboxResultLine;
        try {
          parsed = JSON.parse(line.slice(idx + RESULT_PREFIX.length)) as SandboxResultLine;
        } catch {
          continue;
        }
        if (parsed.executionId === executionId) return parsed;
      }
      if (attempt < LOG_POLL_ATTEMPTS - 1) await sleep(LOG_POLL_INTERVAL_MS);
    }
    throw new ProviderError('Sandbox execution succeeded but no matching result log was found in time.', {
      code: 'provider_error',
    });
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
}
