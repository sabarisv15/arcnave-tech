# ArcNave – Stage 4 design review (cross-layer, no web research)
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01: R1–R14, RV-1, RV-2, RV-3) · STAGE 4 CLOSED · Remaining: check 10 "cannot judge" items once L1–L4 main docs are available · Method: independent reviewer read all local L4–L8 docs, walked 12 end-to-end scenarios; I re-checked each finding against locked items._

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - RV-2 made concrete (SD-9): Claude refusal frontier_llm / reasoning_extraction / null → Gemini fallback only after M9 input screen passes; cyber / bio / general_harms never fall back.

## Major findings → fixes
| # | Issue | Sev | Fix (rule) |
|---|---|---|---|
| R1 | Claude history must be byte-identical turn to turn; dynamic blocks (retrieved chunks, memory, date, admin instructions) re-rendered differently → thinking prefix mismatch → 400 + cache miss | Critical | Store each turn's rendered blocks exactly as sent; never re-render old turns; per-turn prefix hash. **Updated 2026-10-02 (Stage 6, user OK):** admin/project/capability changes are sent as appended mid-conversation system messages (history unchanged) → **no thinking strip**; Gateway strips earlier-turn thinking only when an earlier part of the prompt is edited (system rebuilt, history summarised) or the model is switched; add to G35 tests |
| R2 | Budget only checked before turn; concurrent Deep/Opus turns can overshoot ₹1,000 cap | Critical | Atomic DB reservation of worst-case cost before every model call, settle with real usage; re-check budget + kill switch at executor start and every step; one INR price/FX table; Deep on Opus gated/capped |
| R3 | Gateway fallback / circuit breaker can switch to Claude after policy check → ignores company Claude switch + budget | Critical | Policy engine outputs allowed-model list per turn; Gateway uses only that list (also resume, regenerate) |
| R4 | Every Claude refusal auto-falls back to Gemini → genuinely harmful request answered by 2nd model | Major | Fallback only for allowed refusal categories; run our input screen first; harmful categories show refusal, no fallback |
| R5 | Redis has no degraded mode (policy cache, rate limits, locks, relay, Stop) → failover blocks chat | Major | Policy → DB/in-process cache (not deny); local rate-limit fallback; per-event sequence numbers + client gap detect → snapshot refetch; Stop/cancel = DB flag polled by executor |
| R6 | Summaries and file scope not tied to branch → abandoned-branch content leaks into answers | Major | Summary keyed to last message id on current path; retrieval scope = files on current path; same for memory candidates |
| R7 | Restore from backup/PITR or GCS undelete brings deleted data back | Critical | Deletion ledger outside restorable data; re-apply automatically after any restore (runbook) |
| R8 | No single personal-data map; deletion misses safety queue, feedback, eval stores, share snapshots, checkpoints, raw provider blocks, failed jobs, transcripts, titles, summaries | Major | One data map (store, key, retention, deletion path) owned by L7 + verification sweep; cascade finishes ≤23 days so 7-day backups still fit 30 |
| R9 | Read-only tools can still exfiltrate data (URL fetch, sandbox network, markdown images/links in client) | Major | Sandbox no egress; fetch only URLs from user message or search results; client never auto-loads external images (proxy/allow-list); red-team case |
| R10 | Executor cold start (DB/Redis connect ≥1 min) + nobody drains outbox (no CPU outside requests) → slow first words at peak | Major | Executor min instances + headroom; enqueue inline right after commit, Scheduler sweeper as backup; queue-depth-based 429 |
| R11 | DPDP role undefined (company = fiduciary, ArcNave = processor?) → user self-delete vs company retention vs offboarding unclear | Major | Decision RV-1 |

## Doc contradictions fixed
- L7 DB-5 "regional secrets" → replaced by PL-5 (user-managed replication).
- L5 S-3 gateway location → runs in API, Executor and Worker (L5a wins).
- R2 (250 texts/request) and R4 (≤200 records) superseded by B10 (verify) and B12 (≤1,000).
- LV-1 item "Redis RDB location" dropped (D20: RDB off) → LV-1 = 17 items.

## L1–L4 main docs check (done 2026-10-01 via computer link)
| Item | Result |
|---|---|
| Idempotency key on message POST | ✅ L3 pipeline step 6 (Idempotency-Key, 24 h) + L1 request_id |
| Kill switch inside step loop | ✅ via R2 (re-check every step) + L4-G49 |
| Tool-registry version in config stamp | ✅ L4-G48 (tool-set version) |
| Retract after resume | ✅ retract is a seq event (L4 emitter) → replayed by GET /turns/{id}/events?after= |
| Safe markdown | ✅ L1 module 7 (no raw HTML) + R9 (no external image auto-load) |
| Share link snapshot / revoke / admin off / noindex / separate origin | ✅ L1 G3 safeguards + L2 + RV-3 |
| Long SSE through ALB + heartbeat | ✅ L2 (serverless NEG 60 min, ping 15 s, API timeout ≥ turn) |
| Stream re-attach ownership | ⚠️ tenant context verified, but explicit "turn belongs to this user/company" check not written → **R12** |
| Redis lock lease renewal (10–15 min turns) | ⚠️ not written (G50–G63 details exist only as summary) → **R13** |
| Checkpoint schema compatibility across deploys | ⚠️ not written → **R14** |

| # | Fix | Sev |
|---|---|---|
| R12 | Every turn/stream/file/share endpoint checks resource belongs to caller's company + user access (no IDOR); 404 not 403 | Major (security) |
| R13 | Conversation lock = Redis lease with TTL, renewed by executor heartbeat; DB fencing token decides commit (AS15) | Major |
| R14 | Turn record/checkpoint carries schema_version; new revision reads old checkpoints (expand/contract); unknown version → fail safe + retry on matching revision | Major |

Doc sync also needed: L4 main doc O-3 still says "turns run inside API service" → superseded by 3 deploys (final lock).

**Stage 4 verdict:** after R1–R14, no known major gap. Remaining unknowns = LV-1 live tests (~11) only.

## (old) Cannot judge from local docs → resolved above
Idempotency key on message POST · stream re-attach ownership check · Redis lock lease renewal for 10–15 min turns · kill switch inside step loop · checkpoint schema compatibility across deploys · tool-registry version in config stamp · retract rendering after resume · safe markdown rendering · share link snapshot vs live, revoke on delete, company switch to disable public links · ALB timeouts for long SSE + heartbeats.

## Decisions
| ID | Question | Rec |
|---|---|---|
| RV-1 | DPDP role | Company = data fiduciary, ArcNave = processor for company content (contract/DPA). User leaves → admin deactivates; company decides keep/delete; user self-delete requests go to company admin, ArcNave executes |
| RV-2 | Refusal fallback | Only for refusal categories we allow; harmful categories never fall back |
| RV-3 | Public share links for B2B | **Updated 2026-10-01 (SHD-1):** default company-only links; public links only if company admin enables (default OFF); links revoked when chat/account deleted |
