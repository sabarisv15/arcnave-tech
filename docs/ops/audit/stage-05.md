# Stage 05 — Data flow, data model, lifecycle: conformance audit
Sources read: docs/architecture/Stage-05-Data-Flow/05-data-flow.md, 05-1-data-model.md (with doc-syncs 2026-10-03 Stages 12, 13, 16, 20; 2026-10-05, 10-08, 10-09, 10-10, 10-12), 05-2-flows.md (F1–F8), 05-3-lifecycle.md (incl. B1 2026-10-08); not read: 05-db-provider-comparison.md (database vendor comparison behind DB-1); 00-numbers-register.md (N-24, N-33, N-34, N-46, N-73); build plan; ADR-0053…0057; arcnave.in ADR-0010, 0011; repo `backend/src/db/schema.ts` (all 28 tables), `backend/drizzle/*.sql`, `routes/chats.ts`, `routes/share.ts`, `routes/projects.ts`, `services/retention.ts`, `services/storage.ts`, `services/generation.ts`, frontend `workspace.tsx`, `App.tsx`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Stage 5 has no checkpoint file. Ids are taken from the data model (G-1…G-6, DM-1…DM-12, DB-1a/b/c, table names), data flow (DF-1…DF-7, DFR1…DFR6), flows (FG/GG/SG/EG/UG/CF/SHG/CSH/MG/CM/XG gaps and FD/GD/SD/ED/UD/SHD/MD/XD decisions), lifecycle (LD-1…LD-4, B1) and the doc-sync lines. Flow steps that are the same code as Stage 3 point to stage-03.md. Memory (F7, MG*, MD*, CM*) and the Stage 11 memory tables belong to the Stage 11 group. Company, tenancy, RLS, roles, Redis and Cloud Tasks items are listed in deferred-g1.md, not bucketed.

## 1. Locked decisions
| Row | Ids | Decision (one line) | Status |
|---|---|---|---|
| P0 | tooling | Alembic + SQLAlchemy migrations; schema `app`; roles `arcnave_app` | LOCKED; stack differs -> DIFF-STACK (Drizzle) |
| P1 | G-1, DS-RLS (2026-10-05 policy text, partition RLS), DB-7 | `company_id` on every tenant table + FORCE RLS, app role not owner, composite unique keys start with company_id | DEFERRED (company, RLS) |
| P2 | G-2, DF-1, 2026-10-08 timestamps exemption | PK = UUIDv7 generated in the app (no DB default); `created_at`, `updated_at` on entity tables; time-keyed tables carry their event time | LOCKED |
| P3 | G-3 | Content vs metadata split: content columns in content tables (`message_contents`, file text, memory text, provider blocks); metadata tables hold ids/codes only | LOCKED |
| P4 | G-4, DM-1 | Delete = `deleted_at` (hide now) -> cascade hard delete <= 23 d -> deletion ledger | LOCKED |
| P5 | G-5, R8 | Every table has a data-map entry: PII class, retention, deletion path | LOCKED |
| P6 | G-6 | No file bytes in DB rows; rebuild exact bytes from storage at replay | LOCKED |
| P7 | DB-1a/b/c | Cloud SQL Enterprise; no HA early, HA before first paying customer; PostgreSQL 18 | LOCKED; infra |
| P8 | DM-2 | Raw model request/response blocks stored without file bytes (`model_call_blocks`) | LOCKED (Stages 6, 7) |
| P9 | DM-3 | Parsed file text in GCS (Mumbai); chunks in DB | LOCKED |
| P10 | DM-4 | Idempotency keys in DB, not Redis | LOCKED (= stage-03 1.4) |
| P11 | DM-5, LD-4, R7, XG5 | Deletion ledger in a separate store not restored with the main DB; kept 1 year; re-applied after any restore | LOCKED |
| P12 | DM-6 | Chat search: FTS + pg_trgm on `message_contents`, filtered by company + user | LOCKED (= stage-04 B20) |
| P13 | DM-7 (+ doc-sync 2026-10-09) | Own auth in Postgres; revised: no passwords, Google + e-mail code/link, invite-only, `email_codes`, `auth_lookup`, `auth_throttle` | LOCKED; conflicts with build plan/ADR-0056 -> Q1 (stage-01.md) |
| P14 | DM-8 | Projects = MVP: `projects`, `project_files`, `project_instructions` (+ `project_members` owner/edit/view) | LOCKED (members DEFERRED) |
| P15 | DM-9, DM-10, DM-12, company_settings, company_plan, usage_counter | Roles owner/admin/user; retention days; admin export; company plan counters | DEFERRED (company, roles) |
| P16 | DM-11 | Chat files deleted with the chat; no separate file library | LOCKED |
| TA | tables A | companies, company_settings, users, memberships, auth_identities, sessions, invitations, email_verifications | users + sessions LOCKED; rest DEFERRED / Q1 |
| TB1 | table conversations | `id, company_id, owner_user_id, title + title_version, active_leaf_message_id, memory_enabled (per chat, MEM-3), project_id, last_message_at, deleted_at` | LOCKED |
| TB2 | tables messages, message_contents, message_attachments | message metadata with `parent_id`, `role`, `status`, `turn_id`, `model_label`; text in `message_contents` | LOCKED (= P3) |
| TB3 | table turns (+ 2026-10-10/12 doc-sync) | state, kind send/edit/regenerate, profile, config stamp, checkpoint + schema_version, fencing token, lease, cancel flag, deadline, last_seq, reservation id, continuations/resumes; one running turn per conversation by partial unique index (FD-1) | LOCKED |
| TB4 | tables model_calls, tool_calls | per-call metadata (model, request id, finish reason, usage raw + normalised, cost); tool call with `args_hash`, `status`, `idempotency_key`, `result_ref` | LOCKED (Stages 7, 8) |
| TB5 | table model_call_blocks | rendered request blocks + response blocks (thinking, signatures, web-search encrypted) | LOCKED (= P8) |
| TB6 | tables citations, chat_citation (Stage 12) | `source_type`, `chunk_id`/`url`, `grounded_by (google|claude|own)`; cite_id -> file_version, chunk, locator, text_hash | LOCKED (Stage 12) |
| TB7 | table summaries | `covers_upto_message_id` (branch-keyed), text, version | LOCKED |
| TB8 | table feedback | message_id, user_id, rating, reason_code, comment (content) | LOCKED |
| TB9 | tables turn_stream_events (ADR-0011), retrieval_record, validation_result | Postgres stream buffer until Redis; per-turn retrieval record; validation results (ids + hashes) | LOCKED (stream store DEFERRED; others Stages 12, 13) |
| TC1 | tables files, file_versions, file_derivatives | `sha256, mime, size, status, scan_status, pipeline_version, error_code, index_status, current_version_id`; derivatives (parsed text, page images, transcript) in GCS | LOCKED |
| TC2 | table chunks | `company_id, file_id, page_index, page_label, text, lang, tsv, embedding halfvec, embedding_version, embed_model, searchable, t_start/t_end` | LOCKED (Stage 12; vector column Q-V) |
| TD | tables memory_doc, memory_line, memory_line_source, memory_tombstone, memory_settings | Stage 11 memory model | LOCKED (Stage 11) |
| TE | table shares | `token_hash`, snapshot (filtered), created_by, revoked_at | LOCKED |
| TF | tables price_table, budgets, budget_reservations, usage_ledger | effective-dated prices (N-36), reservations, ledger partitioned monthly (DFR5) with traffic tier + price version | LOCKED |
| TG1 | tables config_registry, feature_flags/kill_switch | versioned prompt/profile/tool/router config; runtime flags | LOCKED (Stage 6, stage-04 E20) |
| TG2 | tables jobs/outbox, deletion_ledger, audit_log/audit_event, safety_events, legal_hold | job semantics AS5–AS16; ledger; audit rows (ids + codes, daily hash chain); safety events | jobs/outbox, audit, legal_hold DEFERRED; ledger = P11; safety Stage 16 |
| TH | tables artifact, artifact_version, research_run, research_note, job_progress | artifacts with versions; research runs | LOCKED (Stages 6, 8, 10) |
| F1a | FG2, FG4, FG5, FG7, FD-1 | Second Send while running -> 409; budget finished -> distinct code; model not allowed -> Auto with note or clear error; project instructions + files added; reject, user stops first | LOCKED |
| F1b | FG1, FG3, FG6, FG8, FG9, FG10, FD-2, FD-3 | Same key different body 409; file not ready 409; size limit 413; sweeper re-enqueue; config stamp on turn row; offline send later | LOCKED (FG1/FG3/FG6/FD-2 = stage-03 1.4/1.3, stage-01 FT-9; FG8 DEFERRED) |
| F2a | GG2, GG6, GG7, GG8, GG9 | Stop before start skips + releases reservation; reservation released on every end; partial saved on Stop/failure; model switch noted; bill from last cumulative usage | LOCKED |
| F2b | GG1, GG3, GG5, GD-1 | Duplicate task no-op; success reply for handled ends; post-turn jobs in the final transaction; Cloud Tasks retry rule | DEFERRED (executor, outbox) |
| F2c | GG4, GG10, GD-2, GD-3 | Fast first event; provider block -> retract + status blocked; title job; summary trigger | LOCKED (= stage-03 1.8, stage-04 D12, stage-03 6.4, Stage 6) |
| F3a | SG1, SG4, SG5, SG6, SG7, SG10, SD-1, SD-2, SD-4, SD-6 | Resume from last seq; ownership on re-attach; two viewers; fetch final state on reopen; 15 s heartbeat; one fetch-based SSE client; thinking stream; no background service | LOCKED |
| F3b | SG3 | Reconnect storm: backoff with jitter | LOCKED |
| F3c | SG2, SG8, SG9, SG11, SG12, SG13, SD-3, SD-5 | DB snapshot when the buffer is gone; retract replay; API timeout >= 20 min + concurrency; ALB buffering test; buffer kept ~15 min; push later; Cloud Run settings | SG2/SG8 = stage-03 7.3 / stage-04 D12; rest DEFERRED |
| F4a | EG1, EG2, EG4, EG5, EG6, EG7, EG8, EG10, EG11, ED-1, ED-4 | Any earlier user message editable; Stop first; branch-only context; thinking stripped from edit point; regenerate with another model; old branches kept; abandoned-branch memories stay; each version counted; title unchanged | LOCKED |
| F4b | DF-2, G1/G2 data side, EG3, ED-2 | Message tree = `parent_id` + active leaf + recursive query; regenerate = sibling assistant message (version); chosen version saved on the server | LOCKED |
| F4c | EG9, EG12, ED-3 | Edit can change attachments (ready files only); branch in new chat later | LOCKED / later |
| F5a | UG13, UG15, UD-3, UD-4 | Generated storage names; resumable session with max size + re-check on complete | LOCKED |
| F5b | UG1–UG12, UG14, UG16, CF1–CF7, UD-1, UD-2 | Allowlist, size limits, quota, dedupe, ZIP, encrypted refusal, HEIC, infected-file handling, sweeper, step status, embedding rate cap, project vs chat files, delete during processing, provider-ready copies, Claude file rules | LOCKED (stage-01 FT-1…FT-15; stage-04 G3; ClamAV UG8 DEFERRED; Stage 9) |
| F6a | SHG4, SHG5, SHG6, SHG8, SHG9, SHG10, SHG11, CSH1, CSH2, SHD-2, SHD-4 | Files by name only; web citations kept; revoke instant; link dead on delete; only the owner shares; owner lists/deletes links; share page rate limit; thinking never shown; warning before sharing | LOCKED |
| F6b | SHG1, SHG2, SHG3, G-H (Stage 16) | Snapshot taken at share time; only the token hash stored; thinking, Google-grounded answers and internal data stripped; artifact in snapshot = name + type only | LOCKED |
| F6c | SHG7, SHD-1, RV-3, SHG12, SHG13, SHD-3 | Admin turns public links off; default share = company-only; update snapshot/analytics later | SHG7/SHD-1/RV-3 DEFERRED; rest later |
| F7 | MG1–MG11, MD-1–MD-4, CM1–CM3 | Memory flow | LOCKED (Stage 11; in-turn writes) |
| F8a | XG1, XG2, XG3, XG14, XD-1 | Hidden at once everywhere; running turn stopped; shared file kept by reference count; no trash | LOCKED |
| F8b | XG15, XD-2 | Project delete deletes its files, instructions and the chats inside (warning shows the count) | LOCKED |
| F8c | XG4, XG6, XG7, XG8, XG9, XG10, XG11, XG12, XG13, XD-3, XD-4, F8-CX1–CX3 | GCS soft delete + backups inside 30 d; provider copies disclosed; logs ids only; billing records kept; admin-run user delete; offboarding; auto-retention; legal-hold switch; audit completion record; stateless providers | DEFERRED (infra, company, lawyer, NO_CONTENT) |
| LC | LD-1, LD-2, LD-3, B1, data-lifecycle table | Jobs 30 d; audit >= 1 year; safety content 30 d; offboarding keeps `audit_event`; sessions short expiry; unfinished uploads ~24 h | jobs/audit/safety/offboarding DEFERRED; sessions + uploads LOCKED |
| DFR | DFR1, DFR2, DFR3, DFR4, DFR5, DFR6, DF-3…DF-7 | Stateless provider calls; usage normalizer rules; no PII in URL query strings; Redis stream cap + DB fallback; monthly partitions for ledger/audit/safety; signed PUT with type + size range; upload trigger by client "complete"; stream buffer store | DFR1, DFR2 LOCKED; DFR3 LOCKED; DFR4, DF-7 DEFERRED; DFR5 LOCKED; DFR6 = FT-12; DF-4 LOCKED |

## 2. Repo today
Repo tables (28) in `backend/src/db/schema.ts`: users :39, sessions :58, preferences :78, projects :128, project_files :151, file_chunks :186, saved_sources :209, chats :232, messages :271, message_sources :327, research_events :348, tool_calls :372, attachments :401, sandbox_workspaces :442, share_links :468, account_exports :497, turn_logs :516, artifacts :529, artifact_versions :552, usage_records :592, usage_counters :650, idempotency_keys :667, sandbox_claims :693, goals :704, goal_events :735, memory_items :763, conversation_compactions :806, styles :832. Migrations 0000–0027 in `backend/drizzle` (list in evidence-g1.md (b)); no `meta/0006_snapshot.json` (journal gap, evidence only).

| Row | Evidence (file:line) or "not found (searched …)" |
|---|---|
| P0 | Drizzle (`schema.ts:11-26`), SQL migrations `backend/drizzle/*.sql`, single `public` schema, one DB role (no `arcnave_app`: searched `SET LOCAL ROLE`, `arcnave_app` in backend/src: none). |
| P1 | No `company_id` column on any of the 28 tables (read all of `schema.ts`). Owner key is `user_id` on every table. |
| P2 | `defaultRandom()` (random UUIDv4, generated by the database): `schema.ts:29`. No UUIDv7 helper (searched `uuidv7`, `uuid7`: none). `created_at` on most tables, `updated_at` only on users, projects, chats, artifacts, usage_counters, styles, preferences, goals, memory_items (`schema.ts:30-35`). |
| P3 | `messages.text`, `thinking`, `segments` live in the same row as status, model, finish reason: `schema.ts:271-308`. Message text is read in about 13 files / 49 query sites (searched `.from(messages)`, `insert(messages)`: 49 hits, 13 files incl. scripts; app code in `chats.ts`, `generation.ts`, `share.ts`, `usage.ts`, `accountExport.ts`, `autoCompact.ts`, `chatSearch.ts`). |
| P4 | `chats.deleted_at` and `projects.deleted_at` `schema.ts:255,143`; purge after 30 d `numbers.ts:61`, `retention.ts:56-80`. Other tables hard-delete by cascade. |
| P5 | Not found (searched `data map`, `data-map`, `PII class` in docs/ and backend/src). Export lists tables `services/accountExport.ts` and ADR-0040 `docs/decisions/0040-data-export-and-account-deletion.md`. |
| P6 | No bytes in rows: tool results stored without image bytes `generation.ts:2103` (`withoutImageBytes`); files keyed by `storage_key` `schema.ts:421`. Extracted text is a DB column (see P9). |
| P7 | PostgreSQL 16 (`CLAUDE.md:3`), `compose.yaml`; HA/Enterprise is deployment. |
| P8 / TB5 | Not found (searched `model_call_blocks`, `rendered_request`, `response_blocks`). Tool calls keep `thought_signature` `schema.ts:389-391`; old thinking is never sent back `schema.ts:300-302`. |
| P9 | Whole extracted text in `attachments.extracted_text` `schema.ts:425`; project file chunks in `file_chunks.text` `schema.ts:197`; no parsed-text object in GCS (searched `parsed_text`, `derivative`: none). |
| P10 | Table + helpers exist, nothing calls them (stage-03 0.5/1.4); key stored in clear `schema.ts:674`, no `expires_at`, no 24 h cleanup (searched `idempotency` in retention.ts, index.ts: none). |
| P11 | Not found (searched `deletion_ledger`, `ledger` in backend/src non-test: only `usage_records`). |
| P14 | `projects` with `instructions text` `schema.ts:128-149`, `project_files` `:151-178`, single owner (`user_id`); no `project_members`. Project instructions max 20,000 chars `routes/projects.ts:181,266` (register N-35: 5,000). |
| P16 | Chat purge removes the bytes of files uploaded into it `retention.ts:64-95`; no file library page (`App.tsx:334-340` routes). |
| TA | `users(id,email,password_hash,name,is_active,...)` `schema.ts:39-52`: no status enum, no `email_norm_hash`/`email_status`. `sessions(token_hash, expires_at, last_seen_at, user_agent)` `:58-76`. `invitations`, `memberships`, `email_codes`, `mfa_*`, `refresh families`, `auth_lookup`, `auth_throttle`: not found (searched names in schema.ts). Expired sessions swept hourly `index.ts:21-28`. |
| TB1 | `chats(id,user_id,project_id,title,pinned,version,parent_chat_id,root_chat_id,fork_seq,created_at,updated_at,deleted_at)` `schema.ts:232-262`. Missing: `title_version` (generic `version` only), `active_leaf_message_id`, per-chat `memory_enabled` (searched `memory_enabled`: only on preferences `schema.ts:95`), `last_message_at`. Message list is not paged: `chats.ts:900-910` (register N-73: 50 per page); chat list page 30 matches `helpers.ts:21`. |
| TB2 | `messages` has `seq` (monotonic int) not `parent_id`; `status` text (`submitting|generating|complete|stopped|error`), no `turn_id`. Files as `attachments(user_id, message_id nullable, project_file_id, ...)` `schema.ts:401-435`. |
| TB3 | Not found (searched `turns`, `fencing`, `lease`, `config_stamp` in schema.ts and backend/src). One running turn per chat is only the in-memory map `chats.ts:568`; the `goals` table has a partial unique index as precedent `schema.ts:725-728`, messages have none. |
| TB4 | `tool_calls(message_id, ordinal, tool_call_id, name, input jsonb, content jsonb, ok, thought_signature, result_cleared)` `schema.ts:372-398`: no `model_call_id`, `args_hash`, `status`, `idempotency_key`. `model_calls`: not found; per-turn `usage_records(... input/output/total/cache tokens, tokens_exact, context_tokens, status, cost_usd, cost_inr)` `:592-642`. |
| TB6 | `message_sources(message_id, ordinal, title, url, url_resolved, domain, source_type, snippet, passage)` `schema.ts:327-345`: no `grounded_by`, `chunk_id`, `file_version_id`, `cite_id`. `chat_citation`: not found. |
| TB7 | `conversation_compactions(chat_id, through_message_id, through_seq, summary jsonb, token_count_before/after, provider, model)` `schema.ts:806-828`, unique per `(chat_id, through_seq)`; branch isolation because each version is its own chat. |
| TB8 | Only `messages.feedback` ('up'|'down') `schema.ts:290`, route `chats.ts:717-739`: no reason, comment, user id. |
| TB9 | `turn_stream_events`: not found (in-memory `RunHub` `services/runHub.ts`); `retrieval_record`, `validation_result`: not found. |
| TC1 | `attachments` has no `sha256`, `scan_status`, `pipeline_version`; `error` text not code; `project_files.checksum_sha256` exists but is never written `schema.ts:166`; `file_versions`, `file_derivatives`: not found. Storage key `shard/year/month/<ownerId>/<random>` `services/storage.ts:22-28` (spec: `tenant/<company>/...`, generated, no PII: user id is a UUID). |
| TC2 | `file_chunks(project_file_id, project_id, ordinal, text, char_count, page)` `schema.ts:186-207`: no `lang`, `tsv`, `embedding`, `embedding_version`, `page_label`, `searchable`, `t_start/t_end`. Repo Invariant 4 forbids an embedding column (`CLAUDE.md:25-26`, `schema.ts:180-185`). |
| TE | `share_links(user_id, token, target_type, target_id, snapshot_seq, snapshot_at, revoked_at)` `schema.ts:468-491`: token stored in clear (unique index `uq_share_token` `:486`); no stored snapshot — the page reads live rows up to `snapshot_seq` `routes/share.ts:367-381`, so a later retry of a shared answer changes the shared page; thinking is never read `share.ts:7`; Google-grounded answers are not stripped (searched `grounded`, `searchEntryPoint`, `provider` in share.ts: none); artifact content is shared in full `share.ts:303-323,433-460`. |
| TF | Budgets are per-user token limits on `preferences` `schema.ts:99-104` and `usage_counters(period_kind, tokens_used, tokens_reserved)` `:650-664`; prices are code/config (`computeCostFor` `generation.ts:2204`, `config/numbers.ts:83` FX); no `price_table`, no `budget_reservations`, ledger not partitioned (searched `PARTITION`, `partition` in backend/drizzle: none), no traffic tier or price version column. |
| TG1 | Prompts in code `services/systemPrompt.ts`; flags are env `config.ts:179-321`; `config_registry`, `feature_flags`: not found. |
| TG2 | `jobs/outbox`, `deletion_ledger`, `audit_log`, `safety_events`, `legal_hold`: not found. `turn_logs(message_id, user_id, markdown)` holds content `schema.ts:516-525` (ADR-0050). |
| TH | `artifacts` + `artifact_versions` `schema.ts:529-581` (document/code/webpage/svg/slides; formats markdown/xlsx/docx/pptx); `research_run`, `research_note`, `job_progress`: not found (research = grounded search with `research_events` `schema.ts:348-362`). |
| F1a | 409 `chats.ts:568`; 402 distinct `errors.ts:122-127`; model not usable -> typed `model_unavailable` `errors.ts:106-110`; project instructions + files `generation.ts:1954-2035`; Send/Edit disabled while running `App.tsx:958`, `Composer.tsx:808`. |
| F1b | See stage-03 (1.3, 1.4, 1.8); FG8: no queue; FG9: no turn row. |
| F2a | Abort already set -> stops at once `generation.ts:376`; `finally { releaseReservation }` `:1095-1097` and on error `:1069`; partial text saved on stop/error `:1056-1069,1169-1182`; Auto's resolved model on the row `generation.ts:2148-2152`, shown by `ModelLabel` `ChatStates.tsx:220`; usage recorded from the last usage seen `generation.ts:1070-1084`. |
| F3a | `Run.subscribe(after, …)` replay + live `runHub.ts:72-86`; ownership `chats.ts:684-686`; two listeners per run `runHub.ts:28-30`; reopen -> `attachRef` / polling `workspace.tsx:353-358,410-425`; heartbeat `chats.ts:813-815`; one fetch SSE client `adapter.ts:109-241`; `thinking` frames `generation.ts:126`. |
| F3b | Delays are fixed, no jitter: `adapter.ts:163`. |
| F3c | Buffer 50,000 events / 5 min `runHub.ts:17-20` (N-24 ~15 min); after instance loss `GET /stream` is 404 `no_active_run` `chats.ts:686` and the message text is whatever was last written (written only at the end, stage-03 7.3). |
| F4a | Edit on any user message `App.tsx:956-962`; disabled while running; version copy of the earlier messages only `chats.ts:496-499`; Claude thinking not replayed (stage-04 J1); retry uses the currently selected model `workspace.tsx:476-479`, `chats.ts:548`; old versions are kept as chats until deleted `chats.ts:419-453`; memories keep `source_chat_id set null` `schema.ts:778`; usage per generate; title copied `chats.ts:508`. |
| F4b | No `parent_id` tree. Edit = new chat in a family (`parent_chat_id`, `root_chat_id`, `fork_seq`; ADR-0038) `schema.ts:243-252`, version arrows on user prompts `App.tsx:963-983`. Regenerate resets the same assistant row (old answer lost): `chats.ts:1180-1215`. Switching version is client navigation only (no server write): `workspace.tsx:1017-1039`; the list shows the most recently updated version `chats.ts:218-225`. |
| F4c | Inline edit sends text only, so the files of the edited prompt are dropped: `App.tsx:935-939` (`send(text, m.mode, [], chatId)`), copy keeps messages with `seq < editSeq` only `chats.ts:498`. |
| F5a | `storage.ts:22-28,295-300`; `files.ts:176,251-260`. |
| F6a | Attachments not exposed on the share page (`share.ts:367-431` selects no attachments); web sources kept `share.ts:383-396`; `Cache-Control: no-store`, `noindex` `share.ts:103`; chat delete -> `isNull(chats.deletedAt)` `share.ts:363`; owner list/delete `share.ts:187-247`; rate limit `share.ts:92-97`; modal text `App.tsx:1416-1421`. |
| F8a | `loadChat` and lists filter `deleted_at` `chats.ts:869-882,215`; running chat aborted on delete `chats.ts:446`; bytes kept while another chat still names them `retention.ts:73-78`; no trash (delete final). |
| F8b | `DELETE /projects/:id` keeps the chats and sets `project_id` null: `routes/projects.ts:345-369` (ADR text "Chats in the project are kept"). |
| LC | Sessions short expiry (`SESSION_TTL_HOURS` 14 d `numbers.ts:73`, hourly purge `index.ts:21-28`); unfinished uploads 24 h `config.ts:338`, `retention.ts:12-13`. |
| DFR | Stateless provider calls (no provider-side stores: searched `interactions`, `previous_response`, `store:` in providers/: none); usage normalizer incl. cache read/write `providers/anthropic.ts`, ADR-0021, `usage_records` `schema.ts:608-618`; share token in the path `share.ts:84`; but chat search sends the query in the URL (`GET /chats?q=` `chats.ts:202`, `GET /projects/:id/search?q=` `projects.ts:543`). |

N-xx in scope: N-24 (buffer 5 min vs ~15 min); N-33 (purge 30 d vs cascade <= 23 d); N-34 (idempotency keys 24 h: no cleanup); N-46 (reconnect jitter); N-73 (list 30 matches, message page 50 missing, sibling ids <= 20 n/a, depth cap n/a, title <= 200: `chats.ts` rename limit `maxLength 180` in the UI `App.tsx:405`, schema 200 `schema.ts:240`).

Missing tables and columns that later stages need (single list, for the build plan): `turns` (+ partial unique index), `model_calls`, `model_call_blocks` (decision with Stage 7), `message_contents`, `feedback` (reason, comment), `file_versions`, `file_derivatives`, `price_table`, `budget_reservations`, `deletion_ledger`, `config_registry`/`runtime_flags`, `jobs/outbox`, `turn_stream_events`, `chat_citation`, `retrieval_record`, `validation_result`, `research_run/note`, `safety_events`, `audit_event`; columns: `chats.title_version / active_leaf / memory_enabled / last_message_at`, `messages.parent_id / turn_id`, `message_sources.grounded_by / chunk_id / cite_id`, `attachments.sha256 / scan_status / pipeline_version / error_code`, `file_chunks.lang / tsv / page_label / searchable / embedding*`, `share_links.token_hash + stored snapshot`, `tool_calls.model_call_id / args_hash / status / idempotency_key`, `usage_records.price_version / traffic_tier`; all `company_id` columns are DEFERRED.

## 3. Buckets
| Row | Bucket | One-line reason |
|---|---|---|
| P0 | DIFF-STACK | Drizzle / Postgres instead of SQLAlchemy / Alembic |
| P1, P14 (members), P15, TA (company, role, auth tables), TB9 (turn_stream_events), TG2 (jobs, audit, legal_hold), F1b FG8, F2b, F3c (SG9, SG11, SG12, SG13, SD-3, SD-5), F6c, F8c, LC (jobs, audit, safety, B1), DFR (DFR4, DF-7) | DEFERRED | company / RLS / roles / Redis / Cloud Tasks / lifecycle infra |
| P2 | REWRITE | UUIDv7 generated in the app; add `updated_at` where missing |
| P3, TB2 | REWRITE | split message text and provider fields from message metadata (counted once) |
| P4 | n/a | purge timing counted at stage-04 G4 |
| P5 | NEW-BUILD | data map + sweep test |
| P6 | KEEP | no bytes in rows |
| P7 | DIFF-INFRA | Postgres 16, no HA yet |
| P8, TB5 | n/a | decided with the Stage 7 group (repo never replays old thinking) |
| P9 | REWRITE | parsed text to GCS, keep chunks in DB (counted with TC1) |
| P10 | n/a | = stage-03 1.4 |
| P11 | NEW-BUILD | deletion ledger outside the restorable DB |
| P12 | n/a | = stage-04 B20 |
| P13 | n/a | owner question Q1 |
| P14 (projects) | KEEP | projects, project files, instructions present (cap differs: stage-04 F6) |
| P16 | KEEP | chat files purged with the chat |
| TA (users, sessions) | KEEP | shape adequate; Q1 may change it |
| TB1 | REWRITE | add `title_version`, `memory_enabled`, `last_message_at`; message paging 50 |
| TB3 | NEW-BUILD | turns table + one-running-turn partial unique index |
| TB4 | n/a | = stage-04 E19 (model_calls); tool_calls columns = Stage 8 |
| TB6 | REWRITE | add `grounded_by` (needed by SL-1) and cite fields (Stage 12) |
| TB7 | KEEP | compaction rows per chat/version |
| TB8 | NEW-BUILD | feedback table with reason + comment |
| TB9 (others) | n/a | Stage 12, 13 |
| TC1, TC2 | REWRITE | file columns (hash, scan, pipeline version, error code), `file_versions`; chunk fields are Stage 12 |
| TD, TH | n/a | Stage 11, 8, 10 groups |
| TE | n/a | counted at F6b |
| TF | REWRITE | effective-dated `price_table`, reservation rows, monthly-partitioned ledger with price version / traffic tier |
| TG1 | n/a | Stage 6 / stage-04 E20 |
| F1a, F2a, F3a, F4a, F5a, F6a, F8a | KEEP | flows met (7 lines) |
| F1b, F2c, F5b, F7 | n/a | stage-03, stage-01, stage-04, Stage 11 |
| F3b | REWRITE | add jitter to the reconnect delays (N-46) |
| F4b | REWRITE | regenerate must keep the old answer as a version; chosen version stored on the server |
| F4c | REWRITE | an edited prompt must be able to keep or change its files |
| F6b | REWRITE | store a token hash and a filtered snapshot; strip Google-grounded answers; artifact = name + type (owner question Q-Share) |
| F8b | REWRITE | project delete must delete its chats too, with a count warning |
| DFR (DFR1, DFR2, DFR3, DFR5, DFR6, DF-3, DF-4) | KEEP / n/a | DFR1, DFR2 KEEP; DFR3 REWRITE (query-string search: below); DFR5 counted in TF; DFR6 = FT-12 |

Counts (lines): KEEP 12 (P6, P14-projects, P16, TA users+sessions, TB7, F1a, F2a, F3a, F4a, F5a, F6a, F8a) plus DFR1/DFR2 as one line = 13 · REWRITE 11 (P2, P3+TB2, P9/TC1/TC2 as one, TB1, TB6, TF, F3b, F4b, F4c, F6b, F8b) · NEW-BUILD 4 (P5, P11, TB3, TB8) · DIFF-STACK 1 (P0) · DIFF-INFRA 1 (P7) · DISCARD 0 · DEFERRED 12 lines. DFR3 (search text in URL query strings) is recorded as a REWRITE-S note under section 4 and in deferred-g1.md because its only consumer is NO_CONTENT enforcement.

## 4. Non-KEEP items
### P2 — UUIDv7 primary keys
- Exact change: add `uuidv7()` (RFC 9562, 48-bit ms timestamp + random) in `backend/src/db/ids.ts`; use `.$defaultFn(uuidv7)` in `id()` `schema.ts:29` for new rows; no data migration (old rows keep v4); drop `defaultRandom()` only after all insert sites go through Drizzle defaults (a few raw inserts exist: check `retention.ts`, scripts). Add `updated_at` to tables that are edited (messages, attachments, project_files, share_links). Files: `schema.ts`, new `ids.ts`, migration. No new dependency (the generator is 15 lines; a `uuid@10+` dependency would need the package register check).
- Option A (REWRITE: helper + defaults): time S · risk low · breaks: tests that assert id shape (none seen).
- Option B (leave v4, record deviation): not allowed unless the owner says the index-locality reason is not needed.
- Pick: A.

### P3 / TB2 — Content vs metadata split
- Exact change: new `message_contents(message_id pk, text, thinking, segments, search tsv)`; `messages` keeps ids/status/model/finish/usage refs/created_at; move reads in the 8 app files; export, share and compaction read via join. Done together with `turns` (TB3) and the `parent_id`/version decision (F4b) so `messages` is migrated once. Files: `schema.ts`, migration (backfill then drop columns in a later migration, expand/contract), `routes/chats.ts`, `services/generation.ts`, `routes/share.ts`, `routes/usage.ts`, `services/accountExport.ts`, `services/compaction/autoCompact.ts`, `services/memory/chatSearch.ts`, tests. Time L, risk medium-high (core table).
- Option A (REWRITE with expand/contract: write both, read new, drop old): keeps the app runnable at every commit. Option B (NEW-BUILD a parallel `messages_v2`): time XL, rejected.
- Pick: A, sequenced before Phase 5 tenancy so the company_id retrofit touches the new shape once. Raise-now answer in deferred-g1.md.

### TB3 — Turns table, one-running-turn guard, config stamp
- Exact change: `turns(id, chat_id, user_message_id, assistant_message_id, kind, state, profile, config_stamp jsonb, finish_code, deadline_at, lease_until, cancel_requested, last_seq, reservation_ref, created_at, ended_at)` with `unique (chat_id) where state in ('queued','running')`; created inside `appendTurn`; the run loop updates state; Stop sets `cancel_requested` as well as the in-process abort (multi-instance later). The Redis/Cloud Tasks columns (fencing, checkpoint, resumes) are added when the executor lands (DEFERRED). Files: `schema.ts`, migration, `routes/chats.ts:568,1085-1156`, `services/generation.ts`. Port source: none locally; shape from 05-1 doc-syncs 2026-10-10/12. Time M, risk medium.
- Option A (NEW-BUILD beside `messages.status`, switch reads, then drop the status meaning): pick. Option B (put turn fields on `messages`): rejected, recreates the mixed table of P3.
- Pick: A.

### TB1 — Conversation columns and paging
- Exact change: add `title_version`, `memory_enabled` (null = follow user setting), `last_message_at`; page `GET /chats/:id` messages 50 per page with a cursor (N-73) or keep one read and set the cap; titles <= 200. Files: `schema.ts`, `routes/chats.ts:286-360,900-910`, `arcnave-frontend/src/workspace.tsx`. Time M (paging) / S (columns).

### TB6 — Citations
- Exact change: add `grounded_by` (`google|claude|own`) on `message_sources`; later `chunk_id`/`file_version_id`/`cite_id` (Stage 12). Fill `grounded_by` in `finalise` `generation.ts:2158-2175`. Time S.

### TB8 — Feedback table
- Exact change: `feedback(id, message_id, user_id, rating, reason_code, comment, created_at)`; keep `messages.feedback` until migrated; route accepts reason. Files: `schema.ts`, `routes/chats.ts:717-739`, `App.tsx` thumbs menu. Time S.

### TC1 / P9 — File metadata and parsed-text location
- Exact change: add `sha256`, `scan_status`, `pipeline_version`, `error_code` to `attachments` and `project_files`; compute the hash in `processUpload`; write parsed text to a `derivatives/` object and keep chunks only in `file_chunks`; add `file_versions` when re-index/replace exists. Files: `schema.ts`, `services/attachments/processUpload.ts`, `routes/files.ts`, `routes/projects.ts:374-427`, `services/retrieval.ts`. Time L, risk medium (every read of `extracted_text`). Pick: columns + hash now (S–M, also feeds stage-04 G3); text-to-GCS with the Phase 2 retrieval work.

### TF — Price table, reservations, partitioned ledger
- Exact change: `price_table(model, token_type, tier, price, currency, effective_from, effective_to)` read by `computeCostFor`; ledger = `usage_records` extended (`price_version`, `traffic_tier`) and created as a monthly RANGE-partitioned table (primary key includes `started_at`) via raw SQL migration (Drizzle has no partition DSL); reservation rows replace `tokens_reserved` bookkeeping. Files: `schema.ts`, migration, `services/usage.ts`, `generation.ts:2204`. Time L. Pick: price table + `price_version` now (S–M); partitioning with the ledger rebuild (stage-04 E19).

### P5 — Data map
- Exact change: `docs/ops/data-map.md` listing every table (28 + new), PII class, retention, deletion path, and a test that fails when a table in `schema.ts` has no entry. Time S. Port source: none.

### P11 — Deletion ledger
- Exact change: append-only record of each deletion request (subject type + id, requested_at, completed_at) in a store that a database restore does not roll back (a small GCS object log, per DM-5), 1-year lifecycle; written by `DELETE /chats/:id`, project/file/account delete; replayed by a runbook after a restore; verification sweep after `sweepRetention`. Files: new `services/deletionLedger.ts`, `routes/chats.ts:419`, `routes/account.ts:81`, `services/retention.ts`. Time M. GCS object log needs the bucket (infra; interim: a table, moved to GCS with the infra task).

### F3b — Reconnect jitter
- Exact change: add full jitter to `RECONNECT_DELAYS_MS` use and cap attempts to the register (1/2/4/8/16 s x5, then manual Retry) or record the longer ladder as the owner's choice (N-46). Files: `adapter.ts:163,191-204`. Time S.

### F4b — Regenerate versions and stored choice
- Exact change: regenerate no longer clears the answer: create a version row (new family chat at the same prompt, `editSeq` = the prompt's seq, same text) so the existing version arrows (prompt-level, ADR-0038) cover regenerated answers; the chosen version is stored (`chats.active_in_family` flag or a `family_state` row) when the user switches or sends. Files: `chats.ts:457-527,1180-1215`, `workspace.tsx:888,1017-1039`, `App.tsx:963-983`, `chatVersions.ts`. Port source: none.
- Option A (parent_id message tree per DF-2, migrate families): time XL, risk high. Option B (regenerate = family version + stored active choice): time M, risk low, reuses ADR-0038.
- Pick: B (outcome EG1–EG11, ED-1, ED-2 met; the table shape differs and is recorded as a deliberate how-difference).

### F4c — Edited prompt keeps its files
- Exact change: pass the original attachment ids with the edit (`InlineEdit` shows the chips, removable) and copy the attachment rows into the new version. Files: `ChatStates.tsx:240`, `workspace.tsx` send, `chats.ts:496-526`. Time S–M.

### F6b — Share snapshot, token hash, grounded answers, artifacts
- Exact change: store a filtered snapshot on create/update (messages up to the shared point: text, web sources, UI blocks; no thinking, no Google-grounded answers (`provider = google` with search entry point), no tool raw data), store only SHA-256 of the token (the link is shown once; list shows the last 4 characters and revoke), serve from the snapshot; artifact = name + type only (G-H) unless the owner keeps artifact sharing as a feature (Q-Share). Files: `schema.ts:468-491`, `routes/share.ts:83-460`, `ShareLink.tsx:15`, `Settings.tsx:1463`. Time M, risk medium (live share links change shape).
- Option A (REWRITE in place with a migration that snapshots existing links). Option B (NEW-BUILD v2 links, retire v1). Pick: A (no real users).

### F8b — Project delete
- Exact change: soft-delete the project's chats too (cascade job later) and its files; the confirm dialog shows the chat count. Files: `routes/projects.ts:345-369`, `Pages.tsx` delete dialog, `retention.ts`. Time S. Conflicts with the repo's documented "chats are kept" choice (route description); locked XD-2 wins under the owner rule.

### DFR3 — Search text in the URL
- `GET /chats?q=` and `/projects/:id/search?q=` put user text into the request line (Cloud Run logs path + query). Fix when NO_CONTENT is enforced (deferred): change to POST bodies or accept short query strings. Listed in deferred-g1.md.

## 5. Open questions for the owner
- Q-Share. Artifact sharing by link is a repo feature (ADR-0039); Stage 16 G-H says an artifact in a share snapshot shows name + type only. Keep full artifact content in public links?
- Q-Repo-only. Tables with no Stage 5 entry: `goals`, `goal_events` (multi-step goals), `saved_sources`, `research_events`, `styles`, `account_exports`, `sandbox_workspaces`, `sandbox_claims`, `turn_logs`. Keep, fold into a stage (Stage 10 research, Stage 8 sandbox), or discard? (No action taken.)
- Q-Blocks. `model_call_blocks`: needed now or only when server-tool blocks must be replayed across turns (repo replays text + tool calls only)? Decided with the Stage 7 audit.
- Q1 (stage-01.md): passwordless/invite-only vs password + Google; decides `users.password_hash`, `email_codes`, `auth_lookup`.
- Q-V (stage-02.md): vector column vs Invariant 4.

## 6. KEEP spot-check
13 KEEP lines; 3 re-opened in code (>=10 %): F3a SG4 (`chats.ts:684-686` run owner check confirmed), F8a XG3 (`retention.ts:73-78` shared-bytes guard confirmed), TB7 (`schema.ts:806-828` unique `(chat_id, through_seq)` confirmed). Downgrades: none. F2a GG9 (`generation.ts:1070-1084`) re-read, confirmed.
