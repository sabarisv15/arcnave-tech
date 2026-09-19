# ADR-0005: Self-hosted Cloud Run sandbox for `run_python`

- Status: accepted
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

- **Backend service account** (used by `CloudRunSandboxClient`): `run.jobs.run` scoped to the
  single `arcnave-python-sandbox` job, permission to read execution status, and permission to
  read that job's result logs. This account never touches user code.
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

### Code transport: base64 env vars, not raw argv

`jobs.run`'s per-execution `containerOverrides.env` accepts arbitrary values. The submitted code
travels as `RUN_PYTHON_CODE_B64` (base64 of UTF-8 source — avoids shell/quoting/newline/
null-byte issues, not for secrecy), alongside `RUN_PYTHON_TIMEOUT_MS` and a generated
`RUN_PYTHON_EXECUTION_ID` used as the log-correlation key. `CloudRunSandboxClient` rejects code
over `MAX_CODE_BYTES` (default 64 KiB) before ever calling `jobs.run`.

### Result channel: Cloud Logging, with a bounded second poll

`jobs.run` is asynchronous. `CloudRunSandboxClient` polls the Execution resource until it
reaches a terminal state, then polls Cloud Logging (filtered by the execution's own identifiers
plus `RUN_PYTHON_EXECUTION_ID`) for the runner's result line — because an execution can report
`Succeeded` slightly before its log entry is queryable, this is a **second bounded poll window**,
not a single read. Both the execution-status poll and the result-log poll share one overall
deadline (`RUN_PYTHON_TIMEOUT_MS`), enforced client-side the same way the fix to the earlier
Vertex-attempt's timeout bug already established.

The in-container runner never lets user code's own stdout become the protocol channel: it
captures the child process's stdout/stderr internally and, once the child exits or is killed for
timeout, the wrapper alone emits one line —
`ARCNAVE_SANDBOX_RESULT:{"type":"arcnave.run_python.result.v1", ...}` — that
`CloudRunSandboxClient` parses. A missing or malformed result line is a genuine failure, not
something to guess at.

### Resource limits beyond wall-clock

A timeout alone stops `while True: pass` but not a memory bomb or a fork loop. The Cloud Run Job
resource itself is configured with `taskCount=1`, `maxRetries=0`, fixed low CPU and memory, and a
Cloud Run-level task timeout slightly above the internal one (belt-and-suspenders, not the
primary enforcement). Inside the image, the runner also enforces `MAX_STDOUT_BYTES` /
`MAX_STDERR_BYTES` with truncation reported in the result JSON (`stdoutTruncated`) — an
uncapped `while True: print(...)` is a Cloud Logging cost/DoS surface, not just noisy output.

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
