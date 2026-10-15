# ArcNave – Stage 4 · L6 Async Layer – full audit
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01: AS1–AS28, CA1–CA5, AS-D1–D6) · Method: 2 independent auditors (Google Cloud docs; AI-vendor async patterns) + merge · Labels: Vendor / Partial / ArcNave rec_

> **Doc-sync 2026-10-03 (Stage 15) – see Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md:**
> - Queue configs ER-7 (turns 2 attempts/20 min/5 s/deadline 15 min; file-blocking 3/10 s–5 min/30 min; background-low 5/1 h); daily no-op task keeps queues warm (idle 30 d → NOT_FOUND); never manual RunTask on running tasks; worker 429/503 when overloaded; Cloud Run jobs retries = 1 from checkpoint (EH25); embeddings re-queued per row ≤3 (EH13).

> **Doc-sync 2026-10-03 (Stage 19) – see Stage-19-Infrastructure/00-checkpoint-stage19.md:**
> - **Sandbox runner = Cloud Run Job execution per run** (a service with `--concurrency=1` does not give a fresh container per request) (ID-7). No Eventarc: upload-complete API enqueues Cloud Tasks directly. Cloud Scheduler time zone `Asia/Kolkata`, OIDC → worker. **Delhi (asia-south2) has no Cloud Tasks** → DR dispatch fallback = worker DB-polling loop (ID-15/ID-16).

## Key documented facts
- Cloud Tasks: HTTP dispatch deadline default 10 min, 15 s–30 min; at deadline request cancelled + retried but worker may keep running; at-least-once (duplicates happen); no ordering, old tasks can starve; task names dedupe ~24 h, hashed names (sequential = latency); task size doc conflict (1 MiB vs 100 KB); attempts exhausted → task DELETED (no dead-letter); 500 dispatch/s, 5,000 concurrent per queue; 1,000 queues/region; asia-south1 available; OIDC to Cloud Run; logging off by default; $0.40/M ops after 1M free.
- Pub/Sub: exactly-once only pull + same region; push ack ≤600 s; DLQ 5–100 attempts; storage policy can pin asia-south1.
- Cloud Run: service timeout ≤60 min (>15 min → make idempotent/resumable); request-based billing = CPU only during requests, idle instances killed any time; SIGTERM → SIGKILL 10 s; Jobs task timeout up to 168 h, retries 0–10; worker pools GA 14 Apr 2026.
- Cloud Scheduler: at-least-once; attempt deadline 3 min default (≤30 min); retryCount default 0; asia-south1; $0.10/job/month (3 free).
- Memorystore Redis Standard: async replication, failover ~30 s, acknowledged writes can be lost, all connections drop.
- Storage/Eventarc notifications at-least-once, unordered.
- Vendors: OpenAI background mode (queued/in_progress/completed/failed/cancelled, resume via sequence number), webhooks dedupe by id, Batch 24 h/50%; Gemini batch 50%/24 h, Files "wait for ACTIVE"; Document AI batch LRO (500 pages/1 GB); Speech BatchRecognize LRO ≤480 min; RAG Engine skips unchanged files; Anthropic Batch NOT on Vertex; Claude deleted chats removed ≤30 days but derived memories NOT removed; ChatGPT files deleted ≤30 days after chat delete; ChatGPT upload quotas (80 files / 3 h, 25 GB user, 100 GB org).

## Items
| # | Item | Sev | Comp | Source | Rec |
|---|---|---|---|---|---|
| AS1 | Turn dispatch deadline default 10 min = our max turn → duplicate executor. Set deadline ≥15 min; executor Cloud Run timeout ≥ deadline | Critical | 6.1 | Vendor | MVP |
| AS2 | 1-h audio / long OCR can't fit one task (30 min max) → split into segments (fan-out) or provider LRO (submit, store op id, poll) or Cloud Run job | Critical | 6.1 | Vendor + Partial | MVP (AS-D2) |
| AS3 | Task payload = IDs only, never customer content (size conflict + data location of task store not documented) | Important | 6.1 | Vendor + ArcNave | MVP |
| AS4 | Pub/Sub push ≤600 s → not for long jobs; Pub/Sub/worker pools later | Important | 6.1 | Vendor | Later |
| AS5 | Job catalogue: each job type defines trigger, queue, timeout, retries, idempotency key, priority, data touched, DPDP impact | Critical | 6.2 | ArcNave rec | MVP |
| AS6 | One status model: queued / in_progress / completed / failed / cancelled / expired + reason | Important | 6.2 | Partial (OpenAI, Gemini, Perplexity) | MVP |
| AS7 | Every job has max age / expiry (vendors 24–48 h) | Important | 6.2 | Partial | MVP |
| AS8 | Per-item results (one page/file fails, rest succeed) | Important | 6.2 | Partial (Doc AI, RAG Engine, batch) | MVP |
| AS9 | **Cloud Tasks deletes task after last attempt** → our own failed-job table + sweeper for stuck jobs | Critical | 6.3 | Vendor | MVP |
| AS10 | Per-queue retry config (defaults 100 attempts / 1 h backoff wrong for chat): turns 1 retry, short; background bounded | Important | 6.3 | Vendor | MVP |
| AS11 | Classify errors: 429 honour retry-after, never retry spend-cap 429, backoff + jitter, failed calls still use quota | Critical | 6.3 | Vendor (Anthropic, OpenAI) | MVP |
| AS12 | Poison jobs: cap attempts, keep error, mark failed, no infinite loop | Important | 6.3 | ArcNave rec | MVP |
| AS13 | Enable Cloud Tasks logging; alerts on non-2xx, queue depth, stuck/failed jobs | Important | 6.3 | Vendor | MVP |
| AS14 | Every trigger can deliver twice (Tasks, Scheduler, Eventarc, Pub/Sub) → DB idempotency key (type + entity + version) + compare-and-set status | Critical | 6.4 | Vendor | MVP |
| AS15 | **Redis failover can lose the conversation lock** → DB fencing token / turn-state check so two executors never both commit | Critical | 6.4 | Vendor | MVP |
| AS16 | Outbox relay: hashed deterministic task name; ALREADY_EXISTS = success | Important | 6.4 | Vendor | MVP |
| AS17 | Skip re-processing unchanged files: key = file hash + pipeline/chunking version | Important | 6.4 | Partial (RAG Engine) | MVP |
| AS18 | Tasks run out of order → title/memory writes versioned (late old job can't overwrite newer) | Important | 6.4 | Vendor | MVP |
| AS19 | Scheduler only kicks off (enqueue / start job), never does work inline; Asia/Kolkata timezone; idempotent via ScheduleTime | Important | 6.5 | Vendor | MVP |
| AS20 | **Deletion cascade**: resumable idempotent batches + verification sweep; tombstone check so queued jobs skip deleted items; covers files, embeddings, derived memories, caches, vendor copies; SLA stated | Critical | 6.5 | Partial + ArcNave | MVP (AS-D4) |
| AS21 | File must reach terminal state (ready / failed / timed out) so Send never stays disabled forever; failed → reason + retry + remove | Critical | 6.6 | ArcNave rec + Partial | MVP (AS-D6) |
| AS22 | DB = source of truth for job status; Redis/SSE only live updates; client re-fetches on reconnect | Critical | 6.6 | Vendor (Redis can lose writes) | MVP |
| AS23 | Step-level states (uploaded → parsing → indexing → ready); no fake % | Minor | 6.6 | ArcNave rec | MVP |
| AS24 | Upload quotas before enqueue: per-file size, files per time window, storage per user/company | Important | 6.6 | Partial (ChatGPT) | MVP mechanism; numbers Stage 18 |
| AS25 | No priority inside a queue + starvation → separate queues: turns · file-blocking · background-low | Critical | 6.7 | Vendor | MVP |
| AS26 | Per-company fairness not provided by GCP → app-level per-company concurrency caps; no queue-per-company (1,000 limit) | Important | 6.7 | Vendor + ArcNave | MVP |
| AS27 | Queue rate/concurrency caps protect shared Vertex quota; smooth bursts (Anthropic acceleration limits) | Important | 6.7 | Vendor | MVP |
| AS28 | Vendor batch APIs (Gemini batch 50%) only for bulk re-embedding/evals; Anthropic batch not on Vertex | Minor | 6.1 | Vendor | Later |

## Claude-only
| # | Fact | Rec |
|---|---|---|
| CA1 | Anthropic Message Batches not available on Vertex (Google's own Claude batch page unread) | Later / verify |
| CA2 | 429 has retry-after (except spend-cap 429); ramp traffic gradually (acceleration limits); SDK retries twice by default | MVP (AS11, AS27) |
| CA3 | Work >10 min → streaming (A14) | MVP |
| CA4 | Claude.ai keeps memories derived from deleted chats; ArcNave chooses to delete them (M7, DPDP) | MVP (AS-D4) |
| CA5 | Claude.ai deletes chats from back-end ≤30 days | Benchmark for AS-D4 |

## Decisions
| ID | Question | Rec |
|---|---|---|
| AS-D1 | Queue tech | Cloud Tasks for all MVP jobs, 3 queues (turns, file-blocking, background-low); Cloud Run jobs for very long work (account deletion, evals); Scheduler only triggers; Pub/Sub + worker pools later |
| AS-D2 | Long audio/OCR | Split into segments with fan-out tasks (engine-neutral); provider LRO only if Stage 9 picks it |
| AS-D3 | Turn task settings | Dispatch deadline 15 min, executor timeout ≥15 min, 1 retry that resumes from checkpoint |
| AS-D4 | Deletion SLA | Gone from ArcNave systems ≤30 days incl. embeddings + derived memories; state it in privacy policy |
| AS-D5 | Status truth | DB; Redis only live |
| AS-D6 | Failed file UX | Show reason + Retry + Remove; Send blocked only by files still processing |
