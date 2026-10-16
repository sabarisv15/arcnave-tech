# Stage 03 — Request lifecycle: conformance audit
Sources read: docs/architecture/Stage-03-Request-Lifecycle/03-request-lifecycle.md (doc-sync blocks 2026-10-03); Stage-04 04-L4-final-lock.md, 04-L4-orchestration-layer.md (turn state machine, G36–G49), 04-L6-async-layer.md (AS-D3, AS-D6); Stage-05 05-2-flows.md (F1–F3 gaps FG/GG/SG, doc-sync 2026-10-12); 00-numbers-register.md (N-01, N-02, N-22–N-24, N-43, N-73); 00-build-plan-arcnave-tech.md; repo code listed in section 2. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Stage 3 has no checkpoint file. Ids are the step numbers of the lifecycle table (0.1 … 7.3), the four decisions D1–D4, the timing targets (T-1…T-3, numbered here) and the three doc-sync lines (DS-1…DS-3, numbered here). Flow-level gaps (FG/GG/SG) belong to stage-05.md.

## 1. Locked decisions
| Id | Decision (one line) | Status |
|---|---|---|
| 0.1 | Composer asks the server which models this user may use (Claude hidden if company switch OFF) | LOCKED (company switch DEFERRED; B-6) |
| 0.2 | Upload starts on attach, direct to storage; chip uploading -> processing -> ready/failed | LOCKED |
| 0.3 | Mic -> speech-to-text -> composer, editable | LOCKED (= stage-01 R3m) |
| 0.4 | User picks model or Auto | LOCKED |
| 0.5 | Press Send creates a unique request id (no double-send on retry) | LOCKED |
| 1.1 | API receives {conversation, text, file ids, model, request id} | LOCKED |
| 1.2 | Verify login token -> user, company, role | LOCKED (company, role DEFERRED) |
| 1.3 | Input check: message length, file count/size; every file id belongs to caller; files "ready" | LOCKED |
| 1.4 | Same request id seen before -> return that result, do not run again | LOCKED |
| 1.5 | Rate limit per user and per company | LOCKED (company part DEFERRED) |
| 1.6 | Policy + budget before the turn (model allowed, quota, Claude cap) | LOCKED (company parts DEFERRED) |
| 1.7 | Save user message with status "received" + trace id | LOCKED |
| 1.8 | Open stream; send "received" signal at once (< 0.5 s) | LOCKED |
| 2.1 | Classify request (chat / file / tool / multi-step) | LOCKED (Stage 7, 10) |
| 2.2 | Input safety check; file text treated as data | LOCKED (Stage 16) |
| 2.3 | Choose model + region + fallback model | LOCKED (Stage 7) |
| 3.1–3.7 | Build context: system rules (+ company rules), history (recent full, older summary), memory, file content, tools, size+cost check, convert to provider format | LOCKED (Stage 6, 8, 11, 12) |
| 4.1 | Streaming model call with timeout | LOCKED |
| 4.2 | Early failure: retry once / switch to fallback model | LOCKED (Stage 15: <= 2 retries N-42) |
| 4.3 | Each chunk forwarded at once (first words 1–3 s) | LOCKED |
| 4.4 | Tool loop with max-steps limit | LOCKED (profiles Fast/Normal/Deep, N-06) |
| 4.5 | Finish reasons handled separately | LOCKED (Stage 15 map) |
| 5.1 | Validate (empty, cut off, broken format, blocked) | LOCKED (Stage 13) |
| 5.2 | Normal chat streams + light checks; structured output checked before showing | LOCKED (Stage 13, 14) |
| 5.3 | "Done" signal with model used + status | LOCKED |
| 6.1 | Save answer: message + status + model + tokens + cost (sync) | LOCKED (final transaction, F2 step 8) |
| 6.2 | Update user/company counters (sync) | LOCKED |
| 6.3 | Memory update (async worker) | SUPERSEDED by doc-sync 2026-10-03 (Stage 11 MEM-WRITE=1: saved in the turn) |
| 6.4 | Auto-title for new chats (async) | LOCKED (GD-2: Gemini Flash after first answer, `title_version`, user rename wins) |
| 6.5 | History summary for long chats (async) | LOCKED (Stage 6 trigger N-16/N-77) |
| 6.6 | Logs + trace with step timings and cost (async) | LOCKED (Stage 17; NO_CONTENT enforce DEFERRED) |
| 7.1 | Render text, markdown, tables, code, file references | LOCKED (Stage 14) |
| 7.2 | Stop cancels the model call; partial answer kept, marked "stopped" | LOCKED |
| 7.3 | Network drop: answer keeps generating on the server and is shown on reconnect | LOCKED |
| D1 | Block Send until files are "ready", show progress | LOCKED |
| D2 | "Auto" in the picker, default Auto (Gemini) | LOCKED |
| D3 | Mobile network drop: continue on server, show on reconnect | LOCKED |
| D4 | Stop keeps the partial answer marked "stopped" | LOCKED |
| T-1 | "Received" signal < 0.5 s | LOCKED (provisional) |
| T-2 | First words ~1–3 s | LOCKED (provisional) |
| T-3 | File questions: first words after the file is ready; progress shown | LOCKED |
| DS-1 | Generation runs in the Turn Executor via Cloud Tasks; API relays from Redis (~15 min) then DB; checkpoint each step; 1 retry from checkpoint (AS-D3) | DEFERRED (Cloud Tasks, Redis) |
| DS-2 | Cooperative cancel (AO-5), completion check before final answer (AO-10), memory in-turn | cancel-by-DB-flag part DEFERRED with the executor; completion check Stage 13; memory in-turn = 6.3 |
| DS-3 | Phase 1.6 "₹1,000 cap" = per-company monthly limit (RT-7) | DEFERRED (company) |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched …)" |
|---|---|
| 0.1 | `GET /v1/models` with availability per alias `backend/src/routes/models.ts:39-163`; session loads it `arcnave-frontend/src/session.tsx` (`models`). Route is not auth-guarded (stage-02 S2-3). |
| 0.2 | Upload starts when files are picked `arcnave-frontend/src/Composer.tsx:388-437`; direct resumable GCS session `backend/src/services/storage.ts:282-300`, `routes/files.ts:137-187`; chip states `uploading`/`ready`/`unsupported`/`failed` `Composer.tsx:197-217`. Extraction runs inside `/complete` (`files.ts:261-264`), so there is no visible "processing" step. |
| 0.4 | Picker `Composer.tsx:471`; default alias `Auto` `backend/src/db/schema.ts:86`. |
| 0.5 / 1.1 / 1.4 | Client sends no request id or Idempotency-Key: `arcnave-frontend/src/adapter.ts:116-133` (headers only Content-Type, Accept). Server: `routes/chats.ts:542-554` body has no key; CORS allows the header `app.ts:88`; table `schema.ts:667-682` (`idempotency_keys`) and helpers `routes/helpers.ts:85-140` exist but nothing calls them (searched `replayIdempotent`, `storeIdempotent` in backend/src: only the definitions). |
| 1.2 | Session cookie resolved in `plugins/context.ts:40-56`; guard `requireAuth` `context.ts:62-64`, applied by `chats.ts:190`. No company, role. |
| 1.3 | Prompt max 100,000 chars `chats.ts:543` (register N-02: 32,000; no N-02 row in `config/numbers.ts`); too-long returns a 422 validation error, not 413. Files <= 10 `chats.ts:546`; <= 20 per chat `chats.ts:1114`. Ownership: only the caller's rows are looked up `chats.ts:1100-1102`; an id that is unknown or someone else's is silently ignored (no error) and the message is sent without it. `uploading` refused `chats.ts:1103-1107`; `unsupported` files are allowed through. |
| 1.5 | Global limiter `app.ts:93-101` keyed `request.user?.id ?? request.ip`, registered at `:93` before the context plugin at `:107` that sets `request.user` in its own `onRequest` (`plugins/context.ts:40-56`); by static reading the user is not set when the key is computed, so the key is the IP (not run; needs a test). Generate route 20/min `chats.ts:556-561`, `config/numbers.ts:65`; all other routes 120/min `numbers.ts:67`. No company limit. |
| 1.6 | Budget is reserved inside the turn, after the user message and an empty assistant row are saved: `generation.ts:694` called from `runTurn`; `chats.ts:1085-1156` saves first; a budget refusal arrives as an SSE `error` frame on an already-open 200 stream `chats.ts:629-654`. Model availability is checked at model resolution `generation.ts:468-475`. |
| 1.7 | User row saved `status: 'complete'` at once; assistant row `generating` `chats.ts:1131-1156`. No `received` state, no trace id column on messages (request id lives in `usage_records.request_id` `schema.ts:599` and the turn log). |
| 1.8 | First frame `start` is built after workspace creation, history load and model resolution: `generation.ts:418-538`. No `ack`/`status` frame and no timing for it (searched `ack` in generation.ts, chats.ts: not found; stream events listed `generation.ts:122-142`). |
| 2.1 / 2.3 | `routeAuto` rules `providers/routing.ts:80-120`; no router model, no profiles; fallback chain not found (see stage-04 L4-G17/G18). |
| 2.2 | Prompt-injection policy text in the system prompt `services/systemPrompt.ts:77-78`; no input screen (searched `safety`, `moderation` in services/: only answerProtocolGuard). |
| 3.1–3.7 | History + compaction `generation.ts:436-462,1540-1580`; skills/tools/system prompt `:651-670`; adapters convert `providers/*.ts`. Per-request cost cap: not found. Depth: Stage 6 group. |
| 4.1 | `PROVIDER_TIMEOUT_MS` 600,000 `config/numbers.ts:35`; first-token and stall timers not used (ADR-0054 table). |
| 4.2 | Retries <= 2 before first token, 1 s -> 2 s full jitter, cap 8 s `numbers.ts:23-29`; no model fallback. |
| 4.3 | `run.publish(event)` per event `chats.ts:610-628`; hub `services/runHub.ts:44-53`. |
| 4.4 | `TOOL_MAX_ROUNDS` 16 `numbers.ts:43`; no Fast/Normal/Deep profiles (searched `profile`, `Fast`, `Deep` in generation.ts, config: not found). |
| 4.5 | `finishReason` carried to the row `generation.ts:2152`; mapping detail Stage 15 group. |
| 5.1 / 5.2 | Only `services/answerProtocolGuard.ts`; build plan puts Stage 13 checks in Phase 4. |
| 5.3 | `done` frame with usage, finish reason, effort `generation.ts:1219-1225`; model in `start` `generation.ts:538`. |
| 6.1 | `finalise` updates the message, replaces sources, touches the chat in separate statements `generation.ts:2138-2180`, then `usage.record` `:1191-1205`; no transaction around them. Message carries alias, provider, model id, finish reason `generation.ts:2148-2152`; cost lives in `usage_records` `schema.ts:628-635`. |
| 6.2 | `usage.record` / reserve / release `generation.ts:694-703,1191`; counters `schema.ts:650-664`. |
| 6.3 | Memory tools in the turn `generation.ts:716-717`; `routes/memory.ts`. |
| 6.4 | Title = first 80 chars of the prompt: `chats.ts:1168-1173`. No title job or `title_version` (chat `version` column only `schema.ts:242`). |
| 6.5 | `conversation_compactions` `schema.ts:806-828`, flag `config.ts:310`, service `services/compaction/*`. |
| 6.6 | Stage timings `services/turnTiming.ts`, log line `generation.ts:1235`; content log `turn_logs` `schema.ts:516-525` (ADR-0050; NO_CONTENT is deferred). |
| 7.1 | Markdown/tables/code/citations in `arcnave-frontend/src/Content.tsx`, `App.tsx:1020-1071`. |
| 7.2 | Stop button `Composer.tsx:795-802`; `POST /chats/:id/stop` aborts the controller `chats.ts:696-712`; partial text saved as `stopped` `generation.ts:1047-1048,1175-1177`; UI note `ChatStates.tsx:130`. |
| 7.3 | Run outlives the socket `chats.ts:578-583`; reattach `GET /chats/:id/stream?after=` `chats.ts:668-690`; client reconnect with last frame id `adapter.ts:163-206`; DB polling fallback `workspace.tsx:410-425`. The message text is written only at the end (`generation.ts:2138-2156`); a crash, OOM or deploy kill leaves the row `generating` with no text (searched `generating`, `interrupted`, `orphan` in backend/src non-test: no sweeper). SIGTERM aborts runs so they end `stopped` with partial text `index.ts:69-71`. |
| D1 | Send disabled while any file is `uploading` `Composer.tsx:445,808`; server `upload_incomplete` 409 `chats.ts:1103-1107`. |
| D2 | Default `Auto` `schema.ts:86`; Auto maps economy -> Gemini, balanced -> Sonnet, quality -> Opus (ADR-0055 consequences). |
| D3 | As 7.3, single instance only: `runHub` is in-process `runHub.ts:10-12`; a reconnect on another instance gets 404 `no_active_run` `chats.ts:686`. |
| D4 | As 7.2. |
| T-1 / T-2 / T-3 | No metric or test of ack time or first-word time (searched `ttft`, `firstToken`, `time to first` in backend/src: not found; `turnTiming.ts` has stage marks only). |
| DS-1 | No executor, queue or Redis (stage-02 DS-1). Stream replay buffer is in memory, 50,000 events, kept 5 min after finish `runHub.ts:17-20` (register N-24: ~15 min). SSE comment heartbeat every 15 s `chats.ts:813-815`. |
| DS-2 | Stop is an in-process abort `container.ts:71`, `chats.ts:709-711`; a stop request that lands on another instance returns `{stopped:false}`. |

N-xx in scope: N-02 (32k vs 100k, 1.3); N-01 (1.5); N-06 (16 rounds vs profiles, 4.4); N-24 (retention 5 min vs ~15 min, DS-1); N-43 (turn 10 min vs `TURN_DEADLINE_MS` 59 min `numbers.ts:39`; first-token/stall absent); N-42 (matches: `numbers.ts:23-29`).

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| 0.1, 0.2, 0.4 | KEEP | model list, immediate resumable upload, picker with Auto |
| 0.3 | n/a | counted at stage-01 R3m |
| 0.5, 1.1 | n/a | counted at 1.4 |
| 1.2 | KEEP | login verified before every guarded route; company/role deferred; `/models` gap counted in stage-02 S2-3 |
| 1.3 | REWRITE | N-02 32k limit, 413 code, unknown/foreign file ids must be an error |
| 1.4 | NEW-BUILD | request-id / Idempotency-Key replay is built as helpers but wired nowhere |
| 1.5 | REWRITE | per-user key is probably never set (hook order) |
| 1.6 | REWRITE | budget/policy check must come before saving the user message and be an HTTP refusal |
| 1.7 | REWRITE | message state `received` + trace id; folded into the turns table (stage-05 T-turns) |
| 1.8 | REWRITE | emit a typed `ack` frame before any slow work (also covers T-1) |
| 2.1, 2.2, 2.3 | n/a | audited by Stage 7 / 16 groups; fallback counted at stage-04 |
| 3.1–3.7 | n/a | Stage 6 group |
| 4.1, 4.2, 4.3, 4.4, 4.5 | KEEP | stream, bounded retries, tool-loop limit, finish reason carried (numbers differ, see N-xx; Stage 15/7 groups) |
| 5.1, 5.2 | n/a | Stage 13 group |
| 5.3 | KEEP | `done` frame carries usage and finish reason |
| 6.1 | REWRITE | no final transaction around message + sources + usage |
| 6.2, 6.3, 6.5, 6.6 | KEEP | counters, in-turn memory, compaction, timings |
| 6.4 | NEW-BUILD | title is the first 80 characters of the prompt |
| 7.1 | KEEP | rendering present (Stage 14 group) |
| 7.2 | KEEP | stop keeps the partial answer as `stopped` |
| 7.3 | REWRITE | answer survives a closed tab but not a crashed or redeployed instance |
| D1, D2, D3, D4 | KEEP | met (D3 single-instance; multi-instance = DEFERRED infra) |
| T-1 | n/a | counted at 1.8 |
| T-2 | n/a | needs a measurement task (see Q below) |
| T-3 | KEEP | file chip waits for ready |
| DS-1, DS-2, DS-3 | DEFERRED | Cloud Tasks, Redis, cancel flag, company limit |

Counts: KEEP 21 (0.1, 0.2, 0.4, 1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 5.3, 6.2, 6.3, 6.5, 6.6, 7.1, 7.2, D1, D2, D3, D4, T-3) · REWRITE 7 (1.3, 1.5, 1.6, 1.7, 1.8, 6.1, 7.3) · NEW-BUILD 2 (1.4, 6.4; 0.3 counted in stage-01) · DIFF-STACK 0 · DIFF-INFRA 0 · DISCARD 0 · DEFERRED 3 (DS-1…DS-3) · n/a groups 9 ids (0.3, 0.5, 1.1, 2.1–2.3, 3.1–3.7 as one, 5.1, 5.2, T-1, T-2).

## 4. Non-KEEP items
### 1.4 (+0.5, 1.1) — Request id and duplicate check
- Exact change: client creates a UUID per Send and sends `Idempotency-Key`; `POST /chats/:id/generate` calls `replayIdempotent` before creating rows; store key + assistant message id (key hashed with SHA-256 per spec) in `idempotency_keys`; a repeat with the same body re-attaches to the run or returns the finished message, a different body is `idempotency_conflict` 409. Files touched: `routes/chats.ts`, `routes/helpers.ts`, `schema.ts:667-682` (key column to hash), `arcnave-frontend/src/adapter.ts`, `workspace.tsx`, `chats.integration.test.ts`. Port source: none.
- Option A (NEW-BUILD on the existing table + helpers): time S–M · risk: an SSE response cannot be replayed byte for byte, so replay = re-attach · breaks: none.
- Option B (new `turns` table first, key stored on the turn): time M · risk: bigger change · breaks: tests that read `messages` directly.
- Pick: B if the turns table (stage-05 T-turns) is done in the same task, else A. 

### 1.3 — Input check
- Exact change: prompt limit from an N-02 row (32,000 chars) with HTTP 413 `payload_too_large` before any row is written; ids in `attachmentIds` that are not the caller's, are missing, or are `failed` return 404/409 (no silent drop). Files touched: `config/numbers.ts`, `routes/chats.ts:543,1085-1121`, `errors.ts`. Time S, risk low, breaks tests that send > 32k.
- Pick: single option.

### 1.5 — Per-user rate limit key
- Exact change: add a test that sends two users from one IP; if the key is the IP, register the limiter after the context plugin or set the key from the signed cookie; set the numbers to the register (user 20/min, edge handled at infra). Files touched: `app.ts:93-107`, `config/numbers.ts:65-67`. Time S, risk low.
- Pick: single option.

### 1.6 / 1.7 / 1.8 — Order of the first three server steps
- Exact change: in the generate route, in this order: verify ownership -> resolve model + check budget (HTTP refusal, no rows) -> write user message `received` + assistant row + turn in one transaction -> send `ack` frame -> start the run. The `ack` frame carries the turn/message ids so the client can reattach by id. Files touched: `routes/chats.ts`, `services/generation.ts` (split resolve/reserve from the stream), new turn service (stage-02 S2-4). Time M, risk medium (the generate path is the core path) , breaks: `chats.integration.test.ts`, `runResume.integration.test.ts`, `toolLimit.integration.test.ts`.
- Option A (REWRITE in place, keep old status values readable): time M.
- Option B (NEW-BUILD a second route `/turns` beside `/generate`, switch the frontend, then delete the old one): time L, risk lowest.
- Pick: A under feature tests, because the old path and the new path would double every test.

### 6.1 — Final transaction
- Exact change: wrap message update, source replace, chat touch and usage row in one `db.transaction`; release the budget reservation after commit. Files touched: `services/generation.ts:1169-1205,2110-2181`, `services/usage.ts`. Time S, risk low, breaks `usage.test.ts` mocks.
- Pick: single option.

### 6.4 — Chat title job
- Exact change: after the first finished answer, one cheap model call writes a title of <= 60 characters (GD-2, N-76) and sets it only if `title_version` is unchanged; first 80 characters stay as the placeholder. Needs a model decision (Q2 in stage-01.md: Haiku 5.5 vs Gemini Flash-Lite). Files touched: `routes/chats.ts:1168-1173`, new `services/titles.ts`, `schema.ts:232-262` (`title_version`), frontend `renameChat`. Time M, risk low.
- Option A (in-process fire-and-forget after `done`): time S–M · risk: lost on crash, acceptable for a title.
- Option B (wait for the worker/outbox): DEFERRED infra.
- Pick: A.

### 7.3 — Survive instance loss
- Exact change: flush partial text and segments to the assistant row every N seconds or K characters while streaming; a startup and periodic sweeper marks `generating` rows older than the turn deadline (plus lease) as `error`/`interrupted` with the partial text kept (GG7). Files touched: `services/generation.ts` (flush), `index.ts` (sweeper like `:21-45`), `routes/chats.ts`. Time M, risk medium (extra writes during streaming), breaks: none expected. Resume-from-checkpoint (AS-D3) stays DEFERRED with the executor.
- Pick: single option; do it with the turns table (lease column) if that lands first.

## 5. Open questions for the owner
- Q-T1. T-1/T-2 (ack < 0.5 s, first words 1–3 s) have no measurement in the repo. Add a latency metric in this phase, or at the Phase 5 observability task?
- Q2, Q3 (stage-01.md): router/title model (B-4 vs Haiku); failed-file Send rule.
- Q-T2. Turn deadline: repo keeps 59 min (ADR-0054 "deliberate"), register N-43 says 10 min. The owner rule withdraws "repo wins"; which number is the target while there is no executor?

## 6. KEEP spot-check
21 KEEP ids; 3 re-opened (>=10 %): 7.2 (`chats.ts:696-712`, `generation.ts:1047-1048,1175` confirmed), 0.2 (`storage.ts:282-300` resumable session, `Composer.tsx:388-437` confirmed), D1 (`Composer.tsx:445,808` and `chats.ts:1103-1107` confirmed). Downgrades: none.
