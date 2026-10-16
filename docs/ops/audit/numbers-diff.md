# Numbers register sweep: N-01 ... N-77 against the repo
Sources: `docs/architecture/00-Handoff/00-numbers-register.md` (77 rows N-01..N-77, latest doc-sync lines to 2026-10-14 incl. "Task 1.11 dev run" notes), `backend/src/config/numbers.ts` (20 wired entries), `backend/src/config.ts`, literals found by grep in `backend/src` and `arcnave-frontend/src`. `.env.example` could not be read (permission denied), so env-template defaults are not checked. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Status legend: MATCH · DIFF (repo value differs; both given) · NOT-WIRED (a literal exists with no setting and no N-id comment) · ABSENT (feature not built) · N/A-deferred (infra, Cloud Tasks, Redis, OTel, tenancy, business plan; not bucketed).
"numbers.ts" = `backend/src/config/numbers.ts`; "config" = `backend/src/config.ts`. A row can carry two statuses when it holds several values.

## 1. Table
| N-id | Meaning | Register value (latest) | Repo value | Repo location | Status |
|---|---|---|---|---|---|
| N-01 | Rate limits req/min | user 20 / company 300 / edge 600 (Stage 18) | generate 20; write 120; auth 10; public share 60; company, edge: none | numbers.ts:65,67; config:366-371; `app.ts:93-101` | DIFF (write 120 vs 20); ABSENT (company, edge); auth 10 and share 60 are NOT-WIRED (no N-id) |
| N-02 | Message size | 32k chars | prompt max 100,000 chars | `routes/chats.ts:543` | DIFF + NOT-WIRED |
| N-03 | Input token budget per profile | Fast 16k / Normal 48k / Deep 200k | none; no Fast/Normal/Deep profiles (effort levels instead); compaction trigger fallback 150,000 tokens | config:313 | ABSENT |
| N-04 | Retrieval share in budget | Fast 6k / Normal 20k / Deep 80k | none | - | ABSENT |
| N-05 | Whole-file limit | 30k tokens (Deep 100k test arm) | 200,000 characters (~50k tokens) | config:171 (`PROJECT_FULL_CONTEXT_MAX_CHARS`) | DIFF + NOT-WIRED |
| N-06 | Tool steps; turn deadline | Fast 1-2 / Normal 5 / Deep 15; turn 10 min | 16 rounds; turn deadline 3,540,000 ms (59 min) | numbers.ts:39,43; config:150,206 | DIFF |
| N-07 | Per-turn caps search / run_code / fetch_url / artifacts / file_search | 1-3-8 / 1-3-8 / 2-5-10 / 3-5-10 / 1-3-6 | Anthropic web_search `max_uses: 5`; other caps none | `providers/anthropic.ts:38` | DIFF (search) + NOT-WIRED; ABSENT (others) |
| N-08 | Sandbox time / RAM / files | 60 s (Deep 120 s) / 4 GiB / <=30 MB x10, ~5 parallel per company, workspace ~500 MB | code timeout 10 s (Job), 300 s (warm); 8 GiB service; global concurrency 20; code 20 KiB | numbers.ts:51,53; config:262,266,285; `docs/deploy/warm-sandbox.md:44` | DIFF; NOT-WIRED (20 concurrent, MAX_CODE_BYTES) |
| N-09 | Tool result cap | ~8k tokens + pagination | 6,000 chars (read_project_file); 30,000 chars (run_python); preview 300 chars; web fetch 1 MB | numbers.ts:45,47; config:214; `services/webFetch.ts:42` | DIFF (unit and size); fetch 1 MB NOT-WIRED |
| N-10 | Upload limits | docs 100 MB/1,000 pp, XLSX 50 MB, images 20 MB, audio 500 MB/3 h, ZIP 100 MB/20 files/500 MB, <=10 files/msg, <=20/chat | project files 30 MB; chat attachment cap 500 MB (single cap); PDF 1,000 pages; image 10 MB / 8,000 px; 20 files per chat; 10 attachments per message | numbers.ts:57,59; `services/attachments/processUpload.ts:29-37`; `routes/chats.ts:546` | MATCH (1,000 pp; 20/chat; 10/msg); DIFF (image 10 MB vs 20, XLSX 50 MB not per type, ZIP none, audio 3 h none); NOT-WIRED (FILE_LIMITS, chats.ts:546) |
| N-11 | Upload quotas (per-user rate, OCR pages, audio minutes) | 50/user/day, OCR 5,000 pp/company/month (+5,000), audio 120 min/user/month | none | - | ABSENT |
| N-12 | Mic max length | 2 min | browser recognition, no cap found | `arcnave-frontend/src/Dictation.tsx:44` | ABSENT |
| N-13 | Page images to model | Fast 3 / Normal 8 / Deep 20 | PDF read visually up to 100 pages | `processUpload.ts:33` | DIFF + NOT-WIRED |
| N-14 | Chunk size / overlap | ~800 tokens / ~15 % | 1,400 chars target / 180 chars overlap (~350 tokens / ~13 %); 400 chunks per file | `services/retrieval.ts:20-22` | DIFF + NOT-WIRED |
| N-15 | Embedding dims | 1,536 | no embeddings (invariant 4) | `CLAUDE.md:25-26` | ABSENT |
| N-16 | History summary trigger | >~60 % of history budget; keep last 6 turns | compaction when headroom < 10,000 tokens or < 15 % of window; fallback 150,000 tokens; no "last 6 turns" rule found | config:313-317 | DIFF + NOT-WIRED |
| N-17 | Memory caps | <=40 docs/user, <=3k tokens/doc, profile <=300 words, snapshot <=1.5k, prefetch <=3k | file 16 KiB; context memory 8,000 chars; list 100; import 500 items | `services/memory/memoryService.ts:23,25`; config:307; `memoryTransfer.ts:13` | DIFF; NOT-WIRED (16 KiB, 100, 500) |
| N-18 | Search quota per company (monthly) + web search default OFF | 1,000 searches/company/month; default OFF | web search flags default false; no quota | config:179-181 | MATCH (default off); ABSENT (quota) |
| N-19 | Research mode caps | per run 30 min / 50 searches / 5 helpers; 5 runs/company/month | no Research run caps found (a `research_events` table is referenced at `services/generation.ts:2063`) | - | ABSENT |
| N-20 | Long-task quota; 2 concurrent research runs/user | 20 per company/month; 2 | none | - | ABSENT |
| N-21 | Timeouts and retries matrix | Stage 15 | see N-42, N-43, N-31 | - | see rows |
| N-22 | Turn task: dispatch deadline / executor timeout / retries | 15 min / >=15 min / 1 from checkpoint (Cloud Tasks) | no executor | - | N/A-deferred |
| N-23 | API request timeout / concurrency | >=20 min / 80 | request timeout 3,600 s referenced only in a comment; concurrency set by deployment | config:147-150 | N/A-deferred |
| N-24 | SSE ping interval; Redis stream retention | 15 s; ~15 min after done | ping 15,000 ms; in-process buffer kept 5 min after finish, 50,000 events | `routes/chats.ts:813-815`; `services/runHub.ts:17,20` | MATCH (ping, NOT-WIRED); DIFF (retention 5 min vs 15) |
| N-25 | Executor min instances / memory | min 0 dev; memory by measurement | no executor | - | N/A-deferred |
| N-26 | Reranker model / candidates / latency | Vertex Ranking API, top 30, p95 <= 600 ms | none | - | ABSENT |
| N-27 | Retrieval latency budget | p95 <= 1,200 ms | none measured | - | ABSENT |
| N-28 | Planner timeout | ~300 ms | none | - | ABSENT |
| N-29 | Claude per-company monthly limit INR + 80 % alert | set per plan | per-user `monthly_token_budget` only; company switch dropped (ADR-0053 #6) | `db/schema.ts:102` | ABSENT (company); see deferred file |
| N-30 | Company plan limits | college pool 5,000 turns, 600 soft cap per user, 50 accounts, 50 GB | none | - | ABSENT (tenancy deferred) |
| N-31 | Fallback retries before switching model | <=2 retries, backoff >=1 s | no cross-model fallback; invariant 1 "never substitute silently" | `CLAUDE.md:18-20` | ABSENT (conflict flagged in stage notes) |
| N-32 | DB HA switch; backups / PITR; connection budget | before first paying customer; 7 d + 7 d | managed by Cloud SQL, not in repo | - | N/A-deferred |
| N-33 | Deletion SLA / cascade | <=30 d total; cascade <=23 d; soft delete 7 d | purge 30 days after delete (no 7 d soft delete / 23 d cascade split) | numbers.ts:61; config:336 | DIFF |
| N-34 | Retention: jobs 30 d, audit >=1 yr, safety content 30 d, deletion ledger 1 yr, idempotency keys 24 h | as listed | no jobs / audit / safety / ledger tables; no idempotency store (header allowed in CORS only) | `app.ts:88` | ABSENT |
| N-35 | Company / project instructions / user memory line | <=3,000 / <=5,000 / <=300 chars | user instructions 20,000; project instructions 20,000 | `routes/preferences.ts:87`; `routes/projects.ts:181,266` | DIFF + NOT-WIRED |
| N-36 | Price table (effective-dated) | Gemini 3.8 $0.75/$3.75 -> $1.50/$7.50 on 2027-01-01; Sonnet $2/$10; Opus $4/$20; ... | env JSON `PRICING_TABLE`, no rows in code, no effective date | config:384-398; `services/usage.ts:121` | NOT-WIRED |
| N-37 | FX source and cadence | planning INR 88/USD; Google monthly + FBIL | 88 | numbers.ts:83; config:378 | MATCH (value); ABSENT (source / cadence update) |
| N-38 | Priority PayGo / PT decision point | at Claude spend > 1 GSU-month x3 | decision only | - | N/A-deferred |
| N-39 | Artifact caps | 5 MB / 20 versions / 50 per chat | content 400,000 chars; versions append-only, no cap; no per-chat cap | `routes/artifacts.ts:38` | DIFF + NOT-WIRED |
| N-40 | Validation (Stage 13) judge share, reask, auto-continue, sampling 10 % | as listed | no judge / sampling | - | ABSENT |
| N-41 | Rendering: coalesce interval, preview rows, preview TTL, chat page size, formulas | provisional (no number for rows) | sheet preview 200 rows x 50 cols, 25 MB; list page default 30 (max 100) | `services/documents/sheetPreview.ts:8-9`; `routes/sheetPreview.ts:10`; `routes/helpers.ts:21` | NOT-WIRED; coalesce interval not found |
| N-42 | Model retries | <=2 before first token; 1 s -> 2 s + full jitter, cap 8 s; Retry-After cap 10 s | 2; 1,000 ms; 8,000 ms; 10,000 ms | numbers.ts:23-29; config:140-146; `services/generation.ts:1355-1445,2346-2350` | MATCH |
| N-43 | Timeouts | first-token Fast 20 / Normal 45 / Deep 90 s; stall 30 s; file_search 2, memory 2, web_search 20, fetch_url 10, run_code 60/120, load_skill 1 s; turn 10 min; executor 15 min; API SSE >=20 min | no first-token / stall cutoff (ADR-0024); request 600,000 ms; fetch_url 10,000 ms; turn 3,540,000 ms; connect 10,000 ms | numbers.ts:35,39; config:137-138,150; `services/webFetch.ts:41` | DIFF; fetch_url MATCH (NOT-WIRED) |
| N-44 | Cloud Tasks queues | turns 2 attempts / 20 min ... | no queue | - | N/A-deferred |
| N-45 | DB timeouts | statement API 5 s / retrieval 2 s / executor 30 s; lock 2 s; idle-in-tx 30 s; pool_recycle 1,800 s; shutdown 2 s | none set; pool without max lifetime | `db/client.ts:35-52` | ABSENT |
| N-46 | Client reconnect | backoff 1/2/4/8/16 s + jitter, 5 attempts | delays 0, 1, 2, 4, 8, 15, 30, 60 s (8 attempts, no jitter seen) | `arcnave-frontend/src/adapter.ts:162-163,192` | DIFF + NOT-WIRED |
| N-47 | Circuit breaker | open after 5 failures/30 s or >=50 % of 20; half-open 30 s; retry budget <=10 % | none (searched `circuit`, `breaker`) | - | ABSENT |
| N-48 | Redis degraded trigger | unreachable > 5 s | no Redis | - | N/A-deferred |
| N-49 | Auth TTLs | access 15 min; refresh rotation; user idle 24 h / absolute 28 d; owner/admin absolute 24 h; re-auth 10 min; reCAPTCHA 0.5 | one server session, absolute 14 days (336 h), `last_seen_at` touched, no idle limit, no refresh, no reCAPTCHA | numbers.ts:73; config:84; `services/auth.ts:278,309` | DIFF (14 d vs 28 d; no idle, no access / refresh); ABSENT (re-auth window, reCAPTCHA) |
| N-50 | Trace head sampling | 10 % normal, 100 % errors | no tracing | - | N/A-deferred |
| N-51 | Audit bucket 400 d; Bucket Lock 1 y; `audit_event` 1 y | as listed | none | - | N/A-deferred |
| N-52 | App logs 30 d; traces 30 d; client telemetry 90 d | as listed | log sinks outside repo | - | N/A-deferred |
| N-53 | SLOs | 99.5 % / 99 % / 97 % / p90 3 s, 8 s | none | - | N/A-deferred |
| N-54 | Burn-rate windows | 1 h/5 m 14.4x; 6 h/30 m 6x | none | - | N/A-deferred |
| N-55 | Alert thresholds | as listed | none | - | N/A-deferred |
| N-56 | Custom metric cardinality | <=20k series | no metrics | - | N/A-deferred |
| N-57 | Ledger vs billing drift tolerance | 2 % | usage ledger exists, no billing-export reconciliation | `services/usage.ts` | ABSENT |
| N-58 | Observability vendor prices | vendor price | n/a | - | N/A-deferred |
| N-59 | Cost assumptions X1-X13, FD-01/03/04 | Stage 18 | planning inputs | - | N/A-deferred |
| N-60 | Infra phases A/B/C sizing | Stage 18 | n/a | - | N/A-deferred |
| N-61 | Spend-cap and alert budgets | 150 % forecast; 50/80/90/100 % | none in repo | - | N/A-deferred |
| N-62 | Capacity (Gemini 2M TPM, Claude 2,500 QPM / 25M TPM, Doc AI 60/min, Tasks 500/s, Cloud Run 1,000 conc.) | Stage 18 | n/a | - | N/A-deferred |
| N-63 | Peak-day cost ceiling | INR 350/user/day (GST incl.) | n/a | - | N/A-deferred |
| N-64 | College plan | INR 50,000/month, pool 5,000 turns, 50 accounts | n/a | - | N/A-deferred |
| N-65 | Cloud Run sizing per service | API 1 vCPU/1 GiB conc 80 timeout 3,600 s min 1->3 max 50; Executor 2/4 GiB; Worker 1/2 GiB; Parser; Fetcher; Web | only the sandbox service is documented (2 vCPU / 8 GiB, conc 16, timeout 900) | `docs/deploy/warm-sandbox.md:43-44` | N/A-deferred |
| N-66 | DB pool budget per instance | API 5+5; Executor 4+2; worker 3+2; sum <= max_connections - 50; Cloud Run 100 conn; backups asia-south2 x14, PITR 7 d | pool max 10 (= 5+5 total) | numbers.ts:71; config:99; `db/client.ts:36` | MATCH (total 10); rest N/A-deferred |
| N-67 | Version pins = package register | Python packages | Node packages with ranges and lock files (see evidence pack) | `backend/package.json`, `arcnave-frontend/package.json` | N/A-deferred (DIFF-STACK) |
| N-68 | Sandbox dispatch deadline; execution timeout | 20 s start->first heartbeat; 60 s Normal / 120 s Deep inside job | orchestration timeout 45,000 ms; in-container 10,000 ms (Job) / 300,000 ms (warm); no heartbeat deadline | config:270,266,251 | DIFF + NOT-WIRED (orchestration 45 s) |
| N-69 | Router M2 | Haiku 5.5, thinking off, 1.5 s timeout, shadow mode | no model router; TurnRouter is policy-only (ADR-0006) | - | ABSENT (owner question: three models only) |
| N-70 | Migration DB timeouts | lock_timeout 5 s, statement_timeout 300 s, job 600 s | none set; dedicated connection with advisory lock | `db/migrate.ts:17-27` | ABSENT |
| N-71 | `audit_event` partition horizon | current IST month + 3 | no `audit_event` | - | ABSENT |
| N-72 | Passwordless sign-in and invitations | code 10 min, 5 tries, link 10 min, 1 code/60 s, 5/h, invitation 7 d, bulk 200, TOTP, 10 recovery codes | password + Google sign-in; no code / invite / TOTP | `routes/auth.ts`, `services/auth.ts:10` | ABSENT (owner question Q7) |
| N-73 | Chat + stream | list page 30, message page 50, siblings <=20, depth cap 5,000, title <=200, flush 100 ms, relay poll 250 ms, lease 30 s / heartbeat 10 s, Redis MAXLEN 10,000, events kept 15 min, sweep batch 1,000, dispatch grace 60 s, SIGTERM 5 s, ... | list default 30 (max 100); title max 200; stream buffer 5 min; no lease / heartbeat / flush constant found | `routes/helpers.ts:21`; `routes/chats.ts:262,369`; `services/runHub.ts:20` | MATCH (list 30, title 200); DIFF (retention 5 min vs 15); rest N/A-deferred or not found |
| N-74 | Model Gateway | max output Fast 8,192 / Normal 16,384 / Deep 32,768; router 1,024; Gemini cache TTL 60 min refreshed < 10 min; Claude cache TTL 5 min; WIF timeouts 10 s; cache admin timeout 10 s, list page 100 | max output 64,000 default, ceiling 128,000; Claude cache default 5 min (ephemeral, no explicit TTL); no explicit Gemini cache; no WIF | numbers.ts:41; config:156-157; `providers/anthropic.ts:305,372,454` | DIFF (output); MATCH (Claude TTL, NOT-WIRED); ABSENT (Gemini explicit cache, router, WIF) |
| N-75 | Context v1a estimator constants | BYTES_PER_TOKEN 2.0, FIXED 3.0, count trigger 0.8, floor 2 turns | none; invariant 3 says no estimator may exist | `CLAUDE.md:24-26` | ABSENT (owner question: register vs invariant 3) |
| N-76 | Worker, outbox, title job | lease 60 s, 5 attempts, queue `background-low`, Cloud Run worker, Scheduler | no worker | - | N/A-deferred |
| N-77 | Rolling history summary | trigger 0.6 x budget; last 6 turns kept; input max 30,000 tokens; output 1,200; timeout 60 s; Haiku 5.5, no fallback | compaction exists (different trigger, config:313-317), no Haiku, no "last 6 turns" constant | `services/compaction/*`; config:313-317 | DIFF + ABSENT (model) |

Counts (one status per row, worst wins: DIFF > ABSENT > NOT-WIRED > MATCH): DIFF 23 - ABSENT 24 - NOT-WIRED 2 (N-36, N-41) - MATCH 3 (N-37 value, N-42, N-66) - N/A-deferred 25 (incl. N-21, which points at N-42 / N-43) = 77. Rows with a MATCH part inside a mixed status: N-01 (generate 20), N-10, N-18, N-24, N-43 (fetch_url), N-73, N-74 (Claude cache TTL).

## 2. Every DIFF with both values
| N-id | Register | Repo | Where |
|---|---|---|---|
| N-01 | user 20/min | write 120/min | numbers.ts:67 |
| N-02 | 32k chars | 100,000 chars | chats.ts:543 |
| N-05 | 30k tokens | 200,000 chars (~50k tokens) | config:171 |
| N-06 | steps 1-2 / 5 / 15; turn 10 min | 16 rounds; 59 min | numbers.ts:43,39 |
| N-07 | search 1-3-8 per turn | `max_uses: 5` | anthropic.ts:38 |
| N-08 | 60/120 s; 4 GiB; ~5 parallel per company | 10 s Job / 300 s warm; 8 GiB; 20 global | numbers.ts:51,53; config:285 |
| N-09 | ~8k tokens | 6,000 / 30,000 chars | numbers.ts:45,47 |
| N-10 | image 20 MB; per-type caps | image 10 MB; single 500 MB attachment cap; 30 MB project files | processUpload.ts:36; numbers.ts:57,59 |
| N-13 | 3 / 8 / 20 page images | 100 visual pages | processUpload.ts:33 |
| N-14 | ~800 tokens / ~15 % | 1,400 / 180 chars | retrieval.ts:20-21 |
| N-16 | 60 % trigger, keep 6 turns | headroom 15 % / 10,000 tokens | config:313-317 |
| N-17 | <=3k tokens/doc, snapshot 1.5k | 16 KiB file, 8,000 chars | memoryService.ts:25; config:307 |
| N-24 | retention ~15 min | 5 min | runHub.ts:20 |
| N-33 | soft delete 7 d, total <=30 d | 30 d purge | numbers.ts:61 |
| N-35 | 3,000 / 5,000 / 300 chars | 20,000 / 20,000 | preferences.ts:87; projects.ts:181 |
| N-39 | 5 MB, 20 versions, 50 per chat | 400,000 chars, uncapped versions | artifacts.ts:38 |
| N-43 | first-token 20/45/90 s, stall 30 s, turn 10 min | none, request 600 s, turn 59 min | numbers.ts:35,39 |
| N-46 | 5 attempts, 1-16 s + jitter | 8 attempts, 0-60 s | adapter.ts:163 |
| N-49 | absolute 28 d + idle 24 h, access 15 min | absolute 14 d, no idle, no access token | numbers.ts:73 |
| N-68 | 20 s dispatch deadline | 45 s orchestration | config:270 |
| N-74 | output 8,192 / 16,384 / 32,768 | 64,000 | numbers.ts:41 |
| N-73 | stream events kept 15 min | 5 min (list page 30 and title 200 match) | runHub.ts:20 |
| N-77 | 0.6 trigger, last 6 turns | headroom ratio 0.15 | config:313-317 |
Most numbers.ts entries state "repo value; register says ..." in their own source text, so the divergence was deliberate (ADR-0024, ADR-0026, ADR-0010, ADR-0054) but is now not allowed to stand without an owner decision (ADR-0061); see Q9 in `stage-21.md`.

## 3. Literals in `backend/src` (and frontend) that should carry an N-id but do not
| Literal | Location | N-id it belongs to |
|---|---|---|
| `15_000` SSE heartbeat | `routes/chats.ts:815` | N-24 |
| `.max(100_000)` prompt | `routes/chats.ts:543` | N-02 |
| `attachmentIds ... .max(10)`; multipart `files: 10` | `routes/chats.ts:546`; `app.ts:104` | N-10 (<=10 files/msg) |
| `FILE_LIMITS` (20 files, 1000 pages, 100 visual pages, 8000 px, 10 MB) | `services/attachments/processUpload.ts:29-37` | N-10, N-13 |
| `max_uses: 5` | `providers/anthropic.ts:38` | N-07 |
| `CHUNK_TARGET_CHARS 1400`, `CHUNK_OVERLAP_CHARS 180`, `MAX_CHUNKS_PER_FILE 400` | `services/retrieval.ts:20-22` | N-14 |
| `PROJECT_FULL_CONTEXT_MAX_CHARS 200_000`, `HISTORY_MAX_ATTACHMENT_BYTES 12_000_000`, `MEMORY_CONTEXT_MAX_CHARS 8000` | `config.ts:171,176,307` | N-05, N-13, N-17 |
| `COMPACTION_TRIGGER_TOKENS 150_000`, `..._HEADROOM_TOKENS 10_000`, `..._HEADROOM_RATIO 0.15` | `config.ts:313-317` | N-16 / N-77 |
| `RATE_LIMIT_AUTH_PER_MINUTE 10`, `RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE 60` | `config.ts:369,371` | N-01 |
| `PROVIDER_CONNECT_TIMEOUT_MS 10_000`, `MODEL_PROBE_TTL_SECONDS 300` | `config.ts:135,138` | N-43 / N-74 (WIF 10 s) |
| `MAX_CONCURRENT_RUN_PYTHON 20`, `RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS 45_000`, `MAX_CODE_BYTES 20 KiB`, `SANDBOX_CLAIM_LEASE_BUFFER_MS 30_000` | `config.ts:262,270,285,290` | N-08, N-68 |
| `fetch_url` timeout 10_000 and 1 MB | `services/webFetch.ts:41-42` | N-43, N-09 |
| `UNSENT_UPLOAD_TTL_HOURS 24`, `SANDBOX_STATE_RETENTION_DAYS 30`, `SANDBOX_CHECKPOINT_IDLE_SECONDS 300` | `config.ts:338-342` | N-34 / N-33 family |
| Instructions `.max(20_000)` | `routes/preferences.ts:87`; `routes/projects.ts:181,266` | N-35 |
| Memory `16 * 1024`, list 100, import 500 | `services/memory/memoryService.ts:23,25`; `memoryTransfer.ts:13` | N-17 |
| Artifact `400_000` | `routes/artifacts.ts:38` | N-39 |
| Run hub `50_000` events, `5 * 60_000` retention | `services/runHub.ts:17,20` | N-24 / N-73 |
| Sheet preview `200` rows, `50` columns, `25 MB` | `services/documents/sheetPreview.ts:8-9`; `routes/sheetPreview.ts:10` | N-41 |
| Reconnect delays `[0,1000,...,60000]` | `arcnave-frontend/src/adapter.ts:163` | N-46 |
| Title cut `.slice(0, 200)`, `max(200)` | `routes/chats.ts:262,369,517` | N-73 (title <=200) |
| Session sweep `60 * 60 * 1000`, checkpoint sweep `60_000` | `index.ts:15,57` | none yet in the register |
| Export link `24 * 3_600_000` | `routes/account.ts:18` | none in register |
| Warm sandbox `CHUNK_BYTES`, `TRANSFER_FLOOR_MS 60_000` | `tools/sandbox/warmSandboxClient.ts:24,30` | N-08 / N-68 |
Three entries in `numbers.ts` have an N-id but sit on a *different* number than the row names (PROVIDER_TIMEOUT_MS under N-43, TURN_DEADLINE_MS under N-43, DEFAULT_MAX_OUTPUT_TOKENS under N-74): the id points at the register row they diverge from.

## 4. Wired entries in `numbers.ts` (20)
N-42 x4 (MATCH) - N-43 x2 (DIFF) - N-74 (DIFF) - N-06 (DIFF) - N-09 x2 (DIFF) - N-08 x2 (DIFF) - N-10 x2 (DIFF/MATCH mix) - N-33 (DIFF) - N-01 x2 (MATCH generate / DIFF write) - N-66 (MATCH) - N-49 (DIFF) - N-37 (MATCH). Tests pin the values (`backend/src/services/retryPolicy.test.ts:15-17`).
