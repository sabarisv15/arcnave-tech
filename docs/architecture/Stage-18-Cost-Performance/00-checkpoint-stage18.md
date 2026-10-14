# ArcNave – Checkpoint · Stage 18 Cost and performance – LOCKED 2026-10-03
_User OK 2026-10-03 after item-by-item review (financial decision log FD-01…FD-20 in 00-Handoff/00-cost-decision-log.md). Final word over 18-cost-performance.md (draft). Evidence: 18-astra-results.md (official prices, 3 Oct 2026). All ₹ at planning FX ₹88/USD, 2027 Gemini prices, before 18 % GST unless stated. Price itself is a business decision; this checkpoint fixes the cost basis and what the architecture must enforce._

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - Review 13–20 revisions: **N-18 search quota = 1,000/company/month (20 % of pool, +1,000 with boost)**; **N-11 OCR quota = 5,000 pages/company/month (+5,000 boost)**; **N-30 keeps per-user soft cap 600 turns/month inside the 5,000 pool** (warn 80 %, hard stop only at pool exhaustion) (R-5…R-7). Costs already covered by FD-05.

> **Doc-sync 2026-10-03 (segment revision FD-21) – see 00-Handoff/00-cost-decision-log.md:**
> - FD-21: general-purpose B2B first; FD-16…FD-19 (college plan ₹50k, 5,000 pool) parked as the academics vertical's cost case. Pool model, boost, Claude add-on, per-user soft cap and quotas remain the generic plan mechanics; per-company price fixed at launch from FD-15/FD-17 floors.

## Docs
| Doc | What |
|---|---|
| 18-astra-prompt.md / 18-astra-results.md | Research prompt + Astra answers (A1–A6 market, B–K prices/limits, NOT FOUND list, conflicts) |
| 18-cost-performance.md | Facts F1–F22, assumptions X1–X13, unit costs, phases, gaps CP1–CP18, Claude-only CC1–CC6, decisions CD-1…CD-16 |
| 00-Handoff/00-cost-decision-log.md | **Financial decision log FD-01…FD-20** – reviewed one by one; every row ends with a per-day ₹ figure |

## Customer segment (new, FD-16)
Colleges – NBA / AICTE / NAAC accreditation work + staff research. Sold **per college** (not per seat), ~50 staff accounts, pooled usage, annual invoice, college-admin self-signup + staff join, accreditation skill packs are the differentiator. Supersedes "generic B2B companies" wording in Stage 1 (company = institution; model unchanged).

## Locked cost basis (worst case – owner rule "plan at worst case, fix price from it")
- **FD-01 tokens/turn:** Fast 3k/6k/0.9k · Normal 14k/6k/2.7k · Deep 50k/6k/9k (fresh in / cached in / out); recalibrate Stage 21.
- **FD-03 turns/user:** 25/active day average, 50/day peak capacity, 22 working days.
- **FD-04 profile mix:** 40 / 45 / 15 Fast/Normal/Deep (worst). Model mix 85 / 13 / 2 Gemini / Sonnet / Opus.
- **FD-02 per turn (helpers incl.):** Gemini 3.8 ₹2.30 (2027 ₹4.37) · Sonnet ₹5.81 · Opus ₹11.29 · mixed ₹2.93 (2027 ₹4.70). GPT Sol 6.1 ₹5.70 at owner-supplied price (reference only, not in stack).
- **FD-05 extras:** ≈ ₹10/user/day (search 20 % of turns, OCR 6 pages/day, embeddings, 5 dictations, parser/artifact compute). **FD-06 Research run:** ₹115 (Gemini) / ₹195 (Sonnet).
- **FD-07 infra:** Phase A pilot no-HA $300/mo (₹880/day) → HA $480 (₹1,408/day) before first paying customer; Phase B $1,180; Phase C $3,500. Infra per user/day: ₹22–32 (50 users) · ₹11 (500) · ₹6 (5,000).
- **FD-08 peak-day ceiling:** **₹350/user/day (GST incl., 2027)**; 2026 ≈ ₹240; 50 users all peaking ₹17,500/day.
- **FD-09 levers adopted:** verify caching (Gemini ≥6,144-token prompt, Claude ≥512); Deep cap 10 %/user; Opus never default (explicit choice inside Claude pool); search quota. **Judge sampling stays synchronous (CD-6 withdrawn – batch saves ₹0.8/day only).** L5 (Normal input 10k), L6 (thinking −20 %), L11 (Flash-Lite as main model for Fast) → Stage 21 quality tests. Conclusion: no large technical savings; cost ∝ tokens.
- **FD-10 controls (PL-6 revised):** (1) own ledger reservations real-time (per turn, per pool, Claude pool, Deep share, search/Research quotas) → (2) alert budgets 50/80/90/100 % email + Pub/Sub → (3) **spend-cap budgets (Preview)** per project+service at 150 % of forecast (Vertex ₹2.7 lakh, Cloud Run ₹30k at 50 users; dev/staging ₹10k) → (4) kill switch; never disable-billing function. Daily ceiling ₹19k, monthly with caps ≈ ₹2.2 lakh at 50 users.
- **FD-11/13 per user per month (GST incl., 2027):** 50 users ₹3,935 · 500 ₹3,190 · 5,000 ₹3,010 (600-turn cap). Scale totals 2027: ₹1.97 lakh · ₹15.9 lakh · ₹1.51 crore (2026: ₹1.48 lakh · ₹11.1 lakh · ₹1.02 crore).
- **FD-12 self-hosting:** no (models: closed; GPUs idle at small scale; infra: 1.4–25 % of cost, redesign risk). Revisit trigger: Gemini spend > ₹5 lakh/month or Stage 21 shows open model fit for Fast/helper roles → helper roles first in Mumbai.
- **FD-14 commitments:** none months 0–6; Phase B: Cloud SQL 1-y CUD 25 %, Redis 20 %, Gemini FSP 10 % on 70 % of forecast (Claude excluded); Cloud Run CUD after utilisation data; Claude PT evaluate at ~1,000 users (> 1 GSU-month ₹2.4 lakh).
- **FD-15 seat floors (ex-GST, 2027):** Standard (Gemini, 300 turns) ₹2,081 / ₹1,447 / ₹1,298 at 50 / 500 / 5,000 users; Pro (mixed, 600) ₹3,335 / ₹2,701 / ₹2,552; realistic 10-turn/day user ₹1,745 / ₹1,111 / ₹962.
- **FD-17/18/19 college plan:** cost per college (5,000-turn pool, 2027): 1 college ₹62k · 5 ₹37k · 10 ₹31k · 100 ₹24k per month. Market: ERP ₹10k–30k/month, staff AI ₹5k–20k own pocket. **Owner price ₹50,000/month (₹6 lakh/year + GST) per college = viable with 5,000 pooled turns (≈100/staff), 50 accounts, Gemini default, Claude add-on ₹2,000/month, Research 5 runs/month, accreditation-season boost +5,000 turns add-on; first 1–3 colleges at a loss (launch cost), profit from ~5 colleges → validate with pilot colleges in Stage 21.**
- **FD-20 Gemini 2027 price:** price book row `effective_from 2027-01-01`; promo credits tracked as credits; renewal price-revision clause in annual contracts (LW-38); hedges L11 + Flex/Batch for non-interactive; monthly price-book review.

## Other locked decisions (CD-1…CD-16, as recommended unless noted)
CD-1 cost model as code + price book with effective dates; FX = Google monthly `currency_conversion_rate` for reconciliation, FBIL 1 PM reference for estimates; GST at invoice level. CD-2 plan with 2027 prices. CD-3 default caps → **replaced by college pool model**: pool 5,000 turns/company/month (season boost +5,000), Deep ≤10 % per user, Research 5 runs/company/month, search 300 queries/company/month, storage 50 GB/company, OCR 1,000 pages/company/month, audio 120 min/user/month, 50 accounts default (per-company override by ArcNave team). CD-4 Claude pool OFF by default; add-on ₹2,000/company/month, 80 % alert. CD-5 caching rules. **CD-6 withdrawn** (judge stays sync). CD-7 spend-control chain. CD-8 infra phases A/B/C. CD-9 commitments timeline. CD-10 Cloud Run billing modes (API request-based; Executor measured; concurrency 4). CD-11 search quota. CD-12 Document AI quota raise to 60 req/min Mumbai + batch >15 pages. CD-13 Next.js on Cloud Run Mumbai; SES provisional (Stage 20); EAS Free → Starter. CD-14 performance targets N-53 kept + capacity list. CD-15 cost telemetry + monthly price-book review. CD-16 numbers register finalised (below).

## Numbers register – Stage 18 values (final unless marked Stage 21)
N-01 user 20 req/min, company 300 req/min, edge 600 req/min/IP · N-02 32k chars · N-03/04 confirmed · N-05 Stage 21 · N-06…N-10 confirmed · N-11 uploads 50/user/day, OCR 1,000 pages/company/month, audio 120 min/user/month, project files 500 · N-12…N-17 confirmed · N-18 300 searches/company/month, web search default OFF · N-19 Research 5 runs/company/month · N-20 long tasks 20/company/month, 2 concurrent/user · N-23 API concurrency 80 / 60 min; Executor concurrency 4 / 15 min · N-25 min instances A 1/1, B 2/3, C 3/5; Executor 2 vCPU/4 GiB · N-29 Claude add-on ₹2,000/company/month, OFF default · **N-30 college pool 5,000 turns/month (+5,000 boost), Deep ≤10 %/user, 50 accounts, 50 GB** · N-36 price book §3.1 of 18-cost-performance.md (Gemini 2027 row) · N-37 FX rule (Google monthly + FBIL; planning ₹88) · N-38 PT at Claude spend > 1 GSU-month for 3 months · N-39 artifacts 5 MB / 20 versions / 50 per chat · N-57 drift 2 % · N-59 assumptions X1–X13 + FD-01/03/04 · N-60 phases · N-61 spend caps 150 % forecast; alert budgets 50/80/90/100 % · N-62 capacity list · **N-63 peak-day ceiling ₹350/user (GST incl.) · N-64 college price ₹50,000/month (business, validate Stage 21)**.

## Registers
LV-100…107 · LW-35…38 · doc-sync Stage 18 section · FD-01…FD-20.

## Next
Stage 19 Infrastructure (results pending), Stage 20 Vendor/tool selection, Stage 21 Implementation plan (incl. pilot-college validation of FD-19, accreditation skill packs).

## Doc-sync 2026-10-04 (Stage 21 Task 0.8 brief – cache minimums, verified against Anthropic docs)
- **FD-09 "Claude ≥512":** Anthropic "Prompt caching" page (2026-10-04): minimum cacheable prompt = **512 tokens** for Sonnet 5.5, Opus 5.5 and Opus 5, but **1,024 tokens** for Sonnet 5; below the minimum the request runs uncached without an error. FD-09 stays correct for the design models (5.5). The dev stand-in Sonnet 5 (ADR-0002) needs ≥1,024 – cache numbers measured on Sonnet 5 are provisional.
- **FD-09 "Gemini ≥6,144":** not yet measured – Task 0.8 measures it (LV-12: prefixes below 4,096, between 4,096 and 6,144, above 6,144 tokens; hits read from `cached_content_token_count`). Rule kept: never pad a prompt to reach the minimum.
- **Token counting (VS-10):** Anthropic page: `count_tokens` is free, an estimate, and does not accept server tools such as web search. Latency and Vertex availability: to be measured in LV-122 (Task 0.8).
- **Observation from LV-108 (provisional, Claude 5):** one Claude web search added ~15,460 input tokens to the call; Opus 5 used a 256-token output limit fully on a one-word prompt – inputs for LV-100.

## Doc-sync 2026-10-04 (Stage 21 Task 0.8 review – cache FAIL open, token counts, quotas)
- **FD-09 caching – NOT confirmed, diagnosis open:** LV-12 (Gemini implicit cache, `global`): 0 hits in 15 calls at 3,387 / 5,235 / 7,293 prefix tokens. LV-02 (Claude prompt cache, `global`, external project, provisional): cache written on every call, never read (2 calls per size). Test code checked: identical prefix on every call. Cause unknown → diagnosis runs LV-12D / LV-02D (more calls, pauses, prompt position, larger prefix, regional control). **Until resolved, the cached-input share in FD-01 / the cost model is an unverified assumption**; if the diagnosis confirms "no cache on global" → ADR + cost-model recalculation before the Model Gateway relies on it (IP-4).
- **Token counts differ by provider:** the same synthetic text = 2,329 Gemini tokens vs 3,452 Claude tokens (≈ +48 %). Budgets and cost estimates must use each provider's own count (input for LV-100).
- **VS-10 token counting:** counts equal billed input tokens (diff 0) on both. Latency median Gemini ≈ 0.3 s, Claude on Vertex ≈ 1.1 s (max 2.7 s) → never count in the request path; cache counts per prompt version as locked.
- **N-62 capacity vs LV-01 read-out (dev project):** Gemini 3.8 Flash global input tokens = 50M/min and 5B/day (assumption was 2M TPM – higher than assumed); Claude Sonnet / Opus = 0 until the quota request is granted.

## Doc-sync 2026-10-04 (Stage 21 Task 0.8 diagnosis – FD-25 / ADR-0003)
- **FD-25 (owner): the cost plan no longer assumes the Gemini implicit-cache discount.** LV-12 + LV-12D: 0 cached tokens in 25 completed calls on `global` (prefix 3.4k–20.7k tokens, system instruction and user content, pauses 0–5 s); cache configuration at default. FD-01 / X6 / X7: the ≈ 6,000 "cached" input tokens of a Gemini turn are planned as normal input until hits are measured in the ledger (LV-101). Effect: +₹0.36 (2026) / +₹0.71 (2027) per Gemini turn (≈ +16 % on FD-02), +₹7.6 / +₹15.1 per user per day mixed, +₹1,780 / +₹3,560 per college per month at 5,000 turns. FD-19 college price unchanged.
- **FD-09 lever "verify caching":** Gemini – not confirmed (FAIL at dev scale). Claude – works on `global` (provisional): reads after 1–4 warm-up writes; X7 "one cache write per ~5 turns" is not confirmed for spaced calls – ratio from the ledger (LV-101).
- **CP5:** "no explicit caches in MVP" stays until LV-128 (explicit shared cache for system prompt + tools: reliability, minimum, request limits, permissions). Storage for one ≈ 8,000-token shared cache ≈ $5.84/month. Prompt layout stays cache-friendly; never pad.
- **Cost model code (CP1):** cached share is a parameter, default 0 for Gemini.

## Doc-sync 2026-10-05 (Stage 21 Task 0.9 review – LV-128 PASS, FD-26 / ADR-0004)
- **CP5 changed:** Gemini **explicit** context cache is built in Phase 1 (one cache per enabled tool set: base system prompt + tools + `VALIDATED`). LV-128: 5/5 hits on `global`, minimum 4,096 tokens.
- **Cost plan unchanged (owner, FD-26 option A):** FD-25 worst case stays the planning basis; CP1 cached share stays default 0 for Gemini until the usage ledger shows the real hit rate and saving (LV-101). Expected real saving at 50 users ≈ ₹5–7/user/day (2026), ₹13–15 (2027) after storage.
- **Price book additions:** Gemini 3.8 Flash cache storage $1 per 1M token-hours; cached input $0.075/M (2026), $0.15/M from 2027-01-01 (Google pricing page, checked 2026-10-05).

## Doc-sync 2026-10-06 (Stage 21 Task 0.12 close)
- **LV-17 PASS – Gemini capacity:** Gemini 3.8 Flash, Standard PayGo, `global`: no 429 up to 2,408,700 input tokens in the busiest 60 s (above the 2M planning figure, N-62); p95 2.3–4.2 s per step; 100-request burst 100 / 100; `traffic_type = ON_DEMAND`. Google Cloud India (sales email, Aug 2026): no manual quota increases for first-party Gemini models (dynamic shared quota); options are Priority PayGo (header `X-Vertex-AI-LLM-Shared-Request-Type: priority`, higher price) and Provisioned Throughput.
- **Claude quota in dev = 0** (LV-01). Console requests (Opus 0 → 60 req/min, Sonnet 0 → 100) were **auto-denied** ("new project … wait 48h … billing history"); escalated by email to the sales contact: Sonnet 100 RPM / 160k input / 40k output TPM, Opus 60 / 80k / 20k (total 160 RPM, 240k / 60k) – pending.
- **Quota limits the rate, not the month:** at the Sonnet level above (160k in + 40k out per minute, $2 / $10 per M) a runaway loop costs ≈ $0.72 / min ≈ ₹63 / min → the R12 cap (₹1,000 / month) is gone in ≈ 16 minutes. Billing budget alert **and** the gateway's own hard cap are both mandatory; quota is not a spend cap. (FX ≈ ₹88 / $, estimate.)
- Document AI: cost unchanged; throughput limited by the 5 pages / min Mumbai default until the quota is raised.

## Doc-sync 2026-10-06 (ADR-0007 – reranker = Vertex Ranking API, owner)
- **FD-27:** Ranking API $1.00 per 1,000 queries (≤ 100 records). Worst case 20 reranks per user per day ≈ $0.02 ≈ **₹1.8 per user per day**; college pool ≤ 4,000 reranks per month ≈ **₹350 per college per month**. The Executor no longer needs 4 GiB for a model (N-25) – memory saving set by measurement. Conditional rerank lowers the count. Price book row added.

## Doc-sync 2026-10-07 (owner – FD-28 / FD-29, Phase 1 infra prep)
- **FD-10 layer 2 (alert budgets) moves from Phase 5 to Phase 1 (FD-29):** two billing budgets in bootstrap Terraform (Task 1.1) – gross usage ₹10,000 / month excluding credits (50 / 80 / 90 / 100 % + forecast) and net charges ₹500 / month including credits (10 / 50 / 100 %), notifying the billing account admins. Amounts proposed – owner confirms before apply. Layers 1 (ledger reservations), 3 (spend caps) and 4 (kill switch) unchanged.
- **FD-28:** Data Access audit logs (Stage 17 OD-5) ≈ ₹0 in dev; production estimate ≈ ₹0.05 / user / day (assumption) – re-measured in Phase 5.
- **Free Trial credit:** ₹28,032.50 left on 2026-10-07, end date 2027-01-03 – real charges start then, the same week as the Gemini price doubling (FD-20).

## Doc-sync 2026-10-08 (owner – FD-31 turn router, ADR-0009)
- **FD-31:** the mini-LLM turn router (ADR-0009, `gemini-3.5-flash-lite` MINIMAL, one call per turn, shadow mode from Phase 1) adds **≈ ₹0.53 / ₹1.06 per user per day** at 25 / 50 turns before GST (≈ ₹0.63 / ₹1.25 incl. GST) – measured tokens from LV-133 (641 in / 19 out); absorbed in the current price (owner, 2026-10-08). Helper-call row FD-04 gains the router call; re-measure from the Phase 1 ledger (LV-100).

## Doc-sync 2026-10-10 (ADR-0012 – Claude through the first-party Claude API)
- **Claude prices (first-party, platform.claude.com, read 2026-10-10, per MTok):** Sonnet 5.5 $2 in / $10 out / $2.50 5-min cache write / $4 1-h write / **$0.10** cache read; Opus 5.5 $4 / $20 / $5 / $8 / $0.20; web search $10 per 1,000. Same base rates as the plan (the cost log's standing-facts line "Sonnet 5.5 cache read $0.20" was a Vertex-era figure – first-party is $0.10; the plan's worst case does not count cache reads, so no figure changes). `inference_geo` `global` = standard price (`us` = 1.1×, not used).
- **Billing:** Claude is billed by Anthropic (USD), not on the Google invoice; Google startup credits do not cover third-party models anyway. New cost: Cloud NAT on `run-main` for Claude egress in staging / prod – **FD-35** (decided by the owner 2026-10-10 19:41 IST).

## Doc-sync 2026-10-10 (Stage 21 Task 1.10 brief – price book as code)
- **CD-1 first step:** the price book is code in `packages/ledger` (effective-dated rows, USD per 1M tokens, each row citing N-36 / FD / page + date): Gemini 3.8 Flash current + **2027-01-01** row (FD-20), cache storage per token-hour; 3.5 Flash-Lite (FD-31); Sonnet / Opus 5.5 first-party incl. cache writes 1.25× / 2× and reads 0.05× (ADR-0012 doc-sync). Cost per model call in USD and ₹ at the **N-37 planning ₹88** (marked planning – block 7 moves the price book to the `price_book` table and the FX to the Google monthly rate); GST at invoice level (CD-1). No ₹ figure of the plan changes.
- **Worst case per call (for block 7 reservations):** Opus 5.5 Deep at the N-74 ceiling 32,768 output tokens ≈ $0.66 ≈ ₹58 before input.

## Doc-sync 2026-10-11 (Stage 21 Task 1.10 Part 1 review – FD-20 (b) as built)
- The Vertex pricing page (read 2026-10-11) shows the 2026 Gemini 3.8 Flash row $0.75 / $3.75 / cached $0.075 with the footnote "Promotional pricing provided through 50% credits back on net spend on select models within a given period." Built per **FD-20 (b)**: the cost of a call = the **list** price $1.50 / $7.50 / cached $0.15 (what the billing export shows); the promotion is a separate credit row (50 %, until 2026-12-31 UTC) logged as `promo_credit_*` next to the list cost; net = list − credit. The credit covers input, cached input and output – **not** cache storage ($1.00 per 1M token-hours, no promotional row); Flash-Lite and Claude have none; the 2027 list price is the same $1.50 / $7.50. Whether "net spend" includes the storage SKU is read from the billing export in block 7. No plan figure changes.

## Doc-sync 2026-10-12 (Stage 21 Task 1.10 close – first measured per-reply cost, dev)
- **Measured on dev** (`auth-smoke chat-models`, short fixed synthetic prompts – not the prompt kit; list price, ₹88 planning FX):
  | Reply | list ₹ | net ₹ (2026 Gemini credit) |
  |---|---|---|
  | Gemini 3.8 Flash Normal, ≈ 4,200 input tokens uncached | 0.69 – 0.71 | 0.34 – 0.35 |
  | Sonnet 5.5 Normal, first turn (writes the 8,751-token system-prompt cache, 5 min) | 2.06 | 2.06 |
  | Sonnet 5.5 Normal, next turn within 5 min (cache read) | 0.15 – 0.21 | same |
  | Opus 5.5 Fast, first turn (its own cache write) | 4.06 | 4.06 |
  Whole run (8 turns incl. Stop and two faults): ₹7.88 list / ₹7.17 net.
- **What it means for the cost plan:** the Claude system-prompt cache write (1.25× on ≈ 8,750 tokens) is most of a first Claude reply; a read costs ≈ 7 % of it. The cache lives 5 minutes and is per model and per effort – an idle gap > 5 min, a model switch or a Fast ↔ Normal switch writes again. Gemini runs uncached on dev (base prompt below the 4,096 minimum – Stage 6 doc-sync 2026-10-12): FD-25 / ADR-0003 "no Gemini cache discount in the plan" is unchanged. Adaptive thinking on trivial prompts used 0 – 13 thinking tokens; real Deep turns are not measured yet (LV-100 stays open – prompt kit with context assembly v1).
- **Dev operations cost:** Cloud SQL left running between the Task 1.9 and 1.10 dev runs ≈ 40 h ≈ ₹280 (FD-22 ≈ ₹7 / running hour) – Stage 19 doc-sync 2026-10-12 adds the stop read-back to every dev-run close.

## Doc-sync 2026-10-12 (owner – FD-36 router model, ADR-0013)
- **FD-36:** the turn router moves to `claude-haiku-5-5` thinking disabled (ADR-0013) – measured in LV-135 at ≈ 1,061 input + 21 output tokens, **$0.000117 per call → ≈ ₹0.26 / ₹0.51 per user per day** at 25 / 50 turns before GST (≈ ₹0.30 / ₹0.61 incl. GST), half of FD-31 (≈ ₹0.53 / ₹1.06). Claude counts the same router prompt as 1.66 × Gemini's tokens; the lower price per token outweighs it. Helper-call row FD-04: the router line now uses FD-36. Price book (CD-1): new row `claude-haiku-5-5` ($0.10 / $0.50 per 1M for prompts ≤ 100,000 tokens, $0.50 / $2.50 above) – Task 1.11 Part 2 item 2.6a. Billing: Anthropic USD invoice (FD-35). No spend while the shadow call is OFF; re-measure from the Phase 1 ledger.

## Doc-sync 2026-10-13 (Stage 21 Task 1.11 close – measured dev cost of the Turn Executor run)
- **Model spend of the run (from the `model_call` lines, list price, FX 88):** `chat-models` ₹8.17, `chat-executor` run 1 ₹8.17, run 2 ₹7.28 = **₹23.62 list, ₹6.20 Gemini promo credit, ₹17.42 net** – the two `chat` smokes (12 turns) are not in this sum, so the real total is a little higher; far under the ≈ ₹100 cap. Per call: Gemini Normal answer ₹0.67 – 0.74 list (₹0.33 – 0.37 credit); ER-3 continuation Gemini ₹1.73 – 2.06 (thinking 2,228 tokens), Sonnet ₹2.22 – 2.26; resume continuations Gemini ₹1.22 – 1.75; cancelled / cut attempts ₹0 (the provider's billing of the input of a cancelled call is not visible – `usage_complete` false, as in Task 1.10).
- **Cloud SQL for the batched run:** started 05:04:55 UTC, stopped 07:55:56 UTC ≈ 2 h 51 min ≈ **₹20** at the FD-22 rate (≈ ₹7 / h); `STOPPED` / `NEVER` read back 13:26 IST. The start operation itself took ≈ 5 min (`MAINTENANCE` first).
- **Executor Cloud Run:** request-billed, min 0; billable instance time 254.5 s for one `chat-executor` run (3 new instances); memory p99 max 4 % of 4 GiB. Cost of a possible **min instances 1** is **not yet computed** – needs an FD row before any pilot (ER-7 / numbers register 2026-10-13).

## Doc-sync 2026-10-14 (Task 1.13 close – worker-job cost)
- Worker-job spend (title now, summary from Task 1.14) is logged with the N-8 call-record fields (`purpose`, `job_id`, `helper_version`) but is **not attributed to a company's Claude limit** (RT-7 / N-29) until block 7 decides (ADR-0014 §4). Planning figure for a title call: ≈ 0.4 – 0.6 k input and ≤ 40 output tokens at Haiku 5.5 prices – negligible; confirm from the first real `usage` lines at the dev run. **Block 7 note:** attributing worker-job cost to the company needs the job's `company_id` in the ledger row.
