# Item 9 — Tool-Calling Framework (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ArcNave a real tool-calling loop — the model can call `search_project_files` and
`read_project_file` mid-turn, see the result, and continue — for both the Anthropic and Gemini
adapters, bounded at 8 rounds with a defined degraded path (not a hang, not an error).

**Architecture:** The loop lives *inside* each `Provider.stream()` implementation, not in
`GenerationService`. `GenerationService` builds a `GenerationRequest` carrying an optional
`tools: ToolDefinition[]` (schemas) and `toolExecutor: ToolExecutor` (a per-request object bound
to the current project, injected fresh every call). Each adapter serialises the same
`ToolDefinition[]` into its own wire format, watches its stream for a tool call, invokes
`toolExecutor.execute()`, feeds the result back into its own message/contents array, and calls
the underlying SDK again — up to `TOOL_LOOP_MAX_STEPS` times — before falling through to normal
completion. `GenerationService`'s `run()` loop is extended with two new `ProviderEvent`/
`StreamEvent` cases (`tool_use`, `tool_result`) exactly the way the existing `code` event is
handled today; nothing about its retry, budget, or persistence logic changes shape.

**Tech Stack:** Node 22, TypeScript, Fastify 5, Drizzle ORM, `@anthropic-ai/vertex-sdk`
(`@anthropic-ai/sdk` types), `@google/genai`, Zod, Vitest.

> **Superseded 2026-09-19 by [`2026-09-19-item9-tool-framework-v2.md`](2026-09-19-item9-tool-framework-v2.md).**
> No code from this version was ever implemented. The revision changes `ToolResult` to structured
> content, adds a `ToolRegistry` seam, precise round limits, bounded/paginated `read_project_file`,
> `AbortSignal`-aware tool execution, and adapter-loop tests at the SDK-client boundary. Kept here
> as the historical record of the original design, per this repo's rule that a decision is not
> changed until the document recording it is changed.

## Global Constraints

- `npx tsc --noEmit` and `npx vitest run` must both be clean in `backend/` before any commit.
- **Never substitute silently** (Invariant 1): an unknown tool name or a tool that fails returns
  `{ ok: false, output: "<reason>" }` fed back to the model as a real tool result — it is never
  dropped, retried against a different tool, or swallowed.
- **BM25 is not semantic search** (Invariant 4): `search_project_files`'s description must say
  "lexical keyword search" and must not imply conceptual/semantic matching.
- **Tests must never reach a provider.** All adapter-loop behaviour that needs a live SDK
  response is exercised through `FakeProvider` (already the pattern in
  `backend/src/test/harness.ts`); nothing in the suite may call Vertex.
- **A decision is not changed until the document recording it is changed, in the same commit** —
  N/A here (no ADR is being reversed), but `docs/checkpoints/CURRENT.md` must be updated when
  this phase lands (Task 10).
- Comments state why, not what; a comment asserting a guarantee needs a test that fails when the
  guarantee stops holding.
- `npm run openapi` must be re-run and `docs/openapi.json` committed whenever the `/chats/:id/generate`
  route's documented SSE frame list changes (Task 6).
- **Explicitly out of scope for this phase** (do not build these here): `run_python`/sandbox
  execution, the skills registry, goal/budget bookkeeping, and any form of sub-agent spawning.
  These are items 9-phase-2, 10, and 11 in `tools/MAPPING.md` and depend on decisions not yet made.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/src/providers/types.ts` | New `ToolDefinition`/`ToolCall`/`ToolResult`/`ToolExecutor` types; `GenerationRequest.tools`/`toolExecutor`; two new `ProviderEvent` variants. |
| `backend/src/config.ts` | `ENABLE_TOOL_USE`, `TOOL_LOOP_MAX_STEPS` env vars. |
| `backend/src/db/schema.ts` | New `toolCalls` table (mirrors `researchEvents`), relation, inferred type. |
| `backend/src/tools/definitions.ts` (new) | The two `ToolDefinition` constants ArcNave ships in phase 1. |
| `backend/src/tools/executor.ts` (new) | `ProjectToolExecutor implements ToolExecutor` — the only concrete tool implementation. |
| `backend/src/tools/executor.integration.test.ts` (new) | Real-Postgres tests for the executor's two tools. |
| `backend/src/services/generation.ts` | Build `tools`/`toolExecutor` on the request; two new `StreamEvent` variants; `persistToolCall`; new `case` branches in `run()`. |
| `backend/src/providers/gemini.ts` | `toGeminiFunctionDeclaration`; rewrite `stream()`'s single call into a bounded round loop. |
| `backend/src/providers/anthropicVertex.ts` | `toAnthropicTool`; same round-loop rewrite. |
| `backend/src/providers/gemini.test.ts` / `anthropicVertex.test.ts` | Unit tests for the new pure serialisation helpers. |
| `backend/src/routes/chats.ts` | One-line update to the route's documented SSE frame list. |
| `backend/src/routes/chats.integration.test.ts` | End-to-end SSE + persistence test using a scripted `FakeProvider`. |
| `mistakes.md`, `docs/checkpoints/CURRENT.md` | Updated at the end, per project convention. |

---

### Task 1: Core tool types

**Files:**
- Modify: `backend/src/providers/types.ts:62-102`

**Interfaces:**
- Produces: `ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }`, `ToolCall { id: string; name: string; input: unknown }`, `ToolResult { toolCallId: string; ok: boolean; output: string }`, `ToolExecutor { execute(call: ToolCall): Promise<ToolResult> }` — every later task imports these from `../providers/types.js`.
- Modifies: `GenerationRequest` gains `tools?: ToolDefinition[]` and `toolExecutor?: ToolExecutor`. `ProviderEvent` gains `{ type: 'tool_use'; toolCallId: string; name: string; input: unknown }` and `{ type: 'tool_result'; toolCallId: string; name: string; ok: boolean; output: string }`.

This task is pure type scaffolding — nothing calls it yet, so there is no behaviour to test. The
gate is the compiler.

- [ ] **Step 1: Add the tool types and extend `ProviderEvent`**

Replace lines 62-71 of `backend/src/providers/types.ts`:

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
  | { type: 'tool_result'; toolCallId: string; name: string; ok: boolean; output: string }
  | { type: 'completed'; usage: ProviderUsage; finishReason: string };

/**
 * A tool the model may call. `inputSchema` is provider-neutral JSON Schema; each adapter clones
 * it before handing it to its own SDK — `@google/genai` rewrites a schema object in place
 * (uppercasing `type` values), so sharing one object between two adapters would corrupt whichever
 * one runs second.
 */
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
 *  fed back to the model as a real result so it can react, per Invariant 1. */
export interface ToolResult {
  toolCallId: string;
  ok: boolean;
  output: string;
}

/**
 * The seam between a provider adapter's loop and ArcNave's actual tool implementations.
 * Constructed fresh per request in `GenerationService` (it is bound to one project), never
 * shared across requests. `src/test/harness.ts`'s `FakeProvider` never calls this directly —
 * it scripts `tool_use`/`tool_result` events straight into `ProviderEvent`, so no fake
 * implementation of this interface is needed for the generation-service test suite.
 */
export interface ToolExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
}
```

- [ ] **Step 2: Extend `GenerationRequest`**

In the same file, replace the `GenerationRequest` interface (previously lines 87-102):

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
  signal: AbortSignal;
}
```

with:

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

- [ ] **Step 3: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean (nothing references the new fields yet, so nothing can be wrong about their use — this only proves the new declarations themselves are syntactically and structurally valid).

- [ ] **Step 4: Commit**

```bash
git add backend/src/providers/types.ts
git commit -m "feat(tools): add ToolDefinition/ToolCall/ToolResult/ToolExecutor types"
```

---

### Task 2: Config flags

**Files:**
- Modify: `backend/src/config.ts:129-134`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Config.ENABLE_TOOL_USE: boolean`, `Config.TOOL_LOOP_MAX_STEPS: number` — read by `GenerationService` (Task 6) and both adapters (Tasks 7-8).

- [ ] **Step 1: Add the two env vars**

In `backend/src/config.ts`, after the `ENABLE_GEMINI_CODE_EXECUTION` block (line 133) and before
the `// --- Storage ---` comment (line 135), insert:

```typescript
  /**
   * Master gate for the item-9 tool-calling loop. Off by default: a deployment with no project
   * context gains nothing from it, and it changes both adapters' wire shape.
   */
  ENABLE_TOOL_USE: bool(false),
  /** G2's bound: the loop calls a tool, sees the result, and may call again, up to this many
   *  rounds, before it answers with whatever it has (`finishReason: 'tool_limit'`) rather than
   *  looping forever. */
  TOOL_LOOP_MAX_STEPS: int(8),
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add backend/src/config.ts
git commit -m "feat(tools): add ENABLE_TOOL_USE and TOOL_LOOP_MAX_STEPS config"
```

---

### Task 3: `toolCalls` table

**Files:**
- Modify: `backend/src/db/schema.ts` (after `researchEvents`, its relation, and its inferred type)
- Generate: a new migration under `backend/drizzle/`

**Interfaces:**
- Produces: `toolCalls` table and `ToolCallRow = typeof toolCalls.$inferSelect`, consumed by `GenerationService.persistToolCall` (Task 6).

- [ ] **Step 1: Add the table**

In `backend/src/db/schema.ts`, immediately after the `researchEvents` table definition (ends at
line 320, right before the blank line preceding `messagesRelations`... actually insert after the
whole `researchEvents` block, i.e. after line 320):

```typescript
/**
 * One row per tool call/result pair the model made while answering a message. Mirrors
 * `researchEvents`'s shape and reason for existing: without this, reloading a chat after the
 * model used a tool would show no evidence it happened.
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
    output: text('output').notNull(),
    ok: boolean('ok').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_tool_call_ordinal').on(t.messageId, t.ordinal)],
);
```

- [ ] **Step 2: Add its relation**

Immediately after `researchEventsRelations` (previously lines 537-539), add:

```typescript
export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
  message: one(messages, { fields: [toolCalls.messageId], references: [messages.id] }),
}));
```

And add `toolCalls: many(toolCalls),` to `messagesRelations`'s object (the block starting at
previously-line 526), alongside its existing `events: many(researchEvents),` line.

- [ ] **Step 3: Add the inferred type**

Immediately after `export type ResearchEvent = typeof researchEvents.$inferSelect;` (previously
line 566), add:

```typescript
export type ToolCallRow = typeof toolCalls.$inferSelect;
```

- [ ] **Step 4: Generate and inspect the migration**

Run: `cd backend && npm run db:generate`
Expected: a new file `backend/drizzle/0004_<generated-name>.sql` containing a single
`CREATE TABLE "tool_calls" (...)` plus its unique index and foreign key — read it to confirm it
matches the table above before proceeding. Do not hand-edit the generated SQL.

- [ ] **Step 5: Apply it locally and typecheck**

Run: `cd backend && npm run db:migrate && npx tsc --noEmit`
Expected: migration applies with no error; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/
git commit -m "feat(tools): add tool_calls table"
```

---

### Task 4: Tool definitions

**Files:**
- Create: `backend/src/tools/definitions.ts`

**Interfaces:**
- Consumes: `ToolDefinition` from `../providers/types.js` (Task 1).
- Produces: `SEARCH_PROJECT_FILES`, `READ_PROJECT_FILE`, `PROJECT_TOOL_DEFINITIONS: ToolDefinition[]` — consumed by `GenerationService` (Task 6) and `ProjectToolExecutor` (Task 5, for its `switch` on `call.name`).

No behaviour to unit-test here beyond the shape being valid JSON Schema-shaped data; that is
proven by `ProjectToolExecutor`'s own tests (Task 5) exercising the matching input schemas end to
end, so this task has no separate test step.

- [ ] **Step 1: Write the two tool definitions**

```typescript
/**
 * ArcNave's phase-1 tool set: read access to the current project's already-indexed files.
 *
 * Descriptions matter more than they look like they should — the model reasons from them, not
 * from the schema. Per Invariant 4, `search_project_files`'s description must say "lexical
 * keyword search" and must not claim conceptual/semantic matching, because there is none.
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
    'Reads the full indexed text of one project file by id, for when a search excerpt is not ' +
    'enough context. Only call this with a fileId already seen in this conversation, such as ' +
    'one returned by search_project_files. Do not guess a fileId.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The file id, exactly as returned by search_project_files.',
      },
    },
    required: ['fileId'],
  },
};

export const PROJECT_TOOL_DEFINITIONS: ToolDefinition[] = [SEARCH_PROJECT_FILES, READ_PROJECT_FILE];
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add backend/src/tools/definitions.ts
git commit -m "feat(tools): add search_project_files and read_project_file definitions"
```

---

### Task 5: `ProjectToolExecutor`

**Files:**
- Create: `backend/src/tools/executor.ts`
- Test: `backend/src/tools/executor.integration.test.ts` (real Postgres, per the project's rule that DB-touching logic is proven against a real database, not a mock)

**Interfaces:**
- Consumes: `Database` (`../db/client.js`), `fileChunks`/`projectFiles` (`../db/schema.js`), `Retriever` (`../services/retrieval.js`), `ToolCall`/`ToolExecutor`/`ToolResult` (`../providers/types.js`, Task 1).
- Produces: `ProjectToolExecutor implements ToolExecutor`, constructed as `new ProjectToolExecutor(db, retriever, projectId)` — consumed by `GenerationService` (Task 6).

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
import { ProjectToolExecutor } from './executor.js';

let ctx: TestContext;
let projectId: string;
let fileId: string;

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

  const [row] = await ctx.db
    .insert((await import('../db/schema.js')).projectFiles)
    .values({
      projectId,
      userId: user.id,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 20,
      storageKey: 'fixture/notes.txt',
      status: 'ready',
    })
    .returning({ id: (await import('../db/schema.js')).projectFiles.id });
  fileId = row!.id;

  await indexFile(
    ctx.db,
    { id: fileId, projectId, mimeType: 'text/plain', filename: 'notes.txt' },
    Buffer.from('The quarterly cooling budget was approved in March.'),
  );
});

afterAll(async () => {
  await ctx.close();
});

describe('ProjectToolExecutor', () => {
  it('search_project_files finds an indexed chunk by keyword', async () => {
    const executor = new ProjectToolExecutor(ctx.db, new LexicalRetriever(), projectId);
    const result = await executor.execute({
      id: 'call-1',
      name: 'search_project_files',
      input: { query: 'cooling budget' },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('cooling budget');
    expect(result.output).toContain(fileId);
  });

  it('search_project_files reports no match plainly rather than an empty string', async () => {
    const executor = new ProjectToolExecutor(ctx.db, new LexicalRetriever(), projectId);
    const result = await executor.execute({
      id: 'call-2',
      name: 'search_project_files',
      input: { query: 'spacecraft telemetry' },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('No matching excerpts were found for that query.');
  });

  it('search_project_files rejects a missing query rather than throwing', async () => {
    const executor = new ProjectToolExecutor(ctx.db, new LexicalRetriever(), projectId);
    const result = await executor.execute({ id: 'call-3', name: 'search_project_files', input: {} });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Invalid input');
  });

  it('read_project_file returns the full text by id', async () => {
    const executor = new ProjectToolExecutor(ctx.db, new LexicalRetriever(), projectId);
    const result = await executor.execute({
      id: 'call-4',
      name: 'read_project_file',
      input: { fileId },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('The quarterly cooling budget was approved in March.');
  });

  it('read_project_file refuses a file id from a different project', async () => {
    const otherUser = await signUp(ctx, 'Other');
    const otherProject = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: otherUser.cookie },
      payload: { title: 'Other project' },
    });
    const otherProjectId = (otherProject.json() as { id: string }).id;

    const executor = new ProjectToolExecutor(ctx.db, new LexicalRetriever(), otherProjectId);
    const result = await executor.execute({ id: 'call-5', name: 'read_project_file', input: { fileId } });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('No indexed file');
  });

  it('reports an unknown tool name without throwing', async () => {
    const executor = new ProjectToolExecutor(ctx.db, new LexicalRetriever(), projectId);
    const result = await executor.execute({ id: 'call-6', name: 'delete_everything', input: {} });
    expect(result.ok).toBe(false);
    expect(result.output).toBe('Unknown tool "delete_everything".');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/tools/executor.integration.test.ts`
Expected: FAIL — `Cannot find module './executor.js'` (it does not exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Executes the tools a provider is allowed to call for one request.
 *
 * Scoped to a single project: constructed fresh per generate call in `GenerationService`, never
 * shared across requests, because which project's files are in scope changes every call. Every
 * branch returns a `ToolResult` — it never throws — because a bad tool name or a bad input is
 * something the *model* needs to see and react to (Invariant 1: say so, do not silently skip).
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { fileChunks, projectFiles } from '../db/schema.js';
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { Retriever } from '../services/retrieval.js';

const searchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
});

const readInput = z.object({
  fileId: z.string().min(1),
});

export class ProjectToolExecutor implements ToolExecutor {
  constructor(
    private readonly db: Database,
    private readonly retriever: Retriever,
    private readonly projectId: string,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    switch (call.name) {
      case 'search_project_files':
        return this.searchProjectFiles(call);
      case 'read_project_file':
        return this.readProjectFile(call);
      default:
        return { toolCallId: call.id, ok: false, output: `Unknown tool "${call.name}".` };
    }
  }

  private async searchProjectFiles(call: ToolCall): Promise<ToolResult> {
    const parsed = searchInput.safeParse(call.input);
    if (!parsed.success) {
      return { toolCallId: call.id, ok: false, output: `Invalid input: ${parsed.error.message}` };
    }
    const chunks = await this.retriever.search(
      this.db,
      this.projectId,
      parsed.data.query,
      parsed.data.limit ?? 5,
    );
    if (chunks.length === 0) {
      return {
        toolCallId: call.id,
        ok: true,
        output: 'No matching excerpts were found for that query.',
      };
    }
    const output = chunks
      .map(
        (c) =>
          `fileId: ${c.fileId}\nfilename: ${c.filename}\n` +
          `${c.page != null ? `page: ${String(c.page)}\n` : ''}` +
          `score: ${String(c.score)}\ntext: ${c.text}`,
      )
      .join('\n---\n');
    return { toolCallId: call.id, ok: true, output };
  }

  private async readProjectFile(call: ToolCall): Promise<ToolResult> {
    const parsed = readInput.safeParse(call.input);
    if (!parsed.success) {
      return { toolCallId: call.id, ok: false, output: `Invalid input: ${parsed.error.message}` };
    }
    const rows = await this.db
      .select({ text: fileChunks.text, filename: projectFiles.filename })
      .from(fileChunks)
      .innerJoin(projectFiles, eq(fileChunks.projectFileId, projectFiles.id))
      .where(
        and(
          eq(fileChunks.projectFileId, parsed.data.fileId),
          eq(fileChunks.projectId, this.projectId),
        ),
      )
      .orderBy(asc(fileChunks.ordinal));
    if (rows.length === 0) {
      return {
        toolCallId: call.id,
        ok: false,
        output: `No indexed file with id "${parsed.data.fileId}" exists in this project.`,
      };
    }
    return {
      toolCallId: call.id,
      ok: true,
      output: `${rows[0]!.filename}:\n\n${rows.map((r) => r.text).join('\n\n')}`,
    };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/tools/executor.integration.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tools/executor.ts backend/src/tools/executor.integration.test.ts
git commit -m "feat(tools): add ProjectToolExecutor for search_project_files and read_project_file"
```

---

### Task 6: `GenerationService` wiring

**Files:**
- Modify: `backend/src/services/generation.ts:36-49` (imports), `:62-69` (`StreamEvent`), `:267-278` (request construction), `:292-340` (the event `switch`), `:713-741` (persistence)
- Modify: `backend/src/routes/chats.ts` (the generate route's `description` string)

**Interfaces:**
- Consumes: `PROJECT_TOOL_DEFINITIONS` (Task 4), `ProjectToolExecutor` (Task 5), `toolCalls` table (Task 3), `cfg.ENABLE_TOOL_USE` (Task 2).
- Produces: `StreamEvent` gains `tool_use`/`tool_result` variants that Task 9's integration test asserts on over SSE.

- [ ] **Step 1: Write the failing test**

`backend/src/routes/chats.integration.test.ts` has no `drizzle-orm`/schema imports yet — add
`import { eq } from 'drizzle-orm';` and `import { toolCalls } from '../db/schema.js';` to its
existing import block (previously lines 10-13).

Then add, near the other `generate` tests (this file already has `newChat`/`generate`/
`transcript` helpers and an `afterEach` that resets `ctx.provider.script`):

```typescript
describe('tool use', () => {
  it('streams tool_use/tool_result frames and persists them when the model calls a tool', async () => {
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

    ctx.provider.script = [
      { type: 'tool_use', toolCallId: 'call-1', name: 'search_project_files', input: { query: 'x' } },
      { type: 'tool_result', toolCallId: 'call-1', name: 'search_project_files', ok: true, output: 'found it' },
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
    expect(toolResult?.data['ok']).toBe(true);
    expect(toolResult?.data['output']).toBe('found it');

    const t = await transcript(chatId);
    const assistantMessageId = t.messages[t.messages.length - 1]!.id;
    const rows = await ctx.db.select().from(toolCalls).where(eq(toolCalls.messageId, assistantMessageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('search_project_files');
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.output).toBe('found it');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/routes/chats.integration.test.ts -t "tool use"`
Expected: FAIL — `ctx.provider.script` accepts the new event shapes fine (they already typecheck
against `ProviderEvent` from Task 1), but the SSE response has no `tool_use`/`tool_result` frames
yet and `toolCalls` has no rows, so every `expect` after the status check fails.

- [ ] **Step 3: Implement**

In `backend/src/services/generation.ts`:

**6a. Imports** — add to the existing import block (after the `import type { ObjectStorage } from './storage.js';` line):

```typescript
import { PROJECT_TOOL_DEFINITIONS } from '../tools/definitions.js';
import { ProjectToolExecutor } from '../tools/executor.js';
```

and add `toolCalls` to the existing `import { attachments, chats, messages, ... } from '../db/schema.js';` list.

**6b. `StreamEvent`** — replace the union (previously lines 62-69):

```typescript
export type StreamEvent =
  | { type: 'start'; messageId: string; chatId: string; requestId: string; model: ModelInfo }
  | { type: 'research'; event: { stage: string; label: string; detail: string; at: string } }
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: SourceDto[]; searchEntryPoint?: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; name: string; ok: boolean; output: string }
  | { type: 'done'; questions: string[]; usage: UsageDto; finishReason: string }
  | { type: 'error'; code: string; title: string; detail: string; usage?: UsageDto };
```

**6c. Request construction** — in `run()`, immediately before `const request: GenerationRequest = {`
(previously line 267), insert:

```typescript
    const toolsEnabled = this.cfg.ENABLE_TOOL_USE && project !== null;
    const tools = toolsEnabled ? PROJECT_TOOL_DEFINITIONS : undefined;
    const toolExecutor = toolsEnabled
      ? new ProjectToolExecutor(this.db, this.retriever, project!.id)
      : undefined;
```

and inside the `request` object literal, add two lines after `codeExecution,`:

```typescript
      ...(tools ? { tools } : {}),
      ...(toolExecutor ? { toolExecutor } : {}),
```

**6d. Event handling** — in the `for await (const event of stream)` switch (previously the block
spanning lines 292-339), add a local `pendingToolInputs` map alongside the other accumulators
(near `const collectedText: string[] = [];`, previously line 284):

```typescript
    const pendingToolInputs = new Map<string, unknown>();
```

and add two new `case`s to the `switch (event.type)`, placed between the existing `'code'` and
`'progress'` cases:

```typescript
          case 'tool_use': {
            pendingToolInputs.set(event.toolCallId, event.input);
            yield { type: 'tool_use', toolCallId: event.toolCallId, name: event.name, input: event.input };
            break;
          }

          case 'tool_result': {
            const out: StreamEvent = {
              type: 'tool_result',
              toolCallId: event.toolCallId,
              name: event.name,
              ok: event.ok,
              // Capped the same way researchEvents.label is capped — this is a wire/DB payload,
              // not a place to reproduce an entire retrieved document.
              output: event.output.slice(0, 2000),
            };
            yield out;
            await this.persistToolCall(
              input.messageId,
              out,
              pendingToolInputs.get(event.toolCallId),
              eventOrdinal++,
            );
            break;
          }
```

**6e. Persistence** — add a new private method right after `persistEvent` (previously ending at
line 741):

```typescript
  private async persistToolCall(
    messageId: string,
    event: Extract<StreamEvent, { type: 'tool_result' }>,
    input: unknown,
    ordinal: number,
  ): Promise<void> {
    await this.db
      .insert(toolCalls)
      .values({
        messageId,
        ordinal,
        toolCallId: event.toolCallId,
        name: event.name,
        input: input ?? null,
        output: event.output,
        ok: event.ok,
      })
      .onConflictDoNothing();
  }
```

**6f.** Update `backend/src/routes/chats.ts`'s generate route `description` string (the one
listing `'Returns text/event-stream. Frames: start, research, delta, sources, done, error.'`) to:

```typescript
        description:
          'Returns text/event-stream. Frames: start, research, delta, sources, tool_use, ' +
          'tool_result, done, error.',
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/routes/chats.integration.test.ts -t "tool use"`
Expected: PASS.

- [ ] **Step 5: Full backend suite and typecheck**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean; all prior tests (167+ before this phase) still pass unchanged, since
`ENABLE_TOOL_USE` defaults to `false` in every existing test's environment and `tools`/
`toolExecutor` are optional fields nothing else reads.

- [ ] **Step 6: Regenerate the OpenAPI doc**

Run: `cd backend && npm run openapi`
Expected: `docs/openapi.json` changes only in the `/chats/{id}/generate` route's `description`
field.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/generation.ts backend/src/routes/chats.ts backend/src/routes/chats.integration.test.ts docs/openapi.json
git commit -m "feat(tools): wire the tool-calling loop's events and persistence into GenerationService"
```

---

### Task 7: Gemini adapter loop

**Files:**
- Modify: `backend/src/providers/gemini.ts`
- Modify: `backend/src/providers/gemini.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`/`ToolCall` (Task 1), `request.tools`/`request.toolExecutor`.
- Produces: `toGeminiFunctionDeclaration(def: ToolDefinition): FunctionDeclaration`, exported for its unit test; `GeminiProvider.stream()` now loops when `request.tools` is non-empty.

**Verified against the installed SDK before writing this task** (`node_modules/@google/genai/dist/genai.d.ts`):
`FunctionDeclaration` has both a typed `parameters?: Schema` field (Vertex's own uppercase-enum
proto shape — the field `@google/genai` is documented to rewrite in place) and a
`parametersJsonSchema?: unknown` field the SDK's own doc comment describes as plain JSON Schema,
"mutually exclusive with `parameters`". Use `parametersJsonSchema` — it sidesteps the in-place
mutation risk entirely rather than working around it. `FunctionResponse.response` is documented
as `Record<string, unknown>` using an `"output"` key for success and an `"error"` key for
failure. The accumulated per-chunk response exposes a `functionCalls: FunctionCall[] | undefined`
getter directly — no manual walk of `candidate.content.parts` is needed to find them.

- [ ] **Step 1: Write the failing unit test**

Add to `backend/src/providers/gemini.test.ts` (new `describe` block, alongside the existing
`buildGeminiContents` one):

```typescript
import { toGeminiFunctionDeclaration } from './gemini.js';

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
    const decl = toGeminiFunctionDeclaration({
      name: 'x',
      description: 'x',
      inputSchema: original,
    });
    (decl.parametersJsonSchema as Record<string, unknown>)['type'] = 'MUTATED';
    expect(original['type']).toBe('object');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/providers/gemini.test.ts`
Expected: FAIL — `toGeminiFunctionDeclaration` is not exported yet.

- [ ] **Step 3: Implement**

In `backend/src/providers/gemini.ts`:

**3a.** Extend the type import (previously line 8):

```typescript
import type { Content, Part, Blob as GeminiBlob, FunctionDeclaration } from '@google/genai';
```

**3b.** Add the converter, near `attachmentParts` (top-level function, exported for the test):

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
```

Add `ToolDefinition` to the existing `import type { AttachmentBlock, GenerationRequest, Provider, ProviderEvent, ProviderUsage } from './types.js';` line.

**3c.** Rewrite `stream()`'s body (previously lines 160-280) to loop when tools are present:

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
    const maxRounds = useTools ? Math.max(1, this.cfg.TOOL_LOOP_MAX_STEPS) : 1;

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

        const responseParts: Part[] = [];
        for (let i = 0; i < roundCalls.length; i += 1) {
          const fc = roundCalls[i]!;
          const call = { id: fc.id ?? `${fc.name}-${String(round)}-${String(i)}`, name: fc.name, input: fc.args };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, ok: result.ok, output: result.output };
          responseParts.push({
            functionResponse: {
              ...(fc.id ? { id: fc.id } : {}),
              name: fc.name,
              response: result.ok ? { output: result.output } : { error: result.output },
            },
          });
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

Note the `roundLoop:` label on the `for` loop — it lets the inner `for await` chunk loop `break`
all the way out on abort, matching the existing single-call code's `if (request.signal.aborted) break;`
behaviour exactly, just reaching one more loop level.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/providers/gemini.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/providers/gemini.ts backend/src/providers/gemini.test.ts
git commit -m "feat(tools): give the Gemini adapter a bounded tool-calling loop"
```

---

### Task 8: Anthropic adapter loop

**Files:**
- Modify: `backend/src/providers/anthropicVertex.ts`
- Modify: `backend/src/providers/anthropicVertex.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`/`ToolCall` (Task 1), `request.tools`/`request.toolExecutor`.
- Produces: `toAnthropicTool(def: ToolDefinition): Anthropic.Tool`, exported for its unit test; `AnthropicVertexProvider.stream()` now loops when `request.tools` is non-empty.

**Verified against the installed SDK before writing this task**
(`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`): `Anthropic.Tool` is
`{ name: string; input_schema: Tool.InputSchema; ... }`; `Anthropic.ToolUseBlock` is
`{ id: string; name: string; input: unknown; type: 'tool_use' }`; `Anthropic.ToolResultBlockParam`
is `{ tool_use_id: string; type: 'tool_result'; content?: ...; is_error?: boolean }`;
`Anthropic.ToolChoiceAuto` carries `disable_parallel_tool_use?: boolean`. Deliberately setting
`disable_parallel_tool_use: true`: Claude emits parallel `tool_use` blocks by default (confirmed
live in `tools/MAPPING.md` §10, N-caveat under N1 — case 5 returned the same call twice), and
handling N tool calls in one round is real added complexity phase 1 does not need yet. This is a
documented simplification, not an oversight — revisit if a future tool genuinely benefits from
parallel calls.

- [ ] **Step 1: Write the failing unit test**

Add to `backend/src/providers/anthropicVertex.test.ts`:

```typescript
import { toAnthropicTool } from './anthropicVertex.js';

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/providers/anthropicVertex.test.ts`
Expected: FAIL — `toAnthropicTool` is not exported yet.

- [ ] **Step 3: Implement**

In `backend/src/providers/anthropicVertex.ts`:

**3a.** Add the converter near `WEB_SEARCH_TOOL` (previously line 25):

```typescript
function toAnthropicTool(def: ToolDefinition): Anthropic.Tool {
  return {
    name: def.name,
    description: def.description,
    input_schema: structuredClone(def.inputSchema) as Anthropic.Tool.InputSchema,
  };
}
```

Export it (`export function toAnthropicTool`) and add `ToolDefinition` to the existing
`import type { GenerationRequest, Provider, ProviderEvent, ProviderUsage } from './types.js';` line.

**3b.** Rewrite `stream()`'s body (previously lines 180-276):

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
    const maxRounds = useTools ? Math.max(1, this.cfg.TOOL_LOOP_MAX_STEPS) : 1;

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
        const resultBlocks: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          const call = { id: block.id, name: block.name, input: block.input };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, ok: result.ok, output: result.output };
          resultBlocks.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: result.output,
            is_error: !result.ok,
          });
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
          detail:
            'The web search tool was available but returned no results for this question.',
        };
      }
    }

    yield { type: 'completed', usage, finishReason };
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/providers/anthropicVertex.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/providers/anthropicVertex.ts backend/src/providers/anthropicVertex.test.ts
git commit -m "feat(tools): give the Anthropic adapter a bounded tool-calling loop"
```

---

### Task 9: Full backend verification

**Files:** none new — this task only runs the suite.

- [ ] **Step 1: Run everything**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean; every test from before this phase still passes (nothing changed for a request
with `ENABLE_TOOL_USE` unset/false, since `tools`/`toolExecutor` stay `undefined` and every new
branch in both adapters is gated behind `useTools`); Task 6's new `tool use` test and Task 5's
six `ProjectToolExecutor` tests pass.

- [ ] **Step 2: Regenerate OpenAPI once more for safety**

Run: `cd backend && npm run openapi`
Expected: no diff beyond what Task 6 already committed (confirms nothing else drifted).

- [ ] **Step 3: Commit only if step 2 produced a diff**

```bash
git add docs/openapi.json
git commit -m "chore(tools): regenerate openapi.json"
```

(Skip this commit entirely if `git status` shows no change.)

---

### Task 10: Docs

**Files:**
- Modify: `mistakes.md`
- Modify: `docs/checkpoints/CURRENT.md`

- [ ] **Step 1: Add a `mistakes.md` entry**

Only if Tasks 1-9 actually surfaced a wrong assumption while implementing (e.g. if live testing
in Task 11 finds `parametersJsonSchema` behaves differently on Vertex than the SDK's `.d.ts`
comment promises, or the `functionCalls` getter is empty mid-stream and calls only appear in a
final aggregated chunk). Write it in the file's existing format: symptom, cause, rule, how to
verify. If nothing was wrong, skip this step — do not manufacture an entry.

- [ ] **Step 2: Update `docs/checkpoints/CURRENT.md`**

Add a new dated section (mirroring the existing "Tool-use/agent framework research — items 9-12"
section's style) stating: item 9 phase 1 (bounded tool-calling loop, `search_project_files`,
`read_project_file`) is implemented and unit/integration tested against `FakeProvider` and real
Postgres, gated behind `ENABLE_TOOL_USE` (default off); **not yet verified against real Vertex**
(Task 11, blocked on the same gcloud/credentials gap already on record for this environment);
frontend has no UI for `tool_use`/`tool_result` frames yet (same "backend complete, frontend
follow-up separate" shape as ADR-0004's items 1-8); `run_python`/sandbox, skills, and goal/budget
bookkeeping remain explicitly deferred per `tools/MAPPING.md`.

- [ ] **Step 3: Commit**

```bash
git add mistakes.md docs/checkpoints/CURRENT.md
git commit -m "docs(tools): record item 9 phase 1 status"
```

---

### Task 11: Live verification against real Vertex (blocked on the user)

This cannot be executed in an environment without `gcloud`/GCP credentials — same constraint
already on record in `docs/checkpoints/CURRENT.md`'s "Blocked on the user" section for other
Vertex-dependent work. Recorded here so it is not silently skipped.

- [ ] With `ENABLE_TOOL_USE=true` and a real project containing at least one indexed file, send a
      chat message on **Gemini 3.8 Flash** that can only be answered from that file's content.
      Confirm: a `tool_use` SSE frame appears with `name: "search_project_files"`, a `tool_result`
      frame follows, and the final answer actually uses the retrieved text.
- [ ] Repeat on **Sonnet 5** or **Opus 5**. Confirm the same, and specifically confirm
      `disable_parallel_tool_use` prevented the duplicate-call behaviour noted in
      `tools/MAPPING.md` §10 (N1) from reappearing.
- [ ] Force the loop to exhaust its budget (e.g. temporarily set `TOOL_LOOP_MAX_STEPS=1` against a
      question that needs two lookups). Confirm the response completes with `finishReason: 'tool_limit'`
      rather than hanging or erroring.
- [ ] Ask a question requiring `read_project_file` for a fileId the model only learned from an
      earlier `search_project_files` result in the same turn. Confirm the second call succeeds —
      this is the one behaviour that cannot be proven by `FakeProvider`, since it depends on the
      real model actually reading its own prior tool result and deciding to call again.
- [ ] Confirm Gemini's `parametersJsonSchema` field is honoured as documented (the tool is called
      with correctly-typed arguments, not stringified or rejected) — this is the plan's single
      least-certain claim, since it was verified against the SDK's `.d.ts` and doc comments only,
      not a live call.

If any of these fail, update `mistakes.md` (Task 10) and adjust before considering item 9 phase 1
done.
