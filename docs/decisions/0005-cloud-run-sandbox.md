# ADR-0005: Self-hosted Cloud Run sandbox for `run_python`

- Status: accepted; network egress superseded by [ADR-0007](0007-sandbox-no-general-egress.md) (2026-09-24); production engine superseded by [ADR-0010](0010-warm-sandbox-service.md) (2026-09-24)
- Date: 2026-09-19
- Supersedes: the sandbox-backend choice recorded in `docs/checkpoints/CURRENT.md`'s "Item 9 —
  tool-calling framework, phase 2 (`run_python`)" section (2026-09-19), which chose Vertex AI
  Agent Engine's Code Execution service. That section is not rewritten — see below for why it
  didn't work out, and this ADR for what replaces it.

## Context

Item 9 phase 2 gave `run_python` a real implementation behind a `SandboxClient` interface, with
`VertexSandboxClient` (`backend/src/tools/sandbox/vertexSandboxClient.ts`) as the only
implementation: raw REST against Vertex AI Agent Engine's Code Execution service, ADC-authenticated,
no Node/TS SDK existing for that surface (`googleapis/js-genai#2185`).

Five distinct request shapes were tried live against real Vertex, all rejected. The Code
Execution service is Preview-only, and Google's own reference docs and Python-SDK quickstart
disagree about which *resource* `executeCode` even targets (`reasoningEngines` vs.
`sandboxEnvironments`) — this is genuine vendor-documentation self-contradiction for a Preview
feature, not a case of needing to search harder. `ENABLE_RUN_PYTHON` has stayed `false` in
production since the live-verification pass on 2026-09-19 for exactly this reason (the
also-real timeout bug found the same day is fixed independently and is not what's blocking
this).

Continuing to reverse-engineer a Preview API with self-contradicting documentation is not a
reasonable use of further debugging time. The alternative: stop depending on Google's managed
sandbox product entirely and run our own.

## Decision

Run Python in a **Cloud Run Job**, one fresh execution per `run_python` call, and implement a
new `CloudRunSandboxClient` behind the existing `SandboxClient` interface. Nothing above that
interface (`CodeExecutionToolExecutor`, `DispatchingToolExecutor`, `ENABLE_RUN_PYTHON`) changes
— this is a swap of one `SandboxClient` implementation for another.

### IAM: two service accounts, not one

Cloud Run distinguishes the *caller* identity (who may launch a job) from the job's own
*runtime* identity (what the running container can do) — these must not be the same account:

- **Backend service account** (used by `CloudRunSandboxClient`): scoped to the single
  `arcnave-python-sandbox` job, this account needs **both** `run.jobs.run` and
  `run.jobs.runWithOverrides` — `run.jobs.run` alone is insufficient once the call supplies
  `overrides` (which it always does here, to pass the code/timeout/execution-id env vars).
  Google's predefined `roles/run.jobsExecutorWithOverrides` bundles
  `run.jobs.run`/`run.jobs.runWithOverrides`/`run.executions.cancel`, but notably **not**
  `run.operations.get` — needed separately because `jobs:run` returns a long-running Operation
  (see below), which the client must be able to poll. The backend account therefore needs a
  custom role (broader than the predefined role alone, narrower than adding a viewer role)
  covering: `run.jobs.run`, `run.jobs.runWithOverrides`, `run.operations.get`,
  `run.executions.get`, plus a scoped-down logging read permission. This account never touches
  user code.
- **Sandbox job runtime service account** (attached to the Cloud Run Job resource itself): no
  application or project permissions — no Storage, no Cloud SQL/DB access, no Secret Manager, no
  Vertex AI. User Python executing inside the job cannot use its own environment's workload
  identity token for anything, because that token is good for nothing.

For v1, the backend account's log-read permission is scoped as narrowly as a built-in role
allows (not a blanket `roles/logging.viewer`, which reads more of the project's logs than this
needs) but a dedicated Cloud Logging log view restricted to just the sandbox job's logs is
**not** built for v1 — flagged as a known gap, not a silent claim of full isolation. Revisit if
this sandbox is ever exposed to less-trusted input than it is today.

### Not depending on Cloud Run Sandboxes (`--sandbox-launcher`)

Cloud Run has a dedicated "Sandboxes" feature for untrusted code (`gcloud beta run jobs create
... --sandbox-launcher`). It is **not used here** — as of 2026-09-19 it is itself Preview, and
the entire reason for this ADR is to stop depending on a Preview product for something
production-load-bearing. Isolation for v1 comes from: a fresh container per execution (Cloud
Run's normal job semantics), `taskCount=1`/`maxRetries=0`, fixed low CPU/memory, no project IAM
on the runtime account, and in-container timeout/output caps (below). `--sandbox-launcher` is
recorded here as a **future hardening option** to adopt once it reaches GA/stable, not a
current dependency.

### Code transport: base64 env vars, not raw argv — with a real size ceiling

`jobs.run`'s per-execution `containerOverrides.env` accepts arbitrary values, but Cloud Run caps
a single environment-variable value at 32,768 bytes, and base64 expands data by ~33% — so the
largest raw source that fits in one `RUN_PYTHON_CODE_B64` value is roughly 24.5 KiB, not
whatever number would otherwise seem reasonable. `MAX_CODE_BYTES` is therefore **20 KiB**
(comfortable headroom under the ~24.5 KiB hard ceiling), enforced by `CloudRunSandboxClient`
before ever calling `jobs.run`. The code also travels alongside a generated
`RUN_PYTHON_EXECUTION_ID`, used below as one half of the log-correlation key.

Submitted code must not be treated as secret material: it is delivered through a Cloud Run
execution override and becomes part of that Execution resource's `TaskTemplate` — an immutable
piece of Cloud Run control-plane metadata, readable by any principal with `run.executions.get`
on this job. Base64 here is encoding for transport safety (avoiding shell/quoting/newline/
null-byte issues), not confidentiality. This is acceptable for `run_python`'s generated Python,
but it's another reason `run.executions.get` stays tightly scoped to the backend service
account, not granted more broadly.

### Two timeouts, not one: code execution vs. whole orchestration

A single timeout covering both "how long the user's Python may run" and "how long the whole
launch → execute → retrieve-result round trip may take" is unsafe in both directions: if Cloud
Run scheduling/cold-start eats several seconds before the code even starts, the same deadline
that should bound the *code* now also has to cover scheduling latency and Cloud Logging's
indexing lag, leaving too little budget for the result to actually become readable. These are
split into two values:

- **`RUN_PYTHON_CODE_TIMEOUT_MS`** — the in-container `subprocess` deadline around the user's
  Python only (e.g. 10s default).
- **`RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS`** — the overall client-side deadline
  `CloudRunSandboxClient` enforces across `jobs.run` → Operation → Execution polling → Cloud
  Logging polling (e.g. 45s default) — must be comfortably larger than the code timeout plus
  realistic scheduling/indexing overhead, not just marginally larger.

Both are still gated solely by `ENABLE_RUN_PYTHON` — this split adds no new feature flag, only
two differently-named durations where there was incorrectly one.

### `jobs.run` returns a long-running Operation, not an Execution

`jobs.run` (Cloud Run Admin API v2) returns a Google long-running `Operation` whose eventual
`response` (and, once available, `metadata`) is typed as `Execution` — it does not hand back an
Execution resource directly. `CloudRunSandboxClient` must poll the Operation to completion (or
read the Execution name out of `Operation.metadata` as soon as it's populated, if available
earlier, and switch to polling `executions.get` from there for the richer task-count/condition
detail) rather than assume the initial POST response is already the Execution.

### Result channel: Cloud Logging, with a bounded second poll and two-part correlation

The v2 `Execution` resource has no single `status` enum field — terminal state is read from
`completionTime` (unset means still running/pending) plus `succeededCount`/`failedCount`/
`cancelledCount` (meaningful here specifically because this job is `taskCount=1`/
`maxRetries=0`, so each count is 0 or 1, never ambiguous), with `conditions[]` (e.g.
`CONDITION_SUCCEEDED`, `CONDITION_FAILED`, reasons like `NON_ZERO_EXIT_CODE`/`CANCELLED`)
available for diagnostic detail on failure. `CloudRunSandboxClient` must read these fields
directly rather than assume a convenience status string exists.

Once the Execution reaches a terminal state, `CloudRunSandboxClient` polls Cloud Logging for the
runner's result line — because an execution can report `Succeeded` slightly before its log entry
is queryable, this is a **second bounded poll window**, not a single read. The log filter
correlates on **two** identifiers, not one: the real Cloud Run execution name
(`resource.type="cloud_run_job"`, `resource.labels.job_name`, `labels.execution_name`,
`labels.task_index`) *and* the embedded `RUN_PYTHON_EXECUTION_ID` inside the parsed
`ARCNAVE_SANDBOX_RESULT:` JSON line itself — relying on the UUID text match alone would be
weaker. Both the execution-status poll and the result-log poll share the single
`RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS` deadline described above, enforced client-side the same
way the fix to the earlier Vertex-attempt's timeout bug already established.

The in-container runner never lets user code's own stdout become the protocol channel: it
captures the child process's stdout/stderr internally and, once the child exits or is killed for
timeout, the wrapper alone emits one line —
`ARCNAVE_SANDBOX_RESULT:{"type":"arcnave.run_python.result.v1", ...}` — that
`CloudRunSandboxClient` parses. A missing or malformed result line is a genuine failure, not
something to guess at.

### Resource limits beyond wall-clock

A timeout alone stops `while True: pass` but not a memory bomb or a fork loop. The Cloud Run Job
resource itself is configured with `taskCount=1`, `maxRetries=0`, fixed low CPU and memory, and a
Cloud Run-level task timeout slightly above `RUN_PYTHON_CODE_TIMEOUT_MS` (belt-and-suspenders,
not the primary enforcement). Inside the image, the runner also enforces `MAX_STDOUT_BYTES` /
`MAX_STDERR_BYTES` with truncation reported in the result JSON (`stdoutTruncated`) — an
uncapped `while True: print(...)` is a Cloud Logging cost/DoS surface, not just noisy output.
The runner also runs its Python child in its own process group (`start_new_session=True`) and
kills the whole group (`os.killpg(..., SIGKILL)`), not just the immediate child, on timeout —
submitted code that spawns its own subprocesses must not be able to outlive the timeout by
hiding a descendant process. The container itself runs as a non-root user (`USER sandbox`),
one more layer independent of the zero-IAM runtime service account.

stdout/stderr capture must be **streaming and bounded as it reads**, not
`process.communicate()` followed by a post-hoc slice — `communicate()` buffers the entire
stream in memory first, so `while True: print("X" * 1_000_000)` would exhaust the container's
memory before any 64 KiB cap ever applied. The runner uses a reader thread per pipe (stdout,
stderr) that retains only the first `MAX_STDOUT_BYTES`/`MAX_STDERR_BYTES` and discards the rest
— critically, it keeps *draining* the pipe past the cap rather than stopping, since an unread,
full OS pipe buffer would otherwise block the child process instead of letting it exit or be
killed.

### Runtime image

Python plus a fixed, build-time-installed data-science package set (pandas, numpy, matplotlib,
etc.) — matches what item 9's ADR-0004 gap analysis was closing (parity with Claude.ai/ChatGPT's
own code-execution tools), and avoids install-at-runtime non-determinism. Outbound network
egress is **allowed** (default Cloud Run networking, no VPC egress lockdown) — a deliberate
choice to let code reach package indexes or external APIs at runtime, accepted as the trade-off
against a fully air-gapped sandbox.

## Consequences

- `VertexSandboxClient` and its test file are deleted once `CloudRunSandboxClient` is verified
  working; `mistakes.md`'s account of the five failed Agent Engine attempts stays as history,
  it is not something to redo.
- A new deployable unit exists (the sandbox image + the Cloud Run Job resource + its own
  service account), which needs its own entry in the deploy/checkpoint docs and its own
  `docker build`/push step distinct from the main backend image.
- `ENABLE_RUN_PYTHON` stays the single feature flag; no new flag is introduced, since the risk
  shape this flag already represents (arbitrary code execution) hasn't changed.
- The dedicated-log-view gap (backend SA can currently read more via its logging role than
  strictly the sandbox's own entries, bounded only by the built-in role's own scope) is an
  accepted v1 trade-off, not a resolved one — tracked as a known issue, not silently assumed
  away.
