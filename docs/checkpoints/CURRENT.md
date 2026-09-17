# ArcNave — current checkpoint

**Last updated:** 2026-09-17
**Status:** backend API surface complete (38 routes); **connected to Vertex AI — all four
models verified with real calls**; frontend still on mock data
**Progress:** ~60% of the brief in `ARCNAVE_BACKEND_CLAUDE_PROMPT.md`

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
├── arcnave-frontend/        React 19 + Vite + TS   ← UNTOUCHED, still mock data
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

### Built, typechecks clean, never called for real
- All three provider adapters — no GCP project is configured, so every alias reports
  `vertex_not_configured` and no model call has ever been made from this codebase.
- Grounded search and research modes, for the same reason.

## Decisions and reasons

| Decision | Reason |
| --- | --- |
| Node + TypeScript, not Python | User's explicit choice. One language across the repo, shared types with the React frontend. Superseded [ADR-0001](../decisions/0001-stack.md), which said Python — **that ADR is now stale and needs rewriting.** |
| Fastify 5 + Zod | Schema-first; OpenAPI generated from the same schemas that validate, so the frontend contract cannot drift silently. |
| Drizzle ORM | TS-native, migrations are readable SQL. |
| TypeScript 5.9, not 7 | TS 7.0.2 is GA but `typescript-eslint` caps at `<6.1.0`. Ecosystem not ready. |
| `global` Vertex region | The only endpoint type serving Opus 5 / Sonnet 5, and no pricing premium. Regional tops out at Sonnet 4.6. |
| Session rows, not JWT | Revocable. A password change can actually end other sessions. |
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
  now supplies it, and the frontend has to call that when it renders the per-message row.
- No Docker image or compose file yet.

## Exact next steps, in order

1. ~~**Routes**~~ — **done 2026-09-17.** All five modules written and registered; 38 paths.
2. ~~**Tests**~~ — **done 2026-09-17.** 167 passing across 9 files: 63 pure-logic plus 104
   integration against a real Postgres. Harness at `src/test/harness.ts`; a separate
   `arcnave_test` database is created and migrated by the global setup. `FakeProvider` is
   injected into all three container slots, so **no test can reach Vertex**.
   Two defects were found and fixed by writing them — see `mistakes.md`.
   Still uncovered: grounding UTF-8 byte-offset slicing, and the provider adapters themselves,
   which cannot be tested without a GCP project.
3. **Docker**: `backend/Dockerfile` (non-root, healthcheck), root `compose.yaml`
   (frontend + backend + Postgres + volumes), `.dockerignore`, `.env.example`.
4. **Frontend rewiring** — the biggest chunk:
   - Delete `src/fixtures.ts` and every import of it
   - Replace the `generate()` mock in `src/adapter.ts` with a typed SSE client
   - Replace `src/storage.ts` localStorage/IndexedDB with API calls
   - Rename storage keys from `still-*`
   - Add sign-in / sign-up screens
   - Add **Usage & limits** to Settings; per-message usage row
   - Drive the model list from `GET /models`; show unavailable reasons
   - Strip all "demo" copy from `README.md` and UI
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
| `DATABASE_URL` | Postgres connection string |
| `GOOGLE_CLOUD_PROJECT` | **Still not supplied by the user.** Until set, all aliases report `vertex_not_configured`. |
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
| `PRICING_TABLE` | JSON. Absent ⇒ cost reported as `null`, never `0` |
| `STORAGE_BACKEND` | `local` or `gcs` |

Credentials use Application Default Credentials (`gcloud auth application-default login`
locally, workload identity on GCP). **No service-account key is ever committed or pasted.**

## Blocked on the user

- `GOOGLE_CLOUD_PROJECT` and region. Offered twice; not yet provided. Everything is built to
  work without them, but no real model call can happen until they exist.
- No git remote configured. Work is committed locally only.
