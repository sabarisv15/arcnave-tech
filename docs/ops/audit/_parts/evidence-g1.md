# Evidence pack G1 (Stages 1–5): names and shapes only
Paths relative to `D:\arcnave-tech`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Static reading; nothing was run. `.env.example` was not readable by the tool, so no env-file lines are cited (values come from `backend/src/config.ts` and `backend/src/config/numbers.ts`).

## (a) HTTP routes
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

## (b) Database
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

## (c) Frontend (`arcnave-frontend/src`)
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
