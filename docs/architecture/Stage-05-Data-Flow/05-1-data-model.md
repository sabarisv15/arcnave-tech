# ArcNave – Stage 5.1 · Data model – DRAFT
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01: DM-1–DM-12; DM-8 Projects = MVP feature; DB-1a/b/c) · Based on locked Stage 4 + 05-data-flow facts + Astra R1–R8, Q1–Q7 (official quotes)_

> **Doc-sync 2026-10-03 (Stage 12) – Stage 12 Retrieval (see Stage-12-Retrieval/00-checkpoint-stage12.md):**
> - New tables/fields (Stage 12): **chat_citation** (cite_id → file_version_id, chunk_id, locator page/sheet!range/t_start–t_end, text_hash); **retrieval_record** per turn (provider-neutral: queries, filters, results sent, ids); file **index_status** (text_ready / vectors_ready); vectors carry **embed_model** version; chunks carry **page_index + page_label**; audio chunks carry **t_start/t_end**; chunk **searchable** flag (immediate removal on delete).


> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - Add tables: artifact + artifact_version (versions, source run, format, size); research_run + research_note + job_progress (Stage 10); memory_doc / memory_line / memory_line_source / memory_tombstone / memory_settings (Stage 11 – replaces any earlier single memory table).
> - Deletion map: chat delete → memory_line_source rows removed; lines with no source and origin=auto deleted (MEM-DEL A); research notes and artifacts deleted with their chat.


> **Doc-sync 2026-10-03 (Stage 13) – see Stage-13-Output-Validation/00-checkpoint-stage13.md:**
> - New table **validation_result** (turn_id, check, check_version, score/label, action, latency_ms, sampled, text_revision_hash) – ids + hashes only; data-map entry; purge with jobs (30 d) except aggregated metrics. run_code / DuckDB result envelope carries typed values (used by numbers reconciliation).

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - DM-7 auth policies per SD-1/SD-2 (password rules, MFA tables: mfa_secret, recovery_codes; refresh_token families with replay detection; verification/reset tokens hashed, single-use). `legal_hold` scope per data class (SD-13). **Owed items applied:** add `file_versions` (id, file_id, version, gcs_path, sha256, pipeline_version, created_at; files.current_version_id) – citations reference file_version_id (Stage 12). Artifact in share snapshot = name + type only (G-H).

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - New tables (review R-1): `company_plan` (pool_turns, boost_turns, claude_pool_inr, deep_share_cap, per_user_soft_cap, search_quota, ocr_pages_quota, research_runs, storage_gb, accounts, valid_from/to) and `usage_counter` (company_id, month, turns, searches, ocr_pages, research_runs, claude_inr; per-user counters). Pool consumption shown in admin panel; season boost = row update.

## Global rules (all tables)
- G-1 `company_id` on every tenant table + FORCE RLS; app role not owner (DB-7); composite unique keys start with company_id (D15).
- G-2 PK = UUIDv7 generated in app (DF-1); `created_at`, `updated_at`.
- G-3 **Content vs metadata split**: content columns (message text, file text, memory text, provider blocks) live in content tables; metadata tables hold IDs/codes only → logs, analytics, 1-year retention (DF-6) never touch content.
- G-4 Delete = `deleted_at` (hide now) → cascade hard delete ≤23 days (R8) → deletion ledger (R7).
- G-5 Every table has a data-map entry: PII class, retention, deletion path (R8).
- G-6 No file bytes inside DB rows (base64 never stored; reference file id, rebuild exact bytes from GCS at replay – R1).

## Tables by group
**A. Identity & tenancy**
| Table | Key fields | Notes |
|---|---|---|
| companies | id, name, status, plan | fiduciary (RV-1) |
| company_settings | company_id, claude_enabled (ops), tools enabled, memory_default, public_links_enabled (RV-3), admin_instructions_version_id, budgets | versioned changes → audit |
| users | id, email, name, status | PII |
| memberships | company_id, user_id, role (admin/user), status | A2 |
| auth_identities | user_id, type (password/google), password_hash or google_sub | DM-7 |
| sessions | user_id, refresh_token_hash, device, expires_at | revoke on logout/deactivate |
| invitations | company_id, email, role, token_hash, expires_at | admin invites |

**B. Conversations**
| Table | Key fields | Notes |
|---|---|---|
| conversations | id, company_id, owner_user_id, title + title_version, active_leaf_message_id, memory_enabled, deleted_at | |
| messages | id, conversation_id, parent_id, role, status, model_label, created_at | metadata only (G-3) |
| message_contents | message_id, text, search tsvector | content; chat search G5 (DM-6) |
| message_attachments | message_id, file_id | branch-scoped file scope (R6) |
| turns | id, user_message_id, assistant_message_id, state, profile, config_stamp, checkpoint + schema_version, fencing_token, reservation_id, deadline | R2, R13, R14 |
| model_calls | id, turn_id, provider, model@version, request_id, finish_reason, usage_raw, usage_norm, cost | metadata |
| model_call_blocks | model_call_id, rendered_request_blocks, response_blocks (thinking, signatures, web search encrypted) | content; exact replay (R1, A3); provider-only (G27) |
| tool_calls | id, model_call_id, tool, args_hash, status, idempotency_key, result_ref | G40 |
| citations | message_id, source_type (chunk/web), chunk_id or url, grounded_by (google/claude/own) | SL-1 needs grounded_by |
| summaries | conversation_id, covers_upto_message_id, text, version | branch-keyed (R6) |
| feedback | message_id, user_id, rating, reason_code, comment (content) | SF17 |

**C. Files & knowledge**
| Table | Key fields | Notes |
|---|---|---|
| files | id, company_id, uploader_id, gcs_path, sha256, mime, size, status, scan_status, pipeline_version, error_code | AS21 |
| file_derivatives | file_id, kind (parsed_text, page_images, transcript), gcs_path | big text in GCS (DM-3) |
| chunks | id, file_id, company_id, page, text, lang, tsv, embedding halfvec, embedding_version | RAG |

**D. Memory**
| memories | id, company_id, user_id, topic, text, source_message_id, version, expires_at, deleted_at | M1–M14 |
| memory_events | memory_id, action (create/update/delete/used), at | audit, "memory used" (M8) |

**E. Sharing**
| shares | id, conversation_id, token_hash, snapshot (filtered SL-1), created_by, revoked_at | RV-3 |

**F. Money & limits**
| price_table | model, token_type, tier, price, currency, effective_from/to | G11, B9 |
| budgets | company_id, scope (all/claude), period, limit_inr | R2 |
| budget_reservations | id, company_id, turn_id, amount, status | R2 |
| usage_ledger | company_id, user_id, model_call_id, tokens by type, traffic_tier, cost_inr, price_version | partitioned monthly (DF-5) |

**G. Config & ops**
| config_registry | kind (prompt/profile/tool/router), version, body, active | G48, Stage 6 |
| feature_flags / kill_switch | key, scope, value | G49 |
| jobs, outbox | id, type, idempotency_key, status, attempts, error | AS5–AS16 |
| idempotency_keys | company_id, key, request_hash, response_ref, expires_at | DB not Redis (DM-4) |
| deletion_ledger | subject, requested_at, completed_at | outside restorable DB (DM-5) |
| audit_log, safety_events | ids + codes only | partitioned monthly |

## Extra tables (v2)
| projects, project_members (owner/edit/view), project_files, project_instructions | DM-8 |
| company_settings.retention_days | DM-10 |
| email_verifications, password_resets | DM-7 |

## Platform settings from Astra
- Cloud SQL flag `default_toast_compression=lz4` (supported PG14+, default pglz); TOAST datum ≤1 GB.
- pgvector: halfvec = 2d+8 bytes (3072 dims ≈ 6.1 KB/vector); **hnsw.iterative_scan default OFF → enable** (D6); ef_search default 40; HNSW build needs maintenance_work_mem.
- RLS: keep policies simple row checks (`company_id = current setting`) – Postgres says best-performing; leakproof functions only.
- Cloud SQL storage: auto-increase on; shrink now possible with downtime (docs conflict) – don't rely on it.

## Real-product comparison (official help docs, confidence high unless noted)
| Object | Claude | ChatGPT | Perplexity | Gemini | ArcNave |
|---|---|---|---|---|---|
| Projects/Spaces | Projects (files, instructions, own memory, view/edit) | Projects (40 files, project-only memory) + GPTs | Projects (5,000 files, 2.5 GB) | Gems (instructions + files) | DM-8 |
| Edit/regenerate | New chat version | Edit + "Branch in new chat" | Edit + Rewrite (other model) | Edit + other drafts | tree (DF-2) |
| File retention | with chat/project; chat delete ≤30 d | follows chat; Library files survive | session files 7 d (Enterprise) | with Activity | DM-11 |
| Org retention setting | Enterprise, min 30 d | workspace retention | configurable | Enterprise 1–180 d | DM-10 |
| Roles | Primary Owner/Owner/Admin/User | Owner/Admin/Analytics/Member | Admin/Member/Billing Admin | admin | DM-9 |
| Admin export/audit | org export JSON; audit logs 180 d w/o content | Compliance API | audit webhook (incl. content) | Takeout; audit logs | DM-12 |

## Decisions
| ID | Question | Rec |
|---|---|---|
| DM-1 | Delete style | Hide immediately (deleted_at) + hard delete ≤23 d |
| DM-2 | Raw model blocks | Store without file bytes; file ref; rebuild identical at replay |
| DM-3 | Parsed file text | GCS (asia-south1); chunks in DB |
| DM-4 | Idempotency keys | DB (unique), not Redis |
| DM-5 | Deletion ledger location | Separate store not restored with main DB (small GCS object log, India) |
| DM-6 | Chat search | Postgres FTS + pg_trgm on message_contents, filtered by company + user |
| DM-7 | **Login system** | **Own auth in Postgres** (Identity Platform = global, Firebase Auth = US-only → fail India rule). Argon2id m=19 MiB, t=2, p=1; Google ID token verified server-side (aud, iss, exp, hd), key = `sub`; email_verified alone not trusted for non-Gmail → our own email verification; Android Credential Manager |
| DM-8 | **Projects / Spaces** (all 4 products have them: files + instructions + own memory + sharing) | Schema slot in MVP (projects, project_members, project_files, project_instructions; nullable project_id on conversations); feature ON/OFF = user decision |
| DM-9 | Roles | owner (exactly 1, contract/billing/DPDP contact) + admin + user (Claude: Primary Owner/Owner/Admin/User; ChatGPT: Owner/Admin/Member) |
| DM-10 | Company retention setting | Admin sets auto-delete for chats older than N days (Claude Enterprise ≥30 d, Gemini Enterprise 1–180 d); default = keep until deleted |
| DM-11 | File retention | Chat files deleted with chat; no separate file library in MVP (ChatGPT Library files survive chat delete – avoid confusion) |
| DM-12 | Admin data export | Audit log (no content) MVP; owner can request company/user data export (JSON) via ops in MVP, self-serve later (Claude: Primary Owner export JSON; members no self-export) |

## Lock notes (2026-10-01)
- DM-8: Projects ARE an MVP feature (files + instructions + chats grouping, owner/edit/view sharing inside company). Follow-ups: retrieval scope = chat files + project files (Stage 12, updates RT-1); project memory scope (Stage 11, M4 said later – revisit); project instructions in prompt (Stage 6).
- DB-1a Cloud SQL Enterprise; DB-1b no HA at early MVP (~$49), HA ON before first paying customer (~$99); DB-1c PostgreSQL 18 (confirm pg_partman/pg_cron on PG18 in LV-1).

## Doc-sync 2026-10-05 (Stage 21 Task 0.11 review – tenant policy expression, partition RLS)
- **G-1 / RLS notes:** policy text is `company_id = NULLIF(current_setting('app.company_id', true), '')::uuid` (`USING` + `WITH CHECK`) – the plain cast fails with 22P02 once the setting was used on a connection (Task 0.11 F-1, LV-23).
- **Partitioned tenant tables (chunks, ADR-0005):** each per-company partition has its own ENABLE + FORCE RLS, the same policy and the app grants, created together with the partition; keyword (and by default vector) queries address the company's own partition and its own index. The partition / index naming rule and its server-side lookup are defined in the Phase 1 `db` package.

## Doc-sync 2026-10-08 (Stage 21 Task 1.4 brief – db foundation, first tables)
- **Schema `app`, first tables (Task 1.4):** `companies` (tenant root, policy on `id`), `settings` (global numbers table: `key`, `value jsonb`, `n_id`, `description`; app SELECT only, rows seeded by the tasks that use them), `audit_event` (OD-6 fields + `company_id`; monthly RANGE partitions on `ts` + DEFAULT partition, each with its own ENABLE + FORCE RLS, policy and grants – ADR-0005 pattern via `app.create_month_partition`; app SELECT only, inserts only through `app.audit_append`). Other tables come with their feature tasks (auth, turns, ledger, memory, files).
- **Tenant context:** `SET LOCAL ROLE arcnave_app` + `set_config('app.company_id', …, true)` + per-transaction timeouts (**N-45** per transaction kind – corrected 2026-10-08, Task 1.5; N-70 is migration-only) in every transaction; session-level `SET` is forbidden in the package. PK UUIDv7 generated in the app (G-2), no `uuidv7()` default.

## Doc-sync 2026-10-08 (independent audit – G-2 timestamps exemption)
- G-2 "`created_at`, `updated_at`" applies to entity tables. **Exempt:** append-only / time-keyed tables carry their event time instead (`audit_event.ts`; later ledgers the same) and global config tables carry `updated_at` only (`settings`, written by migrations). Built that way in Task 1.4 (`0001`); no column change.

## Doc-sync 2026-10-09 (ADR-0010)
- **DM-7 revised:** no `password_hash`, no `password_resets`; `auth_identities.provider = google` only; new `email_codes` (sign-in / invite-accept / re-auth codes + links, hashed, single-use); `memberships.role` = owner | admin | user (DM-9; one active owner, one membership per user in MVP); `users` + `invitations` carry `email_norm_hash` and `email_status` / `send_status` (bounce handling).
- **Pre-tenant tables (non-tenant, functions only):** `auth_lookup` (keyed hashes → company id) and `auth_throttle`; `arcnave_app` has no table grant, only EXECUTE on `SECURITY DEFINER` functions; on the case 10 exempt list.

## Doc-sync 2026-10-10 (Stage 21 Task 1.9 brief – chat tables, ADR-0011)
- **Group B built in Task 1.9 (migration `0005_chat`):** `conversations` (+ `title_version`, `last_message_at`, nullable `project_id` slot DM-8), `messages` (status `received|pending|streaming|done|stopped|failed|interrupted`, `turn_id`), `message_contents` (content; DM-6 search columns come with the search task), `turns` (kind `send|edit|regenerate`, state `queued|running|done|cancelled|failed|interrupted`, `finish_code`, fencing token, lease, cancel flag, deadline, `last_seq`; R2 / R14 / FG9 columns nullable slots), `idempotency_keys` (DM-4 – key stored as SHA-256 only), and **`turn_stream_events`** (ADR-0011 – Postgres stream buffer, content class, not the truth, removed N-24 / N-73 after the turn ends). One running turn per conversation = partial unique index (FD-1). No app DELETE grant; removal through `app.chat_sweep` (current tenant, pattern of `app.auth_sweep`); writes to the stream table only through `app.stream_append` (fencing); `app.turn_mark_interrupted` for expired leases (partial text kept, GG7). Soft delete only (DM-1); the F8 cascade comes later. Other group B tables (`message_attachments`, `model_calls`, `model_call_blocks`, `tool_calls`, `citations`, `summaries`, `feedback`) come with their feature tasks.

## Doc-sync 2026-10-10 (Stage 21 Task 1.10 brief – migration 0006)
- **`company_settings`** built with `claude_enabled` only (default false, ops `set-claude`, audit `company.claude_switch`); the other listed columns come with their tasks.
- **`turns`:** finish codes + `blocked`, `max_tokens`; new pairs `failed` → `blocked | interrupted | max_tokens`, `done` → `max_tokens` (`failed` / `interrupted` = ER-3 mid-stream failure); `profile` set; `config_stamp` = `{requested_choice, planned_model, profile, claude_allowed, registry_version, sp_versions, reply_mode?, dev_fault?, served_model, fallback_from, fallback_reason, finish_kind, unavailable_code?}` – ids / enums only. `messages.model_label` = the served pinned model id. `usage_ledger` still with block 7 (until then the `model_call` log lines, Stage 17 doc-sync).

## Doc-sync 2026-10-12 (Stage 21 Task 1.11 brief – migration 0007)
- **`turns`:** `continuations` and `resumes` (smallint, 0 … 1 each – ER-3 one continuation, AS-D3 one resume); `checkpoint` v1 = `{"step": "generate", "served_model": "<pinned id>"}` + `checkpoint_schema_version` 1 – metadata only (data map unchanged: never text). Stamp additions `dispatch`, `continued`, `resumed`, `recovery_prompt_version`, `served_registry_version`, `served_sp_versions` – ids / enums only.
- **Expiry rule (one definition):** a `running` turn with `resumes = 0` expires only 60 s (N-73 resume window) after its lease; a parked turn whose cancel flag is set or whose chat is deleted ends at once (`cancelled` / `stopped` | `deleted`, partial kept); `queued` and `resumes = 1` keep the lease rule.
