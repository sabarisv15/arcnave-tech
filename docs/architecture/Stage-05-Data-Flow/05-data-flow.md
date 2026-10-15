# ArcNave – Stage 5 · Data flow – DRAFT
_2026-10-01 · Status: DRAFT · Research: GPT Astra (S1–S14, official quotes) + locked Stage 4 decisions_

## 1. Facts used (Astra, official)
- OpenAI stores conversation items server-side (responses 30 d default, conversations until deleted); ChatGPT "Branch in new chat"; Claude Messages API stateless (client sends history). Gemini Interactions API (stateful) is Preview on Vertex, stores 7 d.
- Cloud SQL PostgreSQL 18 GA (20 Nov 2025); PG17 has no native uuidv7() (PG18 has). ltree, pg_partman, pg_cron, pgcrypto supported on Cloud SQL PG17; pg_partman maintenance needs pg_cron/Scheduler.
- WITH RECURSIVE fine for trees (no fixed depth limit documented); ltree max 65,535 labels.
- Partitioned tables: PK/UNIQUE must include partition key; no CREATE INDEX CONCURRENTLY on parent.
- Redis Streams: XADD MAXLEN/MINID trim, resume via XREAD/XRANGE after last id, EXPIRE on whole key; Memorystore default maxmemory-policy volatile-lru → TTL'd stream keys can be evicted under memory pressure.
- GCS V4 signed PUT: sign Content-Type + x-goog-content-length-range (400 on violation). Eventarc finalize: at-least-once, duplicates, unordered, seconds; console triggers may default to 1 attempt.
- Gemini usageMetadata: promptTokenCount (includes cached), candidatesTokenCount, thoughtsTokenCount, toolUsePromptTokenCount, cachedContentTokenCount, totalTokenCount (= prompt + candidates + toolUse + thoughts), trafficType, per-modality details.
- Claude usage: input_tokens (excl. cache), cache_creation_input_tokens (+5m/1h split), cache_read_input_tokens, output_tokens, output_tokens_details.thinking_tokens, server_tool_use.web_search_requests; streaming usage cumulative. Vertex request-ID header NOT documented → LV-1.
- DPDP Rules 2025: Rule 3 notice (itemised data + purposes), Rule 6(1)(f) processor contract security clauses, Rule 7 notify affected users "without delay" + Board detail in 72 h, **Rule 8(3) one-year retention of personal data, traffic data and processing logs for Seventh-Schedule purposes (covers processors)**; these commence 18 months after Nov 2025.
- Cloud Run request logs include URL path + query string (no body); LogEntry ≤256 KiB; exclusion filters apply after ingestion.

## 2. Data model (core entities)
| Entity | Key fields | Notes |
|---|---|---|
| company, user, membership | company_id, role (admin/user), status | RV-1: company = fiduciary |
| conversation | id, company_id, owner_user_id, title(+version), active_leaf_message_id, settings (memory on/off, tools) | title writes versioned (AS18) |
| message | id (UUIDv7), conversation_id, company_id, parent_id, role, content, attachments (file ids), created_at | tree = adjacency list; branch = path root→leaf |
| model_call | id, turn_id, provider, model@version, **raw request/response blocks exactly as sent** (R1, A3), signatures/thinking blobs, usage raw + normalized, request_id | provider blobs only replayed to same provider (G27) |
| turn | id, user_message_id, assistant_message_id, state, profile, config_stamp (G48), checkpoint jsonb + schema_version (R14), fencing token (R13), budget reservation id (R2) | DB = truth (AS22) |
| stream buffer | Redis stream `turn:{id}` (seq ids), MAXLEN cap, TTL after done | not truth; fallback = DB snapshot (R5) |
| file | id, company_id, uploader_id, gcs_path `tenant/<company>/…`, sha256, mime, size, status (uploaded→scanned→parsed→indexed→ready/failed), scan_status, pipeline_version | AS17 dedupe by hash+version |
| chunk | file_id, company_id, page, text, lang, tsvector, embedding halfvec, embedding_version | tenant filter inside query (R1 retrieval) |
| summary | conversation_id, covers_upto_message_id (branch-keyed, R6), text, version | |
| memory | user_id, company_id, topic, text, source_message_id, created/expiry | from user-written text only (M11) |
| usage_ledger | company_id, user_id, turn_id, model_call_id, reservation/settle, tokens by type, traffic tier, INR cost, price_version | partitioned monthly |
| share | token hash, conversation_id, snapshot (no thinking, no Google-grounded answers – SL-1), revoked_at | RV-3 |
| job / outbox | id, type, idempotency key, status, attempts, error | AS5–AS16 |
| deletion_ledger | subject (user/chat/file/company), requested_at, completed_at | stored outside restorable data (R7) |
| audit_log, safety_event, feedback | IDs + codes only, no content in logs | partitioned monthly |

## 3. Main flows
**F1 Send message:** client POST (Idempotency-Key) → API: auth, ownership (R12), rate limit, policy (allowed models, budget reservation R2/R3) → DB tx: insert user message + turn(QUEUED) + outbox → enqueue Cloud Task inline after commit (R10) → return turn id → client opens SSE `GET /turns/{id}/events`.
**F2 Turn execution:** Executor (Cloud Task) → take lock lease + fencing (R13) → BUILD_CONTEXT from current branch path (R6) using stored rendered blocks (R1) → model calls via Gateway (allowed list only) → each event XADD to Redis stream with seq; checkpoint to DB at step boundaries → settle usage per call → final assistant message + turn DONE in DB (fencing check) → stream TTL.
**F3 Stream/resume:** API relays Redis stream to SSE (ping 15 s); resume with after=seq; if stream key missing/evicted → serve DB snapshot (partial/final) then continue live.
**F4 Edit / regenerate:** edit = new user message with same parent (new branch) → active_leaf moves; regenerate = new assistant message under same user message (version). Thinking/history rules A1/R1 applied by Gateway; summaries + file scope follow new path.
**F5 Upload:** API issues V4 signed PUT (content-type + size range, short expiry) → client uploads to GCS → client calls `POST /files/{id}/complete` → job: malware scan → parse → chunk → embed → index → status ready/failed (AS21); sweeper handles never-completed uploads.
**F6 Share:** create snapshot (filtered per SL-1) → token → share.arcnave.tech; revoke/delete → snapshot gone.
**F7 Memory:** after turn DONE → low-priority job extracts from user-written text → upsert by topic (versioned) → visible/editable.
**F8 Delete:** request → deletion_ledger → cascade jobs (data map R8: DB rows, chunks, memories from chat, files, GCS, shares, caches, Redis) ≤23 d → verification sweep → re-apply after any restore.

## 4. Rules from new facts
- DFR1: Never use provider-side conversation state (Gemini Interactions store, any stored responses): stateless calls only → data stays in our India DB.
- DFR2: Usage normalizer: Gemini cached ⊂ promptTokenCount (don't double count); Claude total input = input + cache_read + cache_creation; streaming usage cumulative (take last).
- DFR3: No secrets/PII in URL query strings (Cloud Run logs them); share token in path is OK only as hashed lookup + revocable.
- DFR4: Redis stream keys: MAXLEN cap + TTL; eviction possible (volatile-lru) → DB snapshot fallback always available.
- DFR5: High-volume append-only tables (usage_ledger, audit_log, safety_event) partitioned monthly from day 1 (pg_partman + pg_cron); PK includes partition time column.
- DFR6: Upload: signed PUT with content-type + size range; server re-checks real type after upload.

## 5. Decisions (need user OK)
| ID | Question | Rec |
|---|---|---|
| DF-1 | IDs & Postgres version | UUIDv7 generated in app (works on PG17). Switch DB-1 to PG18 only after LV confirms pgvector/pg_partman/pg_cron on Cloud SQL PG18 |
| DF-2 | Message tree storage | parent_id + active leaf + recursive query; ltree not needed in MVP |
| DF-3 | Provider-side chat storage | Never (DFR1) |
| DF-4 | Upload trigger | Client "complete" call + sweeper; Eventarc later |
| DF-5 | Partitioning | Monthly partitions for ledger/audit/safety tables; messages not partitioned in MVP |
| DF-6 | **DPDP Rule 8(3) one-year retention vs our 30-day delete** | Lawyer check before launch. Design now: processing logs/metadata (IDs) 1 year; chat content deleted ≤30 d; build a "legal retention" switch in case lawyer says content must be kept |
| DF-7 | Stream buffer | Redis stream per turn (cap + TTL) with DB snapshot fallback |

## Doc-sync 2026-10-10 (Stage 21 Task 1.9 brief – stream buffer until Redis, ADR-0011)
- **DF-7 / F3 / DFR4 until Memorystore exists (owner 2026-10-10, ADR-0011, FD-34):** the stream buffer is reached through a `StreamStore` interface; dev uses `PostgresStreamStore` (`app.turn_stream_events`, fenced appends, relay poll N-73, kept N-24 after the turn ends); `RedisStreamStore` (Redis Streams, seq ids, `MAXLEN ~` N-73, `EXPIRE` after finish) is built and contract-tested in CI in Task 1.9 and switched on by config before the LV-99 load test / staging / any pilot. Truth stays in Postgres (AS22), fencing decides commits (ER-5). F3 adds a `snapshot` event (SG2 fallback) to the event list. F1 dispatch is an in-process dev dispatcher until the Turn Executor task (Cloud Tasks).
