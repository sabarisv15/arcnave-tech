# Stage 02 — High-level architecture: conformance audit
Sources read: docs/architecture/Stage-02-High-Level-Architecture/02-high-level-architecture.md (with its doc-sync blocks 2026-10-03); Stage-04 00-checkpoint-stage4.md, 04-architecture-layers.md, 04-L4-final-lock.md (3 deploys); 00-Handoff/00-build-plan-arcnave-tech.md; repo ADR-0053…0055; repo `CLAUDE.md`; repo code listed in section 2. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Stage 2 has no checkpoint file. Ids come from the component table (S2-1…S2-12 with sub-steps 4a–4e), the seven design rules (RL1–RL7), assumptions A7/A8 and the doc-sync block (DS-1…DS-4, numbered here). The candidate-services table (section 5 of the spec) is marked "NOT locked" and is not audited.

## 1. Locked decisions
| Id | Decision (one line) | Status |
|---|---|---|
| S2-1 | Web app + mobile app: composer, streaming answer, upload, mic, model picker | LOCKED (mobile = Stage 1 R15) |
| S2-2 | Auth: e-mail/password + Google, sessions, company + role | LOCKED; method SUPERSEDED in part by ADR-0010 (Q1 in stage-01.md); company/role DEFERRED |
| S2-3 | One ArcNave API as the single entry point; checks token; streams reply | LOCKED |
| S2-4 | Orchestrator is the brain: 4a policy+quota+budget guard, 4b context assembly, 4c model routing, 4d tool execution, 4e output validation | LOCKED |
| S2-5 | Model Gateway: one interface, adapters per model, fallback, token counting | LOCKED |
| S2-6 | File processing is async (upload -> safety check -> extract -> chunks -> index) | LOCKED |
| S2-7 | Speech-to-text service (mic -> composer) | LOCKED |
| S2-8 | Memory service (save / fetch / delete) | LOCKED (Stage 11) |
| S2-9 | Retrieval service | LOCKED (Stage 12) |
| S2-10 | Tools service | LOCKED (Stage 8) |
| S2-11 | Data: app DB, file storage, vector index, memory store — all Mumbai | LOCKED |
| S2-12 | Cross-cutting: admin panel, usage metering, hard budget stop, logs, security | LOCKED |
| RL1 | Everything replaceable: each vendor behind its own adapter | LOCKED |
| RL2 | Orchestrator is the only brain; UI and API stay thin | LOCKED |
| RL3 | Heavy work is async (files, ZIP, audio, memory writing) | LOCKED; mechanism Cloud Tasks = DEFERRED |
| RL4 | Tenant id on every DB row, file, vector, memory item | DEFERRED (company) |
| RL5 | Mumbai-only storage; model calls via global endpoint | LOCKED |
| RL6 | Budget guard before every Claude call; stop at company quota (RT-7 / PL-6, was ₹1,000) | LOCKED; company part DEFERRED |
| RL7 | Stream first, save after | LOCKED |
| A7 | One common API for web and mobile (API-first) | LOCKED |
| A8 | 1 codebase, 2 deploys (API, worker) | SUPERSEDED by DS-1 |
| DS-1 | 3 deploys: API service (REST + SSE relay from Redis), Turn Executor (Cloud Tasks), Background worker, plus web | DEFERRED (Redis, Cloud Tasks, Cloud Run layout) |
| DS-2 | Work > 10 min (research, whole-document map-reduce) runs as Cloud Run jobs with checkpoints (AO-4) | DEFERRED (Cloud Tasks / jobs) |
| DS-3 | Isolated services without egress or secrets: (a) code sandbox runner (TD-4b), (b) parser sandbox (G34) | LOCKED |
| DS-4 | Rule 6 "₹1,000 total" replaced by RT-7 per-company limit + PL-6 spend caps | DEFERRED (company) |
| GB-1 | Model gateway = `backend/src/providers` only; no model SDK anywhere else (repo CLAUDE.md rule, ADR-0053; Stage 4 L5 "only door to every AI model") | LOCKED |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched …)" |
|---|---|
| S2-1 | Web SPA `arcnave-frontend/src/App.tsx:120-164`, composer `Composer.tsx:241`, model picker `Composer.tsx:471`. Mobile: not found (searched repo root: only `backend/`, `arcnave-frontend/`, `tools/`). |
| S2-2 | Own auth in Postgres: `backend/src/services/auth.ts:54-56` (Argon2id), cookie session `plugins/context.ts:40-56`, Google `routes/auth.ts:96-115`. No company or role columns: `db/schema.ts:39-52` (`users`). |
| S2-3 | Fastify app `backend/src/app.ts:50-221`, prefix `/v1` `config.ts:80`, request id `app.ts:60-64`. Two route groups are not behind the auth guard: `routes/models.ts:36-179` registers `/models` and `/models/refresh` without `requireAuth` (the other 11 modules add the hook, e.g. `chats.ts:190`). |
| S2-4 | One service owns the turn: `services/generation.ts:339-385` (`GenerationService.run`), `:414` (`runTurn`: preferences, project, history, model resolve, skills/tools, system prompt, budget, tool loop, persist). Business logic also lives in routes: `routes/chats.ts:1085-1215` (`appendTurn`, `resetForRetry`, file-count rule at `:1114`). |
| S2-4a | Per-user token reservation `generation.ts:694`, `usage.reserve`; typed `budget_exceeded` 402 `errors.ts:122-127`. No company, role, Claude-switch or kill-switch checks (searched `killSwitch`, `kill_switch`, `claude_enabled`: not found). |
| S2-4b / 4c / 4d / 4e | Context `generation.ts:657-670`; routing `providers/routing.ts:80-120` (`routeAuto`, tier rules only); tools `backend/src/tools/*`, executors wired at `generation.ts:705-749`; validation: `services/answerProtocolGuard.ts` only (Stage 13 owned by another group). Not re-audited here. |
| S2-5 | Provider port `providers/types.ts:378` (`Provider`), event type `:200`, request `:295`; adapters `providers/gemini.ts:8`, `providers/anthropic.ts:8`; registry `providers/registry.ts:93`; capability table `providers/capabilitiesTable.ts:116`; retries only before the first token `providers/streamedCall.ts`. Fallback chain / circuit breaker: not found (searched `fallback`, `circuit`, `breaker` in providers/, generation.ts: only an Auto tier-fallback string at `routing.ts:119`). |
| S2-6 | Processing is synchronous inside the upload request: `routes/files.ts:233-266` (`/complete` -> `finishUpload`), one extraction at a time per instance `services/attachments/processUpload.ts:139-146`. No queue or worker: not found (searched `Cloud Tasks`, `cloudtasks`, `outbox` in backend/src). |
| S2-7 | Not found server-side (see stage-01 R3m): mic is browser Web Speech `arcnave-frontend/src/Dictation.tsx:40-41`. |
| S2-8 | `routes/memory.ts:53-296`, `services/memory/*`, table `schema.ts:763-799`. |
| S2-9 | BM25 over project chunks in process `services/retrieval.ts:444-535`; `search_project_files` tool `tools/definitions.ts:11`. |
| S2-10 | `backend/src/tools/*`, tool definitions `tools/definitions.ts:11-66`, sandbox client `tools/sandbox/cloudRunSandboxClient.ts`. |
| S2-11 | Postgres 16 (CLAUDE.md:3), GCS or local files `config.ts:326-333`, `services/storage.ts:282-300`. Vector index: not found; `schema.ts:180-185` states "no embedding column" (repo Invariant 4, CLAUDE.md:25-26); ADR-0059 is only a plan item (build plan section 2). |
| S2-12 | Usage ledger `schema.ts:592-642` (`usage_records`) + counters `:650-664`; budgets `routes/usage.ts:140`; pino logs `logger.ts`. Admin panel: not found (single-user by ADR-0053 #3). |
| RL1 | `Provider` interface `providers/types.ts:378`; registry `providers/registry.ts:93`; ADR-0055 removed a provider by deleting one adapter. |
| RL2 | See S2-4: logic split between `generation.ts` and route files. |
| RL3 | Not met by design today: file work is in-request (S2-6); memory writes are model tool calls in the turn (`generation.ts:716-717`). |
| RL5 | `VERTEX_LOCATION` default global `config.ts:112`; storage region is bucket configuration only; `SANDBOX_LOCATION` default `us-central1` `config.ts:254`. |
| RL6 | Per-user reserve before every model call (any provider): `generation.ts:691-703`. |
| RL7 | Persist at the end: `generation.ts:1169-1182` (`finalise`); assistant row is created first as `generating` `routes/chats.ts:1145-1156`. |
| A7 | REST + SSE JSON API, cookie session only: `app.ts:77-81`, `plugins/context.ts:47-55`. Bearer tokens for a native client: not found (searched `Authorization`, `Bearer` in backend/src/plugins, routes). |
| DS-1 / DS-2 | In-process run hub and abort map: `container.ts:71-74,251-252`, `services/runHub.ts:1-12` (comment: "In-process by design"). No Redis, Cloud Tasks, executor or worker deploy (searched `redis`, `cloudtasks`, `ioredis`: not found; Dockerfiles `backend/Dockerfile`, `backend/sandbox/Dockerfile*` only). |
| DS-3a | Sandbox as a separate Cloud Run service/job: `backend/sandbox/Dockerfile.service`, `backend/src/tools/sandbox/cloudRunSandboxClient.ts:1-25`; ADR `docs/decisions/0005-cloud-run-sandbox.md`. Stage 19 ID-7 wants one Cloud Run Job execution per run; repo uses a warm service plus a job path (`numbers.ts:51-53`). |
| DS-3b | Not met: PDFs are read with `pdfinfo`/`pdftotext` in the API container `services/attachments/processUpload.ts:170-234`; DOCX/XLSX/PPTX/EPUB parsed in process `services/retrieval.ts:328`+, `processUpload.ts:268-279`. The API process also holds database and provider credentials. |
| GB-1 | Model SDK imports: `providers/anthropic.ts:8`, `providers/gemini.ts:8-9` only in product code. Violations of CLAUDE.md:117-118 in dev scripts: `backend/src/scripts/measureTokens.ts:9`, `measureStablePrefixTokens.ts:7`, `runCompactionEvaluation.ts:13`, `runGeminiPromptCacheEvaluation.ts:10` (all `@google/genai`). Other `google-auth-library` imports are infrastructure (`container.ts:30`, `tools/sandbox/cloudRunSandboxClient.ts:25`, `services/googleSignIn.ts:9`). No `temperature`/`top_p`/`top_k` anywhere in backend/src (searched, none). |

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| S2-1 | KEEP | web present; mobile counted at stage-01 R15a |
| S2-2 | KEEP | own auth present; method question is Q1; company/role deferred |
| S2-3 | REWRITE | `/models` and `/models/refresh` are public; `/models?probe=true` spends a provider call per alias for anyone |
| S2-4 | REWRITE | route files hold turn-start logic; move to a turn service (low priority, behaviour-neutral) |
| S2-4a | DEFERRED | company/role/kill-switch parts; per-user budget exists |
| S2-4b, 4c, 4d, 4e | n/a (audited by Stage 6, 7, 8, 13 groups) | contract exists; depth not re-audited here |
| S2-5 | KEEP | port + two adapters + registry; fallback chain is counted in stage-04 (L4-G17/G18, L5-G10) |
| S2-6 | DEFERRED | async queue = Cloud Tasks (build plan: deferred to Phase 5); the parser isolation is DS-3b |
| S2-7 | NEW-BUILD | counted at stage-01 R3m |
| S2-8 | KEEP | memory service present (depth: Stage 11 group) |
| S2-9 | KEEP | BM25 retrieval present (vector part: question Q-V below) |
| S2-10 | KEEP | tool registry present (depth: Stage 8 group) |
| S2-11 | DIFF-INFRA | Postgres 16 vs 17/18 and bucket region are infra; vector index see Q-V |
| S2-12 | KEEP | usage + hard budget stop present; admin panel DEFERRED (company) |
| RL1 | KEEP | adapters behind one port |
| RL2 | REWRITE | same change as S2-4 (counted there) |
| RL3 | DEFERRED | Cloud Tasks |
| RL4 | DEFERRED | company |
| RL5 | DIFF-INFRA | region settings |
| RL6 | KEEP | per-user budget guard before every call; company part DEFERRED |
| RL7 | KEEP | stream first, finalise after |
| A7 | KEEP | API-first REST; token auth for native counted at stage-01 R15a |
| A8, DS-1, DS-2, DS-4 | DEFERRED | deploy layout, Redis, Cloud Tasks, company limits |
| DS-3a | DIFF-INFRA | warm service vs per-run job is Cloud Run layout |
| DS-3b | NEW-BUILD | build the parser sandbox path beside the in-process parsers, then switch |
| GB-1 | REWRITE | four dev scripts import `@google/genai` directly |

Counts: KEEP 9 (S2-1, S2-2, S2-5, S2-8, S2-9, S2-10, S2-12, RL1, RL6, RL7, A7 — 11 ids, see note) · REWRITE 4 (S2-3, S2-4 [= RL2], GB-1; RL2 counted with S2-4 so 3 rows) · NEW-BUILD 1 new row (DS-3b; S2-7 counted in stage-01) · DIFF-INFRA 4 (S2-11, RL5, DS-3a, plus none) · DEFERRED 6 rows (S2-4a, S2-6, RL3, RL4, A8/DS-1/DS-2/DS-4 grouped) · n/a 1 group (4b–4e). Exact row counts: KEEP 11, REWRITE 3, NEW-BUILD 1, DIFF-STACK 0, DIFF-INFRA 3, DISCARD 0, DEFERRED 5 rows.

> **Main-session note (AUDIT-LOG C-4):** the "Counts:" part of this line is garbled; the "Exact row counts" are the auditor's de-duplicated numbers. A mechanical count of the table rows (incl. rows counted in another stage) gives KEEP 11, REWRITE 4, NEW-BUILD 2, DIFF-INFRA 3, DEFERRED 5, n/a 1. SUMMARY.md uses the mechanical row counts.

## 4. Non-KEEP items
### S2-3 — `/models` is unauthenticated
- Exact change: add the `requireAuth` hook to `modelRoutes` (as every other module does) or split a minimal public read for the sign-in page; keep `probe=true` behind auth and rate-limit it. Files touched: `backend/src/routes/models.ts`, `arcnave-frontend/src/session.tsx` (check what loads before login), `routes/models.integration.test.ts`. Port source: none.
- Option A (REWRITE: hook on the whole module): time S · risk: the frontend may call `/models` before sign-in (must be checked) · breaks: `models.integration.test.ts` if it calls without a session.
- Option B: keep public but force `probe=false` when there is no session: time S · risk: still leaks configured-model names.
- Pick: A — Stage 3 step 1.2 verifies the login before anything else; the probe spends provider quota.

### S2-4 / RL2 — Thin API, one brain
- Exact change: move `appendTurn`, `resetForRetry`, the file-count check and the idempotency/ownership steps out of `routes/chats.ts` into a turn service that `GenerationService` is called from; no behaviour change. Files touched: `routes/chats.ts`, new `services/turns.ts`, `services/generation.ts` (imports only). Port source: none.
- Option A (REWRITE, incremental): do it together with the turns table (stage-03 / stage-05) so the file is opened once. Time M · risk: low, large test surface already exists (`chats.integration.test.ts`) · breaks: none if behaviour-neutral.
- Option B: leave as is and record the layering difference in an ADR. Time S · risk: later tasks keep adding logic to routes.
- Pick: A, merged with the turns-table work (stage-05 T-turns).

### DS-3b — Parser sandbox (G34)
- Exact change: run `pdfinfo`/`pdftotext`, Office/EPUB/RTF text extraction and (later) ZIP expansion in the sandbox service (no egress, no secrets), returning text, page count and a status; the API process only stores the result. Files touched: `services/attachments/processUpload.ts`, `services/retrieval.ts` (`extractText`), `tools/sandbox/*` (new `parse` entry point), `backend/sandbox/*`. Port source: none locally.
- Option A (NEW-BUILD): add the sandbox parse path behind a flag, run both in a shadow test on the Phase 2 sample documents, then switch. Time L · risk: sandbox latency and cold start on every upload; memory limits move to the sandbox · breaks: none while the flag is off.
- Option B (REWRITE in place, remove in-process parsers): time L · risk: uploads break until the sandbox path is complete.
- Pick: A — keeps the app runnable at every commit and matches the file-pipeline rule in the role definition.

### GB-1 — Dev scripts call model SDKs
- Exact change: rebuild the four scripts on `createGeminiProvider`/`createAnthropicClient` from `providers/`, or delete the ones whose evaluation is finished (`runCompactionEvaluation.ts`, `runGeminiPromptCacheEvaluation.ts`). Files touched: `backend/src/scripts/measureTokens.ts`, `measureStablePrefixTokens.ts`, `runCompactionEvaluation.ts`, `runGeminiPromptCacheEvaluation.ts`. Port source: arcnave.in CLAUDE.md names `apps/lvrunner` as the single exception; the repo has no equivalent exception text.
- Option A (REWRITE onto providers/): time S · risk: scripts lose raw-SDK features · breaks: none (scripts are not in CI).
- Option B (DISCARD the finished evaluation scripts): time S · risk: lose the measuring tool · breaks: none.
- Pick: A for `measure*`, B for the two finished evaluations.

### DS-3b / S2-4 interaction note
Both change `chats.ts` and the upload route; do S2-4 before DS-3b so the parse switch happens in a service.

## 5. Open questions for the owner
- Q-V. Stage 2 S2-11 / Stage 4 L7 DB-2 lock a vector index in Postgres; build plan ADR-0059 ("BM25 now, pgvector at Phase 2 exit if the eval shows the gap") and repo Invariant 4 forbid an embedding column. Which wins for the schema built now? (Owner-decision vs stage decision; not resolved here.)
- Q-Gate. GB-1 text: should the repo CLAUDE.md name an exception for dev measuring scripts (like arcnave.in `apps/lvrunner`) or must they go through `providers/`?
- Q1 (stage-01.md). Sign-in method.

## 6. KEEP spot-check
11 KEEP ids; 3 re-opened (>=10 %): S2-5 (`providers/types.ts:378` Provider interface, `providers/gemini.ts:8`, `providers/anthropic.ts:8` confirmed), RL7 (`generation.ts:1169-1182` finalise and `chats.ts:1145-1156` generating row confirmed), RL6 (`generation.ts:694` confirmed). Downgrades: none. S2-12 stays KEEP only for usage and budget stop; the admin panel is in the deferred file.
