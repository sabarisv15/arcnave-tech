# Design: self-hosted Cloud Run sandbox for `run_python`

**Date:** 2026-09-19
**Status:** approved by user, pending write-up as an implementation plan
**Decision record:** [ADR-0005](../../decisions/0005-cloud-run-sandbox.md) — read that first for
*why*; this document is *how*.

## Summary

Replace `VertexSandboxClient` (blocked — Vertex AI Agent Engine Code Execution is Preview-only
with self-contradicting REST docs, see ADR-0005) with `CloudRunSandboxClient`, a new
implementation of the existing `SandboxClient` interface
(`backend/src/tools/sandbox/client.ts`). Everything above that interface —
`CodeExecutionToolExecutor`, `DispatchingToolExecutor`, `ENABLE_RUN_PYTHON`,
`GenerationService`/`container.ts` wiring — is unchanged. `CodeExecutionToolExecutor` already
expects `SandboxExecutionResult.outputs` to contain an `application/json` chunk shaped
`{ msg_out?, msg_err? }` (`codeExecutionExecutor.ts:21-25`); `CloudRunSandboxClient` must produce
that exact shape so the executor needs zero code changes.

## Architecture

```
CodeExecutionToolExecutor
        │  SandboxClient.runPython(code, signal)
        ▼
CloudRunSandboxClient                              (backend, uses ADC via google-auth-library,
        │                                            same pattern as VertexSandboxClient/
        │  enforce MAX_CODE_BYTES (~20 KiB)          gptOssVertex.ts)
        │  generate RUN_PYTHON_EXECUTION_ID
        │
        │  POST jobs:run, overrides.containerOverrides[].env:
        │    RUN_PYTHON_CODE_B64
        │    RUN_PYTHON_CODE_TIMEOUT_MS
        │    RUN_PYTHON_EXECUTION_ID
        ▼
Long-running Operation (response/metadata typed as Execution — NOT an Execution itself)
        │  poll Operation to completion, or read the Execution name out of
        │  Operation.metadata as soon as populated and switch to executions.get
        ▼
┌───────────────────────────────────────────┐
│ Cloud Run Job: arcnave-python-sandbox      │
│  taskCount=1, parallelism=1, maxRetries=0  │
│  fixed low CPU/memory                      │
│  non-root container user                   │
│  runtime SA: no project IAM at all         │
│                                             │
│  runner.py                                 │
│    1. decode RUN_PYTHON_CODE_B64           │
│    2. Popen(python, ..., new process group)│
│    3. RUN_PYTHON_CODE_TIMEOUT_MS deadline; │
│       on timeout, killpg() whole group     │
│    4. cap captured stdout/stderr bytes     │
│    5. print ARCNAVE_SANDBOX_RESULT:{JSON}  │
└───────────────────────────────────────────┘
        │  Cloud Run execution → Cloud Logging (stdout captured automatically)
        ▼
CloudRunSandboxClient
  1. poll executions.get until terminal
  2. poll Cloud Logging, bounded retry window, filtered by BOTH the real Cloud Run
     execution name (resource.labels.job_name/labels.execution_name/task_index) AND
     the embedded RUN_PYTHON_EXECUTION_ID inside the parsed result JSON
  3. parse ARCNAVE_SANDBOX_RESULT line → SandboxExecutionResult
```

Two separate deadlines, not one:

- **`RUN_PYTHON_CODE_TIMEOUT_MS`** — passed into the container, bounds only the user's Python
  subprocess (in-container `Popen`/timeout).
- **`RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS`** — enforced client-side by `CloudRunSandboxClient`
  across the *entire* `jobs.run` → Operation → Execution-poll → Cloud-Logging-poll round trip,
  via an internal `AbortController` combined with the caller's `AbortSignal` through
  `AbortSignal.any(...)` (same pattern `VertexSandboxClient.runPython` already uses). Must be
  comfortably larger than the code timeout plus realistic Cloud Run scheduling/cold-start and
  Cloud Logging indexing lag — not merely larger by a small margin.

## Components

### 1. Sandbox image (`backend/sandbox/`, new directory, own `Dockerfile`)

- Base: a Python slim image with pandas/numpy/matplotlib (and any other fixed set agreed at
  implementation time) installed at build time — no `pip install` at runtime.
- Built `FROM` a Python slim base, then `RUN useradd --create-home sandbox` and `USER sandbox`
  — the container never runs as root, independent of the zero-IAM runtime service account.
- `runner.py` entrypoint:
  - Reads `RUN_PYTHON_CODE_B64`, `RUN_PYTHON_CODE_TIMEOUT_MS`, `RUN_PYTHON_EXECUTION_ID` from
    env.
  - Decodes the code, writes it to a temp file, launches it via `subprocess.Popen([sys.executable,
    tmpfile], start_new_session=True, ...)` (its own process group, not just its own process) and
    waits with a deadline of `RUN_PYTHON_CODE_TIMEOUT_MS`. On timeout, `os.killpg(pgid,
    signal.SIGKILL)` — kills the whole group, not just the immediate child, so code that spawns
    its own subprocesses can't outlive the timeout by hiding a descendant. This in-container
    deadline is independent of, and set below, the Cloud Run Job's own task timeout.
  - Caps captured stdout/stderr at `MAX_STDOUT_BYTES`/`MAX_STDERR_BYTES` (env-configurable,
    sane defaults e.g. 64 KiB each), setting `stdoutTruncated`/`stderrTruncated` when hit.
  - On a timeout, sets `timedOut: true`, `ok: false`.
  - Always emits exactly one line to its own stdout at the very end:
    `ARCNAVE_SANDBOX_RESULT:` followed by JSON:
    ```json
    {
      "type": "arcnave.run_python.result.v1",
      "executionId": "...",
      "ok": true,
      "exitCode": 0,
      "stdout": "2\n",
      "stderr": "",
      "stdoutTruncated": false,
      "stderrTruncated": false,
      "timedOut": false,
      "durationMs": 41
    }
    ```
  - The child process's own stdout/stderr are captured (not inherited to the wrapper's stdout)
    specifically so user code can never emit its own fake `ARCNAVE_SANDBOX_RESULT:` line and
    spoof the protocol.

### 2. Cloud Run Job resource: `arcnave-python-sandbox`

- `taskCount=1`, `parallelism=1`, `maxRetries=0` (a failed run must surface as a failure, not
  silently retry with different output).
- Fixed CPU/memory limits (small — this runs short scripts, not data pipelines).
- Task timeout set slightly above `RUN_PYTHON_CODE_TIMEOUT_MS`'s default, as a backstop in case
  the in-container timeout somehow doesn't fire — this is distinct from
  `RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS`, which lives entirely client-side and Cloud Run has no
  knowledge of.
- Runtime service account: newly created, **zero** project-level IAM bindings.
- Container runs as a non-root user (`USER sandbox` in the Dockerfile).
- Deployed via its own `docker build`/push step (new image, new deploy target) — this is a
  distinct deployable unit from the main backend Cloud Run *service*; needs its own line in
  the deploy checklist/checkpoint docs.

### 3. IAM

- Backend Cloud Run service's existing service account gains: `run.jobs.run` **and**
  `run.jobs.runWithOverrides` scoped to `arcnave-python-sandbox` only — `run.jobs.run` alone is
  rejected once the call carries `overrides` (which it always does here). Google's predefined
  `roles/run.jobsExecutorWithOverrides` bundles both plus `run.executions.cancel`; verify at
  implementation time whether that predefined role or a custom role is the better fit. Also
  needs `run.executions.get` (or the closest built-in read role) and a logging read permission
  scoped as narrowly as a built-in role allows. A dedicated Cloud Logging log view restricted to
  just this job is **not** built in v1 (see ADR-0005) — the spec must not claim tighter
  isolation than what's actually implemented. Submitted code is execution metadata on this
  Job's `TaskTemplate`, not secret — another reason `run.executions.get` stays tightly scoped.
- New sandbox runtime service account: created, attached to the Job resource, given no
  bindings beyond what Cloud Run itself requires to run a container.

### 4. `CloudRunSandboxClient` (`backend/src/tools/sandbox/cloudRunSandboxClient.ts`, new)

- Constructor mirrors `VertexSandboxClient`: injectable `fetch` for tests, ADC-backed
  `getAccessToken`, a `static withAdc(...)` convenience constructor.
- `runPython(code, signal)`:
  1. Reject if `Buffer.byteLength(code, 'utf-8') > MAX_CODE_BYTES` (default **20 KiB** — Cloud
     Run's 32,768-byte-per-env-var ceiling, minus base64's ~33% expansion, minus headroom;
     the theoretical max is ~24.5 KiB, so 20 KiB leaves real margin) before any network call —
     typed `ProviderError`, same `code: 'provider_error'` convention as the existing client, and
     asserted in tests to make zero `fetch` calls when this fires.
  2. Generate `RUN_PYTHON_EXECUTION_ID` (uuid).
  3. `POST jobs:run` (Cloud Run Admin API v2) with `overrides.containerOverrides[0].env` set to
     `RUN_PYTHON_CODE_B64`, `RUN_PYTHON_CODE_TIMEOUT_MS`, `RUN_PYTHON_EXECUTION_ID`; combined
     abort signal per the orchestration deadline (below).
  4. The response is a long-running **Operation**, not an Execution — poll it to completion (or
     read the Execution name from `Operation.metadata` as soon as populated and switch to
     `executions.get` for richer task-count/condition detail). Do not assume the initial POST
     response is already an Execution.
  5. Poll the resolved Execution until `Succeeded`/`Failed`/`Cancelled`.
  6. If `Failed`/`Cancelled` with no way to recover a result line, return a failure
     `SandboxExecutionResult` (mapped by `CodeExecutionToolExecutor` same as any other failure).
  7. On `Succeeded`, poll Cloud Logging (`entries.list`) filtered by **both** the real Cloud Run
     execution identity (`resource.type="cloud_run_job"`, `resource.labels.job_name`,
     `labels.execution_name`, `labels.task_index`, the job's stdout `logName`) **and** a text
     match for `ARCNAVE_SANDBOX_RESULT:` — then, after parsing, verify the embedded
     `executionId` field equals the `RUN_PYTHON_EXECUTION_ID` generated in step 2. Two-part
     correlation (Cloud Run's own execution identity + ArcNave's UUID), not the UUID text match
     alone. Use a short bounded retry window (a few attempts, short backoff) to account for log
     indexing lag — the "execution succeeded but log appears a few polls later" case must not be
     treated as a one-shot read.
  8. A missing result line, a malformed one, or one whose `executionId` doesn't match after the
     retry window is exhausted is a genuine failure (typed `provider_error`), not a silent empty
     result or a mismatched read.
  9. Map the parsed JSON into `SandboxExecutionResult.outputs`: one `application/json` chunk
     shaped `{ msg_out: stdout, msg_err: stderr }` — matching exactly what
     `CodeExecutionToolExecutor` already parses, so that executor requires no changes.
- Timeout budget: `RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS` (default e.g. 45s) covers steps 3-8
  combined, client-side, via the same `AbortController` + `setTimeout` + `AbortSignal.any`
  pattern as `VertexSandboxClient`. `RUN_PYTHON_CODE_TIMEOUT_MS` (default e.g. 10s) is a
  *separate* value passed only into the container's own `Popen` deadline — never reused as the
  client-side deadline, and the orchestration timeout must stay comfortably larger than the code
  timeout plus realistic scheduling/indexing overhead.

### 5. Config

- Reuses `ENABLE_RUN_PYTHON` as the sole feature gate — no new flag.
- New env vars: sandbox job resource name/region (however `container.ts` already resolves
  region/project for the existing Vertex client — follow that precedent), `MAX_CODE_BYTES`
  (default 20 KiB, must stay under the ~24.5 KiB base64/env-var ceiling),
  `RUN_PYTHON_CODE_TIMEOUT_MS`, `RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS`,
  `MAX_STDOUT_BYTES`/`MAX_STDERR_BYTES` (client-side defaults acceptable; the image itself also
  enforces its own caps as a backstop even if the client-side value drifts).

## Testing

Mirrors `vertexSandboxClient.test.ts`'s structure (fake `fetch`, no real GCP), with cases added
for the new failure modes this design introduces:

- Successful execution, simple output.
- Syntax error in submitted code.
- Runtime exception in submitted code.
- Infinite loop → in-container timeout (`timedOut: true` in the result JSON).
- `jobs:run` returns a long-running Operation, not an Execution directly — client must handle
  the Operation shape, not assume the POST response is already an Execution.
- Operation metadata initially absent, then later contains the Execution name — client
  transitions to `executions.get` correctly once available.
- `runWithOverrides` request path: assert the outgoing request actually carries `overrides`
  (regression guard for the permission requirement, even though IAM itself isn't unit-testable).
- Code exactly at `MAX_CODE_BYTES` succeeds; code one byte over is rejected locally with zero
  `fetch` calls.
- Orchestration deadline (`RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS`) fires before the
  execution/log polls resolve — distinct from the in-container code-timeout case above.
- The code timeout does not consume orchestration/log-retrieval budget (assert the two deadlines
  are independent, not derived from one another).
- Execution resource itself reports `Failed`.
- Execution reports `Succeeded` but the result log only appears after a few polling attempts
  (the log-indexing-lag case) — must succeed, not time out early.
- No result log ever appears within the bounded retry window — typed failure, not a hang.
- stdout/stderr truncation surfaces `stdoutTruncated`/`stderrTruncated` correctly.
- A malformed (non-JSON, or JSON missing required fields) result line is treated as failure,
  not parsed partially.
- Two-part log correlation: a log entry matching the Cloud Run execution identity but with a
  *different* embedded `executionId` must never be accepted as this call's result (test with
  two concurrent/adjacent fake log entries).
- `ENABLE_RUN_PYTHON=false` still prevents `CloudRunSandboxClient` from ever being constructed
  or reached — existing `registry.test.ts`/flag-matrix coverage extended, not rebuilt.

**New, separate from the Vitest suite (which must never reach a real provider or container):** a
Docker-based integration check that builds the actual sandbox image and runs it via `docker run`
(not Cloud Run) with the same env-var protocol, asserting the exact `ARCNAVE_SANDBOX_RESULT:`
line for a few real scripts (success, exception, timeout, oversized output, a script that spawns
a child process and hangs — proving `killpg` reaps the whole group, not just the top-level
process). Also asserts the container runs as a non-root UID (`docker run ... whoami`/`id -u`
comparison), not just that the Dockerfile has a `USER` line.

**Deployment-config check:** `maxRetries=0`, `taskCount=1`, and the runtime SA's empty IAM
bindings should be asserted somewhere verifiable (e.g. a small script or a documented manual
check in the deploy checklist) rather than only trusted by inspection, since none of these are
exercised by unit tests.

## Cleanup

Once `CloudRunSandboxClient` is live-verified against real Cloud Run (same live-verification bar
item 9 phase 1/2 already used — see `docs/checkpoints/CURRENT.md`), delete
`vertexSandboxClient.ts` and its test file. `mistakes.md`'s existing entries about the five
failed Agent Engine attempts stay as-is — they're the historical record of why this path was
abandoned, not something to prune just because the code is gone.

## Explicitly out of scope for this change

- Cloud Run's `--sandbox-launcher` (Sandboxes) feature — Preview as of 2026-09-19, see ADR-0005.
  Recorded as future hardening, not built now.
- A dedicated Cloud Logging log view for tighter log-read isolation — accepted v1 gap, see
  ADR-0005.
- File-output chunks from the sandbox (only `stdout`/`stderr` are surfaced) — already out of
  scope per the original phase 2 checkpoint note, unchanged by this design.
- A skills registry, sub-agent spawning, goal/budget bookkeeping (items 10/11 of the original
  gap analysis) — unaffected by this change.
