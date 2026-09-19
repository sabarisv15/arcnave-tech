# Cloud Run Sandbox for `run_python` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blocked `VertexSandboxClient` (Vertex AI Agent Engine Code Execution — Preview-only, self-contradicting REST docs) with `CloudRunSandboxClient`, a new `SandboxClient` implementation that runs `run_python` in a self-hosted Cloud Run Job, one fresh execution per call.

**Architecture:** `CloudRunSandboxClient` launches a Cloud Run Job execution via `jobs:run` (Admin API v2), polls the resulting long-running Operation to resolve an Execution, polls that Execution to a terminal state, then polls Cloud Logging for a single structured result line the in-container `runner.py` emits. Nothing above the existing `SandboxClient` interface (`CodeExecutionToolExecutor`, `DispatchingToolExecutor`, `ENABLE_RUN_PYTHON`) changes.

**Tech Stack:** Node 22 + TypeScript (backend client), Python 3 (sandbox image), Cloud Run Jobs + Cloud Logging (Admin API v2, raw REST over ADC — no Node SDK needed, `google-auth-library` for tokens), Vitest (unit tests, fake `fetch`), Docker (sandbox image + a separate integration check outside Vitest).

## Global Constraints

- `SandboxExecutionResult.outputs` must contain one `application/json` chunk shaped `{ msg_out, msg_err }` — `CodeExecutionToolExecutor` (`backend/src/tools/codeExecutionExecutor.ts:21-25`) parses exactly this shape and must not be modified.
- `MAX_CODE_BYTES` default is **20 KiB** (raw UTF-8 source) — Cloud Run's per-env-var limit is 32,768 bytes and base64 expands by ~33%, so the real ceiling is ~24.5 KiB; 20 KiB is the enforced default with headroom.
- Two independent timeouts, never one: `RUN_PYTHON_CODE_TIMEOUT_MS` (in-container, bounds only the user's Python) and `RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS` (client-side, bounds the whole `jobs:run` → Operation → Execution → Cloud Logging round trip). Both gated solely by the existing `ENABLE_RUN_PYTHON` flag — no new feature flag.
- `jobs:run` returns a long-running **Operation**, never assume the POST response is already an Execution.
- The v2 `Execution` resource has no `status` enum — terminal state comes from `completionTime` + `succeededCount`/`failedCount`/`cancelledCount` + `conditions[]`.
- Cloud Logging result correlation uses **two** identifiers together: the real Cloud Run execution identity (job name + execution name) and the embedded `RUN_PYTHON_EXECUTION_ID` inside the parsed result line — never the UUID text match alone.
- The runner never lets user code's own stdout become the protocol channel, streams-and-caps stdout/stderr as it reads (never `communicate()`-then-slice), kills the whole process group on timeout (not just the child), and runs as a non-root container user.
- Every client-visible failure is a `ProviderError` with `code: 'provider_error'`, matching `VertexSandboxClient`'s existing convention (`backend/src/providers/types.ts`).
- Tests must never reach a provider or a real GCP resource — same as every existing test in `backend/src/tools/sandbox/`.
- Full reference: [ADR-0005](../../decisions/0005-cloud-run-sandbox.md) (why) and the [design spec](../specs/2026-09-19-cloud-run-sandbox-design.md) (how).

---

### Task 1: Fix `run_python`'s tool description — it currently promises the model something false

ADR-0005 allows outbound network egress from the sandbox (a deliberate trade-off), but the existing tool definition tells the model the sandbox has "no network access." Left as-is, the model would be lied to by its own tool description once the Cloud Run sandbox ships. Fix the description first, independent of everything else in this plan.

**Files:**
- Modify: `backend/src/tools/definitions.ts:76-92`
- Test: `backend/src/tools/definitions.test.ts` (new)

**Interfaces:**
- Produces: no change to `RUN_PYTHON: ToolDefinition`'s shape, only its `description` string.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/tools/definitions.test.ts
import { describe, expect, it } from 'vitest';

import { RUN_PYTHON } from './definitions.js';

describe('RUN_PYTHON tool definition', () => {
  it('does not claim the sandbox has no network access, since ADR-0005 allows egress', () => {
    expect(RUN_PYTHON.description.toLowerCase()).not.toContain('no network access');
  });

  it('still promises no access to project files or other tools, which remains true', () => {
    expect(RUN_PYTHON.description).toContain("no access to this project's files");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/tools/definitions.test.ts`
Expected: FAIL — the current description contains "no network access".

- [ ] **Step 3: Update the description**

```typescript
// backend/src/tools/definitions.ts, replacing the description field (lines 78-84)
  description:
    'Runs Python code in an isolated, single-use sandbox with outbound network access but ' +
    "no access to this project's files or any other tool's data. Use it for computation — " +
    'arithmetic, data transformation, verifying a calculation — not for anything that needs ' +
    'project context; combine with search_project_files/read_project_file first if the code ' +
    'needs data from the project. Output is captured stdout/stderr, truncated if large. The ' +
    'sandbox has no persisted state between calls — each call starts fresh.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/tools/definitions.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/tools/definitions.ts backend/src/tools/definitions.test.ts
git commit -m "fix(tools): stop telling the model run_python has no network access"
```

---

### Task 2: `CloudRunSandboxClient` skeleton — types, constructor, size guard, request helper

Build the new client as a standalone file, not yet wired into `container.ts`, mirroring `VertexSandboxClient`'s shape (injectable `fetch`, ADC-backed `getAccessToken`, a `static withAdc(...)`). This task establishes the types every later task builds on and the one behavior that needs no network call at all: rejecting oversized code.

**Files:**
- Create: `backend/src/tools/sandbox/cloudRunSandboxClient.ts`
- Test: `backend/src/tools/sandbox/cloudRunSandboxClient.test.ts` (new)

**Interfaces:**
- Consumes: `SandboxClient`, `SandboxExecutionResult` from `./client.js`; `ProviderError` from `../../providers/types.js`.
- Produces:
  - `interface CloudRunSandboxClientDeps { project: string; location: string; jobName: string; getAccessToken: () => Promise<string>; maxCodeBytes: number; codeTimeoutMs: number; orchestrationTimeoutMs: number; maxStdoutBytes: number; maxStderrBytes: number; }`
  - `class CloudRunSandboxClient implements SandboxClient` with `constructor(deps: CloudRunSandboxClientDeps, fetchImpl: typeof fetch = fetch)`, `static withAdc(project: string, location: string, jobName: string, opts: Omit<CloudRunSandboxClientDeps, 'project' | 'location' | 'jobName' | 'getAccessToken'>): CloudRunSandboxClient`, and `async runPython(code: string, signal: AbortSignal): Promise<SandboxExecutionResult>` (throws-only stub for now — later tasks fill in the real flow after the size guard).

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
import { describe, expect, it, vi } from 'vitest';

import { CloudRunSandboxClient } from './cloudRunSandboxClient.js';

function makeClient(fetchMock: typeof fetch, overrides: Partial<{
  maxCodeBytes: number;
  codeTimeoutMs: number;
  orchestrationTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}> = {}): CloudRunSandboxClient {
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

describe('CloudRunSandboxClient.runPython — size guard', () => {
  it('rejects code over maxCodeBytes without making any request', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch, { maxCodeBytes: 10 });
    await expect(
      client.runPython('x'.repeat(11), new AbortController().signal),
    ).rejects.toThrow(/10-byte/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts code exactly at maxCodeBytes (does not reject on size)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network reached — not what this test checks');
    });
    const client = makeClient(fetchMock as unknown as typeof fetch, { maxCodeBytes: 5 });
    await expect(client.runPython('x'.repeat(5), new AbortController().signal)).rejects.toThrow();
    // Rejected for a different reason (the stub network call), proving the size check passed.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the skeleton implementation**

```typescript
// backend/src/tools/sandbox/cloudRunSandboxClient.ts
/**
 * Runs Python in a fresh Cloud Run Job execution — see docs/decisions/0005-cloud-run-sandbox.md
 * for why this replaced VertexSandboxClient (Vertex AI Agent Engine's Code Execution service,
 * Preview-only with self-contradicting REST docs) and the design spec at
 * docs/superpowers/specs/2026-09-19-cloud-run-sandbox-design.md for the exact protocol.
 */
import { GoogleAuth } from 'google-auth-library';

import { ProviderError } from '../../providers/types.js';
import type { SandboxClient, SandboxExecutionResult } from './client.js';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export interface CloudRunSandboxClientDeps {
  project: string;
  location: string;
  jobName: string;
  getAccessToken: () => Promise<string>;
  /** Raw UTF-8 byte ceiling on submitted code, enforced before any network call. Default 20 KiB
   *  — Cloud Run's 32,768-byte-per-env-var limit minus base64's ~33% expansion minus headroom. */
  maxCodeBytes: number;
  /** Passed into the container as RUN_PYTHON_CODE_TIMEOUT_MS — bounds only the user's Python
   *  subprocess. Never reused as the client-side deadline below. */
  codeTimeoutMs: number;
  /** Client-side deadline covering the entire jobs:run -> Operation -> Execution -> Cloud
   *  Logging round trip. Must be comfortably larger than codeTimeoutMs. */
  orchestrationTimeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
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

    // Filled in by Tasks 3-5: launch the job, resolve the Operation to an Execution, poll it to
    // a terminal state, then poll Cloud Logging for the result line.
    throw new ProviderError('CloudRunSandboxClient.runPython is not yet implemented.', {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: PASS, all three cases (the second test's `fetchMock` is never actually called in this
skeleton since `runPython` throws before reaching `request()` — update that test's assertion to
`expect(fetchMock).not.toHaveBeenCalled()` for now; Task 5 will change this test's expectation
once the real flow exists and reaches `request()`. Adjust the test to match the current stub
behavior before moving on).

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean; the new file compiles and existing tests are unaffected.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tools/sandbox/cloudRunSandboxClient.ts backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
git commit -m "feat(tools): add CloudRunSandboxClient skeleton with size guard"
```

---

### Task 3: Job launch and Operation resolution

Implement `runJob` (the `jobs:run` POST) and `resolveExecutionName` (handling the long-running Operation `jobs:run` actually returns — never assuming the POST response is already an Execution).

**Files:**
- Modify: `backend/src/tools/sandbox/cloudRunSandboxClient.ts`
- Test: `backend/src/tools/sandbox/cloudRunSandboxClient.test.ts`

**Interfaces:**
- Consumes: `CloudRunSandboxClientDeps`, `request()` from Task 2.
- Produces: `interface Operation { name?: string; done?: boolean; metadata?: { name?: string }; response?: { name?: string }; error?: { message?: string } }`; private methods `runJob(executionId: string, code: string, signal: AbortSignal): Promise<Operation>` and `resolveExecutionName(op: Operation, signal: AbortSignal): Promise<string>` — later tasks call both in sequence from `runPython`.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

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
    // runPython isn't fully wired yet (Task 5 finishes it) — this test drives runJob/
    // resolveExecutionName directly via the package-private test hook exposed below.
    const op = await (client as unknown as {
      runJob(executionId: string, code: string, signal: AbortSignal): Promise<unknown>;
    }).runJob('exec-1', 'print(1)', new AbortController().signal);
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
    const name = await (client as unknown as {
      resolveExecutionName(op: unknown, signal: AbortSignal): Promise<string>;
    }).resolveExecutionName(
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
    const name = await (client as unknown as {
      resolveExecutionName(op: unknown, signal: AbortSignal): Promise<string>;
    }).resolveExecutionName({ name: 'operations/op1', done: false }, new AbortController().signal);
    expect(name).toBe('projects/p/locations/us-central1/jobs/j/executions/e1');
    expect(polls).toBe(2);
  });

  it('resolveExecutionName throws if the Operation finishes with no execution name anywhere', async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock as unknown as typeof fetch);
    await expect(
      (client as unknown as {
        resolveExecutionName(op: unknown, signal: AbortSignal): Promise<string>;
      }).resolveExecutionName({ done: true }, new AbortController().signal),
    ).rejects.toThrow(/no execution name/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: FAIL — `runJob`/`resolveExecutionName` don't exist yet.

- [ ] **Step 3: Implement `runJob` and `resolveExecutionName`**

```typescript
// Add to backend/src/tools/sandbox/cloudRunSandboxClient.ts, above the existing `request` method

const RUN_HOST = 'https://run.googleapis.com';
const POLL_INTERVAL_MS = 1_000;

interface Operation {
  name?: string;
  done?: boolean;
  metadata?: { name?: string };
  response?: { name?: string };
  error?: { message?: string };
}

function base64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

```typescript
// Add as private methods inside the CloudRunSandboxClient class, replacing the "Filled in by
// Tasks 3-5" comment in runPython (left as-is for now — Task 5 wires these into runPython)

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
      await sleep(POLL_INTERVAL_MS);
      const res = await this.request(`${RUN_HOST}/v2/${current.name}`, 'GET', undefined, signal);
      current = (await res.json()) as Operation;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tools/sandbox/cloudRunSandboxClient.ts backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
git commit -m "feat(tools): launch Cloud Run Job executions and resolve their Operation"
```

---

### Task 4: Execution polling and terminal-state outcome

Poll the resolved Execution to a terminal state using the real v2 fields (`completionTime`, `succeededCount`/`failedCount`/`cancelledCount`, `conditions[]`) — no `status` enum exists on this resource.

**Files:**
- Modify: `backend/src/tools/sandbox/cloudRunSandboxClient.ts`
- Test: `backend/src/tools/sandbox/cloudRunSandboxClient.test.ts`

**Interfaces:**
- Consumes: `Operation`, `request()`, `RUN_HOST`, `POLL_INTERVAL_MS`, `sleep()` from Task 3.
- Produces: `interface Condition { type?: string; state?: string; reason?: string; message?: string }`; `interface Execution { name: string; completionTime?: string; succeededCount?: number; failedCount?: number; cancelledCount?: number; conditions?: Condition[] }`; private methods `pollExecutionUntilTerminal(executionName: string, signal: AbortSignal): Promise<Execution>` and `assertSucceeded(execution: Execution): void` (throws `ProviderError` on failure/cancellation).

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
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
    const execution = await (client as unknown as {
      pollExecutionUntilTerminal(name: string, signal: AbortSignal): Promise<{ completionTime?: string }>;
    }).pollExecutionUntilTerminal(
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
        conditions: [{ type: 'Completed', state: 'CONDITION_FAILED', reason: 'NON_ZERO_EXIT_CODE', message: 'container exited 1' }],
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: FAIL — methods don't exist yet.

- [ ] **Step 3: Implement `pollExecutionUntilTerminal` and `assertSucceeded`**

```typescript
// Add near the Operation interface in cloudRunSandboxClient.ts
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
```

```typescript
// Add as private methods inside the class, after resolveExecutionName

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
      await sleep(POLL_INTERVAL_MS);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tools/sandbox/cloudRunSandboxClient.ts backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
git commit -m "feat(tools): poll Cloud Run executions to terminal state via real v2 fields"
```

---

### Task 5: Cloud Logging result polling, two-part correlation, and wiring the full `runPython` flow

Poll Cloud Logging for the runner's `ARCNAVE_SANDBOX_RESULT:` line, correlating on both the real Cloud Run execution identity and the embedded execution id, with a bounded retry window for log-indexing lag. Then wire `runJob` → `resolveExecutionName` → `pollExecutionUntilTerminal` → `assertSucceeded` → `pollForResultLine` together inside `runPython`, replacing the stub from Task 2.

**Files:**
- Modify: `backend/src/tools/sandbox/cloudRunSandboxClient.ts`
- Test: `backend/src/tools/sandbox/cloudRunSandboxClient.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-4.
- Produces: `interface SandboxResultLine { type: string; executionId: string; ok: boolean; exitCode: number; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean; timedOut: boolean; durationMs: number }`; private method `pollForResultLine(executionName: string, executionId: string, signal: AbortSignal): Promise<SandboxResultLine>`; the completed public `runPython(code, signal): Promise<SandboxExecutionResult>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
const RESULT_PREFIX = 'ARCNAVE_SANDBOX_RESULT:';

function resultLine(overrides: Partial<{
  executionId: string;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
}> = {}): string {
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
    await expect(client.runPython('print(1)', new AbortController().signal)).rejects.toThrow(
      /container exited 137/,
    );
    expect(logCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: FAIL — `runPython` still throws the "not yet implemented" stub.

- [ ] **Step 3: Implement `pollForResultLine` and finish wiring `runPython`**

```typescript
// Add near the top of cloudRunSandboxClient.ts, with the other constants
const LOGGING_HOST = 'https://logging.googleapis.com';
const RESULT_PREFIX = 'ARCNAVE_SANDBOX_RESULT:';
const LOG_POLL_ATTEMPTS = 10;
const LOG_POLL_INTERVAL_MS = 1_000;
```

```typescript
// Add near Execution/Condition
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
```

```typescript
// Replace the runPython stub body (from "Filled in by Tasks 3-5" onward) with:

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
```

```typescript
// Add "import { randomUUID } from 'node:crypto';" at the top and use randomUUID() instead of
// crypto.randomUUID() if the global Web Crypto isn't available in the target Node build —
// Node 22 has global crypto.randomUUID(), so the inline call above is fine as written.
```

```typescript
// Add as a private method, after pollExecutionUntilTerminal/assertSucceeded

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
```

- [ ] **Step 4: Update Task 2's stale test expectation**

The "accepts code exactly at maxCodeBytes" test from Task 2 asserted `fetchMock` was called once
and the call rejected for an unrelated reason. With the full flow now wired, adjust it:

```typescript
// Replace that test's body in cloudRunSandboxClient.test.ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: PASS, all cases across Tasks 2-5.

- [ ] **Step 6: Typecheck and full suite**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/tools/sandbox/cloudRunSandboxClient.ts backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
git commit -m "feat(tools): poll Cloud Logging for the sandbox result line with two-part correlation"
```

---

### Task 6: Orchestration timeout test coverage

Task 5 already wires the orchestration deadline into `runPython`. This task adds the two test
cases the spec calls out specifically for that deadline: it firing mid-flow, and proof that it's
independent from the in-container code timeout.

**Files:**
- Modify: `backend/src/tools/sandbox/cloudRunSandboxClient.test.ts`

**Interfaces:**
- Consumes: `CloudRunSandboxClient`, `makeClient` from earlier tasks. No production code changes in this task — `runPython`'s timeout wiring already exists from Task 5.

- [ ] **Step 1: Write the tests**

```typescript
// Add to backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
describe('CloudRunSandboxClient — orchestration timeout', () => {
  it('aborts and throws once orchestrationTimeoutMs elapses, independent of codeTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
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
        return jsonResponse({ done: true, response: { name: 'projects/p/locations/us-central1/jobs/j/executions/e1' } });
      }
      throw new Error('stop here — this test only checks the outgoing jobs:run body');
    });
    const client = makeClient(fetchMock as unknown as typeof fetch, {
      codeTimeoutMs: 7_000,
      orchestrationTimeoutMs: 45_000,
    });
    await expect(client.runPython('print(1)', new AbortController().signal)).rejects.toThrow();
    const envVars = (calls[0] as { overrides: { containerOverrides: { env: { name: string; value: string }[] }[] } })
      .overrides.containerOverrides[0]!.env;
    expect(envVars).toContainEqual({ name: 'RUN_PYTHON_CODE_TIMEOUT_MS', value: '7000' });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd backend && npx vitest run src/tools/sandbox/cloudRunSandboxClient.test.ts`
Expected: PASS — both deadlines already work from Task 5's implementation; this task only adds
the coverage the spec requires.

- [ ] **Step 3: Full backend suite and typecheck**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/tools/sandbox/cloudRunSandboxClient.test.ts
git commit -m "test(tools): cover CloudRunSandboxClient's orchestration-vs-code timeout split"
```

---

### Task 7: Config additions and `container.ts` wiring — swap the implementation in

Add the new env vars, remove the now-unused `RUN_PYTHON_TIMEOUT_MS`/its stale Agent-Engine-region
comment on `SANDBOX_LOCATION`, and swap `container.ts` from `VertexSandboxClient` to
`CloudRunSandboxClient`. `vertexSandboxClient.ts` itself is **not** deleted yet — per ADR-0005's
Cleanup section, that happens only after `CloudRunSandboxClient` is live-verified against real
Cloud Run, which is outside this plan's scope.

**Files:**
- Modify: `backend/src/config.ts:156-168`
- Modify: `backend/src/container.ts:24,57-79`
- Test: `backend/src/config.test.ts` (check if it exists; if so extend it, else this task has no
  new test file — `container.ts` has no direct unit test today, its behavior is exercised via
  `generation.ts`'s existing integration tests, which must still pass unmodified)

**Interfaces:**
- Consumes: `CloudRunSandboxClient.withAdc(project, location, jobName, opts)` from Tasks 2-5.
- Produces: `Config` gains `RUN_PYTHON_CODE_TIMEOUT_MS`, `RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS`,
  `MAX_CODE_BYTES`, `MAX_STDOUT_BYTES`, `MAX_STDERR_BYTES`, `SANDBOX_JOB_NAME`; loses
  `RUN_PYTHON_TIMEOUT_MS`. `buildServices` in `container.ts` constructs a `CloudRunSandboxClient`
  instead of a `VertexSandboxClient` when `GOOGLE_CLOUD_PROJECT` is set — same conditional, same
  `sandboxClient?: SandboxClient` test seam untouched.

- [ ] **Step 1: Check for an existing config test**

Run: `find backend/src -iname "config.test.ts"`
If it exists, read it before editing `config.ts` so the new keys follow its existing assertion
style (likely a schema-parses-with-defaults check). If it doesn't exist, no new test is required
for this task — `config.ts` has no dedicated suite today, and validation happens implicitly via
`npx tsc --noEmit` plus every other test file that imports `Config`.

- [ ] **Step 2: Update `config.ts`**

```typescript
// Replace backend/src/config.ts:156-168 (the ENABLE_RUN_PYTHON block through
// RUN_PYTHON_MAX_OUTPUT_CHARS) with:

  /**
   * Second, independent gate on top of ENABLE_TOOL_USE — arbitrary code execution is a
   * materially larger blast radius than read-only project-file search, and must be
   * independently toggleable. Both must be true for run_python to appear in the tool list.
   */
  ENABLE_RUN_PYTHON: bool(false),
  /** Region for the Cloud Run Job (docs/decisions/0005-cloud-run-sandbox.md) — the
   *  arcnave-python-sandbox job's own region, independent of VERTEX_LOCATION/GEMINI_LOCATION. */
  SANDBOX_LOCATION: z.string().default('us-central1'),
  /** Name of the Cloud Run Job resource run_python launches per call. */
  SANDBOX_JOB_NAME: z.string().default('arcnave-python-sandbox'),
  /** Raw UTF-8 byte ceiling on submitted code, enforced client-side before any network call.
   *  Cloud Run caps a single env-var value at 32,768 bytes and base64 expands by ~33%, so the
   *  real ceiling is ~24.5 KiB; this stays comfortably under that. */
  MAX_CODE_BYTES: int(20 * 1024),
  /** In-container deadline (passed as RUN_PYTHON_CODE_TIMEOUT_MS) bounding only the user's
   *  Python subprocess — never reused as the client-side orchestration deadline below. */
  RUN_PYTHON_CODE_TIMEOUT_MS: int(10_000),
  /** Client-side deadline covering the entire jobs:run -> Operation -> Execution -> Cloud
   *  Logging round trip. Must stay comfortably larger than RUN_PYTHON_CODE_TIMEOUT_MS plus
   *  realistic Cloud Run scheduling and Cloud Logging indexing lag. */
  RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS: int(45_000),
  /** Streaming-capture cap enforced by the in-container runner as it reads each pipe — not a
   *  post-hoc slice, so an unbounded print loop can't OOM the container before this applies. */
  MAX_STDOUT_BYTES: int(64 * 1024),
  MAX_STDERR_BYTES: int(64 * 1024),
  /** Same three-tier shape as READ_PROJECT_FILE_MAX_CHARS/TOOL_RESULT_PREVIEW_CHARS above: this
   *  bounds what the model receives and what is persisted; the SSE preview is bounded again by
   *  TOOL_RESULT_PREVIEW_CHARS, unchanged. */
  RUN_PYTHON_MAX_OUTPUT_CHARS: int(8000),
```

- [ ] **Step 3: Update `container.ts`**

```typescript
// Replace the import at container.ts:24
import { CloudRunSandboxClient } from './tools/sandbox/cloudRunSandboxClient.js';
```

```typescript
// Replace the sandboxClient construction at container.ts:75-79
  const sandboxClient =
    options.sandboxClient ??
    (cfg.GOOGLE_CLOUD_PROJECT
      ? CloudRunSandboxClient.withAdc(cfg.GOOGLE_CLOUD_PROJECT, cfg.SANDBOX_LOCATION, cfg.SANDBOX_JOB_NAME, {
          maxCodeBytes: cfg.MAX_CODE_BYTES,
          codeTimeoutMs: cfg.RUN_PYTHON_CODE_TIMEOUT_MS,
          orchestrationTimeoutMs: cfg.RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS,
          maxStdoutBytes: cfg.MAX_STDOUT_BYTES,
          maxStderrBytes: cfg.MAX_STDERR_BYTES,
        })
      : undefined);
```

- [ ] **Step 4: Update `.env.example`**

Find and replace the `RUN_PYTHON_TIMEOUT_MS` line (if present) in `.env.example` with the new
variable names, matching whatever comment style the file already uses for the existing sandbox
variables. Read the file first to match formatting exactly.

- [ ] **Step 5: Full typecheck and backend suite**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean — this is the step that proves nothing else in the codebase still references
`cfg.RUN_PYTHON_TIMEOUT_MS`. If `tsc` fails on a stale reference, grep for it:
`grep -rn "RUN_PYTHON_TIMEOUT_MS" backend/src` and fix every remaining site.

- [ ] **Step 6: Regenerate OpenAPI docs if the schema changed**

`config.ts` changes don't touch route schemas, so this should be a no-op, but confirm:

Run: `cd backend && npm run openapi && git diff --stat docs/openapi.json`
Expected: no diff (config isn't part of the API surface).

- [ ] **Step 7: Commit**

```bash
git add backend/src/config.ts backend/src/container.ts .env.example
git commit -m "feat(tools): wire CloudRunSandboxClient into container.ts, replacing VertexSandboxClient"
```

---

### Task 8: Sandbox Docker image — `Dockerfile` and `runner.py`

Build the actual container the Cloud Run Job runs: a non-root Python image whose entrypoint
decodes the submitted code, runs it in its own process group with a hard timeout, captures
stdout/stderr via streaming-and-capped reader threads, and emits exactly one
`ARCNAVE_SANDBOX_RESULT:` line.

**Files:**
- Create: `backend/sandbox/Dockerfile`
- Create: `backend/sandbox/runner.py`

**Interfaces:**
- Consumes (via environment variables at container run time): `RUN_PYTHON_CODE_B64`,
  `RUN_PYTHON_CODE_TIMEOUT_MS`, `RUN_PYTHON_EXECUTION_ID`, optional `MAX_STDOUT_BYTES`/
  `MAX_STDERR_BYTES` (defaults `65536` each if unset).
- Produces: exactly one line on the container's own stdout, prefixed `ARCNAVE_SANDBOX_RESULT:`,
  followed by JSON matching `SandboxResultLine` from Task 5 (`type`, `executionId`, `ok`,
  `exitCode`, `stdout`, `stderr`, `stdoutTruncated`, `stderrTruncated`, `timedOut`, `durationMs`).

This task has no Vitest coverage — it's Python, not TypeScript, and runs in a container, not the
backend test process. Task 9 builds the Docker-based integration check that verifies this file's
actual behavior. Write it carefully since there's no fast feedback loop for it here.

- [ ] **Step 1: Write `runner.py`**

```python
#!/usr/bin/env python3
"""Sandbox entrypoint. Decodes RUN_PYTHON_CODE_B64, runs it as a subprocess in its own process
group with a hard wall-clock timeout, captures stdout/stderr with a streaming byte cap (never
buffer-then-slice, which would let unbounded output OOM the container before any cap applied),
and emits exactly one ARCNAVE_SANDBOX_RESULT: line — the child's own stdout/stderr never reach
this process's stdout directly, so submitted code can never spoof the result line. See
docs/decisions/0005-cloud-run-sandbox.md."""
import base64
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time

RESULT_PREFIX = "ARCNAVE_SANDBOX_RESULT:"


def _read_capped(pipe, cap_bytes: int, out: dict) -> None:
    """Reads `pipe` to EOF, keeping only the first `cap_bytes` bytes and setting
    out['truncated'] once the cap is hit. Keeps draining past the cap — stopping early would
    leave the child blocked on a full OS pipe buffer instead of letting it exit or be killed."""
    buf = bytearray()
    truncated = False
    while True:
        chunk = pipe.read(4096)
        if not chunk:
            break
        if not truncated:
            remaining = cap_bytes - len(buf)
            if remaining > 0:
                buf.extend(chunk[:remaining])
            if len(buf) >= cap_bytes:
                truncated = True
    out["data"] = bytes(buf)
    out["truncated"] = truncated


def main() -> None:
    code_b64 = os.environ["RUN_PYTHON_CODE_B64"]
    code_timeout_ms = int(os.environ["RUN_PYTHON_CODE_TIMEOUT_MS"])
    execution_id = os.environ["RUN_PYTHON_EXECUTION_ID"]
    max_stdout = int(os.environ.get("MAX_STDOUT_BYTES", "65536"))
    max_stderr = int(os.environ.get("MAX_STDERR_BYTES", "65536"))

    code = base64.b64decode(code_b64).decode("utf-8")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        script_path = f.name

    start = time.monotonic()
    proc = subprocess.Popen(
        [sys.executable, script_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,  # own process group, so a timeout can kill descendants too
    )

    stdout_out: dict = {}
    stderr_out: dict = {}
    stdout_thread = threading.Thread(target=_read_capped, args=(proc.stdout, max_stdout, stdout_out))
    stderr_thread = threading.Thread(target=_read_capped, args=(proc.stderr, max_stderr, stderr_out))
    stdout_thread.start()
    stderr_thread.start()

    timed_out = False
    try:
        exit_code = proc.wait(timeout=code_timeout_ms / 1000)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        exit_code = proc.wait()

    stdout_thread.join()
    stderr_thread.join()
    os.unlink(script_path)

    result = {
        "type": "arcnave.run_python.result.v1",
        "executionId": execution_id,
        "ok": exit_code == 0 and not timed_out,
        "exitCode": exit_code,
        "stdout": stdout_out["data"].decode("utf-8", errors="replace"),
        "stderr": stderr_out["data"].decode("utf-8", errors="replace"),
        "stdoutTruncated": stdout_out["truncated"],
        "stderrTruncated": stderr_out["truncated"],
        "timedOut": timed_out,
        "durationMs": int((time.monotonic() - start) * 1000),
    }
    print(RESULT_PREFIX + json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ArcNave run_python sandbox — a single-use Cloud Run Job container. Runs as a non-root user;
# the runtime service account it's deployed with has zero project IAM (see
# docs/decisions/0005-cloud-run-sandbox.md), so this file's own isolation (non-root user, process-
# group timeout kill in runner.py) is the meaningful layer, not "this container can't do damage
# because it has no credentials" alone.

FROM python:3.12-slim

# Fixed, build-time-installed package set — matches ADR-0004's parity goal with Claude.ai/
# ChatGPT's own code-execution tools. No pip install happens at request time.
RUN pip install --no-cache-dir pandas numpy matplotlib

RUN useradd --create-home --shell /usr/sbin/nologin sandbox
USER sandbox
WORKDIR /home/sandbox

COPY --chown=sandbox:sandbox runner.py /home/sandbox/runner.py

ENTRYPOINT ["python3", "/home/sandbox/runner.py"]
```

- [ ] **Step 3: Build the image locally to confirm it compiles**

Run: `cd backend/sandbox && docker build -t arcnave-python-sandbox:local .`
Expected: builds successfully. This is a build-only smoke check — Task 9 runs the image and
asserts its actual behavior.

- [ ] **Step 4: Commit**

```bash
git add backend/sandbox/Dockerfile backend/sandbox/runner.py
git commit -m "feat(sandbox): add the Cloud Run Job image and its runner.py entrypoint"
```

---

### Task 9: Docker-based integration check — proves the image's actual behavior

This is deliberately **not** part of `npx vitest run` (which must never reach a real provider or
container) — it's a standalone script that builds the image from Task 8 and runs it via
`docker run`, asserting the exact `ARCNAVE_SANDBOX_RESULT:` protocol line for several real
scripts, including the two properties unit tests can't prove: process-group cleanup on timeout,
and streaming (not buffer-then-slice) output capture.

**Files:**
- Create: `backend/sandbox/test/run-integration-tests.sh`
- Modify: `backend/package.json` (add a `test:sandbox-image` script pointing at the new file, run
  manually / in a separate CI step — not part of `npm test`)

**Interfaces:**
- Consumes: the `arcnave-python-sandbox:local` image built in Task 8.
- Produces: a shell script exiting non-zero on any assertion failure, printing a clear PASS/FAIL
  per case.

- [ ] **Step 1: Write the integration script**

```bash
#!/usr/bin/env bash
# Docker-based integration check for backend/sandbox — NOT part of `npx vitest run`. Builds the
# real image and runs it via `docker run` (not Cloud Run) with the same env-var protocol
# CloudRunSandboxClient uses, asserting the runner's actual behavior: the exact result-line
# protocol, process-group cleanup on timeout, streaming output capture, and non-root execution.
# See docs/superpowers/specs/2026-09-19-cloud-run-sandbox-design.md, "Testing".
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE=arcnave-python-sandbox:integration-test
docker build -t "$IMAGE" .

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

b64() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

run_case() {
  local name="$1" code="$2" timeout_ms="$3"
  docker run --rm \
    -e RUN_PYTHON_CODE_B64="$(b64 "$code")" \
    -e RUN_PYTHON_CODE_TIMEOUT_MS="$timeout_ms" \
    -e RUN_PYTHON_EXECUTION_ID="test-$name" \
    "$IMAGE"
}

echo "== success =="
OUT=$(run_case success 'print("hello")' 5000)
echo "$OUT" | grep -q 'ARCNAVE_SANDBOX_RESULT:' || fail "success: no result line"
echo "$OUT" | grep -q '"ok": true' || fail "success: expected ok: true"
echo "$OUT" | grep -q 'hello' || fail "success: expected stdout to contain hello"

echo "== exception =="
OUT=$(run_case exception 'raise ValueError("boom")' 5000)
echo "$OUT" | grep -q '"ok": false' || fail "exception: expected ok: false"
echo "$OUT" | grep -q 'ValueError' || fail "exception: expected stderr to mention ValueError"

echo "== timeout =="
OUT=$(run_case timeout 'import time; time.sleep(30)' 2000)
echo "$OUT" | grep -q '"timedOut": true' || fail "timeout: expected timedOut: true"

echo "== process-group cleanup on timeout =="
# Spawns a detached grandchild that outlives a naive single-process kill; if killpg works, the
# container exits promptly instead of hanging on the orphaned sleep.
START=$(date +%s)
OUT=$(run_case pgroup 'import subprocess, time; subprocess.Popen(["sleep", "30"]); time.sleep(30)' 2000)
END=$(date +%s)
DURATION=$((END - START))
echo "$OUT" | grep -q '"timedOut": true' || fail "pgroup: expected timedOut: true"
[ "$DURATION" -lt 10 ] || fail "pgroup: container took ${DURATION}s to exit — killpg likely didn't reap the child"

echo "== streaming output capture (no OOM on unbounded print) =="
OUT=$(docker run --rm --memory=128m \
  -e RUN_PYTHON_CODE_B64="$(b64 'i = 0
while i < 200:
    print("X" * 100000)
    i += 1')" \
  -e RUN_PYTHON_CODE_TIMEOUT_MS=10000 \
  -e RUN_PYTHON_EXECUTION_ID=test-stdout-cap \
  -e MAX_STDOUT_BYTES=65536 \
  "$IMAGE")
echo "$OUT" | grep -q '"stdoutTruncated": true' || fail "stdout cap: expected stdoutTruncated: true"

echo "== non-root execution =="
UID_OUTPUT=$(docker run --rm --entrypoint id "$IMAGE" -u)
[ "$UID_OUTPUT" != "0" ] || fail "container is running as root (uid 0)"

echo "ALL SANDBOX INTEGRATION CHECKS PASSED"
```

- [ ] **Step 2: Make it executable and run it**

Run:
```bash
chmod +x backend/sandbox/test/run-integration-tests.sh
backend/sandbox/test/run-integration-tests.sh
```
Expected: `ALL SANDBOX INTEGRATION CHECKS PASSED`. If the process-group case hangs or takes ~30s
instead of exiting quickly, `killpg` isn't reaping the child — go back to Task 8's `runner.py` and
fix it before continuing; do not weaken this check to make it pass.

- [ ] **Step 3: Add an npm script pointer (documentation, not part of `npm test`)**

```json
// In backend/package.json's "scripts" block, add:
    "test:sandbox-image": "bash sandbox/test/run-integration-tests.sh",
```

- [ ] **Step 4: Commit**

```bash
git add backend/sandbox/test/run-integration-tests.sh backend/package.json
git commit -m "test(sandbox): add Docker-based integration check for the runner image"
```

---

### Task 10: IAM custom role, Cloud Run Job resource, and a deployment-config verification script

Document the exact `gcloud` commands to create the two service accounts, the custom IAM role, and
the Cloud Run Job resource — and add a small script that checks the deployed configuration
actually matches what the design requires (`maxRetries=0`, `taskCount=1`, the runtime SA's empty
bindings), since none of that is exercised by unit tests.

**Files:**
- Create: `docs/deploy/cloud-run-sandbox-setup.md`
- Create: `backend/sandbox/verify-deployment-config.sh`

- [ ] **Step 1: Write the setup doc**

```markdown
# Cloud Run sandbox setup — one-time infrastructure for `run_python`

Manual setup, run once per environment (not part of the automated deploy — ArcNave's Cloud Build
trigger deploys the backend *service*, not this Job or its IAM). See
[ADR-0005](../decisions/0005-cloud-run-sandbox.md) for why this shape.

## 1. Sandbox runtime service account — zero project IAM

\`\`\`bash
gcloud iam service-accounts create arcnave-sandbox-runtime \
  --display-name="ArcNave run_python sandbox runtime (no project IAM)"
\`\`\`

Do not grant this account any role. That is the point — verify with:

\`\`\`bash
gcloud projects get-iam-policy "$GOOGLE_CLOUD_PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:arcnave-sandbox-runtime@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
\`\`\`
Expected: no output.

## 2. Backend service account — custom role

\`\`\`bash
gcloud iam roles create arcnave_sandbox_launcher \
  --project="$GOOGLE_CLOUD_PROJECT" \
  --title="ArcNave sandbox launcher" \
  --description="Launch and read arcnave-python-sandbox Job executions; read their logs" \
  --permissions=run.jobs.run,run.jobs.runWithOverrides,run.operations.get,run.executions.get

gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member="serviceAccount:<existing-backend-sa>@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --role="projects/${GOOGLE_CLOUD_PROJECT}/roles/arcnave_sandbox_launcher"

# Logging read, scoped as narrowly as a built-in role allows — NOT roles/logging.viewer.
# A dedicated log view is a v1 gap (see ADR-0005), not built here.
gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member="serviceAccount:<existing-backend-sa>@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --role="roles/logging.viewAccessor"
\`\`\`

Replace `<existing-backend-sa>` with the backend Cloud Run service's actual service account name
before running.

## 3. Cloud Run Job resource

\`\`\`bash
gcloud run jobs create arcnave-python-sandbox \
  --image="<SANDBOX_IMAGE_URL>" \
  --region="$SANDBOX_LOCATION" \
  --service-account="arcnave-sandbox-runtime@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --tasks=1 \
  --max-retries=0 \
  --parallelism=1 \
  --cpu=1 \
  --memory=512Mi \
  --task-timeout=15s
\`\`\`

`--task-timeout` here (15s) is deliberately just above `RUN_PYTHON_CODE_TIMEOUT_MS`'s default
(10s) — a backstop, not the primary timeout enforcement (that's `runner.py`'s own in-container
deadline). `<SANDBOX_IMAGE_URL>` is the image built from `backend/sandbox/Dockerfile` (Task 8),
pushed to Artifact Registry — not part of the main backend's Cloud Build trigger; push it
manually or add a separate trigger when this graduates past manual setup.

## 4. Verify

Run `backend/sandbox/verify-deployment-config.sh` after any change to the Job resource or either
service account — see that script for exactly what it checks and why.
```

- [ ] **Step 2: Write the verification script**

```bash
#!/usr/bin/env bash
# Checks that the deployed arcnave-python-sandbox Job actually matches what
# docs/decisions/0005-cloud-run-sandbox.md requires — maxRetries=0, taskCount=1, and the
# runtime service account carrying zero project IAM bindings. None of this is exercised by
# CloudRunSandboxClient's unit tests (which use a fake fetch), so this is the only thing that
# actually verifies the deployed resource, not just the code that talks to it.
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT first}"
: "${SANDBOX_LOCATION:=us-central1}"
JOB_NAME="${SANDBOX_JOB_NAME:-arcnave-python-sandbox}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

JOB_JSON=$(gcloud run jobs describe "$JOB_NAME" --region="$SANDBOX_LOCATION" --format=json)

MAX_RETRIES=$(echo "$JOB_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["spec"]["template"]["spec"]["template"]["spec"].get("maxRetries", d["spec"].get("taskTemplate",{}).get("maxRetries","?")))' 2>/dev/null || echo "?")
echo "maxRetries: $MAX_RETRIES"

RUNTIME_SA=$(echo "$JOB_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("spec",{}).get("template",{}).get("spec",{}).get("template",{}).get("spec",{}).get("serviceAccountName","?"))' 2>/dev/null || echo "?")
echo "Runtime service account: $RUNTIME_SA"

if [ "$RUNTIME_SA" = "?" ] || [ -z "$RUNTIME_SA" ]; then
  fail "could not determine the Job's runtime service account from 'gcloud run jobs describe' output — inspect \$JOB_JSON manually and update this script's JSON path for the current gcloud output shape"
fi

BINDINGS=$(gcloud projects get-iam-policy "$GOOGLE_CLOUD_PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${RUNTIME_SA}" \
  --format="value(bindings.role)")

if [ -n "$BINDINGS" ]; then
  fail "runtime service account $RUNTIME_SA has project IAM bindings, expected none:
$BINDINGS"
fi

echo "OK: runtime service account has zero project IAM bindings"
echo "Manually confirm maxRetries=0 and taskCount=1 above against the 'gcloud run jobs create' command in docs/deploy/cloud-run-sandbox-setup.md — gcloud's JSON output shape for Jobs has moved between API versions, so this script's parsing may need adjustment; treat a '?' above as a signal to check by hand, not as a pass."
```

- [ ] **Step 3: Make executable**

Run: `chmod +x backend/sandbox/verify-deployment-config.sh`

- [ ] **Step 4: Commit**

```bash
git add docs/deploy/cloud-run-sandbox-setup.md backend/sandbox/verify-deployment-config.sh
git commit -m "docs(deploy): add Cloud Run sandbox IAM/Job setup and a config verification script"
```

---

### Task 11: Update the checkpoint doc

Record that this implementation landed, distinct from it being *live-verified* against real Cloud
Run (which is a separate, later step — see ADR-0005's Cleanup section for what triggers deleting
`vertexSandboxClient.ts`).

**Files:**
- Modify: `docs/checkpoints/CURRENT.md`

- [ ] **Step 1: Add a new dated section**

Read the existing "Item 9 — tool-calling framework, phase 2 (`run_python`)" section first (it's
long — search for that heading) so the new section's tone and level of detail matches. Add a new
subsection directly after it, following the file's existing pattern (what shipped, test counts,
what's still not verified):

```markdown
### Item 9 — tool-calling framework, phase 2 (`run_python`), self-hosted Cloud Run sandbox — <TODAY'S DATE>

Replaced `VertexSandboxClient` (Vertex AI Agent Engine Code Execution — stayed blocked, Preview-
only with self-contradicting REST docs across five tried shapes, see the entry above) with
`CloudRunSandboxClient`: run_python now launches a fresh Cloud Run Job execution
(`arcnave-python-sandbox`) per call. See [ADR-0005](../decisions/0005-cloud-run-sandbox.md) and
the design spec at `docs/superpowers/specs/2026-09-19-cloud-run-sandbox-design.md` for the full
design; this entry records what actually landed.

**Implemented:** `CloudRunSandboxClient` (`backend/src/tools/sandbox/cloudRunSandboxClient.ts`)
behind the existing `SandboxClient` interface — `CodeExecutionToolExecutor` needed zero changes.
Two independent timeouts (`RUN_PYTHON_CODE_TIMEOUT_MS` in-container,
`RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS` client-side) replace the single timeout that was previously
wired only as an unenforced sandbox `ttl` field. `MAX_CODE_BYTES` (20 KiB) enforced before any
network call. Cloud Logging result correlation uses both the real Cloud Run execution identity
and an embedded `RUN_PYTHON_EXECUTION_ID`. The sandbox image (`backend/sandbox/`) runs as a
non-root user, kills the whole process group on an in-container timeout (not just the immediate
child), and streams-and-caps stdout/stderr as it reads rather than buffering then slicing.
`run_python`'s tool description was also fixed — it previously told the model the sandbox has
"no network access", which was never true of this design (ADR-0005 allows egress); it now says
so accurately.

**Test coverage:** `cloudRunSandboxClient.test.ts` — fake-`fetch` coverage for the size guard,
Operation/Execution polling, terminal-state detection via the real v2 fields (no `status` enum),
Cloud Logging result polling with retry-on-indexing-lag and two-part correlation, and the two
independent timeouts. A separate Docker-based integration script
(`backend/sandbox/test/run-integration-tests.sh`, not part of `npx vitest run`) builds and runs
the real image, proving process-group cleanup on timeout and streaming output capture — properties
no fake-`fetch` unit test can verify. Full backend suite: <RUN AND FILL IN THE ACTUAL COUNT>
passing. `npx tsc --noEmit`: clean.

**Not yet done — deferred to a follow-up session:** live verification against a real deployed
Cloud Run Job (the IAM custom role, the Job resource, and the two service accounts documented in
`docs/deploy/cloud-run-sandbox-setup.md` need to actually be created in the project first —
`backend/sandbox/verify-deployment-config.sh` checks the deployed shape once they are).
`ENABLE_RUN_PYTHON` stays `false` in production until that live-verification pass happens, same
bar item 9 phase 1/2's original live-verification used. `vertexSandboxClient.ts` and its test are
**not deleted yet** — per ADR-0005, that happens only once `CloudRunSandboxClient` is confirmed
working against real Cloud Run, not before.
```

Fill in `<TODAY'S DATE>` and the actual passing test count from Step 2 below before committing —
do not leave placeholder text in the committed file.

- [ ] **Step 2: Get the real test count**

Run: `cd backend && npx vitest run 2>&1 | tail -5`
Copy the actual `X passed` count into the section above.

- [ ] **Step 3: Update the "Status" line near the top of the file if warranted**

Read the file's opening "Status" paragraph — if it currently states `ENABLE_RUN_PYTHON` is off
pending an Agent Engine fix, update that specific clause to reflect the new blocker (pending live
verification of the Cloud Run sandbox, not pending a REST-shape fix), without rewriting the rest
of the paragraph's history.

- [ ] **Step 4: Commit**

```bash
git add docs/checkpoints/CURRENT.md
git commit -m "docs(checkpoints): record the Cloud Run sandbox implementation for run_python"
```

---

## Explicitly not covered by this plan

- Live verification against a real deployed Cloud Run Job — requires actually running the
  `gcloud` commands in Task 10's doc against a real project, which is an infrastructure change
  outside a code-review-driven implementation plan. Flagged in Task 11's checkpoint entry as the
  next required step before `ENABLE_RUN_PYTHON` can go back to `true`.
- Deleting `vertexSandboxClient.ts`/its test — deferred until the above live verification
  succeeds, per ADR-0005's Cleanup section.
- A dedicated Cloud Logging log view for tighter log-read isolation, and Cloud Run's
  `--sandbox-launcher` — both explicitly deferred in ADR-0005 as future hardening, not v1 scope.
