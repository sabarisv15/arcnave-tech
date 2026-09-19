# Item 9 — Tool-Calling Framework (Phase 1, Revised) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**This plan supersedes [`docs/superpowers/plans/2026-09-19-item9-tool-framework.md`](2026-09-19-item9-tool-framework.md).**
No code from the prior plan exists in the repository — this is a from-scratch revision, not a
patch. Per this repo's rule that a decision is not changed until the document recording it is
changed, in the same commit: the prior plan file stays in place as a historical record and its
header will be updated (Task 14) to point here.

## What changed from the prior plan, and why

| # | Prior plan | This plan | Why |
| --- | --- | --- | --- |
| 1 | Loop lived inside each adapter's `stream()`; `GenerationService` only read `ProviderEvent`s | **Kept.** Still true here — `GenerationService` never sees `functionCall`/`tool_use` shapes. | User confirmed this boundary is correct and must not move. |
| 2 | `ToolResult { toolCallId, ok, output: string }` | `ToolResult { toolCallId, ok, content: ToolContent[] }` where `ToolContent` is `{type:'text',text}` \| `{type:'json',data}` | Future tools (attendance, assessments, Drive, spreadsheets) return structured data. A string-only result would force every future tool to stringify first and every consumer to re-parse. |
| 3 | No cancellation contract for tool execution | `ToolExecutor.execute(call, signal)` — every tool implementation receives the request's `AbortSignal` | Tools will eventually call Drive, external APIs, and `run_python`, all of which need to stop when the user hits stop. |
| 4 | `PROJECT_TOOL_DEFINITIONS` imported directly into `GenerationService` | New `ToolRegistry` interface; `GenerationService` calls `toolRegistry.getAvailableTools({projectId})` | `GenerationService` must not be permanently coupled to one hardcoded array — future tool sets will vary by permission, feature flag, and project. |
| 5 | `TOOL_LOOP_MAX_STEPS` (ambiguous: is a "step" a round or a call?) | `TOOL_MAX_ROUNDS` — one round = one provider request + at most one tool execution. No separate `TOOL_MAX_CALLS`: Phase 1 caps at one tool call per round (see #6), so calls ≤ rounds always, and a second counter would track a number `TOOL_MAX_ROUNDS` already bounds. | Explicit semantics, no redundant config. |
| 6 | Anthropic sequential via `disable_parallel_tool_use`; Gemini's multi-function-call behaviour left undefined | Both providers process **exactly one tool call per round**. Gemini: if `chunk.functionCalls` has more than one entry, the first is executed: the rest each get an explicit failed `functionResponse` ("only one tool call is processed per round; call again next round") so the conversation never has an orphaned call. Tested. | Prevents Gemini silently running a different agent model than Claude. |
| 7 | `read_project_file` concatenated every chunk of a file, unbounded | `read_project_file(fileId, cursor?, maxChars?)` reads ordered chunks starting at `cursor` (default 0) until `maxChars` (hard-capped server-side at `READ_PROJECT_FILE_MAX_CHARS`, default 6000) is reached; returns `{filename, content, truncated, nextCursor}` | A 400-chunk file must never be handed whole to the model. |
| 8 | `search_project_files` description already said "lexical" | **Kept unchanged.** | Already correct; Invariant 4 already satisfied. |
| 9 | `tool_calls.input` was `NOT NULL` but persistence wrote `input ?? null` | Column stays `NOT NULL jsonb`; the insert always writes `input ?? {}` — never `null`. No `requested`/`running` lifecycle state: Phase 1 execution is one synchronous `await` with no externally observable "running" window (same reasoning `researchEvents` already uses — persisted once, after the fact). Revisit if a future tool is genuinely async/long-running. | Removes the contradiction named in the review brief without inventing unneeded states. |
| 10 | One `output.slice(0, 2000)` used for both the DB row and the SSE frame | Three tiers, each with its own explicit limit: **(a)** model receives the tool-level bounded `ToolResult.content` (already ≤ ~6000 chars via #7); **(b)** the DB stores that same bounded content in full, as `jsonb` — it's already small enough that a second truncation would only hurt debugging; **(c)** the SSE `tool_result` frame carries a short preview string, `toolResultPreview(result, cfg.TOOL_RESULT_PREVIEW_CHARS)` (default 300 chars) | Debugging a tool call means reading what the model actually saw, not a re-truncated copy of it. |
| 11 | Only `FakeProvider`-level integration tests | **New test tier added:** adapter-loop tests at the SDK-client boundary, for both Gemini and Claude, injecting a fake client object (never a real Vertex call). This is the single largest addition in this revision — Tasks 9 and 12. | `FakeProvider` tests prove `ProviderEvent → GenerationService`, never `SDK response → tool detection → execution → continuation`, which is where the real risk in this feature lives. |
| 12–17 | (testing tiers, project isolation, feature flag, live verification, scope) | **Kept, see Tasks below.** | Already correct in the prior plan. |
| 18 | — | Target architecture diagram unchanged from the prior plan's intent, now realized via `ToolRegistry` instead of a hardcoded array (#4). | — |

**Explicitly out of scope, unchanged from the prior plan:** `run_python`/sandbox, skills registry,
sub-agent spawning, goal/budget bookkeeping, any write actions, external integrations beyond
what already exists.

---

**Goal:** Give ArcNave a real, bounded, provider-neutral tool-calling loop — `search_project_files`
and `read_project_file`, resolved through a `ToolRegistry` — for both the Gemini and Anthropic
adapters, with structured (`text`/`json`) tool results, `AbortSignal`-aware execution, and test
coverage that actually exercises each SDK's tool-call/tool-response wire shape.

**Architecture:**
```
GenerationService
  │  resolves project/context, asks ToolRegistry for available tools
  ▼
Provider Adapter (Gemini | Anthropic)
  │  owns provider-specific tool schema + the bounded round loop
  │  (TOOL_MAX_ROUNDS from Config; at most one tool call executed per round)
  ▼
ToolExecutor.execute(call, signal)
  │  project-scoped, AbortSignal-aware
  ├── search_project_files → bounded BM25 results (json)
  └── read_project_file    → bounded, paginated chunk read (json)

GenerationService observes only `tool_use` / `tool_result` ProviderEvents (never provider wire
shapes) for SSE framing and three-tier persistence (model/audit/preview).
```

**Tech Stack:** Node 22, TypeScript, Fastify 5, Drizzle ORM, `@anthropic-ai/vertex-sdk`
(`@anthropic-ai/sdk` types), `@google/genai`, Zod, Vitest.

## Global Constraints

- `npx tsc --noEmit` and `npx vitest run` must both be clean in `backend/` before any commit.
- **Never substitute silently** (Invariant 1): an unknown tool name or invalid input returns
  `{ ok: false, content: [{type:'text', text: '<reason>'}] }`, fed back to the model as a real
  tool result — never dropped, retried against a different tool, or treated as success.
- **BM25 is not semantic search** (Invariant 4): `search_project_files`'s description must say
  "lexical keyword search" and must not imply conceptual/semantic matching.
- **Tests must never reach a provider.** `ProjectToolExecutor` is proven against real Postgres
  (it's a DB-only component). Adapter loops are proven against an **injected fake SDK client**,
  never a real Vertex call. `GenerationService` is proven against `FakeProvider`, unchanged.
- **Explicitly out of scope:** `run_python`/sandbox execution, skills registry, sub-agent
  spawning, goal/budget bookkeeping, any write actions (attendance/assessment modification,
  Drive writes), external integrations beyond what already exists.
- `npm run openapi` must be re-run and `docs/openapi.json` committed once the `/chats/:id/generate`
  route's documented SSE frame list changes (Task 11).
- Comments state why, not what; a comment asserting a guarantee needs a test that fails when the
  guarantee stops holding.
- Tool use stays **off by default** (`ENABLE_TOOL_USE=false`). The flag is never removed after a
  first successful test — see Task 13's rollout checklist.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/src/providers/types.ts` | `ToolContent`/`ToolDefinition`/`ToolCall`/`ToolResult`/`ToolExecutor`, `toolResultPreview()`; `GenerationRequest.tools`/`toolExecutor`; two new `ProviderEvent` variants. |
| `backend/src/config.ts` | `ENABLE_TOOL_USE`, `TOOL_MAX_ROUNDS`, `READ_PROJECT_FILE_MAX_CHARS`, `TOOL_RESULT_PREVIEW_CHARS`. |
| `backend/src/db/schema.ts` | New `toolCalls` table (`input`/`content` as `jsonb`, never nullable), relation, inferred type. |
| `backend/src/tools/registry.ts` (new) | `ToolContext`, `ToolRegistry` interface, `ProjectToolRegistry` (Phase-1 implementation). |
| `backend/src/tools/definitions.ts` (new) | `SEARCH_PROJECT_FILES`, `READ_PROJECT_FILE`, `PROJECT_TOOL_DEFINITIONS`. |
| `backend/src/tools/executor.ts` (new) | `ProjectToolExecutor implements ToolExecutor` — bounded search + paginated read, abort-aware, project-scoped. |
| `backend/src/tools/executor.integration.test.ts` (new) | Real-Postgres tests. |
| `backend/src/services/generation.ts` | `ToolRegistry` wiring, three-tier persist/preview, two new `StreamEvent` variants, new `case`s in `run()`. |
| `backend/src/providers/gemini.ts` | Injectable-client seam, `toGeminiFunctionDeclaration`, `toGeminiFunctionResponse`, bounded round loop with single-call-per-round policy. |
| `backend/src/providers/gemini.adapter-loop.test.ts` (new) | Fake-SDK-client-boundary tests — the required new test tier. |
| `backend/src/providers/anthropicVertex.ts` | Injectable-client seam, `toAnthropicTool`, `toAnthropicToolResultBlock`, bounded round loop, `disable_parallel_tool_use`. |
| `backend/src/providers/anthropicVertex.adapter-loop.test.ts` (new) | Fake-SDK-client-boundary tests. |
| `backend/src/providers/gemini.test.ts` / `anthropicVertex.test.ts` | Existing pure-serialisation tests, extended with `toGeminiFunctionDeclaration`/`toAnthropicTool`. |
| `backend/src/routes/chats.ts` | SSE frame list doc string update. |
| `backend/src/routes/chats.integration.test.ts` | `FakeProvider`-level tool-use test, updated for the structured `ToolResult` shape. |
| `mistakes.md`, `docs/checkpoints/CURRENT.md`, prior plan's header | Updated at the end. |

---

### Task 1: Core tool types

**Files:**
- Modify: `backend/src/providers/types.ts`

**Interfaces:**
- Produces: `ToolContent`, `ToolDefinition { name, description, inputSchema }`, `ToolCall { id, name, input }`, `ToolResult { toolCallId, ok, content: ToolContent[] }`, `ToolExecutor { execute(call, signal): Promise<ToolResult> }`, `toolResultPreview(result, maxChars): string` — every later task imports these from `../providers/types.js`.
- Modifies: `GenerationRequest` gains `tools?: ToolDefinition[]` and `toolExecutor?: ToolExecutor`. `ProviderEvent` gains `tool_use` and `tool_result` variants.

No behaviour to test yet — the gate is the compiler.

- [ ] **Step 1: Add the tool types**

Add to `backend/src/providers/types.ts`, immediately after the `totalTokens` function and before
`export type ProviderEvent =`:

```typescript
/**
 * The shape of one piece of a tool's result. `text` is the common case; `json` is for tools
 * whose natural output is structured (search hits, a paginated read, and — later — attendance
 * rows, assessment scores, timetable entries). Provider adapters flatten this into their own
 * wire format; nothing in this type is provider-specific.
 */
export type ToolContent = { type: 'text'; text: string } | { type: 'json'; data: unknown };

/** A tool the model may call. `inputSchema` is provider-neutral JSON Schema; each adapter clones
 *  it before handing it to its own SDK — `@google/genai` rewrites a schema object in place
 *  (uppercasing `type` values), so sharing one object between two adapters would corrupt
 *  whichever one runs second. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** `ok: false` means the tool ran and failed, or its input was invalid — never thrown, always
 *  fed back to the model as a real result so it can react, per Invariant 1. `content` is already
 *  bounded by the tool implementation before it reaches here — this type does not itself impose
 *  a limit. */
export interface ToolResult {
  toolCallId: string;
  ok: boolean;
  content: ToolContent[];
}

/**
 * The seam between a provider adapter's loop and ArcNave's actual tool implementations.
 * Constructed fresh per request (it is bound to one project), never shared across requests.
 * `signal` is the same `AbortSignal` the provider request carries: a tool whose backing store
 * cannot truly interrupt an in-flight operation (e.g. a single Postgres query) still checks it
 * at its own entry/exit boundaries, so cancellation propagates as far as is honestly possible —
 * this interface does not promise mid-operation interruption for every implementation.
 */
export interface ToolExecutor {
  execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
}

/** Flatten a `ToolResult` into a short string for an SSE preview frame — never the value stored
 *  in the database or sent back to the model, both of which keep the full bounded content. */
export function toolResultPreview(result: ToolResult, maxChars: number): string {
  const flat = result.content
    .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c.data)))
    .join(' ');
  return flat.length > maxChars ? `${flat.slice(0, maxChars)}…` : flat;
}
```

- [ ] **Step 2: Extend `ProviderEvent`**

Replace the `ProviderEvent` union:

```typescript
export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: ProviderSource[]; searchEntryPoint?: string }
  | { type: 'progress'; stage: Stage; label: string; detail: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'completed'; usage: ProviderUsage; finishReason: string };
```

with:

```typescript
export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: ProviderSource[]; searchEntryPoint?: string }
  | { type: 'progress'; stage: Stage; label: string; detail: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; name: string; result: ToolResult }
  | { type: 'completed'; usage: ProviderUsage; finishReason: string };
```

- [ ] **Step 3: Extend `GenerationRequest`**

Replace the `GenerationRequest` interface with the same fields plus two new optional ones:

```typescript
export interface GenerationRequest {
  prompt: string;
  history: Turn[];
  attachments?: AttachmentBlock[];
  systemInstruction: string;
  mode: Mode;
  maxOutputTokens: number;
  providerModelId: string;
  grounded: boolean;
  codeExecution: boolean;
  /** Tool schemas available this turn. Absent or empty means no tool-calling loop runs. */
  tools?: ToolDefinition[];
  /** Required when `tools` is non-empty; absent otherwise. */
  toolExecutor?: ToolExecutor;
  signal: AbortSignal;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/types.ts
git commit -m "feat(tools): add structured ToolResult/ToolExecutor types with AbortSignal"
```

---

### Task 2: Config flags

**Files:**
- Modify: `backend/src/config.ts`

**Interfaces:**
- Produces: `Config.ENABLE_TOOL_USE: boolean`, `Config.TOOL_MAX_ROUNDS: number`,
  `Config.READ_PROJECT_FILE_MAX_CHARS: number`, `Config.TOOL_RESULT_PREVIEW_CHARS: number`.

- [ ] **Step 1: Add the env vars**

In `backend/src/config.ts`, after the `ENABLE_GEMINI_CODE_EXECUTION` line and before the
`// --- Storage ---` comment, insert:

```typescript
  /**
   * Master gate for the item-9 tool-calling loop. Off by default: a deployment gains nothing
   * from it without a project, and it changes both adapters' wire shape.
   */
  ENABLE_TOOL_USE: bool(false),
  /** One round = one provider request + at most one tool execution. The loop answers with
   *  `finishReason: 'tool_limit'` rather than looping forever once this is hit. */
  TOOL_MAX_ROUNDS: int(8),
  /** Hard server-side cap on `read_project_file`'s returned text, regardless of what `maxChars`
   *  the model requests. Keeps one large document from ever being handed over whole. */
  READ_PROJECT_FILE_MAX_CHARS: int(6000),
  /** Length of the `tool_result` SSE preview string. Independent of what the model receives
   *  (the full bounded result) and what is persisted (the same full bounded result) — this is
   *  the UI's budget only. */
  TOOL_RESULT_PREVIEW_CHARS: int(300),
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add backend/src/config.ts
git commit -m "feat(tools): add ENABLE_TOOL_USE, TOOL_MAX_ROUNDS, and result-size config"
```

---

### Task 3: `toolCalls` table

**Files:**
- Modify: `backend/src/db/schema.ts` (after `researchEvents`, its relation, and its inferred type)
- Generate: a new migration under `backend/drizzle/`

**Interfaces:**
- Produces: `toolCalls` table, `toolCallsRelations`, `ToolCallRow = typeof toolCalls.$inferSelect`.

- [ ] **Step 1: Add the table**

Immediately after the `researchEvents` table definition in `backend/src/db/schema.ts`:

```typescript
/**
 * One row per tool call/result pair the model made while answering a message. `input` and
 * `content` are `jsonb` and `NOT NULL` — the insert always supplies `input ?? {}`, never `null`,
 * so the column constraint and the write path can never contradict each other. No separate
 * requested/running state: execution here is one synchronous `await`, with no externally
 * observable "running" window to record (same reasoning as `researchEvents`, which also
 * persists only after the fact). Revisit if a future tool is genuinely long-running/async.
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: id(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    /** The provider's own id for this call (Anthropic's `tool_use.id`, Gemini's `FunctionCall.id`
     *  when present, or a synthesised id when the provider did not supply one). */
    toolCallId: varchar('tool_call_id', { length: 128 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    input: jsonb('input').notNull(),
    /** The full bounded `ToolResult.content` the model actually received — not a further-
     *  truncated copy. See generation.ts's three-tier persist/preview split. */
    content: jsonb('content').notNull(),
    ok: boolean('ok').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_tool_call_ordinal').on(t.messageId, t.ordinal)],
);
```

- [ ] **Step 2: Add its relation**

Immediately after `researchEventsRelations`:

```typescript
export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
  message: one(messages, { fields: [toolCalls.messageId], references: [messages.id] }),
}));
```

Add `toolCalls: many(toolCalls),` to `messagesRelations`'s object, alongside its existing
`events: many(researchEvents),` line.

- [ ] **Step 3: Add the inferred type**

Immediately after `export type ResearchEvent = typeof researchEvents.$inferSelect;`:

```typescript
export type ToolCallRow = typeof toolCalls.$inferSelect;
```

- [ ] **Step 4: Generate and inspect the migration**

Run: `cd backend && npm run db:generate`
Expected: a new file under `backend/drizzle/` with a single `CREATE TABLE "tool_calls" (...)`
plus its unique index and foreign key. Read it before proceeding; do not hand-edit it.

- [ ] **Step 5: Apply it locally and typecheck**

Run: `cd backend && npm run db:migrate && npx tsc --noEmit`
Expected: migration applies with no error; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/
git commit -m "feat(tools): add tool_calls table with jsonb input/content"
```

---

### Task 4: `ToolRegistry` and tool definitions

**Files:**
- Create: `backend/src/tools/registry.ts`
- Create: `backend/src/tools/definitions.ts`
- Test: `backend/src/tools/registry.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` (Task 1).
- Produces: `ToolContext { projectId: string | null }`, `ToolRegistry { getAvailableTools(context): ToolDefinition[] }`, `ProjectToolRegistry implements ToolRegistry`, `SEARCH_PROJECT_FILES`, `READ_PROJECT_FILE`, `PROJECT_TOOL_DEFINITIONS` — consumed by `GenerationService` (Task 7) and `ProjectToolExecutor` (Task 5, for its `switch` on `call.name`).

- [ ] **Step 1: Write the tool definitions**

`backend/src/tools/definitions.ts`:

```typescript
/**
 * ArcNave's phase-1 tool set: read access to the current project's already-indexed files.
 *
 * Descriptions matter more than they look like they should — the model reasons from them, not
 * the schema. Per Invariant 4, `search_project_files`'s description must say "lexical keyword
 * search" and must not claim conceptual/semantic matching, because there is none.
 */
import type { ToolDefinition } from '../providers/types.js';

export const SEARCH_PROJECT_FILES: ToolDefinition = {
  name: 'search_project_files',
  description:
    "Lexical keyword search over the current project's indexed files. Returns the most " +
    'relevant excerpts, not whole documents, ranked by BM25 term overlap — this is keyword ' +
    'matching, not semantic or conceptual search, so exact terms matter more than phrasing. ' +
    "Use it when the question likely depends on project-specific content that hasn't already " +
    'appeared in this conversation. Do not use it for general-knowledge questions unrelated to ' +
    'the project.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keywords to search for, not a full natural-language question.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of excerpts to return. Defaults to 5.',
      },
    },
    required: ['query'],
  },
};

export const READ_PROJECT_FILE: ToolDefinition = {
  name: 'read_project_file',
  description:
    'Reads the indexed text of one project file by id, starting at an optional cursor, for ' +
    'when a search excerpt is not enough context. The response is bounded and may be ' +
    'truncated — check `truncated` and pass the returned `nextCursor` back in a follow-up call ' +
    'to continue reading. Only call this with a fileId already seen in this conversation, such ' +
    'as one returned by search_project_files. Do not guess a fileId.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The file id, exactly as returned by search_project_files.',
      },
      cursor: {
        type: 'integer',
        description: 'Chunk ordinal to resume from. Omit to start from the beginning.',
      },
      maxChars: {
        type: 'integer',
        description: 'Soft budget for returned characters. The server enforces a hard cap ' +
          'regardless of this value.',
      },
    },
    required: ['fileId'],
  },
};

export const PROJECT_TOOL_DEFINITIONS: ToolDefinition[] = [SEARCH_PROJECT_FILES, READ_PROJECT_FILE];
```

- [ ] **Step 2: Write the failing registry test**

`backend/src/tools/registry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { PROJECT_TOOL_DEFINITIONS } from './definitions.js';
import { ProjectToolRegistry } from './registry.js';

describe('ProjectToolRegistry', () => {
  it('returns no tools when disabled, even with a project', () => {
    const registry = new ProjectToolRegistry(false);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual([]);
  });

  it('returns no tools when enabled but there is no project', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: null })).toEqual([]);
  });

  it('returns the project tool set when enabled and a project is present', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual(PROJECT_TOOL_DEFINITIONS);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && npx vitest run src/tools/registry.test.ts`
Expected: FAIL — `./registry.js` does not exist yet.

- [ ] **Step 4: Write `registry.ts`**

```typescript
/**
 * Resolves which tools a request may use. The seam future phases hang permission logic off of
 * (faculty role, semester, feature flags, risk level) without `GenerationService` ever holding a
 * hardcoded tool array again. Phase 1's rule is deliberately the whole rule: enabled, and a
 * project is in scope. Project *authorization* already happened before this is called —
 * `GenerationService.loadProject` scopes by `userId`, so a `projectId` reaching here is already
 * the caller's own project.
 */
import { PROJECT_TOOL_DEFINITIONS } from './definitions.js';
import type { ToolDefinition } from '../providers/types.js';

export interface ToolContext {
  projectId: string | null;
}

export interface ToolRegistry {
  getAvailableTools(context: ToolContext): ToolDefinition[];
}

export class ProjectToolRegistry implements ToolRegistry {
  constructor(private readonly enabled: boolean) {}

  getAvailableTools(context: ToolContext): ToolDefinition[] {
    if (!this.enabled || context.projectId === null) return [];
    return PROJECT_TOOL_DEFINITIONS;
  }
}
```

- [ ] **Step 5: Run to verify it passes, then typecheck**

Run: `cd backend && npx vitest run src/tools/registry.test.ts && npx tsc --noEmit`
Expected: 3/3 PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tools/registry.ts backend/src/tools/definitions.ts backend/src/tools/registry.test.ts
git commit -m "feat(tools): add ToolRegistry and phase-1 tool definitions"
```

---

### Task 5: `ProjectToolExecutor` — bounded search and paginated read

**Files:**
- Create: `backend/src/tools/executor.ts`
- Test: `backend/src/tools/executor.integration.test.ts`

**Interfaces:**
- Consumes: `Database`, `fileChunks`/`projectFiles` (`../db/schema.js`), `Retriever`
  (`../services/retrieval.js`), `ToolCall`/`ToolExecutor`/`ToolResult`/`ToolContent`
  (`../providers/types.js`, Task 1), `readProjectFileMaxChars: number` (from `Config`).
- Produces: `ProjectToolExecutor implements ToolExecutor`, constructed as
  `new ProjectToolExecutor(db, retriever, projectId, readMaxChars)` — consumed by
  `GenerationService` (Task 7).

- [ ] **Step 1: Write the failing tests**

```typescript
/**
 * `ProjectToolExecutor` against a real project's indexed files.
 *
 * Runs against real Postgres via the shared test harness — this executor's whole job is running
 * database queries, so a mock would prove nothing about whether the queries are actually right.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LexicalRetriever, indexFile } from '../services/retrieval.js';
import { createTestApp, signUp } from '../test/harness.js';
import type { TestContext } from '../test/harness.js';
import type { ToolContent } from '../providers/types.js';
import { ProjectToolExecutor } from './executor.js';

let ctx: TestContext;
let projectId: string;
let fileId: string;

function jsonContent(content: ToolContent[]): Record<string, unknown> {
  const block = content[0];
  if (!block || block.type !== 'json') throw new Error('expected a json content block');
  return block.data as Record<string, unknown>;
}

beforeAll(async () => {
  ctx = await createTestApp();
  const user = await signUp(ctx);
  const project = await ctx.app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: { cookie: user.cookie },
    payload: { title: 'Tool executor fixture' },
  });
  projectId = (project.json() as { id: string }).id;

  const schema = await import('../db/schema.js');
  const [row] = await ctx.db
    .insert(schema.projectFiles)
    .values({
      projectId,
      userId: user.id,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 20,
      storageKey: 'fixture/notes.txt',
      status: 'ready',
    })
    .returning({ id: schema.projectFiles.id });
  fileId = row!.id;

  // Long enough to produce multiple chunks, so pagination has something to page through.
  const paragraphs = Array.from(
    { length: 20 },
    (_, i) => `Paragraph ${String(i)} about the quarterly cooling budget review.`,
  ).join('\n\n');
  await indexFile(
    ctx.db,
    { id: fileId, projectId, mimeType: 'text/plain', filename: 'notes.txt' },
    Buffer.from(paragraphs),
  );
});

afterAll(async () => {
  await ctx.close();
});

function executor(pid = projectId, maxChars = 6000): ProjectToolExecutor {
  return new ProjectToolExecutor(ctx.db, new LexicalRetriever(), pid, maxChars);
}

describe('ProjectToolExecutor.search_project_files', () => {
  it('finds an indexed chunk by keyword, as structured json', async () => {
    const result = await executor().execute(
      { id: 'call-1', name: 'search_project_files', input: { query: 'cooling budget' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    const data = jsonContent(result.content) as { results: Array<{ fileId: string; text: string }> };
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]!.fileId).toBe(fileId);
    expect(data.results[0]!.text).toContain('cooling budget');
  });

  it('honours the limit argument', async () => {
    const result = await executor().execute(
      { id: 'call-1b', name: 'search_project_files', input: { query: 'paragraph cooling', limit: 2 } },
      new AbortController().signal,
    );
    const data = jsonContent(result.content) as { results: unknown[] };
    expect(data.results.length).toBeLessThanOrEqual(2);
  });

  it('reports no match as explicit text, not an empty structure', async () => {
    const result = await executor().execute(
      { id: 'call-2', name: 'search_project_files', input: { query: 'spacecraft telemetry' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'No matching excerpts were found for that query.' },
    ]);
  });

  it('rejects a missing query rather than throwing', async () => {
    const result = await executor().execute(
      { id: 'call-3', name: 'search_project_files', input: {} },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('Invalid input');
  });

  it('only searches the current project', async () => {
    const otherUser = await signUp(ctx, 'Other');
    const otherProject = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: otherUser.cookie },
      payload: { title: 'Other project' },
    });
    const otherProjectId = (otherProject.json() as { id: string }).id;
    const result = await executor(otherProjectId).execute(
      { id: 'call-1c', name: 'search_project_files', input: { query: 'cooling budget' } },
      new AbortController().signal,
    );
    expect(result.content).toEqual([
      { type: 'text', text: 'No matching excerpts were found for that query.' },
    ]);
  });
});

describe('ProjectToolExecutor.read_project_file', () => {
  it('returns ordered content and reports truncation with a hard char cap', async () => {
    const result = await executor(projectId, 50).execute(
      { id: 'call-4', name: 'read_project_file', input: { fileId } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    const data = jsonContent(result.content) as {
      filename: string;
      content: string;
      truncated: boolean;
      nextCursor: number | null;
    };
    expect(data.filename).toBe('notes.txt');
    expect(data.content.length).toBeLessThanOrEqual(50);
    expect(data.truncated).toBe(true);
    expect(data.nextCursor).not.toBeNull();
  });

  it('resumes from the cursor returned by a previous call', async () => {
    const first = jsonContent(
      (
        await executor(projectId, 50).execute(
          { id: 'call-5a', name: 'read_project_file', input: { fileId } },
          new AbortController().signal,
        )
      ).content,
    ) as { content: string; nextCursor: number };

    const second = jsonContent(
      (
        await executor(projectId, 50).execute(
          { id: 'call-5b', name: 'read_project_file', input: { fileId, cursor: first.nextCursor } },
          new AbortController().signal,
        )
      ).content,
    ) as { content: string };

    expect(second.content).not.toBe(first.content);
  });

  it('never exceeds the server hard cap even if maxChars asks for more', async () => {
    const result = await executor(projectId, 50).execute(
      { id: 'call-6', name: 'read_project_file', input: { fileId, maxChars: 1_000_000 } },
      new AbortController().signal,
    );
    const data = jsonContent(result.content) as { content: string };
    expect(data.content.length).toBeLessThanOrEqual(50);
  });

  it('reports no further content once the file is exhausted', async () => {
    let cursor: number | undefined;
    let lastTruncated = true;
    for (let i = 0; i < 50 && lastTruncated; i += 1) {
      const data = jsonContent(
        (
          await executor(projectId, 6000).execute(
            { id: `call-7-${String(i)}`, name: 'read_project_file', input: { fileId, cursor } },
            new AbortController().signal,
          )
        ).content,
      ) as { truncated: boolean; nextCursor: number | null };
      lastTruncated = data.truncated;
      cursor = data.nextCursor ?? undefined;
    }
    expect(lastTruncated).toBe(false);
  });

  it('refuses a file id from a different project', async () => {
    const otherUser = await signUp(ctx, 'Other2');
    const otherProject = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: otherUser.cookie },
      payload: { title: 'Other project 2' },
    });
    const otherProjectId = (otherProject.json() as { id: string }).id;
    const result = await executor(otherProjectId).execute(
      { id: 'call-8', name: 'read_project_file', input: { fileId } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('No indexed file');
  });

  it('rejects an invalid fileId without throwing', async () => {
    const result = await executor().execute(
      { id: 'call-9', name: 'read_project_file', input: { fileId: 'not-a-uuid' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
  });
});

describe('ProjectToolExecutor unknown tool', () => {
  it('returns an explicit failed result without throwing', async () => {
    const result = await executor().execute(
      { id: 'call-10', name: 'delete_everything', input: {} },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'Unknown tool "delete_everything".' }]);
  });
});

describe('ProjectToolExecutor abort', () => {
  it('refuses to execute when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await executor().execute(
      { id: 'call-11', name: 'search_project_files', input: { query: 'cooling' } },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('aborted');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/tools/executor.integration.test.ts`
Expected: FAIL — `./executor.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Executes the tools a provider is allowed to call for one request.
 *
 * Scoped to a single project: constructed fresh per generate call, never shared across
 * requests. Every branch returns a `ToolResult` — it never throws — because a bad tool name or a
 * bad input is something the *model* needs to see and react to (Invariant 1). `read_project_file`
 * enforces `readMaxChars` server-side regardless of what the model asks for, so an oversized
 * document is never handed over whole.
 *
 * Abort handling is honest about its limits: a single Postgres query issued through this
 * executor cannot be interrupted mid-flight by this code, so the signal is checked at entry
 * (refuse to start a new query) rather than claimed to cancel work already in flight.
 */
import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { fileChunks, projectFiles } from '../db/schema.js';
import type { ToolCall, ToolContent, ToolExecutor, ToolResult } from '../providers/types.js';
import type { Retriever } from '../services/retrieval.js';

const searchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
});

const readInput = z.object({
  fileId: z.string().uuid(),
  cursor: z.number().int().min(0).optional(),
  maxChars: z.number().int().min(1).optional(),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown): ToolResult {
  return { toolCallId, ok: true, content: [{ type: 'json', data }] };
}

export class ProjectToolExecutor implements ToolExecutor {
  constructor(
    private readonly db: Database,
    private readonly retriever: Retriever,
    private readonly projectId: string,
    private readonly readMaxChars: number,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }
    switch (call.name) {
      case 'search_project_files':
        return this.searchProjectFiles(call);
      case 'read_project_file':
        return this.readProjectFile(call);
      default:
        return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }
  }

  private async searchProjectFiles(call: ToolCall): Promise<ToolResult> {
    const parsed = searchInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }
    const chunks = await this.retriever.search(
      this.db,
      this.projectId,
      parsed.data.query,
      parsed.data.limit ?? 5,
    );
    if (chunks.length === 0) {
      return textResult(call.id, true, 'No matching excerpts were found for that query.');
    }
    return jsonResult(call.id, {
      results: chunks.map((c) => ({
        fileId: c.fileId,
        filename: c.filename,
        page: c.page,
        score: c.score,
        text: c.text,
      })),
    });
  }

  private async readProjectFile(call: ToolCall): Promise<ToolResult> {
    const parsed = readInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }
    const cursor = parsed.data.cursor ?? 0;
    const budget = Math.min(parsed.data.maxChars ?? this.readMaxChars, this.readMaxChars);

    const rows = await this.db
      .select({ text: fileChunks.text, ordinal: fileChunks.ordinal, filename: projectFiles.filename })
      .from(fileChunks)
      .innerJoin(projectFiles, eq(fileChunks.projectFileId, projectFiles.id))
      .where(
        and(
          eq(fileChunks.projectFileId, parsed.data.fileId),
          eq(fileChunks.projectId, this.projectId),
          gte(fileChunks.ordinal, cursor),
        ),
      )
      .orderBy(asc(fileChunks.ordinal));

    if (rows.length === 0) {
      return textResult(
        call.id,
        false,
        `No indexed file with id "${parsed.data.fileId}" exists in this project, or the cursor ` +
          'is past its last chunk.',
      );
    }

    const parts: string[] = [];
    let used = 0;
    let lastOrdinal = cursor - 1;
    let truncated = false;
    for (const row of rows) {
      if (used > 0 && used + row.text.length > budget) {
        truncated = true;
        break;
      }
      parts.push(row.text);
      used += row.text.length;
      lastOrdinal = row.ordinal;
      if (used >= budget) {
        truncated = lastOrdinal < rows[rows.length - 1]!.ordinal;
        break;
      }
    }

    return jsonResult(call.id, {
      filename: rows[0]!.filename,
      content: parts.join('\n\n'),
      truncated,
      nextCursor: truncated ? lastOrdinal + 1 : null,
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/tools/executor.integration.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tools/executor.ts backend/src/tools/executor.integration.test.ts
git commit -m "feat(tools): add ProjectToolExecutor with bounded paginated reads and abort checks"
```

---

### Task 6: Injectable SDK-client seam on both adapters

This is new relative to the prior plan and exists solely to make Task 9/12's adapter-loop tests
possible without ever calling real Vertex. Neither adapter's `getClient()` currently accepts an
override — both lazily construct the real SDK client from `Config` the first time it's needed.

**Files:**
- Modify: `backend/src/providers/gemini.ts`
- Modify: `backend/src/providers/anthropicVertex.ts`

**Interfaces:**
- Produces: `GeminiProvider`'s constructor gains an optional second parameter,
  `client?: Pick<GoogleGenAI, 'models'>`; `AnthropicVertexProvider`'s constructor gains an
  optional second parameter, `client?: Pick<AnthropicVertex, 'messages'>`. Both remain
  backward-compatible — every existing call site passes only `cfg` and is unaffected.

- [ ] **Step 1: Gemini seam**

In `backend/src/providers/gemini.ts`, change the class fields and constructor:

```typescript
export class GeminiProvider implements Provider {
  readonly name = 'google';
  private client: Pick<GoogleGenAI, 'models'> | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly injectedClient?: Pick<GoogleGenAI, 'models'>,
  ) {}
```

and change `getClient()`'s body to prefer the injected client:

```typescript
  private getClient(): Pick<GoogleGenAI, 'models'> {
    if (this.injectedClient) return this.injectedClient;
    if (!this.client) {
      if (!this.cfg.GOOGLE_CLOUD_PROJECT) {
        throw new ProviderError('GOOGLE_CLOUD_PROJECT is not set', { code: 'model_unavailable' });
      }
      this.client = new GoogleGenAI({
        vertexai: true,
        project: this.cfg.GOOGLE_CLOUD_PROJECT,
        location: this.cfg.geminiLocation,
      });
    }
    return this.client;
  }
```

Every call site inside the class already calls `this.getClient().models....` — nothing else
changes. `Pick<GoogleGenAI, 'models'>` is the return type because that's the only surface any
method on this class touches; a test's fake object needs to satisfy only that shape.

- [ ] **Step 2: Anthropic seam**

In `backend/src/providers/anthropicVertex.ts`, the same shape:

```typescript
export class AnthropicVertexProvider implements Provider {
  readonly name = 'anthropic';
  private client: Pick<AnthropicVertex, 'messages'> | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly injectedClient?: Pick<AnthropicVertex, 'messages'>,
  ) {}

  supportsGrounding(): boolean {
    return this.cfg.ENABLE_ANTHROPIC_WEB_SEARCH;
  }

  private getClient(): Pick<AnthropicVertex, 'messages'> {
    if (this.injectedClient) return this.injectedClient;
    if (!this.client) {
      if (!this.cfg.GOOGLE_CLOUD_PROJECT) {
        throw new ProviderError('GOOGLE_CLOUD_PROJECT is not set', { code: 'model_unavailable' });
      }
      this.client = new AnthropicVertex({
        projectId: this.cfg.GOOGLE_CLOUD_PROJECT,
        region: this.cfg.VERTEX_LOCATION,
        timeout: this.cfg.PROVIDER_TIMEOUT_MS,
        maxRetries: 0,
      });
    }
    return this.client;
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean — no call site outside the class touches the constructor's second argument, so
every existing `new GeminiProvider(cfg)` / `new AnthropicVertexProvider(cfg)` still compiles.

- [ ] **Step 4: Commit**

```bash
git add backend/src/providers/gemini.ts backend/src/providers/anthropicVertex.ts
git commit -m "feat(tools): add injectable SDK-client seam to both adapters for testing"
```

---

### Task 7: Gemini adapter — bounded, sequential tool loop

**Files:**
- Modify: `backend/src/providers/gemini.ts`
- Modify: `backend/src/providers/gemini.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`/`ToolCall`/`ToolResult` (Task 1), `request.tools`/`request.toolExecutor`,
  `this.cfg.TOOL_MAX_ROUNDS`.
- Produces: `toGeminiFunctionDeclaration(def): FunctionDeclaration`,
  `toGeminiFunctionResponsePart(name, id, result): Part` — both exported for their unit tests.
  `GeminiProvider.stream()` loops when `request.tools` is non-empty.

**Verified against the installed SDK** (`node_modules/@google/genai/dist/genai.d.ts`):
`FunctionDeclaration.parametersJsonSchema?: unknown` is documented as plain JSON Schema, mutually
exclusive with the typed `parameters: Schema` field that `@google/genai` rewrites in place —
use `parametersJsonSchema` to sidestep that mutation risk entirely. `FunctionResponse.response`
is `Record<string, unknown>`, using `"output"` for success and `"error"` for failure. The
accumulated per-chunk response exposes `functionCalls: FunctionCall[] | undefined` directly.

- [ ] **Step 1: Write the failing serialisation-helper tests**

Add to `backend/src/providers/gemini.test.ts`:

```typescript
import { toGeminiFunctionDeclaration, toGeminiFunctionResponsePart } from './gemini.js';

describe('toGeminiFunctionDeclaration', () => {
  it('maps name/description and uses parametersJsonSchema, not parameters', () => {
    const decl = toGeminiFunctionDeclaration({
      name: 'search_project_files',
      description: 'Lexical keyword search.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    });
    expect(decl).toEqual({
      name: 'search_project_files',
      description: 'Lexical keyword search.',
      parametersJsonSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    });
  });

  it('deep-clones the input schema so the SDK cannot mutate the shared ToolDefinition', () => {
    const original = { type: 'object', properties: { query: { type: 'string' } } };
    const decl = toGeminiFunctionDeclaration({ name: 'x', description: 'x', inputSchema: original });
    (decl.parametersJsonSchema as Record<string, unknown>)['type'] = 'MUTATED';
    expect(original['type']).toBe('object');
  });
});

describe('toGeminiFunctionResponsePart', () => {
  it('wraps a successful structured result under "output"', () => {
    const part = toGeminiFunctionResponsePart('search_project_files', 'call-1', {
      toolCallId: 'call-1',
      ok: true,
      content: [{ type: 'json', data: { results: [] } }],
    });
    expect(part).toEqual({
      functionResponse: {
        id: 'call-1',
        name: 'search_project_files',
        response: { output: { results: [] } },
      },
    });
  });

  it('wraps a failed result under "error" as a string', () => {
    const part = toGeminiFunctionResponsePart('read_project_file', 'call-2', {
      toolCallId: 'call-2',
      ok: false,
      content: [{ type: 'text', text: 'No indexed file with that id.' }],
    });
    expect(part).toEqual({
      functionResponse: {
        id: 'call-2',
        name: 'read_project_file',
        response: { error: 'No indexed file with that id.' },
      },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/providers/gemini.test.ts`
Expected: FAIL — neither helper is exported yet.

- [ ] **Step 3: Implement the helpers**

Add to `backend/src/providers/gemini.ts`, near `attachmentParts`:

```typescript
/**
 * `parametersJsonSchema` (not `parameters`) deliberately — the typed `parameters: Schema` field
 * is what `@google/genai` rewrites in place (uppercasing every `type` value), and doing that to
 * a `ToolDefinition` shared with the Anthropic adapter would corrupt whichever adapter runs
 * second. `parametersJsonSchema` accepts plain JSON Schema and is documented as mutually
 * exclusive with `parameters`, so this sidesteps the mutation risk instead of cloning around it.
 */
export function toGeminiFunctionDeclaration(def: ToolDefinition): FunctionDeclaration {
  return {
    name: def.name,
    description: def.description,
    parametersJsonSchema: structuredClone(def.inputSchema),
  };
}

/**
 * Flattens a provider-neutral `ToolResult` into Gemini's `functionResponse` shape. A `json`
 * content block goes straight into `response.output`/`response.error`; a `text` block is passed
 * through as a string in the same slot — Gemini does not require the response value to be an
 * object shape beyond `Record<string, unknown>`'s outer wrapper.
 */
export function toGeminiFunctionResponsePart(name: string, id: string, result: ToolResult): Part {
  const block = result.content[0];
  const value = block === undefined ? '' : block.type === 'json' ? block.data : block.text;
  return {
    functionResponse: {
      id,
      name,
      response: result.ok ? { output: value } : { error: value },
    },
  };
}
```

Add `ToolDefinition`, `ToolResult` to the existing type-only import from `./types.js`, and
`FunctionDeclaration` to the existing `@google/genai` type import.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/providers/gemini.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `stream()` to loop, one tool call per round**

Replace `stream()`'s body:

```typescript
  async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    const grounded = request.grounded && this.supportsGrounding();
    const codeExecution = request.codeExecution && this.supportsCodeExecution();
    const toolDefs = request.tools ?? [];
    const useTools = toolDefs.length > 0 && Boolean(request.toolExecutor);

    if (grounded) {
      yield {
        type: 'progress',
        stage: 'searching',
        label: 'Querying Google Search',
        detail: 'Grounding is enabled; the model is issuing search queries.',
      };
    }

    let usage = EMPTY_USAGE;
    let finishReason = 'stop';
    let lastMetadata: GeminiGroundingMetadata | undefined;
    const accumulated: string[] = [];
    let contents = buildGeminiContents(request);
    const maxRounds = useTools ? Math.max(1, this.cfg.TOOL_MAX_ROUNDS) : 1;

    try {
      roundLoop: for (let round = 0; round < maxRounds; round += 1) {
        const stream = await this.getClient().models.generateContentStream({
          model: request.providerModelId,
          contents,
          config: {
            ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
            maxOutputTokens: request.maxOutputTokens,
            ...(grounded || codeExecution || useTools
              ? {
                  tools: [
                    ...(grounded ? [{ googleSearch: {} }] : []),
                    ...(codeExecution ? [{ codeExecution: {} }] : []),
                    ...(useTools
                      ? [{ functionDeclarations: toolDefs.map(toGeminiFunctionDeclaration) }]
                      : []),
                  ],
                }
              : {}),
            abortSignal: request.signal,
            httpOptions: { timeout: this.cfg.PROVIDER_TIMEOUT_MS },
          },
        });

        let roundText = '';
        const roundCalls: { id?: string; name: string; args: Record<string, unknown> }[] = [];

        for await (const chunk of stream) {
          if (request.signal.aborted) break roundLoop;

          const text = chunk.text;
          if (text) {
            accumulated.push(text);
            roundText += text;
            yield { type: 'delta', text };
          }

          if (codeExecution && (chunk.executableCode || chunk.codeExecutionResult)) {
            yield {
              type: 'code',
              ...(chunk.executableCode ? { code: chunk.executableCode } : {}),
              ...(chunk.codeExecutionResult ? { output: chunk.codeExecutionResult } : {}),
            };
          }

          for (const fc of chunk.functionCalls ?? []) {
            if (fc.name) roundCalls.push({ ...(fc.id ? { id: fc.id } : {}), name: fc.name, args: fc.args ?? {} });
          }

          const chunkUsage = usageFrom(chunk.usageMetadata);
          if (chunkUsage.exact) usage = chunkUsage;

          for (const candidate of chunk.candidates ?? []) {
            if (candidate.groundingMetadata) {
              lastMetadata = candidate.groundingMetadata as GeminiGroundingMetadata;
            }
            if (candidate.finishReason) finishReason = String(candidate.finishReason);
          }
        }

        if (!useTools || roundCalls.length === 0) break;

        const modelParts: Part[] = [];
        if (roundText) modelParts.push({ text: roundText });
        for (const c of roundCalls) {
          modelParts.push({ functionCall: { ...(c.id ? { id: c.id } : {}), name: c.name, args: c.args } });
        }
        contents = [...contents, { role: 'model', parts: modelParts }];

        // Phase 1 executes exactly one ArcNave tool per round, matching Anthropic's
        // disable_parallel_tool_use semantics. If Gemini returns more than one functionCall in
        // a single response, only the first is run; the rest get an explicit deferred failure
        // so the conversation is never left with an orphaned call — the model can re-request an
        // extra call on a later round instead.
        const [primary, ...deferred] = roundCalls;
        const responseParts: Part[] = [];

        if (primary) {
          const call = {
            id: primary.id ?? `${primary.name}-${String(round)}-0`,
            name: primary.name,
            input: primary.args,
          };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          responseParts.push(toGeminiFunctionResponsePart(call.name, call.id, result));
        }
        for (const [i, extra] of deferred.entries()) {
          const id = extra.id ?? `${extra.name}-${String(round)}-${String(i + 1)}`;
          const deferredResult: ToolResult = {
            toolCallId: id,
            ok: false,
            content: [
              {
                type: 'text',
                text: 'Only one tool call is processed per round in this phase; call again on ' +
                  'the next round if this is still needed.',
              },
            ],
          };
          responseParts.push(toGeminiFunctionResponsePart(extra.name, id, deferredResult));
        }
        contents = [...contents, { role: 'user', parts: responseParts }];

        if (round === maxRounds - 1) finishReason = 'tool_limit';
      }
    } catch (err) {
      if (isAbort(err) || request.signal.aborted) throw err;
      if (isNotFound(err)) {
        throw new ModelNotFoundError(request.providerModelId, this.cfg.geminiLocation);
      }
      throw new ProviderError(`Gemini request failed: ${String(err)}`, {
        retryable: isRetryable(err),
      });
    }

    if (grounded && !request.signal.aborted) {
      const { sources, queries, searchEntryPoint } = await sourcesFromGeminiMetadata(
        lastMetadata,
        accumulated.join(''),
        this.cfg.GROUNDING_REDIRECT_TIMEOUT_MS,
      );

      if (queries.length > 0) {
        yield {
          type: 'progress',
          stage: 'reading',
          label: `Ran ${queries.length} search ${queries.length === 1 ? 'query' : 'queries'}`,
          detail: queries.slice(0, 5).join('; '),
        };
      }

      if (sources.length > 0) {
        yield {
          type: 'sources',
          sources,
          ...(searchEntryPoint ? { searchEntryPoint } : {}),
        };
        const unresolved = sources.filter((s) => !s.urlResolved).length;
        yield {
          type: 'progress',
          stage: 'synthesizing',
          label: `Grounded in ${sources.length} source${sources.length === 1 ? '' : 's'}`,
          detail: unresolved
            ? `${unresolved} source URL(s) could not be resolved past the Vertex redirect.`
            : 'All source URLs resolved to their original pages.',
        };
      } else {
        yield {
          type: 'progress',
          stage: 'partial',
          label: 'No sources returned',
          detail: 'Grounding was enabled but the model returned no grounding metadata.',
        };
      }
    }

    yield { type: 'completed', usage, finishReason };
  }
```

The `roundLoop:` label lets the inner `for await` chunk loop `break` all the way out on abort,
matching the existing single-call code's behaviour one loop level deeper.

- [ ] **Step 6: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/providers/gemini.ts backend/src/providers/gemini.test.ts
git commit -m "feat(tools): give the Gemini adapter a bounded, sequential tool-calling loop"
```

---

### Task 8: Gemini adapter-loop tests (fake SDK client boundary)

This is the required new test tier (revision point 11) — it proves the actual
`SDK response → tool detection → execution → response-continuation` cycle, which no
`FakeProvider` test can reach.

**Files:**
- Create: `backend/src/providers/gemini.adapter-loop.test.ts`

**Interfaces:**
- Consumes: `GeminiProvider` (Task 6's injected-client constructor, Task 7's loop),
  `ToolExecutor`/`ToolCall`/`ToolResult` (Task 1).

- [ ] **Step 1: Write the fake SDK client and the tests**

```typescript
/**
 * Adapter-loop tests at the Gemini SDK-client boundary.
 *
 * `FakeGeminiClient` stands in for `GoogleGenAI` itself — it is injected via `GeminiProvider`'s
 * second constructor argument (Task 6) and returns a scripted sequence of chunk streams, one per
 * round, so this test proves the loop actually detects a `functionCall`, invokes the
 * `ToolExecutor`, builds a `functionResponse`, and sends the next request — not just that
 * `ProviderEvent`s get relayed once already produced.
 */
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import type { ToolCall, ToolExecutor, ToolResult } from './types.js';
import { GeminiProvider } from './gemini.js';
import type { GenerationRequest } from './types.js';

interface FakeChunk {
  text?: string;
  functionCalls?: { id?: string; name: string; args?: Record<string, unknown> }[];
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  candidates?: { finishReason?: string }[];
}

function fakeStream(chunks: FakeChunk[]): AsyncIterable<FakeChunk> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++]!, done: false } : { value: undefined, done: true }),
      };
    },
  };
}

class FakeGeminiClient {
  calls: unknown[] = [];
  responses: AsyncIterable<FakeChunk>[] = [];
  models = {
    generateContentStream: vi.fn(async (req: unknown) => {
      this.calls.push(req);
      const next = this.responses.shift();
      if (!next) throw new Error('FakeGeminiClient: no scripted response left');
      return next;
    }),
  };
}

class ScriptedExecutor implements ToolExecutor {
  calls: ToolCall[] = [];
  results = new Map<string, ToolResult>();
  async execute(call: ToolCall): Promise<ToolResult> {
    this.calls.push(call);
    return (
      this.results.get(call.name) ?? {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: `no scripted result for ${call.name}` }],
      }
    );
  }
}

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'What was the cooling budget?',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: 'gemini-3.8-flash',
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const SEARCH_TOOL = {
  name: 'search_project_files',
  description: 'Lexical keyword search.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};
const READ_TOOL = {
  name: 'read_project_file',
  description: 'Reads a file.',
  inputSchema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] },
};

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('GeminiProvider tool-calling loop', () => {
  it('runs search then read, then emits final text', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'search_project_files', args: { query: 'cooling' } }] }]),
      fakeStream([{ functionCalls: [{ id: 'c2', name: 'read_project_file', args: { fileId: 'f1' } }] }]),
      fakeStream([
        { text: 'The cooling budget was approved in March.' },
        { usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 }, candidates: [{ finishReason: 'STOP' }] },
      ]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 'c1',
      ok: true,
      content: [{ type: 'json', data: { results: [{ fileId: 'f1' }] } }],
    });
    executor.results.set('read_project_file', {
      toolCallId: 'c2',
      ok: true,
      content: [{ type: 'json', data: { content: 'Approved in March.' } }],
    });

    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(
      provider.stream(
        baseRequest({ tools: [SEARCH_TOOL, READ_TOOL], toolExecutor: executor }),
      ),
    );

    expect(executor.calls.map((c) => c.name)).toEqual(['search_project_files', 'read_project_file']);
    expect(executor.calls[1]!.input).toEqual({ fileId: 'f1' });
    expect(client.calls).toHaveLength(3);
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(2);
    expect(events.some((e) => e.type === 'delta' && e.text.includes('March'))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'STOP' });
  });

  it('feeds a tool failure back to the model rather than throwing', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'search_project_files', args: {} }] }]),
      fakeStream([{ text: 'I could not find that.' }, { candidates: [{ finishReason: 'STOP' }] }]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 'c1',
      ok: false,
      content: [{ type: 'text', text: 'Invalid input: query is required' }],
    });
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ type: 'tool_result', result: { ok: false } });
    // The second call's request must carry the failed functionResponse under "error".
    const secondReq = client.calls[1] as { contents: { role: string; parts: unknown[] }[] };
    const lastContent = secondReq.contents.at(-1)!;
    expect(lastContent.parts[0]).toMatchObject({
      functionResponse: { response: { error: 'Invalid input: query is required' } },
    });
  });

  it('feeds an unknown-tool failure back without throwing', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'delete_everything', args: {} }] }]),
      fakeStream([{ text: 'Done.' }, { candidates: [{ finishReason: 'STOP' }] }]),
    ];
    const executor = new ScriptedExecutor();
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(events.some((e) => e.type === 'tool_result' && !e.result.ok)).toBe(true);
  });

  it('defers extra function calls in the same round rather than running them all', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([
        {
          functionCalls: [
            { id: 'c1', name: 'search_project_files', args: { query: 'a' } },
            { id: 'c2', name: 'search_project_files', args: { query: 'b' } },
          ],
        },
      ]),
      fakeStream([{ text: 'ok' }, { candidates: [{ finishReason: 'STOP' }] }]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 'c1',
      ok: true,
      content: [{ type: 'json', data: {} }],
    });
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })));

    // Only the first call is actually executed...
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]!.id).toBe('c1');
    // ...but the second request still carries a functionResponse for c2, so Gemini never sees an
    // orphaned function call.
    const secondReq = client.calls[1] as { contents: { role: string; parts: unknown[] }[] };
    const responseParts = secondReq.contents.at(-1)!.parts as { functionResponse: { id: string } }[];
    expect(responseParts.map((p) => p.functionResponse.id)).toEqual(['c1', 'c2']);
  });

  it('stops at TOOL_MAX_ROUNDS with finishReason "tool_limit", never a hang or a throw', async () => {
    const client = new FakeGeminiClient();
    // Every round returns another function call, so the loop never naturally terminates.
    client.responses = Array.from({ length: 2 }, (_, i) =>
      fakeStream([{ functionCalls: [{ id: `c${String(i)}`, name: 'search_project_files', args: {} }] }]),
    );
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', { toolCallId: 'x', ok: true, content: [{ type: 'text', text: 'ok' }] });
    const cfg = loadConfig({ NODE_ENV: 'test', TOOL_MAX_ROUNDS: '2' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(client.calls).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'tool_limit' });
  });

  it('stops issuing provider requests once the signal is aborted', async () => {
    const client = new FakeGeminiClient();
    const controller = new AbortController();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'search_project_files', args: {} }] }]),
    ];
    const executor: ToolExecutor = {
      execute: async () => {
        controller.abort();
        return { toolCallId: 'c1', ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
    };
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    await expect(
      collect(
        provider.stream(
          baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor, signal: controller.signal }),
        ),
      ),
    ).rejects.toThrow();
    expect(client.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run**

Run: `cd backend && npx vitest run src/providers/gemini.adapter-loop.test.ts`
Expected: PASS, all 7 cases. If any assertion about the SDK's exact request/response shape fails
because the installed `@google/genai` version disagrees with what Task 7 assumed, fix Task 7's
implementation to match the real SDK behaviour (not the test) and add an entry to `mistakes.md`
(Task 14) — the `.d.ts` inspection this plan is based on is not a substitute for this test.

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/providers/gemini.adapter-loop.test.ts
git commit -m "test(tools): add Gemini adapter-loop tests at the fake SDK-client boundary"
```

---

### Task 9: Anthropic adapter — bounded, sequential tool loop

**Files:**
- Modify: `backend/src/providers/anthropicVertex.ts`
- Modify: `backend/src/providers/anthropicVertex.test.ts`

**Interfaces:**
- Produces: `toAnthropicTool(def): Anthropic.Tool`, `toAnthropicToolResultBlock(id, result): Anthropic.ToolResultBlockParam` — both exported for their unit tests. `AnthropicVertexProvider.stream()` loops when `request.tools` is non-empty, with `disable_parallel_tool_use: true`.

**Verified against the installed SDK** (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`):
`Anthropic.Tool` is `{ name; description; input_schema; ... }`; `Anthropic.ToolUseBlock` is
`{ id; name; input: unknown; type: 'tool_use' }`; `Anthropic.ToolResultBlockParam` is
`{ tool_use_id; type: 'tool_result'; content?; is_error? }`; `ToolChoiceAuto` carries
`disable_parallel_tool_use?: boolean`. `disable_parallel_tool_use: true` is set deliberately —
Claude emits parallel `tool_use` blocks by default, and Phase 1's one-call-per-round policy
(matching Gemini, see Task 7) means the loop should never need to handle more than one.

- [ ] **Step 1: Write the failing serialisation-helper tests**

Add to `backend/src/providers/anthropicVertex.test.ts`:

```typescript
import { toAnthropicTool, toAnthropicToolResultBlock } from './anthropicVertex.js';

describe('toAnthropicTool', () => {
  it('maps name/description/input_schema', () => {
    const tool = toAnthropicTool({
      name: 'search_project_files',
      description: 'Lexical keyword search.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    });
    expect(tool).toEqual({
      name: 'search_project_files',
      description: 'Lexical keyword search.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    });
  });

  it('deep-clones the input schema', () => {
    const original = { type: 'object', properties: { query: { type: 'string' } } };
    const tool = toAnthropicTool({ name: 'x', description: 'x', inputSchema: original });
    (tool.input_schema as Record<string, unknown>)['type'] = 'MUTATED';
    expect(original['type']).toBe('object');
  });
});

describe('toAnthropicToolResultBlock', () => {
  it('serialises a successful structured result as JSON text, is_error unset', () => {
    const block = toAnthropicToolResultBlock('call-1', {
      toolCallId: 'call-1',
      ok: true,
      content: [{ type: 'json', data: { results: [] } }],
    });
    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'call-1',
      content: JSON.stringify({ results: [] }),
      is_error: false,
    });
  });

  it('serialises a failed result as plain text with is_error true', () => {
    const block = toAnthropicToolResultBlock('call-2', {
      toolCallId: 'call-2',
      ok: false,
      content: [{ type: 'text', text: 'No indexed file with that id.' }],
    });
    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'call-2',
      content: 'No indexed file with that id.',
      is_error: true,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/providers/anthropicVertex.test.ts`
Expected: FAIL — neither helper is exported yet.

- [ ] **Step 3: Implement the helpers**

Add near `WEB_SEARCH_TOOL`:

```typescript
export function toAnthropicTool(def: ToolDefinition): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: structuredClone(def.inputSchema) as Anthropic.Tool.InputSchema,
  };
}

/** A `json` block round-trips as a JSON string in `content` — Anthropic's tool_result content is
 *  text or a content-block array, never a structured object, so this is the one place a
 *  structured `ToolResult` becomes a string for this provider specifically. */
export function toAnthropicToolResultBlock(
  toolUseId: string,
  result: ToolResult,
): Anthropic.ToolResultBlockParam {
  const block = result.content[0];
  const content = block === undefined ? '' : block.type === 'json' ? JSON.stringify(block.data) : block.text;
  return { type: 'tool_result', tool_use_id: toolUseId, content, is_error: !result.ok };
}
```

Add `ToolDefinition`, `ToolResult` to the existing `./types.js` type import.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/providers/anthropicVertex.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `stream()` to loop**

```typescript
  async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    const grounded = request.grounded && this.supportsGrounding();
    const toolDefs = request.tools ?? [];
    const useTools = toolDefs.length > 0 && Boolean(request.toolExecutor);

    if (grounded) {
      yield {
        type: 'progress',
        stage: 'searching',
        label: 'Web search tool enabled',
        detail: 'Claude may issue searches; citations come from the results it returns.',
      };
    }

    let usage = EMPTY_USAGE;
    let finishReason = 'stop';
    const searchBlocks: SearchResultBlock[] = [];
    let messages = buildAnthropicMessages(request);
    const maxRounds = useTools ? Math.max(1, this.cfg.TOOL_MAX_ROUNDS) : 1;

    const tools = [
      ...(grounded ? [WEB_SEARCH_TOOL] : []),
      ...(useTools ? toolDefs.map(toAnthropicTool) : []),
    ];

    try {
      for (let round = 0; round < maxRounds; round += 1) {
        const stream = this.getClient().messages.stream(
          {
            model: request.providerModelId,
            max_tokens: request.maxOutputTokens,
            messages,
            ...(request.systemInstruction ? { system: request.systemInstruction } : {}),
            ...(tools.length > 0 ? { tools } : {}),
            ...(useTools ? { tool_choice: { type: 'auto', disable_parallel_tool_use: true } } : {}),
          },
          { signal: request.signal },
        );

        for await (const event of stream) {
          if (request.signal.aborted) break;
          switch (event.type) {
            case 'content_block_delta': {
              const delta = event.delta;
              if (delta.type === 'text_delta' && delta.text) {
                yield { type: 'delta', text: delta.text };
              }
              break;
            }
            case 'message_start':
              usage = merge(usage, usageFrom(event.message.usage as AnthropicUsage));
              break;
            case 'message_delta': {
              usage = merge(usage, usageFrom(event.usage as AnthropicUsage));
              if (event.delta.stop_reason) finishReason = String(event.delta.stop_reason);
              break;
            }
            case 'content_block_start':
              searchBlocks.push(...collectSearchResults(event.content_block));
              break;
            default:
              break;
          }
        }
        if (request.signal.aborted) break;

        const final = await stream.finalMessage();
        usage = merge(usage, usageFrom(final.usage as AnthropicUsage));
        if (final.stop_reason) finishReason = String(final.stop_reason);
        for (const block of final.content ?? []) searchBlocks.push(...collectSearchResults(block));

        const toolUseBlocks = (final.content ?? []).filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (!useTools || toolUseBlocks.length === 0) break;

        messages = [...messages, { role: 'assistant', content: final.content }];

        // disable_parallel_tool_use should make this length 1, but the request is honest about
        // what the SDK actually returned rather than assuming: only the first is executed,
        // matching Gemini's Task 7 policy exactly.
        const [primary, ...rest] = toolUseBlocks;
        const resultBlocks: Anthropic.ToolResultBlockParam[] = [];

        if (primary) {
          const call = { id: primary.id, name: primary.name, input: primary.input };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          resultBlocks.push(toAnthropicToolResultBlock(call.id, result));
        }
        for (const extra of rest) {
          resultBlocks.push(
            toAnthropicToolResultBlock(extra.id, {
              toolCallId: extra.id,
              ok: false,
              content: [
                {
                  type: 'text',
                  text: 'Only one tool call is processed per round in this phase; call again ' +
                    'on the next round if this is still needed.',
                },
              ],
            }),
          );
        }
        messages = [...messages, { role: 'user', content: resultBlocks }];

        if (round === maxRounds - 1) finishReason = 'tool_limit';
      }
    } catch (err) {
      if (isAbort(err) || request.signal.aborted) throw err;
      const status = statusOf(err);
      if (status === 404) {
        throw new ModelNotFoundError(request.providerModelId, this.cfg.VERTEX_LOCATION);
      }
      throw new ProviderError(`Claude request failed: ${String(err)}`, {
        retryable: status !== undefined && RETRYABLE_STATUS.has(status),
        ...(status !== undefined ? { statusCode: status } : {}),
      });
    }

    if (grounded && !request.signal.aborted) {
      const sources = sourcesFromAnthropicBlocks(searchBlocks);
      if (sources.length > 0) {
        yield { type: 'sources', sources };
        yield {
          type: 'progress',
          stage: 'synthesizing',
          label: `Cited ${sources.length} source${sources.length === 1 ? '' : 's'}`,
          detail: 'URLs come directly from the web search tool results.',
        };
      } else {
        yield {
          type: 'progress',
          stage: 'partial',
          label: 'No sources returned',
          detail: 'The web search tool was available but returned no results for this question.',
        };
      }
    }

    yield { type: 'completed', usage, finishReason };
  }
```

- [ ] **Step 6: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/providers/anthropicVertex.ts backend/src/providers/anthropicVertex.test.ts
git commit -m "feat(tools): give the Anthropic adapter a bounded, sequential tool-calling loop"
```

---

### Task 10: Anthropic adapter-loop tests (fake SDK client boundary)

**Files:**
- Create: `backend/src/providers/anthropicVertex.adapter-loop.test.ts`

**Interfaces:**
- Consumes: `AnthropicVertexProvider` (Task 6's injected-client constructor, Task 9's loop).

- [ ] **Step 1: Write the fake client and the tests**

```typescript
/**
 * Adapter-loop tests at the Anthropic SDK-client boundary. `FakeAnthropicClient` stands in for
 * `AnthropicVertex` (injected via Task 6's constructor seam) and returns a scripted sequence of
 * fake message streams, proving the loop actually detects `tool_use`, invokes the
 * `ToolExecutor`, builds a `tool_result` content block, and appends both the assistant and user
 * turns before the next `messages.stream` call.
 */
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { AnthropicVertexProvider } from './anthropicVertex.js';
import type { ToolCall, ToolExecutor, ToolResult } from './types.js';
import type { GenerationRequest } from './types.js';

interface FakeStreamEvent {
  type: string;
  delta?: { type: string; text?: string; stop_reason?: string };
  message?: { usage: Record<string, number> };
  usage?: Record<string, number>;
  content_block?: unknown;
}

interface FakeFinalMessage {
  content: { type: string; id?: string; name?: string; input?: unknown }[];
  usage: Record<string, number>;
  stop_reason: string;
}

function fakeMessageStream(events: FakeStreamEvent[], final: FakeFinalMessage) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => Promise.resolve(i < events.length ? { value: events[i++]!, done: false } : { value: undefined, done: true }),
      };
    },
    finalMessage: () => Promise.resolve(final),
  };
}

class FakeAnthropicClient {
  calls: unknown[] = [];
  responses: ReturnType<typeof fakeMessageStream>[] = [];
  messages = {
    stream: vi.fn((req: unknown) => {
      this.calls.push(req);
      const next = this.responses.shift();
      if (!next) throw new Error('FakeAnthropicClient: no scripted response left');
      return next;
    }),
  };
}

class ScriptedExecutor implements ToolExecutor {
  calls: ToolCall[] = [];
  results = new Map<string, ToolResult>();
  async execute(call: ToolCall): Promise<ToolResult> {
    this.calls.push(call);
    return (
      this.results.get(call.name) ?? {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: `no scripted result for ${call.name}` }],
      }
    );
  }
}

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'What was the cooling budget?',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: 'claude-sonnet-5',
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const SEARCH_TOOL = {
  name: 'search_project_files',
  description: 'Lexical keyword search.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};
const READ_TOOL = {
  name: 'read_project_file',
  description: 'Reads a file.',
  inputSchema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] },
};

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('AnthropicVertexProvider tool-calling loop', () => {
  it('sends disable_parallel_tool_use and runs search then read then final text', async () => {
    const client = new FakeAnthropicClient();
    client.responses = [
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't1', name: 'search_project_files', input: { query: 'cooling' } }],
        usage: { input_tokens: 20, output_tokens: 5 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't2', name: 'read_project_file', input: { fileId: 'f1' } }],
        usage: { input_tokens: 30, output_tokens: 5 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream(
        [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Approved in March.' } }],
        {
          content: [{ type: 'text' }],
          usage: { input_tokens: 40, output_tokens: 8 },
          stop_reason: 'end_turn',
        },
      ),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 't1',
      ok: true,
      content: [{ type: 'json', data: { results: [{ fileId: 'f1' }] } }],
    });
    executor.results.set('read_project_file', {
      toolCallId: 't2',
      ok: true,
      content: [{ type: 'json', data: { content: 'Approved in March.' } }],
    });

    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL, READ_TOOL], toolExecutor: executor })),
    );

    expect(executor.calls.map((c) => c.name)).toEqual(['search_project_files', 'read_project_file']);
    expect(client.calls).toHaveLength(3);
    const firstReq = client.calls[0] as { tool_choice: { disable_parallel_tool_use: boolean } };
    expect(firstReq.tool_choice.disable_parallel_tool_use).toBe(true);
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(2);
    expect(events.some((e) => e.type === 'delta' && e.text.includes('March'))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'end_turn' });

    // The user message following the assistant's tool_use must carry a tool_result block.
    const secondReq = client.calls[1] as { messages: { role: string; content: unknown }[] };
    const lastMsg = secondReq.messages.at(-1)!;
    expect(lastMsg.role).toBe('user');
    expect((lastMsg.content as { type: string }[])[0]!.type).toBe('tool_result');
  });

  it('feeds a tool failure back as an is_error tool_result, never throws', async () => {
    const client = new FakeAnthropicClient();
    client.responses = [
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't1', name: 'search_project_files', input: {} }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream([], { content: [{ type: 'text' }], usage: { input_tokens: 12, output_tokens: 3 }, stop_reason: 'end_turn' }),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 't1',
      ok: false,
      content: [{ type: 'text', text: 'Invalid input: query is required' }],
    });
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(events.some((e) => e.type === 'tool_result' && !e.result.ok)).toBe(true);
    const secondReq = client.calls[1] as { messages: { role: string; content: { is_error?: boolean }[] }[] };
    expect(secondReq.messages.at(-1)!.content[0]!.is_error).toBe(true);
  });

  it('feeds an unknown-tool failure back without throwing', async () => {
    const client = new FakeAnthropicClient();
    client.responses = [
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't1', name: 'delete_everything', input: {} }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream([], { content: [{ type: 'text' }], usage: { input_tokens: 12, output_tokens: 3 }, stop_reason: 'end_turn' }),
    ];
    const executor = new ScriptedExecutor();
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(events.some((e) => e.type === 'tool_result' && !e.result.ok)).toBe(true);
  });

  it('stops at TOOL_MAX_ROUNDS with finishReason "tool_limit"', async () => {
    const client = new FakeAnthropicClient();
    client.responses = Array.from({ length: 2 }, (_, i) =>
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: `t${String(i)}`, name: 'search_project_files', input: {} }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'tool_use',
      }),
    );
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', { toolCallId: 'x', ok: true, content: [{ type: 'text', text: 'ok' }] });
    const cfg = loadConfig({ NODE_ENV: 'test', TOOL_MAX_ROUNDS: '2' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(client.calls).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'tool_limit' });
  });

  it('stops issuing provider requests once the signal is aborted', async () => {
    const client = new FakeAnthropicClient();
    const controller = new AbortController();
    client.responses = [
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't1', name: 'search_project_files', input: {} }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'tool_use',
      }),
    ];
    const executor: ToolExecutor = {
      execute: async () => {
        controller.abort();
        return { toolCallId: 't1', ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
    };
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    await expect(
      collect(
        provider.stream(
          baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor, signal: controller.signal }),
        ),
      ),
    ).rejects.toThrow();
    expect(client.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run**

Run: `cd backend && npx vitest run src/providers/anthropicVertex.adapter-loop.test.ts`
Expected: PASS, all 5 cases. As in Task 8, if the installed SDK's real streaming/finalMessage
shape disagrees with what Task 9 assumed, fix Task 9 and log it in `mistakes.md` (Task 14).

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/providers/anthropicVertex.adapter-loop.test.ts
git commit -m "test(tools): add Anthropic adapter-loop tests at the fake SDK-client boundary"
```

---

### Task 11: `GenerationService` wiring — `ToolRegistry`, three-tier persistence

**Files:**
- Modify: `backend/src/services/generation.ts`
- Modify: `backend/src/routes/chats.ts` (SSE frame doc string)
- Modify: `backend/src/routes/chats.integration.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry`/`ProjectToolRegistry` (Task 4), `ProjectToolExecutor` (Task 5),
  `toolCalls` table (Task 3), `toolResultPreview` (Task 1), `cfg.ENABLE_TOOL_USE`/
  `cfg.READ_PROJECT_FILE_MAX_CHARS`/`cfg.TOOL_RESULT_PREVIEW_CHARS` (Task 2).
- Produces: `StreamEvent` gains `tool_use`/`tool_result` variants (the SSE `tool_result` carries
  only the short preview, never the full `ToolResult`).

- [ ] **Step 1: Write the failing test**

Add `import { eq } from 'drizzle-orm';` and `import { toolCalls } from '../db/schema.js';` to
`backend/src/routes/chats.integration.test.ts`'s existing import block, then add:

```typescript
describe('tool use', () => {
  it('streams tool_use/tool_result frames, persists the full result, and previews it on the wire', async () => {
    const project = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: auth(),
      payload: { title: 'Tooling fixture' },
    });
    const projectId = (project.json() as { id: string }).id;
    const chatId = await newChat({ ...auth() });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/chats/${chatId}`,
      headers: auth(),
      payload: { projectId },
    });

    const longText = 'x'.repeat(500);
    ctx.provider.script = [
      {
        type: 'tool_use',
        toolCallId: 'call-1',
        name: 'search_project_files',
        input: { query: 'x' },
      },
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        name: 'search_project_files',
        result: { toolCallId: 'call-1', ok: true, content: [{ type: 'text', text: longText }] },
      },
      { type: 'delta', text: 'Based on that, here is the answer.' },
      {
        type: 'completed',
        usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
        finishReason: 'stop',
      },
    ];

    const response = await generate(chatId);
    expect(response.statusCode).toBe(200);
    const frames = parseSse(response.body);

    const toolUse = frames.find((f) => f.event === 'tool_use');
    const toolResult = frames.find((f) => f.event === 'tool_result');
    expect(toolUse?.data['name']).toBe('search_project_files');
    // The wire preview is short — never the full 500-char result.
    expect((toolResult?.data['preview'] as string).length).toBeLessThanOrEqual(301);
    expect(toolResult?.data['ok']).toBe(true);

    const t = await transcript(chatId);
    const assistantMessageId = t.messages[t.messages.length - 1]!.id;
    const rows = await ctx.db.select().from(toolCalls).where(eq(toolCalls.messageId, assistantMessageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('search_project_files');
    expect(rows[0]!.ok).toBe(true);
    // The DB keeps the full result, not the wire preview.
    expect(rows[0]!.content).toEqual([{ type: 'text', text: longText }]);
    expect(rows[0]!.input).toEqual({ query: 'x' });
  });

  it('persists {} for input, never null, when a tool call carries no input', async () => {
    const project = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: auth(),
      payload: { title: 'Tooling fixture 2' },
    });
    const projectId = (project.json() as { id: string }).id;
    const chatId = await newChat({ ...auth() });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/chats/${chatId}`,
      headers: auth(),
      payload: { projectId },
    });

    ctx.provider.script = [
      { type: 'tool_use', toolCallId: 'call-1', name: 'search_project_files', input: undefined },
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        name: 'search_project_files',
        result: { toolCallId: 'call-1', ok: true, content: [{ type: 'text', text: 'ok' }] },
      },
      { type: 'delta', text: 'ok' },
      {
        type: 'completed',
        usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
        finishReason: 'stop',
      },
    ];
    const response = await generate(chatId);
    const t = await transcript(chatId);
    const assistantMessageId = t.messages[t.messages.length - 1]!.id;
    const rows = await ctx.db.select().from(toolCalls).where(eq(toolCalls.messageId, assistantMessageId));
    expect(response.statusCode).toBe(200);
    expect(rows[0]!.input).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/routes/chats.integration.test.ts -t "tool use"`
Expected: FAIL — `GenerationService` doesn't build `tools`/`toolExecutor` yet, and `StreamEvent`
has no `tool_use`/`tool_result` cases.

- [ ] **Step 3: Implement**

**3a. Imports** — in `backend/src/services/generation.ts`, add:

```typescript
import { toolCalls } from '../db/schema.js'; // add to the existing schema import list
import { ProjectToolRegistry } from '../tools/registry.js';
import { ProjectToolExecutor } from '../tools/executor.js';
import type { ToolResult } from '../providers/types.js';
import { toolResultPreview } from '../providers/types.js';
```

**3b. `StreamEvent`** — replace the union:

```typescript
export type StreamEvent =
  | { type: 'start'; messageId: string; chatId: string; requestId: string; model: ModelInfo }
  | { type: 'research'; event: { stage: string; label: string; detail: string; at: string } }
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: SourceDto[]; searchEntryPoint?: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; name: string; ok: boolean; preview: string }
  | { type: 'done'; questions: string[]; usage: UsageDto; finishReason: string }
  | { type: 'error'; code: string; title: string; detail: string; usage?: UsageDto };
```

**3c. Request construction** — in `run()`, immediately before `const request: GenerationRequest = {`,
insert:

```typescript
    const toolRegistry = new ProjectToolRegistry(this.cfg.ENABLE_TOOL_USE);
    const availableTools = toolRegistry.getAvailableTools({ projectId: project?.id ?? null });
    const toolExecutor =
      availableTools.length > 0
        ? new ProjectToolExecutor(this.db, this.retriever, project!.id, this.cfg.READ_PROJECT_FILE_MAX_CHARS)
        : undefined;
```

and inside the `request` object literal, add after `codeExecution,`:

```typescript
      ...(availableTools.length > 0 ? { tools: availableTools } : {}),
      ...(toolExecutor ? { toolExecutor } : {}),
```

**3d. Event handling** — add a local map alongside the other accumulators (near
`const collectedText: string[] = [];`):

```typescript
    const pendingToolInputs = new Map<string, unknown>();
```

Add two new `case`s to the `switch (event.type)`, between `'code'` and `'progress'`:

```typescript
          case 'tool_use': {
            pendingToolInputs.set(event.toolCallId, event.input);
            yield { type: 'tool_use', toolCallId: event.toolCallId, name: event.name, input: event.input };
            break;
          }

          case 'tool_result': {
            const preview = toolResultPreview(event.result, this.cfg.TOOL_RESULT_PREVIEW_CHARS);
            yield {
              type: 'tool_result',
              toolCallId: event.toolCallId,
              name: event.name,
              ok: event.result.ok,
              preview,
            };
            await this.persistToolCall(
              input.messageId,
              event.toolCallId,
              event.name,
              pendingToolInputs.get(event.toolCallId),
              event.result,
              eventOrdinal++,
            );
            break;
          }
```

**3e. Persistence** — add a new private method right after `persistEvent`:

```typescript
  /**
   * Persists the full bounded `ToolResult` the model actually received — not the SSE preview,
   * and never a further-truncated copy. `input` always becomes `{}` when the provider reported
   * none, so this insert can never contradict the column's `NOT NULL` constraint.
   */
  private async persistToolCall(
    messageId: string,
    toolCallId: string,
    name: string,
    input: unknown,
    result: ToolResult,
    ordinal: number,
  ): Promise<void> {
    await this.db
      .insert(toolCalls)
      .values({
        messageId,
        ordinal,
        toolCallId,
        name,
        input: input ?? {},
        content: result.content,
        ok: result.ok,
      })
      .onConflictDoNothing();
  }
```

**3f.** Update `backend/src/routes/chats.ts`'s generate route `description` string to:

```typescript
        description:
          'Returns text/event-stream. Frames: start, research, delta, sources, tool_use, ' +
          'tool_result, done, error.',
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/routes/chats.integration.test.ts -t "tool use"`
Expected: PASS, both cases.

- [ ] **Step 5: Full backend suite and typecheck**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean; every pre-existing test still passes, since `ENABLE_TOOL_USE` defaults to
`false` and `availableTools` is always `[]` unless a test explicitly sets the flag and a project.

- [ ] **Step 6: Regenerate the OpenAPI doc**

Run: `cd backend && npm run openapi`
Expected: `docs/openapi.json` changes only in the `/chats/{id}/generate` route's `description`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/generation.ts backend/src/routes/chats.ts backend/src/routes/chats.integration.test.ts docs/openapi.json
git commit -m "feat(tools): wire ToolRegistry and three-tier tool-result persistence into GenerationService"
```

---

### Task 12: Full backend verification

**Files:** none new.

- [ ] **Step 1: Run everything**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean; every test from before this phase still passes unchanged; all of Tasks 4, 5, 8,
10, 11's new tests pass.

- [ ] **Step 2: Regenerate OpenAPI once more for safety**

Run: `cd backend && npm run openapi`
Expected: no diff beyond Task 11's. Skip the commit entirely if `git status` shows no change.

---

### Task 13: Rollout checklist and live Vertex verification (blocked on the user)

Cannot be executed in an environment without `gcloud`/GCP credentials — same constraint already
on record in `docs/checkpoints/CURRENT.md`'s "Blocked on the user" section. Recorded here so it
is not silently skipped, and so the flag's rollout order (revision point 15) is explicit and not
just "flip it on":

- [ ] Deploy with `ENABLE_TOOL_USE=false` (the default) — confirm no behaviour change for any
      existing user, since `availableTools` is always empty.
- [ ] Run the full automated suite in the deployed environment (Task 12), still with the flag off.
- [ ] Enable `ENABLE_TOOL_USE=true` in a local/internal environment only.
- [ ] With a real project containing at least one indexed file, send a chat message on
      **Gemini 3.8 Flash** that can only be answered from that file's content. Confirm: a
      `tool_use` SSE frame appears with `name: "search_project_files"`, a `tool_result` frame
      follows with a short `preview`, and the final answer actually uses the retrieved text.
- [ ] Repeat on **Sonnet 5** or **Opus 5**. Confirm `disable_parallel_tool_use` actually prevents
      Claude's documented parallel-call behaviour from reaching the loop as more than one
      `tool_use` block per round.
- [ ] Ask a question requiring `read_project_file` for a fileId the model only learned from an
      earlier `search_project_files` result in the same turn, on both providers.
- [ ] Force pagination: index a file large enough to need more than one `read_project_file` call
      and confirm the model actually uses `nextCursor` to continue reading, on both providers.
- [ ] Force the loop to exhaust its budget (temporarily set `TOOL_MAX_ROUNDS=1` against a question
      needing two lookups). Confirm the response completes with `finishReason: 'tool_limit'`
      rather than hanging or erroring, on both providers.
- [ ] Confirm Gemini's `parametersJsonSchema` field is honoured as documented against a live
      call — this was verified against Task 8's fake client and the SDK's `.d.ts` only, never a
      real Vertex response.
- [ ] Deliberately trigger a tool failure (e.g. a malformed fileId) and confirm the model receives
      and reacts to the failure rather than the turn erroring.
- [ ] Only after all of the above pass: consider enabling the flag more broadly. **Do not remove
      `ENABLE_TOOL_USE` after this first successful round** — it stays as the standing gate.

If any of these fail, update `mistakes.md` (Task 14) and adjust before considering Phase 1 done.

---

### Task 14: Docs

**Files:**
- Modify: `mistakes.md`
- Modify: `docs/checkpoints/CURRENT.md`
- Modify: `docs/superpowers/plans/2026-09-19-item9-tool-framework.md` (supersession header)

- [ ] **Step 1: Add a `mistakes.md` entry**

Only if Tasks 1-13 actually surfaced a wrong assumption while implementing (e.g. the installed
`@google/genai` or `@anthropic-ai/sdk` version disagrees with the shapes assumed in Tasks 7-10).
Format: symptom, cause, rule, how to verify. Skip this step if nothing was wrong — do not
manufacture an entry.

- [ ] **Step 2: Update `docs/checkpoints/CURRENT.md`**

Add a dated section stating: item 9 phase 1 (revised) — bounded, sequential tool-calling loop via
`ToolRegistry`, structured `ToolResult`, `AbortSignal`-aware execution, paginated
`read_project_file` — is implemented and covered by unit tests, real-Postgres executor tests, and
new fake-SDK-client-boundary adapter-loop tests for both providers; gated behind
`ENABLE_TOOL_USE` (default off); **not yet verified against real Vertex** (Task 13, blocked on
the same gcloud/credentials gap already on record); frontend has no UI for `tool_use`/
`tool_result` frames yet; `run_python`/sandbox, skills, sub-agents, and goal/budget bookkeeping
remain explicitly deferred per `tools/MAPPING.md`.

- [ ] **Step 3: Add a supersession note to the prior plan**

At the top of `docs/superpowers/plans/2026-09-19-item9-tool-framework.md`, immediately after its
own header block, add:

```markdown
> **Superseded 2026-09-19 by [`2026-09-19-item9-tool-framework-v2.md`](2026-09-19-item9-tool-framework-v2.md).**
> No code from this version was ever implemented. The revision changes `ToolResult` to structured
> content, adds a `ToolRegistry` seam, precise round limits, bounded/paginated `read_project_file`,
> `AbortSignal`-aware tool execution, and adapter-loop tests at the SDK-client boundary. Kept here
> as the historical record of the original design, per this repo's rule that a decision is not
> changed until the document recording it is changed.
```

- [ ] **Step 4: Commit**

```bash
git add mistakes.md docs/checkpoints/CURRENT.md docs/superpowers/plans/2026-09-19-item9-tool-framework.md
git commit -m "docs(tools): record item 9 phase 1 (revised) status and supersede the prior plan"
```
