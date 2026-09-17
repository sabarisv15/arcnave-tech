# Native Multimodal File Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude and Gemini (not GPT-OSS, which has no vision) actually see images and PDFs — including scanned ones — attached to a message, keep seeing them for the rest of that conversation, and do both affordably via provider-side caching.

**Architecture:** Attachment bytes already live in `ObjectStorage`; this plan threads them from there into `GenerationRequest` as base64 content blocks instead of (for images/PDFs only) running text extraction. `loadHistory` grows to carry forward past attachments so later turns still see them. Routing gains a `requiresVision` capability filter mirroring the existing `requiresGrounding` one, so a vision-blind model is never silently handed something it can't read.

**Tech Stack:** Node 22, TypeScript, Fastify 5, Drizzle ORM, PostgreSQL 16, `@anthropic-ai/vertex-sdk`, `@google/genai`, Vitest.

## Global Constraints

- No test may reach a real Vertex/Anthropic/Gemini call. `FakeProvider` (in `backend/src/test/harness.ts`) is the only provider tests ever see; verify request *shape* by inspecting `FakeProvider.seen`, never by asserting on live output.
- `npx tsc --noEmit` and `npx vitest run` must be clean in `backend/` before any commit, per `CLAUDE.md`.
- Any error a client can see must be a typed `ApiError` with a stable `code` — never a bare 500 for a case this plan anticipates (capability mismatch, missing project file, etc.).
- No silent substitution: a model that cannot see an attached image/PDF must fail with `capability_unavailable`, never drop the attachment quietly.
- `npm run openapi` (from `backend/`) must be re-run and `docs/openapi.json` committed whenever a route schema changes (Task 6 changes one, adds another).
- Local Postgres must be running for integration tests: `docker start arcnave-pg`.
- Design reference: [`docs/superpowers/specs/2026-09-17-multimodal-file-input-design.md`](../specs/2026-09-17-multimodal-file-input-design.md). Read it once before Task 1 — this plan assumes its decisions (scope, caching strategy, out-of-scope items) without re-arguing them.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/src/db/schema.ts` | Modify: `attachments` gains `projectFileId`; its storage-key uniqueness constraint is dropped (a project-file-sourced attachment shares that file's key). |
| `backend/drizzle/000N_*.sql` | Create: generated migration for the above. |
| `backend/src/providers/registry.ts` | Modify: `ModelEntry` gains `supportsVision`. |
| `backend/src/providers/routing.ts` | Modify: `RoutingInput` gains `requiresVision`; `routeAuto` filters on it. |
| `backend/src/providers/routing.test.ts` | Modify: helper fixtures updated for the new required fields; new test cases for the vision filter. |
| `backend/src/providers/types.ts` | Modify: new `AttachmentBlock` type; `Turn` and `GenerationRequest` both gain an `attachments` field. |
| `backend/src/providers/anthropicVertex.ts` | Modify: extract `buildMessages` into an exported `buildAnthropicMessages`; add image/document blocks and a `cache_control` breakpoint. |
| `backend/src/providers/anthropicVertex.test.ts` | Create: unit tests for `buildAnthropicMessages` — no network, no class instantiation. |
| `backend/src/providers/gemini.ts` | Modify: extract `buildContents` into an exported `buildGeminiContents`; add `inlineData` parts. |
| `backend/src/providers/gemini.test.ts` | Create: unit tests for `buildGeminiContents`. |
| `backend/package.json` | Modify: add `@anthropic-ai/sdk` as an explicit dependency (currently only resolvable transitively through `@anthropic-ai/vertex-sdk`) so the type import in Task 4 doesn't depend on undocumented hoisting. |
| `backend/src/routes/files.ts` | Modify: skip text extraction for image/PDF uploads; `viewable` DTO field; new `POST /files/from-project` route; `DELETE /files/:id` stops deleting storage bytes shared with a project file. |
| `backend/src/routes/files.integration.test.ts` | Modify: the existing "PNG is unsupported" test now expects `ready`/`viewable: true`; new tests for `/files/from-project` and the delete-doesn't-orphan-the-project-file case. |
| `backend/src/services/generation.ts` | Modify: constructor takes `ObjectStorage`; `resolveModel` gains a vision capability gate; `loadHistory` carries attachments forward under a new byte cap; `GenerateInput` gains `attachments`. |
| `backend/src/config.ts` | Modify: new `HISTORY_MAX_ATTACHMENT_BYTES` env var. |
| `backend/src/container.ts` | Modify: pass `storage` into `new GenerationService(...)`. |
| `backend/src/routes/chats.ts` | Modify: the generate handler splits attachment rows into text-extraction (unchanged path) vs. native (new: read bytes, base64-encode) and passes the latter through `GenerateInput.attachments`. |
| `backend/src/routes/chats.integration.test.ts` | Modify: new tests — capability gate rejects GPT-OSS with an image attached; an image attached in turn 1 shows up in turn 2's `FakeProvider.seen` request. |
| `docs/openapi.json` | Regenerate (Task 6 changes `attachmentSchema` and adds a route). |
| `mistakes.md`, `docs/checkpoints/CURRENT.md` | Update at the end (Task 8) with whatever this plan's execution actually surfaces. |

---

## Task 1: Schema — `attachments.projectFileId`, drop key uniqueness

**Files:**
- Modify: `backend/src/db/schema.ts:319-342` (the `attachments` table)
- Create: `backend/drizzle/000N_<generated-name>.sql` (via `npm run db:generate`, name is drizzle-kit's choice)

**Interfaces:**
- Produces: `attachments.projectFileId: string | null` (via `Attachment` type's `$inferSelect`), consumed by Task 6 (`/files/from-project`) and Task 6's delete-guard.

- [ ] **Step 1: Edit the `attachments` table definition**

In `backend/src/db/schema.ts`, replace the `attachments` table (lines 319-342) with:

```typescript
/** A file attached to a single message, as opposed to durable project knowledge. */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    /**
     * Set when this attachment reuses an existing project file's bytes rather than a fresh
     * upload. Its `storageKey` is then a copy of that file's key, not one of its own — the same
     * project file can be attached to more than one message, which is why the key is no longer
     * unique below.
     */
    projectFileId: uuid('project_file_id').references(() => projectFiles.id, {
      onDelete: 'set null',
    }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: varchar('storage_key', { length: 300 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('ready'),
    error: text('error').notNull().default(''),
    extractedText: text('extracted_text'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ix_attachments_key').on(t.storageKey),
    index('ix_attachments_message').on(t.messageId),
    index('ix_attachments_user').on(t.userId),
  ],
);
```

The only changes from the current table: the new `projectFileId` column, and `uniqueIndex('uq_attachments_key')` becoming a plain `index('ix_attachments_key')`. `projectFiles` is already defined earlier in this same file (line 138), so the reference resolves.

- [ ] **Step 2: Generate the migration**

Run: `cd backend && npm run db:generate`
Expected: a new file appears under `backend/drizzle/`, e.g. `0001_<two-word-name>.sql`, containing an `ALTER TABLE "attachments" ADD COLUMN "project_file_id" uuid;`, a `DROP INDEX "uq_attachments_key"`, a new non-unique index, and a foreign key constraint to `project_files`.

- [ ] **Step 3: Apply it**

Run: `docker start arcnave-pg` (if not already running), then `cd backend && npm run db:migrate`
Expected: output confirms the new migration applied with no errors.

- [ ] **Step 4: Verify nothing broke**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all existing tests still pass (the test database's global setup re-runs migrations against a fresh `arcnave_test` database, so this also proves the migration is valid from empty).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/
git commit -m "$(cat <<'EOF'
Let an attachment reuse an existing project file's storage key

Adds attachments.projectFileId so a message can reference a project file
directly instead of re-uploading it. Storage-key uniqueness on attachments
is dropped: the same project file can now back more than one attachment row.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Routing — vision capability filter

**Files:**
- Modify: `backend/src/providers/registry.ts:23-33` (`ModelEntry`), `:51-98` (`buildEntries`)
- Modify: `backend/src/providers/routing.ts:12-20` (`RoutingInput`), `:86-94` (`routeAuto`'s candidate filter)
- Modify: `backend/src/providers/routing.test.ts:16-46` (fixtures), plus new test cases

**Interfaces:**
- Consumes: nothing new.
- Produces: `ModelEntry.supportsVision: boolean` and `RoutingInput.requiresVision: boolean`, both consumed by Task 7 (`generation.ts`'s `resolveModel`).

- [ ] **Step 1: Add `supportsVision` to `ModelEntry` and each table row**

In `backend/src/providers/registry.ts`, add the field to the interface (after `supportsGrounding`):

```typescript
export interface ModelEntry {
  alias: string;
  description: string;
  provider: 'google' | 'anthropic' | 'openai-oss';
  tier: Tier;
  providerModelId: string | undefined;
  location: string;
  supportsGrounding: boolean;
  supportsVision: boolean;
  contextWindow: number | null;
}
```

Then set it on each of the four entries in `buildEntries` — `true` for Gemini 3.8 Flash, Sonnet 5, and Opus 5 (add `supportsVision: true,` right after each `supportsGrounding: true,` line), and `false` for GPT-OSS 120B (add `supportsVision: false,` after its `supportsGrounding: false,` line, with a one-line comment: `// gpt-oss-120b has no vision capability on Vertex or anywhere else.`).

- [ ] **Step 2: Add `requiresVision` to `RoutingInput` and the candidate filter**

In `backend/src/providers/routing.ts`, add to the interface:

```typescript
export interface RoutingInput {
  mode: Mode;
  promptChars: number;
  contextChars: number;
  hasAttachments: boolean;
  requiresVision: boolean;
  routingPreference: Tier;
  requiresGrounding: boolean;
}
```

Replace the candidate-selection line in `routeAuto` (currently `const candidates = input.requiresGrounding ? available.filter((e) => e.supportsGrounding) : available;`) with:

```typescript
  const candidates = available.filter(
    (e) => (!input.requiresGrounding || e.supportsGrounding) && (!input.requiresVision || e.supportsVision),
  );
```

- [ ] **Step 3: Update the test fixtures**

In `backend/src/providers/routing.test.ts`, the `entry()` helper (lines 16-27) builds a `ModelEntry` missing the new field — add `supportsVision` as a parameter:

```typescript
function entry(alias: string, tier: Tier, supportsGrounding: boolean, supportsVision = true): ModelEntry {
  return {
    alias,
    description: '',
    provider: alias === 'Gemini' ? 'google' : 'anthropic',
    tier,
    providerModelId: `model-${alias}`,
    location: 'global',
    supportsGrounding,
    supportsVision,
    contextWindow: 1_000,
  };
}
```

(Default `true` so the four existing `entry(...)` call sites for GEMINI/SONNET/OPUS/GPT_OSS don't need editing — GPT_OSS's call site is updated in the next step to pass `false` explicitly, since that's the one entry this feature cares about.)

Update the `GPT_OSS` line to be explicit about the one case that matters:

```typescript
const GPT_OSS = entry('GPT-OSS', 'balanced', false, false);
```

Add `requiresVision: false` to the `input()` helper's defaults (lines 36-46):

```typescript
function input(over: Partial<RoutingInput> = {}): RoutingInput {
  return {
    mode: 'chat',
    promptChars: 10,
    contextChars: 0,
    hasAttachments: false,
    requiresVision: false,
    routingPreference: 'balanced',
    requiresGrounding: false,
    ...over,
  };
}
```

- [ ] **Step 4: Write the failing tests**

Add to the `describe('routeAuto', ...)` block in `routing.test.ts`:

```typescript
  it('never considers a vision-incapable model when vision is required', () => {
    const decision = routeAuto(input({ requiresVision: true }), cfg, ALL);
    expect(decision?.considered).not.toContain('GPT-OSS');
  });

  it('returns null when nothing configured can see an attachment', () => {
    expect(routeAuto(input({ requiresVision: true }), cfg, [GPT_OSS])).toBeNull();
  });

  it('combines the grounding and vision filters', () => {
    // GPT-OSS fails both; only a model with both capabilities should be considered.
    const decision = routeAuto(
      input({ requiresGrounding: true, requiresVision: true }),
      cfg,
      ALL,
    );
    expect(decision?.considered).toEqual(['Gemini', 'Sonnet', 'Opus']);
  });
```

- [ ] **Step 5: Run the tests to verify they fail first, then pass**

Run: `cd backend && npx vitest run src/providers/routing.test.ts`
Expected: before Step 1-2's production code changes, `requiresVision` doesn't exist and this fails to typecheck. Since Steps 1-2 are already done by this point in the task, instead just confirm: run it once before writing Step 4's tests (to confirm the suite is green with only the fixture changes), then again after adding the tests (to confirm the three new cases pass, and the whole file — 13 tests total — passes).

- [ ] **Step 6: Full backend check**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean. Nothing else in the codebase references `ModelEntry` or `RoutingInput` in a way that would break (verify with `grep -rn "supportsGrounding" backend/src --include=*.ts` if unsure — every construction site of `ModelEntry` is `registry.ts`'s `buildEntries` and `routing.test.ts`'s `entry()`, both already updated).

- [ ] **Step 7: Commit**

```bash
git add backend/src/providers/registry.ts backend/src/providers/routing.ts backend/src/providers/routing.test.ts
git commit -m "$(cat <<'EOF'
Add a vision capability filter to Auto routing

Mirrors the existing grounding filter: ModelEntry.supportsVision is a
static per-provider fact (false only for gpt-oss-120b), and routeAuto
excludes vision-incapable candidates whenever requiresVision is set.
Nothing wires requiresVision to true yet — that lands with generation.ts
in a later task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `Turn` and `GenerationRequest` gain `attachments`

**Files:**
- Modify: `backend/src/providers/types.ts:72-87`

**Interfaces:**
- Produces: `AttachmentBlock { mimeType: string; base64: string }`, `Turn.attachments?: AttachmentBlock[]`, `GenerationRequest.attachments?: AttachmentBlock[]`. Consumed by Tasks 4, 5, and 7.

- [ ] **Step 1: Add the type and the two fields**

In `backend/src/providers/types.ts`, insert before the `Turn` interface (currently at line 72):

```typescript
/** An image or PDF, ready to hand a provider as a native content block. */
export interface AttachmentBlock {
  mimeType: string;
  base64: string;
}
```

Then change `Turn` (currently lines 72-75) to:

```typescript
export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Present only for a turn that had an image/PDF attached; carried forward on every later
   *  turn of the same chat so the model keeps "seeing" it, per the design's caching strategy. */
  attachments?: AttachmentBlock[];
}
```

And add a field to `GenerationRequest` (currently lines 77-87), right after `history`:

```typescript
export interface GenerationRequest {
  prompt: string;
  history: Turn[];
  /** Images/PDFs attached to *this* turn specifically, as opposed to `history[].attachments`
   *  which are carried forward from earlier turns. */
  attachments?: AttachmentBlock[];
  systemInstruction: string;
  mode: Mode;
  maxOutputTokens: number;
  providerModelId: string;
  grounded: boolean;
  signal: AbortSignal;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: clean — these are additive optional fields, so nothing that already constructs a `Turn` or `GenerationRequest` needs to change yet.

- [ ] **Step 3: Commit**

```bash
git add backend/src/providers/types.ts
git commit -m "$(cat <<'EOF'
Add AttachmentBlock and thread it through Turn and GenerationRequest

Both fields are optional so this lands with zero behavior change — nothing
populates them yet. The adapters and generation service that read and
write them follow in the next tasks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Anthropic adapter — native blocks and cache_control

**Files:**
- Modify: `backend/package.json` (add `@anthropic-ai/sdk` as a direct dependency)
- Modify: `backend/src/providers/anthropicVertex.ts:1-19` (imports), `:114-122` (`buildMessages`)
- Create: `backend/src/providers/anthropicVertex.test.ts`

**Interfaces:**
- Consumes: `AttachmentBlock`, `Turn`, `GenerationRequest` from Task 3.
- Produces: exported `buildAnthropicMessages(request: GenerationRequest): Anthropic.MessageParam[]`, consumed only by this file's own `stream()` method (nothing else calls it directly, but it must be exported for the test file to import it).

- [ ] **Step 1: Add the explicit dependency**

`@anthropic-ai/sdk` is already present in `node_modules` (a transitive dependency of `@anthropic-ai/vertex-sdk`, currently resolved at `0.126.0`), but nothing in `package.json` says so — the next step's `import type Anthropic from '@anthropic-ai/sdk'` would otherwise rely on hoisting that could change. In `backend/package.json`, add to `"dependencies"` (matching whatever version is currently installed):

```json
    "@anthropic-ai/sdk": "^0.126.0",
```

Run: `cd backend && npm install`
Expected: `package-lock.json` updates; no version actually changes since it's already installed transitively.

- [ ] **Step 2: Write the failing test**

Create `backend/src/providers/anthropicVertex.test.ts`:

```typescript
/**
 * Message construction for the Anthropic/Vertex adapter.
 *
 * No network, no SDK client — `buildAnthropicMessages` is a pure function of
 * `GenerationRequest`. What matters here: image/PDF attachments become the right block shape,
 * text-only turns stay a plain string (cheapest wire shape), and the cache_control breakpoint
 * lands on exactly one block — the last one of the second-to-last message — never on the
 * newest user turn, which is different on every call by definition.
 */
import { describe, expect, it } from 'vitest';

import { buildAnthropicMessages } from './anthropicVertex.js';
import type { GenerationRequest } from './types.js';

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'What is this?',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: 'claude-sonnet-5',
    grounded: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('buildAnthropicMessages', () => {
  it('sends a plain string for a text-only turn, matching today\'s wire shape', () => {
    const messages = buildAnthropicMessages(baseRequest());
    expect(messages).toEqual([{ role: 'user', content: 'What is this?' }]);
  });

  it('puts an image block before the text block for an attachment on the current turn', () => {
    const messages = buildAnthropicMessages(
      baseRequest({ attachments: [{ mimeType: 'image/png', base64: 'AAAA' }] }),
    );
    expect(messages).toHaveLength(1);
    const content = messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as Array<{ type: string }>;
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text']);
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(blocks[1]).toMatchObject({ type: 'text', text: 'What is this?' });
  });

  it('sends a PDF as a document block, not an image block', () => {
    const messages = buildAnthropicMessages(
      baseRequest({ attachments: [{ mimeType: 'application/pdf', base64: 'BBBB' }] }),
    );
    const blocks = messages[0]!.content as Array<{ type: string; source?: { media_type?: string } }>;
    expect(blocks[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' },
    });
  });

  it('carries a history attachment forward as its own block', () => {
    const messages = buildAnthropicMessages(
      baseRequest({
        history: [
          {
            role: 'user',
            text: 'Look at this photo',
            attachments: [{ mimeType: 'image/jpeg', base64: 'CCCC' }],
          },
          { role: 'assistant', text: 'I see a cat.' },
        ],
      }),
    );
    expect(messages).toHaveLength(3);
    const firstBlocks = messages[0]!.content as Array<{ type: string }>;
    expect(firstBlocks.map((b) => b.type)).toEqual(['image', 'text']);
    expect(messages[1]).toEqual({ role: 'assistant', content: 'I see a cat.' });
    expect(messages[2]).toEqual({ role: 'user', content: 'What is this?' });
  });

  it('caches through the second-to-last message, never the newest user turn', () => {
    const messages = buildAnthropicMessages(
      baseRequest({
        history: [
          { role: 'user', text: 'First question' },
          { role: 'assistant', text: 'First answer' },
        ],
      }),
    );
    expect(messages).toHaveLength(3);
    // The cached message (index 1, "First answer") gets wrapped into a block array so the
    // cache_control marker has somewhere to live, even though it started as a plain string.
    const cached = messages[1]!.content as Array<{ cache_control?: unknown }>;
    expect(cached[cached.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
    // Neither the first message nor the newest user turn is cached.
    expect(typeof messages[0]!.content).toBe('string');
    expect(messages[2]!.content).toBe('What is this?');
  });

  it('does not add a cache breakpoint to a single-turn conversation', () => {
    const messages = buildAnthropicMessages(baseRequest());
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe('What is this?');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && npx vitest run src/providers/anthropicVertex.test.ts`
Expected: FAIL — `buildAnthropicMessages` is not exported yet.

- [ ] **Step 4: Extract and export `buildAnthropicMessages`, add blocks and caching**

In `backend/src/providers/anthropicVertex.ts`, add to the imports at the top:

```typescript
import type Anthropic from '@anthropic-ai/sdk';
```

Replace the private method (currently lines 114-122):

```typescript
  private buildMessages(request: GenerationRequest): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages = request.history
      .filter((turn) => turn.text.trim() !== '')
      .map((turn) => ({ role: turn.role, content: turn.text }));
    // The API requires the sequence to start with a user turn.
    while (messages.length > 0 && messages[0]!.role !== 'user') messages.shift();
    messages.push({ role: 'user', content: request.prompt });
    return messages;
  }
```

with a module-level exported function, placed above the `AnthropicVertexProvider` class:

```typescript
type CacheableBlock = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam | Anthropic.TextBlockParam;

function attachmentBlocks(attachments: GenerationRequest['attachments']): CacheableBlock[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((a): CacheableBlock =>
    a.mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: a.mimeType as Anthropic.Base64ImageSource['media_type'],
            data: a.base64,
          },
        },
  );
}

/**
 * Build the Anthropic message array for one request, including caching.
 *
 * A turn with an attachment becomes a content-block array (media first, text last — Anthropic's
 * documented order); a plain-text turn stays a bare string, the cheapest wire shape. The
 * `cache_control` breakpoint marks everything through the previous assistant turn as cacheable;
 * the newest user turn is never marked, since by definition it is new on every call. Vertex only
 * supports the SDK's default 5-minute cache — the 1-hour variant needs an `anthropic-beta` header
 * Vertex rejects, so none is sent here.
 */
export function buildAnthropicMessages(request: GenerationRequest): Anthropic.MessageParam[] {
  const turns = request.history.filter(
    (turn) => turn.text.trim() !== '' || (turn.attachments?.length ?? 0) > 0,
  );

  const messages: { role: 'user' | 'assistant'; content: string | CacheableBlock[] }[] = turns.map(
    (turn) => {
      const blocks = attachmentBlocks(turn.attachments);
      if (blocks.length === 0) return { role: turn.role, content: turn.text };
      const content: CacheableBlock[] = [...blocks];
      if (turn.text.trim() !== '') content.push({ type: 'text', text: turn.text });
      return { role: turn.role, content };
    },
  );

  // The API requires the sequence to start with a user turn.
  while (messages.length > 0 && messages[0]!.role !== 'user') messages.shift();

  const currentBlocks = attachmentBlocks(request.attachments);
  if (currentBlocks.length === 0) {
    messages.push({ role: 'user', content: request.prompt });
  } else {
    messages.push({ role: 'user', content: [...currentBlocks, { type: 'text', text: request.prompt }] });
  }

  if (messages.length > 1) {
    const cached = messages[messages.length - 2]!;
    if (typeof cached.content === 'string') {
      cached.content = [{ type: 'text', text: cached.content, cache_control: { type: 'ephemeral' } }];
    } else if (cached.content.length > 0) {
      cached.content[cached.content.length - 1]!.cache_control = { type: 'ephemeral' };
    }
  }

  return messages as Anthropic.MessageParam[];
}
```

Then update the call site inside `stream()` (currently `messages: this.buildMessages(request),`) to:

```typescript
          messages: buildAnthropicMessages(request),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/providers/anthropicVertex.test.ts`
Expected: PASS, all 6 cases.

- [ ] **Step 6: Full backend check**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/providers/anthropicVertex.ts backend/src/providers/anthropicVertex.test.ts
git commit -m "$(cat <<'EOF'
Send image/PDF attachments as native Anthropic content blocks

buildAnthropicMessages is now an exported, directly-testable function.
Attachments become image/document blocks ahead of the turn's text block;
a cache_control breakpoint covers everything through the previous
assistant turn, so a multi-turn conversation with an attached file pays
Vertex's 5-minute-cache discount on every turn after the first.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Gemini adapter — native `inlineData` parts

**Files:**
- Modify: `backend/src/providers/gemini.ts:1-14` (imports), `:76-84` (`buildContents`)
- Create: `backend/src/providers/gemini.test.ts`

**Interfaces:**
- Consumes: `AttachmentBlock`, `Turn`, `GenerationRequest` from Task 3.
- Produces: exported `buildGeminiContents(request: GenerationRequest): Content[]`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/providers/gemini.test.ts`:

```typescript
/**
 * Content construction for the Gemini/Vertex adapter.
 *
 * No network, no SDK client. Unlike Anthropic, Gemini needs no explicit cache marker in the
 * request — Vertex's implicit caching is automatic for a repeated prefix. What has to be right
 * here is purely the shape: attachments become inlineData parts ahead of the turn's text part,
 * in the same stable order every call, since a reordered prefix is what would defeat the
 * implicit cache.
 */
import { describe, expect, it } from 'vitest';

import { buildGeminiContents } from './gemini.js';
import type { GenerationRequest } from './types.js';

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'What is this?',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: 'gemini-3.8-flash',
    grounded: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('buildGeminiContents', () => {
  it('sends a text-only part for a plain turn', () => {
    expect(buildGeminiContents(baseRequest())).toEqual([
      { role: 'user', parts: [{ text: 'What is this?' }] },
    ]);
  });

  it('puts inlineData ahead of the text part for a current-turn attachment', () => {
    const contents = buildGeminiContents(
      baseRequest({ attachments: [{ mimeType: 'image/png', base64: 'AAAA' }] }),
    );
    expect(contents).toEqual([
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'What is this?' }],
      },
    ]);
  });

  it('carries a history attachment forward as its own part, mapping assistant to model', () => {
    const contents = buildGeminiContents(
      baseRequest({
        history: [
          {
            role: 'user',
            text: 'Look at this scan',
            attachments: [{ mimeType: 'application/pdf', base64: 'BBBB' }],
          },
          { role: 'assistant', text: 'It is a receipt.' },
        ],
      }),
    );
    expect(contents).toEqual([
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: 'BBBB' } },
          { text: 'Look at this scan' },
        ],
      },
      { role: 'model', parts: [{ text: 'It is a receipt.' }] },
      { role: 'user', parts: [{ text: 'What is this?' }] },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/providers/gemini.test.ts`
Expected: FAIL — `buildGeminiContents` is not exported yet.

- [ ] **Step 3: Extract and export `buildGeminiContents`**

In `backend/src/providers/gemini.ts`, add to the imports:

```typescript
import type { Content, Part, Blob as GeminiBlob } from '@google/genai';
```

Replace the private method (currently lines 76-84):

```typescript
  private buildContents(request: GenerationRequest) {
    return [
      ...request.history.map((turn) => ({
        role: turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: turn.text }],
      })),
      { role: 'user', parts: [{ text: request.prompt }] },
    ];
  }
```

with a module-level exported function, placed above the `GeminiProvider` class:

```typescript
function attachmentParts(attachments: GenerationRequest['attachments']): Part[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((a): Part => ({
    inlineData: { mimeType: a.mimeType, data: a.base64 } satisfies GeminiBlob,
  }));
}

/**
 * Build the Gemini contents array for one request.
 *
 * No cache marker is set here, unlike the Anthropic adapter — Vertex's implicit caching for
 * Gemini 2.5+/3.x models is automatic on a repeated prefix, with no request changes needed. The
 * only thing this function has to get right for that to work is stability: the same history in
 * the same order, byte-identical, every call for the same chat.
 */
export function buildGeminiContents(request: GenerationRequest): Content[] {
  const turns = request.history.filter(
    (turn) => turn.text.trim() !== '' || (turn.attachments?.length ?? 0) > 0,
  );

  const historyContents: Content[] = turns.map((turn) => {
    const parts: Part[] = [...attachmentParts(turn.attachments)];
    if (turn.text.trim() !== '') parts.push({ text: turn.text });
    return { role: turn.role === 'user' ? 'user' : 'model', parts };
  });

  const currentParts: Part[] = [...attachmentParts(request.attachments), { text: request.prompt }];
  return [...historyContents, { role: 'user', parts: currentParts }];
}
```

Then update the call site inside `stream()` (currently `contents: this.buildContents(request),`) and `probe()` is untouched (it sends a literal `'ping'` string, unrelated):

```typescript
        contents: buildGeminiContents(request),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/providers/gemini.test.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Full backend check**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/providers/gemini.ts backend/src/providers/gemini.test.ts
git commit -m "$(cat <<'EOF'
Send image/PDF attachments as native Gemini inlineData parts

buildGeminiContents is now exported and directly testable. No explicit
cache wiring needed here — Vertex's implicit caching for Gemini 2.5+/3.x
is automatic given a stable, repeated prefix, which this function already
produces by construction.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `files.ts` — skip extraction for images/PDFs, `viewable`, pick-from-project

**Files:**
- Modify: `backend/src/routes/files.ts` (imports, upload handler, `toDto`, `attachmentSchema`, delete handler, new route)
- Modify: `backend/src/routes/files.integration.test.ts` (update one existing test, add new ones)

**Interfaces:**
- Consumes: `attachments.projectFileId` from Task 1.
- Produces: `attachmentSchema.viewable: boolean` (new DTO field), `POST /files/from-project` route. Neither is consumed elsewhere in this plan — the frontend attachment picker is out of scope here (backend-only plan).

- [ ] **Step 1: Update the existing "PNG is unsupported" test to the new expectation**

This test currently documents behavior this feature deliberately changes. In `backend/src/routes/files.integration.test.ts`, replace the test at lines 60-70:

```typescript
  it('stores a file it cannot read as unsupported, with the reason, rather than rejecting it', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 3),
    ]);
    const { statusCode, body } = await upload('pic.png', png, 'image/png');

    expect(statusCode).toBe(201);
    expect(body).toMatchObject({ status: 'unsupported', hasText: false });
    expect(String(body['error'])).toContain('not indexed');
  });
```

with:

```typescript
  it('marks an image as viewable rather than running text extraction on it', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 3),
    ]);
    const { statusCode, body } = await upload('pic.png', png, 'image/png');

    expect(statusCode).toBe(201);
    expect(body).toMatchObject({ status: 'ready', hasText: false, viewable: true, error: '' });
  });

  it('marks a plain text file as not viewable', async () => {
    const { body } = await upload('notes.txt', 'the budget is due friday');
    expect(body).toMatchObject({ viewable: false, hasText: true });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/routes/files.integration.test.ts`
Expected: FAIL — the route still runs extraction on images and never sets `viewable`.

- [ ] **Step 3: Update the upload handler, DTO, and schema**

In `backend/src/routes/files.ts`, the file already imports `attachments`, `ApiError`, and `notFound` from their respective modules — add `projectFiles` to the existing schema import line:

```typescript
import { attachments, projectFiles } from '../db/schema.js';
```

Add `viewable` to `attachmentSchema` (currently lines 27-39), right after `hasText`:

```typescript
const attachmentSchema = z.object({
  id: z.string(),
  messageId: z.string().nullable(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: z.string(),
  error: z.string(),
  hasText: z.boolean(),
  /** True for an image or PDF the model can read directly, regardless of whether text
   *  extraction would have succeeded — this is a different question from `hasText`. */
  viewable: z.boolean(),
  createdAt: z.string().nullable(),
});
```

Add a small helper near the top of the file, after the `MAX_EXTRACTED_CHARS` constant:

```typescript
function isNativelyViewable(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/');
}
```

In the `POST /files` handler, replace the extraction block (currently the `let extractedText = null; ... catch { ... }` block right after `await storage.put(...)`):

```typescript
      // Images and PDFs are read by the model directly (see the multimodal file input design)
      // — there is nothing useful to extract, and extracting anyway would just be discarded
      // work. Extraction failing for any other type is not upload failing: a format nothing
      // here can read is stored with a machine-readable reason, never silently dropped.
      let extractedText: string | null = null;
      let status = 'ready';
      let error = '';
      if (!isNativelyViewable(check.mimeType)) {
        try {
          const text = await extractText(data, check.mimeType, part.filename);
          extractedText = text.slice(0, MAX_EXTRACTED_CHARS);
          if (text.length > MAX_EXTRACTED_CHARS) {
            error =
              `Only the first ${MAX_EXTRACTED_CHARS.toLocaleString('en-US')} characters of ` +
              'this file are sent with your message.';
          }
        } catch (err) {
          if (err instanceof ExtractionUnsupported) {
            status = 'unsupported';
            error = err.message;
          } else {
            request.log.error({ err }, 'attachment extraction failed');
            status = 'unsupported';
            error = 'The text of this file could not be read. It is stored but will not be sent.';
          }
        }
      }
```

Update `toDto` (currently lines 255-267):

```typescript
function toDto(row: AttachmentRow): z.infer<typeof attachmentSchema> {
  return {
    id: row.id,
    messageId: row.messageId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    hasText: Boolean(row.extractedText?.trim()),
    viewable: isNativelyViewable(row.mimeType),
    createdAt: iso(row.createdAt),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/routes/files.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `/files/from-project` and the delete guard**

Add to `backend/src/routes/files.integration.test.ts` (needs a project to attach a file to — check the top of `projects.integration.test.ts` for the `createProject` helper pattern, or inline a minimal `POST /v1/projects` + `POST /v1/projects/:id/files` call):

```typescript
describe('picking a file from a project', () => {
  async function createProjectWithFile(): Promise<{ projectId: string; projectFileId: string }> {
    const projectRes = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: auth(),
      payload: { title: 'Multimodal test project' },
    });
    expect(projectRes.statusCode).toBe(201);
    const projectId = (projectRes.json() as { id: string }).id;

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 5),
    ]);
    const part = multipart('scan.png', png, 'image/png');
    const fileRes = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/files`,
      headers: { ...part.headers, ...auth() },
      payload: part.payload,
    });
    expect(fileRes.statusCode).toBe(201);
    return { projectId, projectFileId: (fileRes.json() as { id: string }).id };
  }

  it('attaches an existing project file without re-uploading its bytes', async () => {
    const { projectFileId } = await createProjectWithFile();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/from-project',
      headers: auth(),
      payload: { projectFileId },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      filename: 'scan.png',
      mimeType: 'image/png',
      viewable: true,
      messageId: null,
    });
  });

  it('refuses a project file owned by someone else', async () => {
    const { projectFileId } = await createProjectWithFile();
    const other = await signUp(ctx);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/from-project',
      headers: { cookie: other.cookie },
      payload: { projectFileId },
    });

    expect(response.statusCode).toBe(404);
  });

  it('deleting an attachment sourced from a project file does not delete the project file', async () => {
    const { projectId, projectFileId } = await createProjectWithFile();

    const picked = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files/from-project',
      headers: auth(),
      payload: { projectFileId },
    });
    const attachmentId = (picked.json() as { id: string }).id;

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/files/${attachmentId}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);

    // The project file itself, and its stored bytes, must still be there.
    const stillThere = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/files/${projectFileId}/download`,
      headers: auth(),
    });
    expect(stillThere.statusCode).toBe(200);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npx vitest run src/routes/files.integration.test.ts`
Expected: FAIL — `/files/from-project` doesn't exist (404), and the delete guard doesn't check `projectFileId` yet.

- [ ] **Step 7: Add the route and fix the delete guard**

In `backend/src/routes/files.ts`, add a new route after the existing `POST /files` handler (before `/* ---------------------------------------------------------------- read */`):

```typescript
  /* ---------------------------------------------------------------- from project */

  typed.post(
    '/files/from-project',
    {
      schema: {
        tags: ['projects'],
        summary: 'Attach an existing project file to a message',
        description:
          "Reuses the project file's stored bytes rather than re-uploading. Returns an id to " +
          'pass in `attachmentIds` on the next generate call, same as `POST /files`.',
        body: z.object({ projectFileId: z.string().uuid() }),
        response: { 201: attachmentSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;

      const [file] = await db
        .select()
        .from(projectFiles)
        .where(and(eq(projectFiles.id, request.body.projectFileId), eq(projectFiles.userId, user.id)))
        .limit(1);
      if (!file) throw notFound('file');

      const [created] = await db
        .insert(attachments)
        .values({
          userId: user.id,
          projectFileId: file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageKey: file.storageKey,
          status: 'ready',
          error: '',
          extractedText: null,
        })
        .returning();

      return reply.status(201).send(toDto(created!));
    },
  );
```

Fix the delete handler (currently the `DELETE /files/:id` handler's body) so it never deletes storage bytes owned by a project file:

```typescript
      await db.delete(attachments).where(eq(attachments.id, file.id));
      if (!file.projectFileId) {
        try {
          await storage.delete(file.storageKey);
        } catch (err) {
          request.log.warn({ err, storageKey: file.storageKey }, 'orphaned object after delete');
        }
      }
      return reply.status(204).send(null);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/routes/files.integration.test.ts`
Expected: PASS, all cases including the three new ones.

- [ ] **Step 9: Full backend check and OpenAPI regen**

Run: `cd backend && npx tsc --noEmit && npx vitest run && npm run openapi`
Expected: clean; `docs/openapi.json` now includes `viewable` in the attachment schema and a new `/v1/files/from-project` path.

- [ ] **Step 10: Commit**

```bash
git add backend/src/routes/files.ts backend/src/routes/files.integration.test.ts docs/openapi.json
git commit -m "$(cat <<'EOF'
Stop extracting text from images/PDFs; let a project file be attached directly

Images and PDFs skip extractText() entirely now — there's nothing to
extract when the model reads the file itself (see the multimodal file
input design). The attachment DTO gains `viewable` so the UI can say
"ArcNave can see this" instead of the old "unsupported." New
POST /files/from-project reuses an existing project file's bytes without
re-uploading; deleting such an attachment no longer deletes the project
file's storage object out from under it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `generation.ts` / `chats.ts` — capability gate, carry-forward, wiring

**Files:**
- Modify: `backend/src/config.ts` (new env var)
- Modify: `backend/src/services/generation.ts` (constructor, `GenerateInput`, `resolveModel`, `loadHistory`, `run`)
- Modify: `backend/src/container.ts` (pass `storage` to `GenerationService`)
- Modify: `backend/src/routes/chats.ts` (generate handler's attachment-gathering block)
- Modify: `backend/src/routes/chats.integration.test.ts` (new tests)

**Interfaces:**
- Consumes: `ModelEntry.supportsVision` and `RoutingInput.requiresVision` (Task 2), `AttachmentBlock`/`Turn.attachments`/`GenerationRequest.attachments` (Task 3), `attachments` upload/pick-from-project (Task 6).
- Produces: nothing further downstream — this is the last wiring point; Tasks 4 and 5's adapters now receive real data end-to-end.

- [ ] **Step 1: Add the config value**

In `backend/src/config.ts`, add after `HISTORY_MAX_TURNS: int(20),`:

```typescript
  /** Bytes of image/PDF attachment data carried forward from earlier turns in one chat, total,
   *  per generate call. Oldest carried-forward attachments drop first past this cap; a file
   *  newly attached to the current turn is never dropped by it. */
  HISTORY_MAX_ATTACHMENT_BYTES: int(12_000_000),
```

- [ ] **Step 2: Wire `ObjectStorage` into `GenerationService`**

In `backend/src/services/generation.ts`, add an import:

```typescript
import type { ObjectStorage } from './storage.js';
```

Change the constructor (currently lines 142-148):

```typescript
export class GenerationService {
  constructor(
    private readonly db: Database,
    private readonly cfg: Config,
    private readonly registry: ModelRegistry,
    private readonly usage: UsageService,
    private readonly retriever: Retriever,
    private readonly storage: ObjectStorage,
  ) {}
```

In `backend/src/container.ts`, change the construction line (currently `const generation = new GenerationService(db, cfg, registry, usage, retriever);`):

```typescript
  const generation = new GenerationService(db, cfg, registry, usage, retriever, storage);
```

(`storage` is already defined above that line in the same function.)

- [ ] **Step 3: Add `attachments` to `GenerateInput`**

In `backend/src/services/generation.ts`, add an import for the new type:

```typescript
import type {
  AttachmentBlock,
  GenerationRequest,
  Mode,
  ProviderEvent,
  ProviderSource,
  ProviderUsage,
  Turn,
} from '../providers/types.js';
```

Add a field to `GenerateInput` (currently lines 114-127), after `attachmentText`:

```typescript
export interface GenerateInput {
  userId: string;
  requestId: string;
  chatId: string;
  messageId: string;
  prompt: string;
  mode: Mode;
  modelAlias: string;
  projectId: string | null;
  hasAttachments: boolean;
  attachmentText: string;
  /** This turn's image/PDF attachments, ready as native content blocks. */
  attachments: AttachmentBlock[];
  signal: AbortSignal;
}
```

- [ ] **Step 4: Write the failing tests in `chats.integration.test.ts`**

These exercise the whole pipeline (route → generation service → fake provider), which is the only place this can be tested end-to-end without mocking internals. Add to `backend/src/routes/chats.integration.test.ts`:

```typescript
describe('vision capability gate', () => {
  it('refuses to send an image to a model that cannot see it', async () => {
    const chatId = await newChat();
    const part = multipart(
      'photo.png',
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]),
      'image/png',
    );
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...part.headers, ...auth() },
      payload: part.payload,
    });
    expect(upload.statusCode).toBe(201);
    const attachmentId = (upload.json() as { id: string }).id;

    const response = await generate(chatId, {
      model: 'GPT-OSS 120B',
      attachmentIds: [attachmentId],
    });

    expect(response.statusCode).toBe(200);
    const frames = parseSse(response.body);
    const errorFrame = frames.find((f) => f.event === 'error');
    expect(errorFrame?.data['code']).toBe('capability_unavailable');
  });
});

describe('attachments carried across turns', () => {
  it('re-sends an image attached in an earlier turn on a later one', async () => {
    const chatId = await newChat();
    const part = multipart(
      'photo.png',
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 2)]),
      'image/png',
    );
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...part.headers, ...auth() },
      payload: part.payload,
    });
    const attachmentId = (upload.json() as { id: string }).id;

    const first = await generate(chatId, { prompt: 'What is in this photo?', attachmentIds: [attachmentId] });
    expect(first.statusCode).toBe(200);

    const second = await generate(chatId, { prompt: 'Describe it again, differently.' });
    expect(second.statusCode).toBe(200);

    // provider.seen[0] is the first turn's request, [1] is the second's.
    const secondRequest = ctx.provider.seen[ctx.provider.seen.length - 1]!;
    const carried = secondRequest.history.find((t) => (t.attachments?.length ?? 0) > 0);
    expect(carried?.attachments?.[0]).toMatchObject({ mimeType: 'image/png' });
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/routes/chats.integration.test.ts`
Expected: FAIL — the capability gate doesn't exist yet (a real call to the fake `openai-oss` provider would just succeed), and `GenerateInput`/`GenerationRequest` don't carry attachments through yet, so `history[].attachments` is always undefined.

- [ ] **Step 6: Reorder `run()`, add the capability gate, update `resolveModel`**

In `backend/src/services/generation.ts`, inside `run()` (currently starting line 157), the model is resolved *before* history is loaded. Move history-loading earlier so `requiresVision` can account for attachments carried from past turns, not just the current one. Replace this block (currently lines 158-176):

```typescript
    const startedAt = new Date();
    const prefs = await this.loadPreferences(input.userId);

    const project = input.projectId ? await this.loadProject(input.userId, input.projectId) : null;

    // --- resolve the model ------------------------------------------------
    const requiresGrounding = input.mode !== 'chat';
    const { entry, routing } = await this.resolveModel(
      input,
      prefs,
      requiresGrounding,
      project?.instructions.length ?? 0,
    );
    const provider = this.registry.providerFor(entry);
    if (!provider) {
      throw new ApiError('model_unavailable', {
        detail: `No adapter is registered for provider "${entry.provider}".`,
      });
    }
```

with:

```typescript
    const startedAt = new Date();
    const prefs = await this.loadPreferences(input.userId);

    const project = input.projectId ? await this.loadProject(input.userId, input.projectId) : null;
    // Loaded before model resolution (not its historical position) because whether this turn
    // needs a vision-capable model depends on what's carried forward, not only on what's newly
    // attached — and loadHistory has no dependency on which model gets picked.
    const history = await this.loadHistory(input.chatId, input.messageId);

    // --- resolve the model ------------------------------------------------
    const requiresGrounding = input.mode !== 'chat';
    const requiresVision =
      input.attachments.length > 0 || history.some((t) => (t.attachments?.length ?? 0) > 0);
    const { entry, routing } = await this.resolveModel(
      input,
      prefs,
      requiresGrounding,
      requiresVision,
      project?.instructions.length ?? 0,
    );
    const provider = this.registry.providerFor(entry);
    if (!provider) {
      throw new ApiError('model_unavailable', {
        detail: `No adapter is registered for provider "${entry.provider}".`,
      });
    }
```

A few lines further down, remove the now-duplicate history load (currently `const history = await this.loadHistory(input.chatId, input.messageId);` right after the `yield { type: 'start', ... }` block) — delete that line entirely, since `history` is already in scope from the move above.

Update `resolveModel` (currently lines 393-436) to take and use `requiresVision`:

```typescript
  private async resolveModel(
    input: GenerateInput,
    prefs: PreferencesRow,
    requiresGrounding: boolean,
    requiresVision: boolean,
    contextChars: number,
  ): Promise<{ entry: ModelEntry; routing: RoutingDecision | null }> {
    if (input.modelAlias !== AUTO_ALIAS) {
      const status = await this.registry.status(input.modelAlias);
      if (!status) {
        throw new ApiError('model_unavailable', {
          detail: `"${input.modelAlias}" is not a known model.`,
        });
      }
      if (!status.available) {
        throw new ApiError('model_unavailable', {
          detail: status.detail,
          meta: { alias: input.modelAlias, reason: status.reason },
        });
      }
      if (requiresVision && !status.entry.supportsVision) {
        throw new ApiError('capability_unavailable', {
          detail:
            `"${input.modelAlias}" cannot see images or PDFs. Choose a different model, or ` +
            'remove the attachment.',
          meta: { alias: input.modelAlias, capability: 'vision' },
        });
      }
      return { entry: status.entry, routing: null };
    }

    const available = await this.registry.availableEntries();
    const decision = routeAuto(
      {
        mode: input.mode,
        promptChars: input.prompt.length,
        contextChars,
        hasAttachments: input.hasAttachments,
        requiresVision,
        routingPreference: normalizeTier(prefs.routingPreference),
        requiresGrounding,
      },
      this.cfg,
      available,
    );
    if (!decision) {
      throw new ApiError('no_model_available', {
        detail: requiresVision
          ? 'No configured model can see images or PDFs. Remove the attachment, or configure ' +
            'Claude or Gemini.'
          : requiresGrounding
            ? 'No configured model supports grounded search. Enable grounding or use Chat mode.'
            : 'No model in the registry is configured and reachable. Check the MODEL_* ' +
              'environment variables.',
      });
    }
    return { entry: decision.entry, routing: decision };
  }
```

Update the `GenerationRequest` construction further down (currently `const request: GenerationRequest = { prompt: input.prompt, history, systemInstruction, ... }`) to include the current turn's attachments:

```typescript
    const request: GenerationRequest = {
      prompt: input.prompt,
      history,
      attachments: input.attachments,
      systemInstruction,
      mode: input.mode,
      maxOutputTokens,
      providerModelId: entry.providerModelId!,
      grounded,
      signal: input.signal,
    };
```

- [ ] **Step 7: Update `loadHistory` to carry attachments forward**

Add `inArray` to the drizzle-orm import (currently `import { and, asc, desc, eq, sql } from 'drizzle-orm';`) and add `attachments` to the schema import (currently missing it):

```typescript
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
```

```typescript
import {
  attachments,
  chats,
  messages,
  messageSources,
  preferences as preferencesTable,
  projectFiles,
  projects,
  researchEvents,
} from '../db/schema.js';
```

Replace `loadHistory` (currently lines 512-540):

```typescript
  /** Prior turns, oldest first, excluding the assistant row we are about to fill. */
  private async loadHistory(chatId: string, excludeMessageId: string): Promise<Turn[]> {
    const rows = await this.db
      .select({ id: messages.id, role: messages.role, text: messages.text, seq: messages.seq })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), sql`${messages.id} <> ${excludeMessageId}`))
      .orderBy(desc(messages.seq))
      .limit(Math.min(this.cfg.HISTORY_MAX_TURNS, 12));

    const ordered = rows.reverse().filter((r) => r.text.trim() !== '');

    // Keep the newest complete context within a predictable character budget, exactly as
    // before attachments existed. A turn trimmed out here never gets its attachments fetched
    // either — there is no point spending a storage read on a turn that was already dropped.
    const budget = 24_000;
    let used = 0;
    const kept: typeof ordered = [];
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const row = ordered[i];
      if (!row) continue;
      const cost = row.text.length;
      if (kept.length > 0 && used + cost > budget) break;
      kept.unshift(row);
      used += cost;
    }

    const attachmentRows = kept.length
      ? await this.db
          .select({
            messageId: attachments.messageId,
            mimeType: attachments.mimeType,
            storageKey: attachments.storageKey,
            sizeBytes: attachments.sizeBytes,
          })
          .from(attachments)
          .where(
            and(
              inArray(
                attachments.messageId,
                kept.map((r) => r.id),
              ),
              sql`(${attachments.mimeType} = 'application/pdf' or ${attachments.mimeType} like 'image/%')`,
            ),
          )
          .orderBy(desc(attachments.createdAt))
      : [];

    // Newest carried-forward attachment wins first claim on the byte budget; once the next one
    // wouldn't fit, everything older than it is dropped rather than skipped-and-continued past —
    // a simple, predictable "most recent that fit" rule rather than a bin-packing exercise.
    let budgetBytes = this.cfg.HISTORY_MAX_ATTACHMENT_BYTES;
    const byMessage = new Map<string, { mimeType: string; base64: string }[]>();
    for (const row of attachmentRows) {
      if (!row.messageId) continue;
      if (row.sizeBytes > budgetBytes) break;
      const data = await this.storage.get(row.storageKey);
      budgetBytes -= row.sizeBytes;
      const list = byMessage.get(row.messageId) ?? [];
      list.push({ mimeType: row.mimeType, base64: data.toString('base64') });
      byMessage.set(row.messageId, list);
    }

    return kept.map(
      (r): Turn => ({
        role: r.role === 'user' ? 'user' : 'assistant',
        text: r.text,
        ...(byMessage.has(r.id) ? { attachments: byMessage.get(r.id) } : {}),
      }),
    );
  }
```

- [ ] **Step 8: Wire `chats.ts`'s generate handler**

In `backend/src/routes/chats.ts`, replace the attachment-gathering block (currently lines 389-405):

```typescript
      // --- gather attachment text ---------------------------------------
      let attachmentText = '';
      if (attachmentIds.length > 0) {
        const rows = await db
          .select({ filename: attachmentsTable.filename, extractedText: attachmentsTable.extractedText })
          .from(attachmentsTable)
          .where(
            and(
              inArray(attachmentsTable.id, attachmentIds),
              eq(attachmentsTable.userId, user.id),
            ),
          );
        attachmentText = rows
          .filter((r) => r.extractedText?.trim())
          .map((r) => `--- ${r.filename} ---\n${r.extractedText}`)
          .join('\n\n');
      }
```

with:

```typescript
      // --- gather attachments: text-extraction path vs. native path -----
      let attachmentText = '';
      let nativeAttachments: { mimeType: string; base64: string }[] = [];
      if (attachmentIds.length > 0) {
        const rows = await db
          .select({
            filename: attachmentsTable.filename,
            mimeType: attachmentsTable.mimeType,
            storageKey: attachmentsTable.storageKey,
            extractedText: attachmentsTable.extractedText,
          })
          .from(attachmentsTable)
          .where(
            and(
              inArray(attachmentsTable.id, attachmentIds),
              eq(attachmentsTable.userId, user.id),
            ),
          );

        const isNative = (mimeType: string): boolean =>
          mimeType === 'application/pdf' || mimeType.startsWith('image/');

        attachmentText = rows
          .filter((r) => !isNative(r.mimeType) && r.extractedText?.trim())
          .map((r) => `--- ${r.filename} ---\n${r.extractedText}`)
          .join('\n\n');

        nativeAttachments = await Promise.all(
          rows
            .filter((r) => isNative(r.mimeType))
            .map(async (r) => ({
              mimeType: r.mimeType,
              base64: (await request.services.storage.get(r.storageKey)).toString('base64'),
            })),
        );
      }
```

Then update the `generation.run({...})` call (currently ending `attachmentText, signal: controller.signal,`) to include the new field:

```typescript
        for await (const event of generation.run({
          userId: user.id,
          requestId: request.id,
          chatId: chat.id,
          messageId: assistantMessageId,
          prompt,
          mode,
          modelAlias: model,
          projectId: chat.projectId,
          hasAttachments: attachmentIds.length > 0,
          attachmentText,
          attachments: nativeAttachments,
          signal: controller.signal,
        })) {
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd backend && npx vitest run src/routes/chats.integration.test.ts`
Expected: PASS, including the two new `describe` blocks.

- [ ] **Step 10: Full backend check**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean, all files (this task touches the widest surface area — `generation.ts`, `container.ts`, `chats.ts`, `config.ts` — so this is the point most likely to surface a missed call site).

- [ ] **Step 11: Commit**

```bash
git add backend/src/config.ts backend/src/services/generation.ts backend/src/container.ts backend/src/routes/chats.ts backend/src/routes/chats.integration.test.ts
git commit -m "$(cat <<'EOF'
Carry image/PDF attachments across turns; gate on vision capability

loadHistory now re-reads and re-attaches any image/PDF from an earlier
turn in the same chat, capped by the new HISTORY_MAX_ATTACHMENT_BYTES
(oldest drops first past the cap). Model resolution moved after history
loading so requiresVision can see what's actually being carried forward,
not just what's newly attached — an explicit pin to a vision-incapable
model with any visual content present now fails fast with
capability_unavailable, before any provider call.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final verification and documentation

**Files:**
- Modify: `mistakes.md` (only if this plan's execution actually surfaced something not already anticipated here — see below)
- Modify: `docs/checkpoints/CURRENT.md`

**Interfaces:** none — this task produces no code, only verification and records.

- [ ] **Step 1: Full clean-room verification**

Run, from `backend/`:

```bash
docker start arcnave-pg
npx tsc --noEmit
npx vitest run
npm run openapi
```

Expected: typecheck clean; every test passes (the pre-existing suite plus everything added in Tasks 2, 4, 5, 6, 7); `docs/openapi.json` has no uncommitted diff (it was already regenerated and committed in Task 6, and nothing after that changed a route schema — confirm with `git status --short docs/openapi.json`).

Run, from `arcnave-frontend/`:

```bash
npx tsc -b
npx vitest run
```

Expected: clean and unaffected — this plan is backend-only; if either fails, something in the backend's DTO shape changed in a way the frontend's existing type assumptions didn't anticipate (check `attachmentSchema`'s new `viewable` field isn't required anywhere that would break an existing frontend type — it's additive, so this should not happen, but confirm).

- [ ] **Step 2: Manual live verification (requires real Vertex credentials — cannot be scripted or asserted by an agent)**

This cannot be done by an automated step; hand off to a human with `GOOGLE_CLOUD_PROJECT` configured and `gcloud auth application-default login` run:

1. Attach a real photo to a chat message on Claude or Gemini; confirm the reply actually describes its content (not "I cannot see images").
2. Ask a follow-up question two turns later in the same chat with no re-attachment; confirm the model still references the photo.
3. Attach a real scanned (image-only) PDF; confirm it's read rather than rejected as "no selectable text."
4. Pin the model to "GPT-OSS 120B" and attach a photo; confirm the response is the typed `capability_unavailable` error, not a hang or a 500.
5. Optional but valuable: for the Claude case, check response headers/timing on the second follow-up turn for evidence of a cache hit (Anthropic's Vertex responses don't expose `cache_read_input_tokens` in a header, but the per-message usage row this app already records — `GET /v1/usage/messages` — will show `cacheReadTokens > 0` on that second turn if the cache was hit).

Record the outcome of this pass in `docs/checkpoints/CURRENT.md` (Step 3) — do not claim this plan is "done" without it, per `CLAUDE.md`'s verification rule.

- [ ] **Step 3: Update the checkpoint**

Add a new dated section to `docs/checkpoints/CURRENT.md` under `## Completed work`, following the existing style of prior dated entries (e.g. "Frontend visual polish — 2026-09-17"), summarizing: the new `REGISTRATION_ENABLED`-style env var (`HISTORY_MAX_ATTACHMENT_BYTES`) added to the "Required environment variables" table; the new `POST /files/from-project` route; and the outcome of Step 2's live verification pass, with the same level of concrete detail as the existing "Verified running against local Postgres" table (what was checked, what it proved).

- [ ] **Step 4: Update `mistakes.md` if anything went wrong during execution**

This plan was written to anticipate the real gotchas already found during design (the storage-key uniqueness collision from reusing a project file's bytes, the model-resolution/history-loading ordering dependency, the existing test that had to change). If executing this plan surfaces something *not* already handled by a step above — a real bug found by a test, not merely "I had to think about X" — add one entry following the format at the top of `mistakes.md` (Symptom / Cause / Rule / Verify). If nothing new was found, skip this step; do not invent an entry to fill it.

- [ ] **Step 5: Commit**

```bash
git add docs/checkpoints/CURRENT.md mistakes.md
git commit -m "$(cat <<'EOF'
Record multimodal file input as complete, with live-verification results

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(If Step 4 found nothing to add, `git add mistakes.md` will simply be a no-op — fine to include in the same commit either way.)

- [ ] **Step 6: Push**

This is a real production deploy — the backend redeploys automatically on push to `main` (see `mistakes.md`'s note on the Cloud Build trigger). Confirm with whoever is driving this session before running:

```bash
git push origin backend/remaining-routes:main
```

After the push, poll `gcloud builds list --limit=1` until the triggered build reaches `SUCCESS`, then re-run Step 2's manual checklist against the live service before considering this plan finished.
