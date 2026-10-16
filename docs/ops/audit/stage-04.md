# Stage 04 — Architecture layers (L1–L8): conformance audit
Sources read: 00-checkpoint-stage4.md, 00-checkpoint-L1-L5.md, 04-architecture-layers.md, 04-L1-client-layer.md, 04-L1b-existing-frontend-review.md, 04-L2-edge-layer.md, 04-L3-api-layer.md, 04-L4-orchestration-layer.md, 04-L4-final-lock.md, 04-L4-claude-gaps.md, 04-L4-round2-findings.md, 04-L4L5-contracts-round.md, 04-L5-intelligence-services.md, 04-L5a…L5g, 04-L5h-claude-docs-crosscheck.md, 04-L5i-second-audit.md, 04-L6-async-layer.md, 04-L7-data-layer.md, 04-L8-platform-layer.md, 04-stage4-design-review.md; 00-numbers-register.md (N-01, N-03, N-06, N-24, N-33, N-35, N-42, N-43, N-45, N-66); build plan; ADR-0053…0057; repo `CLAUDE.md`; repo code listed in section 2. Not read: 04a-vendor-doc-research.md (vendor input to the superseded C1–C10 of the first Stage 4 draft). The text of runtime ids G50–G63 is not in the mirror (04-L4-final-lock.md names only their families), so they cannot be checked. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Stage 4 has two checkpoint files plus the layer docs. Stage 4 locks the contracts of services whose design belongs to later stages (6 context, 7 routing, 8 tools, 9 files/speech, 11 memory, 12 retrieval, 13 validation, 15 errors, 16 safety, 17 observability, 19 infra). Rows for those ids are marked "n/a (Stage N)": the owning stage file carries the bucket; they are not counted here. Ids that only Stage 4 owns (layer rules, L1 modules, L2/L3 contracts, L4 runner contract, L6/L7/L8 platform items, design-review R1–R14) are bucketed here. Everything company, RLS, roles, Redis, Cloud Tasks, Terraform, OTel and NO_CONTENT enforcement is listed in deferred-g1.md, not bucketed.

## 1. Locked decisions
Status column: LOCKED unless noted. Row labels (A1…J8) group tightly related ids; every id is listed.
| Row | Ids | Decision (one line) | Status |
|---|---|---|---|
| A1 | LR1 | A layer calls only the layer below via an interface; orchestrator never writes SQL (uses repositories) | LOCKED |
| A2 | LR2 | Ports and adapters: every vendor behind a port with one adapter | LOCKED |
| A3 | LR3 | Tenant context {company, user, role, request id} travels with every call | DEFERRED (company) |
| A4 | LR4 | One internal message/event format; adapters translate at the edge of L5 | LOCKED |
| A5 | LR5 | Stateless API service; state in L7 | DEFERRED (Redis/DB relay) |
| A6 | LM | Deploy mapping (L3+L4+L5 sync -> API, L6 -> worker, L7 managed, L8 shared); superseded to 3 deploys | DEFERRED |
| B1 | L1-M1 | Auth module: e-mail/password + Google; token in encrypted storage (Android) | LOCKED |
| B2 | L1-M2 | API client generated from the OpenAPI schema, same typed logic for web + Android | LOCKED |
| B3 | L1-M3 | Stream client: typed events, tracks last seq, reconnects with it | LOCKED |
| B4 | L1-M4 | Composer: attachments chips, mic, model picker with Auto, Send disabled until files ready, Stop | LOCKED |
| B5 | L1-M5 | Upload manager: pre-check, signed URL, resumable, progress | LOCKED |
| B6 | L1-M6 | Mic module -> /speech -> editable text | LOCKED (= stage-01 R3m) |
| B7 | L1-M7 | Answer renderer, incremental markdown, citation chips, never raw HTML | LOCKED (Stage 14) |
| B8 | L1-M8 | Conversation UI: list/open/rename/delete, pagination, stopped/failed states | LOCKED |
| B9 | L1-M9 | Local store: drafts + UI prefs only | LOCKED |
| B10 | L1-M10 | Error UX maps codes to friendly messages | LOCKED |
| B11 | L1-M11 | Version guard: app sends version, server can force update | LOCKED |
| B12 | L1-M12 | Client telemetry: crash + performance only, no content | LOCKED (Stage 17) |
| B13 | L1-M13, UI-2 | Admin panel (web only) | DEFERRED (company) |
| B14 | UI-1 | Next.js web + Expo Android, shared TypeScript | LOCKED; web framework differs (build plan B-1) |
| B15 | UI-3 | UI language English only | LOCKED |
| B16 | UI-4, G4, G8, G13 | Push, temporary chat, export, source labels: later / not needed | n/a |
| B17 | UI-5 | Claude ON/OFF per company by ArcNave ops only | DEFERRED (company; B-6 dropped it) |
| B18 | G1, G2 | Edit a sent message -> regenerate; see other versions | LOCKED (data model: stage-05 F4) |
| B19 | G3 | Share chat link | LOCKED (company-only default: SHD-1, DEFERRED) |
| B20 | G5 | Search my chats (title + text) | LOCKED |
| B21 | G6 | 👍/👎 feedback with reason | LOCKED (table: stage-05) |
| B22 | G7, G9, G10 | Copy answer/code; drag-drop + paste; upload limits shown with clear message | LOCKED |
| B23 | G11 | Web search toggle | LOCKED (Stage 8) |
| B24 | G12 | Self-serve delete my data/chats | LOCKED |
| C1 | L2 components 1–9, 13 | DNS, TLS, global LB, Cloud Run ingress lock, Cloud Armor WAF/DDoS/rate limit, streaming path, CDN rule, edge logging | DEFERRED (Terraform) |
| C2 | L2 comp 10 | CORS allows only the app origin | LOCKED |
| C3 | L2 comp 11 | Security headers (HSTS, CSP, nosniff, frame-ancestors, Referrer-Policy; noindex on share) | LOCKED (set at edge/web server) |
| C4 | L2 comp 12 | Request limits at edge: JSON bodies small (<= 1 MB); uploads never via API | LOCKED |
| C5 | E-1 | Next.js on Cloud Run behind the same LB | LOCKED; web framework/hosting differs (build plan ADR-0060 pending) |
| C6 | E-2, E-4 | Domain; bot protection on signup/login | DEFERRED (infra; Phase 5 security) |
| C7 | E-3, E-5 | Share pages not cached; no country block | LOCKED |
| C8 | L2-G1 | Heartbeat `ping` events every ~15 s | LOCKED |
| C9 | L2-G2, G4, G5 | One error format + request-id on every response; clear 413; error event mid-stream | LOCKED |
| C10 | L2-G3 | 429 with Retry-After; distinct code for quota finished (no retry) | LOCKED |
| C11 | L2-G6, G7, G8, G9, G10 | IP allowlist, fixed egress IP, model-stream resume (moved), residency wording, status page | later / moved |
| D1 | L3 pipeline 1, 2, 5 | Request id; verify token; schema validation from one OpenAPI source | LOCKED |
| D2 | L3 pipeline 3 | Client version check (old Android -> "update required") | LOCKED (= B11) |
| D3 | L3 pipeline 4, 6, 8 | Rate limit per user + company; idempotency key (24 h); one error formatter | LOCKED; formatter SUPERSEDED by Stage 15 doc-sync (RFC 9457) |
| D4 | L3 pipeline 7 | Handler calls L4 / repositories | LOCKED (= A1) |
| D5 | L3 pipeline 9 | Audit log for admin/ops actions | DEFERRED |
| D6 | L3 endpoint catalogue | `/me`, `/models`, `/conversations`, `/conversations/{id}/turns`, `/turns/{id}/regenerate|cancel|events`, `/files`, `/speech/transcribe`, `/messages/{id}/feedback`, `/conversations/{id}/shares`, admin, ops | LOCKED |
| D7 | L3 doc-sync endpoints | /memory, /admin/*, job/file status, signed upload session, min-app-version, artifacts, research runs, preview URL, /report, notifications, citation resolve, MFA/CSRF/auth, incident banner | LOCKED (owned by Stages 6, 10, 11, 14, 16, 17) |
| D8 | L3 streaming contract | Named events `ack, status, delta, citation, tool_status, ping, error, done` (+ `thinking`, `retract` in L4); every event has `seq`; SSE `id` = seq; `Last-Event-ID` works | LOCKED |
| D9 | L3 streaming contract | One active turn per conversation (second Send -> 409) | LOCKED |
| D10 | L3-G1, G3, G6, G12, A-2 | Clients ignore unknown fields/events; cursor pagination on lists; cancel idempotent; models list; REST + SSE | LOCKED |
| D11 | L3-G4 | Rate-limit headers (limit/remaining/reset) so the app can show "N messages left" | LOCKED |
| D12 | L3-G5 | `retract`/replace event for a streamed answer that fails the output check | LOCKED |
| D13 | L3-G7 | Per-company + per-user quota settings (ops console) | DEFERRED |
| D14 | L3-G8, G9, G10, G11, A-3 | Webhooks, audit export, SSO/SCIM (later); token counting (L5); rate numbers (N-01) | later / n/a |
| D15 | A-1 | Backend Python + FastAPI + Pydantic | SUPERSEDED by build plan B-1 (Node/Fastify) -> DIFF-STACK |
| E1 | L4 state machine | RECEIVED -> POLICY -> PLAN -> SAFETY_IN -> CONTEXT -> GENERATE <-> TOOLS -> VALIDATE -> SAVE -> DONE, with checkpoint per change | LOCKED (turn row: stage-05) |
| E2 | L4 comps 1, 4, 5, 7 | Turn runner (409 on second run), context builder call, generation runner, budget meter | LOCKED |
| E3 | L4 comp 2 | Policy engine (model allowed, quotas, Claude cap, file readiness) | DEFERRED for company/role/Claude-switch/kill-switch parts |
| E4 | L4 comps 3, 6, 8, 9, 10 | Planner/router, tool loop runner, deadline + cancel, validator call, event emitter | LOCKED (Stages 7, 8, 13, 15; emitter = D8) |
| E5 | L4 comps 11, 12 | Checkpoint store; tracer | DEFERRED (executor; OTel) |
| E6 | O-1 | Own thin orchestration runner (no ADK/LangGraph) | LOCKED; language Python -> Node = DIFF-STACK |
| E7 | O-2 | Profiles Fast 1–2 / Normal 5 / Deep 15 tool steps; turn deadline 10 min | LOCKED (Stage 7) |
| E8 | O-3 | 3 deploys: API (relay) + Turn Executor (Cloud Tasks) + worker | DEFERRED |
| E9 | L4-G1, G2 | Every failure path ends in a controlled final message; typed failure classes | LOCKED |
| E10 | L4-G3, G4, G7, G9, G12, G13, G14, G15, G16, G19–G25 | Parallel tools, tool limits, effort scaling/profiles, LLM-judge evals, task budgets, approvals, JIT context | LOCKED (Stages 6, 7, 8, 10) |
| E11 | L4-G5, G6, G8 | Checkpoint + resume; deploy without killing runs; per-turn trace | DEFERRED |
| E12 | L4-G10, G11, G34 | Multi-agent research, handoffs, streamed tool args | later |
| E13 | L4-G26, G28, G30, G31, G33, G37, G45 (= G45-R), L5-G18 | Gemini thought signatures stored/returned; Claude thinking-block rules; capability matrix; one effort knob; 429 backoff + jitter; async cancellation + bounded buffer; NO sampling params to any model | LOCKED |
| E14 | L4-G27, G29, G32, G38, G39, G40, G46, G47 | Reasoning blobs per provider, finish-code map, thinking tokens as output, timeout hierarchy, retry matrix, tool idempotency, in-turn context growth guard, planner fallback | LOCKED (Stages 7, 8, 15) |
| E15 | L4-G35 | Provider conformance tests before every model/SDK upgrade | LOCKED |
| E16 | L4-G36, G41, G48 | Turn record spec; branch-aware history; config version stamp on every turn | LOCKED (stage-05) |
| E17 | L4-G42 | Per-company fairness (max concurrent turns) | DEFERRED |
| E18 | L4-G43 | Client-side provider rate limiter (token bucket per model) | LOCKED |
| E19 | L4-G44 | Per-call usage ledger write (input/output/thinking/cached) | LOCKED |
| E20 | L4-G49 | Kill switch: ops can disable a model, tool or profile without redeploy | LOCKED |
| E21 | L4-G50–G63 | Runtime / distributed / concurrent-action / cache-stampede items | text absent from mirror |
| E22 | L4-G17, G18, L5-G10, R3, R4, RV-2 | Refusal -> retract + client-side retry on allowed categories; fallback chain per profile; circuit breaker per model; Gateway uses only the policy's allowed list; harmful categories never fall back | LOCKED (RV-2 made concrete by Stage 16 SD-9) |
| E23 | C1–C34 | Claude tool-loop, stop-reason, thinking, context rules | LOCKED (Stages 7, 8, 15) |
| E24 | P1–P8 | Policy engine contract: check order, cache, fail closed, org-policy model allow-list, partner features, repeat offender, degrade, decision log | DEFERRED (company/Redis/Terraform) |
| E25 | V1–V8, V-1, V-2 | Validator contract and grounding judge | LOCKED (Stage 13) |
| E26 | PE-1, PE-2, PE-3 | Fail closed; auto-switch to Gemini with a note when Claude budget ends; org-policy model allow-list | DEFERRED (company/Terraform) |
| F1 | L5 services | Context, Retrieval, Memory, Tool services | LOCKED (Stages 6, 12, 11, 8) |
| F2 | L5 service | Speech service | LOCKED (= stage-01 R3m) |
| F3 | L5 service, SF1–SF21, SAF-1…SAF-7, CSF1–CSF4 | Safety service: input/tool/output checks, M9 screen model, crisis path, repeat offenders | LOCKED (Stage 16) |
| F4 | L5-G1…G25 (except G10, G18) | Cache order, schema translator, token counting, usage normalizer, price table, modality matrix, event normalizer, SDK lifecycle | LOCKED (Stages 6, 7) |
| F5 | CL1–CL13, CX1–CX12, CX14–CX21, S-1…S-3, D-1…D-3, R1–R22 (L5c), RT-1…RT-3, M1–M15, MEM-1…MEM-5, T1–T25, CT1–CT9, TL-1…TL-6, SP1–SP20, CS1–CS2, SPD-1…SPD-5, N1–N18, TH-1, TH-2, A1–A17, B1–B16, SL-1, LV-1 | Detailed L5 contracts | LOCKED (Stages 6, 7, 8, 9, 11, 12, 13, 16) |
| F6 | CX13, CI-1, CI-2, CI-3 (with CXD-2, N-35) | Instruction layers: ArcNave base > company admin > project > user; project <= 5,000 chars, company <= 3,000; current date/time (IST) late in the prompt; mid-conversation system messages | LOCKED (company layer DEFERRED) |
| G1 | AS1–AS4, AS10–AS13, AS15, AS16, AS19, AS25–AS28, CA1–CA5, AS-D1, AS-D2, AS-D3, AS-D5 | Cloud Tasks / Scheduler / Redis queue rules, retries, fencing, outbox names, queue split | DEFERRED |
| G2 | AS5–AS9, AS14, AS18, AS23 | Job catalogue, one status model, expiry, per-item results, failed-job table, DB idempotency, versioned writes, step-level file states | DEFERRED (with the queue) |
| G3 | AS17 (with UG4 UD-1) | Skip re-processing unchanged files by file hash + pipeline version (same company only) | LOCKED |
| G4 | AS20, AS-D4 | Deletion cascade resumable + verification sweep; gone <= 30 d, cascade <= 23 d | LOCKED |
| G5 | AS21, AS22 | Files reach a terminal state so Send never stays disabled; DB is truth for status | LOCKED |
| G6 | AS24, AS-D6 | Upload quotas; failed-file UX | LOCKED (= stage-01 FT-15, FT-10) |
| H1 | DB-1 | Cloud SQL PostgreSQL 17/18 Enterprise (HA before first paying customer), asia-south1 | LOCKED; Postgres version/HA is infra |
| H2 | DB-2 | pgvector in the same DB + FTS + pg_trgm | LOCKED -> owner question Q-V (stage-02.md) |
| H3 | D5, D6, D7 | halfvec/2,000-dim index limits; tenant filter + ANN; per-language keyword search | LOCKED (Stage 12) |
| H4 | D1–D4, D9, D17–D25, D28, DB-3, DB-4, DB-5 | Backup location, maintenance, HA, GCS soft delete, secrets replication, backups vs deletion, logs IDs-only, Redis RDB, log bucket locations, trace location, connection budget, India boundary, CMEK | DEFERRED (Terraform / NO_CONTENT / infra) |
| H5 | D8 | Alloy/Vertex Vector Search later | n/a |
| H6 | D10 | Signed upload URLs short, bound to type/size | LOCKED (Stage 9) |
| H7 | D11, DB-6 | ClamAV quarantine flow | LOCKED; deferred to Phase 5 by build plan Phase 2 |
| H8 | D12–D16, DB-7 | Tenant prefixes, RLS role/FORCE RLS, pooling + SET LOCAL, composite keys, per-company keys, tenancy | DEFERRED (company, RLS) |
| H9 | D26 | asyncpg statement cache off | n/a (stack) |
| H10 | D27 | Migrations: lock/statement timeouts, expand/contract; app timeouts N-45 | LOCKED |
| I1 | P1–P30, PL-1…PL-7 | Platform: org/projects/WIF/Artifact Registry/service accounts/VPC/secrets/budgets/uptime/Terraform | DEFERRED (Terraform) |
| I2 | P31 | API version header + min-supported-app-version | LOCKED (= B11) |
| I3 | P32 | Play Integrity | later |
| J1 | R1 | Claude history byte-identical turn to turn; stored rendered blocks | LOCKED (Stages 6, 7) |
| J2 | R2 | Atomic budget reservation before every model call, settled with real usage | LOCKED |
| J3 | R5, R10, R13, R14 | Redis degraded mode; executor cold start; lock lease; checkpoint schema version | DEFERRED |
| J4 | R6 | Summaries and file scope follow the branch path | LOCKED |
| J5 | R7, R8 | Deletion ledger outside restorable data; one personal-data map | LOCKED (stage-05) |
| J6 | R9 | Read-only tools cannot exfiltrate: sandbox no egress, fetch only user/search URLs, no external image auto-load | LOCKED (Stages 8, 14) |
| J7 | R11, RV-1, RV-3 | DPDP roles; company-only share default | DEFERRED (company) |
| J8 | R12 | Every endpoint checks the resource belongs to the caller; 404 not 403 | LOCKED |

## 2. Repo today
| Row | Evidence (file:line) or "not found (searched …)" |
|---|---|
| A1 | Routes and the orchestrator query the database directly: `backend/src/routes/chats.ts:875-882,1085-1215`, `backend/src/services/generation.ts:394-404,2138-2181`. No repository layer (searched `repositor` in backend/src: not found). |
| A2 | `Provider` port `providers/types.ts:378`; adapters `gemini.ts:8`, `anthropic.ts:8`; registry `registry.ts:93`. |
| A3 / A5 / A6 | `Services` carries `activeRuns` Map and `RunHub` in process: `container.ts:71-74,251-252`; `runHub.ts:10-12`. |
| A4 | Provider events `providers/types.ts:200`; stream events `services/generation.ts:122-142`: one format for both providers. |
| B1 | Cookie session `plugins/context.ts:40-56`; frontend `session.tsx:79`; Google button `GoogleSignInButton.tsx`. Android keystore: not found (no mobile app). |
| B2 | Hand-written client `arcnave-frontend/src/api.ts`, `adapter.ts`; the backend does produce `docs/openapi.json` (`backend/src/openapi.ts`, `CLAUDE.md:44`) but no client is generated from it (searched `openapi-typescript`, `openapi` in arcnave-frontend/package.json via src: not found). |
| B3 | Fetch-based SSE client with resume from last frame id: `arcnave-frontend/src/adapter.ts:109-241` (reconnect delays `0,1,2,4,8,15,30,60 s` at `:163` vs register N-46 1/2/4/8/16 s x5 + jitter). Unknown frames ignored: `parseFrame` `adapter.ts:273-279`. |
| B4 | Composer chips, mic, picker, Send gate, Stop: `Composer.tsx:180-239,388-437,445,795-812`. |
| B5 | Pre-check `arcnave-frontend/src/storage.ts:56-68`; resumable session `services/storage.ts:282-300`; progress `Composer.tsx:411-414`. |
| B8 | `Pages.tsx:51` (ChatsPage), `Navigation.tsx:279`, cursor list `chats.ts:194-251`, stopped/failed notes `ChatStates.tsx:86-194`. |
| B9 | `storage.ts:17-43` (prefixed localStorage for UI state only). |
| B10 | Typed codes -> copy `arcnave-frontend/src/api.ts:178` (`errorCopy`), `ChatStates.tsx:86` (FailureCard). |
| B11 | Not found (searched `app-version`, `x-app-version`, `min_app_version`, `update required` in backend/src and arcnave-frontend/src). |
| B12 | Not found (searched `telemetry`, `Sentry`, `crash` in arcnave-frontend/src: none). |
| B13 / B17 | Not found (single user; no admin routes). |
| B14 | React 19 + Vite SPA: `arcnave-frontend/src/main.tsx:1-35`, `App.tsx:120`; deployment `arcnave-frontend/nginx.conf`, Dockerfile. |
| B15 | English-only UI strings; Tamil/Devanagari fonts for content `main.tsx:5-8`. |
| B18 | Edit = copy of the chat up to the prompt, new "version" of the conversation (ADR-0038): `chats.ts:457-527`; regenerate re-runs the same assistant row and clears it: `chats.ts:1180-1215`. Detail in stage-05 F4. |
| B19 | Public link `routes/share.ts:83-248`, `schema.ts:468-491`; frontend `ShareLink.tsx:15`, `SharedPage.tsx:42`. |
| B20 | Title-only `ilike`: `chats.ts:217`; no message-text search (searched `tsvector`, `to_tsquery` in backend/src: only the memory index `schema.ts:793-797`). |
| B21 | Thumbs only: `chats.ts:717-739` (`feedback: up|down|null`), column `schema.ts:290`; no reason/comment. |
| B22 | Copy `App.tsx:910-920`; drag-drop `Composer.tsx:588`; paste `Composer.tsx:653`; limit messages `storage.ts:61-66`, `services/storage.ts:439-446`. |
| B24 | `DELETE /account` needs the current password: `routes/account.ts:81-111`; a Google-only account has none (ADR-0056 "Known gap"). |
| C2 | `app.ts:83-91` (origin list from `CORS_ORIGINS` `config.ts:81`, credentials true). |
| C3 | Web server adds `X-Content-Type-Options` only: `arcnave-frontend/nginx.conf:19`; no helmet in the API (searched `helmet`, `Content-Security-Policy` in backend/src, plugins: none; the CSP found is for the sandboxed frame `SandboxFrame.tsx:52`). Share pages: `X-Robots-Tag: noindex`, `Cache-Control: no-store` `routes/share.ts:103`. |
| C4 | One global body limit `cfg.MAX_UPLOAD_BYTES + 1 MiB` (31 MiB) for every route: `app.ts:71`. |
| C5 | See B14; hosting decision still open (build plan ADR-0060). |
| C7 | `share.ts:103` (no-store); no country block in code. |
| C8 | SSE comment `: heartbeat` every 15 s: `chats.ts:813-815`; no typed `ping` event (`generation.ts:122-142`). |
| C9 | `X-Request-ID` on every response `plugins/context.ts:45`, `app.ts:60-64`; one envelope `errors.ts:9-17`; 413 -> `payload_too_large` `app.ts:167-170`; mid-stream `error` frame `chats.ts:629-654`. |
| C10 | Rate-limit plugin with draft headers `app.ts:93-101`; 429 mapped `app.ts:162-165`; budget exhausted is a different code 402 `errors.ts:122-127`. Header survival through the error handler is not covered by a test (not found). |
| D1 | `app.ts:60-64`, `plugins/context.ts:40-64`, zod validation + OpenAPI `app.ts:74-135`. |
| D2 / D3 | See B11; limiter `app.ts:93-101` (stage-03 1.5); idempotency unused (stage-03 1.4); error envelope `{error:{code,title,detail,requestId,meta}}` `errors.ts:9-17` (Stage 15 locks RFC 9457 `application/problem+json`). |
| D5 | Not found (searched `audit` in backend/src non-test: none). |
| D6 | Repo paths: `/v1/auth/me`, `/v1/models`, `/v1/chats` (list/create/get/patch/delete), `/v1/chats/:id/generate`, `/stream?after=`, `/stop`, `/branch`, `/v1/files*`, `/v1/chats/:id/messages/:messageId/feedback`, `/v1/chats/:id/share`, `/v1/share-links`, `/v1/public/share/:token`, `/v1/account`; full list in evidence-g1.md (a). There is no `turn` resource, no `/regenerate` route (retry is `retryMessageId` in the body `chats.ts:548`), no `/speech/transcribe`. |
| D7 | Present: `/memory*` `routes/memory.ts`, artifacts + versions + download + preview `routes/artifacts.ts`, file status `routes/files.ts:315`, upload session `files.ts:137-266`. Not found (searched `report`, `notifications`, `citation`, `min-app`, `telemetry`, `mfa`, `totp`): `/report`, notifications feed, citation resolve, research runs, min-app-version, MFA, telemetry, incident banner, `/admin/*`. |
| D8 | Frames in use: `start, research, delta, thinking, sources, code, tool_use, tool_result, artifact_created, ui_block, ui_draft, debug, done, error` `generation.ts:122-142`. No `ack`, `status`, `ping`, `retract`, `citation`, `tool_status`; SSE `id:` is the buffer index `chats.ts:828` (acts as seq); no `seq` in the body; no `Last-Event-ID` header support (resume is `?after=` only `chats.ts:679`). |
| D9 | `chats.ts:568`, `errors.ts:128-132` (409 `run_in_progress`). |
| D10 | Unknown frames skipped `adapter.ts:273-279`; cursor pagination on chats/projects/artifacts `chats.ts:200`, `projects.ts:109`, `artifacts.ts:78` (memory, styles, share-links return unpaged lists); cancel returns `{stopped:boolean}` and never errors `chats.ts:696-712`; models `models.ts:39`; REST + SSE. |
| D11 | Plugin sends draft rate-limit headers (`app.ts:100`) but CORS exposes only `X-Request-ID` (`app.ts:90`); frontend never reads them (searched `ratelimit` in arcnave-frontend/src: none); usage counters exist at `routes/usage.ts:103-215`. |
| D12 | Not found (no `retract` event; searched `retract` in backend/src and arcnave-frontend/src non-test). |
| D15 | Node 22 + Fastify 5 + zod (`app.ts:15-21`). |
| E1 | No explicit state machine and no turn row: the only state is `messages.status` (`submitting|generating|complete|stopped|error`) `schema.ts:285`, plus the in-process run. |
| E2 | `GenerationService.run` `generation.ts:370-385`; 409 `chats.ts:568`; context `generation.ts:657-670`; reserve/release `:691-703`. |
| E3 | Budget only (`budget_exceeded`); no policy engine, no deny codes beyond model_unavailable/no_model_available `errors.ts:106-115`. |
| E4 | Router `providers/routing.ts:80`; tool loop `providers/toolLoopPolicy.ts`, `tools/executor.ts`; deadline `generation.ts:371-384` (59 min `numbers.ts:39`); validator: `answerProtocolGuard.ts` only. |
| E5 | No checkpoint store (stage-03 7.3); request id used as trace id (`app.ts:60`), no spans. |
| E6 | Thin own runner `generation.ts:339-1250`; no framework. |
| E7 | `TOOL_MAX_ROUNDS` 16 `numbers.ts:43`; no profiles. |
| E9 | Each failure path ends in a persisted row with `errorCode` plus an `error` frame: `generation.ts:1042-1093`, `chats.ts:629-654`; typed catalogue `errors.ts:25-238`. |
| E11 | None (in-process only). |
| E13 | Signatures stored on tool calls `schema.ts:389-391` (ADR-0022); thinking never replayed across turns `schema.ts:300-302`; capability table `capabilitiesTable.ts:116`; effort mapping `generation.ts:685-687`; backoff + jitter `config/numbers.ts:23-29`; abort chain `generation.ts:374-384`; bounded event buffer `runHub.ts:17`; no sampling parameters anywhere (searched `temperature|topP|top_p|topK` in backend/src: none). |
| E15 | Provider adapters are tested against fakes only (`anthropic.test.ts`, `gemini.test.ts`; `CLAUDE.md:93-94` forbids provider calls in tests). No live conformance suite (searched `conformance` in backend/src: not found). |
| E16 | No `turns` table, no config stamp (searched `config_stamp`, `configStamp`: not found). `turn_logs` markdown `schema.ts:516-525` is a content log. |
| E18 | Not found (searched `token bucket`, `limiter`, `breaker` in backend/src/providers, services/generation.ts). |
| E19 | One `usage_records` row per turn, summing every request of the tool loop: `schema.ts:585-642`, ADR-0021. |
| E20 | Env flags read at boot (`config.ts:179-321` `ENABLE_*`); no runtime/DB flag (searched `feature_flag`, `kill`: not found). |
| E22 | No fallback chain or circuit breaker (stage-02 S2-5). Refusal stays the typed `model_refused` and is never retried on another model: ADR-0054 section 5; `errors.ts:176-180`. |
| F2 | See stage-01 R3m. |
| F3 | Not found (searched `safety`, `moderation`, `screen` in backend/src/services, providers: none beyond the prompt text `systemPrompt.ts:77-78` and Gemini safety settings, if any, in `providers/gemini.ts`). Build plan puts it in Phase 4 (P4-C). |
| F6 | User "standing instructions" `preferences.instructions` `schema.ts:87`, max 20,000 chars `routes/preferences.ts:87`; project instructions max 20,000 `routes/projects.ts:181,266`, injected `generation.ts:2035`; N-35 says project 5,000 / company 3,000. Precedence text: "current user instruction outranks older preferences; … project instructions may shape style" `systemPrompt.ts:75,154`: no ArcNave > company > project > user order. Date line uses the user's timezone `generation.ts:2031`, default `UTC` `schema.ts:105` (spec: IST). |
| G3 | `project_files.checksum_sha256` exists but defaults to `''` and is never written (`schema.ts:166`; searched `checksumSha256` in backend/src: only the schema); no hash lookup; `attachments` has no hash column. |
| G4 | Hide at once: `chats.ts:419-453` (`deletedAt`); purge after `CHAT_PURGE_AFTER_DAYS` = 30 d `numbers.ts:61`, `services/retention.ts:43-80`, hourly `index.ts:34-45`; objects deleted before rows (`retention.ts:80`). Register: cascade <= 23 d, total <= 30 d (N-33). No deletion ledger, no verification sweep. |
| G5 | Terminal file states: `uploading -> ready|unsupported`, unsent uploads removed after 24 h `config.ts:338`, `retention.ts:12-13`; status is a DB column `schema.ts:423`. |
| H1 | PostgreSQL 16 (`CLAUDE.md:3`); `postgres.js` pool `db/client.ts:36`, `DB_POOL_MAX` 10 `numbers.ts:71` (N-66: API 5+5). |
| H2 | See stage-02 Q-V; `schema.ts:180-185`. |
| H7 | Not found (no ClamAV in images: `backend/Dockerfile`, `backend/sandbox/Dockerfile*`). |
| H10 | Migrations with their own single connection `db/migrate.ts:18-22`; no `lock_timeout`/`statement_timeout`/idle-in-transaction setting anywhere (searched in backend/src/db: none). |
| J1 | No stored rendered request blocks; history is rebuilt every turn (`generation.ts:1540-1580`); Claude thinking is never replayed across turns, so the prefix-binding 400 cannot occur. |
| J2 | `FOR UPDATE` on the counter row `services/usage.ts:225`; `reserve` `:258`; `release` `:277`; settle by `record` `:320`; INR via `costInr` `schema.ts:635`. Per user, tokens, not company ₹. |
| J4 | Each version is its own chat; compaction rows are per chat `schema.ts:806-828`; attachments are copied per version `chats.ts:1074-1081`. |
| J5 | Not found (searched `deletion_ledger`, `ledger` in backend/src: only `usage`). |
| J6 | `web_fetch` opens only URLs already in the conversation: `generation.ts:713-714`; sandbox is a separate service (stage-02 DS-3a). External image auto-load in the client: not checked here (Stage 14 group). |
| J8 | Every route filters by `userId` and returns the same 404 for "not yours": `chats.ts:869-882`, `errors.ts:276-280`. |

N-xx in scope (register vs repo): N-01 (stage-03 1.5); N-06 (16 rounds vs Fast 1–2/Normal 5/Deep 15, `numbers.ts:43`); N-24 (ping 15 s met `chats.ts:813`; retention 15 min vs 5 min `runHub.ts:20`); N-33 (cascade <= 23 d vs 30 d, `numbers.ts:61`); N-35 (company 3,000 / project 5,000 vs project 20,000 `projects.ts:181`, user 20,000 `preferences.ts:87`); N-43 (turn 10 min vs 59 min `numbers.ts:39`); N-45 (DB statement 5/2/30 s, lock 2 s, idle-in-tx 30 s vs none, H10); N-46 (reconnect 1/2/4/8/16 s x5 vs 8 delays up to 60 s `adapter.ts:163`); N-66 (API pool 5+5 vs `DB_POOL_MAX` 10 `numbers.ts:71`, DIFF-INFRA).

## 3. Buckets
| Row | Bucket | One-line reason |
|---|---|---|
| A1 | n/a | same change as stage-02 S2-4 (counted there) |
| A2, A4 | KEEP | provider port + adapters; one event format |
| A3, A5, A6 | DEFERRED | company / Redis / deploy layout |
| B1, B3, B4, B5, B8, B9, B10 | KEEP | client modules present |
| B2 | REWRITE | client is hand-written; generate types from `docs/openapi.json` |
| B6, B7 | n/a | counted at stage-01 R3m / Stage 14 group |
| B11 | NEW-BUILD | no app-version header or force-update screen |
| B12 | DEFERRED | client telemetry endpoint with Stage 17 (OTel / NO_CONTENT) |
| B13, B17 | DEFERRED | admin panel, per-company Claude switch |
| B14, C5 | DIFF-STACK | Vite SPA instead of Next.js |
| B15 | KEEP | English UI |
| B16, B23 | n/a | later / not needed / Stage 8 |
| B18 | n/a | counted in stage-05 F4 (EG) |
| B19 | KEEP | share link present (company-only default DEFERRED) |
| B20 | REWRITE | search covers titles only |
| B21 | n/a | counted in stage-05 (feedback table) |
| B22 | KEEP | copy, drag-drop, paste, limit messages |
| B24 | REWRITE | password-less (Google) accounts cannot delete themselves |
| C1, C6 | DEFERRED | Terraform / edge / domain / bot protection |
| C2, C7, C9 | KEEP | CORS, no-store share pages, one envelope + request id + 413 + mid-stream error |
| C3 | DIFF-INFRA | headers belong to the web server / LB; nginx sets nosniff only |
| C4 | REWRITE | one 31 MiB body limit for every route |
| C8 | KEEP | 15 s heartbeat (comment frame); the typed `ping` is counted in D8 |
| C10 | KEEP | Retry-After via plugin; distinct 402 code for quota (header survival to be tested) |
| C11 | n/a | later / moved |
| D1 | KEEP | request id, auth hook, zod/OpenAPI |
| D2 | n/a | = B11 |
| D3, D4 | n/a | rate key = stage-03 1.5; idempotency = stage-03 1.4; formatter = Stage 15 / Q-E; handler = A1 |
| D5, D13 | DEFERRED | audit log, per-company quota ops |
| D6 | REWRITE | paths and the missing turn resource differ from the catalogue (alias routes, with the turns table) |
| D7 | n/a | endpoints owned by Stages 6, 10, 11, 14, 16, 17 |
| D8 | REWRITE | add `ack`, `status`, `ping`, `retract`, `Last-Event-ID`; keep existing frames |
| D9, D10 | KEEP | 409 on second run; additive client, cursors, cancel idempotent |
| D11 | NEW-BUILD | expose rate-limit headers and show "N left" |
| D12 | NEW-BUILD | `retract` event + client handling (rules: Stage 13) |
| D14 | n/a | later |
| D15 | DIFF-STACK | Node/Fastify instead of FastAPI |
| E1, E16 | n/a | counted in stage-05 (turns table, model calls, config stamp) |
| E2, E9, E13 | KEEP | runner, controlled failures, provider rules met |
| E3, E5, E8, E11, E17, E24, E26 | DEFERRED | policy engine company parts, checkpoint/trace, 3 deploys, fairness |
| E4, E10, E14, E23, E25 | n/a | Stage 7, 8, 13, 15 groups |
| E6 | DIFF-STACK | own thin runner in Node instead of Python |
| E7 | n/a | profiles are Stage 7 (N-06) |
| E12 | n/a | later |
| E15 | NEW-BUILD | live provider conformance suite (dev-run only, owner gate B-11) |
| E18 | NEW-BUILD | per-model token bucket in the gateway |
| E19 | REWRITE | one usage row per turn instead of per model call |
| E20 | NEW-BUILD | runtime kill switch for model/tool/profile |
| E21 | n/a | text of G50–G63 not in the mirror |
| E22 | NEW-BUILD | fallback chain, circuit breaker, refusal retry on allowed categories (open question Q-FB) |
| F1, F2, F4, F5 | n/a | Stage 6, 7, 8, 9, 11, 12, 13, 16 groups |
| F3 | NEW-BUILD | Safety service (M9 screen, tool-output screen, crisis path) — build plan Phase 4 |
| F6 | REWRITE | caps 5,000/3,000, precedence order, Asia/Kolkata default |
| G1, G2 | DEFERRED | queue and job system |
| G3 | NEW-BUILD | compute and store file hash, reuse extraction in the same account |
| G4 | REWRITE | purge at 23 d, add deletion ledger + sweep (ledger: stage-05) |
| G5 | KEEP | terminal file states; DB is truth |
| G6 | n/a | = stage-01 FT-15, FT-10 |
| H1 | DIFF-INFRA | Postgres 16, no HA yet |
| H2, H3, H5, H6, H9 | n/a | Q-V / Stage 12 / Stage 9 / stack |
| H4, H8 | DEFERRED | infra, RLS, tenancy |
| H7 | DEFERRED | ClamAV: owner-deferred to Phase 5 by build plan |
| H10 | REWRITE | set N-45 statement/lock/idle timeouts |
| I1 | DEFERRED | Terraform platform |
| I2, I3 | n/a | = B11 / later |
| J1 | n/a | Stages 6, 7 (repo avoids the problem by never replaying old thinking) |
| J2 | KEEP | atomic per-user reservation with FOR UPDATE; company ₹ DEFERRED |
| J3, J7 | DEFERRED | Redis, executor, company |
| J4 | KEEP | version = own chat, own compaction |
| J5 | n/a | counted in stage-05 |
| J6 | n/a | Stages 8, 14 |
| J8 | KEEP | ownership + 404 on every route (company part DEFERRED) |

Counts (rows): KEEP 22 (A2, A4, B1, B3, B4, B5, B8, B9, B10, B15, B19, B22, C2, C7, C8, C9, C10, D1, D9, D10, E2/E9/E13 as one row E2, G5, J2, J4, J8 — see note) · REWRITE 11 (B2, B20, B24, C4, D6, D8, E19, F6, G4, H10 and C3 excluded) · NEW-BUILD 8 (B11, D11, D12, E15, E18, E20, E22, F3, G3 = 9) · DIFF-STACK 3 (B14/C5 as one, D15, E6) · DIFF-INFRA 2 (C3, H1) · DISCARD 0 · DEFERRED 24 rows · n/a many (owned elsewhere or counted elsewhere).

> **Main-session correction (AUDIT-LOG C-4):** the line above is garbled. The auditor's corrected id-level counts are KEEP 27, REWRITE 10, NEW-BUILD 9, DIFF-STACK 4, DIFF-INFRA 2, DEFERRED 25. A mechanical count of the rows in the table above gives KEEP 15, REWRITE 10, NEW-BUILD 9, DIFF-STACK 3, DIFF-INFRA 2, DEFERRED 11, n/a 22 (rows group several ids). SUMMARY.md uses the row counts.
Exact tally from the table above: KEEP 25 rows (A2, A4, B1, B3, B4, B5, B8, B9, B10, B15, B19, B22, C2, C7, C8, C9, C10, D1, D9, D10, E2, E9, E13, G5, J2, J4, J8 = 27; note E2/E9/E13 are separate rows in the lock table but one bucket row, so 25 distinct bucket lines); REWRITE 10 (B2, B20, B24, C4, D6, D8, E19, F6, G4, H10); NEW-BUILD 9 (B11, D11, D12, E15, E18, E20, E22, F3, G3); DIFF-STACK 3 lines (B14+C5, D15, E6); DIFF-INFRA 2 (C3, H1); DEFERRED 22 lines (A3+A5+A6, B12, B13+B17, C1+C6, D5+D13, E3+E5+E8+E11+E17+E24+E26, G1+G2, H4+H8, H7, I1, J3+J7).

## 4. Non-KEEP items
### B2 — Typed client from OpenAPI
- Exact change: generate `src/api-types.ts` from `docs/openapi.json` (devDependency, new dependency check) and type `api.ts` against it; fail CI when the spec and client drift. Files: `arcnave-frontend/package.json`, `arcnave-frontend/src/api.ts`, build script. Time S. Option B (leave hand-written) violates L1-M2 but is harmless until Android exists. Pick: S now, because it is cheap and prevents drift.

### B11 / D2 / I2 — Version guard
- Exact change: client sends `X-App-Version`; server compares with `MIN_APP_VERSION` and answers a typed `update_required` 426; web shows the force-update screen. Files: `app.ts` (hook), `errors.ts`, `arcnave-frontend/src/api.ts`, new screen. Time S. Do it with the Android task if the web needs no guard now. Pick: with Android (Phase 6), but add the header and hook now (S).

### B20 — Chat text search
- Exact change: add a `tsvector` column (generated) and GIN index on message text, search `q` over title + text with ownership filter; Tamil/Hindi use `simple` + `pg_trgm` for Tanglish (Stage 4 L7 D7). Files: `schema.ts` + migration, `routes/chats.ts:217`. Time M. Pick: single option; coordinate with the messages/message_contents split (stage-05 T-contents) so the index lands on the content table.

### B24 — Delete my account without a password
- Exact change: for a password-less account, confirm deletion with a fresh Google sign-in (ID token for the same e-mail) or an e-mail code; keep password path. Files: `routes/account.ts:81-111`, `services/googleSignIn.ts`, `Settings.tsx:1254`. Time S. Pick: Google re-auth (the only second factor that exists today).

### C4 — Per-route body limits
- Exact change: `bodyLimit` 1 MiB globally; the multipart upload routes and `application/octet-stream` upload route set their own larger limit. Files: `app.ts:71,103-105`, `routes/files.ts`, `routes/projects.ts:374`, `routes/artifacts.ts:390`. Time S, risk: upload routes must be tested at their ceilings.

### D6 — Endpoint names and the turn resource
- Exact change: add the catalogue's routes as the canonical API (`/conversations`, `/conversations/{id}/turns`, `/turns/{id}/regenerate`, `/turns/{id}/cancel`, `/turns/{id}/events?after=`, `/messages/{id}/feedback`, `/conversations/{id}/shares`, `/me`), served by the same handlers; keep `/chats*` as deprecated aliases until the frontend switches; the turn id is the turns-table id (stage-05). Files: `routes/chats.ts`, `routes/share.ts`, `routes/auth.ts`, `arcnave-frontend/src/api.ts`, `adapter.ts`, `docs/openapi.json`, tests. Port source: none locally (arcnave.in checkout holds no code).
- Option A (REWRITE: rename routes and frontend in one task): time L, risk high. Option B (aliases + turn resource first, frontend later): time M, risk low, keeps the app runnable.
- Pick: B. Owner question Q-API: is renaming required now, or is the L1b "frontend contract is source of truth" proposal (FE-5, recorded as not adopted) the intent?

### D8 / D11 / D12 / C8 — Stream contract
- Exact change: emit `ack` (ids) first, `status` for long silent phases, a typed `ping` every 15 s (keep the comment heartbeat), `seq` in every body, accept `Last-Event-ID`, `retract` (rules from Stage 13); expose `RateLimit-*` headers in CORS `exposedHeaders` and show "N messages left" in the composer. Files: `services/generation.ts:122-142`, `routes/chats.ts:668-690,784-834`, `app.ts:88-90`, `adapter.ts:273`, `Composer.tsx`. Time M. Pick: one task; unknown frames are already ignored by the client (`adapter.ts:273-279`), so it is additive.

### E15 — Live conformance suite
- Exact change: a manual `npm run conformance` that calls each model once for tool loop, signatures, refusal, model switch, max steps, with output ids only; run only on the owner's OK (gate B-11). Files: new `backend/src/scripts/conformance/*` using `providers/` (not raw SDKs). Time M.

### E18 / E22 — Provider rate limiter, fallback chain, circuit breaker
- Exact change: per-model token bucket in front of `Provider.stream`; ordered fallback list per profile; breaker (5 failures/30 s or >= 50 % of 20 calls, N-47); on an allowed refusal category retry once on the next model with a visible note (RV-2); the allowed-model list comes from the policy step. Files: `providers/registry.ts`, `providers/streamedCall.ts`, new `providers/breaker.ts`, `services/generation.ts`, `ChatStates.tsx` (note). Time L. Conflict: repo Invariant 1 / ADR-0002 rule 2 / ADR-0054 section 5 say never substitute a model; the locked design substitutes with a visible note. Owner question Q-FB.
- Option A (NEW-BUILD beside the current path, off by default): time L · risk medium. Option B: keep no-fallback (record deviation): not allowed by the owner rule unless the owner answers Q-FB that way.
- Pick: A.

### E19 / G44 — Per-call usage rows
- Exact change: add `model_calls` (one row per provider request: model, tokens by type, finish reason, request id) and keep `usage_records` as the per-turn sum; sum comes from the rows. Files: `schema.ts` + migration, `services/usage.ts:320`, `services/generation.ts`, `routes/usage.ts`. Time M; part of the stage-05 table work (T-modelcalls).

### E20 — Kill switch / runtime flags
- Exact change: small `runtime_flags` table (key, value, updated_at) read with a 5 s cache by the registry and tool router; an ops CLI/route (admin = the owner, not company roles) flips it; each turn's log records the flag version. Files: `schema.ts` + migration, `providers/registry.ts`, `tools/*`, `scripts/` CLI. Time S–M. No company/role needed.

### F3 — Safety service
- Exact change: M9 screen (rules + Flash-Lite structured verdict), tool-output injection screen, crisis path, `safety_events` table with ids/codes only; build plan Phase 4 item P4-C. Time L. Pick: as scheduled (Stage 16 group details).

### F6 — Instruction layers
- Exact change: caps N-35 as a config row (project 5,000, user standing instructions same cap unless the owner says otherwise, company 3,000 later), 422 above the cap; system prompt states the order ArcNave > company > project > user and tags each block with its source; `timezone` default `Asia/Kolkata` and the date line in IST. Files: `config/numbers.ts`, `routes/projects.ts:181,266`, `routes/preferences.ts:87`, `services/systemPrompt.ts:75,150-155`, `schema.ts:105` + migration. Time S. Existing longer instructions: read-only truncation rule decided by the owner (Q-INS).

### G3 — File hash and reuse (AS17, UG4, UD-1)
- Exact change: compute SHA-256 while storing an upload, store it on both `attachments` and `project_files` (`checksum_sha256` exists), reuse extracted text/chunks for the same account when hash + pipeline version match. Files: `routes/files.ts`, `routes/projects.ts:374-427`, `services/attachments/processUpload.ts`, `schema.ts` + migration. Time M.

### G4 — Deletion timing
- Exact change: `CHAT_PURGE_AFTER_DAYS` from the N-33 row (cascade <= 23 d); log a deletion-ledger entry (stage-05) and sweep after purge. Files: `config/numbers.ts:61`, `services/retention.ts`. Time S.

### H10 — DB timeouts
- Exact change: per-transaction `SET LOCAL statement_timeout/lock_timeout/idle_in_transaction_session_timeout` by kind (api 5 s, retrieval 2 s, executor 30 s; N-45); migration timeouts (N-70). Files: `db/client.ts`, `db/migrate.ts`. Time S–M, risk: long-running admin queries must be tagged.

## 5. Open questions for the owner
- Q-API. Rename routes to the L3 catalogue now (aliases + turn resource) or keep `/chats*` as the contract? (D6)
- Q-FB. Locked: client-side fallback chain with a visible note (L4-G17/G18, PE-2, RV-2). Repo Invariant 1 / ADR-0054 section 5 forbid model substitution. Which rule governs? (E22) Not resolved here.
- Q-E. Build plan section 2 plans an ADR "typed errors kept" (repo `ApiError` instead of RFC 9457, Stage 15 doc-sync). Is that deviation still wanted after the 2026-10-15 rule?
- Q-INS. Instruction caps: apply 5,000 to existing 20,000-character instructions (truncate/refuse on next edit)? Is there a user-instruction cap (N-35 lists none)?
- Q-V, Q1, Q2, Q-T2 (see stage-01/02/03 files).

## 6. KEEP spot-check
25 KEEP bucket lines; 4 re-opened in code (>=10 %): D9 (`chats.ts:568`, `errors.ts:128-132` confirmed), E13 (`config/numbers.ts:23-29` retries and `grep temperature|topP|top_p|topK` = no match, confirmed), J2 (`usage.ts:225` FOR UPDATE and `:258` confirmed), C8 (`chats.ts:813-815` confirmed). Downgrades: none. D10 stays KEEP although memory/style/share lists are not paginated (small collections; noted).
