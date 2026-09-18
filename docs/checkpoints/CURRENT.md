# ArcNave — current checkpoint

**Last updated:** 2026-09-18
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
**Item 9 (tool-use/agent framework) is explicitly deferred**, per the user's own instruction.
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

**Backend done, `tsc`/`vitest` green at every step (226/226 passing), `openapi.json`
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
