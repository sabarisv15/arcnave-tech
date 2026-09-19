# Item 9 — Tool-Calling Framework, Phase 2 (`run_python`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Builds on phase 1** (merged to `main` via PR #6 — `ToolRegistry`, `ToolExecutor`,
`ProjectToolExecutor`, the bounded per-round tool loop in both provider adapters, gated behind
`ENABLE_TOOL_USE`). Phase 2 adds one new tool, `run_python`, without touching phase 1's loop
shape, persistence shape, or either adapter's round-loop code — it is a second `ToolExecutor`
implementation registered alongside `ProjectToolExecutor`'s tools in `ProjectToolRegistry`.

## Why this design, and what changed the plan mid-research

Two things were verified live in this session before writing a single line of code, per this
repo's "verify before claiming" rule and Invariant 1 (never substitute silently):

1. **The design in `tools/MAPPING.md` §9.9 still holds, and is now double-sourced.** Anthropic's
   own current agent-design guidance (`agent-design.md` → "Bash vs. dedicated tools") says to
   promote an action to a *dedicated* tool — not raw Bash — specifically when it needs a
   **security boundary**: code execution is exactly that. Combined with the already-recorded
   fact that Anthropic's Bash client tool works on Vertex but is schema-locked (fixed name
   `bash`, versioned `type`, no custom `input_schema`) while Gemini has no equivalent tool at
   all, a **custom `run_python` declaration for both providers** is what keeps this repo's `A1`
   property (one `ToolDefinition`, two serialisers) true. Platform availability re-confirmed
   today: server-side `code_execution` is still **"No" on Vertex**; client-side Bash is
   **"Yes" on Vertex** — unchanged since `tools/MAPPING.md` §10's 2026-09-19 check.
2. **The sandbox backend's REST contract was not actually known and had to be found before
   writing a client for it.** The checkpoint named "Vertex AI Agent Engine's Code Execution
   service" but only a Python-SDK quickstart was on record — no REST shape, and a live check
   confirmed the JS/TS SDK has **no support for this resource at all**
   (`googleapis/js-genai#2185`, open). Writing an HTTP client against a guessed shape would
   violate the same rule the captured-system-prompt mistake (`mistakes.md`, 2026-09-19) already
   cost a session on. The real REST reference (`docs.cloud.google.com/gemini-enterprise-agent-
   platform/reference/rest/v1/projects.locations.reasoningEngines.sandboxEnvironments`, last
   updated 2026-09-02) was fetched and is the source for every request/response shape below —
   this is **Preview**, not GA, so treat the shape as more likely to drift than a GA endpoint.

**Architecture:**
```
ProjectToolRegistry.getAvailableTools({ projectId })
  │  (unchanged signature; now also gates run_python on a *separate* flag —
  │   sandbox execution is a materially different risk/cost profile from read-only search)
  ▼
PROJECT_TOOL_DEFINITIONS  (unchanged)  +  RUN_PYTHON  (new, only when ENABLE_RUN_PYTHON)
  ▼
ProjectToolExecutor.execute()  — unchanged, still owns search_project_files/read_project_file
CodeExecutionToolExecutor.execute()  — new, owns run_python only
  │  wraps a SandboxClient interface — the only thing that touches HTTP
  ▼
SandboxClient  (new interface)
  ├── VertexSandboxClient (real: reasoningEngines/sandboxEnvironments REST calls over ADC)
  └── test fakes (never hit the network — same pattern as gemini/anthropicVertex's
       injected-SDK-client seam from phase 1's Task 6)
```

Two executors, not one, because `search_project_files`/`read_project_file` are pure-Postgres
(scoped by `projectId`, already tested against real Postgres) while `run_python` is a
stateful external resource with its own lifecycle (create → execute → delete) that must never
touch a database in its tests. `GenerationService` composes both into one `ToolExecutor` via a
small dispatching wrapper (Task 6) rather than teaching `ProjectToolExecutor` a second
unrelated responsibility.

**Tech Stack:** unchanged from phase 1, plus no new runtime dependency — the sandbox client is
raw `fetch` over ADC (the project already authenticates to Vertex via
`google-auth-library`-backed ADC for the existing provider adapters; reuse that, do not add a
second GCP client library for one feature).

## Global Constraints

- `npx tsc --noEmit` and `npx vitest run` must both be clean in `backend/` before any commit.
- **Never substitute silently** (Invariant 1): a sandbox creation failure, an execute timeout, or
  a non-2xx response is a typed `{ ok: false, content: [...] }` tool result fed back to the
  model — never a thrown error that aborts the whole generate request, and never retried against
  a different execution path.
- **No secret is ever committed** (Invariant 6): the sandbox client authenticates via the same
  ADC path every other Vertex call in this codebase already uses. No API key, no service-account
  JSON, ever.
- **Tests must never reach a provider or a real GCP resource.** `SandboxClient` is an interface
  specifically so `CodeExecutionToolExecutor`'s tests inject a fake implementation. The real
  `VertexSandboxClient` is exercised only by Task 8's live-verification checklist, which this
  environment cannot run (no `gcloud`/GCP credentials here — same standing constraint as phase
  1's Task 11 and every other Vertex-dependent item in `docs/checkpoints/CURRENT.md`).
- `run_python` is gated by its **own** flag, `ENABLE_RUN_PYTHON`, separate from
  `ENABLE_TOOL_USE`. `ENABLE_TOOL_USE=true, ENABLE_RUN_PYTHON=false` must give exactly phase 1's
  tool set — arbitrary code execution is a materially larger blast radius than read-only
  project-file search and must be independently toggleable.
- A `run_python` execution's stdout/stderr/files are all persisted the same three-tier way phase
  1 established for `tool_calls.content` (full bounded content to DB + model, short preview to
  SSE) — no new persistence shape.
- Comments state why, not what; a comment asserting a guarantee needs a test that fails when the
  guarantee stops holding.
- **Explicitly out of scope for this phase:** the skills registry (item 11), goal/budget
  bookkeeping (item 10/§9.2 item 4), sub-agent spawning, JavaScript sandbox support (Python
  only — `LANGUAGE_JAVASCRIPT` exists on the API but nothing in ArcNave needs it yet), sandbox
  snapshotting/pause/resume (the API supports it; this phase always creates a fresh sandbox per
  chat and lets it expire via `ttl`, not because snapshotting is wrong but because reusing a
  sandbox across turns is a cost/latency optimization, not a phase-2 requirement).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/src/config.ts` | `ENABLE_RUN_PYTHON`, `RUN_PYTHON_TIMEOUT_MS`, `RUN_PYTHON_MAX_OUTPUT_CHARS`, `SANDBOX_LOCATION` (defaults to `VERTEX_LOCATION`; the sandbox API's supported-regions list is narrower than Gemini/Claude's `global` — Task 1 records the actual list once checked). |
| `backend/src/tools/sandbox/client.ts` (new) | `SandboxClient` interface, `Chunk` type, `SandboxExecutionResult`. |
| `backend/src/tools/sandbox/vertexSandboxClient.ts` (new) | `VertexSandboxClient implements SandboxClient` — real REST calls (`reasoningEngines.create`, `sandboxEnvironments.create`, `:execute`, `delete`) over ADC-signed `fetch`, with the create→poll→execute→delete lifecycle. |
| `backend/src/tools/sandbox/vertexSandboxClient.test.ts` (new) | Fake-`fetch`-boundary tests — request shapes, response parsing, polling, error mapping. Never a real network call. |
| `backend/src/tools/definitions.ts` | Add `RUN_PYTHON: ToolDefinition`. |
| `backend/src/tools/registry.ts` | `ProjectToolRegistry` gains a second constructor flag for `runPythonEnabled`; appends `RUN_PYTHON` when both flags are on. |
| `backend/src/tools/registry.test.ts` | New cases for the second flag's on/off/combination matrix. |
| `backend/src/tools/codeExecutionExecutor.ts` (new) | `CodeExecutionToolExecutor implements ToolExecutor` — owns `run_python` only, wraps a `SandboxClient`, bounded output, abort-aware. |
| `backend/src/tools/codeExecutionExecutor.test.ts` (new) | Unit tests against a fake `SandboxClient` (no Postgres needed — this executor touches no database). |
| `backend/src/tools/dispatchingExecutor.ts` (new) | `DispatchingToolExecutor implements ToolExecutor` — routes by `call.name` to `ProjectToolExecutor` or `CodeExecutionToolExecutor`; unknown names still get phase 1's typed "Unknown tool" result. |
| `backend/src/tools/dispatchingExecutor.test.ts` (new) | Routing tests with two fake sub-executors. |
| `backend/src/services/generation.ts` | Construct `CodeExecutionToolExecutor`/`DispatchingToolExecutor` alongside the existing `ProjectToolExecutor` construction; tools list includes `RUN_PYTHON` when enabled. |
| `mistakes.md`, `docs/checkpoints/CURRENT.md` | Updated at the end. |

---

### Task 1: Confirm the sandbox API's supported regions and finalize config shape

The REST reference does not state supported regions for `reasoningEngines`/`sandboxEnvironments`
on its own page — Agent Engine's supported-regions list is documented separately and may not
match `VERTEX_LOCATION=global` (Gemini/Claude's setting). This must be checked (WebFetch the
Agent Engine supported-regions doc, or, if live GCP access exists in the executing environment,
a direct `create` call against `global` and observe whether it 400s) **before** Task 2 writes a
default — do not assume `global` works here just because it works for the two model calls.

- [ ] Confirm the supported region(s) for `reasoningEngines`/`sandboxEnvironments` and record the
      finding (source URL + date) in this plan's own text before Task 2.
- [ ] If confirmation is impossible in this environment (no live GCP access), default
      `SANDBOX_LOCATION` to `us-central1` (the region already used for `GPT_OSS_LOCATION` in this
      project, per `docs/checkpoints/CURRENT.md`, and one of Vertex's most broadly-supported
      regions for preview features) and mark it `# TODO(verify): confirm against Agent Engine's
      published region list` — never silently assume `global` without checking, per Invariant 1.

---

### Task 2: Config flags

**Files:** Modify `backend/src/config.ts`.

- [ ] **Step 1: Add the env vars**, after `TOOL_RESULT_PREVIEW_CHARS` (phase 1's last tool-config
      line):

```typescript
  /** Second, independent gate on top of ENABLE_TOOL_USE — arbitrary code execution is a
   *  materially larger blast radius than read-only project-file search, and must be
   *  independently toggleable. Both must be true for run_python to appear in the tool list. */
  ENABLE_RUN_PYTHON: bool(false),
  /** Region for the Agent Engine / sandboxEnvironments REST calls. See Task 1 — confirmed
   *  separately from VERTEX_LOCATION/GEMINI_LOCATION, which cover only the two model APIs. */
  SANDBOX_LOCATION: str('us-central1'), // TODO(verify): confirm against Agent Engine's region list
  /** Hard wall-clock cap on one run_python execution, enforced client-side (an AbortController
   *  on the :execute fetch) — the API's own execute call has no documented request-level
   *  timeout parameter, so this is ours to enforce, not the server's. */
  RUN_PYTHON_TIMEOUT_MS: int(30_000),
  /** Same three-tier shape as phase 1's READ_PROJECT_FILE_MAX_CHARS/TOOL_RESULT_PREVIEW_CHARS:
   *  this bounds what the model receives and what is persisted; the SSE preview is bounded
   *  again by the existing TOOL_RESULT_PREVIEW_CHARS, unchanged. */
  RUN_PYTHON_MAX_OUTPUT_CHARS: int(8000),
```

- [ ] **Step 2: Typecheck.** `cd backend && npx tsc --noEmit` — clean.
- [ ] **Step 3: Commit.**

```bash
git add backend/src/config.ts
git commit -m "feat(tools): add ENABLE_RUN_PYTHON, SANDBOX_LOCATION, and run_python bounds config"
```

---

### Task 3: `SandboxClient` interface and `VertexSandboxClient`

**Files:**
- Create: `backend/src/tools/sandbox/client.ts`
- Create: `backend/src/tools/sandbox/vertexSandboxClient.ts`
- Test: `backend/src/tools/sandbox/vertexSandboxClient.test.ts`

**Verified against the live REST reference before writing this task**
(`docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/
projects.locations.reasoningEngines.sandboxEnvironments`, last updated 2026-09-02, and the
sibling `.../reasoningEngines/create` page, last updated 2026-05-04):

- `POST https://{SANDBOX_LOCATION}-aiplatform.googleapis.com/v1/projects/{project}/locations/
  {location}/reasoningEngines` with a `ReasoningEngine` body → returns an `Operation` (long-running;
  poll `GET /v1/{operation.name}` until `done: true`, then read `response.name` for the created
  resource's full path — this is the same LRO shape Vertex uses elsewhere in this codebase's
  existing calls, nothing new to invent).
- `POST /v1/{parent=.../reasoningEngines/*}/sandboxEnvironments` body:
  `{ "displayName": string, "spec": { "codeExecutionEnvironment": { "codeLanguage":
  "LANGUAGE_PYTHON" } }, "ttl": "<seconds>s" }` → also an `Operation`, poll the same way.
- `POST /v1/{name=.../sandboxEnvironments/*}:execute` body `{ "inputs": [Chunk] }` → `{ "outputs":
  [Chunk] }`, synchronous (not an LRO).
- `Chunk = { mimeType: string, data: string /* base64 */, metadata?: { attributes: Record<string,
  string /* base64 */> } }`.
- `DELETE /v1/{name}` for both the sandbox and the reasoning engine, cleanup.
- Auth: standard ADC bearer token (`Authorization: Bearer <token>`), the same
  `google-auth-library` `GoogleAuth().getAccessToken()` path the existing Gemini/Anthropic Vertex
  adapters already use for their own token refresh — do not add a second auth mechanism.

- [ ] **Step 1: Write `client.ts`** — the interface and shared types, no implementation:

```typescript
/**
 * The seam between CodeExecutionToolExecutor and an actual sandbox backend. Exists so tests can
 * inject a fake and never touch a real GCP resource — same reasoning as phase 1's injectable
 * SDK-client seam on the provider adapters (gemini.ts/anthropicVertex.ts, Task 6).
 */
export interface Chunk {
  mimeType: string;
  data: string; // base64
}

export interface SandboxExecutionResult {
  /** Raw chunks as returned by the sandbox, already base64-decoded where the mime type is
   *  textual. Left as separate chunks (not pre-joined) because a run can emit both a
   *  stdout/stderr JSON chunk and zero or more file chunks — joining would lose that structure
   *  before CodeExecutionToolExecutor decides how to bound and present it. */
  outputs: { mimeType: string; text: string }[];
}

export interface SandboxClient {
  /** Runs `code` in a fresh, single-use sandbox: create reasoning engine → create sandbox →
   *  execute → delete both, in that order, always deleting even on execute failure. Callers
   *  never see the intermediate resource names. */
  runPython(code: string, signal: AbortSignal): Promise<SandboxExecutionResult>;
}
```

- [ ] **Step 2: Write the failing tests** for `VertexSandboxClient`:

```typescript
/**
 * VertexSandboxClient against a fake `fetch` — this is an HTTP client, so its own tests prove
 * request shapes and response parsing, never a real call. Live verification against the real
 * Preview API is Task 8, blocked on GCP access this environment does not have.
 */
import { describe, expect, it, vi } from 'vitest';

import { VertexSandboxClient } from './vertexSandboxClient.js';

function b64(s: string): string {
  return Buffer.from(s).toString('base64');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('VertexSandboxClient.runPython', () => {
  it('creates a reasoning engine, a sandbox, executes, decodes output, then deletes both', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/reasoningEngines') && init?.method === 'POST') {
        return jsonResponse({ name: 'projects/p/locations/us-central1/operations/op1', done: true, response: { name: 'projects/p/locations/us-central1/reasoningEngines/re1' } });
      }
      if (url.includes('/reasoningEngines/re1/sandboxEnvironments') && init?.method === 'POST') {
        return jsonResponse({ name: 'projects/p/locations/us-central1/operations/op2', done: true, response: { name: 'projects/p/locations/us-central1/reasoningEngines/re1/sandboxEnvironments/sb1' } });
      }
      if (url.endsWith(':execute')) {
        return jsonResponse({
          outputs: [
            { mimeType: 'application/json', data: b64(JSON.stringify({ msg_out: 'hello\n', msg_err: '' })) },
          ],
        });
      }
      if (init?.method === 'DELETE') {
        return jsonResponse({});
      }
      throw new Error(`unexpected call: ${init?.method ?? 'GET'} ${url}`);
    });

    const client = new VertexSandboxClient(
      { project: 'p', location: 'us-central1', getAccessToken: async () => 'fake-token' },
      fetchMock as unknown as typeof fetch,
    );

    const result = await client.runPython('print("hello")', new AbortController().signal);

    expect(result.outputs).toEqual([{ mimeType: 'application/json', text: JSON.stringify({ msg_out: 'hello\n', msg_err: '' }) }]);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2); // sandbox + reasoning engine
    expect(calls[0]!.url).toContain('reasoningEngines');
    expect(calls.every((c) => true)).toBe(true);
  });

  it('still deletes the reasoning engine and sandbox when execute fails', async () => {
    let deletes = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/reasoningEngines') && init?.method === 'POST') {
        return jsonResponse({ done: true, response: { name: 'projects/p/locations/us-central1/reasoningEngines/re1' } });
      }
      if (url.includes('sandboxEnvironments') && init?.method === 'POST') {
        return jsonResponse({ done: true, response: { name: 'projects/p/locations/us-central1/reasoningEngines/re1/sandboxEnvironments/sb1' } });
      }
      if (url.endsWith(':execute')) return jsonResponse({ error: { message: 'boom' } }, 500);
      if (init?.method === 'DELETE') {
        deletes += 1;
        return jsonResponse({});
      }
      throw new Error('unexpected call');
    });

    const client = new VertexSandboxClient(
      { project: 'p', location: 'us-central1', getAccessToken: async () => 'fake-token' },
      fetchMock as unknown as typeof fetch,
    );

    await expect(client.runPython('1/0', new AbortController().signal)).rejects.toThrow();
    expect(deletes).toBe(2);
  });

  it('propagates an already-aborted signal without making any request', async () => {
    const fetchMock = vi.fn();
    const client = new VertexSandboxClient(
      { project: 'p', location: 'us-central1', getAccessToken: async () => 'fake-token' },
      fetchMock as unknown as typeof fetch,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(client.runPython('x', controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify it fails.**
      `cd backend && npx vitest run src/tools/sandbox/vertexSandboxClient.test.ts` — FAIL,
      `./vertexSandboxClient.js` does not exist.

- [ ] **Step 4: Implement `VertexSandboxClient`.** Constructor takes `{ project, location,
      getAccessToken }` (an injectable auth seam — reuse the project's existing ADC token source,
      do not construct a new `GoogleAuth()` per call) and an injectable `fetch` (defaults to the
      global `fetch`, overridden in tests exactly like Task 6's SDK-client seam in phase 1).
      `runPython`:
      1. Checks `signal.aborted` up front (refuse to start).
      2. `POST .../reasoningEngines` → poll if `!done` (the LRO shape; poll with a short interval,
         capped by `RUN_PYTHON_TIMEOUT_MS`) → extract `response.name`.
      3. `POST .../sandboxEnvironments` with `spec.codeExecutionEnvironment.codeLanguage =
         "LANGUAGE_PYTHON"` and `ttl` derived from `RUN_PYTHON_TIMEOUT_MS` → poll → extract
         `response.name`.
      4. `POST {sandboxName}:execute` with one `Chunk` (`mimeType: 'text/x-python'`, `data: base64(
         code)`), `signal` passed through to `fetch` for the timeout.
      5. In a `finally`: `DELETE` the sandbox, then `DELETE` the reasoning engine — always, even
         if step 4 threw, so a failed execution never leaks a running sandbox (this is the whole
         reason cleanup is a `finally`, not a follow-up call sites have to remember).
      6. Decode each output `Chunk.data` from base64 to text and return
         `{ outputs: [{ mimeType, text }] }`.
      A non-2xx response at any step throws a typed error (`ProviderError`-shaped, reusing the
      existing error conventions in `providers/`) rather than being swallowed.

- [ ] **Step 5: Run to verify it passes, then typecheck.**
      `cd backend && npx vitest run src/tools/sandbox/vertexSandboxClient.test.ts && npx tsc --noEmit`

- [ ] **Step 6: Commit.**

```bash
git add backend/src/tools/sandbox/
git commit -m "feat(tools): add VertexSandboxClient with fake-fetch-boundary tests"
```

---

### Task 4: `run_python` tool definition

**Files:** Modify `backend/src/tools/definitions.ts`.

- [ ] **Step 1: Add `RUN_PYTHON`**, after `READ_PROJECT_FILE`:

```typescript
export const RUN_PYTHON: ToolDefinition = {
  name: 'run_python',
  description:
    'Runs Python code in an isolated, single-use sandbox with no network access and no access ' +
    "to this project's files or any other tool's data. Use it for computation — arithmetic, " +
    "data transformation, generating a chart, verifying a calculation — not for anything that " +
    'needs project context; combine with search_project_files/read_project_file first if the ' +
    'code needs data from the project. Output is captured stdout/stderr, truncated if large. ' +
    'The sandbox has no persisted state between calls — each call starts fresh.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python source to execute.' },
    },
    required: ['code'],
  },
};
```

Note the description explicitly says "no persisted state between calls" — unlike the Python SDK
quickstart's same-sandbox-reuse example, this phase always creates a fresh sandbox per call (see
Global Constraints' out-of-scope list). If a future phase adds session-scoped sandbox reuse, the
description has to change in the same commit, or the model will be told something false.

- [ ] **Step 2: Typecheck.** Clean.
- [ ] **Step 3: Commit.**

```bash
git add backend/src/tools/definitions.ts
git commit -m "feat(tools): add run_python tool definition"
```

---

### Task 5: `CodeExecutionToolExecutor`

**Files:**
- Create: `backend/src/tools/codeExecutionExecutor.ts`
- Test: `backend/src/tools/codeExecutionExecutor.test.ts` (unit, fake `SandboxClient` — no
  Postgres needed, unlike `ProjectToolExecutor`'s integration tests).

- [ ] **Step 1: Write the failing tests** — cases: successful run returns bounded `json` content;
      input validation rejects a missing `code` field without throwing (Invariant 1 shape, same
      as phase 1's executor); a `SandboxClient` rejection becomes `ok: false` with the error
      message, never a thrown error; output longer than `RUN_PYTHON_MAX_OUTPUT_CHARS` is
      truncated with a `truncated: true` flag in the returned JSON (mirrors phase 1's
      `read_project_file` truncation shape); an already-aborted signal refuses without calling
      the client, matching `ProjectToolExecutor`'s abort test from phase 1.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Constructor: `new CodeExecutionToolExecutor(client: SandboxClient,
      maxOutputChars: number)`. `execute()`: validate input with Zod (`{ code: z.string().min(1) }`,
      same pattern as phase 1's `searchInput`/`readInput`), check `signal.aborted` first, call
      `client.runPython(input.code, signal)`, join/bound the outputs into one `json` `ToolContent`
      block `{ stdout, stderr, truncated }` derived from the sandbox's `msg_out`/`msg_err` JSON
      chunk (file-output chunks are out of scope for this phase — described in Task 4's
      out-of-scope list implicitly by the tool description not mentioning files; if a future call
      needs file output, that is a new tool-description commit, not a silent capability change).
      Catch any thrown error from `client.runPython` and convert to `{ ok: false, content:
      [{type:'text', text: <message>}] }` — never let it propagate and crash the adapter's round
      loop, per Invariant 1.

- [ ] **Step 4: Run to verify it passes, then typecheck.**

- [ ] **Step 5: Commit.**

```bash
git add backend/src/tools/codeExecutionExecutor.ts backend/src/tools/codeExecutionExecutor.test.ts
git commit -m "feat(tools): add CodeExecutionToolExecutor for run_python"
```

---

### Task 6: `DispatchingToolExecutor` and registry wiring

**Files:**
- Create: `backend/src/tools/dispatchingExecutor.ts`
- Test: `backend/src/tools/dispatchingExecutor.test.ts`
- Modify: `backend/src/tools/registry.ts`, `backend/src/tools/registry.test.ts`
- Modify: `backend/src/services/generation.ts`

- [ ] **Step 1: Write the failing `DispatchingToolExecutor` tests** — routes `search_project_files`/
      `read_project_file` to a fake "project" executor, `run_python` to a fake "code" executor,
      and an unknown name to phase 1's typed unknown-tool result without calling either fake.

- [ ] **Step 2: Implement.**

```typescript
/**
 * Composes ProjectToolExecutor and CodeExecutionToolExecutor behind one ToolExecutor, so
 * GenerationService/the adapters keep talking to a single executor exactly as phase 1 designed —
 * routing by tool name is this class's whole job, not a reason to teach either sub-executor
 * about the other's tools.
 */
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';

export class DispatchingToolExecutor implements ToolExecutor {
  constructor(private readonly byName: Map<string, ToolExecutor>) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const executor = this.byName.get(call.name);
    if (!executor) {
      return { toolCallId: call.id, ok: false, content: [{ type: 'text', text: `Unknown tool "${call.name}".` }] };
    }
    return executor.execute(call, signal);
  }
}
```

- [ ] **Step 3: Run to verify it passes, then typecheck.**

- [ ] **Step 4: `ProjectToolRegistry` — second flag.** Update the constructor to
      `constructor(private readonly toolsEnabled: boolean, private readonly runPythonEnabled:
      boolean)` and `getAvailableTools`:

```typescript
  getAvailableTools(context: ToolContext): ToolDefinition[] {
    if (!this.toolsEnabled || context.projectId === null) return [];
    return this.runPythonEnabled ? [...PROJECT_TOOL_DEFINITIONS, RUN_PYTHON] : PROJECT_TOOL_DEFINITIONS;
  }
```

Update `registry.test.ts` for the new constructor signature and add cases for
`(true, false)`/`(true, true)`/`(false, true)`.

- [ ] **Step 5: `generation.ts` wiring.** Where phase 1 constructs `new ProjectToolExecutor(...)`,
      construct both executors and compose them:

```typescript
    const toolsEnabled = this.cfg.ENABLE_TOOL_USE && project !== null;
    const runPythonEnabled = toolsEnabled && this.cfg.ENABLE_RUN_PYTHON;
    const tools = toolsEnabled
      ? new ProjectToolRegistry(toolsEnabled, runPythonEnabled).getAvailableTools({ projectId: project!.id })
      : undefined;
    const toolExecutor = toolsEnabled
      ? new DispatchingToolExecutor(
          new Map<string, ToolExecutor>([
            ...['search_project_files', 'read_project_file'].map(
              (name): [string, ToolExecutor] => [name, new ProjectToolExecutor(this.db, this.retriever, project!.id, this.cfg.READ_PROJECT_FILE_MAX_CHARS)],
            ),
            ...(runPythonEnabled
              ? ([['run_python', new CodeExecutionToolExecutor(this.sandboxClient, this.cfg.RUN_PYTHON_MAX_OUTPUT_CHARS)]] as [string, ToolExecutor][])
              : []),
          ]),
        )
      : undefined;
```

(Adjust to this file's actual existing variable names/DI shape — `this.sandboxClient` is a new
constructor-injected dependency on `GenerationService`, following the same DI pattern `this.db`/
`this.retriever` already use; wire it through `container.ts` alongside the other service
construction, constructing one real `VertexSandboxClient` per process — not per request, since
its GCP client credentials don't need to be — reusing `Config`'s existing ADC/ `GOOGLE_CLOUD_PROJECT`
values.)

- [ ] **Step 6: Full backend suite and typecheck.**
      `cd backend && npx tsc --noEmit && npx vitest run` — clean; every phase-1 test unaffected
      (both new flags default `false`).

- [ ] **Step 7: Commit.**

```bash
git add backend/src/tools/dispatchingExecutor.ts backend/src/tools/dispatchingExecutor.test.ts backend/src/tools/registry.ts backend/src/tools/registry.test.ts backend/src/services/generation.ts backend/src/container.ts
git commit -m "feat(tools): wire run_python into the tool registry via a dispatching executor"
```

---

### Task 7: Docs

**Files:** `mistakes.md`, `docs/checkpoints/CURRENT.md`.

- [ ] Add a `mistakes.md` entry only if something was actually wrong and caught while
      implementing (e.g. if Task 1's region assumption turns out wrong, or the LRO polling shape
      differs from what the reference implied). Do not manufacture an entry if nothing surfaced.
- [ ] Update `docs/checkpoints/CURRENT.md`: item 9 phase 2 (`run_python`) implemented, gated
      behind `ENABLE_TOOL_USE && ENABLE_RUN_PYTHON` (both default off), unit-tested against a
      fake `SandboxClient`/`fetch` — **not yet verified against the real Preview API** (Task 8,
      blocked on GCP access this environment doesn't have, same standing constraint as every
      other live-Vertex item already on record). Note explicitly that `SANDBOX_LOCATION`'s
      default is unverified (Task 1's `# TODO(verify)`) if it was never confirmed.
- [ ] Commit.

```bash
git add mistakes.md docs/checkpoints/CURRENT.md
git commit -m "docs(tools): record item 9 phase 2 (run_python) status"
```

---

### Task 8: Live verification against real Vertex (blocked on the user)

Cannot run in an environment without `gcloud`/GCP credentials.

- [ ] Confirm `SANDBOX_LOCATION`'s actual supported-region list (Task 1) against a real call —
      if `us-central1` 400s, find the correct region from the error or Agent Engine's own docs.
- [ ] With `ENABLE_TOOL_USE=true` and `ENABLE_RUN_PYTHON=true`, send a chat message on **Gemini
      3.8 Flash** that requires computing something (e.g. "what's 47 * 1289, and is the result
      prime?"). Confirm a `tool_use`/`tool_result` pair appears for `run_python` and the sandbox's
      stdout reaches the final answer.
- [ ] Repeat on **Sonnet 5** or **Opus 5**.
- [ ] Confirm a sandbox is actually deleted after use — `sandboxEnvironments.list` on the created
      reasoning engine returns empty (or `STATE_DELETED`) after the request completes, proving
      Task 3's `finally`-based cleanup actually runs against the real API, not just the fake.
      Deliberately induce an execute failure (e.g. `code: "raise SystemExit(1)"` or code that
      throws) and confirm cleanup still happens — this is the one behavior the fake-`fetch` test
      cannot fully prove, since it depends on the real API accepting a `DELETE` after a non-2xx
      `:execute` response.
- [ ] Measure and record actual latency for the full create→execute→delete round trip — the
      REST reference doesn't state typical create/poll timing, and `RUN_PYTHON_TIMEOUT_MS`'s
      default (30s) is a guess pending this measurement.
- [ ] Confirm `ENABLE_RUN_PYTHON=false, ENABLE_TOOL_USE=true` still offers exactly
      `search_project_files`/`read_project_file` — the two-flag gate actually holds together.

If any of these fail, update `mistakes.md` and adjust before considering phase 2 done.
