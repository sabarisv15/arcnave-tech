# tech-audit.A — evidence pack (names and shapes only)

Assembled by the main session from the auditors' part files (`_parts/evidence-*.md`, kept as the
raw outputs; this file copies them unchanged except one level of heading depth). Values of
secrets, identifiers and user content are never listed. Repo state: branch `audit/stage-1-21` at
`baca408` (= `origin/main`). Known limit: `.env.example` could not be read by any auditor (a read
permission rule on `.env*`), so the env-key list below is built from `config.ts` /
`config/numbers.ts` and the frontend `VITE_*` reads, not from the template.

| Brief item (Part 3) | Section below |
|---|---|
| Route list | G1 (a) HTTP routes |
| DB tables / columns / indexes, migration list | G1 (b) Database |
| Every env / config key with its default | G4 (d) Env / config keys |
| Tool registry (names, schemas, caps) | G2 (a) Tool registry |
| Prompt files and assembly order | G2 (b) Prompt files and assembly order |
| Provider capability matrix | D2 §1–§3 |
| ApiError codes | G4 (a) ApiError codes (42 codes; G1's "56" corrected, AUDIT-LOG C-3) |
| Skills list | G2 (c) Skills |
| Frontend routes / screens / components | G1 (c) Frontend |
| Test inventory by area with counts | D3 §1–§5 |
| Dependencies | G5 (a) Dependencies (incl. licence flags) |
| Dockerfile / Cloud Build / CI summary | G5 (b) |
| ADR index | G5 (c) (repo 0001–0057 + 0061; Python 0001–0014) |
| Usage / cost fields | G4 (b) Usage and cost fields |
| Log fields emitted today | G4 (c) Log fields (rows flagged C/I are also in FINDINGS.md as `log-content`) |


---

# G1 (Stages 1–5) — from `_parts/evidence-g1.md`

Paths relative to `D:\arcnave-tech`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Static reading; nothing was run. `.env.example` was not readable by the tool, so no env-file lines are cited (values come from `backend/src/config.ts` and `backend/src/config/numbers.ts`).

### (a) HTTP routes
Prefix `/v1` (`backend/src/config.ts:80` `API_PREFIX`, applied at `backend/src/app.ts:217`). Health routes sit outside the prefix (`app.ts:197`). Auth = the module adds `requireAuth` as an `onRequest` hook (`plugins/context.ts:62-64`), so a call without a valid signed session cookie gets `401 unauthorized`. Default rate limit: every route 120/min per IP-or-user key (`app.ts:93-101`, `config/numbers.ts:67`); overrides: auth-type routes 10/min (`config.ts:369`), generate 20/min (`chats.ts:556-561`), public share 60/min per IP (`share.ts:92-97`), health exempt.

| Method | Path (under `/v1` unless noted) | Auth? | File:line |
|---|---|---|---|
| GET | `/healthz` (root) | no | routes/health.ts:19 |
| GET | `/readyz` (root) | no | routes/health.ts:42 |
| GET | `/docs` (Swagger UI, root) | no | app.ts:135 |
| POST | `/auth/register` | no (rate 10/min; `REGISTRATION_ENABLED`) | routes/auth.ts:49 |
| POST | `/auth/login` | no (10/min) | routes/auth.ts:73 |
| POST | `/auth/google` | no (10/min; needs `GOOGLE_OAUTH_CLIENT_ID`, else 404) | routes/auth.ts:96 |
| POST | `/auth/logout` | no (clears cookie) | routes/auth.ts:117 |
| GET | `/auth/me` | no (returns `{user:null}` when signed out) | routes/auth.ts:132 |
| POST | `/auth/password` | yes (route-level hook) | routes/auth.ts:144 |
| GET | `/models` | **no** (probe spends a provider call per alias) | routes/models.ts:39 |
| POST | `/models/refresh` | **no** | routes/models.ts:166 |
| GET | `/chats` (list, `q` title search, cursor) | yes | routes/chats.ts:194 |
| POST | `/chats` | yes | routes/chats.ts:255 |
| GET | `/chats/:id` | yes | routes/chats.ts:286 |
| PATCH | `/chats/:id` | yes | routes/chats.ts:361 |
| DELETE | `/chats/:id` | yes | routes/chats.ts:419 |
| POST | `/chats/:id/branch` (copy / new version) | yes | routes/chats.ts:457 |
| POST | `/chats/:id/generate` (SSE) | yes | routes/chats.ts:531 |
| GET | `/chats/:id/stream?after=` (SSE reattach) | yes | routes/chats.ts:668 |
| POST | `/chats/:id/stop` | yes | routes/chats.ts:696 |
| POST | `/chats/:id/messages/:messageId/feedback` | yes | routes/chats.ts:717 |
| GET | `/chats/:id/messages/:messageId/log` (turn log text) | yes | routes/chats.ts:743 |
| GET | `/projects` | yes | routes/projects.ts:103 |
| POST | `/projects` | yes | routes/projects.ts:172 |
| GET | `/projects/:id` | yes | routes/projects.ts:213 |
| PATCH | `/projects/:id` | yes | routes/projects.ts:256 |
| POST | `/projects/reorder` | yes | routes/projects.ts:299 |
| DELETE | `/projects/:id` | yes | routes/projects.ts:345 |
| POST | `/projects/:id/files` (multipart) | yes | routes/projects.ts:374 |
| GET | `/projects/:id/files` | yes | routes/projects.ts:429 |
| GET | `/projects/:id/files/:fileId/download` | yes | routes/projects.ts:453 |
| POST | `/projects/:id/files/:fileId/reindex` | yes | routes/projects.ts:484 |
| DELETE | `/projects/:id/files/:fileId` | yes | routes/projects.ts:512 |
| GET | `/projects/:id/search?q=` | yes | routes/projects.ts:543 |
| GET | `/projects/:id/sources` | yes | routes/projects.ts:586 |
| POST | `/projects/:id/sources` | yes | routes/projects.ts:608 |
| DELETE | `/projects/:id/sources/:sourceId` | yes | routes/projects.ts:654 |
| GET | `/artifacts` | yes | routes/artifacts.ts:72 |
| POST | `/artifacts` | yes | routes/artifacts.ts:127 |
| GET | `/artifacts/:id` | yes | routes/artifacts.ts:167 |
| PATCH | `/artifacts/:id` | yes | routes/artifacts.ts:196 |
| POST | `/artifacts/:id/versions` | yes | routes/artifacts.ts:240 |
| GET | `/artifacts/:id/versions` | yes | routes/artifacts.ts:266 |
| POST | `/artifacts/:id/restore` | yes | routes/artifacts.ts:310 |
| POST | `/artifacts/:id/export` | yes | routes/artifacts.ts:339 |
| GET | `/artifacts/:id/versions/:version/preview` | yes | routes/artifacts.ts:422 |
| GET | `/artifacts/:id/versions/:version/download` | yes | routes/artifacts.ts:445 |
| DELETE | `/artifacts/:id` | yes | routes/artifacts.ts:478 |
| POST | `/files` (multipart attachment, <= 30 MB) | yes | routes/files.ts:82 |
| POST | `/files/uploads` (start direct upload, <= 500 MB) | yes | routes/files.ts:137 |
| PUT | `/files/:id/content` (local-storage bytes) | yes | routes/files.ts:189 |
| POST | `/files/:id/complete` | yes | routes/files.ts:233 |
| POST | `/files/from-project` | yes | routes/files.ts:270 |
| GET | `/files/:id` | yes | routes/files.ts:315 |
| GET | `/files/:id/download` | yes | routes/files.ts:328 |
| GET | `/files/:id/preview` | yes | routes/files.ts:363 |
| DELETE | `/files/:id` | yes | routes/files.ts:388 |
| POST | `/files/cleanup` | yes | routes/files.ts:425 |
| GET | `/skills` | yes | routes/skills.ts:32 |
| GET | `/skills/:name` | yes | routes/skills.ts:52 |
| GET | `/memory` | yes | routes/memory.ts:55 |
| POST | `/memory` | yes | routes/memory.ts:111 |
| PATCH | `/memory/:id` | yes | routes/memory.ts:144 |
| DELETE | `/memory/:id` | yes | routes/memory.ts:180 |
| DELETE | `/memory/project/:projectId` | yes | routes/memory.ts:206 |
| DELETE | `/memory/all` | yes | routes/memory.ts:229 |
| GET | `/memory/export` | yes | routes/memory.ts:259 |
| POST | `/memory/import` | yes | routes/memory.ts:296 |
| GET | `/preferences` | yes | routes/preferences.ts:58 |
| PATCH | `/preferences` | yes | routes/preferences.ts:73 |
| GET | `/styles` | yes | routes/styles.ts:62 |
| POST | `/styles` | yes | routes/styles.ts:100 |
| POST | `/styles/summarize` | yes | routes/styles.ts:138 |
| GET | `/styles/:id` | yes | routes/styles.ts:244 |
| PATCH | `/styles/:id` | yes | routes/styles.ts:292 |
| DELETE | `/styles/:id` | yes | routes/styles.ts:345 |
| GET | `/usage` | yes | routes/usage.ts:103 |
| GET | `/usage/limits` | yes | routes/usage.ts:122 |
| PATCH | `/usage/limits` | yes | routes/usage.ts:140 |
| GET | `/usage/messages?chatId=` | yes | routes/usage.ts:215 |
| GET | `/usage/export` (CSV) | yes | routes/usage.ts:287 |
| GET | `/public/share/:token` | no (60/min per IP; `no-store`, `noindex`) | routes/share.ts:83 |
| POST | `/chats/:id/share` | yes (nested hook `share.ts:117`) | routes/share.ts:120 |
| POST | `/artifacts/:id/share` | yes | routes/share.ts:150 |
| GET | `/share-links` | yes | routes/share.ts:187 |
| DELETE | `/share-links/:id` | yes | routes/share.ts:226 |
| POST | `/account/export` | yes | routes/account.ts:24 |
| GET | `/account/exports/:id/download` | yes | routes/account.ts:56 |
| DELETE | `/account` (needs the password) | yes | routes/account.ts:81 |

Totals: 88 application routes (2 health + 86 under `/v1`) plus Swagger UI. SSE frames: `start, research, delta, thinking, sources, code, tool_use, tool_result, artifact_created, ui_block, ui_draft, debug, done, error` (`services/generation.ts:122-142`), SSE comment heartbeat every 15 s (`chats.ts:813-815`), frame `id:` = buffer index (`chats.ts:828`). Error body `{error:{code,title,detail,requestId,meta?}}` (`errors.ts:9-17`), 42 typed codes in `ERROR_CATALOG` (`errors.ts:25-238`) (was "56"; corrected by the main session after a count of catalog keys, AUDIT-LOG C-3).

### (b) Database
Postgres 16, Drizzle, single `public` schema, 28 tables (`backend/src/db/schema.ts`). All primary keys `uuid default gen_random_uuid()` (`schema.ts:29`) unless stated; all timestamps `timestamptz`. `NN` = not null. FK actions in brackets. Sessions/users first.

| Table (line) | Columns name:type (NN unless "null") | Indexes / constraints |
|---|---|---|
| users (39) | id; email varchar(320); password_hash text null; name varchar(120) default ''; is_active bool default true; created_at; updated_at | unique `uq_users_email` on lower(email) |
| sessions (58) | id; user_id uuid [cascade]; token_hash varchar(64); expires_at; created_at; last_seen_at; user_agent varchar(300) default '' | unique `uq_sessions_token`; `ix_sessions_user`; `ix_sessions_expires` |
| preferences (78) | user_id uuid PK [cascade]; theme varchar(16) 'system'; font varchar(16) 'sans'; model_alias varchar(64) 'Auto'; instructions text ''; enter_to_send bool true; reduced_motion bool false; default_mode varchar(16) 'chat'; source_scope varchar(32) 'All sources'; save_history bool true; memory_enabled bool true; chat_search_enabled bool true; style_id varchar(64) 'normal'; max_output_tokens int 64000; daily_token_budget int null; monthly_token_budget int null; warn_threshold_pct int 80; routing_preference varchar(16) 'balanced'; timezone varchar(64) 'UTC'; version int 1; effort varchar(16) null; updated_at | checks `ck_warn_threshold` (1–100), `ck_max_output_positive`, `ck_budgets_positive`, `ck_effort` |
| projects (128) | id; user_id [cascade]; title varchar(200); description text ''; instructions text ''; pinned bool false; position int 0; version int 1; created_at; updated_at; deleted_at null | `ix_projects_user_updated`; `ix_projects_user_order` (user_id, pinned, position) |
| project_files (151) | id; project_id [cascade]; user_id [cascade]; filename varchar(255); mime_type varchar(160); size_bytes int; storage_key varchar(300); checksum_sha256 varchar(64) default ''; status varchar(16) 'pending'; error text ''; chunk_count int 0; indexed_at null; created_at | unique `uq_project_files_key`; `ix_project_files_project` |
| file_chunks (186) | id; project_file_id [cascade]; project_id [cascade]; ordinal int; text; char_count int 0; page int null | unique `uq_chunk_ordinal` (project_file_id, ordinal); `ix_chunks_project` |
| saved_sources (209) | id; project_id [cascade]; user_id [cascade]; title varchar(500); url text; domain varchar(255); source_type varchar(32) 'Web'; snippet text ''; retrieved_at; created_at | `ix_saved_sources_project` |
| chats (232) | id; user_id [cascade]; project_id [set null] null; title varchar(200); pinned bool false; version int 1; parent_chat_id uuid null [set null, self FK]; root_chat_id uuid null (no FK); fork_seq int null; created_at; updated_at; deleted_at null | `ix_chats_user_updated`; `ix_chats_project`; `ix_chats_root` |
| messages (271) | id; chat_id [cascade]; user_id [cascade]; seq int; role varchar(16); text ''; mode varchar(16) 'chat'; status varchar(16) 'complete'; error_code varchar(48) null; research_stage varchar(24) null; questions jsonb []; feedback varchar(8) null; model_alias varchar(64) null; effort varchar(16) null; provider varchar(32) null; provider_model_id varchar(128) null; finish_reason varchar(48) null; artifact_id uuid null (no FK); search_entry_point text null; thinking text null; segments jsonb null; created_at; completed_at null | unique `uq_message_seq` (chat_id, seq); `ix_messages_chat`; checks `ck_message_role` (user, assistant), `ck_message_feedback` (up, down), `ck_message_effort` |
| message_sources (327) | id; message_id [cascade]; ordinal int; title varchar(500); url text; url_resolved bool false; domain varchar(255); source_type varchar(32) 'Web'; snippet text ''; passage text ''; retrieved_at | unique `uq_source_ordinal` (message_id, ordinal) |
| research_events (348) | id; message_id [cascade]; ordinal int; stage varchar(24); label varchar(300); detail text ''; at | unique `uq_event_ordinal` |
| tool_calls (372) | id; message_id [cascade]; ordinal int; tool_call_id varchar(128); name varchar(64); input jsonb; content jsonb; ok bool; thought_signature text null; result_cleared bool false; at | unique `uq_tool_call_ordinal` (message_id, ordinal) |
| attachments (401) | id; user_id [cascade]; message_id [cascade] null; project_file_id [set null] null; filename varchar(255); mime_type varchar(160); size_bytes int; storage_key varchar(300); status varchar(16) 'ready'; error text ''; extracted_text text null; page_count int null; created_at | `ix_attachments_key`; `ix_attachments_message`; `ix_attachments_user` |
| sandbox_workspaces (442) | workspace_id varchar(32) PK; user_id [cascade]; chat_id [cascade]; last_run_at; saved_at null; manifest_key varchar(200) null; saved_bytes bigint 0 | `ix_sandbox_workspaces_chat`; `ix_sandbox_workspaces_last_run` |
| share_links (468) | id; user_id [cascade]; token varchar(64); target_type varchar(16); target_id uuid (no FK); snapshot_seq int; snapshot_at; created_at; revoked_at null | unique `uq_share_token`; `ix_share_links_user`; `ix_share_links_target`; check `ck_share_target_type` (chat, artifact) |
| account_exports (497) | id; user_id [cascade]; storage_key varchar(300); size_bytes int; created_at; expires_at | `ix_account_exports_user`; `ix_account_exports_expires` |
| turn_logs (516) | message_id uuid PK [cascade]; user_id [cascade]; markdown text; created_at | none |
| artifacts (529) | id; user_id [cascade]; project_id [set null] null; chat_id [set null] null; title varchar(200); kind varchar(16) 'document'; current_version int 0; version int 1; created_at; updated_at | `ix_artifacts_user`; `ix_artifacts_project`; check `ck_artifact_kind` (document, code, webpage, svg, slides) |
| artifact_versions (552) | id; artifact_id [cascade]; version int; content text; format varchar(16) 'markdown'; storage_key varchar(300) null; mime_type varchar(160) null; size_bytes int null; created_at | unique `uq_artifact_version`; check `ck_artifact_version_format` (markdown, xlsx, docx, pptx) |
| usage_records (592) | id; user_id [cascade]; request_id varchar(64); chat_id [set null] null; message_id [set null] null; project_id [set null] null; model_alias varchar(64); provider varchar(32); provider_model_id varchar(128); input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens int 0; tokens_exact bool false; context_tokens int null; started_at; completed_at null; latency_ms int null; finish_reason varchar(48) null; status varchar(16) 'complete'; error_code varchar(48) null; cost_usd double null; cost_inr double null | `ix_usage_user_started`; `ix_usage_user_model`; `ix_usage_request` |
| usage_counters (650) | id; user_id [cascade]; period_kind varchar(8); period_start; tokens_used int 0; tokens_reserved int 0; updated_at | unique `uq_usage_period` (user_id, period_kind, period_start) |
| idempotency_keys (667) | id; user_id [cascade]; key varchar(200); endpoint varchar(120); request_fingerprint varchar(64); response_json jsonb; status_code int 200; created_at | unique `uq_idempotency` (user_id, key, endpoint); table unused by any route |
| sandbox_claims (693) | id; created_at; expires_at | none |
| goals (704) | id; chat_id [cascade]; origin_message_id [set null] null; description text; status varchar(32) 'active'; token_budget int null; spent_tokens int 0; blocked_reason text null; last_failure_fingerprint text null; consecutive_failure_count int 0; last_failed_tool text null; last_failure_at null; created_at; updated_at; completed_at null | `ix_goals_chat`; unique partial `uq_active_goal_per_chat` (chat_id) where status = 'active' |
| goal_events (735) | id; goal_id [cascade]; run_id varchar(64) null; type varchar(32); tool_name text null; failure_fingerprint text null; data jsonb {}; created_at | `ix_goal_events_goal`; `ix_goal_events_created` |
| memory_items (763) | id; user_id [cascade]; scope varchar(16) 'global'; project_id [cascade] null; kind varchar(24) 'preference'; key varchar(200) (a file path, `/topics/x.md`); content text; summary text ''; is_standing bool false; source_type varchar(32) 'user_statement'; source_chat_id [set null] null; source_message_id [set null] null; version int 1; created_at; updated_at | `ix_memory_user_scope`; `ix_memory_user_standing`; unique `uq_memory_user_scope_key` (user_id, scope, coalesce(project_id, nil uuid), key); GIN `ix_memory_fts` on to_tsvector('simple', key || summary || content) |
| conversation_compactions (806) | id; chat_id [cascade]; through_message_id [cascade]; through_seq int; summary jsonb; token_count_before int null; token_count_after int null; provider varchar(32) null; model varchar(128) null; created_at | unique `uq_compactions_chat_seq`; `ix_compactions_chat` |
| styles (832) | id; user_id [cascade]; name varchar(60); instructions text; version int 1; created_at; updated_at | `ix_styles_user`; check `ck_style_instructions_len` (<= 4000) |

No table has `company_id`, `deleted_at` exists only on chats and projects, no table is partitioned, and there is no `turns`, `model_calls`, `message_contents`, `feedback`, `file_versions`, `deletion_ledger`, `jobs`, `audit_*` table.

Migrations `backend/drizzle` (Drizzle journal `meta/_journal.json`; there is no `meta/0006_snapshot.json`):
| File | Purpose (one line) |
|---|---|
| 0000_jazzy_bloodstorm | creates 17 base tables: users, sessions, preferences, projects, project_files, file_chunks, saved_sources, chats, messages, message_sources, research_events, attachments, artifacts, artifact_versions, usage_records, usage_counters, idempotency_keys |
| 0001_absurd_jamie_braddock | attachments.project_file_id (FK set null) + storage-key index |
| 0002_amazing_sir_ram | file_chunks.page |
| 0003_broken_ego | artifact_versions format / storage_key / mime_type / size_bytes + format check |
| 0004_curious_forge | tool_calls table |
| 0005_cuddly_talkback | sandbox_claims table |
| 0006_fluffy_goals | goals + goal_events |
| 0007_smart_maximus | conversation_compactions + memory_items |
| 0008_odd_excalibur | max_output_tokens default 32000 (data: 4096 -> 32000) |
| 0009_mushy_living_mummy | attachments.page_count |
| 0010_sandbox_workspaces | sandbox_workspaces |
| 0011_usage_context_tokens | usage_records.context_tokens |
| 0012_tool_call_history | tool_calls.thought_signature + result_cleared |
| 0013_message_thinking | messages.thinking |
| 0014_message_segments | messages.segments |
| 0015_max_output_64k | max_output_tokens default 64000 (data: 32000 -> 64000) |
| 0016_artifact_kind_svg | artifact kind check adds svg |
| 0017_effort_and_styles | styles table; messages.effort; preferences.style_id + effort; checks |
| 0018_chat_versions | chats.parent_chat_id / root_chat_id / fork_seq (ADR-0038) |
| 0019_share_links | share_links |
| 0020_account_exports | account_exports |
| 0021_artifact_kind_slides | artifact kind check adds slides |
| 0022_memory_files | data: memory keys become `/topics/<slug>.md` paths (ADR-0047) |
| 0023_turn_logs | turn_logs (ADR-0050) |
| 0024_memory_settings | preferences.memory_enabled + chat_search_enabled |
| 0025_usage_cost_inr | usage_records.cost_inr |
| 0026_google_sign_in | users.password_hash nullable (ADR-0056) |
| 0027_model_aliases_55 | data: retired model aliases in preferences moved (ADR-0055) |

### (c) Frontend (`arcnave-frontend/src`)
Router: `react-router-dom` `BrowserRouter` (`main.tsx:29-35`). Entry splits public site from app (`main.tsx:24-28`).
| Route | Screen / component | File:line |
|---|---|---|
| `/`, `/about`, `/privacy`, `/terms` | Public site (`PublicSite`: Home, About, Data, Use pages) | Landing.tsx:6,51-97 |
| `/s/:token` | `SharedPage` (public shared chat/artifact, no sign-in) | App.tsx:123-131, SharedPage.tsx:42 |
| `/login`, `/signup` | `Auth` (sign in / up, Google button); signed-in users are redirected to `/app` | App.tsx:156-157, Auth.tsx:48 |
| `/app` | `Home` (greeting, composer, suggestion chips) | App.tsx:334,437 |
| `/chat/:id` | `Conversation` (messages, versions, composer) | App.tsx:335,565 |
| `/chats` | `ChatsPage` | App.tsx:336, Pages.tsx:51 |
| `/projects` | `ProjectsPage` | App.tsx:337, Pages.tsx:257 |
| `/project/:id` | `ProjectPage` (files, sources, instructions, chats) | App.tsx:338, Pages.tsx:403 |
| `/artifacts` | `ArtifactsPage` | App.tsx:339, Pages.tsx:918 |
| `/settings` (`?section=profile|appearance|memory|signin|models|usage|data|shortcuts`) | `Settings` | App.tsx:340, Settings.tsx:51-77 |
| `*` | "A fresh start?" empty state | App.tsx:341-355 |

Context panel (`ContextPanel`, lazy): kinds `sources`, `research`, `artifact`, `file` (`types.ts:301-305`, `Panels.tsx:59,195,378,454,824`). Dialogs: search (`Navigation.tsx:610`), share (`App.tsx:1416`), styles (`StylesModal.tsx:50`), memory import (`Settings.tsx:647`), delete account (`Settings.tsx:1254`), export data (`Settings.tsx:1430`), shared links (`Settings.tsx:1463`).

Main components: shell + routes (`App.tsx:175` `Shell`, `:143` `Gate`), nav rail/sidebar/drawer (`Navigation.tsx:279` `AppNav`, `:36` `ChatMenu`), composer with attachments, mic, model/effort menu, drag-drop/paste (`Composer.tsx:241`, `:180` `AttachmentChip`, `:588`, `:653`), dictation (`Dictation.tsx:62`, browser SpeechRecognition), message view with versions, regenerate, feedback, branch, usage row (`App.tsx:844`), states (`ChatStates.tsx:86` `FailureCard`, `:130` `StoppedNote`, `:163` `CutShortNote`, `:194` `DroppedNote`, `:220` `ModelLabel`, `:240` `InlineEdit`), tool activity + thinking (`ToolActivity.tsx`), clarifying options (`QuestionOptions.tsx`), markdown/code/Mermaid (`Content.tsx`, `CodeBlock.tsx`, `MermaidBlock.tsx`), generative UI renderer and 12 block types (`generative-ui/GenerativeUIRenderer.tsx`, `generative-ui/blocks/*`), sandboxed visuals (`SandboxFrame.tsx`, `sandboxTheme.ts`), slides (`SlidesView.tsx`), file previews (`FilePreviews.tsx:14,99`), share link UI (`ShareLink.tsx:15`), settings sections (`Settings.tsx:209-1463`), workspace state + streaming runner (`workspace.tsx:176`, `run` `:427`, `pollGenerating` `:410`), SSE client (`adapter.ts:109-241`), API client (`api.ts`), session (`session.tsx:79`), brand kit (`brand/*`). Auth components `auth/CodeEntry.tsx`, `auth/LinkConfirm.tsx`, `auth/TwoStep.tsx`, `auth/Invite.tsx`, `auth/Welcome.tsx` exist and are exported (`auth/index.ts`) but only `AuthFrame`, `SessionEnded` and `WelcomeGate` are used by live pages (`Auth.tsx:25-30`, `App.tsx:54`); the others are referenced by tests only.


---

# G2 (Stages 6–9) — from `_parts/evidence-g2.md`


Repo = `D:\arcnave-tech` (branch audit/stage-1-21). Paths relative to it. `*` = required parameter.
`.env.example` could not be read (permission denied for the auditor); defaults below come from
`backend/src/config.ts` and `backend/src/config/numbers.ts`, which `.env` overrides.

### (a) Tool registry

How a turn's tool set is built: `routeTurn()` (`backend/src/services/routing/turnRouter.ts:39-67`) returns
`allowedTools` from flags only; `ProjectToolRegistry.getAvailableTools()` (`backend/src/tools/registry.ts:50-63`)
returns definitions; `generation.ts:569-591` intersects the two. Master gate `ENABLE_TOOL_USE` default false
(`config.ts:199`); with it off `getAvailableTools` returns `[]` (`registry.ts:51`). Every allowed tool is declared on
every turn (no discovery step, `registry.ts:1-6`). The same definitions go to both providers; there is no per-provider
tool rendering except the web-search rows and the schema carrier (see "Provider differences").

| Tool (file:line) | Params (type, `*` required) | Caps / timeouts in code | Offered when |
|---|---|---|---|
| `ask_user_input_v0` (`tools/definitions.ts:521-569`) | `questions`* array 1-3 of {`question`* string, `options`* string[2-4], `type` enum single_select / multi_select / rank_priorities} | terminal tool: ends the round loop (`providers/toolLoopPolicy.ts:22-30`) | always when tool use is on (`registry.ts:52`, `turnRouter.ts:40`) |
| `memory_list` (`definitions.ts:273-287`) | `path_prefix`, `include_preview` bool, `cursor` | - | memory on = `ENABLE_MEMORY` && user `memoryEnabled` (`generation.ts:566`; `registry.ts:53`) |
| `memory_read` (`definitions.ts:289-308`) | `path`* = anyOf(string, string[1-20]) (a union) | - | same |
| `memory_write` (`definitions.ts:310-328`) | `path`*, `content`* (minLength 1), `if_version`* | file cap 16 KiB (`services/memory/memoryService.ts:25`) | same |
| `memory_append` (`definitions.ts:330-346`) | `path`*, `content`*, `if_version`* | same cap | same |
| `memory_str_replace` (`definitions.ts:348-366`) | `path`*, `old_str`*, `new_str`*, `if_version`* | same cap | same |
| `memory_delete` (`definitions.ts:368-383`) | `path`*, `if_version`* | - | same |
| `conversation_search` (`definitions.ts:396-412`) | `query`*, `max_results` int 1-10, `within_conversation_id` | max 10 | past-chat search on = `ENABLE_MEMORY` && user `chatSearchEnabled` (`generation.ts:567`; `registry.ts:54`) |
| `read_conversation` (`definitions.ts:414-428`) | `conversation_id`*, `page_token`, `max_turns` int 1-50 | max 50 turns | same |
| `recent_chats` (`definitions.ts:430-444`) | `n` int 1-20, `before`, `after` | max 20 | same |
| `read_me` (`definitions.ts:450-472`) | `modules` enum[] (diagram, mockup, interactive, data_viz, art, chart, elicitation), `platform` enum | - | `ENABLE_GENERATIVE_UI` default true (`config.ts:321`; `registry.ts:55`) |
| `show_widget` (`definitions.ts:474-515`) | `loading_messages`* string[1-4], `title`*, `widget_code`* | response cap `UI_MAX_RESPONSE_BYTES` 100,000 (`config.ts:323`) | same |
| 13 display tools (`tools/displayDefinitions.ts`): `chart_display_v0` :32 (`style`*, `series`*), `comparison_card_display_v0` :110 (`products`*, `summary`*), `featured_card_display_v0` :159 (`products`* 1, `summary`*), `product_carousel_display_v0` :181 (`products`* 1-6, `summary`*), `itinerary_display_v0` :203 (`days`*, `summary`*), `link_preview_display_v0` :253 (`links`*, `summary`*), `message_compose_v1` :289 (`kind`*, `variants`*), `options_card_display_v0` :331 (`options`*, `summary`*), `places_list_display_v0` :373 (`places`*, `summary`*), `quiz_display_v0` :413 (`questions`*, `summary`*, `title`*), `recipe_display_v0` :481 (`ingredients`*, `steps`*, `title`*), `step_card_display_v0` :536 (`steps`*, `summary`*), `translation_display_v0` :576 (`source_language`*, `source_text`*, `summary`*, `target_lang`*, `target_language`*, `translation`*); list at :600-616 | see file | - | same gate as `show_widget` |
| `web_search` (`definitions.ts:185-198`) | `query`* | - (no per-turn cap found) | `ENABLE_WEB` (default false, `config.ts:181`) && live provider (SerpAPI or Google CSE, `services/webSearch.ts:165`) && the model's own search is NOT on (`turnRouter.ts:44-50`) |
| `web_fetch` (`definitions.ts:200-216`; grounded variant :243-250) | `url`* | 10 s, 1 MB raw, 10,000 chars (`services/webFetch.ts:41-47`); URL must already appear in the conversation (`tools/webExecutor.ts:76-87`) | `ENABLE_WEB` |
| `image_search` (`definitions.ts:218-236`) | `query`*, `max_results` int 3-4 | max 4 | `ENABLE_WEB` && live provider |
| `bash_tool` (`definitions.ts:83-102`) | `command`*, `description`* | stdout 64 KiB (`config.ts:273`), read-back 30,000 chars (`config.ts:280`), warm timeout 300 s (`config.ts:251`), Job timeout 10 s (`config.ts:266`), orchestration 45 s (`config.ts:270`), global concurrency 20 (`config.ts:285`); sandbox server: 3 GiB per run, 2 concurrent runs, 15 min max, 50 output files (`backend/sandbox/server.py:66-77`) | `ENABLE_RUN_PYTHON` && sandbox client && turn allows code (`generation.ts:561,587`; `registry.ts:58-60`) |
| `view` (`definitions.ts:104-125`) | `description`*, `path`*, `view_range` int[2] | text cut at 16,000 chars, range 60,000 (`tools/codeExecutionExecutor.ts:59-61`), images <= 4 per call, <= 5 MB (:49-50) | same |
| `create_file` (`definitions.ts:127-140`) | `description`*, `path`*, `file_text`* | - | same |
| `str_replace` (`definitions.ts:142-156`) | `path`*, `description`*, `old_str`*, `new_str` | - | same |
| `present_files` (`definitions.ts:158-177`) | `filepaths`* string[>=1] | - | same |
| `search_project_files` (`definitions.ts:11-34`) | `query`*, `limit` int | limit 1-10, default 5 (`tools/executor.ts:31-34,82`) | the chat belongs to a project (`registry.ts:61`; `turnRouter.ts:59-62`) |
| `read_project_file` (`definitions.ts:36-64`) | `fileId`*, `cursor` int, `maxChars` int | hard cap 6,000 chars (`config/numbers.ts:45`; `executor.ts:123`) | same |
| Claude native search `web_search_20260209` (`providers/anthropic.ts:38`) | server tool, `max_uses: 5` fixed | 5 per request | Claude turn with `grounded` = search available && (mode != chat or `ENABLE_WEB`) (`generation.ts:498-499`) and `ENABLE_ANTHROPIC_WEB_SEARCH` (`anthropic.ts:390-392`; `config.ts:180`) |
| Gemini native search `googleSearch` (`providers/gemini.ts:425`) | server tool | - | Gemini turn, `grounded` and `ENABLE_GOOGLE_SEARCH_GROUNDING` (`gemini.ts:291`; `config.ts:179`); sent in the same `tools` array as the function declarations |
| Gemini `codeExecution` (`gemini.ts:426`) | server tool | - | `ENABLE_GEMINI_CODE_EXECUTION` (`config.ts:191`) and request flag |

Count of function tools declared at most: 1 + 6 + 3 + 2 + 13 + 3 + 5 + 2 = 35 (plus up to 3 native/server tools).
Spec TD-1c lists 12 (file_search, read_file, web_search, fetch_url, run_code, memory_write, memory_delete,
memory_read, create_artifact, update_artifact, load_skill, get_operation_status).

Loop and per-turn limits found:
- Rounds: `TOOL_MAX_ROUNDS` 16 (`config/numbers.ts:43`; `config.ts:206`); `resolveMaxRounds` / `isLastRound` (`providers/toolLoopPolicy.ts:11-18`). On the last round function calling is switched off: Claude `tool_choice: none` (`anthropic.ts:470-479`), Gemini `FunctionCallingConfigMode.NONE` (`gemini.ts:404-437`); finish reason `tool_limit` (`gemini.ts:532`).
- Time: turn deadline 3,540,000 ms (`numbers.ts:39`); one provider request 600,000 ms (`numbers.ts:35`); retries <= 2 before the first token, 1 s base, 8 s cap, Retry-After <= 10 s (`numbers.ts:23-29`; `generation.ts:1367`).
- Output: default max output 64,000 tokens (`numbers.ts:41`); ceiling 128,000 (`config.ts:157`); per-model ceiling from `providers/capabilitiesTable.ts` (Gemini 65,536; Claude 128,000).
- Tool calls of one response run in order, one after the other (ADR-0026, `docs/decisions/0026-parallel-tool-calls.md`).
- Old tool results cleared client-side past 100,000 prompt tokens, keep 3, batch 5 (`config.ts:159-161`; `providers/contextEditing.ts`); skill views are never cleared (`contextEditing.ts:33-36`).
- Per-tier caps (search 1/3/8, run_code 1/3/8, fetch 2/5/10, artifacts 3/5/10, file_search 1/3/6): **not found** (searched: `Fast|Normal|Deep|max_uses|LIMIT_REACHED|perTurn` in `backend/src`, non-test). No `profile` concept exists (only a per-user `effort` and `routingPreference`, `generation.ts:685-687`).
- Result envelope `{status, summary, data, truncated, next_cursor, full_output_file}` and the 11 error codes: **not found**; tools return text or `json` content blocks with `ok` true/false (`tools/executor.ts:43-49`; `webExecutor.ts:31-37`).

Provider differences:
- Claude: `toAnthropicTool` copies the schema as is, no `strict: true` (`anthropic.ts:60-66`); `tool_choice` auto or none (`anthropic.ts:478-479`); `thinking: {type: adaptive, display: summarized}` (`anthropic.ts:488`); `output_config.effort` (`anthropic.ts:490`); `maxRetries: 0` (`anthropic.ts:51`).
- Gemini: `functionDeclarations` with `parametersJsonSchema` (`gemini.ts:89-95,428`); no `VALIDATED` mode (only NONE on the last round, `gemini.ts:433-437`); `thinkingConfig {includeThoughts: true, thinkingLevel}` (`gemini.ts:440-443`).
- Schemas use `minimum`, `maximum`, `minItems`, `maxItems`, `minLength` and one `anyOf` (`definitions.ts:231,406,423,438`; `anyOf` at :298), which TS-2 forbids.

### (b) Prompt files and assembly order

There is no `prompts/` folder in the repo; prompt text is TypeScript. One prompt serves all three models (no per-provider
rendering, no rule ids). Files: `backend/src/services/systemPrompt.ts` (base + guidance), `services/memory/policy.ts` (memory and
past-chat policy), `services/compaction/policy.ts` (compaction policy), `services/ui/policy.ts:6` (visuals policy),
`services/ui/visualizeGuide.ts` (`read_me` content), `services/styles.ts:24-52` (4 style presets), `services/promptCache/promptAssembly.ts`
(assembler), `services/generation.ts:1918-2049` (`buildSystemInstruction`).

System prompt, in order (`promptAssembly.ts:26-132`; joined with a blank line):
1. Stable prefix (`buildStablePrefix`, :26-55): (1) `buildStaticBasePrompt(readMeDeclared)` = 16 blocks: role line, `<core_behavior>`, `<truthfulness>`, `<communication>` (language / Tanglish paragraph at `systemPrompt.ts:63-65`), `<trust_boundaries>`, `<safety>`, `<wellbeing>`, `<evenhandedness>`, `<tool_use>`, `<professional_deliverables>`, `<source_transformation>`, `<agent_behavior>`, `<mistakes>`, `<knowledge>`, `<user_preferences>` (rules for applying saved preferences), `<permissions_and_actions>`, `<final_response>` (`systemPrompt.ts:24-166`); (2) `STATIC_MEMORY_POLICY_V1` if `memory_read` allowed (`memory/policy.ts:11`); (3) `STATIC_PAST_CHATS_POLICY_V1` if `conversation_search` allowed (`policy.ts:73`); (4) `STATIC_COMPACTION_POLICY_V1` always; (5) `GENERATIVE_UI_POLICY_V1` if `show_widget` declared.
2. Dynamic suffix (:79-125), each part only when non-empty: (1) date line, date only, user time zone, no clock time (`systemPrompt.ts:277-295`) plus a mobile line (:268); (2) `<arcNave_capabilities>` listing declared tools, then `<computer_use>` (Skills, The computer, Creating files, Artifacts) if code is on, `<files>` (uploaded-files + project-files guidance), research + `<web>` guidance if web is on (`systemPrompt.ts:368-450`); (3) `<standing_preferences>` (user instructions, `prefs.instructions`); (4) `<project_instructions>`; (5) `<style_instructions>`; (6) `<memory>` = `<memory_listing>`, `<profile>`, `<preferences>` (`memoryService.ts:446-464`, each cut to `MEMORY_CONTEXT_MAX_CHARS` 8,000); (7) `<conversation_compaction>` (latest compaction summary, `compactionService.ts:66-80`); (8) project knowledge: all files whole while <= 200,000 chars (`config.ts:171`), else a pointer + file names, or keyword excerpts when no tools (`generation.ts:1954-2011`); (9) `<active_goal>` (never set); (10) mode directive for search / research (`generation.ts:2014-2021`); (11) `<skills_guidance>` = `<available_skills>` list (name, description, location) + skills re-injected after a compaction, each cut at 20,000 chars (`generation.ts:604-648`; :332).
3. Provider carrier: Claude `system` = [stable prefix with `cache_control: ephemeral`, dynamic text] (`anthropic.ts:441-464`); Gemini one `systemInstruction` string, no explicit context cache (`gemini.ts:420`; no `cachedContents` call anywhere). Order, language and the whole system text are identical for both.

Messages, in order: history = every turn after the last compaction `through_seq`, newest kept while <= (model window - 12,288) x 4 characters, no 6-turn window, no profile budget (`generation.ts:1560-1577`); each history turn = attachments first then text, earlier tool calls replayed as tool_use / tool_result pairs or functionCall / functionResponse (`anthropic.ts:313-338`; `gemini.ts:187-209`); current user turn = attachment blocks (PDF as per-page label + image + text; text files as `document` blocks), then ONE text = attachment manifest + user prompt (`generation.ts:829-832`; `anthropic.ts:340-345`; `gemini.ts:211`). Claude: cache breakpoint on the second-last message (`anthropic.ts:369-376`). Blocks named in the spec and **not found** anywhere: `<model_info>`, `<capabilities_state>`, `<profile>`, `<current_time>` (IST, per turn), `<pending_operations>`, `<retrieval_status>`, `<documents>` with ids, `<memory_docs>`, `<company_instructions>`, `<earlier_conversation_summary>`, `[file:n]` / `[web:n]` ids. Escaping: only a closing tag of the wrapper's own name is neutralised (`promptAssembly.ts:63-66`); user text, history and file text are not escaped.

Other prompt-like text: compaction summarizer prompt and system line (`services/compaction/autoCompact.ts:28-33,203-206`); chat title = first 80 characters of the first user message (`routes/chats.ts:1167-1173`); style synthesizer (`routes/styles.ts:143-216`). No title prompt, no retrieval-rewrite prompt, no memory-extraction prompt.

Model parameters sent: Claude `max_tokens`, `thinking {adaptive, summarized}`, `output_config.effort` (`anthropic.ts:484-490`); Gemini `maxOutputTokens`, `thinkingConfig` (`gemini.ts:421,440`). `temperature`, `top_p`, `top_k`: **not found** in `backend/src` outside tests (grep). Effort: user pref or default `medium` (`config.ts:166`), ladder low-max clamped per model (`capabilitiesTable.ts:151-157`); Gemini maps low/medium/high, higher = HIGH (`gemini.ts:255-258`).

Prompt kit: `backend/src/test/promptKit/cases.ts` (89 derived cases, 43 critical, 21 live-only, `KIT_TARGET = 68` at :31) and `promptKit.test.ts`; header at `cases.ts:1-14` says the original 68-case file was not available. Original kit in the owner folder: `D:\Architecture\Stage-06-Context-Prompt-Assembly\06-eval-cases-v1.json` = 68 cases (the role brief says 87; the file has 68 `"gate"` entries: 32 C, 34 S, 2 O; 87 is the count of `"id"` strings including document ids).

Project and user instruction limits in code: project instructions <= 20,000 chars (`routes/projects.ts:181,266`), user instructions <= 20,000 (`routes/preferences.ts:87`), custom style <= 4,000 (`routes/styles.ts:119`). No company instructions.

### (c) Skills (`backend/skills/`)

Each folder holds only `SKILL.md` (no `references/`, `assets/templates/`, `scripts/`, `evals/`). Frontmatter keys used: name, version, description, category, scope, requires.tools, autoload, metadata.source (schema `services/skills.ts:41-66`; no `license`, no `compatibility`).

| Skill | Version | Size | Category | Needs tool | Purpose (frontmatter) |
|---|---|---|---|---|---|
| `docx` | 3.1.0 | 89 lines | artifact | bash_tool | read, edit or produce a Word file |
| `xlsx` | 4.0.2 | 72 | artifact | bash_tool | read, analyse or produce a spreadsheet |
| `pptx` | 3.0.0 | 57 | artifact | bash_tool | read, edit or produce a deck |
| `pdf` | 6.1.0 | 72 | artifact | bash_tool | produce, fill, merge, split, rotate a PDF |
| `pdf-reading` | 4.0.0 | 81 | analysis | bash_tool | read a PDF not in context |
| `file-reading` | 1.0.1 | 48 | analysis | bash_tool | read other uploaded files not in context |
| `frontend-design` | 1.1.0 | 59 | artifact | none | html / jsx page or component |
| `skill-creator` | 1.1.0 | 55 | meta | none | write or check SKILL.md files |

Spec SF-1 list: docx, xlsx, pptx, pdf, chart, web-page. `chart` and `web-page`: **not found** (searched `backend/skills/*`).

When loaded: `SkillService.listSkills(activeTools)` keeps skills whose required tools are active (`services/skills.ts:283-305`);
`generation.ts:610-626` lists them in `<available_skills>` only when the turn declares `view`; the model reads a skill by viewing
`/skills/<name>/SKILL.md` (path pattern `generation.ts:329`; `SKILLS_ROOT` from `tools/codeExecutionExecutor.ts`); there is no
`load_skill` tool. All have `autoload: false`. After a compaction, skills viewed in the summarised turns are re-injected in full up to
20,000 chars each (`generation.ts:627-646`). Skill folders are baked into the warm sandbox image at `/skills`
(`backend/sandbox/Dockerfile.service:37-39`). HTTP: `GET /skills` (`routes/skills.ts`).

Sandbox image (what skills run on): Python 3.12-slim, poppler, pandoc, LibreOffice (nogui), tesseract (eng, tam), fonts-dejavu-core,
fonts-noto-core (`backend/sandbox/Dockerfile.service:17-21`); pip: pandas numpy scipy matplotlib openpyxl xlrd xlsxwriter pdfplumber pypdf
**pymupdf** python-docx python-pptx pillow pytesseract opencv-python-headless tabulate chardet (`Dockerfile.service:25-32`). Single-use Job image
installs only pandas numpy matplotlib openpyxl (`backend/sandbox/Dockerfile:15`).


---

# G4 (Stages 15–18) — from `_parts/evidence-g4.md`


Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Paths relative to `D:\arcnave-tech`. No values of
secrets, ids or user content appear here. `.env.example` could not be read (access to it is denied to this
auditor); `compose.yaml` and `backend/src/config.ts` were used instead. `node_modules` is not installed, so
installed SDK sources could not be inspected (`@google/genai` ^2.22.0, `@anthropic-ai/sdk` ^0.126.0 per
`backend/package.json:24,32`).

### (a) ApiError codes and HTTP status

Wire shape today: `{ error: { code, title, detail, requestId, meta? } }` (`backend/src/errors.ts:9-17`, `toBody` :263-273).
Content-Type is plain JSON, not `application/problem+json`. `retryable` / `retry_after_s` do not exist.
Catalog (42 codes, `errors.ts:25-238`), code : status : line:

| Code | HTTP | Line |
|---|---|---|
| tool_protocol_in_text | 502 | :26 |
| validation_error | 422 | :32 |
| not_found | 404 | :37 |
| conflict | 409 | :42 |
| unauthorized | 401 | :47 |
| forbidden | 403 | :52 |
| email_taken | 409 | :53 |
| invalid_credentials | 401 | :58 |
| weak_password | 422 | :63 |
| google_signin_disabled | 404 | :68 |
| registration_closed | 403 | :73 |
| payload_too_large | 413 | :78 |
| unsupported_media_type | 415 | :83 |
| too_many_files | 409 | :88 |
| upload_incomplete | 409 | :93 |
| rate_limit | 429 | :98 |
| idempotency_conflict | 409 | :99 |
| model_unavailable | 400 | :106 |
| no_model_available | 503 | :111 |
| capability_unavailable | 400 | :116 |
| budget_exceeded | 402 | :122 |
| run_in_progress | 409 | :128 |
| no_active_run | 404 | :133 |
| export_unsupported | 422 | :138 |
| password_incorrect | 403 | :144 |
| export_expired | 410 | :149 |
| share_not_found | 404 | :154 |
| share_empty | 422 | :159 |
| preview_unsupported | 422 | :165 |
| empty_response | 502 | :171 |
| model_refused | 422 | :176 |
| provider_payload_limit | 400 | :181 |
| context_overflow | 400 | :186 |
| provider_error | 502 | :192 |
| provider_limit | 402 | :197 |
| provider_timeout | 504 | :203 |
| turn_deadline_exceeded | 504 | :208 |
| storage_error | 500 | :213 |
| style_not_found | 404 | :218 |
| style_too_long | 422 | :223 |
| sample_too_long | 422 | :228 |
| internal_error | 500 | :233 |

Status is derived from the code (one code = one status, `errors.ts:253-258`). No code carries `retryable`.
Locked ER-11 statuses/codes (Python build `arcnave.in:backend/packages/chat/src/arcnave_chat/http/problems.py:19-35`):
400 bad_request, 401 unauthorized, 403 forbidden, 404 not_found, 405 method_not_allowed, 409 conflict, 413 payload_too_large,
415 unsupported_media_type, 422 validation_error, 429 rate_limited, 500 internal_error, 503 unavailable, else `http_<status>`;
`retryable` true only for 429/503.

Where codes are thrown (file:line, grouped):
- auth/session: `plugins/context.ts:63,68` unauthorized; `routes/auth.ts:65` registration_closed, `:109` google_signin_disabled;
  `services/auth.ts:160,328` weak_password, `:171,250` internal_error, `:175` email_taken, `:205,208,237,336` invalid_credentials,
  `:210,272` forbidden, `:243` registration_closed; `services/googleSignIn.ts:40,43` invalid_credentials; `routes/account.ts:70` export_expired, `:100` password_incorrect.
- uploads/files: `routes/files.ts:101,209` validation_error, `:106,161` code from `check.code` (payload_too_large | unsupported_media_type, `services/attachments/processUpload.ts:61-69`),
  `:206,405` conflict, `:217,225,254` upload_incomplete, `:345` not_found, `:378,380` preview_unsupported, `:475` unauthorized, `:521` code from `err.code`;
  `routes/projects.ts:395,632` validation_error, `:403` check.code, `:692` unauthorized; `routes/chats.ts:1104` upload_incomplete, `:1115` too_many_files.
- chat/run: `routes/chats.ts:568` run_in_progress, `:686,688` no_active_run, `:874,889` unauthorized, `:1193` validation_error; `routes/helpers.ts:59` conflict, `:111` idempotency_conflict.
- artifacts/share/styles/memory/usage/preferences: `routes/artifacts.ts:375,460,533` validation_error, `:385` export_unsupported, `:391` payload_too_large, `:436,439` preview_unsupported, `:509,642` unauthorized;
  `routes/share.ts:109,365,450` share_not_found, `:144,180` share_empty; `routes/sheetPreview.ts:44` preview_unsupported; `routes/styles.ts:120,314` style_too_long, `:162` sample_too_long, `:170` no_model_available, `:174,179` model_unavailable, `:274,283,323,366` style_not_found;
  `services/styles.ts:78,92` style_not_found, `:109` validation_error, `:116` sample_too_long; `routes/memory.ts:139,175,317,320` validation_error, `:170` conflict, `:173,200` not_found; `routes/usage.ts:177,188` validation_error; `routes/preferences.ts:113` validation_error, `:164` internal_error; `services/usage.ts:239` internal_error; `BudgetExceededError` (`services/usage.ts:159-169`) = budget_exceeded 402 with meta {period, used, limit}.
- generation/provider: `services/generation.ts:378` turn_deadline_exceeded, `:490` model_unavailable, `:503,516,1291` capability_unavailable, `:1156` empty_response, `:1334` no_model_available, `:1479` internal_error, `:2260` model_refused (meta.category), `:2293,2322` context_overflow, `:2302` provider_payload_limit, `:2311` code from `ProviderError.code` (provider_error | provider_timeout | model_unavailable | context_overflow | provider_limit), `:2334` provider_error;
  `services/answerProtocolGuard.ts:25` tool_protocol_in_text; `services/attachments/modelLimits.ts:64` provider_payload_limit; `providers/anthropic.ts:46` ProviderError model_unavailable.
- framework-level (`app.ts:138-194`): ApiError passthrough; zod validation -> validation_error with `meta.issues[] {path, message}` (:148-158); statusCode 429 -> rate_limit (:162-165); 413 -> payload_too_large (:167-170); everything else -> logged and answered 500 internal_error (:172-186), including Fastify's own 400/415 parser errors (code reading only, not run); unknown route -> not_found with `detail` echoing method + URL (:189-194).
- SSE: error frame `{type:'error', code, title, detail, usage?}` (`services/generation.ts:1086-1092`; `routes/chats.ts:632-654` fallback body for non-ApiError = internal_error, "The response could not finish."). No `request_id`, `retryable`, `retry_after_s`.
- Client-only code: `network` (`arcnave-frontend/src/api.ts:72,337`, `adapter.ts:137,193,223`) - not in the server catalog.

### (b) Usage and cost fields

`usage_records` (`backend/src/db/schema.ts:592-642`) columns: id, user_id, request_id, chat_id, message_id, project_id, model_alias, provider, provider_model_id,
input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens, tokens_exact, context_tokens, started_at, completed_at, latency_ms, finish_reason, status
(complete|cancelled|error|blocked; `blocked` is never written - `grep` of `status: 'blocked'` finds only the type, `services/usage.ts:332`), error_code, cost_usd, cost_inr.
Indexes: user+started_at, user+model_alias, request_id. One row per generation attempt (a turn), not per provider call. Not present: company_id, provider_ref_type/provider_ref,
usage_source, thinking_tokens, cache_write_5m/1h split, tool_use_in_tokens, traffic_type, inference_geo, price_version, fx_inr_per_usd, promo_credit_*, provider_ttft_ms, first_delta_ms,
purpose/job_id/helper_version, refusal category, fallback_from.
`usage_counters` (`schema.ts:650-664`): id, user_id, period_kind (day|month), period_start, tokens_used, tokens_reserved, updated_at; unique (user, kind, start).
`preferences` budget columns (`schema.ts:99-106`): max_output_tokens (default 64000), daily_token_budget, monthly_token_budget, warn_threshold_pct (default 80), routing_preference, timezone.
Provider usage object (`providers/types.ts:46-58`): inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, exact, lastRequest{inputTokens,outputTokens}. Gemini maps `outputTokens = candidates + thoughts`,
`inputTokens = prompt - cached`, `cacheWriteTokens = 0` (`providers/gemini.ts:261-278`); Claude takes max per field across `message_start`/`message_delta` (`providers/anthropic.ts:182-191`),
no thinking-token field read, no request-id captured.
Done-event usage DTO (`services/generation.ts:196-211`): inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, exact, costUsd, costInr; `done` event also carries finishReason, effort, questions (`generation.ts:1219-1225`).
`GET /v1/usage` (`routes/usage.ts:65-74`): today/month/allTime totals (inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, costUsd|null, costInr|null, requests), byModel/byProject groups
(key, inputTokens, outputTokens, totalTokens, costUsd, costInr, requests), limits (maxOutputTokens, dailyTokenBudget, monthlyTokenBudget, warnThresholdPct, routingPreference, timezone, dailyUsed, monthlyUsed, dailyPct, monthlyPct, warnings[], dailyResetsAt, monthlyResetsAt), pricingConfigured.
`GET /v1/usage/messages` per-message (`usage.ts:76-95`): messageId, modelAlias, provider, providerModelId, token fields, exact, costUsd, costInr, latencyMs, status, finishReason, errorCode, startedAt, completedAt.
`GET /v1/usage/export` CSV columns (`usage.ts:308-330`): started_at, completed_at, latency_ms, model_alias, provider, provider_model_id, input/output/total/cache_read/cache_write tokens, tokens_exact, status, finish_reason, error_code, cost_usd, cost_inr, chat_id, message_id, project_id, request_id.
Price table: env `PRICING_TABLE` JSON `{ "<providerModelId>": { input, output, cacheRead, cacheWrite } }` USD per 1M tokens (`config.ts:61-69,384-398`); no dated rows, no cache-write 5m/1h split, no cache storage, no tiered rows, no promo credit rows; an absent model = cost null (never 0).
Default is empty (`compose.yaml:80`); no committed price values were found in the readable files. FX: `PRICING_INR_PER_USD` default 88 (N-37 planning) (`config.ts:378`, `config/numbers.ts:83`). cost_usd rounded to 1e-6 (`generation.ts:2204-2214`, `usage.ts:116-131`); `cost_inr = usd * rate`, rounded 1e-6 (`usage.ts:139-142`).
Turn log (`turn_logs`, `schema.ts:516-525`): message_id, user_id, markdown, created_at.

### (c) Log fields emitted today (event / fields; names only)

Logger: pino JSON in production/test, `pino-pretty` in dev (`logger.ts:69-87`); redaction paths in `logger.ts:40-67` (secrets only; no content paths). Fastify uses this logger (`app.ts:68`), so Fastify's own request/response lines (route URL incl. query string, method, status, timing; generated request id from client `x-request-id` header up to 64 chars, `app.ts:60-64`) are also emitted.
Flag legend: C = can carry user/file/model/provider text (via `err` object message/stack, `String(err)`, a result body, a file name or a model-supplied string); I = identifier rule (project number / service URL); ok = ids, codes, counts, durations.

| file:line | level | message | fields | flag |
|---|---|---|---|---|
| app.ts:144 | debug | api error | code, statusCode, requestId | ok |
| app.ts:175 | error | unhandled error | errorType, errorCode, rootType, rootCode, messageLength, requestId, method, route, statusCode | ok (errorLogFields, `errorLog.ts:47-65`) |
| container.ts:151,153,167,185,196 | error/warn/info | sandbox engine fail-closed lines | none | ok |
| container.ts:163 | info | run_python uses the warm sandbox service | url | I (service URL from config) |
| index.ts:25 | info | purged expired sessions | count | ok |
| index.ts:27,43,56,79,88,91,117 | error/fatal | session sweep / retention sweep / checkpoint sweep / shutdown / unhandled / uncaught / failed to start | err | C (pino err = message + stack; a DB error can carry query parameters) |
| index.ts:41 | info | retention sweep | chatsPurged, uploadsPurged, checkpointsPurged | ok |
| index.ts:54 | info | sandbox checkpoint sweep | saved, failed | ok |
| index.ts:65 | info | shutting down | signal | ok |
| index.ts:76 | info | shutdown complete | - | ok |
| index.ts:96 | info | arcnave backend listening | port, host, env, apiPrefix, vertexConfigured, docs | ok |
| index.ts:109 | warn | GOOGLE_CLOUD_PROJECT is not set | - | ok |
| db/migrate.ts:39,43 | info/fatal | migrations applied / migration failed | err (fatal) | C |
| services/generation.ts:701 | error | failed to release budget reservation | err, userId | C (err), user id raw |
| services/generation.ts:1055 | error | generation failed | err, chatId, requestId | C (provider message text is embedded: `providers/anthropic.ts:142`, `gemini.ts:587`) |
| services/generation.ts:1144 | warn | Forced synthesis round failed | err | C |
| services/generation.ts:1215 | info | Runtime debug trace | debugTrace{loadedSkills[], allowedTools[], toolsCalled[]} | ok (tool and skill names) |
| services/generation.ts:1235 | info | turn timing | chatId, messageId, phasesMs{...}, totalMs, probed, model, compacted, effort, requestedEffort, streamMs{model,tools,longestModelWait,modelRequests}, toolCalls | ok |
| services/generation.ts:1243 | warn | turn log not saved | err, messageId | C |
| services/generation.ts:1300 | info | Requested model is disabled or unavailable; falling back to ... Gemini via Auto | requested (alias) | ok |
| services/generation.ts:1385 | info | provider first event | ttftMs, attempt | ok |
| services/generation.ts:1413 | warn | provider context overflow detected | err (String) | C (provider error text) |
| services/generation.ts:1449 | warn | retrying provider call | attempt, delay, err (String) | C (provider error text) |
| services/generation.ts:1710 | warn | compaction failed | err, chatId | C |
| services/generation.ts:1754 | warn | failed to load attachment bytes for wire payload | err, storageKey | C (err) |
| providers/gemini.ts:462,464 | warn | streamed function-call arguments rejected / final round rejected | err (String), model | C |
| providers/gemini.ts:648 | debug | gemini probe failed | err, providerModelId | C (debug) |
| providers/anthropic.ts:676 | debug | anthropic probe failed | status, providerModelId | ok |
| routes/chats.ts:637 | error | generation failed | err | C |
| routes/chats.ts:652 | error | failed to mark run as errored | err | C |
| routes/files.ts:416,460 | warn | orphaned object after delete / cleanup | err, storageKey | C (err; key holds user id) |
| routes/files.ts:524 | error | attachment extraction failed | err | C (parser errors can quote file text) |
| routes/projects.ts:534 | warn | orphaned object after delete | err, storageKey | C |
| routes/projects.ts:798 | error | indexing failed | err, fileId | C |
| services/retention.ts:141 | warn | stored object could not be deleted | err, storageKey | C |
| services/skills.ts:163,195,211,223,234,240 | warn/info | skills registry lines | candidatePaths, key, skillFilePath, count, rejected, filePath, err, errors | ok (server paths, skill names) - `:234` err from YAML parse |
| services/skills.ts:434,459 | warn | path traversal attempt detected | skillName, resourcePath | C (model-supplied strings) |
| tools/codeExecutionExecutor.ts:429,507 | warn | failed to store presented files / place a conversation file in the sandbox | err, fileId | C |
| tools/execution/executionRuntime.ts:298 | warn | failed to collect output files | err, outputDir | C |
| tools/execution/executionRuntime.ts:320 | warn | Output file failed OOXML structural validation | filename, errors | C (user-visible file name, validator strings) |
| tools/execution/executionRuntime.ts:364 | warn | failed to clean up workspace | err, workspaceDir | C |
| tools/execution/executionRuntime.ts:511 | warn | Failed to parse CLI container execution output | err, result | C (sandbox stdout/stderr = file or model text) |
| tools/sandbox/processSandboxClient.ts:212 | error | ProcessSandboxClient execution error | err, cwd | C |
| tools/sandbox/workspaceState.ts:112 | warn | sandbox checkpoint could not be deleted | err, manifestKey | C |
| tools/sandbox/warmSandboxClient.ts:285 | warn | sandbox checkpoint failed | err, workspace | C |

Shadow test: `backend/src/test/contentLeak.test.ts` (sentinels in user message, file, memory file, reply; also a failed-query case). It captures every pino line of one happy-path turn, so none of the C rows above is exercised (header comment :10-23).
Content stored outside logs (not log lines): `turn_logs.markdown` holds user message as sent, thought summary, reply text, every tool call input and result, error message and top 8 stack lines (`services/turnLog.ts:136-233`); system prompt text itself is not stored (size + section names, `:168-172`).

### (d) Env / config keys, defaults, N-id comment

`backend/src/config.ts` (zod schema `:71-399`); N-ids resolve from `backend/src/config/numbers.ts`.
HTTP/session: NODE_ENV=development; PORT=8080; HOST=0.0.0.0; LOG_LEVEL=info; API_PREFIX=/v1; CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173; SESSION_COOKIE_NAME=arcnave_session;
SESSION_TTL_HOURS=336 (N-49 "repo value 14 d", numbers.ts:73); SESSION_COOKIE_SECURE=false; COOKIE_SECRET unset (production needs >= 32 chars, `config.ts:425`); REGISTRATION_ENABLED=true; GOOGLE_OAUTH_CLIENT_ID unset.
Database: DATABASE_URL default is a local dev URL that contains a default credential (`config.ts:97` - forbidden-literal candidate); DB_POOL_MAX=10 (N-66, numbers.ts:71); DB_SOCKET_PATH unset. No statement/lock/idle timeouts anywhere (`db/client.ts:36-52`).
Providers: GOOGLE_CLOUD_PROJECT unset; VERTEX_LOCATION=global; GEMINI_LOCATION unset; ANTHROPIC_API_KEY unset (secret); MODEL_GEMINI_FLASH unset; MODEL_SONNET=claude-sonnet-5-5; MODEL_OPUS=claude-opus-5-5;
AUTO_ROUTE_LONG_PROMPT_CHARS=2000; AUTO_ROUTE_LONG_CONTEXT_CHARS=8000; MODEL_PROBE_TTL_SECONDS=300; PROVIDER_TIMEOUT_MS=600000 (N-43 "repo differs", numbers.ts:35); PROVIDER_CONNECT_TIMEOUT_MS=10000 (no N-id);
PROVIDER_MAX_RETRIES=2, PROVIDER_RETRY_BASE_MS=1000, PROVIDER_RETRY_MAX_BACKOFF_MS=8000, PROVIDER_RETRY_AFTER_MAX_MS=10000 (all N-42, numbers.ts:23-29); TURN_DEADLINE_MS=3540000 (N-43 repo, numbers.ts:39).
Generation: DEFAULT_MAX_OUTPUT_TOKENS=64000 (N-74 repo, numbers.ts:41); MAX_OUTPUT_TOKENS_CEILING=128000; CONTEXT_EDIT_TRIGGER_TOKENS=100000; CONTEXT_EDIT_KEEP_TOOL_RESULTS=3; CONTEXT_EDIT_CLEAR_BATCH=5; REASONING_EFFORT=medium;
PROJECT_FULL_CONTEXT_MAX_CHARS=200000; HISTORY_MAX_ATTACHMENT_BYTES=12000000.
Search/tools: ENABLE_GOOGLE_SEARCH_GROUNDING=false; ENABLE_ANTHROPIC_WEB_SEARCH=false; ENABLE_WEB=false; SERPAPI_API_KEY, GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID unset (secrets); GROUNDING_REDIRECT_TIMEOUT_MS=5000;
ENABLE_GEMINI_CODE_EXECUTION=false; GEMINI_STREAM_TOOL_ARGS=true; ENABLE_TOOL_USE=false; TOOL_MAX_ROUNDS=16 (N-06 repo, numbers.ts:43); READ_PROJECT_FILE_MAX_CHARS=6000 (N-09, numbers.ts:45); TOOL_RESULT_PREVIEW_CHARS=300.
Sandbox: ENABLE_RUN_PYTHON=false; ENABLE_TRUSTED_CLI=false; ENABLE_SKILL_SCRIPTS=false; TRUSTED_WORK_ENGINE=local; TRUSTED_PYTHON_PATH=python3 (python on win32); TRUSTED_WORK_TIMEOUT_MS=120000; SANDBOX_ENGINE=auto; SANDBOX_SERVICE_URL unset;
SANDBOX_SERVICE_AUTH=id-token; RUN_PYTHON_WARM_CODE_TIMEOUT_MS=300000 (N-08 repo, numbers.ts:53); SANDBOX_LOCATION=us-central1 (not asia-south1); SANDBOX_JOB_NAME=arcnave-python-sandbox; SANDBOX_STAGE_BUCKET unset; MAX_CODE_BYTES=20480;
RUN_PYTHON_CODE_TIMEOUT_MS=10000 (N-08 repo, numbers.ts:51); RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS=45000; MAX_STDOUT_BYTES=65536; MAX_STDERR_BYTES=65536; RUN_PYTHON_MAX_OUTPUT_CHARS=30000 (N-09, numbers.ts:47); MAX_CONCURRENT_RUN_PYTHON=20; SANDBOX_CLAIM_LEASE_BUFFER_MS=30000.
Features: ENABLE_SKILLS=true; SKILLS_DIR=skills; ENABLE_PROMPT_CACHE=true; ENABLE_MEMORY=true; MEMORY_CONTEXT_MAX_CHARS=8000; ENABLE_CONTEXT_COMPACTION=true; COMPACTION_TRIGGER_TOKENS=150000; COMPACTION_TRIGGER_HEADROOM_TOKENS=10000;
COMPACTION_TRIGGER_HEADROOM_RATIO=0.15; ENABLE_GENERATIVE_UI=true; UI_MAX_RESPONSE_BYTES=100000.
Storage: STORAGE_BACKEND=local; STORAGE_LOCAL_PATH=./var/uploads; STORAGE_GCS_BUCKET unset; MODEL_INPUT_BUCKET unset; CHAT_PURGE_AFTER_DAYS=30 (N-33, numbers.ts:61); UNSENT_UPLOAD_TTL_HOURS=24; SANDBOX_CHECKPOINT_IDLE_SECONDS=300;
SANDBOX_STATE_RETENTION_DAYS=30; MAX_UPLOAD_BYTES=31457280 (N-10, numbers.ts:57); ATTACHMENT_MAX_BYTES=524288000 (N-10, numbers.ts:59); EXTRACTION_MEMORY_BUDGET_BYTES=4294967296.
Rate limits: RATE_LIMIT_GENERATE_PER_MINUTE=20 (N-01, numbers.ts:65); RATE_LIMIT_WRITE_PER_MINUTE=120 (N-01 repo, numbers.ts:67); RATE_LIMIT_AUTH_PER_MINUTE=10 (no N-id); RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE=60 (no N-id).
Pricing: PRICING_INR_PER_USD=88 (N-37, numbers.ts:83); PRICING_TABLE unset -> {}.
Literals without an N-id comment (candidates for the "no literal for a registered number" rule): SSE heartbeat 15,000 ms (`routes/chats.ts:814`, = N-24 value); web fetch timeout 10,000 ms and 1,000,000-byte cap (`services/webFetch.ts:41-42`, = N-43 fetch_url 10 s); prompt body max 100,000 chars (`routes/chats.ts:543`, N-02 says 32,000);
attachments per message 10 (`chats.ts:546`, N-10 <= 10); partial-input interval 120 ms (`anthropic.ts:58`); web search `max_uses: 5` (`anthropic.ts:38`); CORS maxAge 600 (`app.ts:90`); multipart files 10 / fields 20 (`app.ts:104`); image max 10 MB / 8000 px, PDF 1000 pages / 100 visual (`processUpload.ts:29-37`; N-10 lists image 20 MB).
Frontend: VITE_API_BASE (Dockerfile default `/v1`, `arcnave-frontend/Dockerfile:12`; code fallback to a hard-coded Cloud Run service URL that embeds a numeric project identifier, `src/api.ts:31-33` - identifier-in-code candidate); VITE_API_PROXY (default http://127.0.0.1:8080, `vite.config.ts:14`); VITE_GOOGLE_OAUTH_CLIENT_ID (unset = button hidden, `GoogleSignInButton.tsx:25-27`). SSE reconnect delays [0,1000,2000,4000,8000,15000,30000,60000] ms (`src/adapter.ts:163`).
Compose-only keys (`compose.yaml`): POSTGRES_USER=arcnave, POSTGRES_PASSWORD (required), POSTGRES_DB=arcnave, NODE_ENV=production, SESSION_COOKIE_SECURE=true, CORS_ORIGINS=http://localhost:8080, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_ADC_PATH, PORT (frontend publish port 8080).


---

# G5 (Stages 19–21) — from `_parts/evidence-g5.md`


Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Read-only; paths relative to `D:\arcnave-tech` unless `arcnave.in:` (port source).
Not readable: `.env.example` (permission denied for the auditor), so no env-template line is cited anywhere. Only declared ranges were read (resolved versions sit in the lock files).

### (a) Dependencies

#### backend/package.json (`name: arcnave-backend`, `engines.node >=22`, ESM)
Prod (`dependencies`, lines 23-51):
@anthropic-ai/sdk ^0.126.0 · @fastify/cookie ^11.1.2 · @fastify/cors ^11.3.0 · @fastify/multipart ^10.1.1 · @fastify/rate-limit ^11.2.0 · @fastify/swagger ^9.8.1 · @fastify/swagger-ui ^6.1.1 · @google-cloud/storage ^8.2.0 · @google/genai ^2.22.0 · @node-rs/argon2 ^2.2.1 · @pdf-lib/fontkit ^1.1.1 · docx ^9.7.1 · drizzle-orm ^0.45.2 · exceljs ^4.4.0 · fastify ^5.12.5 · fastify-type-provider-zod ^7.0.0 · fflate ^0.8.3 · google-auth-library ^11.1.0 · image-size ^1.2.1 · officeparser ^8.0.0 · pdf-lib ^1.17.1 · pdf-parse ^2.4.5 · pino ^10.3.1 · postgres ^3.4.9 · pptxgenjs ^4.0.1 · xlsx ^0.18.5 · zod ^4.6.5
Dev (lines 52-63): @types/node ^24.9.1 · drizzle-kit ^0.31.10 · eslint ^9.39.1 · jszip ^3.10.2 · pino-pretty ^13.1.2 · puppeteer-core ^25.11.0 · tsx ^4.23.13 · typescript ^5.9.3 · typescript-eslint ^8.46.2 · vitest ^5.0.1
Notes: `jszip` is dev-only but imported by production code (`backend/src/tools/execution/executionRuntime.ts:18`, `backend/src/services/documents/verify/*.ts`); it still ships because `exceljs` depends on it (not verified in the lock; low risk). No Redis, Cloud Tasks, OTel, Eventarc, Pub/Sub, ClamAV, FFmpeg, pgvector client in the list.

#### arcnave-frontend/package.json (`name: arcnave-ai`)
Prod (lines 15-41): @fontsource-variable/{inter,jetbrains-mono,noto-sans-tamil,noto-serif-tamil,onest,source-serif-4} ^5.3 · @fontsource/opendyslexic ^5.3.0 · @radix-ui/react-{dialog ^1.1.6, dropdown-menu ^2.1.6, hover-card ^1.1.6, tooltip ^1.1.8} · docx-preview ^0.4.1 · jszip ^3.10.1 · katex ^0.18.9 · lucide-react ^0.468.0 · mermaid ^12.0.0 · react ^19.1.0 · react-dom ^19.1.0 · react-markdown ^10.1.0 · react-router-dom ^7.6.0 · recharts ^3.10.1 · rehype-highlight ^7.0.2 · rehype-katex ^7.0.1 · remark-gfm ^4.0.1 · remark-math ^6.0.0
Dev (lines 42-53): @types/{jsdom ^30.0.0, react ^19.1.0, react-dom ^19.1.0} · @vitejs/plugin-react ^4.4.1 · jsdom ^30.1.1 · prettier ^3.9.6 · typescript ~5.8.3 · vite ^6.3.5 · vitest ^4.1.11 · wrangler ^4.38.0
Notes: Vite SPA (not Next.js 16, VS-18), no Expo app, no pdf.js / react-pdf / ECharts / Shiki / markdown-it / remend / DOMPurify. `wrangler` = Cloudflare deploy tool (`arcnave-frontend/package.json:9`, `arcnave-frontend/wrangler.jsonc`).

#### Sandbox Python packages (no version pins anywhere)
- Job image `backend/sandbox/Dockerfile:9-15`: base `python:3.12-slim`; apt `poppler-utils pandoc libreoffice-nogui`; pip `pandas numpy matplotlib openpyxl`; user `sandbox` (non-root, `:17-19`).
- Warm service image `backend/sandbox/Dockerfile.service:12-31`: base `python:3.12-slim`; apt `poppler-utils pandoc libreoffice-nogui tesseract-ocr(+eng,+tam) fonts-dejavu-core fonts-noto-core`; pip `pandas numpy scipy matplotlib openpyxl xlrd xlsxwriter pdfplumber pypdf pymupdf python-docx python-pptx pillow pytesseract opencv-python-headless tabulate chardet`. Server runs as root on purpose (`:9-10`).
- Backend runtime image apt (`backend/Dockerfile:34-36`): `dumb-init poppler-utils python3`.

#### Licence flags
| Item | Where | Licence | Flag |
|---|---|---|---|
| `pymupdf` (PyMuPDF/MuPDF) | `backend/sandbox/Dockerfile.service:28`; used by `backend/skills/pdf-reading/SKILL.md:32-67` | AGPL-3.0 (or commercial) - from general knowledge, not re-read | VIOLATES Stage 20 licence rule "AGPL excluded from runtime" (VS-12 names pypdfium2 / pypdf). |
| `xlsx` (SheetJS CE 0.18.x) and `exceljs` | `backend/package.json:37,49`; used `backend/src/services/retrieval.ts:13-14`, `services/documents/sheetPreview.ts:6`, `xlsxRenderer.ts:8`, `verify/xlsxVerify.ts:7` | Apache-2.0 / MIT (npm metadata, not re-read) | VS-16 says "no SheetJS/ExcelJS" (npm `xlsx` stale). Not a licence issue, a locked-vendor issue. |
| `jszip` | backend lock line 6072; frontend lock line 5249 | `(MIT OR GPL-3.0-or-later)` | Dual; choose MIT. Record in a notices register (none exists). |
| `@img/sharp-libvips-*`, `@img/sharp-*` | arcnave-frontend/package-lock.json lines 1396-1835 | LGPL-3.0-or-later (dev, transitive) | Build-time only; confirm it never ships. |
| pandoc, poppler-utils, tesseract, LibreOffice | sandbox Dockerfiles; poppler also `backend/Dockerfile:35` | GPL-2 / GPL / Apache / MPL via process boundary | Allowed by Stage 20 rule (process boundary) only with a `THIRD_PARTY_NOTICES` register - none exists in the repo. |
Search done: lock-file `license` fields for GPL, SSPL, BUSL, ELv2, Elastic, CC-BY-NC, UNLICENSED, FSL in both lock files - hits above only; no AGPL/SSPL/BUSL package in either lock.

### (b) Dockerfiles, Cloud Build, CI
| File | Facts |
|---|---|
| `backend/Dockerfile` | 3 stages (`deps`, `build`, `runtime`) on `node:22-bookworm-slim` (no digest, `:12,18,28`); `npm ci --omit=dev --ignore-scripts`; runtime adds `dumb-init`; `USER node` (`:56`); `EXPOSE 8080`; HEALTHCHECK on `/healthz` (`:63-64`); `ENTRYPOINT dumb-init`; `CMD sh -c "node dist/db/migrate.js \|\| true; exec node dist/index.js"` (`:69`) - migration failure is swallowed, runs inside the serving container. Copies `drizzle`, `skills`. |
| `arcnave-frontend/Dockerfile` | `node:22-bookworm-slim` build (`npm ci`, `npm run build` = tsc -b + vite build + prerender) then `nginx:1.27-alpine` (`:19`); port 8080 (`:26`); no `USER` directive (comment at `:24-25` claims an unprivileged user); `nginx.conf` proxies `/v1` to `backend:8080` with `proxy_buffering off` (`nginx.conf:36,46`) and `/healthz`,`/readyz` (`:56-57`); headers nosniff, X-Frame DENY, Referrer-Policy (`:19-21`). |
| `backend/sandbox/Dockerfile` | Job image, see (a). `ENTRYPOINT python3 runner.py`. |
| `backend/sandbox/Dockerfile.service` | Warm service, see (a). `EXPOSE 8080`, `WORK_ROOT=/work`. |
| `backend/sandbox/cloudbuild.service.yaml` | One step: docker build `sandbox/Dockerfile.service`; image `asia-south1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/arcnave-python-runner:latest` (`:10`) - `:latest` tag. The deploy trigger for `main` is "outside" the repo (`.github/workflows/ci.yml:2-3`); no trigger file found (searched `**/cloudbuild*`). |
| `compose.yaml` | Local stack: `postgres:16-alpine`, backend, frontend (nginx) on one origin. |
| `.github/workflows/ci.yml` (only workflow) | Triggers: `pull_request`, push on non-main branches; concurrency per ref. Job `backend` (ubuntu-latest, `postgres:16-alpine` service, Node 22, apt `poppler-utils python3`, `npm ci`, `npx tsc --noEmit`, `npx vitest run`); job `frontend` (Node 22, `npm ci`, `npx tsc -b`, `npx vite build`, `npx vitest run`; prerender skipped). No lint, no security scan (gitleaks/OSV/Trivy/npm audit), no SBOM/licence check, no Dependabot (`.github/` holds ci.yml only), no image build, no coverage gate. `backend/package.json:14` defines `lint` (eslint) but CI does not run it. |

### (c) ADR index

#### Repo ADRs `docs/decisions` (files present: 0001-0016, 0018-0057, 0061; absent: 0017, 0058, 0059, 0060)
| No | Title | Status |
|---|---|---|
| 0001 | Python / FastAPI / PostgreSQL stack | superseded by 0003 |
| 0002 | UI model aliases resolve through a configured registry | accepted (gpt-oss part removed by 0055) |
| 0003 | Node 22 / TypeScript / Fastify / Drizzle | accepted |
| 0004 | File-handling parity with Claude.ai / ChatGPT | accepted (intake now 0011) |
| 0005 | Self-hosted Cloud Run sandbox for run_python | accepted; egress superseded by 0007, engine by 0010 |
| 0006 | TurnRouter is a policy boundary only | accepted (amended by 0022) |
| 0007 | Sandbox has no general outbound internet | accepted, implemented 2026-09-25 |
| 0008 | Trusted work runs in the backend process | accepted; sandbox part superseded by 0010 |
| 0009 | A run outlives the connection that started it | accepted |
| 0010 | run_python on a warm sandbox service, workspace per chat | accepted (capacity amended by 0014) |
| 0011 | Upload step 1 follows Claude's published rules | accepted |
| 0012 | Deleted chats leave the back end within 30 days | accepted |
| 0013 | PDFs sent as page images and text | accepted |
| 0014 | Sandbox resources per chat | accepted; decision 1 did not work live |
| 0015 | Sandbox files outlive the instance | accepted, not deployed |
| 0016 | Gemini reads PDF page images from Cloud Storage | accepted, not live |
| 0018 | Skills follow Claude's Agent Skills rules | accepted |
| 0019 | Long chats keep the whole conversation, compact as Claude does | accepted; trigger superseded by 0027 |
| 0020 | Project files in the prompt whole while they fit | accepted (amended by 0029) |
| 0021 | Turn usage = sum of provider requests | accepted |
| 0022 | Model sees what earlier turns did | accepted; decision 2 superseded |
| 0023 | Tool results stay in history | accepted |
| 0024 | Provider timeouts follow Claude's SDK, no first-token cutoff | accepted |
| 0025 | Memory by topic | accepted |
| 0026 | Every tool call of a response runs (parallel) | accepted |
| 0027 | Compaction runs as the window fills | accepted |
| 0028 | A turn never waits on a model probe | accepted |
| 0029 | Past the whole-file limit, project knowledge is searched | accepted |
| 0030 | Thought summary shown, Gemini thinking billed as output | accepted |
| 0031 | Model capability set up at ArcNave level | accepted |
| 0032 | One loop; the model reads the request | accepted |
| 0033 | Styles (presets and custom) | proposed |
| 0034 | Clickable options via turn-ending tool | proposed |
| 0035 | Model-written HTML runs only in a script-only sandbox | accepted |
| 0036 | Sandboxed visuals inherit theme | accepted |
| 0037 | A visual is drawn while the model writes it | accepted |
| 0038 | Editing a prompt makes another version | accepted |
| 0039 | Public share links | accepted |
| 0040 | Memory import/export, data export, account deletion | accepted |
| 0041 | Slides artifacts | accepted |
| 0042 | Voice dictation with the browser's speech recognition | accepted (phase 1) |
| 0043 | Contextual follow-ups and safe answer rendering | accepted |
| 0044 | PDF reading is its own skill, exact figures computed | accepted |
| 0045 | Office files read with code when a sandbox exists | accepted |
| 0046 | Tools and skills cut to the reference | accepted |
| 0047 | Tools and skills match the reference | accepted |
| 0048 | Artifacts, questions, visuals, cards as the reference | accepted |
| 0049 | Prompt and skills line by line with the reference | accepted |
| 0050 | A turn log under every reply | accepted |
| 0051 | Public startup positioning for college teams | accepted |
| 0052 | Reference rules from the audit and turn logs | accepted |
| 0053 | Prototype base; 21-stage architecture is the target spec | accepted; Decision 2 second sentence superseded in part by 0061 |
| 0054 | Claude through the first-party Claude API | accepted (API key, not WIF: its decision 6) |
| 0055 | Three models | accepted |
| 0056 | Google sign-in beside e-mail and password | accepted (number reused: ADR-0053 had reserved 0056 for "typed errors kept") |
| 0057 | Surfaces and chart colours from the brand sheet | accepted (number reused: reserved for "repo prompt kept") |
| 0061 | Locked decisions win outside tech stack and infra | accepted (owner rule 2026-10-15) |
Not written although ADR-0053 listed them: 0058 compaction kept, 0059 retrieval, 0060 frontend hosting.

#### Python ADRs `arcnave.in:docs/architecture/adr` 0001-0014 - ported?
| No | Title | Ported to repo? |
|---|---|---|
| 0001 | Dev telemetry uses the global Telemetry API endpoint | No (OTel deferred) |
| 0002 | Dev Claude via external GCP project | No - retired by Py 0012 |
| 0003 | Cost plan does not rely on implicit Gemini cache | No (cost decision; repo parses `cachedContentTokenCount` only, `backend/src/providers/gemini.ts:243,263`) |
| 0004 | Gemini explicit context cache | No - no `cachedContents` create in `gemini.ts`; only scripts reference it |
| 0005 | BM25 own-partition query, RLS per partition | No (tenancy deferred; repo FTS is a GIN index, `backend/drizzle/0007_smart_maximus.sql:43`) |
| 0006 | Mumbai OCR pinned Document AI RC + Gemini fallback | No (Document AI Phase 5; repo uses Gemini OCR) |
| 0007 | Reranker = Vertex Ranking API | No (Phase 2) |
| 0008 | Dev Claude direct API with WIF | No - widened by Py 0012 |
| 0009 | Mini-LLM turn router | No - conflicts build-plan B-4 / repo ADR-0055, owner question |
| 0010 | Passwordless invite-only auth, SES mailer | No - repo is password + Google (ADR-0056); owner question (Stage 16 audit) |
| 0011 | Redis deferred, stream buffer on Postgres | Partly in spirit (ADR-0053 #7), no `StreamStore` interface (in-process `runHub.ts`) |
| 0012 | Claude through the first-party API | Yes as repo ADR-0054 (deviation: API key instead of WIF) |
| 0013 | Router = Haiku 5.5 thinking disabled | No - same conflict as 0009 |
| 0014 | Worker jobs on Haiku 5.5 | No - same conflict (B-4 three models only) |


---

# D2 (AI output) — from `_parts/evidence-d2.md`


Sources read: `backend/src/providers/capabilitiesTable.ts`, `registry.ts`, `gemini.ts`, `anthropic.ts`, `types.ts`,
`toolLoopPolicy.ts`, `contextEditing.ts`, `backend/src/capabilities/factory.ts`, `config.ts`, `config/numbers.ts`,
`services/generation.ts`; prices from `docs/architecture/00-Handoff/00-cost-decision-log.md`. Auditor model: Sonnet 5.5
(subagent arcnave-auditor). Static read only; no provider call was made. `.env.example` could not be read (permission
denied), so the live `PRICING_TABLE` and the `ENABLE_*` flags are NOT confirmed here.

Paths are relative to `D:\arcnave-tech`. "Stage" ids are the locked decisions in `docs/architecture/`.

### 1. Matrix

| Column | Gemini 3.8 Flash (`Gemini 3.8 Flash`) | Claude Sonnet 5.5 (`Sonnet 5.5`) | Claude Opus 5.5 (`Opus 5.5`) |
|---|---|---|---|
| Provider id (config) | `MODEL_GEMINI_FLASH`, **no default** (`config.ts:129`); unset = alias `not_configured` | `MODEL_SONNET` default `claude-sonnet-5-5` (`config.ts:130`) | `MODEL_OPUS` default `claude-opus-5-5` (`config.ts:131`) |
| SDK + call site | `@google/genai`, `new GoogleGenAI({vertexai:true, project, location})` (`gemini.ts:349-353`); location = `GEMINI_LOCATION` or `VERTEX_LOCATION` default `global` (`config.ts:112,448`); `models.generateContentStream` (`gemini.ts:416`). SDK retries not used; app retry in `streamWithRetry` (`generation.ts:1367`) | `@anthropic-ai/sdk`, first-party API, `maxRetries: 0`, `timeout` = `PROVIDER_TIMEOUT_MS` 600 000 ms (`anthropic.ts:44-55`); `messages.stream` (`anthropic.ts:481`) | same adapter as Sonnet |
| Thinking / effort: support | `thinkingConfig {includeThoughts:true, thinkingLevel}` (`gemini.ts:440-443`); levels LOW/MEDIUM/HIGH only; `xhigh`/`max` run at HIGH (`gemini.ts:255-259`); capability row `['low','medium','high']` (`capabilitiesTable.ts:99`). No `thinkingBudget` | `thinking:{type:'adaptive', display:'summarized'}` + `output_config:{effort}` (`anthropic.ts:488-490`); capability row `low…max` (`capabilitiesTable.ts:66`) | same, row `low…max` (`capabilitiesTable.ts:82`) |
| Thinking / effort: default used | `REASONING_EFFORT` default `medium` (`config.ts:166`) → MEDIUM, via request > `preferences.effort` > config (`generation.ts:685-687`), clamped by `effortFor` (`capabilitiesTable.ts:151-157`). Stage 7 RT-4: Fast low / Normal medium / Deep high, always explicit — repo has no profile, one level for every turn | `medium` for every turn. Vendor API default for Sonnet 5.5 is `high` (Stage 7 §7.9, CR1), so the explicit send is what makes it medium | `medium` (= Opus API default, Stage 7 §7.9) |
| Max output tokens | model cap 65 536 (`capabilitiesTable.ts:97`); turn value `min(pref 64 000, ceiling 128 000, cap)` = 64 000 (`generation.ts:680-684`; pref default `schema.ts:100`; `numbers.ts:41`). Counts thinking (mistakes.md 2026-09-24) | cap 128 000 (`capabilitiesTable.ts:65`); turn value 64 000; `max_tokens` includes thinking | same as Sonnet |
| Context window value used | `registry.ts:65` `contextWindow` 1 000 000 (compaction trigger, `generation.ts:1678`); `capabilitiesTable.ts:96,100` 1 048 576 (history budget, only when the alias is known — see D2 §4 H4) | 1 000 000 in both places (`registry.ts:77`, `capabilitiesTable.ts:64`) | same |
| Files / PDF / image input path | PDF → page images (≤100 pages, JPEG ~2 000 px) + page text, never the PDF bytes (`generation.ts:251-261`, ADR-0013); images as `gs://` `fileData` when `MODEL_INPUT_BUCKET` is set, else `inlineData` (`gemini.ts:43-52`; `generation.ts:1773-1796`); image/audio/video `inlineData` ≤20 MB (`capabilitiesTable.ts:91`); text/Office as `<document filename="…">` text (`gemini.ts:71-76`, filename not escaped); Office with a sandbox → pointer only, content not in context (`attachmentContent.ts:66-78`). PDF page / body limits unverified (`null`, `capabilitiesTable.ts:103-104`) | PDF → page image (base64) + page text (`anthropic.ts:237-251`); images base64 ≤5 MB (`capabilitiesTable.ts:59`); text as `document` blocks `text/plain` (`anthropic.ts:284-293`); a raw-PDF `document` block path exists (`anthropic.ts:259-270`) but is not reached because `asPdfForModel` strips the bytes (`generation.ts:255-261`); PDF ≤600 pages, request ≤32 MB (`capabilitiesTable.ts:52-53`); no audio/video (unavailable note, `attachmentContent.ts:109-112`) | same as Sonnet |
| Tool use | Function calling; loop ≤`TOOL_MAX_ROUNDS` 16 (`numbers.ts:43`); final round: `functionCallingConfig.mode NONE` + `FINAL_ROUND_NOTE` in the system instruction (`gemini.ts:31-34,405-407,433-435`); `streamFunctionCallArguments` for `show_widget` (`gemini.ts:411-415`) | Tool loop, same bound; final round: `tool_choice:{type:'none'}` with tools still declared (`anthropic.ts:470-479`); duplicate failed-call guard exists **only here** (`anthropic.ts:595-609`) | same |
| Parallel tools | All calls of one response run **sequentially**, results returned in one user turn (`gemini.ts:547-567`); history keeps Gemini's per-response signature groups (`gemini.ts:173-180`) | Same (`anthropic.ts:585-620`); `disable_parallel_tool_use` not set | same |
| Web search / grounding | `googleSearch` tool declared beside `functionDeclarations` when `grounded` (`gemini.ts:422-432`); needs `ENABLE_GOOGLE_SEARCH_GROUNDING` (default false, `config.ts:179`) and `ENABLE_WEB` or a non-chat mode (`generation.ts:499`). Sources from `groundingSupports` (`grounding.ts:137-144`); no inline typed ids (Stage 6 CI-1 not built). Gemini `codeExecution` behind `ENABLE_GEMINI_CODE_EXECUTION` (default false) | server tool `web_search_20260209`, `max_uses 5` (`anthropic.ts:38`); needs `ENABLE_ANTHROPIC_WEB_SEARCH` (default false, `config.ts:180`); `pause_turn` resumed (`anthropic.ts:561-569`); no code-execution tool | same |
| Prompt caching | Implicit only; no `cached_content` (`gemini.ts:156-160`). Stage 6 doc-sync 2026-10-05 explicit cache: not built in this repo (the Python gateway built it, then switched it off, 00-checkpoint-stage6.md:64,68) | Explicit `cache_control: ephemeral` (5 min) on the stable system block and on the second-last message (`anthropic.ts:444-462,369-376`); `ENABLE_PROMPT_CACHE` default true; no cache_control on tools | same |
| Streaming | `generateContentStream`; thought parts yielded as `thinking` (`gemini.ts:479-481`); partial call args streamed | `messages.stream`; `thinking_delta` yielded; `input_json_delta` snapshot every 120 ms for `show_widget` only (`anthropic.ts:57,513-526`) | same |
| Usage fields mapped | `usageFrom` (`gemini.ts:261-278`): input = prompt − cached; output = candidates + thoughts; cacheRead = cachedContentTokenCount; cacheWrite = 0; `lastRequest` = whole prompt. Per round summed (`types.ts:82-92`) | `usageFrom`/`merge`/`requestUsage` (`anthropic.ts:157-207`): input_tokens, output_tokens, cache_read, cache_creation; `lastRequest` = input + cache read + cache write. `output_tokens_details.thinking_tokens` (Stage 7 doc-sync 2026-10-03 Stage 17, OD-13) is **not** mapped | same |
| Price row | $0.75 in / $3.75 out / $0.075 cached per 1M until 2026-12-31; $1.50 / $7.50 / $0.15 from 2027-01-01 (cost log line 53; Stage 7 §7.9). Repo cost = `PRICING_TABLE[providerModelId]` from env (`config.ts:384`, `generation.ts:2204-2213`); CURRENT.md:9 says `.env.example` seeds the list-rate row | $2 / $10, cache read $0.20, cache write 5 min $2.50 (cost log line 55) | $4 / $20, cache read $0.20, cache write 5 min $5 (cost log line 55) |
| Knowledge cutoff (Stage 7 §7.9) | Mar 2026 | Jun 2026 | Jun 2026 |
| Router default? | Auto's `default`, `long_prompt` fallback, grounded modes (`routing.ts:61-77`) | `long_prompt` (>2 000 chars, balanced tier) and manual | Auto picks it for any turn with attachments or >8 000 chars of project instructions (`routing.ts:67-72`) — contrary to Stage 18 "Opus never default" |

### 2. Other aliases and model ids still in code

| Item | Evidence | Note |
|---|---|---|
| Unknown-alias fallback spec | `capabilitiesTable.ts:128-144`: provider `google`, vision off, 128 000 input, **4 096 output**, no efforts | Reached by `loadHistory(…, input.modelAlias)` when the request says `Auto` (`generation.ts:445-450,1562`) — the history budget then uses 128 000, not 1 M. Not an alias a user can pick. |
| Provider-id keys in the table | `capabilitiesTable.ts:108-113` (`gemini-3.8-flash`, `claude-sonnet-5-5`, `claude-opus-5-5`) | Aliases are what generation passes; the id keys are a second route that nothing uses today. |
| `claude-sonnet-5` (old id) | `scripts/measureStablePrefixTokens.ts:104`, `runBehaviorEvaluation.ts:256,268`, `runClaudeBehaviorEvaluation.ts:36,46`, `runClaudeCompactionEvaluation.ts:25`, `measureTokens.ts:22,68`, `runPromptCacheEvaluation.ts:27` | Live-eval scripts target a model id the registry no longer serves (ADR-0054). They also build the old prompt (`buildBaseSystemPrompt`), not `assemblePrompt`. |
| gpt-oss, `anthropicVertex.ts` | not found (searched `gpt-oss|GPT-OSS|anthropicVertex` in `backend/src`) | Removed by ADR-0054/0055; migration 0027 moves saved prefs (CURRENT.md:18). |
| Haiku 5.5 / Gemini 3.5 Flash-Lite (router, jobs, summarizer) | not found (searched `Haiku|haiku|flash-lite|gemini-3.5` in `backend/src`, non-test) | Locked in Stage 7 doc-syncs 2026-10-08…14 (ADR-0013/0014) but absent; build-plan B-4 "three models only" — an owner question, not resolved here. |
| Compaction / summariser model | `generation.ts:1691-1696` uses the turn's own model | Stage 7 M7 = Gemini 3.8 Flash (§7.10) / Haiku job (doc-sync 2026-10-14). |
| Sampling parameters | not found (searched `temperature|top_p|topP|top_k|topK` in `backend/src`, non-test) | KEEP: none set anywhere (matches CLAUDE.md of the Python repo and the Gemini/Claude guidance in Stage 6). |

### 3. Capability flags that change what a turn can do (defaults, `config.ts`)

`ENABLE_TOOL_USE` false (199) · `ENABLE_WEB` false (181) · `ENABLE_GOOGLE_SEARCH_GROUNDING` false (179) ·
`ENABLE_ANTHROPIC_WEB_SEARCH` false (180) · `ENABLE_RUN_PYTHON` false (221) · `ENABLE_GEMINI_CODE_EXECUTION` false (191) ·
`ENABLE_SKILLS` true (294) · `ENABLE_PROMPT_CACHE` true (300) · `ENABLE_MEMORY` true (303) ·
`ENABLE_CONTEXT_COMPACTION` true (310) · `ENABLE_GENERATIVE_UI` true (321). CURRENT.md:908-909 records
`ENABLE_TOOL_USE` and `ENABLE_RUN_PYTHON` true in production as of 2026-09-20; the other flags' live values are
unknown to this audit. With `ENABLE_TOOL_USE` on and the other flags at their defaults a turn has no web search and
no computer, and the prompt says so (`systemPrompt.ts:420-422`); with `ENABLE_TOOL_USE` off no tool is declared at all.


---

# D3 (architecture) — from `_parts/evidence-d3.md`


Method: static read, Grep counts only (no test was run). A "case" is a line that starts (after
indentation) with `it(`, `test(`, or their `.skip` / `.only` / `.todo` forms. `it.each` rows and
cases built in a loop count once, so every number is a lower bound. Backend total by this count:
893 cases in 110 files (CLAUDE.md says "~900, 906 on 2026-09-28", so the count is close).
Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Paths are relative to `D:\arcnave-tech`.

"Integration" below means the file builds the full app through `src/test/harness.ts`
(`createTestApp`) or otherwise needs a live Postgres (`TEST_DATABASE_URL`, set in CI at
`.github/workflows/ci.yml:38` with `postgres:16-alpine` at `ci.yml:24`). "Unit" means no Postgres.
A fake provider (`FakeProvider`, `src/test/harness.ts`) stands behind every integration case, so
no case reaches a real model, a real GCS bucket or a real Cloud Run sandbox.

### 1. backend/src by folder

| Folder | Test files | Cases | Unit files / cases | Integration files / cases | Notes |
|---|---:|---:|---:|---:|---|
| `providers/` | 12 | 124 | 12 / 124 | 0 / 0 | adapter-loop tests drive scripted fake SDK clients (`anthropic.adapter-loop.test.ts:48`, `gemini.adapter-loop.test.ts:45` throw "no scripted response left"). Real SDK wire shape is never exercised. |
| `routes/` | 38 | 301 | 1 / 9 (`helpers.test.ts`) | 37 / 292 | Every route test is an integration test with a fake provider. |
| `services/` (top level and sub-folders) | 29 | 267 | 28 / 261 | 1 / 6 (`retention.integration.test.ts`) | See section 3 for services with no test file. |
| `tools/` | 17 | 124 | 14 / 101 | 3 / 23 (`semaphore.test.ts`, `sandbox/workspaceState.integration.test.ts`, `executor.integration.test.ts`) | `warmSandboxClient.test.ts` and `workspaceState.integration.test.ts` start the real Python `server.py` as a child process. |
| `db/` | 2 | 4 | 1 / 3 (`journal.test.ts`) | 1 / 1 (`modelAliasMigration.integration.test.ts`) | One test per migration risk; nothing tests `client.ts` or `migrate.ts`. |
| `capabilities/` | 1 | 2 | 1 / 2 | 0 | |
| `test/` (cross-cutting) | 9 | 68 | 8 / 65 | 1 / 3 (`contentLeak.test.ts`) | `behaviorEvaluation` 22, `batch6ContextRegression` 13, `batch6OverflowStreamingSafety` 11, `promptKit/promptKit` 8, `capabilityRegression` 7, others 1-3. |
| `src/` root (`errorLog`, `configUsage`) | 2 | 3 | 2 / 3 | 0 | `configUsage.test.ts` checks that every `config.ts` key is read somewhere; it does not check literals or `process.env` reads. |
| **Total** | **110** | **893** | **67 / 568** | **43 / 325** | |

Check sums: unit 568 + integration 325 = 893. Integration files 43 = 37 routes + 6 others.

Not counted as tests: `src/test/promptKit/{cases,scenarios}.ts` (1,299 lines of fixtures),
`src/test/harness.ts` (319 lines), `src/test/fixtures/*`.

### 2. Other test areas

| Area | Test files | Cases | Unit / integration | Notes |
|---|---:|---:|---|---|
| `backend/sandbox/test/` | 1 (`test_server.py`) plus `run-integration-tests.sh` | 16 (`def test_`) | Python, starts the real `server.py`; no Postgres | **Not run in CI**: `.github/workflows/ci.yml` has no step naming `sandbox`, `pytest`, `docker` or `lint` (Grep, 0 matches). `server.py` is 798 lines and `runner.py` 280 lines. |
| `arcnave-frontend/src` (all) | 41 | 351 | all unit (jsdom, `api` mocked) | No Playwright or browser test in the repo tree searched. Count by folder below. |
| `arcnave-frontend/src` root | 33 | 257 | | `types.test.ts` 28, `selection.test.ts` 20, `ChatStates.test.tsx` 17, `SandboxFrame.test.tsx` 15, `adapter.test.ts` 12, `ChatView.test.tsx` 12, `Surfaces.test.tsx` 12, `Settings.test.tsx` 11, `aiState.test.ts` 11, `Composer.test.ts` 10, `shortcuts.test.ts` 10 ... |
| `arcnave-frontend/src/auth` | 4 | 54 | | `screens.test.tsx` 26, `SignIn.test.tsx` 13, `Welcome.test.tsx` 9, `session.test.tsx` 6. |
| `arcnave-frontend/src/generative-ui` | 3 | 19 | | `generativeUi.test.ts` 8, `visualQa.test.tsx` 7, `visualBlock.test.tsx` 4. |
| `arcnave-frontend/src/brand` | 1 | 21 | | `brand.test.tsx`. |
| CI-level checks | | | | `ci.yml` runs `tsc --noEmit` + `vitest run` (backend) and `tsc -b` + `vite build` + `vitest run` (frontend). No lint, no OpenAPI drift check (`npm run openapi` is manual), no sandbox Python tests, no migration-apply test on an empty database beyond the vitest global setup. |

Frontend check sum: 33 root + 4 auth + 3 generative-ui + 1 brand = 41 files; 257 + 54 + 19 + 21 =
351 cases.

### 3. Areas with zero tests (by test-file import search)

Method: a module counts as "no direct test" when no `*.test.ts` file imports it by path (Grep on
`from '.../<name>.js'`) and no test file carries its name. Indirect coverage through a route
integration test is noted. Line counts are from Grep.

| Module | Lines | Direct tests | Indirect coverage | Why it matters |
|---|---:|---|---|---|
| `backend/src/services/generation.ts` | 2,381 | none (no `generation.test.ts`) | route integration tests and `test/*` regression files | The turn pipeline. Branches that only fail on error paths (A-05) are untested. |
| `backend/src/services/runHub.ts` | 126 | none | `runResume.integration.test.ts` (4 cases, same instance only) | Replay window, `canReplayFrom`, end listeners and 5-minute retention have no direct test. |
| `backend/src/services/chatVersions.ts` | 88 | none | `chatVersions.integration.test.ts` (9) | Pure functions (`ownerAt`, `versionsAt`) are easy to unit test and have no unit test. |
| `backend/src/services/auth.ts` | 357 | none | `auth.integration.test.ts` (2 cases), `googleSignIn.integration.test.ts` (5) | Session issue, resolve, rehash, change-password have 7 cases between them. |
| `backend/src/services/webFetch.ts` | 131 | none | `tools/webExecutor.test.ts` mocks it (`webExecutor.test.ts:3-14`) | SSRF guard (`isForbiddenHost`) has no test at all (A-08). |
| `backend/src/services/webSearch.ts` | 197 | none | mocked in `uiExecutor.test.ts:7` and `webExecutor.test.ts` | |
| `backend/src/services/turnLog.ts` | 279 | none | read through `chats.integration.test.ts` | ADR-0050 log content. |
| `backend/src/services/accountExport.ts` | 161 | none | `dataControls.integration.test.ts` (6) | |
| `backend/src/services/sandboxCheckpoints.ts` | 37 | none | none found | Advisory-lock sweep that holds a transaction open (A-21). |
| `backend/src/tools/sandbox/signedUrl.ts` | 90 | none | none found | |
| `backend/src/providers/grounding.ts` | 221 | none | adapter tests touch it indirectly | Source extraction for citations. |
| `backend/src/services/memory/chatSearch.ts` | 146 | none | `memory.integration.test.ts` imports `chatExecutor` | Uses `getDb()` (A-16). |
| `backend/src/services/documents/{docx,pdf,pptx}Renderer.ts`, `parse.ts`, `images.ts`, `verify/*` | about 2,300 | `documents.test.ts` (26) covers the facade; `xlsxRenderer.test.ts` (4) | | Only the xlsx renderer has its own test file. |
| `backend/src/container.ts`, `app.ts`, `index.ts` | 270 / 224 / 119 | none | `createTestApp` builds the app | Engine selection (`container.ts:98-215`), shutdown order (`index.ts:61-93`) and rate-limit setup (`app.ts:93-101`) are never asserted. |
| `backend/src/errors.ts`, `logger.ts`, `plugins/context.ts`, `routes/health.ts`, `routes/account.ts` | 284 / 89 / 70 / 93 / 113 | none by name | `contentLeak.test.ts`, `dataControls.integration.test.ts` | |
| `backend/src/db/client.ts`, `db/migrate.ts` | 85 / 46 | none | | Pool settings and the boot-time migration (A-10) are untested. |
| `arcnave-frontend/src/api.ts` | 1,128 | no `api.test.ts` | imported by 10 test files (mocked or for `ApiError`/`errorCopy`) | The HTTP boundary has no test of its own. |
| `arcnave-frontend/src/workspace.tsx` | 1,233 | none | `Shell.test.tsx`, `ChatView.test.tsx` render `App` | Stream reconnect and settle logic (`mistakes.md` 2026-09-17, 2026-09-26) is reached only through `App` renders. |
| `arcnave-frontend/src/{Navigation,Pages,Panels}.tsx` | 702 / 1,027 / 962 | `Surfaces.test.tsx` (12) imports `Pages` and `Panels` | | `Navigation.tsx` has no import in any test. |
| `arcnave-frontend/src/{SharedPage,ShareLink,SlidesView,FilePreviews,StylesModal}.tsx` | 147 / 140 / 196 / 186 / 496 | `Styles.test.tsx` (5) touches the styles modal | | |

### 4. Concurrency and multi-instance coverage (what is absent)

| Property | Test found | Where |
|---|---|---|
| Concurrent version append is safe | yes | `routes/artifacts.integration.test.ts:162` |
| Semaphore never grants above the cap while racing | yes | `tools/sandbox/semaphore.test.ts:49` |
| Concurrent runs in the sandbox are isolated | yes (unit, fake) | `tools/execution/executionRuntime.test.ts:401` |
| A second `generate` on a busy chat is refused | yes (single instance, sequential) | `routes/chats.integration.test.ts:533` |
| Two simultaneous `generate` calls on one chat (the `activeRuns.has` / `set` gap, A-03) | **none** | |
| `generate` without attachments racing on `max(seq)` (A-03) | **none** | |
| Retry of a message that already has tool calls (A-04) | **none**: Grep `retryMessageId` in tests finds 3 uses (`chats.integration.test.ts:629,645`, `officeTextOnce.integration.test.ts:88`); the first retries a plain-text answer with no tool rows | |
| Run on instance A, stop or reattach on instance B (A-01) | **none** | |
| Process death between `reserve` and `release` (A-06) | **none** | |
| `finalise` or `usage.record` throwing (A-05) | **none** | |
| SIGTERM while a detached run is writing (A-02) | **none** | |
| Rate-limit key is the signed-in user, not the proxy address (A-09) | **none** | `routes/*` tests raise limits to 10,000 (`harness.ts:173-175`), so the limiter never fires |
| Migration run twice concurrently (A-10) | **none** | `db/journal.test.ts` checks stamps only |

### 5. Tests that exercise fakes more than behaviour

- Provider adapters: `anthropic.adapter-loop.test.ts` and `gemini.adapter-loop.test.ts` use scripted
  fake SDK clients. `mistakes.md` records two defects that only appeared live because the fake
  accepted anything (2026-09-19 schema mutation by the Gemini SDK; 2026-09-24 a Gemini request shape).
- Route integration tests: all use `FakeProvider`; retries are shortened by `PROVIDER_RETRY_BASE_MS=5`
  (`harness.ts:178`). That shows the retry loop retries; it does not show the real SDKs stay at one
  request per attempt. The only ER-1 guard is `providers/anthropic.firstParty.test.ts:21`
  (`maxRetries` is 0). Nothing guards the google-genai side (`gemini.ts:349-353` sets no retry option;
  Grep for `retryOptions|attempts` in `providers/gemini.ts` and in tests: 0 matches).
- `services/architectureParity.test.ts` (5 cases) builds provider messages from literal fixtures
  and asserts their shape; it compares nothing against a second implementation.
- `test/contentLeak.test.ts` covers the happy path and one error path (shadow mode); its own header
  lists the provider-error `log.warn({ err })` sites as uncovered. Grep finds 35 `{ err }` log calls
  outside tests and `scripts/` in 15 files.

