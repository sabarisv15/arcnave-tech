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
        │  jobs.run, containerOverrides.env:         gptOssVertex.ts)
        │    RUN_PYTHON_CODE_B64
        │    RUN_PYTHON_TIMEOUT_MS
        │    RUN_PYTHON_EXECUTION_ID
        ▼
┌───────────────────────────────────────────┐
│ Cloud Run Job: arcnave-python-sandbox      │
│  taskCount=1, maxRetries=0                 │
│  fixed low CPU/memory                      │
│  runtime SA: no project IAM at all         │
│                                             │
│  runner.py                                 │
│    1. decode RUN_PYTHON_CODE_B64           │
│    2. subprocess.run(python, ..., timeout) │
│    3. cap captured stdout/stderr bytes     │
│    4. print ARCNAVE_SANDBOX_RESULT:{JSON}  │
└───────────────────────────────────────────┘
        │  Cloud Run execution → Cloud Logging (stdout captured automatically)
        ▼
CloudRunSandboxClient
  1. poll executions.get until terminal
  2. poll Cloud Logging (filtered by RUN_PYTHON_EXECUTION_ID), bounded retry window
  3. parse ARCNAVE_SANDBOX_RESULT line → SandboxExecutionResult
```

Both polling phases (1) and (2) share one deadline: `RUN_PYTHON_TIMEOUT_MS`, enforced by an
internal `AbortController` combined with the caller's `AbortSignal` via `AbortSignal.any(...)` —
same pattern `VertexSandboxClient.runPython` already uses.

## Components

### 1. Sandbox image (`backend/sandbox/`, new directory, own `Dockerfile`)

- Base: a Python slim image with pandas/numpy/matplotlib (and any other fixed set agreed at
  implementation time) installed at build time — no `pip install` at runtime.
- `runner.py` entrypoint:
  - Reads `RUN_PYTHON_CODE_B64`, `RUN_PYTHON_TIMEOUT_MS`, `RUN_PYTHON_EXECUTION_ID` from env.
  - Decodes the code, writes it to a temp file, runs it via `subprocess.run([sys.executable,
    tmpfile], timeout=..., capture_output=True)`. The `timeout` here is the in-container
    enforcement — independent of and slightly under the Cloud Run Job's own task timeout.
  - Caps captured stdout/stderr at `MAX_STDOUT_BYTES`/`MAX_STDERR_BYTES` (env-configurable,
    sane defaults e.g. 64 KiB each), setting `stdoutTruncated`/`stderrTruncated` when hit.
  - On `subprocess.TimeoutExpired`, sets `timedOut: true`, `ok: false`.
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
- Task timeout set slightly above `RUN_PYTHON_TIMEOUT_MS`'s default, as a backstop in case the
  in-container timeout somehow doesn't fire.
- Runtime service account: newly created, **zero** project-level IAM bindings.
- Deployed via its own `docker build`/push step (new image, new deploy target) — this is a
  distinct deployable unit from the main backend Cloud Run *service*; needs its own line in
  the deploy checklist/checkpoint docs.

### 3. IAM

- Backend Cloud Run service's existing service account gains: `run.jobs.run` scoped to
  `arcnave-python-sandbox` only, `run.executions.get` (or the closest built-in read role), and
  a logging read permission scoped as narrowly as a built-in role allows. A dedicated Cloud
  Logging log view restricted to just this job is **not** built in v1 (see ADR-0005) — the spec
  must not claim tighter isolation than what's actually implemented.
- New sandbox runtime service account: created, attached to the Job resource, given no
  bindings beyond what Cloud Run itself requires to run a container.

### 4. `CloudRunSandboxClient` (`backend/src/tools/sandbox/cloudRunSandboxClient.ts`, new)

- Constructor mirrors `VertexSandboxClient`: injectable `fetch` for tests, ADC-backed
  `getAccessToken`, a `static withAdc(...)` convenience constructor.
- `runPython(code, signal)`:
  1. Reject if `Buffer.byteLength(code, 'utf-8') > MAX_CODE_BYTES` before any network call —
     typed `ProviderError`, same `code: 'provider_error'` convention as the existing client.
  2. Generate `RUN_PYTHON_EXECUTION_ID` (uuid).
  3. `POST jobs.run` (Cloud Run Admin API v2) with `overrides.containerOverrides[0].env` set to
     the three env vars above; combined abort signal per the deadline rule.
  4. Poll the returned Execution (`executions.get`) until `Succeeded`/`Failed`/`Cancelled`.
  5. If `Failed`/`Cancelled` with no way to recover a result line, return a failure
     `SandboxExecutionResult` (mapped by `CodeExecutionToolExecutor` same as any other failure).
  6. On `Succeeded`, poll Cloud Logging (`entries.list`, filtered by resource type
     `cloud_run_job`, the job/execution name, and a text match on
     `RUN_PYTHON_EXECUTION_ID`) with a short bounded retry window (a few attempts, short
     backoff) to account for log indexing lag — this is the "execution succeeded but log
     appears a few polls later" case, must not be treated as a one-shot read.
  7. Parse the `ARCNAVE_SANDBOX_RESULT:` line. A missing or malformed line after the retry
     window is exhausted is a genuine failure (typed `provider_error`), not a silent empty
     result.
  8. Map the parsed JSON into `SandboxExecutionResult.outputs`: one `application/json` chunk
     shaped `{ msg_out: stdout, msg_err: stderr }` — matching exactly what
     `CodeExecutionToolExecutor` already parses, so that executor requires no changes.
- Timeout budget: one overall deadline (`RUN_PYTHON_TIMEOUT_MS`) covers steps 3-7 combined, same
  `AbortController` + `setTimeout` + `AbortSignal.any` pattern as `VertexSandboxClient`.

### 5. Config

- Reuses `ENABLE_RUN_PYTHON` as the sole feature gate — no new flag.
- New env vars: sandbox job resource name/region (however `container.ts` already resolves
  region/project for the existing Vertex client — follow that precedent), `MAX_CODE_BYTES`,
  `MAX_STDOUT_BYTES`/`MAX_STDERR_BYTES` (client-side defaults acceptable; the image itself also
  enforces its own caps as a backstop even if the client-side value drifts).

## Testing

Mirrors `vertexSandboxClient.test.ts`'s structure (fake `fetch`, no real GCP), with cases added
for the new failure modes this design introduces:

- Successful execution, simple output.
- Syntax error in submitted code.
- Runtime exception in submitted code.
- Infinite loop → in-container timeout (`timedOut: true` in the result JSON).
- Client-side deadline (`RUN_PYTHON_TIMEOUT_MS`) fires before the execution/log polls resolve.
- Execution resource itself reports `Failed`.
- Execution reports `Succeeded` but the result log only appears after a few polling attempts
  (the log-indexing-lag case) — must succeed, not time out early.
- No result log ever appears within the bounded retry window — typed failure, not a hang.
- stdout/stderr truncation surfaces `stdoutTruncated`/`stderrTruncated` correctly.
- A malformed (non-JSON, or JSON missing required fields) result line is treated as failure,
  not parsed partially.
- Log filter correlation: a log entry for a *different* execution ID must never be read as this
  call's result (test with two concurrent/adjacent fake log entries).
- `ENABLE_RUN_PYTHON=false` still prevents `CloudRunSandboxClient` from ever being constructed
  or reached — existing `registry.test.ts`/flag-matrix coverage extended, not rebuilt.
- `MAX_CODE_BYTES` rejection happens before any fake `fetch` call is made (assert zero calls).

**New, separate from the Vitest suite (which must never reach a real provider or container):** a
Docker-based integration check that builds the actual sandbox image and runs it via `docker run`
(not Cloud Run) with the same env-var protocol, asserting the exact `ARCNAVE_SANDBOX_RESULT:`
line for a few real scripts (success, exception, timeout, oversized output). This proves the
image's own entrypoint contract independent of any GCP call, and is not part of `npx vitest run`.

**Deployment-config check:** `maxRetries=0` and the runtime SA's empty IAM bindings should be
asserted somewhere verifiable (e.g. a small script or a documented manual check in the deploy
checklist) rather than only trusted by inspection, since neither is exercised by unit tests.

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
