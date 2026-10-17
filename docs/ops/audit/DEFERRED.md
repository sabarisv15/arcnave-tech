# tech-audit.A — owner-deferred items (not bucketed)

The owner rule (2026-10-15, ADR-0061) keeps these out of the buckets: company / tenancy, RLS,
roles, Redis, Cloud Tasks, NO_CONTENT enforcement, Terraform, OTel (ADR-0053 #7 and #3). Each
auditor listed the deferred items it met; they are copied here unchanged (headings shifted),
followed by D3's view of the deferred infra. An item is raised to the owner only where skipping it
now forces a later rewrite of something built now ("Raise now? yes").

## Raise-now items (collected from the tables below)

| Group | Id | Item | Source |
|---|---|---|---|
| G1 | DF-05 | NO_CONTENT enforcement (Stage 17): `turn_logs` content (`schema.ts:516-525`, ADR-0050), logs/traces carrying ids only, D19, XG7, DFR3 (no search text in URL query strings: `GET /chats?q=` `chats.ts:202`, `GET /projects/:id/search?q=` `projects.ts:543`), F8-CX stateless-provider disclosure, G-3 content vs metadata split | [_parts/deferred-g1.md:10](_parts/deferred-g1.md#L10) |
| G2 | D6-4 | `Stage-06.../00-checkpoint-stage6.md:73` (table `summaries` per conversation), `Stage-09.../00-checkpoint-stage9.md:32` (file pipeline), `00-Handoff/00-numbers-register.md:83` (N-76 jobs) | [_parts/deferred-g2.md:11](_parts/deferred-g2.md#L11) |
| G3 | D-G3-01 | Chunk tables list-partitioned per company, BM25 + HNSW index per partition (Stage 12 L-26 / VS-7 / ADR-0005; L-06 `company_id` on every row) | [_parts/deferred-g3.md:9](_parts/deferred-g3.md#L9) |
| G3 | D-G3-02 | Runner callable without an HTTP request: turn executor via Cloud Tasks and research as Cloud Run jobs (Stage 10 AO-4, RS-5; N-43/N-44/N-73; Stage 18 doc-sync: Cloud Tasks HTTP max 30 min) | [_parts/deferred-g3.md:10](_parts/deferred-g3.md#L10) |
| G4 | DF-2 | OD-2 URL rule: no user content in a URL path or query string (Stage 17 doc-sync 2026-10-04) | [_parts/deferred-g4.md:10](_parts/deferred-g4.md#L10) |
| G5 | ID-5 / VS-11 / N-48 | Memorystore Redis, redis-py | [_parts/deferred-g5.md:8](_parts/deferred-g5.md#L8) |
| G5 | N-29, N-30 (company Claude pool, company plan), N-11 / N-18 / N-19 / N-20 per-company quotas | Company / tenancy | [_parts/deferred-g5.md:29](_parts/deferred-g5.md#L29) |

Main-session note: three auditors independently raised the same cost — new tables built in this
pass (`file_jobs`, `file_derivatives`, chunks, `summaries`, `chat_citation`, settings / price
rows) without `company_id` would all need a rewrite at tenancy. One nullable column plus an index
per new table avoids it. D3 adds that the in-process run hub forces a rewrite at Cloud Tasks unless
turn parameters are persisted and a run can be loaded from a message id. Both are in SUMMARY.md's
owner-question list; neither is decided here.


---

# G1 — from `_parts/deferred-g1.md`

Auditor model: Sonnet 5.5 (subagent arcnave-auditor). These items are not bucketed in stage-01…stage-05.md. "Why deferred" cites the owner decision: build plan `docs/architecture/00-Handoff/00-build-plan-arcnave-tech.md` B-3 (single user first), B-6 (per-company Claude switch dropped), B-7 (residency, NO_CONTENT, Terraform, OTel, Redis, Cloud Tasks at Phase 5), Phase 2 "Deferred to Phase 5" line, and repo ADR-0053 #3 and #7. "Raise now?" is yes only when skipping the item now forces a rewrite of something built now.

| Id | Item (ids from the stage docs) | Why deferred | Raise now? |
|---|---|---|---|
| DF-01 | Company / tenant model: R1, R2 (scale), A1, A2, A4, R12/RT-7 company Claude limit (DS-B, DS-3 of Stage 3), C1 + UI-5 + B-6 per-company Claude switch, `companies`, `company_settings`, `memberships`, `invitations`, `company_plan`, `usage_counter`, G-1 `company_id` on every table, DM-9 roles, DM-10 retention setting, DM-12 admin export, `project_members` (DM-8), L1-M13 / UI-2 admin panel, L3-G7 per-company quotas, L3 pipeline 9 audit, L4-G42 fairness, L4 comp 2 / P1–P8 / PE-1…3 policy parts, L5-G4 per-company cache marker, D12 tenant storage prefix, RV-1 / R11 DPDP roles, XG9–XG11 / XD-3 admin-run delete + offboarding + auto-retention, B1 audit rows on offboarding | B-3, ADR-0053 #3, build plan Phase 5 item 1 | **No.** Evidence: none of the 28 tables has `company_id` (`backend/src/db/schema.ts`, read in full); every route filters by `user_id` (`routes/chats.ts:869-882`, `projects.ts` `loadProject`); storage keys use the owner id (`services/storage.ts:22-28`). Retrofit later = add nullable `company_id`, backfill one default company, set NOT NULL, rebuild unique indexes with company first, add the filter beside the existing `user_id` filter; cost M per table group, mechanical, already planned. New tables built now (turns, message_contents, feedback, file_versions, price_table, deletion_ledger) hang off chat/message ids and need no `company_id` column now. Old objects under `<ownerId>/` need a copy job in Phase 5 (cost = size of stored files; acceptable). |
| DF-02 | RLS: G-1 policies (text of 2026-10-05), FORCE RLS, app role not owner, D13–D15, DB-7, tenant context `SET LOCAL ROLE` + `set_config` per transaction (2026-10-08), per-company partitions of chunks | B-3, build plan Phase 5 item 1 (pgTAP suite) | **No.** Evidence: single DB role (`db/client.ts:36`), no `SET LOCAL` anywhere (searched `backend/src/db`, `services`). New services receive the database through the container (`generation.ts` `this.db`, `request.services.db`), so a per-transaction tenant wrapper can be inserted at that one seam. Rule for the turn-service refactor (stage-02 S2-4): keep passing the handle, do not import a global `db`. |
| DF-03 | Redis: L-3, DF-7 / DFR4 / SG12 / SD-3 stream buffer (Redis or Postgres `turn_stream_events`, ADR-0011), P2 policy cache, L3 rate-limit counters, query-embedding cache, R5 degraded mode, D20, `StreamStore` interface | B-7 (Redis at Phase 5) | **No.** Evidence: the replay buffer, the run map and the rate limiter are in process (`services/runHub.ts:1-127`, `container.ts:71-74,251-252`, `app.ts:93-101`); only `routes/chats.ts` calls the hub (4 sites: `:565,583,658,685`). Swapping the buffer later = one class + those call sites (cost M). Name the interface when the turn service is extracted; no table needed now. |
| DF-04 | Cloud Tasks / Turn Executor / worker: O-3, Stage 2 DS-1/DS-2/A8, Stage 3 DS-1/DS-2 (cancel via DB flag), AS1–AS19, AS25–AS28, AS-D1–AS-D3, AS-D5, CA1–CA5, AS5–AS9/AS14/AS18/AS23 job system, FG8 sweeper, GG1/GG3/GG5, GD-1, R10, R13, R14, L4-G5/G6/G8 (checkpoint, drain, trace), L4 comps 11–12, Cloud Run jobs for work > 10 min | B-7; build plan Phase 5 item 2; Phase 2 "Cloud Tasks file queue" | **No.** Evidence: `GenerationService.run` is an async generator independent of HTTP (`generation.ts:370-385`), so an executor can call it unchanged; file status is already pollable (`routes/files.ts:315`) so async processing needs no new client contract. Lease/fencing/checkpoint columns are ADD COLUMN later (expand-only). Note for stage-03/05: the DB-level one-running-turn index is NOT deferred (stage-05 TB3). |
| DF-05 | NO_CONTENT enforcement (Stage 17): `turn_logs` content (`schema.ts:516-525`, ADR-0050), logs/traces carrying ids only, D19, XG7, DFR3 (no search text in URL query strings: `GET /chats?q=` `chats.ts:202`, `GET /projects/:id/search?q=` `projects.ts:543`), F8-CX stateless-provider disclosure, G-3 content vs metadata split | B-7; ADR-0053 #7 (shadow in Phase 1, enforce Phase 5) | **Yes, for G-3 only (sequencing).** Evidence: message text and provider fields sit in `messages` (`schema.ts:271-308`) and are read at about 49 query sites in 13 files, 8 of them app code (`chats.ts` 10, `generation.ts` 6, `share.ts` 2, `usage.ts`, `models.ts`, `accountExport.ts`, `autoCompact.ts` 2, `chatSearch.ts`). Every task that adds a reader makes the later split more expensive. Cost now: L (expand/contract on one table, 8 files, tests) done once together with `turns` and the version model (stage-05 P3 / TB3 / F4b); cost if left to Phase 5: the same plus every new reader. The log/URL parts of NO_CONTENT stay deferred. |
| DF-06 | Terraform / platform / infra: L2 components 1–9 and 13 (DNS, TLS, global LB, ingress lock, Cloud Armor, CDN rule, edge logging), E-2, E-4, L2-G6/G7, L8 P1–P30 and PL-1…PL-7, DB-1 HA / Cloud SQL tier / PG 17–18, DB-3, DB-4 residency guard, DB-5, D1–D4, D9, D17–D25, D28, R11 / C3 bucket region (`SANDBOX_LOCATION` default `us-central1` `config.ts:254`), Stage 2 DS-3a sandbox as per-run job, SG9, SG11, security headers at the LB (C3) | B-7; build plan Phase 5 item 4; region re-point is Phase 2 P2-C | **No.** The only code coupling is region/bucket configuration (config, not schema). Postgres 16 -> 17/18 is a dump/restore at the infra phase. |
| DF-07 | OpenTelemetry / tracing / client telemetry: L4 comp 12 tracer, L4-G8, L1-M12 client telemetry endpoint, L8 observability | B-7; build plan Phase 5 item 3 | **No.** Request id already doubles as trace id (`app.ts:60-64`); spans are additive. |
| DF-08 | Items the build plan Phase 2 defers to Phase 5 although outside the owner's short list: ClamAV quarantine (DB-6, D11, UG8), Document AI OCR, embeddings + reranker + pgvector hybrid (RT-2, D5–D7, `chunks.embedding`), Cloud Tasks file queue | build plan Phase 2 "Deferred to Phase 5" | **No**, but see owner question Q-V in stage-02.md (Invariant 4 forbids the embedding column the locked chunk table has). Adding a column and the extension later is cheap; `attachments.scan_status` is added with the file-columns work (stage-05 TC1) so the pipeline order is reserved. |
| DF-09 | Auth items Stage 4 L3 doc-sync points at (Stage 16 SD-1…SD-3): MFA/TOTP, recovery codes, refresh rotation + replay detection, re-auth, logout-all, reCAPTCHA, CSRF on the Google POST, same-origin API / SameSite fix, E-4 bot protection | build plan Phase 5 item 5; ADR-0056 table "Differences from Stage 16" | **No.** The method itself (passwordless vs password) is owner question Q1 in stage-01.md, not a deferral. |
| DF-10 | Lawyer / DPDP items: DF-6 / XG12 legal-hold switch, XD-4 billing-record retention, LD-1…LD-3 retention numbers as policy, XG6 provider-copy disclosure, LW-* | build plan Phase 5 item 6 | **No.** |
| DF-11 | Multi-instance behaviours that follow from the above: run hub and stop in process (`chats.ts:696-712` returns `stopped:false` on another instance), in-memory rate-limit store, reattach 404 `no_active_run` on another instance (`chats.ts:686`), E-1 Next.js/Cloud Run hosting (ADR-0060 pending) | single instance by build plan section 1 | **No.** Documented limits of the prototype. |


---

# G2 — from `_parts/deferred-g2.md`


Not bucketed. Categories from the owner rule 2026-10-15: company / tenancy, RLS, roles, Redis, Cloud Tasks, NO_CONTENT enforce, Terraform, OTel.
"Raise now" = yes only if skipping it now forces a later rewrite of something built now. Spec lines are cited as `file:line` under `docs/architecture/`.

| Id | Spec line | Item | Category | Raise now | Evidence | Cost if skipped |
|---|---|---|---|---|---|---|
| D6-1 | `Stage-06-Context-Prompt-Assembly/06-context-assembly.md:64` (CXD-8), `:29` (CG7) | Admin instruction change applies from the next turn of every chat | company / roles | no | Repo has no company or admin role; only project + user instruction fields (`backend/src/services/generation.ts:1936,2035`) | Adding the company block later is one more entry in `promptAssembly.ts:79-125`; no rewrite |
| D6-2 | `06-context-assembly.md:58` (CXD-2), `06-policy-spec-v3.md:148,35` (AU-3) | Company instructions (<= 3,000 chars), `<company_instructions version>` block, replace-older-version rule for the company level | company | no | Project + user levels are built in G2 with the same versioned-block code (Stage 6 CXD-2 / SR-SESSION), so the company level is an extra block | S when companies exist |
| D6-3 | `06-policy-spec-v3.md:89-90` (CF-3, CF-4), `:178` (implementation contract L3 / L7 tenant + permission filters) | Rules that depend on tenants: workplace data limited to the user's access scope, never reveal other tenants' non-public data | company / RLS | no | Single user per account today; every retrieval query is already scoped by user / project (`services/retrieval.ts`, `tools/executor.ts:104-111`) | Prompt text ships in v3 now; the filter half arrives with RLS |
| D6-4 | `Stage-06.../00-checkpoint-stage6.md:73` (table `summaries` per conversation), `Stage-09.../00-checkpoint-stage9.md:32` (file pipeline), `00-Handoff/00-numbers-register.md:83` (N-76 jobs) | `company_id` on tables created by this group's builds: `summaries`, `file_pages` / sidecar index, `operations` / `jobs`, new file columns | company / RLS | **yes (advisory, one decision for all new tables)** | Every existing table is keyed by `user_id` / `chat_id` only, e.g. `conversation_compactions` (`backend/src/db/schema.ts:806-828`); the spec's job and summary tables are per company | If new tables are created without a nullable `company_id`, adding it later is a migration + backfill + query rewrite per table (M each, risk of missed filters); with a nullable column now it is S. The decision is the owner's; the auditor does not add columns |
| D6-5 | `00-checkpoint-stage6.md:73` (Task 1.14: job on the worker), `00-numbers-register.md:83` (queue `background-low`, lease, attempts, Scheduler) | Summary and title jobs dispatched by a Cloud Tasks queue to a worker service | Cloud Tasks / Terraform | no | The repo has no worker (`backend/src` has no job runner; `routes/chats.ts:1167-1173` sets the title inline). Build the jobs with a DB lease row (as `arcnave.in:backend/apps/worker` does) and an in-process runner | Swapping the dispatcher is S if the job body is idempotent and takes only ids; if the job reads request-scoped state it becomes M. Rule for the builders: job input = ids |
| D6-6 | `Stage-17-Observability` NO_CONTENT (cited by `00-checkpoint-stage6.md:63`; repo `CLAUDE.md:119-121`) | No user text, file text, model output, prompts or memory in logs, metrics, traces | NO_CONTENT enforce | no | `turn_logs` (ADR-0050) stores content and stays until Phase 5; new G2 code should log ids, codes, sizes, durations only | Enforce switch is Phase 5; code that logs content now must be edited later (S per site). Known site: `routes/files.ts:511` logs `{ err }` of an extraction failure |
| D7-1 | `Stage-07-Model-Routing/07-model-routing.md:85` (RT-7), `:124-133` (7.11), `00-numbers-register.md:34` (N-29) | Per-company monthly Claude limit set by the ArcNave team, reserve-then-settle counter, 80 % admin alert, 100 % refuse with message, monthly reset on the 1st (IST) | company | no | Per-user daily / monthly budgets and reservation exist (`generation.ts:694`; `services/usage.ts`); ADR-0053 #6 keeps them as the only cap | The counter keys on user today; a company counter is a second key on the same reservation code (M) |
| D7-2 | `00-checkpoint-stage7.md:50` (RT-8 switch `company_settings.claude_enabled`, ops command `set-claude`), `07-model-routing.md:87` | Per-company Claude ON / OFF switch | company | no | Owner dropped it for the prototype (ADR-0053 #6, `docs/decisions/0053-prototype-base-and-target-spec.md:23`); the fallback rule that reads it is OQ7-2 in `stage-07.md` | None for code: the fallback chain takes an `allowClaude` boolean from config now and from the company later |
| D7-3 | `07-model-routing.md:89` (RT-10), `00-numbers-register.md:43,60` (N-38, N-55) | Gemini 429 / TPM monitoring, Priority PayGo decision, Claude 429-rate alert | OTel / Terraform | no | No metrics stack in repo | Alerts are config on top of existing typed errors (`provider_limit`, 429 counters) |
| D8-1 | `Stage-08.../08-tool-execution.md:94` (TD-9), `08c-skill-framework.md:97` (SF-5 gating) | Company admin switches: web search; code execution + file creation together; skill catalog gating by that switch | company / roles | no | Gating today is deployment flags (`ENABLE_WEB`, `ENABLE_RUN_PYTHON`, `config.ts:181,221`) read in `tools/registry.ts:50-63` | The registry already takes flags; a company setting replaces the flag source (S) |
| D8-2 | `00-checkpoint-stage8.md:34` (TD-14), `00-numbers-register.md:23,71,86` (N-18: 1,000 searches / company / month) | Per-company monthly search quota | company | no | No search counters in repo | New counter table keyed by company (S), after TS-12 caps exist |
| D8-3 | `00-checkpoint-stage8.md:44-49` (TD-5c+: ~5 parallel runs per company), `00-numbers-register.md:13` (N-08) | Parallel run cap per company and fairness | company | no | Global cap 20 in Postgres (`config.ts:285`; `tools/sandbox/semaphore.ts`) | The semaphore already lives in Postgres; adding a company key is S |
| D8-4 | `00-checkpoint-stage8.md:10-11` (TD-4b realised as a Cloud Run Job per run, signed GCS URLs, job SA, result bucket, timeout 120 s), `:39-40` (TD-4b), `:13-14` (dispatch deadline 20 s) | Per-run Job topology, service accounts, buckets | Terraform / Cloud Run layout | no, with one rule | Repo has both engines (`config.ts:239-258`; `tools/sandbox/cloudRunSandboxClient.ts`). Rule: build the new `run_code` tool to the spec's stateless contract ("each run starts fresh, re-load from /input or /output", `08d-tool-definitions.md:197`) so the Job swap changes only the client | If `run_code` is built to the warm service's persistent-files semantics, the later swap changes tool behaviour the model has learned (M) |
| D8-5 | `00-checkpoint-stage8.md:35-38` (TD-3 own fetcher service, zero-permission SA), `00-numbers-register.md:72` (N-65 Fetcher 0.5 vCPU / 512 MiB) | Separate fetcher service | Terraform / Cloud Run layout | no | SSRF-safe fetch code is rebuilt in-process now (`stage-08.md` T-fetch_url) | Moving the module into its own service is a packaging change (S) |
| D8-6 | `00-checkpoint-stage8.md:39-40` (no-egress sandbox), repo ADR-0007 | VPC / network rules that make "no egress" true | Terraform | no | Repo enforces by design + ADR-0007; network deny rules are infra | n/a |
| D9-1 | `00-checkpoint-stage9.md:32` (Cloud Task between upload and check), `00-numbers-register.md:49` (N-44 `file-blocking` queue: 3 attempts, 10 s-5 min backoff, 30 min deadline), `09-file-processing.md:112` (G21) | Cloud Tasks queue for file processing, at-least-once delivery | Cloud Tasks | no, with one rule | Repo processes inline (`routes/files.ts:233-265`). Rule: every pipeline step idempotent per (file id, version), job input = ids | If steps are not idempotent, a later at-least-once queue duplicates OCR cost and rows (M) |
| D9-2 | `00-checkpoint-stage9.md:38` (company OCR-page + audio-minute quotas), `:14-15` and `:21` (quota values), `00-numbers-register.md:16,86` (N-11: OCR 5,000 pages / company / month, audio 120 min / user / month) | Company OCR-page and audio-minute quotas | company | no | No quota tables | New counters (S); per-user upload rate stays in `stage-09.md` LIMITS |
| D9-3 | `00-checkpoint-stage9.md:56` (G30: company fairness under saturation, alert when queue wait > 5 s) | Fairness and queue-wait alert | company / OTel | no | No queue yet | n/a |
| D9-4 | `00-checkpoint-stage9.md:95-108` (Document AI quota 6 -> 60 requests / min, increase through support) | Quota increase for Document AI | ops / Terraform | no | Not code | n/a |
| D9-5 | `00-checkpoint-stage9.md:44` (G34 isolated parser service), `00-numbers-register.md:72` (N-65 Parser 2 vCPU / 4 GiB conc 2), ClamAV container (Stage 19 doc-sync `00-checkpoint-stage9.md:17-18`) | Deployment of the parser service and ClamAV (infra half of ISOLATION / SCAN) | Terraform / Cloud Run layout | no | Code half is bucketed NEW-BUILD in `stage-09.md`; build the service as a container with a Dockerfile and a health check so Terraform only deploys it | None for code |
| D9-6 | `00-checkpoint-stage9.md:59` (G23: 23 d app delete + 7 d bucket soft delete), `00-numbers-register.md:38` | Bucket soft-delete 7 d and lifecycle rules | Terraform | no | App sweep removes at 30 d (`services/retention.ts`; `config/numbers.ts:61`) | None |


---

# G3 — from `_parts/deferred-g3.md`


Rule (owner, 2026-10-15; ADR-0053 #7, ADR-0061 §4): company/tenancy, RLS, roles, Redis, Cloud Tasks, NO_CONTENT enforce, Terraform, OTel are deferred and not bucketed. An item is raised now only if skipping it forces a later rewrite of something that is built now. Evidence is `path:line` in `D:\arcnave-tech` (spec lines are cited by stage file and id). Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Fact used by several rows: the repo has no tenancy at all — `backend/src/db/schema.ts` contains no "company" string (searched, 0 hits); every table is keyed by `user_id`.

| Id | Item (stage id) | Spec line | Why deferred | Raise now? | Evidence | Cost |
|---|---|---|---|---|---|---|
| D-G3-01 | Chunk tables list-partitioned per company, BM25 + HNSW index per partition (Stage 12 L-26 / VS-7 / ADR-0005; L-06 `company_id` on every row) | Stage 12 checkpoint doc-syncs 2026-10-03 (review), 2026-10-05 | company/tenancy, RLS | **YES** | `file_chunks` today is one unpartitioned table keyed by project (`db/schema.ts:186-207`, unique `uq_chunk_ordinal` on `project_file_id, ordinal`). Stage 12 rows L-03/L-10/L-06 rebuild this table now (new chunker, tsvector, chat-file scope). A PostgreSQL table cannot be converted to a partitioned table in place: later it means create partitioned table, copy, re-index, swap, and the new unique/primary keys must then include the partition key. | If the rebuilt table is created now as `LIST (company_id)` with a single seeded partition and `company_id NOT NULL` (default one dev company row): S (one migration, one `companies` stub). If skipped: M–L later (table rewrite + reindex of every chunk, key changes in `retrieval.ts` queries). Also decide the same for the vector column if Q1 (stage-12) goes Option A. |
| D-G3-02 | Runner callable without an HTTP request: turn executor via Cloud Tasks and research as Cloud Run jobs (Stage 10 AO-4, RS-5; N-43/N-44/N-73; Stage 18 doc-sync: Cloud Tasks HTTP max 30 min) | Stage 10 checkpoint AO-4, RS-5; Stage 18 doc-sync | Cloud Tasks / Cloud Run job layout is infra | **YES (design constraint on AO-4b / research, not the infra)** | A turn is a closure inside the route handler: the run starts at `routes/chats.ts:585-659` with the Fastify `request`, `reply` and an in-process `AbortController`/`RunHub` (`runHub.ts:89-126`). `generation.run` itself takes only data (`GenerateInput`, `generation.ts:270-291, 370`) — a good seam, but the lifecycle (lease, resume, cancel flag, event store) lives only in the route. Stage 10 AO-4b and the research build (stage-10 §4) will add exactly that lifecycle now. | If the new run store is keyed by `turn_id`/`message_id`, the runner is a function `runTurn(turnId)` readable from the DB, and cancel is a DB flag (plus the in-process abort as fast path): S extra now. If built request-bound: M later to lift it out for Cloud Tasks / jobs. |
| D-G3-03 | Redis: SSE relay pub/sub, stream retention ~15 min (N-24), Redis `MAXLEN ~10,000` (N-73), query-embedding cache 1 h (Stage 12 L-12 / RE35 / RD-16), rate limits | Stage 14 doc-syncs 2026-10-07/10; Stage 12 Step 3 | Redis deferred | No | The Postgres-backed event store (stage-10 AO-4b) with 250 ms polling is the locked fallback (Stage 14 doc-sync 2026-10-10: "Postgres buffer, poll 250 ms"); the in-process cache is a drop-in until Redis exists. In-process today: `runHub.ts:1-12`, rate limits in memory (`config/numbers.ts:64-67`). | n/a (Postgres first, Redis swap is DIFF-INFRA later) |
| D-G3-04 | Company-level memory default/OFF-deletes-all, admin cannot view/export memories, legal request via ops (Stage 11 M-05 company layer, M-18 MEM-ADMIN) | Stage 11 checkpoint MEM-DEFAULT = A, MEM-ADMIN | company/tenancy, roles | No | No company/roles exist (see header fact); user-level switch exists `db/schema.ts:95`. | Later: S per table (ALTER + backfill) because memory rows are already per user. |
| D-G3-05 | RLS on `memory_doc`, `memory_line`, `memory_line_source`, `memory_tombstone`, `memory_settings` (Stage 11 M-03); on `validation_result` (Stage 13 V-19); on citation registry / retrieval record (Stage 12 L-16/L-18); on research tables (Stage 10) | Stage 11 "RLS on everything"; Stage 13 OV21; Stage 12 RE46 | RLS | No (except D-G3-01) | None of these tables exists yet; they are new tables, so adding `company_id` + policy later is `ALTER … ADD COLUMN` with a one-company backfill — cheap, unlike a partitioned table. | S per table later; if the owner prefers zero rework, add nullable `company_id` to each new table now (XS per table). |
| D-G3-06 | Per-company long-task and research quotas, "remaining" counter, research ON/OFF switch (Stage 10 AO-11, RS-4, RS-7; N-19 5 runs/company/month, N-20) | Stage 10 checkpoint AO-11, RS-4, RS-7, N-19/N-20 | company/tenancy, roles | No | Per-user budgets only: `usage.ts`, `preferences.dailyTokenBudget` (`schema.ts:101-102`). Research mode is also not built yet (stage-10 §4); the per-run caps (30 min / 50 searches / 5 helpers, RS-3) are **not** deferred and are in the Stage 10 file. | S–M later (counter table + admin switch); no rework of the research build if the run row stores its owner and cost. |
| D-G3-07 | NO_CONTENT enforce: ids-only logs/metrics/traces; `turn_logs` reduced (ADR-0050 superseded); memory text never in logs (DPDP Rule 8(3)); validation records ids/hashes only (Stage 11 M-24; Stage 13 V-19) | Stage 11 checkpoint Storage; Stage 13 doc-sync Stage 17 | NO_CONTENT enforce | No | Today `turn_logs.markdown` stores prompts, tool inputs and results, memory tool inputs included (`generation.ts:1237-1243`, `turnLog.ts`). New Stage 13 tables are specified ids/hashes only (judge explanations not stored), so they are built correctly from day one; nothing built now depends on the old turn log. | n/a (new tables follow the spec; the old log is removed at Phase 5). |
| D-G3-08 | OTel: `gen_ai.evaluation.result` names, India-hosted traces per step/helper (Stage 10 deferred list, Stage 17), validation actions exported as metrics without content, retrieval alerts (degraded mode, L-21) | Stage 13 checkpoint doc-sync Stage 17; Stage 12 L-21 | OTel | No | No telemetry package (`backend/package.json`: no OpenTelemetry); `logger.ts` only. | n/a |
| D-G3-09 | Terraform / hosting for items built in these stages: pgvector / pg_textsearch extension flags on Cloud SQL (Stage 12 L-04/L-10), Vertex Ranking API IAM + `global` access (L-14), usercontent origin host + DNS + COOP/headers (Stage 14 D-10, D-30), ALB idle timeout / SSE settings (D-26, LV-25/111), Cloud Run `--no-cpu-throttling` (ADR-0009) | Stage 12 doc-syncs 2026-10-05/06; Stage 14 doc-syncs 2026-10-06/07 | Terraform | No | Local dev uses `docker compose` Postgres 16 (`CLAUDE.md` commands); extension availability in the compose and CI Postgres image is an app-side prerequisite for stage-12 Option A and is noted there, not deferred. | n/a |
| D-G3-10 | Per-company search caps, timeouts, separate retrieval DB pool (`statement_timeout` retrieval 2 s, N-45), upload-embedding low-priority lane via Cloud Tasks, off-peak CONCURRENTLY index builds (Stage 12 L-23, L-04 lane) | Stage 12 Step 9 | company/tenancy, Cloud Tasks | No | Single pool (`config/numbers.ts:69-71` `DB_POOL_MAX` 10); embeddings do not exist yet (stage-12 L-04). An in-process queue is enough until Cloud Tasks exists. | n/a |
| D-G3-11 | Admin and ops consoles, destructive admin UX (Stage 14 D-15/D-16: RN21, RN22, RN23), company-only share default, Report moderation queue (RN19/SHG11 target) | Stage 14 checkpoint RD-11, RD-12 | company/tenancy, roles | No | No company/roles (header fact); the user-facing Report link on shares is app-side and is in `stage-14.md` D-23, not deferred. | n/a |

Items raised now: D-G3-01 and D-G3-02 (both are "built now, expensive to change later"). All others: no.


---

# G4 — from `_parts/deferred-g4.md`


Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Paths relative to `D:\arcnave-tech`. These items are not bucketed
(owner rule 2026-10-15, ADR-0053 decision 3 and 7, ADR-0061 decision 4). "Raise now" = skipping the item now would force a
later rewrite of something built now. Cost = effort of the later change if it is skipped (S = under a day, M = days, L = weeks).

| Id | Locked line (stage) | Why deferred | Raise now? | Evidence (repo today) | Cost if skipped |
|---|---|---|---|---|---|
| DF-1 | NO_CONTENT enforce: OD-2 attribute allowlist, CI field-name test, log field allowlist, Error Reporting with sanitised exceptions (Stage 17 OD-2, doc-syncs 2026-10-04, -08, -10) | ADR-0053 #7: enforce in Phase 5; CLAUDE.md "Logging target" keeps it shadow-only | Partly yes: (a) the gateway/ledger code that Stage 15 forces us to write now must log through one content-free helper from its first line; (b) see DF-2 | about 39 of 65 logger call sites (counted per line) are flagged C in `evidence-g4.md` (c); only `app.ts:175` uses `errorLogFields` (`errorLog.ts:47-65`); shadow test `test/contentLeak.test.ts` covers the happy path only (header :10-23) | (a) S now vs M later, because new retry/fallback/breaker code would carry its own `{err}` sites; the rest of the enforce work stays Phase 5 (M) |
| DF-2 | OD-2 URL rule: no user content in a URL path or query string (Stage 17 doc-sync 2026-10-04) | Part of NO_CONTENT | Yes | `GET /v1/chats?q=` (`routes/chats.ts:202`), `GET /v1/artifacts?q=` (`routes/artifacts.ts:82`), `GET /v1/projects?q=` (`routes/projects.ts:109`) put search text in the query string; Cloud Run writes request URLs to its own logs | S-M now (3 routes, their frontend callers, tests, `docs/openapi.json`); the cost grows with every new client (Android app) that calls them |
| DF-3 | OTel SDK + Collector sidecar, traces, custom metrics, sampling, latency clocks as spans/metrics (OD-1, OD-4, OD-7, OD-8 as metrics, OD-16 dashboards) | Owner list: OTel | No | no OpenTelemetry dependency in `backend/package.json`; no `/telemetry` handler | M later; nothing built now depends on it |
| DF-4 | OD-3 HMAC-SHA256 pseudonymous user/company ids in telemetry | Tied to OTel/NO_CONTENT | No | raw `userId` is logged at `services/generation.ts:701` | S later |
| DF-5 | OD-5 log buckets/retention (security-audit 400 d + Bucket Lock, Data Access logs, folder log location), OD-9 SLOs and burn-rate alerts, OD-10 PagerDuty/Slack, OD-11 uptime checks + status page, N-51..N-56 | Terraform / ops | No | no Terraform in repo; `/healthz` and `/readyz` exist (`routes/health.ts:20,43`) | M later, ops-side |
| DF-6 | OD-6 `audit_event` table (RLS, append-only role, daily hash chain, `security-audit` mirror), "audit write failure -> serve turn + `audit_pending`" | company/tenancy + roles | No | no audit table in `db/schema.ts`; users keyed by e-mail (`schema.ts:39-52`) | M later (port `arcnave.in:backend/packages/db/src/arcnave_db/audit.py`); a nullable `company_hash` column avoids a retrofit of the table shape but the table does not exist yet |
| DF-7 | SD-4 / SE7 tenant isolation: FORCE RLS, `SET LOCAL` tenant per transaction, composite keys company_id-first, pgTAP suite; ER-6 per-role pools/timeouts (retrieval 2 s, executor 30 s) | company/tenancy, RLS, roles | No (see note) | every table keys on `user_id` (`schema.ts`, e.g. `usage_records` :596, `usage_counters` :654, `turn_logs` :520); no role column | M-L later. Note for the new tables of Stages 15-18 (per-call ledger rows, price book, audit): key them by `user_id` like today so `company_id` can be added with a default; no `company_id` needed now |
| DF-8 | Roles owner/admin/user, TOTP required for owner + admin, absolute 24 h admin session, re-authentication window (SD-1, SE3, N-49 owner/admin parts) | roles | No | no role column (`schema.ts:39-52`); no TOTP | M later |
| DF-9 | Company pools and quotas: N-30 pool 5,000 turns (+5,000 boost), Deep <= 10 %/user, N-18 search 1,000/company/month, N-11 OCR 5,000 pages, N-19 Research 5 runs, N-20 20 long tasks, N-29 Claude add-on pool (ADR-0053 #6 drops the per-company Claude switch), N-64 | company pools | No | budgets are per user and in tokens (`usage_counters` `schema.ts:650-664`, `services/usage.ts:258-291`) | M later; per-user budgets stay the only cap now (owner decision, ADR-0053 #6) |
| DF-10 | Redis: ER-5 degraded mode, N-46/N-48 Redis numbers, distributed rate limits, `limits` library, stream relay (N-24 Redis retention) | Redis | No | rate limit is `@fastify/rate-limit` in memory (`app.ts:93-101`); run state is in process (`activeRuns`, `runHub`, `routes/chats.ts:565-583`) | M later; correct while there is one instance |
| DF-11 | Cloud Tasks / Executor: ER-7, N-44, AS-D3 (one retry from checkpoint), ER-3 "partial tool_use/thinking -> restart that step from the checkpoint", ER-4 SIGTERM flush + resume, Research job retry from checkpoint (EH25), turn 15 min Executor request | Cloud Tasks | No | the turn runs in the API process inside the request that created it (`routes/chats.ts:585-659`) | L later. In-process equivalent for now: the tool-loop rounds are the only restart points; see stage-15.md ER-2b/ER-3 |
| DF-12 | Terraform-side controls: FD-10 layers 2-3 (alert budgets, spend-cap budgets), FD-29 budgets, FD-28 Data Access logs, FD-30/FD-35 NAT, Cloud Armor CRS, ingress internal + LB, Binary Authorization, SCC, pgAudit `ddl,role`, Cloud SQL flags (`log_error_verbosity=terse`, `log_parameter_max_length=0`), Memorystore slowlog, DR to Delhi (SD-12), `ENCRYPTED_ONLY` | Terraform | No | none in repo | not a rewrite; new infra |
| DF-13 | SD-3 reCAPTCHA Enterprise on e-mail code and Google sign-in; Cloud Armor edge limits (N-01 edge 600/IP) | Phase 5 per ADR-0056 table | No | none | S later |
| DF-14 | SD-5 per-company encryption, SD-15 DLP, SE21 sector addenda, SD-13 `legal_hold`, SD-14 grievance/ToS text, SD-12 runbooks and drills (N-49 drills 2/year), LW-22..LW-38 lawyer items | Later / legal / ops | No | none | not code |
| DF-15 | `turn_logs` (ADR-0050) holds user message, reply, thought summary, tool inputs/results and error text (`services/turnLog.ts:168-233`); stays until Phase 5 (ADR-0053 #7) | NO_CONTENT enforce | No | `db/schema.ts:516-525`; owner-only download route `routes/chats.ts:743-771`; deleted with the message (cascade :517-519); no separate retention | S to drop later (table, route, button, test); no rewrite risk |
| DF-16 | Model Armor shadow trial (SD-8), billing-export reconciliation job and drift alert N-57 2 % (OD-12), monthly price-book review job (CD-15), Locust load tests (OD-17), chaos tests ER-15 | infra / ops | No | none | not code |
| DF-17 | ER-12 incident banner fed by Service Health API poll; free public status page (OD-11) | infra / ops | No (the in-app banner flag itself is NEW-BUILD in stage-15.md ER-12) | none | S |


---

# G5 — from `_parts/deferred-g5.md`


Not bucketed. "Raise now" = skipping it forces a rewrite of something built now. Auditor model: Sonnet 5.5.

| Id | Locked line | Why deferred | Raise now? | Evidence | Cost if raised / if skipped |
|---|---|---|---|---|---|
| ID-1, ID-3 | Folder org policies, VPC, subnets, PGA, firewall tags | Terraform | No | Repo has no `infra/` (searched `**/*.tf`, none; only `docs/deploy/*.md` gcloud notes) | Skipping costs nothing in code. |
| ID-5 / VS-11 / N-48 | Memorystore Redis, redis-py | Redis | **Yes, interface only** | Run hub, rate limits and stream buffer are in-process: `backend/src/services/runHub.ts:17-20`, `backend/src/app.ts:93-101`, `backend/src/container.ts:68` | Put the run hub behind a small store interface (Py ADR-0011 `StreamStore`) when the executor is touched: M. Later rewrite of `runHub` + `chats.ts` SSE route if not: M-L. No Redis client needed now. |
| ID-4 (IAM DB login, connector), N-66 pools | Cloud SQL IAM auth, per-role logins | Roles / Terraform | No | `DATABASE_URL` carries a password (`backend/src/config.ts:97`); socket host option `:107` | Config-only change later. |
| ID-6 / N-65 / N-25 / N-23 | Per-service Cloud Run sizing, min instances | Cloud Run layout | No | Only sandbox sizing in `docs/deploy/warm-sandbox.md:43-44` | None in code. |
| ID-8 (ALB, DNS, certs, DNSSEC) | Global external ALB, hosts, CAA | Terraform | No (code parts bucketed in stage-19) | - | - |
| ID-9, N-01 edge 600/min | Cloud Armor CRS, rate limits per IP / user | Terraform | No | App-level limiter exists (`app.ts:93-101`, `config.ts:366-371`) | - |
| ID-10 | One runtime SA per service, custom Vertex role | Terraform / roles | No | - | - |
| ID-11 | Global secrets, volume mounts, rotation | Terraform | No (key vs WIF is an owner question, see stage-19 section 5) | `ANTHROPIC_API_KEY` env `config.ts:122`; `COOKIE_SECRET` `:88` | - |
| ID-12 (Cloud Deploy canary, WIF, attestation, Binary Authorization) | Deploy pipeline | Terraform / CI infra | No | Deploy is a Cloud Build trigger outside the repo (`.github/workflows/ci.yml:2-3`) | - |
| ID-13 (migrator SA, DDL role, advisory lock, migration job) | DDL role split | Roles / RLS | No for the role split; **the fail-closed part is bucketed** (stage-19 S19-13) | `backend/Dockerfile:69` swallows failure; `backend/src/db/migrate.ts:17-27` uses a dedicated connection | Role split later: S-M. |
| ID-14 | Terraform modules, state, drift plan | Terraform | No | - | - |
| ID-15 | Backups asia-south2, PITR, Delhi DR runbook, Gemini OCR fallback, DB-polling dispatch | Terraform / Cloud Tasks | No | - | - |
| ID-16 (Cloud Scheduler, Cloud Tasks, Pub/Sub for rotation and budgets) | Scheduler `Asia/Kolkata`, queues | Cloud Tasks | No | In-process timers `backend/src/index.ts:15-58` | When a worker exists: M. |
| ID-17 | Quota raises before launch | Ops / Terraform | No | - | - |
| R-4 (ops console on IAP), R-8 VPC-SC for isolated project | Ops host, perimeter | Company / roles, Terraform | No | - | - |
| Doc-sync 2026-10-03 ... 2026-10-13 dev-infra lines (ADR-0008 NAT, Direct VPC sizing, CIDR plan, LV resources, mailer/SES egress, executor service, queue `turns`, Cloud SQL stop rule, FD-22/23/30) | Python-build dev environment state | Terraform / Cloud Tasks / Redis | No | - | - |
| VS-4 (`limits` + Redis token budget), VS-5 (Cloud Tasks handlers, Postgres flag table), VS-27 (Terraform, tflint, checkov), VS-28 (OTel SDK, collector), VS-31 (SBOM export of images) | Tooling that belongs to deferred infra | Redis / Cloud Tasks / Terraform / OTel | No | `@fastify/rate-limit` in-process `backend/package.json:28` | - |
| IP-7 (prod project, HA before first paying customer), IP-8 (lawyer track), IP-9 (academics later), IP-2/IP-6 (timeline, pilot) | Plan / business | Phase 5-6 | No | - | - |
| Stage 21 C1 (project id allowed in telemetry fields) | OTel resource attribute | OTel | No | No OTel in repo | - |
| N-22, N-44, N-70 (job timeout part), N-71, N-73 (Redis / lease rows), N-76 (worker, outbox, queue `background-low`) | Cloud Tasks / Postgres stream store / worker | Cloud Tasks / Redis | No | - | - |
| N-50, N-51 (partly), N-52, N-53, N-54, N-55, N-56, N-57 | Sampling, retention of log buckets, SLOs, alerts | OTel / Terraform | No | - | - |
| N-32, N-60, N-61, N-62, N-63, N-64, N-58, N-38 | HA switch, infra phases, spend caps, capacity, cost ceilings, vendor prices | Cost / Terraform | No | - | - |
| N-29, N-30 (company Claude pool, company plan), N-11 / N-18 / N-19 / N-20 per-company quotas | Company / tenancy | Tenancy | **Yes, shape only** | Usage is per user: `backend/src/db/schema.ts:102` (`monthly_token_budget`); no `company` anywhere (searched `company` in `schema.ts`: not a table) | Any new table written now (settings, price_book, quota counters) should carry a nullable `company_id` / scope column: S per table. Retrofitting every existing table later: L. Owner decided "single user first" (ADR-0053 #3); this is only a flag. |
| RLS / pgTAP suite (IP-5 gate) | Postgres RLS | RLS | No | - | - |
| NO_CONTENT enforce (Stage 17), N-52 | Enforce in Phase 5 | NO_CONTENT enforce | **Partly done**: the shadow test exists (`backend/src/test/contentLeak.test.ts`, per `docs/architecture/Build-arcnave-tech/tech-p1.md` result row E); request logging is still on (see stage-20 VS-2 row) | - | - |

### Raise-now list (short)
1. Run-hub store interface (ID-5 row) - only if the turn runner / `generation.ts` is refactored in the same window.
2. `company_id` / scope column on any new settings, price_book or counter table (N-29 / N-30 row).
Everything else can wait without forcing a rewrite of code written now.


---

# D3 — owner-deferred infra (copied from `D3-architecture.md` §4)


Named here only; not bucketed. For each: does building around it now force a later rewrite of
something built now? Evidence is for the repo as it is; "no" assumes the picks in section 3 are followed.

| Deferred item | Needed by | Forces a rewrite later? | What to do now so it does not |
|---|---|---|---|
| Redis stream relay (Stage 4 L-3, Stage 5 F2, ER-5) | Reattach across instances (A-01) | **No**, if `RunHub` stays the only publish and replay seam and event ids stay monotonic integers (they are: `runHub.ts:44-53`, SSE `id` at `chats.ts:828`). **Yes**, if more code reads `activeRuns` (readers today: `chats.ts:430,446,565,568,656,707,709`, `account.ts:97,104`, `index.ts:71`). | Fold `activeRuns` into the DB lease (A-01 pick A); add no new `activeRuns` reader. |
| Redis locks (R13 lease plus fencing) | One run per chat across instances | **No**: ER-5 says DB fencing decides commits even with Redis. The DB lease in A-01 is that layer. | Build the lease row and the conditional claim now. |
| Redis rate-limit store | Per-user limits across instances | **No**: `@fastify/rate-limit` takes a `redis` option. | Fix the key and `trustProxy` now (A-09). |
| Cloud Tasks Turn Executor (O-3, AO-4, ER-4, ER-7) | Turn runs outside the API request | **Yes, partly**: the run's inputs exist only in the request (`chats.ts:570-626`: `codeExecution`, `effort`, `styleId`, `modelAlias`, attachment refs) and in memory; a delivery on another instance could not rebuild them. **No** once the turn parameters are stored. | Persist the turn parameters (a JSON column on the assistant row or `turns`) in `appendTurn`; make `GenerationService.run` loadable from a message id. Both sit inside A-01 and A-13. |
| Checkpoint resume (AS-D3, ER-3 continuation) | Resume after SIGTERM or crash | **No** if A-02 flushes text and tool calls stay persisted per call (`generation.ts:992`). | Throttled text flush (A-02). |
| Cloud Tasks for file and OCR jobs, worker, DB-polling dispatch (ER-7, Stage 19 ID-15/16) | Upload and index outside the request | **Yes, mildly**: `finishUpload` takes a Fastify `request` (`files.ts:501-506`) and `runIndex` is also request-bound, so neither can be called from a worker. | Make both pure functions of (stored object, row) now; add the jobs table with a polling loop (A-20 option B), which is the Delhi fallback and not throwaway. |
| Company and tenancy, RLS context (owner-deferred, not infra) | `SET LOCAL` company on every query | **Yes**: the schema has no `company_id` (`schema.ts`, 0 matches); `uq_usage_period`, `uq_memory_user_scope_key` and `uq_idempotency` start with `user_id` where D15 wants `company_id` first; and every query runs on the shared pool or on a `getDb()` singleton (A-16). | Stop adding `getDb()` call sites; inject `DbLike` (as `copyMessages` already does, `chats.ts:1031`); add no new unique key without room for a leading column. |
| NO_CONTENT enforce, OTel, Terraform | Phase 5 | Not forced by anything found. Note for the owner: 35 `{ err }` log calls (A-23) and `String(err)` logging of provider errors (A-07) are the enforce-time work. | Nothing now. |



---

## Deferred by tech-build.3 (2026-10-16)

Added by the build task, not by the audit. Each line names the part that deferred it; the reasons
are in [build-3-result.md](../build-3-result.md) and the ADR named.

**Part A — gateway (ADR-0072)**

- D2 X-4 option B (replay non-native tool history as a structured user-side note instead of
  assistant prose) — not built by owner decision (tech-build.3); option A guard stays.
- Stage 15 ER-2b continuation — resume a turn from the failed tool round instead of ending it
  partial; needs per-round checkpoint state (Phase 5 executor, ER-3e). ADR-0072 §4.
- D2 CC4 / MR10 across turns — persist Claude thinking / redacted_thinking blocks with signatures
  (needs a `messages` column; additive migration) so prior turns replay them; in-loop replay done.
- Compaction transcript (`services/compaction/autoCompact.ts`) still carries failed exchanges and
  the `[Response stopped]` placeholder; align with ADR-0072 §3.

**Part B — security and platform (ADR-0065)**

- PH-4 / S21-11 (frontend): remove the project-numbered fallback API URL from
  `arcnave-frontend/src/api.ts`; prerequisite: owner sets `VITE_API_BASE` in the Cloudflare Workers
  Build variables (and CI's frontend build env). Then extend `identifierGuard.test.ts` to
  `arcnave-frontend/src`.
- SE10 COOP/CORP on the web host: try `Cross-Origin-Opener-Policy: same-origin-allow-popups` with a
  live Google sign-in; CORP `same-site` on static assets.
- PH-2 / INJ-2: enforce the CSP after the report-only run is clean; srcdoc visuals inherit the
  parent CSP, so they need their own origin or explicit allowances first.
- A-08 option B / TD-3: separate fetch service with a zero-permission service account (infra).
- ID-13 shape: migrator as a Cloud Run Job / build step before traffic shifts; N-70 lock_timeout
  5 s / statement_timeout 300 s in the migration transaction.
- A-09 option B: shared rate-limit store (Redis) so the per-user limit holds across instances.
- SD-1d: logout-all route (the Origin check covers it when it is added).

**Part D — file pipeline review fixes (ADR-0066)**

- D0c: the documents upload limit 500 → 100 MB (N-10 says documents 100 MB) awaits the owner's
  explicit OK; unchanged.
- D0c: `FILE_JOB_LEASE_MS` stays 15 min until the owner decides (ADR-0063 Decision 2).
- D6: a lapsed lease consumes an attempt: when a heartbeat is starved (request-based CPU) and the
  lease lapses, the next claim counts `attempts + 1`, so a healthy-but-starved job can burn its
  N-44 attempts and end `timeout`. Fix candidates: do not count a takeover of a job whose stage
  advanced recently, or `--no-cpu-throttling`.
- D6: synchronous reads inside a request (multipart `POST /files`, `FILE_PIPELINE=sync`) are not
  counted by the one-large-job-per-instance limit.
- D3: `routes/projects.ts` project upload / replace still insert the row and enqueue its job in two
  statements; the poll-time orphan reconcile covers a crash between them.
- D1: consider ffmpeg/ffprobe `-format_whitelist` (demuxer allow-list per declared type) as further
  hardening (ours; not built).

**Code review of tech-build.3 (MINOR findings not fixed; [build-3-review.md](../build-3-review.md))**

- CR2: `appendTurn` (`services/turn/turnStart.ts`) takes `max(seq)` without a lock; two concurrent
  sends on one chat can hit `uq_message_seq` (500 instead of `run_in_progress`). Pre-existing,
  moved verbatim; P08 A-03 (DB lease, one run per chat).
- R1#6: a partial turn's ledger row has `EMPTY_USAGE` (exact false) though its tool rounds were
  billed; needs per-round usage surfaced before an adapter throws.
- R1#11: `batch6OverflowStreamingSafety.test.ts` tests a hand copy of the retry loop; point it at
  `services/turn/providerLoop.ts` `streamWithRetry`.
- R2#1: behind the planned global external ALB (Stage 19 ID-8) the API sees two appended
  X-Forwarded-For entries; set `TRUST_PROXY_HOPS=2` when the ALB fronts the service.
- R2#3: `backend/src/scripts` (compiled into `dist/`) still carries project identifiers; extend the
  identifier guard to scripts once they read config, or stop compiling scripts into the image.
- R2#4: 401/403 rejections from the Origin and auth hooks are not counted by the rate limiter.
- R2#5: the hop trust also takes `X-Forwarded-Host` / `X-Forwarded-Proto` from the client; nothing
  reads `request.host` / `hostname` / `protocol` today — keep it that way or override them.
- R2#7: the `<script` strip regex in `webFetch.ts` is super-linear on unclosed tags; with the 5 MB
  cap the worst case is ~25× the old one.
- R2#9: nginx (compose) adds the web header set to proxied `/v1` responses that already carry the
  API set (duplicate Referrer-Policy / Permissions-Policy / CSP-RO).
- R2#11: `migrate.integration.test.ts` "exits non-zero" passes on any non-zero exit; assert the
  `migration failed` log line too.
- R3#6: `POST /files/from-project` downloads a project PDF to count pages outside the large-job slot.
- R3#7: the ZIP pre-flight pass inflates on the API process event loop; move it into the parser
  child (P19).
- R3#10: `tools/execution/executionRuntime.ts` host fallback (non-production, `ALLOW_HOST_CLI=true`)
  runs poppler with the inherited environment; route it through `runTool`.
- CR2-5: "a chat ZIP archive job is large" is decided in SQL (`fileJobs.ts`) apart from the
  pipeline's expand rule, and makes a small fast-lane ZIP wait behind a running large job; store a
  `large` flag on the job at enqueue.
- CR2-8: `loadHistory` runs two attachments queries per turn; load once and derive both.
- CR2-9: `safeFetch.ts` `prefix()` duplicates `bytes()`; one reader with a refuse/truncate mode.
- R4#3: an errored answer that ran tools goes back to the model as an ordinary turn; a replay note
  ("this answer failed before it finished") is ours and changes the payload — decide with P03's eval.

**Part C — turn split (ADR-0067); found in the characterization snapshots, not changed (moves only)**

- `services/turn/turnStart.ts` `loadTurnAttachments`: no `ORDER BY`, so a message with several
  files sends them in the database's row order, which can change between runs. Order by the
  request's `attachmentIds` or `createdAt` (prompt cache, reproducibility). P07/P08.
- `appendTurn`: an `attachmentId` the caller does not own is skipped without an error; the turn
  runs as if the file was never sent. Decide 404 `not_found`. P08.
- The Claude wire labels a 30-byte text file "Excerpts … The file is too large to send whole"
  while the fake-provider request says `wholeWithinBudget: true`; check the label's condition in
  the Claude adapter.
- `mapProviderError`: an unused `const api = new ApiError('provider_payload_limit')`.
- D3 `streamAndCollect` / `settleTurn` extraction from `runTurn`: not a mechanical move; P07/P08.

---

# tech-build.3-fix — not fixed in this task (2026-10-16)

Source: the three review rounds in [../build-3-fix-review.md](../build-3-fix-review.md) and the
workers' notes folded into [../build-3-fix-result.md](../build-3-fix-result.md). Every line is
MINOR or NIT (no BLOCKER/MAJOR is open); the reason it waits is given.

**Pre-existing, rated MINOR by main (reviewer said MAJOR)**

- F16 / R-B r1: the ZIP pre-flight judges central-directory names and sizes, the parser (fflate
  streaming `Unzip` in officeparser) reads local headers, so a renamed, hidden or data-descriptor
  entry skips the DTD scan and the real-byte count. Not exploitable today: xmldom 0.9.12 expands
  only its fixed entity map (`sax.js` `entityReplacer`, `dom-parser.js:228`), SheetJS and ExcelJS
  (saxes) expand no declared entity, the parse runs in a limited child. Fix: run fflate `Unzip`
  over the same bytes in the pre-flight and refuse unless its (name, size) list equals the central
  directory's. P19.

**Sandbox (decision #14 follow-ups)**

- With `SANDBOX_SIGNING_SA` set, a signing failure is still swallowed (`catch {}` around
  `generateV4SignedUrl` for inputs and outputs), and the input-staging loop's catch drops the rest
  of the inputs on a GCS `save` / `stat` error: the same silent-loss class. Suggested fix (review
  r3): after staging, fail typed if any staged input has no URL or any expected output has no PUT
  URL. Needs its own retry/typing decision for transient IAM errors.
- A reloaded transcript does not keep a tool call's `errorCode` (no `tool_calls` column); needs a
  migration and the history DTO.
- Skill-script runs (`executionRuntime.ts runSkillScriptJson`, no production caller) drop the code
  and get the chat-oriented message.
- `materializeChatFiles` downloads every chat file before a refusal that is certain; decide the
  refusal once at the toolset level, and stop the manifest saying the files are on the computer.
- The guard checks `stagingBucket` alone; a client built with a bucket but no `storageClient`
  (tests only; `withAdc` always builds one) would send inputs inline and is refused anyway.
- `validateOutputFilenames` and the semaphore's capacity error come before the misconfig error
  (one extra round for the model).
- The user copy is hand-copied in `errors.ts` and `arcnave-frontend/src/api.ts`; no test checks
  they match.

**File jobs**

- A ZIP can defer once for nothing when `claim()` holds `activeLarge` during its query; costs one
  re-download and re-scan; bounded (at most one deferral).
- A ZIP that defers is downloaded, hashed and scanned twice; read its directory by range, or decide
  "large" at `complete`.
- `countedNormal` could be derived (`lane !== 'fast' || large`); kept explicit (NIT).

**Names (ADR-0069 follow-ups)**

- Sheet names: the `## Sheet: …` line inside chunk text and the `[label]` prefix of the whole-file
  markdown (`derive.ts:87,91`, `pipeline.ts:422`), and `retrieval.ts:208` `--- sheet ---` in
  project files, are raw. They sit inside file content (explain F12): fence file content first
  (P07), then neutralise structural lines.
- Tool results stored before this change replay raw names once (ADR-0069 Consequences).
- `documentTitle` trims; other sites keep a leading/trailing space; a name of only dropped
  characters shows `""` in page labels and the manifest (NIT).
- The lookalike set is ours; check against Unicode `confusables.txt` (not reachable from the
  container). Known misses: U+FFE8, U+05C0, U+2016 (bar); U+301D–301F, U+3003, U+05F4, U+275D/275E
  (quote).
- `retrieval.ts extractHtmlTable` regexes are quadratic, but run only in the isolated extractor
  child (wall-clock limited).
- `gemini.ts:136` compiles a model-supplied tool name into a RegExp unescaped.
- `cloudRunSandboxClient.ts:53,59,65` repeat a sandbox-made output name raw in errors the model sees.
- `zipExpand.ts:75` puts a member name raw into a user-facing failure detail (not model-visible).

**web_fetch**

- Only four entities decoded, `&amp;lt;` double-decodes to `<` (old behaviour, kept for the
  goldens); the title's entities are not decoded.
- `content.slice(0, maxChars)` can split a surrogate pair.
- `pageTitle` scans raw HTML, so a `<title>` inside a comment wins; `--!>` does not end a comment;
  `<style title="</style>">` leaks `">css` (NITs).
- The 13 × 5 MB adversarial inputs are built at module load (~100 MB held by the test file); the
  bound stays 2 s as the brief set it.

**Audio**

- The one retry is immediate and `readMedia` drops `retryAfterMs`; Stage 15 ER-2 / N-42 asks for
  backoff with jitter and honouring Retry-After (pre-existing). P11.

**Brand guard (F17)**

- `brandNeutral.test.ts` checks wording that describes the product as another assistant, not
  provider names in comments of non-provider launch files (24 files name a provider today, many
  legitimately). Needs a per-file allowlist decision.

**Untouched findings from explain.3** — F7 (safeFetch timer tests), F19 (old ODT `manifest.xml`
PUBLIC DOCTYPE refused): not in this task's items.

---

## tech-p05 — found while splitting `runTurn`, not fixed (behaviour-neutral task, ADR-0073)

Lines are on `build/turn-split` after the split; the pre-split line (`generation.ts` at `b448929`)
is in brackets. Each is old behaviour the split kept on purpose.

- **Reservation kept on a throw before the stream** — `turn/turnContext.ts:167` reserves; a throw
  in `buildToolExecutors`, `useNormalisedImages`, `hydrateAttachmentBytes` /
  `hydrateHistoryAttachments`, `applyFileBudget`, `applyManyImagesRule`, `chatFilesOf` or
  `previousContextTokensOf` (`turnContext.ts:180-260`) reaches runTurn's outer catch
  (`generation.ts:228`) with the reservation held; only `limitToModel` is handed the release
  (`turn/contextAttachments.ts:181-183`). [old `:392-510`, `:895`] Raised by review gate 0,
  `/code-review`, R-A, R-B. P08 (reservations get an owner and an expiry, A-05/A-06).
- **The forced answer bypasses the retry wrapper and runs unreserved** — `turn/forcedAnswer.ts:48`
  calls `provider.stream` directly, not `streamWithRetry`, after `streamAndCollect`'s `finally`
  released the reservation (`turn/streamAndCollect.ts:274-276`). A transient 429/5xx becomes
  `empty_response`; the second billed request is not reserved. [old `:786`, `:761-763`] P11 / P08.
- **A stop or the deadline during the forced answer is saved as `empty_response`** —
  `forcedAnswer.ts:72-80` logs any synthesis failure and falls to `empty_response`
  (`:82-93`), so the row is `error`, not `stopped` / `turn_deadline_exceeded`. Pinned by scenario
  (8d). [old `:810-831`] P11.
- **A failure after `start` outside the stream writes no usage row** — e.g. `limitToModel`
  refusing: the outer catch rethrows and the route marks the row failed; no `usage.record`.
  Pinned by scenario (L). [old `:895-900`] P08.
- **Rejected after checking:** `/code-review` said `AnswerProtocolGuard.finish()` keeps
  `codeDelimiter`, so an open fence from the first stream would hide `[Tool call]` in the forced
  answer. Not reachable: the forced answer runs only when the collected text trims empty, and any
  fence character is kept in that text (`answerProtocolGuard.ts:14` holds a bare fence back, `finish()` at `:34-37` returns it).
- **Not covered by a scenario** (the split moved this code verbatim; a mistake there would not be
  caught): a stop or deadline during `compactStage`; a deadline during the forced answer; a throw
  from `finalise` / `usage.record` after yields; the answer guard's tail flush
  (`streamAndCollect.ts:190-196`, `:219-225`); draft ids after earlier tool calls
  (`streamAndCollect.ts:111`); the order of `finalise` against release / record; log text.
- **Cleanups proposed by `/code-review`, not done (not moves):** `addSegment` and the tail flush
  into `turnState.ts`; `listSkills` computed twice (`turnContext.ts:126`, `:285`); history and
  current attachment hydration in parallel (`turnContext.ts:205`, a timing change); one exported
  project row type.

## tech-p07 — v3 prompt and Auto routing: left open, with the reason (ADR-0075, ADR-0076)

- **Silent fallback of a manual pick (Invariant 1).** `backend/src/services/turn/modelRouting.ts:56`:
  a picked model that is disabled or unavailable is answered by Auto (Gemini) with a log line only;
  no machine-readable fallback reason, no "Answered by X because Y was unavailable" label (RT-5,
  7.12). Behaviour design → P11 (Prompt 5).
- **`routingPreference` column and request field.** Accepted and ignored, not read, not returned.
  Drop the field and the `preferences.routing_preference` column together, in one migration, once
  no client sends it.
- **Gemini 3.8 Flash knowledge cutoff.** The Google model pages could not be reached from the build
  sandbox (DNS / proxy 403); `knowledgeCutoff: null`, so `<model_info>` has no cutoff for Gemini.
  Read the Vertex model page and set it in `backend/src/providers/capabilitiesTable.ts` (Stage 7.9
  says Mar 2026, unverified).
- **Gemini explicit cache (stage ADR-0004 / FD-26).** Not built in this repo; the system instruction
  is now the stable text only (no user, memory or date text), so it can be cached as the stage
  designed. Decide with the token count (minimum 4,096) when Prompt 6 shrinks the tool declarations.
- **`<memory_snapshot>` size.** Capped in characters (`MEMORY_CONTEXT_MAX_CHARS`, per part), not at
  N-17's 1.5k tokens: there is no estimator (Invariant 3). An exact count needs the provider.
- **Dormant v3 rules** (prompt text present, feature not built): typed citations (P15/P16),
  `<pending_operations>` + status tool (P08/P13), `<retrieval_status>` + typed `<documents>` (P20),
  `<company_instructions>` (Phase 5), sensitive-memory opt-in, `load_skill` (Prompt 6). Table in
  [`p07-result.md`](../p07-result.md).
- **Transitional pieces Prompt 6 removes:** the tool-name map (→ identity) and the product-tools
  appendix (`backend/prompts/system/v3/appendix-product-tools.md`).
- **Owner decisions** (listed in `p07-result.md`): past-chat tools vs v3 LM-1; "Google Search
  grounding" wording in the Gemini rendering; `skill_loader` off while skills are read with `view`;
  Auto keeping a manually picked Sonnet/Opus for later turns (stage silent).
- **Review round 1 minors left:** the math normaliser does not protect indented code blocks, does
  not convert `\(` … `\\)` (a closer after an escaped backslash), and `$5 … \(x\)` pairs the price's
  `$` with the converted math; `promptVersion` hashes the prompt files only, not the assembly code;
  the P07 eval-runner test greps the runner's source (the runner cannot run in tests).
- **Review round 2 limits (ours, accepted):** the reserved-tag list matches the rendered lowercase
  names only, so `<CURRENT_TIME>` in pasted text is left as written (a different tag to a parser;
  the model could still read it as the block); the stage's `<profile>` is not on the list (it is
  ordinary code in XML and Maven files). Escaping all user text (the spec's wording) would close
  both and change pasted code; revisit with Prompt 6's input fencing. `arr\[i-1\]` (a hyphen next to
  a digit) still renders as math: telling it from `\[x-1\]` needs more than one character's context.
- **Live checks not run** (owner-run): `npm run eval:prompt` on the branch, and
  [`p07-live-checklist.md`](../p07-live-checklist.md) after the merge.

## tech-p03 — found while building the quality measurement harness, not fixed (measurement-only task, ADR-0074)

P03 measures; it changes no prompt, tool, routing or gateway behaviour. Each item below was seen and
left. The prompt gaps the offline gates found are in `backend/evals/prompt-kit/offlineGates.ts`
(`EXPECTED_GAPS`, 34 case/requirement pairs, each with its reason) and in
[`p03-result.md`](../p03-result.md); they are P07 / P10 work, not repeated here.

- **Stale live scripts (X-6), not repaired.** `backend/src/scripts/` (the scripts live under `src/`,
  not `backend/scripts/`). Seven were repaired (one-line `P03 (X-6) repaired:` header). The rest:
  - `runBehaviorEvaluation.ts`, `runReliabilityMatrix.ts` — **deleted in tech-p07**: both were built on the legacy prompt builder P07 removed (ADR-0075); `npm run eval:prompt` replaces them.
  - `testBatch6RehydrationLive.ts` — stale: describes the removed in-memory tool registry (LOAD_SKILL / SEARCH_TOOLS) and the `inspectPdf` tool.
  - `testCloudRunDirect.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `testDynamicOutput.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `testNetworkEgress.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `testSaDenied.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `testSignedUrls.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `testTokenAuthority.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `testUnshare.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `verifyBatch22Live.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `verifyBatch24Live.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - `verifyBatch2Live.ts` — stale: hard-coded project, bucket and service-account identifiers (outside the identifier guard, which skips scripts).
  - Unverified (no stale marker found by reading, never run): `evalScope.ts`, `testBatch6ContextPressureLive.ts`, `verifyBatch6OverflowLive.ts`, `verifyRepairLoopLive.ts`. Guarded by `src/test/liveScripts.test.ts`: a new script must be classified.
  - The sandbox scripts' identifiers are a real finding: `identifierGuard.test.ts` skips `scripts/`, so a project id sits in 17 files under `src/scripts/`. Move to configuration or delete with the sandbox live-check (PH-4 follow-up).
- **A stopped answer goes back to the model as a finished one.** `services/history/failedExchanges.ts` keeps a `stopped` answer that has text (on purpose: its content is real), and the history carries it word for word with no marker; nothing in the system instruction says an earlier answer was cut. Live, Gemini 3.8 Flash continued the essay after Stop + "hai". Proved offline by `stopThenGreeting.integration.test.ts`. P07 (prompt) / P11 (stop semantics): decide between a marker on the stored turn and a rule in the prompt.
- **The live runner is not the database-backed turn.** `eval:prompt` builds the request with the deployed prompt and tool builders and runs the existing adapters' tool loop against mock tools; it does not run `runTurn` (no database, no compaction, no history loader, no file pipeline). Cases that need those (documents as attachments, document memory, company tier) run with the nearest deployed form and carry an `approximations` count. A DB-backed live runner is a later step.
- **Judge verdicts are report-only.** No calibration of the judge against human grades exists; until it does, a judge pass/fail gates nothing. Calibration set and agreement figure: not started.
- **Kit cases the deployed request cannot express** (company tier, per-format switch, pending operations, effort profile as prompt text): run approximately live and fail their offline requirement as listed gaps. Closing them is P07/P10 (and Phase 5 for the company tier).
- **No token-count budget.** Size budgets are in characters; provider-reported tokens need a live call. `eval:prompt` and `measureTokens` record the provider counts when run.

## tech-p05 wave 1 — P08 durable runs (2026-10-17, ADR-0078)

Closed by P08 (the original lines above stay as the record):
- CR2 `appendTurn` read `max(seq)` without a lock: the chat row is now locked for every send.
- Part C "a foreign `attachmentId` is skipped": now 404 `not_found`; "`loadTurnAttachments` has no ORDER BY": ordered by `array_position`.
- Review gate 0 "reservation kept on a throw between reserve and stream": the reservation has an owner and an expiry and settles in one transaction.
- Scenario (L) "a failure after `start` writes no usage row": an `exact:false` usage row is written.

Opened (not fixed in P08):
- A-21 advisory locks for the retention sweep and sandbox checkpoints; A-22 lost updates outside the turn (memory, password, PATCH, file delete). A small follow-up task.
- The `queued` turn state exists but nothing enters it until an out-of-process executor (Cloud Tasks, Phase 5).
- The forced answer still bypasses the retry wrapper. P11 (wave 2).
- A durable `turn_stream_events` table for cross-instance replay of every frame: deferred; a `snapshot` frame from the stored row is used instead.

## tech-p05 wave 2 — P22, P13, P11 (2026-10-17, ADR-0079 / 0080 / 0081)

Closed (the original lines above stay as the record): E19, OD-13 capture, TF (price table, ledger, reservation rows), F4b, P5, P11 deletion ledger, LG-1 / LG-3 (shadow), OD-8 stored (P22); CXD-5, CXD-6 (Normal), HIST-WINDOW, STAMPS, REC text, HP-TITLE, RT-2 shadow (P13); "the forced answer bypasses the retry wrapper", "a stop / deadline during the forced answer saved as `empty_response`", "a stopped answer goes back unmarked" (tech-p03), tech-p07 "silent fallback of a manual pick" (K-15) (P11); "wire P13 helper calls and P11 attempts to `recordCalls`", "`attempt` numbering from the gateway" (merge).

Opened (not fixed in wave 2):
- **Owner call:** a turn with a retried request now shows no counts and no cost (`exact:false`, cost null), because the failed request has no provider usage (Invariant 3). Counting a request rejected before its stream as exact zero needs a billing source.
- P22b: UUIDv7 + `updated_at`, TB1 columns + paging, TB8 feedback table, F4c, F8b, OD-15b telemetry, V-20 / V-21 (moved out of this run in the wave plan).
- Regenerate into a version: `POST /stop` from a tab still on the old chat does not stop the run; rows in the tab keep the old chat's ids until the end-of-run reload.
- Haiku 5.5 > 100K-token price tier has no row (helper inputs are capped at 30k); typed error for account delete when the deletion ledger is down.
- Fast / Deep profiles (P10); router intent enum (owner); N-75 estimator (OQ-08); REC wiring (P11 / P15); delete the compaction code one release after the switch; a durable queue for helper jobs (N-76 worker).
- ER-3 continuation attempt after text (Turn Executor); audio retry still immediate; research progress events not withdrawn after a hop; Gemini INVALID_ARGUMENT re-open sends a request with no ledger row; the cumulative AL-1 figure on `completed` / `partialUsage` is unread and can go; a pre-0030 `tokens_reserved` value has no reservation row and is released only when its period rolls over.

## tech-p05 wave 3 — P21 (2026-10-17, ADR-0082)

Closed: A-16, S21-10 / A-17 wiring (values unchanged), A-19, A-23, A-25, A-26, C4, B2 contract test, VS-33. The A1 identifier lines above that name `backend/src/scripts/` now apply to `backend/scripts/live/` (same 11 files, outside the image).

Opened: OQ-15 values (N-01, N-02, N-33, N-35, N-39, turn deadline; N-06 / N-74 without P10) — owner; OQ-29 OpenAPI type generator — owner; OQ-13(b) renderers vs skills — owner; default-off flags (listed in ADR-0082) — owner; S21-02 `CLAUDE.md` text proposed in ADR-0082, not written — owner; lint warnings to burn down (backend 145, frontend 18); six allowlisted `process.env` reads; `checkPrivacy` takes ~0.6 s on a 20,000-character single-token string (a pathological memory import can run for minutes, pre-existing); SSE responses now carry the rate-limit headers.

## tech-p05 review round 1 (2026-10-17, `p05-review.md`)

Deferred: `runHub` serialises each event twice (perf only); a cold count cache sends one `count_tokens` request per history exchange at once (needs a concurrency cap, else 429s null the count and skip the window / summary until warm); the `turnGate` precheck sums `usage_records`, which show 0 for a retried turn (the reservation's check on `usage_counters` enforces the budget since R2). Owner: `costUsd` null on a retried turn (billing source for a request rejected before its stream).

