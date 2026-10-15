# Stage 18 - Cost and performance: conformance audit

Sources read: `docs/architecture/Stage-18-Cost-Performance/00-checkpoint-stage18.md` (doc-syncs to 2026-10-14), `00-Handoff/00-cost-decision-log.md` (FD-01..FD-36), `00-Handoff/00-numbers-register.md` (all N-xx cited below),
repo `backend/src/{config.ts,config/numbers.ts,db/schema.ts,services/{usage,generation}.ts,routes/usage.ts,providers/{anthropic,gemini,routing,types}.ts,services/promptCache/*}`, ADR 0021, 0053, 0054, 0055, 0061, repo `CLAUDE.md`,
port source `arcnave.in:backend/packages/ledger/src/arcnave_ledger/price_book.py` (read in full), `arcnave.in:backend/packages/ledger/CLAUDE.md`, `arcnave.in:backend/packages/gateway/src/arcnave_gateway/{config,telemetry}.py`, gateway `CLAUDE.md`.
Not checked: `18-cost-performance.md` body (the checkpoint and the cost log carry the locked lines), live billing data, `.env.example` (access denied to this auditor). Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

## 1. Locked decisions

| Id | Decision (one line) | Status |
|---|---|---|
| PB-1 | Cost basis: FD-01 tokens per turn (Fast 3k/6k/0.9k, Normal 14k/6k/2.7k, Deep 50k/6k/9k), FD-02 per-turn cost, FD-03 25 turns/day (50 peak), FD-04 40/45/15 mix, FD-05 extras, FD-06 Research run, FD-07 infra phases, FD-11/13 per-user scale totals, FD-12 no self-hosting, FD-14 commitments, FD-15 seat floors, N-59, N-60; FD-09 levers L3-L6, L9-L11; CD-6 withdrawn (judge stays sync) | LOCKED planning basis; FD-02 figures SUPERSEDED by the worst-case row in the checkpoint (mixed Rs 2.93); FD-25 (2026-10-04) removes the Gemini cache discount from the plan |
| PB-2 | College segment FD-16..FD-19, N-64 (Rs 50,000/month), CD-3 default caps | FD-16..FD-19 PARKED by FD-21 (2026-10-03: general B2B first); CD-3 caps SUPERSEDED by the pool model (N-30); business numbers, validate in pilot |
| PB-3 | Infra and dev running costs: FD-22 dev Cloud SQL schedule, FD-23 GitHub plan, FD-24 telemetry endpoint, FD-28 Data Access logs, FD-29 billing budgets, FD-32 SES, FD-33 no mail backup, FD-34 Redis timing, CD-8 infra phases, CD-9 commitments timeline, CD-10 Cloud Run billing modes, CD-12 Document AI quota, CD-13 hosting/mail/EAS, N-62 capacity list, FD-30 dev NAT | LOCKED; infra |
| FD-35 | Claude provider = first-party Claude API (ADR-0012); token rates equal the plan; NAT cost per environment | LOCKED (2026-10-10) |
| FD-08 / FD-10-L1 | Peak-day ceiling Rs 350/user (GST incl., 2027, N-63); own ledger reservations in real time per turn, per pool, Claude pool, Deep share, search/Research quotas | LOCKED |
| FD-09-L7 | Opus never the default; explicit choice inside the Claude pool | LOCKED |
| POOL | Company pools and quotas: FD-09-L2 Deep cap 10 %/user, FD-09-L8 / N-18 search 1,000/company/month, N-11 OCR 5,000 pages, N-19 Research 5 runs, N-20 20 long tasks, N-29 Claude add-on Rs 2,000 (OFF by default), CD-4, CD-11, N-30 pool 5,000 turns (+5,000 boost) with per-user soft cap 600 (warn 80 %) | LOCKED; DEFERRED (company); N-29 per-company switch dropped by owner (ADR-0053 #6) |
| FD-10-L23 | Alert budgets 50/80/90/100 % and spend-cap budgets at 150 % of forecast (N-61); FD-29 brings alert budgets to Phase 1 | LOCKED; DEFERRED (Terraform) |
| FD-10-L4 | Kill switch (feature flag) per model/tool; never the disable-billing function | LOCKED |
| CD-1 | Cost model as code + price book with effective dates: Gemini 3.8 Flash list price and a 2027-01-01 row (FD-20), promo credit as a separate credit row (FD-20 b), cache storage per token-hour (FD-26), Flash-Lite (FD-31), Haiku 5.5 tiered by prompt size (FD-36), Sonnet/Opus 5.5 first-party incl. cache writes and reads (ADR-0012 sync: Sonnet read $0.10, Opus read $0.20), Vertex Ranking row (FD-27); cost per call in USD micros and INR paise; GST at invoice level; N-36 | LOCKED (the "Sonnet cache read $0.20" standing fact is Vertex-era, SUPERSEDED 2026-10-10) |
| LED-1 | Money as exact decimals, rounded half-up per call (micro-USD, paise); turn total = sum of rounded calls | LOCKED (port rule, ledger CLAUDE.md) |
| N-37 | FX: Google monthly `currency_conversion_rate` for reconciliation, FBIL 1 PM reference for estimates, planning Rs 88/USD | LOCKED |
| CD-5 / FD-25 | Caching rules: verify, never pad a prompt to reach a minimum; cached share is a parameter, default 0 for Gemini; Claude minimum 512 tokens for 5.5 models | LOCKED (2026-10-04; FD-09 "Gemini >= 6,144" SUPERSEDED by LV-128 explicit minimum 4,096, 2026-10-05) |
| FD-26 | Gemini explicit context cache built in Phase 1: one cache per enabled tool set, base system prompt + tools; recreate on expiry/prompt change; cost plan unchanged | LOCKED (2026-10-05; CP5 "no explicit caches in MVP" SUPERSEDED) |
| N-74c | Claude prompt cache: TTL 5 min (default), 1 h not used, system-prompt breakpoint only | LOCKED (register N-74) |
| OPS | CD-14 performance targets N-53 + capacity list, CD-15 cost telemetry and monthly price-book review job, N-57 ledger-vs-billing drift 2 % | LOCKED; DEFERRED (ops/infra) |
| ROUTER | FD-31 turn router `gemini-3.5-flash-lite` (about Rs 0.53 / 1.06 per user per day at 25 / 50 turns) revised by FD-36 `claude-haiku-5-5`; worker-job cost not attributed to a company's Claude limit until block 7 (doc-sync 2026-10-14); FD-31 SUPERSEDED by FD-36 (2026-10-12) | LOCKED; conflicts with "three models only" - owner question |
| WORK | Worker-job spend logged with purpose/job_id/helper_version, company attribution decided in block 7 | LOCKED; DEFERRED (company_id) |

## 2. Repo today

| Id | Evidence (file:line) or "not found (searched: ...)" |
|---|---|
| PB-1, PB-2 | no code surface; the repo has no cost-basis constants (searched `FD-0|ceiling|peak` in `backend/src`: only `config.ts:379` FX comment) |
| PB-3 | no Terraform or billing config in repo |
| FD-35 | `providers/anthropic.ts:1-55` first-party client, `config.ts:116-122`; ADR-0054 |
| FD-08 / FD-10-L1 | per-user token reservation: `services/usage.ts:258-291` reserves `maxOutputTokens` (default 64,000, `config/numbers.ts:41`) against `usage_counters` (`schema.ts:650-664`) before the call and releases it after (`generation.ts:694-703,1096`); budgets are optional per user (`schema.ts:101-102`); no INR reservation, no price lookup before the call, no ceiling per day in rupees |
| FD-09-L7 | `providers/routing.ts:62-76`: `research_mode`, `attachments_present` and `long_project_context` choose tier `quality` = Opus 5.5 when configured (ADR-0055 consequences: "Auto routes ... quality -> Opus 5.5"); user routing preference `quality` shifts a tier up (`:33`) |
| POOL | not found: counters are per user (`schema.ts:654`); search/OCR/Research/long-task quotas not found (searched `quota`, `pool` in `backend/src`); per-user warn threshold 80 % exists (`schema.ts:103`) but on tokens |
| FD-10-L23 | none in repo |
| FD-10-L4 | not found (searched `kill|switch|disable` in `providers/registry.ts`, `config.ts`): only per-alias env switches `MODEL_SONNET=''` (`config.ts:55-59`) and a probe-driven availability record (`registry.ts:230`) |
| CD-1 | price table = env JSON `PRICING_TABLE` `{model:{input,output,cacheRead,cacheWrite}}` (`config.ts:61-69,384-398`), no effective dates, no promo credit, no 5m/1h write split, no storage, no tiers, no source/version; empty by default (`compose.yaml:80`); cost computed in two places with identical code (`services/usage.ts:116-131`, `services/generation.ts:2204-2214`); `usd_to_inr` at planning 88 (`usage.ts:139-142`); `price_version`, `fx` not stored (`schema.ts:592-642`) |
| LED-1 | `cost_usd` / `cost_inr` are `doublePrecision` (`schema.ts:629,635`), rounded to 1e-6 per call (`usage.ts:130,141`); sums in SQL on doubles (`usage.ts:149-152,422`) |
| N-37 | planning 88 in `config/numbers.ts:83` and `PRICING_INR_PER_USD` (`config.ts:378`), cost null stays null in INR (`usage.ts:139-142`); no monthly Google rate or FBIL input (deferred to reconciliation) |
| CD-5 / FD-25 | no padding anywhere (`providers/anthropic.ts:441-464`, stable prefix from `promptAssembly`); `ENABLE_PROMPT_CACHE=true` (`config.ts:300`); cache minimum table `services/promptCache/providerPolicy.ts:14-58` (Claude 5.5: 512; Gemini 3.8 implicit 6,144) is used only by dev scripts (`scripts/run*PromptCacheEvaluation.ts`), not in the request path |
| FD-26 | not found in service code (searched `cachedContent|caches\.` in `backend/src` non-test: only `scripts/runGeminiPromptCacheEvaluation.ts:69-110`) |
| N-74c | `providers/anthropic.ts:372-374` marks the previous assistant turn and `:450-456` the system prefix with `cache_control: ephemeral` (no `ttl` field, so 5 min default): two breakpoints |
| OPS | none in repo |
| ROUTER, WORK | no router model call and no worker jobs in the repo (searched `haiku|flash-lite` in `backend/src` non-test: only `systemPrompt.ts` text and a prompt-kit test; `services/routing/turnRouter.ts:1-9` is a policy boundary that reads no prompt wording, `providers/routing.ts` is the rules-based model router) |

## 3. Buckets

| Id | Bucket | One-line reason |
|---|---|---|
| PB-1 | n/a | planning basis, no repo surface |
| PB-2 | n/a | parked by FD-21 |
| PB-3 | DIFF-INFRA | cloud cost decisions, Terraform side |
| FD-35 | KEEP | first-party client in place |
| FD-08 / FD-10-L1 | REWRITE | reserve in rupees per turn using the price book; add the daily ceiling |
| FD-09-L7 | REWRITE | Auto routes attachment, research and long-project turns to Opus |
| POOL | DEFERRED | company pools and quotas (per-user token budgets remain, owner ADR-0053 #6) |
| FD-10-L23 | DEFERRED | Terraform budgets and caps |
| FD-10-L4 | NEW-BUILD | no kill switch |
| CD-1 | NEW-BUILD | price book as dated code rows; env JSON stays until the switch |
| LED-1 | REWRITE | money in doubles |
| N-37 | KEEP | planning 88 constant matches |
| CD-5 / FD-25 | KEEP | no padding; cache not assumed in cost |
| FD-26 | NEW-BUILD | Gemini explicit cache absent |
| N-74c | REWRITE | two breakpoints instead of system-prompt only |
| OPS | DEFERRED | targets, review job, drift |
| ROUTER | OWNER-Q (no bucket) | conflicts with three-models decision |
| WORK | DEFERRED | company attribution in block 7 |

Counts (18 rows): KEEP 3 (FD-35, N-37, CD-5/FD-25) - REWRITE 4 (FD-08/FD-10-L1, FD-09-L7, LED-1, N-74c) - NEW-BUILD 3 (FD-10-L4, CD-1, FD-26) - DISCARD 0 - DIFF-STACK 0 - DIFF-INFRA 1 (PB-3) - DEFERRED 4, not bucketed (POOL, FD-10-L23, OPS, WORK) - n/a 2 (PB-1, PB-2) - OWNER-Q 1 (ROUTER). Total 3 + 4 + 3 + 0 + 0 + 1 + 4 + 2 + 1 = 18.

### N-xx where the repo value differs from the register (Stages 15-18; both values and locations)

| N-id | Register value (line in `00-numbers-register.md`) | Repo value (file:line) |
|---|---|---|
| N-01 | user 20 / company 300 / edge 600 req/min (:6, :71) | generate 20 (`config/numbers.ts:65`); every other route 120 per user or IP per minute (`numbers.ts:67`, `app.ts:93-101`); company and edge limits absent |
| N-02 | message 32k chars (:71) | prompt max 100,000 (`routes/chats.ts:543`) |
| N-06 | tool steps Fast 1-2 / Normal 5 / Deep 15; turn deadline 10 min (:11) | 16 rounds (`numbers.ts:43`); 59 min (`numbers.ts:39`) |
| N-07 | per-turn tool caps 1-3-8 / 1-3-8 / 2-5-10 / 3-5-10 / 1-3-6 (:12) | none; rounds only |
| N-08 | sandbox time 60 s (Deep 120) (:13, N-68 :75) | 10 s on the Job path (`numbers.ts:51`), 300 s on the warm service (`:53`) |
| N-09 | tool result cap ~8k tokens + pagination (:14) | 6,000 chars read file (`numbers.ts:45`), 30,000 chars run_python (`:47`) |
| N-10 | docs 100 MB, XLSX 50, images 20, audio 500 MB/3 h, ZIP 100 MB/20 files (:15) | project files 30 MB (`numbers.ts:57`), chat attachment 500 MB for every type (`:59`), image 10 MB and 8000 px (`services/attachments/processUpload.ts:35-36`) |
| N-24 | SSE ping 15 s (:29) | 15,000 ms literal without an N-id comment (`routes/chats.ts:814`) - same value |
| N-33 | soft delete 7 d, total <= 30 d (:38) | purge 30 days after deletion (`numbers.ts:61`) |
| N-36 | dated price table (:41) | env JSON, no rows committed (`config.ts:384`) |
| N-37 | Google monthly rate + FBIL; planning 88 (:42, :71) | constant 88 (`numbers.ts:83`) - value same, source rule not built |
| N-42 | <= 2 retries, 1 s -> 2 s full jitter cap 8 s, Retry-After 10 s (:47) | same (`numbers.ts:23-29`) - no difference |
| N-43 | first-token 20/45/90 s, stall 30 s, tools (2/2/20/10/60-120/1 s), turn 10 min (:48) | none, none, only fetch 10 s, turn 59 min, request 600 s (`numbers.ts:35-39`, `webFetch.ts:41`) |
| N-45 | statement 5 s / lock 2 s / idle-in-tx 30 s / recycle 1,800 s / tx retry <= 2 (:50) | none (`db/client.ts:36,52`) |
| N-46 | reconnect 1/2/4/8/16 s + jitter, 5 attempts (:51) | 0/1/2/4/8/15/30/60 s, 8 attempts, no jitter (`arcnave-frontend/src/adapter.ts:163`) |
| N-47 | breaker 5 in 30 s or 50 % of 20 (:52) | none |
| N-49 | access token 15 min, refresh rotation, user idle 24 h / absolute 28 d, owner/admin 24 h, re-auth 10 min (:54) | absolute 336 h (`numbers.ts:73`), no idle, no rotation |
| N-66 | API pool 5 + overflow 5 (:73) | `DB_POOL_MAX=10` (`numbers.ts:71`) |
| N-72 | e-mail code 6 digits / 10 min / 5 tries; limits 1 per 60 s, 5/h, 20/h per IP (:79) | none; auth routes 10 per minute (`config.ts:369`) |
| N-74 | max output Fast 8,192 / Normal 16,384 / Deep 32,768; Claude cache system-prompt breakpoint only (:81) | default 64,000, ceiling 128,000 (`numbers.ts:41`, `config.ts:157`); two cache breakpoints (`anthropic.ts:372,454`) |
| N-18, N-11, N-19, N-20, N-29, N-30, N-57, N-61, N-63, N-64 | company quotas, pool, drift, caps, ceiling | not built (deferred or no code) |

N-23 (API request timeout, 3,600 s on Cloud Run, N-65) is matched by the comment at `config.ts:147-148`; infra.

## 4. Non-KEEP items

### FD-08 / FD-10-L1 - reservations in rupees against the price book
- Exact change: before the call, reserve the worst-case cost (input estimate from the provider's own token count is not available without an estimator; use the model's output ceiling times its output rate plus the previous turn's exact input) in INR from the price book; check against the user's remaining budget and the N-63 daily ceiling (Rs 350/user, GST incl.), release with the real cost. Keep token budgets (owner decision). Worst case per call with the register ceilings: Opus Deep 32,768 output tokens = about Rs 58 (checkpoint 2026-10-10); with the repo's 64,000 default ceiling it would be about double.
- Files touched: `services/usage.ts`, `services/generation.ts` (reserve/release), `db/schema.ts` (+ columns), `routes/usage.ts`. Port source: `arcnave.in:backend/packages/ledger/src/arcnave_ledger/cost.py` (cost of a call); reservations were not built in Python either (block 7).
- Option A (REWRITE on top of the new price book): Time M, risk medium. Option B: keep token-only reservations until pools exist: Time 0; leaves FD-10 layer 1 unmet in rupees.
- Pick: A after CD-1.

### FD-09-L7 - Opus not default
- Exact change: `routeAuto` never selects the `quality` tier on its own; `research_mode`, attachments and long project context map to `balanced`; Opus only on an explicit user choice (model picker) or the "quality" routing preference. Files: `providers/routing.ts:60-76`, `routing.test.ts`, `stickyModel.integration.test.ts`. Port source: none. Option A (REWRITE) S, low risk, changes which model answers file turns (quality owner review needed; Stage 7 profile router will replace the rule). Option B: keep and accept cost (Opus about 4.8x Gemini per turn, FD-02). Pick: A.

### CD-1 / LED-1 - price book as code, exact money
- Exact change: effective-dated price rows in code (`providers/priceBook.ts` or `src/ledger/priceBook.ts`) with a `price_version` id and source note per row: Gemini 3.8 Flash list $1.50 / $7.50 / cached $0.15, 2027-01-01 row (same values), storage $1.00 per 1M token-hours; promo credit 50 % to 2026-12-31 as a separate credit row; Flash-Lite 3.5; Sonnet 5.5 $2 / $10 / write 5 m $2.50 / 1 h $4 / read $0.10; Opus 5.5 $4 / $20 / $5 / $8 / $0.20; Haiku 5.5 two tiers (<= 100,000 prompt tokens $0.10 / $0.50; above $0.50 / $2.50) once the router/worker question is decided; Ranking API row at retrieval; web search $10 per 1,000 (Claude), grounding $14 per 1,000 after 5,000 free. A row is chosen by the call's start time in UTC. Money handled as decimals (micro-USD, paise), rounded half-up per call; stored as `numeric` or integer micros; `price_version` and `fx_inr_per_usd` stored with each call (see stage-17.md OD-13 per-call table). `PRICING_TABLE` env stays only as an override until the switch.
- Files touched: new `src/ledger/{priceBook,cost}.ts`, `services/usage.ts`, `services/generation.ts:2204-2214` (remove the duplicate `computeCostFor`), `config.ts` (override), `db/schema.ts` + migration, `routes/usage.ts`, tests `usage.test.ts`.
- Port source: `arcnave.in:backend/packages/ledger/src/arcnave_ledger/price_book.py` (rows, `price_for`, `promo_for`, tier rule `prompt_tokens_above`), `arcnave.in:backend/packages/ledger/src/arcnave_ledger/cost.py`.
- Option A (NEW-BUILD module beside the env table; read from it; switch the two cost functions to it; keep `null` = unpriced): Time M, risk low, keeps `/usage` running. Option B (REWRITE only the env JSON to carry dates): Time S, still no promo/credit/tier/storage.
- Pick: A. Invariant 2 (null is not zero) is kept: an unknown model has no row -> null.

### FD-10-L4 - kill switch
- Exact change: an ops-set per-model/per-tool switch (settings row) read at turn start; a disabled model is reported as `model_unavailable` with reason `disabled`, never swapped silently (Invariant 1); feeds the breaker (stage-15.md ER-13) and the incident banner (ER-12b). Files: `providers/registry.ts`, `db/schema.ts` (settings), `routes/models.ts`. Port source: none. Option A (NEW-BUILD) S-M. Pick: A.

### FD-26 - Gemini explicit context cache
- Exact change: one cache per enabled tool set holding the base system prompt + tools + tool config; per-turn parts (date, instructions, memory snapshot, summaries, history) in the contents; create/reuse/refresh (TTL 60 min, refresh below 10 min), recreate on expiry or prompt-version change; a cached request carries no system instruction/tools; refused cached call re-sent uncached; hit rate and storage cost recorded in the ledger (cost plan keeps the worst case until the ledger shows the saving, CP1 cached share default 0). Minimum 4,096 tokens: below it, no cache is created and no padding. Expected real saving at 50 users about Rs 5-7 per user per day (2026).
- Files touched: new `providers/geminiCache.ts`, `providers/gemini.ts`, `services/promptCache/*`, `config/numbers.ts` (N-74 values), ledger rows (cache storage line). Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/gemini_cache.py`, tests `test_gateway_cache.py`.
- Option A (NEW-BUILD behind `GEMINI_EXPLICIT_CACHE` on/off, off below the minimum): Time M-L, risk medium. Option B: wait for ledger data, keep Gemini uncached: Time 0, loses the saving.
- Pick: A (locked Phase 1 item).

### N-74c - Claude cache breakpoints
- Exact change: system-prompt breakpoint only (register N-74); the repo adds a second breakpoint on the previous assistant turn (`anthropic.ts:372-374`) to cache growing history. Measure with the ledger (cache read/write columns) before removing: the second breakpoint writes 1.25x on each new turn's prefix and reads 0.05x on the next; it may be cheaper for long chats. If the locked value stands, remove the history breakpoint. Files: `providers/anthropic.ts`, tests `anthropic.test.ts`. Option A (REWRITE) S. Option B: keep and record a deviation ADR (owner Q-C2). Pick: ask owner; default A.

### Other rows
- PB-3 DIFF-INFRA: no repo change. FD-35 NAT per environment is a Terraform item (DF-12).
- POOL, OPS, WORK, FD-10-L23: deferred (`deferred-g4.md` DF-9, DF-12, DF-16).

## 5. Open questions for the owner

- Q-C1. FD-31/FD-36 put a Haiku 5.5 router call on every turn and ADR-0014 runs worker jobs on Haiku; ADR-0055 / B-4 say three models only. Not resolved here; blocks the Haiku price rows being active.
- Q-C2. N-74 "system-prompt breakpoint only" vs the repo's second (history) breakpoint (ADR-0054 Decision 1): accept the locked value, or approve a measured deviation?
- Q-C3. Per-user token budgets are the only cap (owner ADR-0053 #6); N-30 has a per-user 600-turn soft cap (warn 80 %) inside a pool, N-63 Rs 350/user/day ceiling. Keep token budgets, or add a rupee ceiling per user now (FD-08 option A)?
- Q-C4. Auto routing sends attachment and research turns to Opus 5.5 today (FD-09-L7 asks for the opposite). Change now, or wait for the Stage 7 profile router?
- Q-C5. Money columns: switch `cost_usd` / `cost_inr` from doubles to exact decimals now (existing rows convert), or only for new per-call rows?

## 6. KEEP spot-check

3 KEEP rows, 2 re-opened (> 10 %):
- FD-35: `providers/anthropic.ts:44-55` builds the first-party client from `ANTHROPIC_API_KEY`, `maxRetries: 0`, timeout from config; `config.ts:116-131` model ids default to the 5.5 names - confirmed.
- CD-5 / FD-25: `providers/anthropic.ts:441-464` builds system blocks from the stable prefix with no padding; `ENABLE_PROMPT_CACHE` (`config.ts:300`); no cost figure assumes a cache share because there is no cost model with a cached-share parameter yet (that belongs to CD-1) - confirmed, with that caveat.
- Not re-opened: N-37 (constant 88 read from `config/numbers.ts:83`).
