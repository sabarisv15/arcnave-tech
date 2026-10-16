# Stage 10 — Agent / workflow orchestration (+ 10b Research mode): conformance audit

Sources read: `Stage-10-Agent-Orchestration/00-checkpoint-stage10.md`, `10-agent-orchestration.md`, `10b-research-mode.md`; `00-Handoff/00-numbers-register.md` (N-06, N-19, N-20, N-24, N-43, N-73, N-74), `00-build-plan-arcnave-tech.md`; repo ADR-0009, ADR-0061, `CLAUDE.md`; code `backend/src/services/runHub.ts`, `generation.ts`, `routes/chats.ts`, `providers/anthropic.ts`, `providers/gemini.ts`, `providers/toolLoopPolicy.ts`, `config/numbers.ts`, `tools/*Executor.ts`, `arcnave-frontend/src/{adapter.ts,workspace.tsx,Composer.tsx,ChatStates.tsx,ToolActivity.tsx,App.tsx}`; port source `arcnave.in:backend/packages/chat/src/arcnave_chat/{runner.py,stream.py}`, `arcnave.in:backend/apps/api/src/arcnave_api/chat/relay.py`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Note on the port source: the archived Python build has no research, memory, retrieval or validator package (only chat/gateway/ledger/db/telemetry and LV test tools), so research mode, map-reduce and the completion check have no port source.

## 1. Locked decisions
Checkpoint locked 2026-10-02 is the final word over the two drafts. Doc-syncs: 2026-10-03 Stage 13 (AO-10 detail = OV11/VD-6; RS-1 step 6 = OV12), 2026-10-03 Stage 18 (research runs as Cloud Run jobs; quota 5 runs/company/month, worst-case ₹115 Gemini / ₹195 Sonnet, FD-06).

| Id | Decision (one line) | Status |
|---|---|---|
| AO-1 | Research mode in MVP (draft said Later) | SUPERSEDED draft by 10b + checkpoint (2026-10-02): MVP, provisional; built by RS-1…RS-8 |
| AO-2 | Live step list from tool status labels + sources; editable plan only in Research | LOCKED |
| AO-3 | Clarifying questions before start only, one round, only if key input missing | LOCKED |
| AO-4 | ≤10 min turns in Turn Executor (Cloud Tasks); >10 min work in Cloud Run jobs with checkpoints; no LangGraph/Workflows | LOCKED (infra part = DIFF-INFRA) |
| AO-5 | Cooperative cancel (DB flag checked between steps and inside long tools); partial results kept | LOCKED |
| AO-6 | Whole-document tasks: own map-reduce over every chunk/page with coverage %; list-all = extract per chunk + merge + dedupe | LOCKED |
| AO-7 | Notifications in-app MVP, push Later | LOCKED |
| AO-8 | No Claude context-editing / compaction / task-budget betas; own context guard G46 + tool result caps | LOCKED |
| AO-9 | Sub-agents Later (normal chat); research mode only | SUPERSEDED draft by 10b (sub-agents = research only) |
| AO-10 | Completion check before final answer | LOCKED; detail SUPERSEDED-INTO Stage 13 VD-6/OV11 (doc-sync 2026-10-03) |
| AO-11 | Per-company quotas for long tasks + remaining counter | LOCKED (numbers Stage 18) — DEFERRED (company) |
| AO-12 | Send blocked until file ready (D1) | LOCKED |
| AG10 | Never xhigh / max effort | LOCKED |
| AG12 | Prompt rule: continue until done, ask only when blocked or before a risky step | LOCKED |
| FD-1 / steering | No 2nd message during a running turn; no mid-task steering, no sub-agents in normal chat | LOCKED |
| O-2 / N-06 | Fast/Normal/Deep = 1–2 / 5 / 15 tool steps, turn deadline 10 min | LOCKED input (Stage 4), used by Stage 10 |
| AO-4b | Durable run: turn survives the viewer; resume; checkpoints; run state not in one process (Stage 5 F3, 05-2 F1–F4, N-73) | LOCKED (cross-stage; owned by Stage 5 audit, bucketed here because Stage 10 AO-4/AO-5 depend on it) |
| RS-1 | Flow: clarify (≤1 round) → editable plan → 3–5 parallel helpers (web + files) → notes checkpointed → lead writes report artifact (docx/PDF) + chat summary → citation check (= OV12) → in-app notify | LOCKED (provisional) |
| RS-2 | Provider-consistent: Gemini research = Gemini helpers + lead; Claude research = Sonnet helpers (native web_search) + Sonnet/Opus lead; Google-grounded results never go to Claude | LOCKED |
| RS-3 | Per run: max 30 min, 50 searches, 5 helpers; scaled (3–10/1, 10–15/2–4, 30–50/5) | LOCKED (N-19) |
| RS-4 | Company monthly research quota + remaining counter (5 runs/company/month, N-19/N-64) | LOCKED — DEFERRED (company) |
| RS-5 | Cloud Run job + checkpoints; cooperative cancel; Stop → partial report | LOCKED |
| RS-6 | Sources: web + chat/project files | LOCKED |
| RS-7 | Company admin Research ON/OFF; needs web search ON | LOCKED — DEFERRED (company admin) |
| RS-8 | Keep / limit / paid add-on after Stage 21 + Stage 18 | process gate, no code |
| RG1 | Store only our model's notes + source links, never raw Google-grounded snippets | LOCKED (lawyer list) |
| RG2 | Gemini-grounded research reports follow SL-1 share rule (hidden/warned) | LOCKED |
| RG3 | Claude research: cost reserved before start (R2); not enough Claude budget → offer Gemini | LOCKED |
| RG4 | Research run enables search for that run only (overrides toggle), cap 50 | LOCKED |
| RG5 | Research progress steps persisted in DB | LOCKED |
| RG6 | Chat running research shows progress + Stop; other chats stay free | LOCKED |
| RG7 | Effort: helpers medium, lead high; never xhigh/max | LOCKED |
| RG8 | Every helper call recorded in the usage ledger (G44) | LOCKED |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched: …)" |
|---|---|
| AO-2 | Tool step labels `frontend ToolActivity.tsx:55-60` (memory) + the full verb table in that file; stream frames `tool_use`/`tool_result` consumed `workspace.tsx:529-566`; progress frames `generation.ts:1007-1019` persisted as `research_events` (`schema.ts:348-362`, `generation.ts:1018`). Editable plan: not found (searched: `plan`, `Start research`, `editable` in `arcnave-frontend/src`). |
| AO-3 | Mechanism: `ask_user_input_v0` (`tools/definitions.ts:522`, `optionsExecutor.ts:2`), ends the loop (`toolLoopPolicy.ts:21-31`, used `anthropic.ts:622-625`, `gemini.ts:568-571`). Rule in prompt: "check in only when different readings … would lead to materially different work" (`systemPrompt.ts:44`). "One round" is not enforced in code. |
| AO-4 | No Cloud Tasks / Cloud Run job / Redis client (searched `cloudtasks`, `@google-cloud/tasks`, `ioredis`, `redis` in `backend/src` + `package.json`: one comment hit in `container.ts`). Turns run inside the HTTP process (`chats.ts:585-659`). Turn deadline `TURN_DEADLINE_MS` 3,540,000 ms (`config/numbers.ts:39`, applied `generation.ts:378`). |
| AO-5 | Stop = `POST /chats/:id/stop` aborts an in-process `AbortController` (`chats.ts:696-712`; map `container.ts:71,251`); abort checked at every round boundary (`anthropic.ts:440`, `gemini.ts:398`), per streamed event (`anthropic.ts:502`, `gemini.ts:474`), and at tool entry (`tools/executor.ts:60`, `memoryExecutor.ts:73`); partial text/tool steps persisted as `stopped` (`generation.ts:1047-1049, 1169-1177`) and usage still recorded (`generation.ts:1191-1205`). No DB cancel flag; a Stop reaching another instance finds no controller (`chats.ts:709-711` returns `stopped:false`). |
| AO-6 | not found (searched: `map.?reduce`, `coverage`, `whole.document`, `chunk` loops in `backend/src` non-test). Only whole-file inclusion up to a size (`generation.ts:1957-1965`, `config.ts:171`) or search (`generation.ts:1975-1984`). |
| AO-7 | not found (searched: `notif`, `answer ready`, `finished in another` in `arcnave-frontend/src`; only `role="status"` toasts `App.tsx:372`, run status `App.tsx:1103`). |
| AO-8 | No Claude betas: searched `context_management|betas|compact_20|clear_tool_uses` in `backend/src` (non-test) → none. Own guard: Gemini adapter clears old function responses past `CONTEXT_EDIT_TRIGGER_TOKENS` 100,000 (`gemini.ts:382-388,408`, `config.ts:159-161`); own rolling compaction (`services/compaction/*`, `config.ts:310-317`). |
| AO-10 | Only an empty-reply guard: if the loop ends with no text, one more request without tools (`generation.ts:1102-1165`); loop ended at the cap → forced final answer + `tool_limit` (`anthropic.ts:466-480,577-580`, `gemini.ts:399-407,531-534`). No check that a promised artifact / requested format exists (searched: `promised`, `completion` in `backend/src`). |
| AO-11 | Per-user token budgets only (`usage.ts`, `preferences.dailyTokenBudget` `schema.ts:101-102`); no company, no long-task counter. |
| AO-12 | Composer disables send while any file is `uploading` (`Composer.tsx:445,451,808`) and shows the hint (`:833`); server finishes processing inside the upload call, status `uploading` → `ready`/`unsupported` (`routes/files.ts:249,303,526`); failed/unsupported files are dropped from the send (`Composer.tsx:452-454`). |
| AG10 | xhigh/max are accepted everywhere: route enum `chats.ts:551`, preferences `preferences.ts:41,95`, DB check `schema.ts:121,316`, ladder `capabilitiesTable.ts:66,82,152`, `types.ts:292`, test expects `{effort:'xhigh'}` forwarded (`anthropic.adapter-loop.test.ts:545`). |
| AG12 | `systemPrompt.ts:44` ("Make routine judgment calls yourself … Finish the whole task, and stop short of actions that are clearly beyond what was asked"). |
| FD-1 | `run_in_progress` when a run is active (`chats.ts:568`); no sub-agent or steering code. |
| O-2 / N-06 | One flat cap `TOOL_MAX_ROUNDS` 16 (`config/numbers.ts:43`, `config.ts`; `resolveMaxRounds` `toolLoopPolicy.ts:11-13`). No Fast/Normal/Deep profiles (searched `profile`, `Fast`, `Deep` in `backend/src` non-test: none as turn profiles). |
| AO-4b | `RunHub` is process memory (`runHub.ts:1-12, 89-126`): buffer ≤50,000 events (`:17`), finished run kept 5 min (`:20`), `id:` = index in that buffer (`:44-53`, `chats.ts:828`). Replay `GET /chats/:id/stream?after=` (`chats.ts:668-692`) returns 404 `no_active_run` on any other instance (`:686-689`) and the client polls the row (`workspace.tsx:658-665`). Assistant text persisted only at the end (ADR-0009 Consequences). No lease/heartbeat, no orphan sweep for `generating` rows after a crash (searched `'generating'` in `backend/src` non-test: only set at `chats.ts:1154,1202`, errored at `:643-652`, read as `stopped` at `:1044`). `index.ts:71` aborts runs on SIGTERM. Sandbox "checkpoints" (`sandboxCheckpoints.ts:18-37`) are idle workspace snapshots, not turn checkpoints. |
| RS-1…RS-3, RS-5, RS-6, RG1, RG3, RG4, RG7, RG8 | not found. `mode: 'research'` exists (`chats.ts:49`, `providers/types.ts:21`) but only routes to the "quality" tier (`routing.ts:64-65`), requires grounding (`generation.ts:500-510`), and adds a one-paragraph directive "write a research report … in the chat text stream" (`generation.ts:2014-2016`). No plan, helpers, notes table, report artifact, citation check, quota, ledger rows per helper (searched `research_run`, `research_note`, `helper`, `sub.?agent` in `backend/src`: none; only `researchEvents` progress rows). Usage is one row per turn (`generation.ts:1191-1205`). |
| RG1 (side finding) | In normal chat Google-grounded source snippets/passages are stored (`schema.ts:340-341`, `grounding.ts:141`, `generation.ts:2159`). RG1 concerns research notes only, but the lawyer item (derived notes) will cover it. |
| RG2 | Share route returns the message sources of any answer (`routes/share.ts:383-393`); no check that the answer is Google-grounded. |
| RG5 | `research_events` rows per message, ordinal-unique, DB-persisted (`schema.ts:348-362`, `generation.ts:1018`), returned on reload (`chats.ts:916,945`). |
| RG6 | One run per chat (`chats.ts:568`); the browser keeps a single `controller` ref and `activeRun` (`workspace.tsx:443-444`), so a second chat in the same tab cannot run at once. |
| Tool loop mechanics (repo-only, ADR-0026/0034) | Round loop `anthropic.ts:434-626`, `gemini.ts:393-573`; cap `maxRounds = resolveMaxRounds(TOOL_MAX_ROUNDS, useTools)` (`anthropic.ts:424`, `gemini.ts:390`); last round: `tool_choice:none` (Claude `anthropic.ts:470-479`) / function calling `NONE` + final-round note (Gemini `gemini.ts:404-407,433-434`), any call made then is not run, `finishReason='tool_limit'`; parallel calls: all calls of a response run **in order** and return in one message (`anthropic.ts:585-620`, `gemini.ts:547-566`); duplicate failed call is not re-run (`anthropic.ts:595-609`); `pause_turn` resume uses a round (`anthropic.ts:561-569`); Continue at the limit = `CutShortNote` + a user message "Continue exactly where you stopped." (`ChatStates.tsx:159-191`, `App.tsx:887`). |

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| AO-2 | KEEP | live step list + persisted progress frames exist (ToolActivity.tsx:55-60, generation.ts:1007-1019) |
| AO-3 | KEEP | ask_user_input_v0 + prompt rule meet the outcome (definitions.ts:522, systemPrompt.ts:44) |
| AO-4 | DIFF-INFRA | Cloud Tasks executor / Cloud Run jobs are infra; the 10-min vs 59-min deadline is a number, see Q2 |
| AO-5 | KEEP | Stop aborts at every step and keeps partial (chats.ts:696-712, generation.ts:1169-1177); cross-instance part is in AO-4b |
| AO-6 | NEW-BUILD | nothing exists; whole-document map-reduce with coverage % |
| AO-7 | NEW-BUILD | no in-app "finished in another chat" notice |
| AO-8 | KEEP | no Claude betas; own guards (gemini.ts:408, config.ts:310-317) |
| AO-10 | NEW-BUILD | only empty-reply guard exists; built together with Stage 13 VD-6 |
| AO-12 | KEEP | send blocked while uploading; processing is inside the upload call (Composer.tsx:445, files.ts:249,303) |
| AG10 | REWRITE | xhigh/max accepted at API, DB check, UI ladder |
| AG12 | KEEP | systemPrompt.ts:44 |
| FD-1 | KEEP | one run per chat, no steering (chats.ts:568) |
| O-2/N-06 | REWRITE | one cap of 16 rounds, no Fast/Normal/Deep tool-step profiles |
| AO-4b | NEW-BUILD | run state is process memory; durable event log + lease + resume needed (Postgres first, Redis later = DIFF-INFRA) |
| RS-1 (+AO-1, AG14, AG15, RD-13 data) | NEW-BUILD | only a mode flag + prompt paragraph exist |
| RS-2 | NEW-BUILD | provider-consistent helpers + lead |
| RS-3 | NEW-BUILD | per-run caps 30 min / 50 searches / 5 helpers |
| RS-5 | NEW-BUILD | notes checkpoint table, cancel → partial report; the Cloud Run job host is DIFF-INFRA (in-process worker first) |
| RS-6 | NEW-BUILD | web + chat/project files for helpers (needs Stage 12 file search) |
| RG1 | NEW-BUILD | notes table stores only own notes + links |
| RG2 | REWRITE | share route returns sources of grounded answers (share.ts:383-393) |
| RG3 | NEW-BUILD | Claude research budget reservation + Gemini offer |
| RG4 | NEW-BUILD | per-run search override, cap 50 |
| RG5 | KEEP | research_events persisted (schema.ts:348-362) |
| RG6 | REWRITE | single controller ref blocks parallel chats in one tab (workspace.tsx:443-444) |
| RG7 | NEW-BUILD | helper/lead effort; with AG10 |
| RG8 | NEW-BUILD | one ledger row per helper call |
| AO-11, RS-4, RS-7 | DEFERRED | company/tenancy quotas and admin switch — in `_parts/deferred-g3.md`, not bucketed |
| RS-8 | n/a | process gate after Stage 21/18; no code |

Counts (31 ids): KEEP 8 · REWRITE 4 · NEW-BUILD 14 · DIFF-INFRA 1 · DIFF-STACK 0 · DISCARD 0 · DEFERRED 3 · n/a 1.

## 4. Non-KEEP items

### AG10 — never xhigh / max effort
- Exact change: remove `xhigh`/`max` from the user-selectable and API-accepted effort set for chat turns; research helpers medium, lead high (RG7). Map the stored values on read (existing rows with xhigh/max → high). Files touched: `routes/chats.ts:551`, `routes/preferences.ts:41,95`, `db/schema.ts:121,316` (+ migration), `providers/capabilitiesTable.ts:66,82,152`, `providers/types.ts:292`, `config.ts:166`, `routes/models.ts:71,136`, frontend effort picker, tests `anthropic.adapter-loop.test.ts:545`. Port source: none.
- Option A (REWRITE): shrink the enum everywhere + migration clamp. Time S · risk low (stored prefs) · breaks the xhigh test and ADR-0030-era effort notes.
- Option B (REWRITE at the service boundary only): keep stored values, clamp to `high` in `GenerationService` and hide the two levels in the UI. Time S · risk: API still lies about what is accepted · breaks fewer tests.
- Pick: A — the locked rule is "never", and a clamp hides a promise the API still makes (Invariant 1 spirit).

### O-2 / N-06 — tool-step profiles and the turn deadline
- Exact change: introduce the Fast/Normal/Deep profile that carries steps (1–2 / 5 / 15) and read the values from the register through `config/numbers.ts` (N-06). Deadline: see Q2. Files: `config/numbers.ts:39,43`, `toolLoopPolicy.ts`, both adapters, `generation.ts`. Profile selection belongs to Stage 4/6/7 audits (router tier); this item only consumes it. Port source: none (`arcnave.in:backend/packages/gateway/.../router.py` carries tier, not tool steps).
- Option A (REWRITE): profile object resolved once per turn → `maxRounds`. Time M · risk medium (Continue/`tool_limit` UX tuned to 16) · breaks `toolLimit.integration.test.ts`, adapter loop tests.
- Option B: keep 16 as the Deep value and add smaller caps for Fast/Normal only. Time S · risk low · register value for Deep (15) still differs by one.
- Pick: A — one number table, no off-by-one; do it with the profile work from Stage 6/7.

### RG2 — Google-grounded answers on the share page
- Exact change: the share route must drop (or warn on) answers produced by a Gemini-grounded turn (SL-1), including `sources` and the search entry point; needs a persisted `grounded_provider` flag on the message. Files: `routes/share.ts:383-393`, `db/schema.ts` (messages), `generation.ts finalise`, frontend SharedPage. Port source: none.
- Option A (REWRITE): add the flag and filter in the share query. Time S · risk low.
- Option B: infer from `modelAlias` at read time. Time XS · risk: wrong when Auto routed or a Claude turn quoted Google sources.
- Pick: A.

### RG6 — other chats stay free while one runs
- Exact change: per-chat run controllers in the browser (map by chat id) and a sidebar "running" mark. Files: `workspace.tsx:443-444`, `App.tsx`. Time S · risk low · breaks `ChatView.test.tsx` expectations about one `activeRun`.
- Option B: leave as is until research mode is built. Pick: A with the research build (RG6 is only visible once runs take minutes).

### AO-4b — durable run (event log, lease, resume, cross-instance cancel)
- Exact change: persist every stream event (seq, type, payload) to a Postgres table per turn; SSE reads from it (replay after `Last-Event-ID`/`?after`, `snapshot` when the gap is gone); the run holds a lease + heartbeat; Stop writes a cancel flag the runner checks (≤2 s idle check, N-73) and in-process abort stays as the fast path; a sweep marks `generating` rows with an expired lease as failed/resumable. Redis pub/sub (later) replaces polling = DIFF-INFRA. Files: new `services/runStore.ts`, `runHub.ts` (becomes cache over the store), `routes/chats.ts:568-712,779-834`, `generation.ts` (publish path), schema + migration, `index.ts` sweep. Port source: `arcnave.in:backend/packages/chat/src/arcnave_chat/stream.py` (`PostgresStreamStore`), `arcnave.in:backend/apps/api/src/arcnave_api/chat/relay.py` (replay/snapshot/ping/disconnect rules), `arcnave.in:backend/packages/chat/src/arcnave_chat/runner.py` (lease, deadline, shutdown).
- Option A (NEW-BUILD beside RunHub): build the store, write events to both, switch the reader, then retire the in-memory path. Time L · risk medium · app stays runnable at every commit · breaks `runResume.integration.test.ts`, `chats.integration.test.ts` expectations of 5-min retention.
- Option B (REWRITE RunHub in place to write-through). Time M · risk higher (one commit changes the transport).
- Pick: A — keeps the app runnable and lets Stage 14 SSE events (`ping`, `snapshot`, `Last-Event-ID`) land on the new reader. company_id on the new table: see deferred file D-G3-01.

### AO-6 — whole-document map-reduce with coverage %
- Exact change: a job that maps every chunk/page (map on Gemini Flash per the draft AO-6; reduce on the chosen model), counts covered/total, shows "1,000/1,000 pages", list-all = extract per chunk + merge + dedupe; stored as a message with coverage metadata; cooperative cancel keeps partial. Files: new `services/mapReduce.ts`, tool/intent hook (Stage 12 intent table), `routes`, frontend progress. Port source: none (LV test only: `arcnave.in:backend/apps/lvrunner/...` has no map-reduce).
- Option A (NEW-BUILD in-process worker, same process as the turn, behind the durable-run store): ships without Cloud Run jobs. Time L · risk medium (long CPU in the API process; N-65 job layout is DIFF-INFRA later).
- Option B: wait for the Cloud Run job host. Time L+ · risk: blocks Stage 12 intent routing for summarise/list-all.
- Pick: A.

### AO-7 / AO-10 / RS-* family
- AO-7: add a polite status line + toast when a run in another chat ends (uses the per-chat run map from RG6). Time S. Pick: build with RG6.
- AO-10: build with Stage 13 VD-6 (deterministic part first). See `stage-13.md` V-08.
- RS-1/2/3/5/6, RG1/3/4/7/8 (research mode, one design): plan step (editable list in UI) → N helpers (3–5; provider-consistent per RS-2) each with its own search budget and a shared citation registry (Stage 12 RE43) → notes rows (`research_run`, `research_note`: only own notes + source links, RG1) → lead writes a docx/PDF artifact + chat summary → Stage 13 OV12 pre-publish citation check → in-app notify; limits 30 min/50 searches/5 helpers (N-19); RG4 search override; RG8 one usage row per helper call; Stop → partial report from saved notes. Files: new `services/research/*`, `db/schema.ts` + migration, `routes/research.ts`, frontend plan editor/early findings/TOC (Stage 14 RD-13), `usage.ts`. Port source: none.
  - Option A (NEW-BUILD in-process, helpers as concurrent provider calls, notes in DB): Time L · risk medium (runs up to 30 min inside the API process; needs AO-4b first) · no existing test breaks.
  - Option B (wait for Cloud Run job executor, Phase 5): Time L (later) · risk: research stays "Later", which contradicts the checkpoint ("MVP, provisional") and build-plan P3-E, which says "Later – record in ADR". That ADR would be a deviation (Q1).
  - Pick: A, after owner answers Q1.

## 5. Open questions for the owner
- Q1. Build plan P3-E says "Research mode: Later – record in ADR"; checkpoint Stage 10 + 10b lock it as MVP (provisional) with a Stage 21 keep/limit gate (RS-8). ADR-0061 says the locked decision wins. Confirm: build research mode now (Option A above), or write an owner-approved deviation ADR?
- Q2. Turn deadline: register N-06/N-43 say 10 min (Executor 15 min); repo runs turns inline up to 59 min (`numbers.ts:39`). Until a Cloud Tasks executor exists, keep 59 min (outcome "long work does not die") or cut to 10 min and push >10 min work to the research/map-reduce worker?
- Q3. ADR-0055/B-4 "three models only": RS-2 and AO-6 use Gemini Flash (in the three) and Sonnet/Opus (in the three); no Haiku/Flash-Lite needed for Stage 10 itself. Stage 10 raises no model conflict; the Flash-Lite judge for the completion check is Stage 13 (Q in `stage-13.md`).
- Q4. Stage 10 `RG1` lawyer item: normal-chat grounded snippets are already stored (`schema.ts:340-341`). Keep storing snippets for normal chat, or align with the research rule (links only)?

## 6. KEEP spot-check
(8 KEEP rows; 3 re-opened = 37 %.)
| Id | file:line | Result |
|---|---|---|
| AO-5 | `chats.ts:696-712` (stop aborts `activeRuns` controller), `generation.ts:1169-1177` (status `stopped`, collected text saved), `anthropic.ts:440,502` (abort checked per round and per event) | confirmed for a single instance; DB-flag / cross-instance cancel is NOT present → carried in AO-4b |
| AO-8 | searched `context_management|betas|compact_20|clear_tool_uses` in `backend/src` non-test → 0 hits; `gemini.ts:408` clears old function responses (own guard, not a Claude beta) | confirmed |
| AO-12 | `Composer.tsx:445,451,808`; `routes/files.ts:249,303` (status `uploading` → `ready` after server processing) | confirmed; failed files are excluded from the send rather than blocking it (`Composer.tsx:452-454`) — acceptable under AS-D6 Retry/Remove, checked by Stage 9 audit |
