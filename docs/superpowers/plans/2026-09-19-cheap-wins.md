# Cheap Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close three gaps between what ArcNave's backend already does and what a user can
actually see/use: (1) a real bug where a non-image/PDF file attached to a chat message is
forgotten on the very next turn, (2) Gemini's already-working code execution has no UI, and
(3) the already-working Markdown-to-Office export has no UI.

**Architecture:** Task 1 is a backend fix inside `GenerationService.loadHistory` — no new table,
no new endpoint, just reading a column (`attachments.extractedText`) that is already being
written and was never being read back. Tasks 2 and 3 are additive frontend wiring onto two SSE
event types / REST endpoints that already exist and are already tested on the backend; nothing
on the server changes for either.

**Tech Stack:** Node 22, TypeScript, Fastify 5, Drizzle ORM, React 19, Vitest.

## Global Constraints

- `npx tsc --noEmit` and `npx vitest run` clean in `backend/` before any commit; `npx tsc -b` and
  `npx vitest run` clean in `arcnave-frontend/` before any commit.
- **For the frontend tasks, this codebase has no component-test convention** — `npm test` in
  `arcnave-frontend/` is 2 files of pure logic (`adapter.test.ts`, `types.test.ts`), and
  `CLAUDE.md` itself says UI changes are verified by running the dev server and using the feature
  in a browser, not by fabricating component tests that don't fit this codebase. Tasks 2 and 3
  therefore have a manual browser-verification step instead of a written test, and that is
  stated as what it is, not disguised as automated coverage.
- **Never substitute silently** (Invariant 1): Task 3's export button must surface the server's
  real `export_unsupported` reason when a version has nothing exportable, not a generic failure.
- Comments state why, not what.
- `mistakes.md` and `docs/checkpoints/CURRENT.md` get updated once, at the end (Task 4), covering
  all three fixes together.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/src/config.ts` | New `HISTORY_MAX_ATTACHMENT_TEXT_CHARS` env var. |
| `backend/src/services/generation.ts` | `loadHistory` also carries forward extracted text from earlier turns' non-image/PDF attachments. |
| `backend/src/routes/chats.integration.test.ts` | New test proving the second turn's request actually contains the first turn's file text. |
| `arcnave-frontend/src/adapter.ts` | `StreamEvent` gains the `code` variant already sent by the server. |
| `arcnave-frontend/src/types.ts` | `Message` gains `codeBlocks?`. |
| `arcnave-frontend/src/workspace.tsx` | Handle the new `code` SSE event, same shape as the existing `sources`/`research` handling. |
| `arcnave-frontend/src/App.tsx` | Render a "Ran code" block, same shape as the existing sources summary. |
| `arcnave-frontend/src/api.ts` | New `api.artifacts.export(...)` client method. |
| `arcnave-frontend/src/Panels.tsx` | New export control in the artifact toolbar. |

---

### Task 1: Carry forward extracted attachment text across turns

**Files:**
- Modify: `backend/src/config.ts:129-134`
- Modify: `backend/src/services/generation.ts:567-635` (`loadHistory`)
- Modify: `backend/src/routes/chats.integration.test.ts`

**Interfaces:**
- Consumes: `attachments.extractedText` (already written by `backend/src/routes/files.ts:89-99` at upload time — nothing changes there).
- Produces: `Turn.text` for an older turn now includes any non-image/PDF attachment's extracted text, capped at `cfg.HISTORY_MAX_ATTACHMENT_TEXT_CHARS`.

**Root cause, confirmed by reading the code, not assumed:** `loadHistory` already fetches and
re-attaches image/PDF attachment *bytes* for earlier turns (that's what makes vision "remember" a
photo two turns later). It does not do the equivalent for a plain text-extracted file — the only
place that text ever reaches the model is `chats.ts`'s `attachmentText`, built fresh from the
*current* turn's `attachmentIds` and folded into that one turn's system prompt
(`generation.ts:696-700`). Ask a follow-up two messages later with no re-attachment, and nothing
in the request carries that text forward. This is the literal mechanism behind "the model forgot
what I uploaded."

- [x] **Step 1: Write the failing test**

Add to `backend/src/routes/chats.integration.test.ts`:

```typescript
describe('attachment text across turns', () => {
  it('carries a text-extracted attachment forward into a later turn without re-attaching it', async () => {
    const chatId = await newChat();

    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: auth(),
      ...multipart('policy.txt', 'The refund window is 45 days for annual plans.', 'text/plain'),
    });
    expect(upload.statusCode).toBe(201);
    const attachmentId = (upload.json() as { id: string }).id;

    // Turn 1: attach the file.
    await generate(chatId, { prompt: 'What does this say?', attachmentIds: [attachmentId] });

    // Turn 2: no attachment at all. If the fix works, the *history* sent to the provider for
    // this second call still contains the file's text.
    await generate(chatId, { prompt: 'How many days did it say again?' });

    expect(ctx.provider.seen).toHaveLength(2);
    const secondRequestHistory = ctx.provider.seen[1]!.history;
    const historyText = secondRequestHistory.map((t) => t.text).join('\n');
    expect(historyText).toContain('The refund window is 45 days for annual plans.');
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/routes/chats.integration.test.ts -t "attachment text across turns"`
Expected: FAIL — `historyText` does not contain the refund text, because `loadHistory` never
fetched it.

- [x] **Step 3: Add the config cap**

In `backend/src/config.ts`, after `HISTORY_MAX_ATTACHMENT_BYTES` (previously line 122), add:

```typescript
  /** Characters of text-extracted (non-image/PDF) attachment content carried forward per older
   *  turn, per generate call. Capped independently of the 200,000-char upload-time cap in
   *  files.ts — that cap is "how much to keep at all", this one is "how much of that to re-pay
   *  for on every later turn of the same chat". */
  HISTORY_MAX_ATTACHMENT_TEXT_CHARS: int(8000),
```

- [x] **Step 4: Implement in `loadHistory`**

In `backend/src/services/generation.ts`, immediately after the existing `attachmentRows` query
block (previously lines 592-611, the one filtering to `application/pdf`/`image/%`), add a second
query and a lookup map:

```typescript
    // The image/PDF path above re-attaches bytes so vision keeps "seeing" a photo on a later
    // turn. This is the same idea for everything else: a plain text-extracted file's content is
    // stored once at upload time (`attachments.extractedText`, files.ts) and would otherwise
    // only ever reach the model on the turn it was uploaded — the model "forgets" it on the very
    // next message, which is not a model limitation, it is this data never being re-sent.
    const textAttachmentRows = kept.length
      ? await this.db
          .select({
            messageId: attachments.messageId,
            filename: attachments.filename,
            extractedText: attachments.extractedText,
          })
          .from(attachments)
          .where(
            and(
              inArray(
                attachments.messageId,
                kept.map((r) => r.id),
              ),
              sql`${attachments.extractedText} is not null and ${attachments.mimeType} <> 'application/pdf' and ${attachments.mimeType} not like 'image/%'`,
            ),
          )
      : [];

    const extractedByMessage = new Map<string, string>();
    for (const row of textAttachmentRows) {
      if (!row.messageId || !row.extractedText) continue;
      const capped = row.extractedText.slice(0, this.cfg.HISTORY_MAX_ATTACHMENT_TEXT_CHARS);
      const block = `--- ${row.filename} ---\n${capped}`;
      const existing = extractedByMessage.get(row.messageId);
      extractedByMessage.set(row.messageId, existing ? `${existing}\n\n${block}` : block);
    }
```

Then change the final `return kept.map(...)` (previously lines 628-634) to fold that text into
`text`:

```typescript
    return kept.map((r): Turn => {
      const extracted = extractedByMessage.get(r.id);
      return {
        role: r.role === 'user' ? 'user' : 'assistant',
        text: extracted
          ? `${r.text}\n\n[Text extracted from a file attached to this message]\n${extracted}`
          : r.text,
        ...(byMessage.has(r.id) ? { attachments: byMessage.get(r.id) } : {}),
      };
    });
```

- [x] **Step 5: Run to verify it passes**

Run: `cd backend && npx vitest run src/routes/chats.integration.test.ts -t "attachment text across turns"`
Expected: PASS.

- [x] **Step 6: Full backend suite and typecheck**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: clean. This changes `Turn.text` for older turns only when they actually have a
qualifying attachment, so every existing test (none of which attaches a plain-text file and then
asks a follow-up) is unaffected.

- [x] **Step 7: Commit**

```bash
git add backend/src/config.ts backend/src/services/generation.ts backend/src/routes/chats.integration.test.ts
git commit -m "fix(generation): carry extracted attachment text into later turns of the same chat"
```

---

### Task 2: Show Gemini's code execution in the UI

**Files:**
- Modify: `arcnave-frontend/src/adapter.ts:31-49` (`StreamEvent`)
- Modify: `arcnave-frontend/src/types.ts:94-103` (`Message`)
- Modify: `arcnave-frontend/src/workspace.tsx` (event handling, near the existing `sources`/`research` cases at lines 408-422)
- Modify: `arcnave-frontend/src/App.tsx` (rendering, near the existing sources summary at lines 694-716)

**Interfaces:**
- Consumes: the server's `code` SSE frame (`backend/src/services/generation.ts` `StreamEvent`'s
  `{ type: 'code'; code?: string; language?: string; output?: string }` — already sent today,
  the frontend just drops it because its own `StreamEvent` union in `adapter.ts` has no such
  member, so `parseFrame`'s `JSON.parse` succeeds but nothing ever reads `event.code`/`event.output`
  because TypeScript never lets `workspace.tsx` narrow to that case).
- Produces: `Message.codeBlocks?: { code?: string; language?: string; output?: string }[]`.

**Explicitly not covered by this task:** persistence across a page reload. The backend never
writes a `code` event to a table the way `researchEvents` does for research progress — so this
task makes the block visible *live*, in the tab that ran the generation, and a reload will lose
it, exactly like the `sources`/`research` UI already does for anything not in that reload's own
DTOs. Stating this now so it isn't discovered later as a silent gap: closing it means adding a
persistence table symmetrical to `researchEvents`, deliberately left out of this "cheap win" pass.

- [x] **Step 1: Add the `code` event type to the frontend's `StreamEvent`**

In `arcnave-frontend/src/adapter.ts`, add one member to the union (previously lines 31-49),
between `sources` and `done`:

```typescript
  | { type: "code"; code?: string; language?: string; output?: string }
```

- [x] **Step 2: Add `codeBlocks` to `Message`**

In `arcnave-frontend/src/types.ts`, in the `Message` interface (previously lines 94-103), add
after `events?: ResearchEvent[];`:

```typescript
  codeBlocks?: { code?: string; language?: string; output?: string }[];
```

- [x] **Step 3: Handle the event in `workspace.tsx`**

In `arcnave-frontend/src/workspace.tsx`, immediately after the existing `research` handling block
(previously lines 413-422), add:

```typescript
          if (event.type === "code")
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
              status: "generating",
              codeBlocks: [
                ...(m.codeBlocks ?? []),
                { code: event.code, language: event.language, output: event.output },
              ],
            }));
```

- [x] **Step 4: Render it in `App.tsx`**

In `arcnave-frontend/src/App.tsx`, immediately after the existing sources-summary block
(previously ends at line 716, right before the `{m.artifactId && (...)}` block), add:

```typescript
      {m.codeBlocks && m.codeBlocks.length > 0 && (
        <div className="ran-code">
          {m.codeBlocks.map((block, i) => (
            <details key={i} className="ran-code-block">
              <summary>Ran code{block.language ? ` (${block.language})` : ""}</summary>
              {block.code && (
                <Markdown text={"```" + (block.language ?? "") + "\n" + block.code + "\n```"} />
              )}
              {block.output && (
                <pre className="ran-code-output">{block.output}</pre>
              )}
            </details>
          ))}
        </div>
      )}
```

(`Markdown` is already imported in this file — it's used two lines above for the message text
itself.)

- [x] **Step 5: Typecheck**

Run: `cd arcnave-frontend && npx tsc -b`
Expected: clean.

- [x] **Step 6: Manual browser verification**

This is the project's actual acceptance method for UI work (`CLAUDE.md`: "start the dev server
and use the feature in a browser"), not a substitute for a test that could exist but wasn't
written.

1. `cd backend && npm run dev` (needs `ENABLE_GEMINI_CODE_EXECUTION=true` and a working Vertex
   connection in `backend/.env`).
2. `cd arcnave-frontend && npm run dev`.
3. Pin the model to **Gemini 3.8 Flash**, turn code execution on for the message (existing
   `codeExecution` request field), and ask something that requires computing a result (e.g. "what
   is 47 factorial?").
4. Confirm a collapsible "Ran code" block appears under the answer, showing the code and its
   output, and that it does not appear for a plain chat message with no code execution.
5. Confirm a *reload* of the page loses the block (expected, per the stated scope above) — this
   is a check that the limitation is real and documented, not a check that it's fine.

- [x] **Step 7: Commit**

```bash
git add arcnave-frontend/src/adapter.ts arcnave-frontend/src/types.ts arcnave-frontend/src/workspace.tsx arcnave-frontend/src/App.tsx
git commit -m "feat(ui): show Gemini's code execution results in the chat"
```

---

### Task 3: Wire the artifact export button

**Files:**
- Modify: `arcnave-frontend/src/api.ts:673-706` (`api.artifacts`)
- Modify: `arcnave-frontend/src/Panels.tsx:552-594` (`ArtifactPanel` toolbar)

**Interfaces:**
- Consumes: `POST /artifacts/:id/export` (`{ format: 'xlsx'|'docx'|'pptx', fromVersion?: number }` → `{ version, format, sizeBytes, filename }`) and `GET /artifacts/:id/versions/:version/download`, both already implemented and tested on the backend (ADR-0004, item 8).
- Produces: `api.artifacts.export(id, format)` — a new method other frontend code could call later (e.g. a future "export" entry point outside this panel).

- [x] **Step 1: Add the client method**

In `arcnave-frontend/src/api.ts`, inside the `artifacts` object (previously lines 673-706), add
after `restore`:

```typescript
    export: (id: string, format: "xlsx" | "docx" | "pptx") =>
      post<{ version: number; format: string; sizeBytes: number; filename: string }>(
        `/artifacts/${id}/export`,
        { format },
      ),
```

- [x] **Step 2: Add the export control**

In `arcnave-frontend/src/Panels.tsx`, `ArtifactPanel` only exports when the source is markdown —
the backend itself only accepts that (`artifacts.ts:373`, `source.format !== 'markdown'` throws
`export_unsupported`), and today only `kind === "document"` artifacts are ever markdown, so gate
the control on that.

Add local state near the panel's other `useState` calls (previously lines 430-439):

```typescript
  const [exporting, setExporting] = useState(false);
```

Add the export handler near `restore` (previously ends at line 550):

```typescript
  const exportAs = (format: "xlsx" | "docx" | "pptx") => {
    setExporting(true);
    void api.artifacts
      .export(id, format)
      .then(async (exported) => {
        const response = await fetch(
          url(`/artifacts/${id}/versions/${exported.version}/download`),
          { credentials: "include" },
        );
        if (!response.ok) throw new Error("download failed");
        const blob = await response.blob();
        download(blob, exported.filename);
        toast(`Exported as ${exported.filename}`);
      })
      .catch((error) =>
        toast(
          error instanceof ApiError
            ? error.detail
            : "This version could not be exported.",
        ),
      )
      .finally(() => setExporting(false));
  };
```

Add `url` to this file's existing `import { ... } from "./api";` line (it is already exported by
`api.ts` and used the same way in `adapter.ts`).

In the toolbar JSX (previously lines 552-594), add after the existing "Download artifact"
`IconButton` and before the closing `</div>` of `.artifact-toolbar`, gated on
`kind === "document"`:

```typescript
        {kind === "document" && (
          <select
            className="export-format"
            aria-label="Export as"
            disabled={exporting}
            defaultValue=""
            onChange={(e) => {
              const format = e.target.value as "xlsx" | "docx" | "pptx";
              e.target.value = "";
              if (format) exportAs(format);
            }}
          >
            <option value="" disabled>
              {exporting ? "Exporting…" : "Export as…"}
            </option>
            <option value="docx">Word (.docx)</option>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pptx">PowerPoint (.pptx)</option>
          </select>
        )}
```

- [x] **Step 3: Typecheck**

Run: `cd arcnave-frontend && npx tsc -b`
Expected: clean.

- [x] **Step 4: Manual browser verification**

1. `cd backend && npm run dev`, `cd arcnave-frontend && npm run dev`.
2. Open a document artifact that has at least one Markdown table and one heading (the backend
   refuses a version with nothing to convert — `export_unsupported`).
3. Choose "Word (.docx)" from the new control. Confirm a real `.docx` file downloads and opens.
4. Repeat for `.xlsx` (needs a table) and `.pptx` (needs a heading).
5. Try exporting a version with no table as `.xlsx`. Confirm the toast shows the server's actual
   `export_unsupported` detail message, not a generic failure — this is the Invariant 1 check for
   this task.
6. Confirm the control does not appear on a `code` or `webpage` kind artifact.

- [x] **Step 5: Commit**

```bash
git add arcnave-frontend/src/api.ts arcnave-frontend/src/Panels.tsx
git commit -m "feat(ui): add artifact export to Word/Excel/PowerPoint"
```

---

### Task 4: Docs

**Files:**
- Modify: `mistakes.md`
- Modify: `docs/checkpoints/CURRENT.md`

- [x] **Step 1: `mistakes.md` entry for Task 1**

Add an entry in the existing format (symptom, cause, rule, how to verify) for the attachment-text
bug: symptom — a file attached to a chat message is unreadable by the model on the very next
turn; cause — `loadHistory` re-attached image/PDF bytes across turns but never re-sent a plain
text-extracted attachment's content; rule — anything injected into a system prompt "for this
turn" needs an explicit carry-forward story, or it silently vanishes one turn later; verify — the
`attachment text across turns` test added in Task 1.

- [x] **Step 2: Update `docs/checkpoints/CURRENT.md`**

Add a dated section stating: three cheap-win gaps closed — (1) text-extracted attachments now
carry forward across turns in the same chat (`HISTORY_MAX_ATTACHMENT_TEXT_CHARS`, default 8000
chars/turn); (2) Gemini code-execution results now render live in the chat UI, with page-reload
persistence explicitly still missing (no `codeEvents` table exists, unlike `researchEvents`);
(3) the already-built `.xlsx`/`.docx`/`.pptx` artifact export now has a UI control. Note explicitly
that item 9 (tool-calling loop) work is unaffected by and independent of these three fixes.

- [x] **Step 3: Commit**

```bash
git add mistakes.md docs/checkpoints/CURRENT.md
git commit -m "docs: record the three cheap-win fixes"
```
