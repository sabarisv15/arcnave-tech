# ArcNave — current checkpoint

**Last updated:** 2026-09-16
**Status:** backend foundation complete and running; frontend still on mock data
**Progress:** ~40% of the brief in `ARCNAVE_BACKEND_CLAUDE_PROMPT.md`

> Read this first in a new session. It is the handoff. `CLAUDE.md` has the invariants;
> `docs/backend-research.md` has the primary-source research; `docs/decisions/` has the ADRs.

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
│   │   └── routes/          health, auth, models, chats, helpers
│   └── drizzle/             0000_jazzy_bloodstorm.sql — applied
└── docs/                    backend-research.md, decisions/, checkpoints/
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

### Built, typechecks clean, not yet exercised end to end
- All three provider adapters (no GCP project configured yet, so never called for real)
- BM25 retrieval + PDF/DOCX extraction + chunking
- Token accounting, budget reservation, usage aggregation
- Object storage with path-traversal-safe generated keys

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

## Bugs found and fixed this session

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

**No backend tests exist yet.** That is the most important gap.

## Known issues

- `docs/decisions/0001-stack.md` still argues for Python/FastAPI. Stale — rewrite for Node/TS.
- `npm audit`: 4 moderate, all from `drizzle-kit`'s transitive `esbuild` (dev-only, never
  shipped). Fixing requires downgrading drizzle-kit to 0.18 — breaking. Accepted, documented.
- `services.activeRuns` is an in-process Map, so `/stop` only reaches a run on the same
  instance. Horizontal scaling needs shared signalling (Redis pub/sub) first.
- Message transcripts return `usage: null`; the usage route that populates it is not written.
- No Docker image or compose file yet.

## Exact next steps, in order

1. **Routes**: `projects.ts` (CRUD, pin, order, search, files upload/list/delete, saved
   sources), `artifacts.ts` (+ versions), `usage.ts` (summary, export, limits),
   `preferences.ts`, `files.ts` (message attachments). Register each in `app.ts`.
2. **Tests** (`vitest`): Auto routing rules, BM25 ranking, budget reservation under
   concurrency, storage key traversal rejection, grounding UTF-8 byte-offset slicing,
   SSE cancellation. **Must mock providers — tests must never spend Vertex quota.**
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
   SessionStart/SessionEnd hooks, `docs/claude-code-workflow.md`.
6. Generate OpenAPI types into the frontend so contracts cannot drift.

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
