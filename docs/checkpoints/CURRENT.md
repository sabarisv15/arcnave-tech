# ArcNave — current checkpoint

**Last updated:** 2026-09-20
**Status:** backend API surface complete (41 routes); connected to Vertex AI — all four
models verified with real calls; frontend rewired onto the API — no mock data remains;
**deployed to production and confirmed working end-to-end in a real browser** — sign-in,
session persistence, and a real streamed chat answer all verified live (see
[Production deployment](#production-deployment-2026-09-17)) — with a stated `SameSite=None`
cookie trade-off, flagged there for revisit. **2026-09-18: the database moved from Neon
(`us-east-2`) to Cloud SQL in `asia-south1`** — same region as Cloud Run — specifically to kill
the cross-region latency that "accepted cold-start latency" trade-off was mostly actually
about; see [Database migration](#database-migration-2026-09-18). Production data was not
carried over (the prior Neon-backed accounts were test/throwaway). Native multimodal file
input (images/PDFs seen directly by Claude and Gemini) is code-complete and tested; a
2026-09-18 live test found it broken in production (local attachment storage does not survive
Cloud Run's per-instance ephemeral disk across requests) and fixed it with real
`STORAGE_BACKEND=gcs` support. **The live Cloud Run service already has
`STORAGE_BACKEND=gcs`/`STORAGE_GCS_BUCKET=arcnave-attachments` set** (confirmed by reading its
env vars directly while preparing this deploy) — the remaining gap was
`@google-cloud/storage` itself missing as a declared dependency, found independently twice
(once from the live production failure, once from reading the code before deploying) and
fixed both times; see mistakes.md. `PRICING_TABLE` now has real Vertex rates for all four
aliases in `.env.example`, pending propagation to the live service on its next full env sync.
**2026-09-18: file-handling parity with Claude.ai/ChatGPT (ADR-0004), items 1-8, backend
complete and tested** — spreadsheet/PowerPoint extraction, OCR, docx tables, audio/video
transcription, page-level citations, Gemini code execution, deterministic Markdown-to-Office
export — see [File-handling parity](#file-handling-parity-adr-0004--items-1-8-2026-09-18).
**2026-09-19: reconciled a 3-way branch divergence** (a parallel session had independently
pushed the same ADR-0004 work plus its own fixes directly to `main`) and **deployed live** —
Cloud Build succeeded, new Cloud Run revision confirmed at 100% traffic via `/readyz`, plus a
small frontend fix (`.pptx`/audio/video hadn't been added to the upload picker's `accept`
list even though the backend already supported them). Items 9-12 (tool-use/agent framework)
were researched first — see
[Tool-use/agent framework research](#tool-use-agent-framework-research--items-9-12-2026-09-19)
— then **item 9 phase 1, revised, was implemented** the same day: a bounded, sequential
tool-calling loop for both provider adapters, gated behind `ENABLE_TOOL_USE`; see
[Item 9 — tool-calling framework, phase 1 (revised)](#item-9--tool-calling-framework-phase-1-revised-2026-09-19).
**Item 9 phase 2 (`run_python`) was also implemented**, gated behind a second, independent flag
`ENABLE_RUN_PYTHON`, using a raw-REST `VertexSandboxClient` against Vertex AI Agent Engine's Code
Execution service (Preview, no Node/TS SDK); see
[Item 9 — tool-calling framework, phase 2 (`run_python`)](#item-9--tool-calling-framework-phase-2-run_python--2026-09-19).
**Both were live-verified in production on 2026-09-19** (see
[Live verification](#live-verification--item-9-phases-1-and-2--2026-09-19)):
`search_project_files` now works end to end on Gemini after fixing a real
`thought_signature`-dropping bug; `run_python` hung with no timeout and was **turned back off in
production** (`ENABLE_RUN_PYTHON=false`) pending a real fix. **The timeout is fixed and
live-confirmed** (no more hangs). **The sandbox call itself remains unresolved after five
distinct, real attempts, each grounded in an actual source** — two stable-`v1` REST reference
pages, the product's own quickstart notebook/Python SDK, one targeted field guess, and one
externally-sourced answer (tested, not trusted) — each rejected differently. The clearest signal
so far: two of the five got an explicit "Unknown name ..." for their wrong field; the very first
shape tried did not, for `inputs` — suggesting that field name is real and the bug is in its
contents, not its name. The REST reference and the official quickstart still disagree about
which *resource* `executeCode` even targets (`reasoningEngines` vs `sandboxEnvironments`); this
is vendor documentation genuinely contradicting itself for a Preview feature, not a case of
needing to search harder — see
[Blocked on the user](#blocked-on-the-user) and `mistakes.md`, 2026-09-19, for the full account
of all three shapes. **`VertexSandboxClient` was retired the same day**, replaced by
`CloudRunSandboxClient` — a self-hosted Cloud Run Job instead of another Agent Engine REST guess;
see [ADR-0005](../decisions/0005-cloud-run-sandbox.md) and
[the section below](#item-9--tool-calling-framework-phase-2-run_python-self-hosted-cloud-run-sandbox--2026-09-19).
**`ENABLE_RUN_PYTHON` is now live-verified and `true` in production**, 2026-09-20 — see
[the Cloud Run sandbox section below](#item-9--tool-calling-framework-phase-2-run_python-self-hosted-cloud-run-sandbox--2026-09-19)
for the full account. Left on deliberately because `REGISTRATION_ENABLED=false` and the user is
currently the only account that can sign in, so the larger blast radius that flag exists to gate
does not apply yet — revisit before registration reopens. `ENABLE_TOOL_USE` stays
`true` in production. A skills registry, sub-agent spawning, and goal/budget bookkeeping remain explicitly
deferred per `tools/MAPPING.md`.
**Progress:** ~75% of the brief in `ARCNAVE_BACKEND_CLAUDE_PROMPT.md`

> Read this first in a new session. It is the handoff. `CLAUDE.md` has the invariants;
> `mistakes.md` has what has already gone wrong here; `docs/backend-research.md` has the
> primary-source research; `docs/decisions/` has the ADRs.

---

## Objective

Replace ArcNave's mock provider boundary and browser-local persistence with a real backend:
Vertex AI model calls, PostgreSQL persistence, SSE streaming, grounded search with honest
citations, and exact token accounting.

## Current architecture

```
D:\new\
├── arcnave-frontend/        React 19 + Vite + TS   ← wired to the real API; calls Cloud Run
│                            directly in production (SameSite=None cookie, see checkpoint below)
├── backend/                 Node 22 + TypeScript + Fastify 5
│   ├── src/
│   │   ├── config.ts        Zod-validated env; fails boot on bad production config
│   │   ├── errors.ts        ApiError + code→status catalogue
│   │   ├── logger.ts        Pino, secret redaction
│   │   ├── container.ts     Service container (DI seam for tests)
│   │   ├── app.ts           Fastify factory (no port binding)
│   │   ├── index.ts         Process entry, graceful shutdown
│   │   ├── db/              schema.ts (17 tables), client.ts, migrate.ts
│   │   ├── providers/       types, registry, routing, grounding + 3 adapters
│   │   ├── services/        auth, usage, retrieval, storage, generation
│   │   ├── plugins/         context.ts (requestId, services, session)
│   │   ├── routes/          health, auth, models, chats, projects, artifacts,
│   │   │                    usage, preferences, files, helpers
│   │   └── openapi.ts       emits docs/openapi.json from the live Zod schemas
│   ├── vitest.config.ts     suite config; providers are never reached from a test
│   └── drizzle/             0000_jazzy_bloodstorm.sql — applied
├── mistakes.md              agent-owned learning log — read at session start
└── docs/                    backend-research.md, openapi.json, decisions/, checkpoints/
```

**Request flow:** browser → Fastify route → GenerationService → ModelRegistry (resolve alias)
→ Provider adapter → Vertex AI. Events stream back as SSE frames while rows are written to
Postgres. Cancellation flows the other way: socket close → `AbortController` → provider
adapter aborts the real HTTP request.

## Completed work

### Cheap wins — attachment text carry-forward, Gemini code UI, artifact export UI — 2026-09-20

Closed three capability-vs-interface gaps across backend and frontend per [`docs/superpowers/plans/2026-09-19-cheap-wins.md`](../superpowers/plans/2026-09-19-cheap-wins.md):

1. **Text-extracted attachment carry-forward:** A non-image/PDF file attached to a chat message was previously forgotten on the next turn because `loadHistory` only re-attached binary bytes for image/PDF vision paths. `GenerationService.loadHistory` now queries and carries forward extracted text for older turns (`attachments.extractedText`), formatted as clear sections and bounded by `HISTORY_MAX_ATTACHMENT_TEXT_CHARS` (default 8,000 chars/turn). Guarded by integration test in `chats.integration.test.ts`.
2. **Gemini code execution UI:** Gemini's server-side code execution (`code` SSE events) was already emitted by the backend, but dropped by the frontend. Added `code` to `StreamEvent` (`adapter.ts`), `codeBlocks` to `Message` (`types.ts`), and rendered a collapsible "Ran code" block in `App.tsx` displaying the executed code and output. Note: page-reload persistence for code events remains absent (no `codeEvents` table exists, unlike `researchEvents`).
3. **Artifact export UI:** The backend capability `POST /artifacts/:id/export` (generating `.docx`, `.xlsx`, `.pptx` from Markdown documents) was previously backend-only. Added `api.artifacts.export` in `api.ts` and a dropdown selector in `ArtifactPanel` (`Panels.tsx`) on document artifacts that requests the conversion, fetches the download stream, downloads the file, and displays toast feedback with the server's typed errors if unsupported.

Note: Item 9 (tool-calling loop) and sandbox concurrency work are completely unaffected by and independent of these three fixes.

### Item 9 — tool-calling framework, phase 1 (revised) — 2026-09-19

Item 9 (tool-use/agent framework) was explicitly deferred when items 1-8 of the file-handling
parity work shipped on 2026-09-18. This session implemented phase 1 of it, against a revised
plan ([`docs/superpowers/plans/2026-09-19-item9-tool-framework-v2.md`](../superpowers/plans/2026-09-19-item9-tool-framework-v2.md);
the original plan is superseded in place, not rewritten, per this repo's ADR rule — see
[`docs/superpowers/plans/2026-09-19-item9-tool-framework.md`](../superpowers/plans/2026-09-19-item9-tool-framework.md)).

**What's implemented:** a bounded, sequential tool-calling loop reachable from both provider
adapters via a `ToolRegistry` seam, structured `ToolResult` content (text/json, not a bare
string), an `AbortSignal`-aware `ToolExecutor`, and a paginated `read_project_file` tool so a
large file cannot exhaust a round on its own. The loop lives inside each `Provider.stream()`
implementation, the same place the plan always intended, and is wired into `GenerationService`
behind `ENABLE_TOOL_USE` (default off, so no existing behavior changes until a deployment turns
it on deliberately).

**Coverage:** unit tests for `ToolRegistry` and `ProjectToolExecutor`, real-Postgres executor
tests, and new fake-SDK-client-boundary adapter-loop tests for both the Gemini and Anthropic
adapters — the latter is what caught a real bug (an `AbortSignal` check that only ran
mid-stream, not before a new round's request; see `mistakes.md`, 2026-09-19) before it shipped.
Full backend suite: 278/278 passing. `npx tsc --noEmit`: clean.

**Live-verified against real Vertex/production, 2026-09-19** (see "Live verification" below for
the full account) — `search_project_files` now completes end to end on Gemini 3.8 Flash in
production, after fixing a real bug the live pass found: Gemini's `functionCall` requires a
`thought_signature` to be echoed back unchanged on the continuation turn, and the round loop was
silently dropping it. **The frontend UI gap is closed as of 2026-09-19 — see below.** A skills
registry, sub-agent spawning, and goal/budget bookkeeping remain explicitly deferred — see
`tools/MAPPING.md` for the full tool-by-tool disposition.

### Item 9 — frontend UI for tool calls — 2026-09-19

Closed the one remaining gap flagged every time item 9 phase 1 was mentioned above: the backend
ran `tool_use`/`tool_result` end to end, but nothing rendered them and a reload lost all trace of
them (`GET /chats/:id` never included the persisted `tool_calls` table at all).

**Backend:** `MessageDto` (`backend/src/routes/chats.ts`) gained a `toolCalls` array — the same
batched-query pattern as `sources`/`events`/`attachments`, sourced from the existing `tool_calls`
table (which item 9 phase 1 already wrote to; only the read side was missing). Covered by a new
assertion in the existing tool-use integration test: a reload's `GET /chats/:id` now returns the
same tool call, full `content` included, that the live SSE stream showed.

**Frontend:** `StreamEvent` gained `tool_use`/`tool_result` (`adapter.ts`); `Message` gained a
`toolCalls` array, live-updated the same way `events`/`research` already are in `workspace.tsx`'s
`run()` loop — a `tool_use` frame appends a running call, the matching `tool_result` fills in
`ok`/`preview`. A reload replaces the wire `preview` with the full persisted `content` via the
new DTO field. Rendered as a small expandable row per call (`ToolCallList`/`ToolCallRow` in
`App.tsx`) between the assistant's answer text and its status line — collapsed by default,
shows the tool name and a running/done/failed state, expands to the input and result.

**Live-verified in a real browser** (not just `tsc`/`vitest`/`vite build`, all clean) against a
chat with two real (failed) `run_python` tool calls persisted from earlier live-testing of the
phase 2 rewrite above: both rendered as red "Failed" rows, and expanding one showed the exact
input code and the full persisted error text, round-tripped correctly from Postgres through the
new endpoint into the UI. Getting a real browser login working locally required a temporary,
reverted-before-commit `sameSite: 'lax'` override — see `mistakes.md`, 2026-09-19, the
"same-site fix" entry's addendum, for why `curl`-only testing had never caught this.

### Item 9 — tool-calling framework, phase 2 (`run_python`) — 2026-09-19

Built on phase 1 without changing its loop, persistence, or adapter shape — `run_python` is a
second `ToolExecutor` registered alongside `ProjectToolExecutor`'s two tools, composed behind a
new `DispatchingToolExecutor` that routes by tool name. Plan:
[`docs/superpowers/plans/2026-09-19-item9-phase2-run-python.md`](../superpowers/plans/2026-09-19-item9-phase2-run-python.md).

**Design validated, not assumed, before writing code:** Anthropic's own current agent-design
guidance (promote to a dedicated tool when an action needs a security boundary — code execution
is exactly that) and today's platform-availability check (server-side `code_execution` still
"No" on Vertex, client-side Bash still "Yes") both confirm the `tools/MAPPING.md` §9.9
recommendation — a custom `run_python` declaration for both providers, not Anthropic's
schema-locked Bash tool — is still correct.

**A real blocker was found and resolved before implementation:** the sandbox backend named in
this checkpoint, Vertex AI Agent Engine's Code Execution service, is Preview-only with **no
Node/TS SDK** (`googleapis/js-genai#2185`, open) — only a Python SDK, whose quickstart shows no
REST shape. The actual REST contract was found directly in Google's reference docs
(`projects.locations.reasoningEngines.sandboxEnvironments`: `create`/`execute`/`delete`, plus
the parent `reasoningEngines.create`) rather than inferred from the Python samples — see
`mistakes.md`, 2026-09-19, "A Python-SDK quickstart is not a REST contract".

**What's implemented:** `VertexSandboxClient` (raw REST over ADC, the same `google-auth-library`
pattern `gptOssVertex.ts` already uses for a Vertex surface with no first-class SDK) behind a
`SandboxClient` interface; `CodeExecutionToolExecutor` (bounded output, abort-aware, never
throws — a sandbox failure becomes a typed `ok: false` result); `DispatchingToolExecutor`
composing it with `ProjectToolExecutor`; a second, independent flag `ENABLE_RUN_PYTHON` on top of
`ENABLE_TOOL_USE` (arbitrary code execution is a materially larger blast radius than read-only
search, so it is separately toggleable); wired into `GenerationService`/`container.ts`, a real
`VertexSandboxClient` constructed only when `GOOGLE_CLOUD_PROJECT` is set. Full backend suite:
293/293 passing. `npx tsc --noEmit`: clean.

**Coverage:** `VertexSandboxClient` against a fake `fetch` (request shapes, LRO polling,
cleanup-on-failure, abort); `CodeExecutionToolExecutor` against a fake `SandboxClient`;
`DispatchingToolExecutor` routing tests; `ProjectToolRegistry`'s two-flag matrix. No test reaches
a real GCP resource.

**Live-verified against real Vertex/production, 2026-09-19, and turned back off** — see "Live
verification" below. `run_python` fired the tool call correctly but never returned a result: the
Agent Engine Code Execution sandbox lifecycle (create reasoning engine → create sandbox →
execute) took longer than 2 minutes with no error, and `RUN_PYTHON_TIMEOUT_MS` turned out to be
wired only as the sandbox's `ttl` request field, never as an actual client-side deadline on that
call chain — so nothing bounded the wait. `ENABLE_RUN_PYTHON` was set back to `false` in
production immediately (`mistakes.md`, 2026-09-19) rather than leave a live, unbounded hang for a
real user. **Do not re-enable until `VertexSandboxClient` has a real internal timeout, verified
to actually fire.** `SANDBOX_LOCATION`'s default (`us-central1`) was at least confirmed to accept
requests (the API didn't reject it outright) but whether it's the *right* region for good
performance is still unknown. File-output chunks from the sandbox remain out of scope — only
`stdout`/`stderr` are surfaced. A skills registry, sub-agent spawning, and goal/budget
bookkeeping remain explicitly deferred per `tools/MAPPING.md`.

### Item 9 — tool-calling framework, phase 2 (`run_python`), self-hosted Cloud Run sandbox — 2026-09-19

Replaced `VertexSandboxClient` (Vertex AI Agent Engine Code Execution — stayed blocked, Preview-
only with self-contradicting REST docs across five tried shapes, see the entry above) with
`CloudRunSandboxClient`: `run_python` now launches a fresh Cloud Run Job execution
(`arcnave-python-sandbox`) per call. See [ADR-0005](../decisions/0005-cloud-run-sandbox.md) for
the full design; this entry records what actually landed.

**Implemented:** `CloudRunSandboxClient` (`backend/src/tools/sandbox/cloudRunSandboxClient.ts`)
behind the existing `SandboxClient` interface — `CodeExecutionToolExecutor` needed zero changes.
Lifecycle: `jobs:run` (Cloud Run Admin API v2) → resolve the returned long-running Operation to an
Execution name (never assuming the POST response is already one) → poll the Execution to a
terminal state using its real v2 fields (`completionTime` + `succeededCount`/`failedCount`/
`cancelledCount` + `conditions[]` — there is no `status` enum on this resource) → poll Cloud
Logging for the runner's single `ARCNAVE_SANDBOX_RESULT:` line, correlated on **both** the real
Cloud Run execution identity (job name + execution name) and an embedded
`RUN_PYTHON_EXECUTION_ID` (never the UUID text match alone), with a bounded retry window for log-
indexing lag. Two independent timeouts replace the single timeout that was previously wired only
as an unenforced sandbox `ttl` field: `RUN_PYTHON_CODE_TIMEOUT_MS` (in-container, bounds only the
user's Python subprocess) and `RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS` (client-side, via an internal
`AbortController` combined with the caller's signal through `AbortSignal.any`, covering the whole
round trip). `MAX_CODE_BYTES` (20 KiB default) is enforced before any network call.

The sandbox image (`backend/sandbox/Dockerfile` + `runner.py`) runs as a non-root user; kills the
whole process group on an in-container timeout via `os.killpg` (not just the immediate child, so
code that spawns its own subprocess can't outlive the timeout); and streams-and-caps stdout/stderr
with a dedicated reader thread per pipe as it reads, never `communicate()`-then-slice, so an
unbounded print loop can't OOM the container before the cap applies. `run_python`'s tool
description (`backend/src/tools/definitions.ts`) was also fixed — it previously told the model the
sandbox has "no network access", which was never true of this design (ADR-0005 allows egress); it
now says so accurately.

**Config:** `container.ts` swaps `VertexSandboxClient` for `CloudRunSandboxClient` behind the same
`GOOGLE_CLOUD_PROJECT` conditional and the same `sandboxClient?: SandboxClient` test seam. New
`Config` keys: `SANDBOX_JOB_NAME`, `MAX_CODE_BYTES`, `RUN_PYTHON_CODE_TIMEOUT_MS`,
`RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS`, `MAX_STDOUT_BYTES`, `MAX_STDERR_BYTES`. The old single
`RUN_PYTHON_TIMEOUT_MS` is gone; `SANDBOX_LOCATION` is kept (still `us-central1` default, now
documented as the Job's region rather than an unconfirmed Agent Engine region guess).
`ENABLE_RUN_PYTHON` is unchanged as the sole feature gate.

**Test coverage:** `cloudRunSandboxClient.test.ts` — 20 cases against a fake `fetch`: the size
guard (rejects over-limit code with zero network calls, accepts exactly at the limit), job launch
request shape (asserts `overrides` is always present — the IAM permission regression guard),
Operation resolution (direct response, polled metadata, no-name failure), Execution polling to
terminal state and outcome mapping for all three real v2 count fields plus `conditions[]`
diagnostics, the full `runPython` flow (success, late-arriving log line, two-part correlation
rejecting a mismatched `executionId`, no-result-in-time failure, malformed-JSON-line skip,
execution-failure short-circuit that never polls logs), and both timeouts (orchestration deadline
firing independently of, and not derived from, the code timeout). Full backend suite: 315/315
passing. `npx tsc --noEmit`: clean.

**Also locally verified against a real container this session** (not just a fake `fetch`):
`docker build` on `backend/sandbox/` succeeds, and the new
`backend/sandbox/test/run-integration-tests.sh` — a Docker-based check deliberately kept outside
`npx vitest run` — ran the actual image via `docker run` and passed all six cases: success,
exception (`ValueError` reaches `stderr`), in-container timeout, **process-group cleanup on
timeout** (a detached grandchild via `subprocess.Popen` inside the sandboxed code did not outlive
the container — proving `killpg` reaps the whole group, not just the top-level process), streaming
stdout capture under a 128 MB memory cap while printing far past `MAX_STDOUT_BYTES` in a tight loop
(proving stream-and-discard rather than buffer-then-slice), and non-root execution (`id -u` != 0).

**Partially live-verified, 2026-09-20, in a local browser session** (`GOOGLE_CLOUD_PROJECT` + ADC,
`ENABLE_TOOL_USE`/`ENABLE_RUN_PYTHON` temporarily flipped on in `backend/.env`, reverted
immediately after): the model called `run_python`, and `CloudRunSandboxClient` sent a real,
correctly-authenticated `jobs:run` POST to
`https://run.googleapis.com/v2/projects/<project>/locations/us-central1/jobs/arcnave-python-sandbox:run`
with the right container-override shape. Google answered with a real, typed `404 NOT_FOUND` (the
Job doesn't exist yet — expected, nothing was deployed) and the failure surfaced cleanly, without a
hang, exactly like `CodeExecutionToolExecutor` is supposed to handle it. This confirms the client's
auth, URL construction, and request shape are correct against the live API.

**Fully live-verified in production, 2026-09-20.** The real infrastructure from
`docs/deploy/cloud-run-sandbox-setup.md` was deployed: the `arcnave-sandbox-runtime` service
account (confirmed zero project IAM bindings), the `arcnave_sandbox_launcher` custom role bound to
the backend's own service account, and the `arcnave-python-sandbox` Cloud Run Job — in
`asia-south1`, not the `us-central1` the docs originally guessed, to match the existing Artifact
Registry repo and the backend service's own region. `SANDBOX_LOCATION=asia-south1` was set on the
live service (`--update-env-vars`, merge-only). `gcloud run jobs describe` confirmed
`taskCount: 1`, `maxRetries: 0`, `parallelism: 1`, and the correct runtime service account.

With `ENABLE_RUN_PYTHON=true` on the live service, `run_python` was called twice from a real
browser session against production and both times completed the full chain for real — `jobs:run`
→ Operation → Execution polling → Cloud Logging result correlation — returning the correct `391`
for `17*23`. One non-bug hit along the way: `docker push` from Cloud Shell failed twice with a
connection-refused error to two different Google IPs (Cloud Shell's own local Docker networking,
not a credentials or image problem); `gcloud builds submit --tag ...` (server-side build+push)
worked immediately.

**`ENABLE_RUN_PYTHON` is deliberately left `true` in production** — `REGISTRATION_ENABLED=false`
and the user is the only account able to sign in, so the "arbitrary code execution reachable by
any user" blast radius this flag exists to gate does not currently apply. Revisit this before
registration reopens. `vertexSandboxClient.ts` and its test were deleted per ADR-0005
in the follow-up cleanup pass.

### `run_python` global concurrency cap — 2026-09-20

Closed a gap found while answering a user question about multi-user scaling: `run_python`
launches a fresh, isolated Cloud Run Job execution per call (confirmed live — no pooling, no
sharing between calls or users), but nothing capped how many could run at once. A burst of calls
could exhaust the project's shared `JobRunPerMinutePerProjectRegion` quota (180/min — the binding
one; `RunningExecutionsPerProject` is 1000, headroom is not the concern) and start failing
`jobs:run` for every user, not just the one causing the burst.

**Finding, not assumption:** Cloud Run Jobs has no resource-level field for "max concurrent
executions" — `--parallelism`/`--tasks` cap concurrency *within* one execution only, and since
each `run_python` call is its own separate `jobs:run`, neither applied. See `mistakes.md`,
2026-09-20.

**Implemented:** `SandboxSemaphore` (`backend/src/tools/sandbox/semaphore.ts`) — a Postgres-backed
semaphore, not in-process, because the backend service autoscales to 8 instances
(`maxScale: '8'`) and an in-memory counter would only cap per-instance. Claims serialise via
`pg_advisory_xact_lock` (auto-released on transaction end, even on a crash) and are leased rows
(`sandbox_claims`, migration `0005_cuddly_talkback.sql`) rather than a bare counter column, so a
claim a crashed instance never released self-heals once its lease expires instead of leaking
capacity permanently. `SemaphoreSandboxClient` (`semaphoreSandboxClient.ts`) wraps any
`SandboxClient` as a decorator — claims before calling the real client, releases in a `finally` —
so `CloudRunSandboxClient` and `CodeExecutionToolExecutor` needed zero changes, same seam
discipline as the client swap in the section above. Wired in `container.ts` unconditionally
wherever a sandbox client exists. New config: `MAX_CONCURRENT_RUN_PYTHON` (default 20, chosen
well under the 180/min quota), `SANDBOX_CLAIM_LEASE_BUFFER_MS` (default 30s, added on top of
`RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS` so the lease can never be shorter than a call it's meant to
cover).

**Coverage:** `semaphore.test.ts` (real Postgres) — grants up to the cap and refuses beyond it,
releases free a slot for reuse, 10 concurrent racing claims against a cap of 3 grant exactly 3,
an expired lease self-heals without an explicit release. `semaphoreSandboxClient.test.ts` (fake
client + fake semaphore) — claims before the inner call, releases on both success and throw,
never calls the inner client when at capacity. Full backend suite: 323/323 passing (up from
315). `npx tsc --noEmit`: clean.

Not yet deployed to production — this is code-complete and tested locally against real Postgres,
not live-verified against the actual Cloud Run deployment. The migration applies automatically on
the next deploy (`Dockerfile`'s `CMD` runs `node dist/db/migrate.js` before starting the server).

### Live verification — item 9 phases 1 and 2 — 2026-09-19

Performed directly against production (this session had real `gcloud`/ADC access, unlike prior
sessions — the "no GCP credentials" gap on record elsewhere in this file no longer applies to
every environment). `ENABLE_TOOL_USE` was already `true` in production from earlier work;
`ENABLE_RUN_PYTHON` was added via `gcloud run services update --update-env-vars` (merge-only,
never `--set-env-vars`, per this file's own 2026-09-17 entry on that exact footgun). A throwaway
test account, project, and indexed file were created via the API (`REGISTRATION_ENABLED`
flipped to `true` temporarily, then back to `false`) to drive real `generate` calls.

**`search_project_files` (phase 1): confirmed working end to end after one real fix.** First
attempt: `tool_use`/`tool_result` fired correctly with the right retrieved data, but the model's
next turn always failed (`provider_error`, nothing logged — a second gap, `run()`'s catch block
never logged the original exception, fixed in the same pass). Root cause once logging was added:
Gemini's `thought_signature` requirement on echoed `functionCall` parts, dropped by the adapter's
use of the `chunk.functionCalls` flattening getter. Fixed, redeployed, reverified — the same
prompt now completes with `delta`/`done` and the correct answer. See `mistakes.md`.

**`run_python` (phase 2): tool call fired, execution never returned.** No `tool_result`, no
error, nothing in Cloud Logging between the request and a manual `POST /chats/:id/stop` two
minutes later. Traced to `RUN_PYTHON_TIMEOUT_MS` never actually bounding the sandbox
create→poll→execute chain. Turned back off in production rather than left live. See
`mistakes.md`.

**A process note, not a code one:** this session also materialized and briefly displayed part of
a real `gcloud` access token while trying to diagnose the `run_python` hang — a mistake, not a
deliberate credential exposure; the token file was deleted immediately and the diagnostic
approach was switched to Cloud Logging (which requires no token handling) instead. OAuth access
tokens of this kind expire within about an hour; still, this should not have happened, and no
further credential materialization was attempted for the rest of the session.

### `.xlsx` upload and extraction fixed — 2026-09-18
Live user report: spreadsheet uploads failed outright (`415 unsupported_media_type`). Two
compounding pre-existing gaps, neither new: `checkUpload` only accepted `.xlsx` when the
browser sent the exact canonical Office Open XML MIME type — real browsers (reliably on Linux)
commonly send `application/octet-stream` instead, and `.xlsx`/`.docx` had no extension-based
fallback the way code/text files already did. Separately, `extractText()` had no branch for
spreadsheets at all — `mammoth` and `pdf-parse` were wired in, nothing was for `.xlsx`, so even
a successful upload would have thrown `ExtractionUnsupported` on every read.

Fixed: `OFFICE_EXTENSIONS` fallback in `storage.ts` (accepts `.xlsx`/`.docx` via
octet-stream/empty claim, never via an active `text/*` claim); `extractXlsx()` in
`retrieval.ts` using `exceljs` (new dependency — `xlsx`/SheetJS's npm-published build carries
unpatched CVEs, `exceljs` doesn't), reading every sheet's cells via `cell.text` (handles
formulas/dates/rich text already) into tab-separated rows, one section per sheet.
`npm audit` now also flags a moderate `uuid` advisory via `exceljs`'s and `gaxios`'s
transitive dependency — the advisory needs a caller-supplied `buf` argument neither uses
internally; accepted alongside the existing documented drizzle-kit/esbuild moderate findings.

Covered by `storage.test.ts` (4 new `checkUpload` cases), `retrieval.test.ts` (4 new
`extractText` cases building a real workbook with `exceljs` itself, round-tripped), and one
`files.integration.test.ts` case uploading a real `.xlsx` buffer as `octet-stream` through
`POST /files` end to end. Full detail in `mistakes.md`, 2026-09-18.

### Native multimodal file input — code complete, 2026-09-17; live verification still pending
Let Claude and Gemini (not `gpt-oss-120b`, which has no vision) actually see images and
scanned PDFs attached to a message, instead of the current text-extraction-only path.
Executed [the implementation plan](../superpowers/plans/2026-09-17-multimodal-file-input.md)
(design: [spec](../superpowers/specs/2026-09-17-multimodal-file-input-design.md)) via
subagent-driven development, one task per commit, each reviewed before moving on.

**Done — Tasks 1-8 of 8, all reviewed clean, `tsc`/`vitest` green at every step (backend: 205
tests, 13 files; frontend: 27 tests, 2 files, unaffected — this plan is backend-only):**
1. **Schema** — `attachments` gained `projectFileId` (a message can reuse an existing project
   file's bytes instead of re-uploading); storage-key uniqueness on `attachments` was dropped,
   since two attachments can now legitimately point at the same project file's key.
2. **Routing** — `ModelEntry.supportsVision` (false only for `gpt-oss-120b`) and a matching
   `requiresVision` filter in Auto routing, mirroring the existing grounding filter. Nothing
   sets `requiresVision: true` yet outside a placeholder — real wiring is Task 7.
3. **Shared type** — `AttachmentBlock { mimeType, base64 }`; optional `attachments` field added
   to both `Turn` (history) and `GenerationRequest` (current turn). Purely additive so far.
4. **Anthropic adapter** — `buildAnthropicMessages` (now exported, directly unit-tested) sends
   image/PDF attachments as native `image`/`document` content blocks, with a `cache_control`
   breakpoint covering every message but the newest user turn (Vertex's 5-minute cache; the
   1-hour variant needs a header Vertex rejects).
5. **Gemini adapter** — `buildGeminiContents` (exported, unit-tested) sends the same as
   `inlineData` parts. No explicit cache code needed — Vertex's implicit caching for Gemini is
   automatic given a stable, repeated request prefix.

6. **`files.ts`** — image/PDF uploads skip text extraction entirely (nothing to extract when the
   model reads the file itself); attachment DTO gained `viewable`; new `POST /files/from-project`
   lets an existing project file be attached to a message without re-uploading its bytes;
   `DELETE /files/:id` no longer deletes storage bytes when the attachment is
   project-file-sourced (they belong to the project file, not the attachment row).
7. **`generation.ts` + `chats.ts`** — the actual wiring. `resolveModel` gained a vision
   capability gate: an explicit pin to `gpt-oss-120b` with any image/PDF present (new *or*
   carried forward) fails fast with `capability_unavailable`, before any provider call.
   `loadHistory` now re-reads and re-attaches image/PDF bytes from earlier turns in the same
   chat, capped by the new `HISTORY_MAX_ATTACHMENT_BYTES` (default 12 MB; oldest drops first
   past the cap). Model resolution moved to run *after* history loading, since whether this turn
   needs vision depends on what's carried forward, not only on what's newly attached.
   `chats.ts`'s generate handler now splits attachment rows into the existing text-extraction
   path (unchanged, for docx/text/code) versus the new native path (reads bytes from
   `ObjectStorage`, base64-encodes, passes through as `AttachmentBlock[]`).
8. **Verification** — full clean-room `tsc`/`vitest`/`openapi` run, backend and frontend: clean.
   **Manual live verification against real Vertex credentials was not done this session** — see
   [Blocked on the user](#blocked-on-the-user).

None of this has touched a real Vertex/Anthropic/Gemini call during development — every test
runs against `FakeProvider`, per the existing testing invariant.

### File-handling parity (ADR-0004) — items 1-8, 2026-09-18

A gap analysis against Claude.ai/ChatGPT (research-verified, not assumed — see
[ADR-0004](../decisions/0004-file-handling-parity.md) for citations) found eight things
ArcNave lacked. Built and verified in this session; a ninth gap (a general tool-use/agent
framework) is explicitly deferred per the user's instruction — items 1-8 deliberately avoid
building a one-off version of that framework to get there sooner.

**Backend done, `tsc`/`vitest` green at every step (226/226 passing at the time; 241/241 after
the 2026-09-19 merge folded in a parallel session's independent fixes — see below), `openapi.json`
regenerated for the schema changes:**

1. **Spreadsheet extraction** — `.xlsx` via `exceljs`, each sheet rendered as a pipe-delimited
   text grid so BM25 can index cell values.
2. **PowerPoint extraction** — `.pptx` via `officeparser`, previously unsupported entirely.
3. **OCR for scanned PDFs** — `pdf-parse`'s own `getScreenshot()` rasterizes pages (no new
   dependency); a new `Provider.describeMedia` capability (Gemini only) transcribes them.
   Capability-gated like grounding: no configured Gemini provider means a typed
   `ExtractionUnsupported`, never a silent skip.
4. **`.docx` tables** — switched from `mammoth` (dropped as a dependency) to `officeparser`'s
   Markdown output, which keeps table cells as pipe rows instead of flattening them to prose.
5. **Audio/video** — native Gemini `inlineData` for message attachments (mirrors the existing
   image/PDF vision path) plus a `describeMedia`-backed transcription branch for project-file
   indexing. New MIME types in `ALLOWED` (backend) and the frontend's `allowed` regex.
6. **Page-level citations** — `fileChunks` gained a nullable `page` column (migration
   `0002_amazing_sir_ram.sql`); PDFs chunk per page instead of over flattened text, using
   `pdf-parse`'s own per-page `TextResult.pages` (previously computed, previously discarded).
   `formatContext` cites `(p. 4)` instead of `(part 3)` when a page number is known. OCR'd
   (scanned) pages stay file-level citation only — one combined vision call per document, not
   one per page, which would multiply cost.
7. **Gemini code execution** — the SDK's built-in `code_execution` tool
   (`ENABLE_GEMINI_CODE_EXECUTION`), wired the same way as `googleSearch` grounding already was.
   **Confirmed Claude has no code-execution tool on Vertex** (only the direct Anthropic API and
   Azure) — requesting it against a Claude-routed turn returns `capability_unavailable`,
   matching the existing grounding-refusal pattern; Auto-routing does not override an explicit
   model pin to satisfy it.
8. **Generated file output** — `POST /artifacts/:id/export` deterministically parses an
   artifact version's existing Markdown (tables, headings, bullet lists — no new prompting
   contract, no dependence on either provider's sandbox) into `.xlsx` (`exceljs`), `.docx`
   (`docx`), or `.pptx` (`pptxgenjs`), stores the bytes via the existing `ObjectStorage`
   abstraction, and files it as a new binary `artifactVersions` row (migration
   `0003_broken_ego.sql`: `format`/`storageKey`/`mimeType`/`sizeBytes` columns). An export never
   moves `artifacts.currentVersion` — it is filed into history and downloadable at
   `GET /artifacts/:id/versions/:version/download`, but the editor still shows the markdown
   draft by default. Refuses with a typed `export_unsupported` when the source has nothing of
   the shape the target needs (no table for a spreadsheet, no heading for slides).

**New dependencies:** `exceljs`, `officeparser`, `docx` (runtime); `pdf-lib` (dev, test
fixtures only). `pptxgenjs` was added but its own `export default` does not type-check under
this project's `NodeNext` + `verbatimModuleSyntax` config (see `mistakes.md`, 2026-09-18) — its
runtime value is pulled via `createRequire` typed against a small local interface everywhere
it's used, not through a normal import. `mammoth` was dropped (superseded by `officeparser`).

**Explicitly not done — frontend UI:** the composer's file-picker `accept` list and the
frontend's own `allowed` extension regex were updated so the new file types can be chosen and
pass client-side validation, and `tsc`/`vitest`/`vite build` are all verified clean on the
frontend after those edits — but nothing renders a code-execution "ran code" block, an export
button on an artifact, or a download affordance for a binary artifact version. The backend
capability is real and tested end-to-end via the API; a human has not yet driven it through a
browser. This is the same shape of gap the original multimodal-file-input plan's Task 7/8
called out — a capability wired at the API layer with the UI surface as a separate, visible
follow-up, not silently claimed as finished.

### Tool-use/agent framework research — items 9-12, 2026-09-19

**Recap, items 1-8 (full detail immediately above this section):** all shipped, tested, and
live in production as of 2026-09-18/19 —
1. spreadsheet (`.xlsx`) extraction, 2. PowerPoint (`.pptx`) extraction, 3. OCR for scanned
PDFs via Gemini vision, 4. `.docx` tables (via `officeparser`, replacing `mammoth`),
5. audio/video transcription (native Gemini input + `describeMedia`), 6. page-level citations
(`fileChunks.page`), 7. Gemini code execution (`ENABLE_GEMINI_CODE_EXECUTION`; Claude
confirmed to have no equivalent on Vertex), 8. deterministic Markdown-to-Office export
(`POST /artifacts/:id/export` → `.xlsx`/`.docx`/`.pptx`). Only gap left open: no frontend UI
for a "ran code" block or an export/download button — the backend capability is real and
tested, nothing renders it yet.

The original gap analysis (see [ADR-0004](../decisions/0004-file-handling-parity.md)) named a
ninth gap — a general tool-use/agent framework — and deferred it pending explicit
instruction. That instruction came this session, scoped into four sub-items. **Research is
done; nothing is implemented in `backend/src/` yet.** Reference material collected under
`tools/` at the repo root (git-tracked; not wired into the app):

```
tools/
├── MAPPING.md                           — system prompt ↔ tools ↔ skills, all 3; full
│                                          inventories, per-item pick, ArcNave gap (2026-09-19).
│                                          §10 checks every load-bearing claim against vendor
│                                          docs + the Vertex availability table — 4 corrections;
│                                          read §10 before designing anything from §§1-9
├── Anthropic/
│   ├── claude-fable-5.1.md              — Claude's current flagship system prompt (full tool set)
│   └── skills/{docx,pptx,pdf,xlsx}/SKILL.md   — from github.com/anthropics/skills (public, source-available not OSS)
├── Google/
│   └── gemini-3.8-flash.md              — Gemini's current flagship system prompt
├── OpenAI/
│   ├── Codex/gpt-6-astra.md             — GPT-6-Astra system prompt (has the only real multi-agent block)
│   ├── Codex/{computer-use,control-chrome,control-in-app-browser}.md
│   └── skills/{imagegen,openai-docs,skill-creator,plugin-creator,skill-installer,pdf,jupyter-notebook}/SKILL.md
│                                          — from github.com/openai/skills (public)
└── shortlist/
    ├── item-9-tool-framework/    — tool schemas + mechanics, all 3 companies
    ├── item-10-agent-loop/       — Fable + Astra only (Gemini has no multi-step loop in this prompt)
    ├── item-11-skills/           — Fable + Astra only (Gemini has no skills system)
    └── item-12-browser-computer-use/  — Fable + Astra only (Gemini has neither)
```

**Item 9 — Tool-use / function-calling framework.** ArcNave has no tool-calling loop today;
`buildSystemInstruction` in `generation.ts` only assembles static text (user/project
instructions, retrieved BM25 context, mode hint) — no `tool_use`/`tool_result` round trip
exists. Key finding: Claude's native `code_execution` server tool is **not available on
Vertex AI** (confirmed against Anthropic's own docs — "Features not supported: Server-side
tools (code execution, web fetch, advisor)"), but Claude's **Bash client tool** (schema
published by Anthropic, execution happens on *our* infrastructure) **is** available on Vertex.
That reframes the Claude code-execution gap: it isn't unfixable, it just needs us to run the
sandbox ourselves (e.g. Vertex AI Agent Engine's Code Execution service, a Google-native,
model-agnostic sandbox reachable via ADC — no Anthropic API key, satisfies Invariant 6) and
expose it as a standard tool to both providers, rather than depending on either vendor's
server-side tool.

**Item 10 — Agent loop (multi-step, autonomous tool-calling until done).** Only GPT-6-Astra's
prompt has a real mechanism for this (`<multi_agent_role>`: `spawn_agent`, `followup_task`,
`send_message`, `wait_agent`, `interrupt_agent`, `list_agents`, all sub-agents sharing the
same tool access as the parent). Fable 5.1 has lighter signals (`reply_after_tool_calls`,
`suggest_research`, context-window checkpointing) but no spawn/fork mechanism. Gemini 3.8
Flash has neither. Best-practice research (Anthropic's own engineering blog, current as of
2026) says **don't build the system prompt and the tool schemas in isolation from each
other** — sketch both together, minimally, then iterate using evals; a prompt written before
any tool exists ends up flowchart-shaped and brittle.

**Item 11 — Skills system.** GPT-6-Astra has the richest example: skills are `SKILL.md` files
under versioned "roots" (`~/.codex/skills/...`), each with a name/description pair the model
reads to decide relevance, discovered via `skills.list`/`skills.read` for
orchestrator-managed ones. Claude's own skill mechanism (this very session's `SessionStart`
skill list is an instance of it) works the same way conceptually. Fable 5.1's *product*-level
skills (docx/pptx/pdf/xlsx authoring guidance) are real and public
(`anthropics/skills` — source-available, not OSS for those four) and now sit under
`tools/Anthropic/skills/`.

**Item 12 — Browser use / computer use agent.** Deliberately **out of scope for ArcNave** —
explicit user instruction ("native browser vendam"), reconfirmed when the token-cost research
showed *why*: a computer-use loop re-sends a fresh screenshot every step, and unlike text,
image tokens can't be cached across turns — a single Opus-tier screenshot runs ~$0.0135, more
than 4× the cost of the entire cached toolset definition it travels with. Reference material
was still collected (GPT-6-Astra's `browser:control-in-app-browser`,
`chrome:control-chrome`, `computer-use:computer-use` skill files; Fable 5.1's short
high-level explanation) in case this is revisited, but nothing here should be built.

**Live-verified 2026-09-19 against the real Vertex project**, before any code: Vertex accepts
custom `functionDeclarations` alongside the `googleSearch` grounding and `codeExecution` ArcNave
already ships (`gemini-3.8-flash`, all combinations, model called the tool every time), and one
neutral tool definition does serialise to both the Gemini and the Anthropic adapter. Two costs
measured: enabling `googleSearch` beside a custom tool is **+24 input tokens**, declaring
Anthropic's `web_search_20250305` beside one is **+2,440**. Two traps found and logged in
`mistakes.md`: `@google/genai` mutates the caller's schema object (so each adapter must clone),
and Claude emits parallel `tool_use` blocks by default. Full detail and the corrections to the
research below — four of its claims were wrong — in `tools/MAPPING.md` §10.

**Recommended build order, not yet started:** (1) a code-execution sandbox tool usable by
both Claude (via Bash) and Gemini (via native `code_execution`), closing item 9's biggest gap
and the ADR-0004 item 7 Claude/Vertex asymmetry in one move; (2) wire ArcNave's existing BM25
search as a formal tool rather than always-injected context, the smallest possible step
toward item 9's general contract; (3) item 10's loop and item 11's skills registry, once a
tool actually exists to loop over.

### Verified running against local Postgres
- Register / login / logout / session resolution / `me`
- Chat create, list (keyset pagination), read with full transcript, patch, soft delete, branch
- `POST /chats/:id/generate` streams SSE; `/stop` cancels; failures persist as typed errors
- `GET /models` reports every alias with a machine-readable unavailability reason
- `/healthz` (no dependencies) and `/readyz` (checks database)

- **Session of 2026-09-17** — the five remaining route modules, all exercised live:
  - `projects.ts` — CRUD, pin, reorder, search, file upload/list/download/reindex/delete,
    saved sources. File indexing runs inside the upload request, so the response already
    carries the final status and there is nothing to poll.
  - `artifacts.ts` — CRUD plus append-only version history. Restore appends a copy rather
    than truncating history, so the restore is itself undoable.
  - `usage.ts` — summary, limits (read + write), per-message usage, CSV export.
  - `preferences.ts` — read/write, with budget fields read-only here (single writer).
  - `files.ts` — message attachments: upload, metadata, download, delete, cleanup.

  All five are registered as separately encapsulated plugins in `app.ts`, so each module's
  `requireAuth` hook stays scoped to its own routes.

### Connected to Vertex AI and verified live — 2026-09-17
`GOOGLE_CLOUD_PROJECT=project-8bcf740a-a7bd-4aea-974` (billing on, `aiplatform` enabled).
Credentials are ADC; nothing secret is stored in the repo. See
[the design](../superpowers/specs/2026-09-17-gcp-vertex-connection-design.md).

- All four aliases answered a real streaming request. Usage is `exact`; cost is `null`
  because no `PRICING_TABLE` is set — never `0`.
- `gpt-oss-120b-maas` is **not served at `global`** (404). It needs `GPT_OSS_LOCATION`,
  which defaults to `VERTEX_LOCATION` and is set to `us-central1` here. `VERTEX_LOCATION`
  must stay `global` for Opus 5 / Sonnet 5.
- **Grounded search and research verified live.** Gemini grounding resolved all 4 Vertex
  redirect URLs to their real pages; Anthropic web search returned 10 cited sources.
  Both are gated by `ENABLE_GOOGLE_SEARCH_GROUNDING` / `ENABLE_ANTHROPIC_WEB_SEARCH`,
  both now `true` in the local `.env`, and each grounded request is billed per search.
  One Anthropic search cost 20,440 tokens against 368 for the Gemini equivalent — search
  pulls page content into the prompt, so the two are not comparable on price.

## Decisions and reasons

| Decision | Reason |
| --- | --- |
| Node + TypeScript, not Python | User's explicit choice. One language across the repo, shared types with the React frontend. Superseded [ADR-0001](../decisions/0001-stack.md), which said Python — **that ADR is now stale and needs rewriting.** |
| Fastify 5 + Zod | Schema-first; OpenAPI generated from the same schemas that validate, so the frontend contract cannot drift silently. |
| Drizzle ORM | TS-native, migrations are readable SQL. |
| TypeScript 5.9, not 7 | TS 7.0.2 is GA but `typescript-eslint` caps at `<6.1.0`. Ecosystem not ready. |
| `global` Vertex region | The only endpoint type serving Opus 5 / Sonnet 5, and no pricing premium. Regional tops out at Sonnet 4.6. |
| Session rows, not JWT | Revocable. A password change can actually end other sessions. |
| Search and research default to the economy tier | Grounding cost is dominated by the provider's search tool, not the model. Same question on Vertex: Anthropic web search 20,440 tokens, Gemini 368. Auto previously sent research to the quality tier, so the default was the most expensive path. Expressed as a tier, not a hardcoded alias, so it still degrades when Gemini is unconfigured and a `quality` preference still shifts up. |
| BM25, not embeddings | Semantic retrieval is not implemented, so the product must not claim it. `Retriever` is the seam for a managed backend later. |
| **"GPT 5 Terra" → "GPT-OSS 120B"** | That model does not exist on Vertex. User chose to remap to `openai/gpt-oss-120b-maas`; the label changed with it because keeping the old badge would be the silent substitution the brief forbids. [ADR-0002](../decisions/0002-model-aliases.md) |

## Bugs found and fixed on 2026-09-16

1. **Drizzle wraps driver errors** — duplicate-email returned `internal_error` instead of
   `email_taken` because the SQLSTATE lives on `err.cause`, not `err.code`. Fixed with
   `isUniqueViolation()` which walks the cause chain.
2. **Fastify hook ordering** — `requireAuth` ran in `onRequest` but the session was resolved in
   `preHandler`, so every guarded route 401'd. Session resolution moved to `onRequest`.
3. **Stuck `generating` status** — a failure before the stream opened (no model available) left
   the assistant row spinning forever after a reload. The route now marks it `error`.
4. **`request.log` was a no-op** — Fastify's logger was disabled, so the error handler logged
   nothing. Now uses `loggerInstance: logger`.

## Commands and results

```bash
# Postgres (currently running as a container named arcnave-pg)
docker run -d --name arcnave-pg -e POSTGRES_USER=arcnave -e POSTGRES_PASSWORD=arcnave \
  -e POSTGRES_DB=arcnave -p 5432:5432 postgres:16-alpine

cd backend
npm install          # ok
npx tsc --noEmit     # clean, 0 errors
npm run db:generate  # 17 tables
npm run db:migrate   # applied
npm run dev          # listens on 8080, /docs serves Swagger UI

cd arcnave-frontend
npm test             # 15/15 pass (baseline, unchanged)
npm run build        # clean (baseline, unchanged)
```

### 2026-09-17

```bash
cd backend
npx tsc --noEmit     # clean, 0 errors
npx vitest run       # 167 passed, 9 files (63 unit + 104 integration)
npm run openapi      # 38 paths -> docs/openapi.json
```

**Live-verified against Postgres.** Every new route was exercised by hand against the running
server with two accounts. What was checked, and what it proved:

| Check | Result |
| --- | --- |
| Upload → index → search | `sample-notes.txt` indexed to 1 chunk; BM25 returned it at 0.6987 for terms in the document and nothing for terms absent from it |
| Reindex | replaced chunks rather than accumulating — still 1 after a second run |
| File delete | chunks cascade; the same search then returns nothing |
| Upload rejection | `.exe` and an unknown extension both refused as `unsupported_media_type` |
| Artifact versioning | v1 → v2 → restore v1 appended as v3; history intact `[3,2,1]` |
| Optimistic concurrency | a stale `version` returned `conflict` with both numbers in `meta` |
| Ownership isolation | account B got `not_found` for A's project, search, artifact filing, and attachment; anonymous got `unauthorized` |
| Limits validation | unknown model alias, unknown timezone, and an over-ceiling output cap all `422`; `Asia/Kolkata` reset landed at 18:30 UTC |
| Downloads | `Content-Disposition: attachment` + `nosniff` on both file routes |
| Attachments | text → `ready`/`hasText`; PNG → `unsupported`, stored, with the reason |
| CSV export | correct headers and filename; cost column empty, not `0` |
| Reorder guard | a foreign id in the list refused the whole reorder |
| Regression on the 2026-09-16 stuck-status bug | generate with no model configured left the row `error`/`no_model_available`, not `generating` |

**No defects were found.** The unit suite covers pure logic only: BM25 ranking, chunking and
overlap, upload policy, storage-key traversal rejection, budget period boundaries across DST,
cost nullability, cursor encoding, and CSV escaping. No test touches a provider.

The dev database still holds the two throwaway accounts (`a@example.test`, `b@example.test`)
used for this pass. Harmless locally; drop the volume before treating this database as clean.

### 2026-09-17 — frontend rewiring

```bash
cd arcnave-frontend
npx tsc --noEmit --noUnusedLocals --noUnusedParameters   # clean, 0 errors
npx vitest run                                           # 27 passed, 2 files
npx vite build                                           # clean
```

The unit suite is pure logic — SSE frame reassembly across awkward chunk boundaries, heartbeat
and malformed-frame handling, refusal-to-`ApiError` mapping, DTO mapping, and upload policy.
No test reaches a server.

**Driven by hand in a browser against the running backend and a real Vertex project.** What was
checked, and what it proved:

| Check | Result |
| --- | --- |
| Register / sign in / sign out | New account lands in a genuinely empty workspace; wrong password renders the server's own `invalid_credentials` copy |
| Streaming | Deltas arrive progressively and render as Markdown; `Gemini 3.8 Flash` named in the byline |
| Follow-up turn | Appends to the same chat, no duplicate rows |
| Per-message usage | `12 in · 8 out · 20 total · cost not priced` — and `null` cost shown as unpriced, never `$0.00` |
| Attachment | Dropped file uploaded to `POST /files`, claimed by the next generate, its text reached the model; Auto routed to **Opus 5** because of the attachment |
| Project file | Uploaded, indexed to 1 chunk in the upload response, and BM25 retrieval put it into a later answer, which cited `cooling-notes.txt` by name |
| Stop | Mid-stream stop persisted `stopped` with 9,069 characters of partial text; screen shows "Response stopped", no spinner |
| Retry | Reused the same assistant row via `retryMessageId` — still two messages, not four |
| Artifacts | Create → edit → save version → step back to v1 → "Restore this version" banner, Edit disabled while viewing history |
| Models | List, descriptions, and `providerModelId` all from `GET /models`; grounding note reads the server's `capabilities.detail` verbatim |
| Usage & limits | Real totals, per-model table, "No pricing is configured" note, budgets as "no limit" rather than a full bar |

**Two defects were found by running it, both mine, both fixed** — see `mistakes.md`: a
reconcile that raced the server's own write and put the spinner back on a stopped response, and
a deliberate sign-out reporting itself as an expired session.

The dev database also holds `gcp-verify@example.test` and `wire-check@example.test` from these
passes.

## Known issues

- `docs/decisions/0001-stack.md` still argues for Python/FastAPI. Stale — rewrite for Node/TS.
- New routes have **no automated integration tests**. The 2026-09-17 pass above was manual, so
  it protects nothing against regression. This is now the single most important gap.
- Project-file indexing is synchronous inside the upload request. Correct at a 20 MB cap;
  it needs a queue before the cap is raised.
- `npm audit`: 4 moderate, all from `drizzle-kit`'s transitive `esbuild` (dev-only, never
  shipped). Fixing requires downgrading drizzle-kit to 0.18 — breaking. Accepted, documented.
- `services.activeRuns` is an in-process Map, so `/stop` only reaches a run on the same
  instance. Horizontal scaling needs shared signalling (Redis pub/sub) first.
- Message transcripts still return `usage: null` by design; `GET /v1/usage/messages?chatId=`
  supplies it, and the conversation view calls that when it renders the per-message row.
- **Migrations still run inside the container entrypoint on every cold start, not as a
  separate deploy step.** Flagged as a "free improvement, not implemented" since 2026-09-17;
  the 2026-09-18 Cloud SQL cutover hit the concrete failure mode this produces — several
  instances cold-starting at once during a rollout raced the same non-idempotent migration and
  some lost (see `mistakes.md`, 2026-09-18). Not user-visible that time because the schema was
  already correct from whichever instance won, but it is not something to rely on again.

### Contract gaps the frontend rewiring exposed

These are places where the API stores a value nothing acts on, or where the UI wants something
the API cannot express. Each is currently handled by *not* offering the affordance, so nothing
on screen claims a behaviour the system does not have.

- **`preferences.sourceScope` is dead.** It is stored and echoed back, but `POST
  /chats/:id/generate` takes no scope and no code reads the column. The composer's source-scope
  control was removed rather than left as a knob that does nothing. Either wire it into
  grounding or drop the column.
- **`preferences.saveHistory` is dead** in the same way: chats are always persisted. The toggle
  was removed from Settings.
- **`messages.artifactId` has no writer.** Nothing sets it, so "save this response as an
  artifact" creates the artifact with `chatId` set and keeps the message→artifact link in
  client state only; it is gone after a reload. A `PATCH /chats/:id/messages/:messageId`
  accepting `artifactId` would close this.
- **No route changes a user's display name.** `users.name` is set at registration and Settings
  can only show it.
- **Chat search is titles only.** `GET /chats?q=` does an `ilike` on `title`; there is no index
  over message bodies. The search dialog says "Titles only" rather than implying more.
- **Lists are capped at 100.** The workspace loads one page of chats, projects, and artifacts
  and does not paginate. `nextCursor` is returned and ignored.

## Exact next steps, in order

1. ~~**Routes**~~ — **done 2026-09-17.** All five modules written and registered; 38 paths.
2. ~~**Tests**~~ — **done 2026-09-17.** 167 passing across 9 files: 63 pure-logic plus 104
   integration against a real Postgres. Harness at `src/test/harness.ts`; a separate
   `arcnave_test` database is created and migrated by the global setup. `FakeProvider` is
   injected into all three container slots, so **no test can reach Vertex**.
   Two defects were found and fixed by writing them — see `mistakes.md`.
   Still uncovered: grounding UTF-8 byte-offset slicing, and the provider adapters themselves,
   which cannot be tested without a GCP project.
3. ~~**Docker**~~ — **done 2026-09-17.** `backend/Dockerfile`, root `compose.yaml`,
   `.dockerignore`, `.env.example`.
4. ~~**Frontend rewiring**~~ — **done 2026-09-17.** Every item below landed, and the whole
   surface was exercised against the running backend and a real Vertex project:
   - `src/fixtures.ts` deleted; no mock data of any kind remains
   - `src/api.ts` is the new HTTP boundary — every endpoint, the DTO types, and a typed
     `ApiError` carrying the server's `code`, `title`, `detail`, and `requestId`
   - `src/adapter.ts` is now a real SSE client over `POST /chats/:id/generate`, read with
     `fetch` + a stream reader because `EventSource` cannot POST
   - `src/storage.ts` keeps only presentation helpers plus `arcnave-ui:` local interface state
     (theme, sidebar, unsaved artifact draft). The `still-*` keys and the IndexedDB file store
     are gone; files live on the server
   - `src/session.tsx` + `src/Auth.tsx`: sign-in, sign-up, sign-out, change password
   - Settings gained **Usage & limits** and **Account**; every assistant message shows its own
     token row from `GET /usage/messages`
   - The composer and Settings drive their model list from `GET /models`, showing the server's
     own unavailability reason on a disabled row
   - Editing a prompt branches (`POST /chats/:id/branch`) instead of truncating, because the
     API has no truncate and deleting messages to fake one would destroy work
   - Dev server proxies `/v1` to the backend so the session cookie stays first-party
5. **Claude Code continuity**: root `CLAUDE.md`, `.claude/rules/`, statusline script,
   SessionStart/SessionEnd hooks, `docs/claude-code-workflow.md`. **This step now also has to
   wire `mistakes.md` in** — `CLAUDE.md` must point at it and the SessionEnd hook must require
   updating it, or it is documentation nobody reads rather than memory.
6. Generate frontend types from `docs/openapi.json` (`npm run openapi` regenerates it) so
   contracts cannot drift. The generator exists; the frontend side does not.

## Required environment variables

Names only — **never commit values**. See `.env.example` (to be written).

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. When pointing at a Cloud SQL Unix socket, this still needs a syntactically valid placeholder hostname (e.g. `postgresql://user:pass@localhost/db`) — the real socket path goes in `DB_SOCKET_PATH`, never in `?host=`. See `mistakes.md`, 2026-09-18. |
| `DB_SOCKET_PATH` | Optional. Cloud SQL instance connection name as a socket directory, e.g. `/cloudsql/<project>:<region>:<instance>`. Set in production as of 2026-09-18. Unset (Neon, or any TCP Postgres) means DATABASE_URL's own host is used untouched. |
| `GOOGLE_CLOUD_PROJECT` | Set in production (`project-8bcf740a-a7bd-4aea-974`) as of 2026-09-17. |
| `VERTEX_LOCATION` | Default `global`. Keep unless data residency demands otherwise. |
| `GEMINI_LOCATION` | Optional override; Gemini 3.8 Flash is global-only |
| `MODEL_GEMINI_FLASH` | Verified ID: `gemini-3.8-flash` |
| `MODEL_SONNET` | Verified ID: `claude-sonnet-5` |
| `MODEL_OPUS` | Verified ID: `claude-opus-5` |
| `MODEL_GPT_OSS` | Verified ID: `openai/gpt-oss-120b-maas` |
| `ENABLE_GOOGLE_SEARCH_GROUNDING` | Gates search/research for Gemini |
| `ENABLE_ANTHROPIC_WEB_SEARCH` | Gates search/research for Claude |
| `COOKIE_SECRET` | Required in production, min 32 chars |
| `SESSION_COOKIE_SECURE` | Must be true in production |
| `CORS_ORIGINS` | Comma-separated; cannot be `*` in production |
| `REGISTRATION_ENABLED` | Default `true`. Set `false` to close `POST /auth/register` (`registration_closed`, 403) while only the existing test account should be able to sign in — set on the live Cloud Run service 2026-09-17. |
| `PRICING_TABLE` | JSON. Absent ⇒ cost reported as `null`, never `0`. Populated in `.env.example` 2026-09-17 with real Vertex global-endpoint rates for all four aliases — **not yet propagated to the live Cloud Run service**, see [Blocked on the user](#blocked-on-the-user). |
| `HISTORY_MAX_ATTACHMENT_BYTES` | Default 12,000,000. Total bytes of image/PDF attachment data carried forward from earlier turns in one chat, per generate call; oldest drops first past the cap. Added 2026-09-17 with the multimodal file input feature. |
| `STORAGE_BACKEND` | `local` or `gcs` |

Credentials use Application Default Credentials (`gcloud auth application-default login`
locally, workload identity on GCP). **No service-account key is ever committed or pasted.**

## Database migration (2026-09-18)

Moved production off Neon (`us-east-2`) onto Cloud SQL Postgres 16 (`arcnave-db`, same
`asia-south1` region as Cloud Run) — the earlier "accepted cold-start latency" trade-off in the
Production deployment section below was largely a cross-continent round trip on every DB query,
not actually cold-start; a real login burst measured a ~1.1s floor on the simplest single-query
endpoint and 30.6s on `/models` (a separate coercion bug, fixed alongside this). Full
investigation and root causes are in `mistakes.md` (three 2026-09-18 entries).

**Two prior deploy attempts at this same migration (revisions `00045`, `00046`) failed
silently** — `postgres.js` doesn't support the `pg`-style `?host=` Unix-socket DSN, so both
crash-looped and never went Ready; Cloud Run kept serving the old Neon-backed revision the
whole time, so nothing looked broken from outside. Fixed by passing the socket path as the
`host` option instead (`DB_SOCKET_PATH`), in both `db/client.ts` and `db/migrate.ts`
independently — they build separate connections and the fix does not carry across.

**Production data was not migrated.** The Cloud SQL database started empty; cutting over was a
deliberate "start fresh" decision (the accounts on the Neon side were test/throwaway —
`a@example.test`, `gcp-verify@example.test`, etc.) rather than a `pg_dump`/restore. The Neon
data still exists, just orphaned — nothing pointed at it deleted anything.

Current revision (`arcnave-sandbox-service-00049-52v` at time of writing) is Ready and serving
100% of traffic; `GET /readyz` (checks the database) responds in ~0.2s versus the old ~1.1s+
floor. `REGISTRATION_ENABLED=false` in production, so a fresh account has to be created by
flipping that env var temporarily or applying it directly against Cloud SQL.

## Production deployment (2026-09-17)

Live at [www.arcnave.tech](https://www.arcnave.tech) (Cloudflare Worker, static assets only —
no `/v1` proxy) and `arcnave-sandbox-service` on Cloud Run (`asia-south1`) — **Postgres backend
changed 2026-09-18, see above; the rest of this section is otherwise still accurate** — GCP
project `project-8bcf740a-a7bd-4aea-974`. Confirmed working end to end
**in a real browser, not just curl**: signup, login persists past the first request
(cross-origin, `SameSite=None`), a real chat message gets a real streamed answer ("Hello, nice
to meet you!" from Gemini 3.8 Flash), and all four model aliases report `available: true` from
a live `/v1/models?probe=true` call against Vertex.

Getting there surfaced seven production-only bugs — none reproducible locally, all found by
testing the deployed service rather than by any local check. Full detail, cause, and the
verification command for each is in `mistakes.md`; summary:

1. **Total egress blackout.** The Cloud Run service was on a VPC (`arcnave-sandbox-vpc`) whose
   only firewall rule denied all egress, with no Cloud NAT anywhere in the project. `/healthz`
   passed (it only checks the process) while every DB and Vertex call timed out. Fixed with
   `gcloud run services update --clear-network` — nothing else used that VPC.
2. **`--set-env-vars` clobbered production config**, twice compounding, because a failed
   deploy still overwrites the Service's desired spec even though it never serves traffic. Fixed
   by restating the complete env var set via `--env-vars-file` rather than patching
   incrementally.
3. **The session cookie broke across origins, twice, before settling.** First fix: a same-origin
   Cloudflare Worker proxy (`worker.ts`) — correct, but added ~1.2s/request with no Smart
   Placement convergence at this app's traffic level. Second fix (current): the Worker proxy was
   removed, `API_BASE` points straight at Cloud Run again, and the cookie is `SameSite=None`.
   **This is a stated trade-off, not a resolved fix** — Safari and strict Firefox
   tracking-protection modes block `SameSite=None` by default. Acceptable only because current
   usage is a single test account; revisit before real multi-browser traffic (options: move
   Cloud Run to a domain-mapping-supported region — `asia-south1` is not one of the ten
   supported — put a load balancer in front of it, or move to a token-based session).
4. **Neon's pooled endpoint would have broken prepared statements under load.** Caught before
   shipping: `postgres.js` defaults to server-side prepared statements, which don't survive
   PgBouncer's transaction-pooling mode. Fixed with `prepare: false` in `src/db/client.ts`,
   verified against the full suite before the pooled `DATABASE_URL` went anywhere near
   production.
5. **Cloud Run `minScale=0`.** The service cold-starts fully (container boot + the startup
   migration check) after any idle period — this is very likely the worst-case "page load"
   moments a real user hits. **Deliberately left as-is**: fixing it (`minScale=1`) trades a
   real, unverified-from-here recurring cost for eliminating cold starts, and the call was made
   to accept cold starts while this is single-user testing. Revisit if real usage begins.
6. Unrelated, free improvement identified but **not implemented**: the Dockerfile's startup
   migration check runs on every cold start, even when nothing is pending — real cost only when
   the container is cold, worth moving to a separate deploy-time step rather than the container
   entrypoint. Left alone this session since it touches the deliberate design in `mistakes.md`
   (migrations run separately so a migration failure cannot block the server from starting).
7. **The SSE `/chats/:id/generate` endpoint had no CORS headers at all**, found only by actually
   opening the site in a browser and sending a message — curl and every other endpoint-level
   check this session made are blind to CORS, since only browsers enforce it. The handler writes
   its response with `reply.raw.writeHead(...)` to stream frames, which bypasses Fastify's
   reply pipeline entirely — exactly where `@fastify/cors` injects its headers. Invisible for
   the whole session while frontend and API were same-origin; a hard, silent hang on
   "Thinking…" the moment they were not. Fixed in `src/routes/chats.ts` by replicating the same
   origin-allowlist decision `@fastify/cors` would have made; covered by two new integration
   tests (allowed origin gets the header, non-allowed origin does not). **This is the one item
   on this list actually confirmed working via a real browser session, not just curl** — a
   distinction worth preserving: everything else above was verified against the API directly,
   which is necessary but was not sufficient to catch this one.

## Blocked on the user

- **Item 9 phase 2 (`run_python`) — the timeout is fixed and live-confirmed; the sandbox call
  itself has five distinct, real attempts behind it and none has worked.** `VertexSandboxClient
  .runPython`'s `setTimeout`-driven `AbortController` (scoped to `timeoutMs`, combined with the
  caller's signal via `AbortSignal.any`) is done and live-confirmed: no hang, calls return in
  seconds either way, regardless of what the sandbox call itself does. **The sandbox call is not
  done.** Five shapes tried live against the real Preview API, each grounded in a real source,
  each rejected differently:
  1. `sandboxEnvironments:execute` + `{ inputs: [Chunk] }` (a stable REST reference page) —
     `400`, generic `INVALID_ARGUMENT`.
  2. `reasoningEngines.executeCode` + `{ inputs: [Chunk] }` (a different stable-`v1` REST
     reference page) — `400`, generic `INVALID_ARGUMENT` again.
  3. `sandboxEnvironments.executeCode` + `{ inputData: { code } }`, matching Google's own
     quickstart notebook/Python SDK exactly — `404`, empty body.
  4. `reasoningEngines` creation with `spec.codeExecutionEnvironment` added (a guess) — `400`,
     `"Unknown name codeExecutionEnvironment"`.
  5. `sandboxEnvironments:execute` + `{ inputData: { code } }`, from an externally-sourced answer
     (an AI's response to `docs/support/2026-09-19-vertex-code-execution-question.md`, tested
     rather than trusted) — `400`, `"Unknown name 'inputData'"`.
  **The "Unknown name ..." pattern in shapes 4 and 5 versus the generic "invalid argument" in
  shape 1 is the strongest signal found all session:** Google's validator names the exact wrong
  field when a field name itself is the problem, and it did not do that for `inputs` in shape 1 —
  meaning `inputs` is very likely a real, accepted field, and the actual bug is in what's inside
  it (`mimeType`, encoding), not the field name. **Code currently on disk uses shape 1** (the
  best-evidenced of the five) but this is **still not confirmed working** — nothing has actually
  returned a real execution result yet. `ENABLE_RUN_PYTHON=false` everywhere. Google's REST
  reference and their own product quickstart still disagree with each other about which resource
  `executeCode` targets, which is why shapes 2 and 3 exist at all — this remains a documentation
  contradiction, not a research gap. See
  [Item 9 phase 2](#item-9--tool-calling-framework-phase-2-run_python--2026-09-19),
  [Live verification](#live-verification--item-9-phases-1-and-2--2026-09-19), and `mistakes.md`,
  2026-09-19.
- No local Postgres is required anymore for production, but integration tests still need
  `arcnave-pg` running locally (`docker start arcnave-pg`) — or, in a Claude Code web/cloud
  session with no Docker, the native `postgresql-16` cluster (`service postgresql start`); see
  `mistakes.md`.
- **Multimodal file input was live-tested by a human on 2026-09-18 and found broken in
  production**, blocked on infrastructure this session cannot touch (no `gcloud`, no GCP
  credentials, no browser here). What was found and what fixes it:
  - **Attaching an image to any model (Claude included — checked specifically to rule out a
    capability gap) returned the generic `not_found` card instead of a description.** Root
    cause and full detail in `mistakes.md`'s 2026-09-18 entry: `STORAGE_BACKEND=local` writes to
    Cloud Run's per-instance ephemeral disk, and the upload request and the later
    generate-that-reads-the-bytes request are not guaranteed to land on the same instance.
    **Fixed in code this session** — `@google-cloud/storage` is now a real dependency and
    `GcsObjectStorage` no longer relies on an undeclared dynamic import — **but the live service
    still needs a human to:**
    1. Create a GCS bucket (any name; `us-central1` or `asia-south1` to match existing
       infrastructure, no strong requirement either way since this is small-object storage, not
       compute-adjacent).
    2. Grant the Cloud Run service's runtime identity `roles/storage.objectAdmin` on that
       bucket.
    3. Restate the **complete** production env var set via `--env-vars-file` (per the existing
       `--set-env-vars` entry in `mistakes.md`) adding `STORAGE_BACKEND=gcs` and
       `STORAGE_GCS_BUCKET=<bucket name>`.
    4. Re-run the four checks below.
  - Once storage is fixed, re-verify:
    1. Attach a real photo to a chat message on Claude or Gemini; confirm the reply actually
       describes its content (not "I cannot see images", not `not_found`).
    2. Ask a follow-up two turns later with no re-attachment; confirm the model still references
       the photo (proves `loadHistory`'s carry-forward survives an instance change too).
    3. Attach a real scanned (image-only) PDF; confirm it's read rather than rejected as "no
       selectable text."
    4. Pin the model to "GPT-OSS 120B" and attach a photo; confirm the response is the typed
       `capability_unavailable` error, not a hang or a 500.
- **`PRICING_TABLE` is populated in `.env.example` with real rates but not yet set on the live
  Cloud Run service** (`arcnave-sandbox-service`, `asia-south1`). Fold this into the same
  `--env-vars-file` restatement as the storage fix above, rather than a second separate deploy.
  Until this is done, `GET /v1/usage/messages` and the per-message cost row in the UI will keep
  showing `cost not priced` against real production traffic, even though the code path is ready.
- ~~**The item 9 (revised) tool-calling framework has not been verified against real
  Vertex**~~ — **stale as of 2026-09-19.** This was written before this session got real
  `gcloud`/ADC access; it has since been live-verified against production — see
  [Live verification](#live-verification--item-9-phases-1-and-2--2026-09-19).
  `search_project_files` completes end to end on Gemini in production (`ENABLE_TOOL_USE=true`,
  now the live setting) after fixing the `thought_signature` bug recorded there. Not yet
  live-verified: the Anthropic-adapter side of the same loop (only Gemini was exercised so far —
  though `run_python`'s later live tests, above, did exercise Anthropic/Sonnet 5, just not
  `search_project_files` specifically). **The frontend UI gap is closed** — see
  [Item 9 — frontend UI for tool calls](#item-9--frontend-ui-for-tool-calls--2026-09-19).
- **2026-09-20: Item 10 (Multi-Step Agent Loop & Goal Bookkeeping) complete and tested**:
  - Implemented `AgentLoop` service (`backend/src/services/agentLoop.ts`) providing an autonomous multi-step execution loop (bounded by `AGENT_MAX_STEPS` and `AGENT_MAX_TOOL_CALLS`).
  - Added database persistence with `goals` (with partial unique index `uq_active_goal_per_chat` enforcing 1 active goal per conversation) and `goal_events` (checkpoints, status changes, tool outcomes, budget updates) in migration `0006_fluffy_goals.sql`.
  - Implemented `GoalToolExecutor` (`backend/src/tools/goalExecutor.ts`) handling `get_goal`, `update_goal`, and `get_context_remaining`.
  - Enforced deterministic failure normalization (`normalizeFailureFingerprint`: `${toolName}|${category}|${stableCode}`).
  - Enforced **B2 rule**: goal transition to `blocked` is permitted only when consecutive identical failures >= 3.
  - Enforced **G2 rule**: tool retry is blocked when consecutive identical failures >= 2, forcing alternate strategy.
  - Enforced **Invariant 3**: exact token accounting per step; `get_context_remaining` returns exact numbers or `null` (never estimates).
  - Wired `AgentLoop` into `GenerationService` and `container.ts` behind `ENABLE_AGENT_LOOP`.
  - Extended `GET /chats/:id` to return `activeGoal` and checkpoints.
  - Full test suite verified: 25 test files (332 tests) passing in backend, frontend tests and build passing.
- **2026-09-20: Item 11 (Skills System) complete and tested**:
  - Built ArcNave-native Skills architecture separating instruction/workflow knowledge (Skill) from actual capability (Tool).
  - Authored 8 initial skills in `backend/skills/` (`docx`, `pptx`, `xlsx`, `pdf`, `data-analysis`, `research-deep-dive`, `python-sandbox-patterns`, `skill-creator`) with strict YAML frontmatter schema.
  - Implemented `SkillService` (`backend/src/services/skills.ts`) with frontmatter validation, secure filesystem scan, in-memory Map registry, path-traversal prevention, keyword search, and dynamic capability evaluation (`full`, `guidance_only`, `unavailable`).
  - Implemented `SkillToolExecutor` (`backend/src/tools/skillExecutor.ts`) for model-callable discovery tools (`list_skills`, `search_skills`, `read_skill`) following typed error envelope (Invariant 1).
  - Integrated with Item 10 `AgentLoop` with progressive disclosure context limits (`MAX_LOADED_SKILLS_PER_STEP=3`, `MAX_SKILL_CONTEXT_TOKENS=12000`), deduplication, autoloading of `python-sandbox-patterns` when `run_python` is active, and logging `skill_loaded` events into `goal_events`.
  - Added public REST discovery endpoints `GET /v1/skills` and `GET /v1/skills/:name` (`backend/src/routes/skills.ts`), bringing total routes to 43.
  - Gated behind `ENABLE_SKILLS=false` in `config.ts`.
  - Full verification: 28 test files (353 tests) passing in backend, TypeScript clean (`tsc --noEmit`), OpenAPI schema regenerated (`43 paths`), frontend tests and build passing.

