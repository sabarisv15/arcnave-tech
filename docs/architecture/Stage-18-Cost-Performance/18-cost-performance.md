# ArcNave – Stage 18 · Cost and performance – DRAFT (superseded by 00-checkpoint-stage18.md where they differ: CD-6 withdrawn, CD-3 replaced by college pool model, segment = colleges)
_2026-10-03 · Source: Astra results 18-astra-results.md (official pricing/docs, 3 Oct 2026, 53 IDs) + numbers register N-01…N-58 + locked stages 1–17 · Labels: ✅ Vendor/official · ⚠️ Partial · 🔧 ArcNave assumption/design · All ₹ figures are ArcNave arithmetic on published USD prices with an assumed FX; they are planning numbers, not quotes._

## 0. Scope and method
Unit-cost model (per turn → per user → per company → per month at 50 / 500 / 5,000 users), fixed infrastructure baseline by phase, cost levers, FX/GST/billing controls, performance and capacity targets with the published limits behind them, and finalisation of the numbers register. Vendor numbers are quoted exactly; every assumption is marked 🔧 and lives in one place (§2) so it can be changed later without touching the design.

**Headline results (assumptions in §2):**
- Model calls are **~90–95 % of total cost** at every scale; infrastructure baseline is ₹27k–45k/month at 50 users and ~₹2.5–3 lakh/month at 5,000 users.
- A turn costs on average **≈ ₹2.5 today / ≈ ₹3.9 from 1 Jan 2027** (Gemini price doubles) at the assumed 85/13/2 Gemini/Sonnet/Opus mix. A pure-Gemini turn ≈ ₹1.9 → ₹3.7; Sonnet ≈ ₹4.9; Opus ≈ ₹9.4.
- At the Stage 1 assumption of **50 turns/user/day**, model cost is **≈ ₹3,700/user/month** (₹2,900 Gemini-only; ₹5,900 from 2027). This is above a Google Workspace Business Standard seat (₹1,300). **Plans must cap usage per seat** (N-30) or price well above ₹4,000/seat – a business decision outside the architecture, but the architecture must enforce the caps (already: budget reservations, RT-7, N-30).

## 1. Market evidence (official pricing/help pages)
| | Claude Team/Ent | ChatGPT Business/Ent | Google Workspace (Gemini incl.) | Perplexity Ent |
|---|---|---|---|---|
| A1 Seat price | Team Standard **$25 / $20 annual**, Premium **$125 / $100**; 2–150 seats; Enterprise $20/seat + metered usage | Business Standard **$25 / $20**, Premium **$125 / $100**; 2-seat min, 200 max new; Enterprise custom | Starter/Standard/Plus **₹650 / ₹1,300 / ₹2,050** monthly (₹540 / ₹1,080 / ₹1,700 annual); INR published; ≤300 users | Pro **$40/mo or $400/yr**, Max **$325/mo** |
| A2 Included usage | Standard 1.25× Pro, Premium 6.25× Pro; 5-h sessions + weekly; 1M context model-dependent; 30 MB/file | Standard 15 Pro msgs/month, Premium 50/week; Instant ~unlimited; 512 MB/file, 80 uploads/3 h | Starter 32k ctx, 5 Deep Research/month; Standard+ 25 Pro prompts/4 h, 300 Thinking/day, 1M ctx, 20 DR/day | Max 10k files, 5k/project, 15 videos/month |
| A3 Overage | Team: extra usage at **standard API rates**; usage-based Enterprise bills every token | shared credits; contracted USD token rates | no public per-token overage; higher access tiers | API billed separately |
| A4 Speed claims | "Priority access" – no numbers | "Fast"/"Fastest" – no numbers | Deep Research 5–10 min/report | none |
| A5 SLA | not published | "SLAs" for eligible Enterprise, no number | Workspace 99.9 % (Gemini Apps not listed as covered) | not published |
| A6 Storage | custom retention; no GB figure | 25 GB/user, 100 GB/org shared | pooled 30 GB / 2 TB / 5 TB per user | file counts only |
**Pattern to copy:** two-tier seats (Standard ≈ $20–25, Premium ≈ $100–125) with usage pools measured in sessions/windows, not message counts; overage at API rates; 1M-context models gated to higher seats; Deep-Research-style features quota'd per month/day. Nobody publishes tokens/s or an inference SLA. ArcNave's per-company Claude ₹ limit (RT-7) is the same shape as Claude's "usage-based Enterprise".

## 2. ArcNave assumptions (🔧 – the only place to edit)
| ID | Assumption | Value |
|---|---|---|
| X1 | FX for planning (N-37) | **₹88/USD** (replace monthly with Google's `currency_conversion_rate` from billing export; FBIL 1 PM reference for intra-month estimates) |
| X2 | GST | **18 %** added on Google Cloud India invoice (INR billing account) – all ₹ below are **before GST** |
| X3 | Turns per user per day | **50** (Stage 1) · lean scenario **20** |
| X4 | Profile mix Fast / Normal / Deep | **50 / 40 / 10 %** |
| X5 | Model mix Gemini 3.8 Flash / Sonnet 5.5 / Opus 5.5 | **85 / 13 / 2 %** (Claude only where company switch ON) |
| X6 | Tokens per turn (uncached input / cached input / output incl. thinking) | Fast **3k / 6k / 0.9k** · Normal **14k / 6k / 2.7k** · Deep **50k / 6k / 9k** (budgets N-03 are caps, these are averages) |
| X7 | Cache | system prompt + tools ≈ 6k tokens cached; one cache write per ~5 turns |
| X8 | Helper calls (Flash-Lite) | **3 per turn** × (2k in / 0.2k out) = planner + safety screen + memory/completion; judge **10 %** of turns × (4k / 0.3k) |
| X9 | Embedding | 1 query embedding/turn (50 tokens); uploads 2 files/user/week × 20 pages × 600 tokens |
| X10 | OCR | 10 % of uploaded pages scanned → Document AI |
| X11 | Web search | 10 % of turns use 1 grounding query |
| X12 | Executor compute per turn | ~30 s active at 2 vCPU / 4 GiB (request-based) |
| X13 | Peak factor | 3–5× average (Stage 1 A4) |

## 3. Unit costs (published USD → ₹ at X1)
### 3.1 Model prices (Vertex GLOBAL, Standard PayGo, USD per 1M tokens) ✅
| Model | Input | Output (incl. thinking) | Cache read | Cache write | Batch/Flex | Notes |
|---|---|---|---|---|---|---|
| Gemini 3.8 Flash (to 31 Dec 2026) | 0.75 | 3.75 | 0.075 | = input | 0.375 / 1.875 | **from 1 Jan 2027: 1.50 / 7.50 / 0.15**; 50 % credits-back promo (track separately); explicit-cache storage $0.000001/token-hour; >200k same price |
| Gemini 3.1 Flash-Lite | 0.25 | 1.50 | 0.025 | = input | 0.125 / 0.75 | audio input 0.50 |
| Claude Sonnet 5.5 | 2 | 10 | 0.20 (0.1×) | 2.50 (5 m) / 4 (1 h) | 50 % off (regional only, K6) | **1M context at standard rate – no >200k surcharge** (corrects earlier assumption) |
| Claude Opus 5.5 | 4 | 20 | 0.20 (**0.05×**) | 5 / 8 | 50 % off (regional only) | same; Priority for Claude NOT FOUND; direct-API "fast mode" not on Vertex |
| Gemini Embedding 2 | 0.20 text (0.10 batch) | – | – | – | | image 0.45, video 12; GA; 1,536 dims supported; 8,192 max input |
| Gemini Priority | 1.8× Standard | | | | | emergency lever only |
| Web Grounding (Gemini 3) | **$14 / 1,000 queries** after 5,000 free/month | | | | | billed per query, not prompt |
| Claude web_search (direct) | $10 / 1,000 + result tokens | | | | | Vertex numeric rate NOT FOUND; needs org policy `vertexai.allowedPartnerModelFeatures` |
| Document AI Enterprise OCR | $1.50 / 1,000 pages (first 1,000 free) | | | | | Mumbai processor listed; sync 15 pages, 6 req/min/processor default |
| Speech-to-Text v2 | $0.016/min (≤500k min) | | | | | only if Gemini audio is replaced (Stage 20) |
| Model Armor | free 2M tokens/month, then $0.10/M | | | | | shadow trial sampled to stay in free tier |
| Sensitive Data Protection | $3/GiB after 1 GiB free | | | | | Later |

### 3.2 Cost per turn (ArcNave arithmetic, X6–X8)
| Profile | Gemini 3.8 (2026) | Gemini 3.8 (2027) | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|---|
| Fast | $0.0070 (₹0.61) | $0.0139 | $0.0192 (₹1.69) | $0.0372 (₹3.27) |
| Normal | $0.0220 (₹1.93) | $0.0440 | $0.0592 (₹5.21) | $0.1172 (₹10.31) |
| Deep | $0.0726 (₹6.39) | $0.1452 | $0.1942 (₹17.09) | $0.3872 (₹34.07) |
| **Weighted (X4)** | **$0.0195 (₹1.72)** | $0.0391 (₹3.44) | **$0.0527 (₹4.64)** | **$0.1042 (₹9.17)** |
| + helpers/judge/embedding (all turns) | **$0.00255 (₹0.22)** – Flash-Lite 3 calls ≈ $0.0021, judge ≈ $0.00035, embedding ≈ $0.00001 | | | |
| **Blended turn (X5)** | **$0.0281 ≈ ₹2.47 (2026) · $0.0447 ≈ ₹3.93 (2027)** | | | |
Executor compute per turn ≈ **$0.0017 (₹0.15)** (X12) – ~6 % of model cost. API-service SSE relay share per turn is negligible (concurrency 80).

### 3.3 Cost per user per month (X3 = 50 turns/day → 1,500 turns/month)
| Scenario | Model + helpers | Compute | Search/OCR/embedding | **Total ₹/user/month (before GST)** |
|---|---|---|---|---|
| Blended 85/13/2, 2026 | ₹3,710 | ₹225 | ₹190 | **≈ ₹4,100** |
| Blended, 2027 prices | ₹5,900 | ₹225 | ₹190 | **≈ ₹6,300** |
| Gemini-only user, 2026 | ₹2,910 | ₹225 | ₹190 | **≈ ₹3,300** |
| Lean user (20 turns/day, Gemini-only, 2026) | ₹1,160 | ₹90 | ₹80 | **≈ ₹1,350** |
Search is the biggest non-model variable: 10 % of 1,500 turns = 150 queries × $0.014 = **₹185/user/month** → per-company search quota (N-18) matters.

### 3.4 Monthly totals (X3–X12, before GST, before fixed baseline)
| Users | Turns/month | Model + helpers | Compute | Search/OCR/embed | **Variable total** |
|---|---|---|---|---|---|
| 50 | 75,000 | $2,107 | $128 | $37 (search mostly in free 5,000) | **$2,270 ≈ ₹2.0 lakh** (2027: ₹3.1 lakh) |
| 500 | 750,000 | $21,073 | $1,275 | $1,002 | **$23,350 ≈ ₹20.5 lakh** (2027: ₹31.5 lakh) |
| 5,000 | 7,500,000 | $210,727 | $12,750 | $10,646 | **$234,000 ≈ ₹2.06 crore** (2027: ₹3.16 crore) |

## 4. Fixed infrastructure baseline (Mumbai list prices ✅, sizing 🔧)
| Component | Phase A (≤100 users) | Phase B (≤1,000) | Phase C (5,000) | Price basis |
|---|---|---|---|---|
| Cloud SQL PG18 | Enterprise 2 vCPU/8 GiB **no HA** $121 → **HA $243** before first paying customer; 50 GiB SSD $10 (HA $20); backups ~$5 | Enterprise 4 vCPU/16 GiB HA $486 + 200 GiB SSD HA $82 | **Enterprise Plus** 8 vCPU/64 GiB HA $1,770 + 500 GiB SSD HA $204 + data cache 64 GiB $25 | $0.0496/vCPU-h, $0.0084/GiB-h (HA ×2); Plus N2 $0.1289/$0.0218 HA; SSD $0.204/GiB-mo ($0.408 HA); backups $0.096/GiB-mo; CUD 25 %/1 y |
| Memorystore Redis | Basic 1 GiB **$46** → Standard HA **$80** at HA switch | Standard 5 GiB (M2) $256 | Standard 10 GiB $511 | $0.063 / $0.110 per GiB-h (M1); M2 $0.070 Standard |
| Cloud Run min instances (idle) | API 1 × (1 vCPU/1 GiB) $13 + Executor 1 × (2/4) $39 = **$52** | API 2 + Executor 3 ≈ $145 | API 3 + Executor 5 ≈ $235 | idle $0.0000025/vCPU-s and /GiB-s |
| Cloud Run active compute | in §3 (per turn) | | | $0.000024/vCPU-s, $0.0000025/GiB-s, $0.40/M requests; 100 ms rounding |
| Global ALB + Cloud Armor Standard | 5 rules $18 + Armor $5 policy + ~10 rules $10 + requests + $0.01/GiB ≈ **$40** | ≈ $70 | ≈ $150 (50M req × $0.75 + data) | $0.025/h first 5 rules; Armor $5/policy, $1/rule, $0.75/M req |
| Logging / Monitoring / Trace | within free tiers (50 GiB, 150 MiB, 2.5M spans) ≈ **$0–20** | ≈ $60 | ≈ $250 (≈300 GiB logs) | §F1 |
| Secret Manager, KMS(Later), Artifact Registry, Scheduler, Tasks, DNS, certs, BigQuery | ≈ **$12** | ≈ $20 | ≈ $40 (Tasks 10M ops $4) | listed in D4–D6/E3 |
| reCAPTCHA Enterprise | free ≤10k assessments | $8 flat (10k–100k) | $8 + $1/1k >100k | E2 |
| Web (Next.js on Cloud Run) | ≈ $15 (1 min instance) | ≈ $30 | ≈ $60 | alternative Vercel Pro $20 + usage; functions default US (G1) |
| Expo EAS | Free (≤1k update MAU, 15 builds) | Starter $19 (3k MAU) | Production $199 (50k MAU) | G2; Play $25 one-time |
| Email (SES Mumbai, provisional) | ≈ $1 | ≈ $10 | ≈ $60 | $0.10/1k |
| **Baseline total (before GST)** | **≈ $300 (no HA) → $480 (HA) ≈ ₹26k–42k** | **≈ $1,200 ≈ ₹1.05 lakh** | **≈ $3,300 ≈ ₹2.9 lakh** | |
Fixed baseline is **13 % of total at 50 users, ~1.4 % at 5,000**. Cost control = model-token control.

## 5. Key facts that change earlier assumptions
| ID | Fact | Effect |
|---|---|---|
| F1 | Gemini 3.8 Flash price **doubles 1 Jan 2027** ($1.50/$7.50) ✅ | Plan pricing and budgets use 2027 rates; 2026 50 % credits-back promo tracked as credit, not price |
| F2 | Claude Sonnet/Opus 5.5 **1M context at standard rate**, no >200k surcharge ✅ | Deep budget 200k (N-03) stays for quality/latency, not price; Opus cache read is 0.05× |
| F3 | **Claude batch not supported on GLOBAL endpoint**; batch jobs regional + same-region BQ/GCS ✅ | No Claude batch discount in our GLOBAL design (would need regional endpoint + India-region job → LV-1 check later) |
| F4 | Gemini batch 50 % on Flash 3.8 / Flash-Lite incl. GLOBAL, 24 h target; **cache + batch discounts don't stack** (guide) vs lower cached-batch rows (price page) ⚠️ conflict | Use batch for offline jobs (embedding backfill, map-reduce, memory consolidation, **judge sampling**); plan with the non-stacking rule |
| F5 | Gemini implicit cache minimum **6,144 tokens** for 3.8 Flash (explicit 4,096); explicit storage $0.000001/token-hour; TTL default 60 min ✅ | System prompt + tool block must exceed 6,144 tokens or implicit cache never hits → measure (LV-12 already); explicit cache per company not worth it (8k tokens × 730 h ≈ $6/company/month) |
| F6 | Gemini 3.8 thinking levels LOW/MEDIUM/HIGH only (**no MINIMAL**), default MEDIUM; thinking billed as output ✅ | Fast = LOW, Normal = MEDIUM, Deep = HIGH (Stage 7 mapping confirmed) |
| F7 | Claude effort low/medium/high/xhigh/max; defaults Sonnet high, Opus medium; Opus adaptive thinking always on ✅ | Fast profile on Claude must set effort low explicitly |
| F8 | **Spend-cap budgets (Preview)** can block new usage per project + service (Vertex, Cloud Run) at 100 %; in-flight continues; manual lift, ≤1 h recovery ✅ | New hard backstop in PL-6 chain (never the disable-billing function); alerts-only budgets never cap |
| F9 | Welcome $300 credit **cannot cover partner models (Claude)**; FSP gives **no discount on third-party models** ✅ | Claude cost is always full price; FSP 10 %/1 y only on Gemini/Google SKUs – Later |
| F10 | Gemini Standard PayGo usage tiers: tier 1 **2M TPM** ($10–250/30 d), tier 2 4M, tier 3 10M, tier 4 50M; no RPM; bursts throttled ✅ | At 5,000 users peak ≈ 20 turns/s × ~20k = ~400k TPM → tier 1 suffices on average, peaks need tier 2 (auto by spend) |
| F11 | Claude GLOBAL lineage quotas: Sonnet 2,500 QPM / 25M input TPM / 2.5M output TPM; Opus 2,000 / 20M / 2M ✅ | Ample; "80 %" alert redefined in Stage 17 stands |
| F12 | PT: Sonnet 525 weighted tok/s per GSU, Opus 261; $2.74–7.14/GSU-hour by term ✅ | 1 GSU Sonnet ≈ $2,000–5,200/month ≈ ₹1.8–4.6 lakh → PT only when Claude spend exceeds that steadily (N-38) |
| F13 | Document AI Mumbai: **6 requests/min/project/processor** default, 15 pages/sync, 500/batch, 5 concurrent batch ✅ | Hard limit for the file lane → quota increase before launch (LV-79) + batch path for >15 pages |
| F14 | Cloud Tasks HTTP task max **30 min**, payload 1 MiB; 500 dispatch/s; Cloud Run request 60 min ✅ | Research 30-min cap sits exactly on the Tasks limit → Research runs as Cloud Run jobs (Stage 10 ≥10 min rule) |
| F15 | Claude on Vertex **payload 30 MB** ✅ | File-text/image adapter budgets bytes as well as tokens |
| F16 | Cloud Run billing: request-based idle min-instance rates; instance-based 1-min minimum, 28 %/46 % CUD; no published break-even ✅ | API stays request-based; Executor mode decided by measured utilisation (LV) |
| F17 | Cloud SQL Enterprise PITR 1–7 d (Plus 1–35 d), same-region WAL no extra cost ✅ | N-32 7 d confirmed |
| F18 | GST: Google Cloud India invoices **18 % regardless of GSTIN**; INR billing supported; FX set monthly by Google (`currency_conversion_rate`) ✅ | X1/X2; RCM question for lawyer if seller is Google Asia Pacific |
| F19 | Vercel functions default US (iad1), Mumbai bom1 exists, India-only storage NOT FOUND ✅ | Next.js on Cloud Run Mumbai (E-1 confirmed) |
| F20 | Email vendors: SES Mumbai region ($0.10/1k); SendGrid/Mailgun/Postmark/Resend US/EU only ⚠️ | SES provisional; Stage 20 final |
| F21 | Vertex billing labels PayGo only; Cloud Run billing labels need **revision/template** labels ✅ | Terraform sets template labels `env/service` |
| F22 | Observability prices unchanged vs Stage 17 (N-58) ✅ | — |

## 6. Gaps / design items (CP)
| # | Item | Label | MVP/Later |
|---|---|---|---|
| CP1 | **Cost model as code**: `cost_model.py` with X1–X13 as inputs, prices as a versioned table (`price_book` in DB, effective dates – Gemini 2027 row pre-loaded); ledger uses the same price_book for INR per call (Stage 7 ledger) | 🔧 | MVP |
| CP2 | **Price book + FX**: prices USD with `effective_from`; FX = Google monthly rate for reconciliation, FBIL 1 PM reference for daily reservation estimates; GST 18 % applied at invoice level only (not per turn) | ✅ H1/H3 | MVP |
| CP3 | **Usage caps per seat (N-30 defaults)**: self-signup plan default **600 turns/user/month** (≈20/day), Deep ≤10 % of a user's turns, Research 5 runs/company/month, web search 300 queries/company/month, storage 5 GB/company, OCR 1,000 pages/company/month, audio 120 min/user/month; limits editable per company by ArcNave team; soft-warn at 80 % | 🔧 | MVP |
| CP4 | **Claude per-company limit (N-29)**: default OFF; when ON default **₹2,000/company/month** reservation pool, 80 % alert (Stage 17 OD-9) | 🔧 | MVP |
| CP5 | **Caching rules**: Claude: cache_control on system+tools (≥512 tokens), 5-min default, 1-h only for Research helpers; Gemini: keep system+tools ≥6,144 tokens for implicit cache (verify LV-12), no explicit caches MVP | ✅ J1/J2 | MVP |
| CP6 | **Batch**: Gemini batch (50 %) for embedding backfill, whole-document map-reduce, memory consolidation, judge sampling (VD-11 moves to batch where latency allows: annotate within ~hours instead of ~2 s → **decision CD-6**); Claude batch not used (GLOBAL) | ✅ F3/F4 | MVP |
| CP7 | **Helper budget**: ≤3 Flash-Lite calls/turn average (~9 % of turn cost); planner skipped on Fast when no files (Stage 12 D3 rule) | 🔧 | MVP |
| CP8 | **Spend controls chain (PL-6 revised)**: app budget reservations → per-company caps → **spend-cap budgets (Preview) per project+service** at 150 % of monthly forecast for Vertex + Cloud Run → kill switch; alerts-only budgets at 50/80/90/100 % → Pub/Sub + email; never disable billing | ✅ H4 | MVP |
| CP9 | **Infra phases A/B/C** (§4) with HA switch before first paying customer; Enterprise Plus + data cache at Phase C; Redis Standard at HA switch | ✅ D1/D2 | MVP A |
| CP10 | **Commitments**: none in first 6 months; then Cloud SQL 1-y CUD (25 %) + Redis 1-y (20 %) when size stable; Cloud Run instance-based CUD only after utilisation data; Gemini FSP 10 % evaluated at Phase B; PT when Claude spend > 1 GSU cost steadily | ✅ | Later |
| CP11 | **Cloud Run billing modes**: API request-based (SSE idle shares instance); Executor measured – switch to instance-based if CPU utilisation outside requests or >60 % steady; concurrency Executor 4/instance (2 vCPU/4 GiB, reranker RAM) 🔧 | ✅ J4 | MVP |
| CP12 | **Web search cost**: Gemini grounding counted per query → per-company quota (CP3), 5,000 free/month absorbs Phase A; Claude native search charged into company Claude pool; org policy `vertexai.allowedPartnerModelFeatures` must allow web search (Stage 19) | ✅ B1/K3 | MVP |
| CP13 | **Document AI quota**: request 60 req/min Mumbai before launch; >15 pages → batch processor; OCR only scanned pages (X10) | ✅ I7 | MVP |
| CP14 | **Egress**: Vertex GLOBAL traffic egress tariff not published → budget line "network" 2 % of compute until first invoice | ⚠️ C4 | MVP |
| CP15 | **Performance targets (N-53 kept, vendor publishes none)**: first-visible p90 Fast ≤3 s / Normal ≤8 s; retrieval p95 ≤800 ms; file fast-lane ≤10 s; Research ≤30 min; capacity: tier-1 2M TPM Gemini, Claude 25M TPM, Tasks 500/s, Cloud Run 1,000 conc/instance, Doc AI 60 req/min after raise, GCS 1k writes/s ramp | ✅/🔧 | MVP |
| CP16 | **Cost telemetry** (Stage 17 OD-12) + monthly "price book review" job: diff pricing pages → ticket; Gemini 2027 switch pre-scheduled | 🔧 | MVP |
| CP17 | Web hosting = Next.js on Cloud Run Mumbai; EAS Free → Starter; SES provisional → Stage 20 | ✅ G1–G3 | MVP |
| CP18 | **Pricing floor for business plan** (information for the team, not architecture): cost/user ≈ ₹1,350 (lean) – ₹4,100 (heavy, 2026) – ₹6,300 (heavy, 2027) + 18 % GST + fixed share → seat price or caps must cover this | 🔧 | — |

## 7. Claude-only (CC)
| # | Fact | Rule |
|---|---|---|
| CC1 | 1M context standard price; Opus cache read 0.05×; 512-token cache minimum; 4 breakpoints; TTL from request start | CP5; Deep budget unchanged |
| CC2 | Batch unsupported on GLOBAL endpoint; 4 concurrent batch jobs/project | no Claude batch MVP |
| CC3 | No Priority PayGo price/capacity published for Claude on Vertex; fast mode direct-API only | no Claude speed lever; PT is the only capacity lever (N-38) |
| CC4 | Lineage quotas Sonnet 2,500 QPM/25M TPM; 529 mapping on Vertex not found | Stage 15 ER mapping stays; LV-18 |
| CC5 | Payload 30 MB; web search needs org-policy allow; search = third-party provider | adapter byte budget; Stage 19 policy; LW-07 |
| CC6 | Welcome credit + FSP never apply to Claude | full-price planning |

## 8. Decisions (recommendations – need OK)
| ID | Question | Recommendation |
|---|---|---|
| **CD-1** | Cost model | Code + price book with effective dates (CP1/CP2); FX = Google monthly rate, FBIL for estimates; GST at invoice level |
| **CD-2** | Which prices to plan with | **2027 Gemini prices** for plans/budgets; 2026 promo credits tracked separately (F1) |
| **CD-3** | Default usage caps (N-30) | CP3 values; per-company override by ArcNave team |
| **CD-4** | Claude pool default (N-29) | OFF; ON = ₹2,000/company/month, 80 % alert (CP4) |
| **CD-5** | Caching | CP5 (Claude 5-min, 1-h for Research; Gemini implicit only, prompt ≥6,144 tokens) |
| **CD-6** | Batch | Gemini batch for offline jobs incl. **judge sampling moved to batch** (annotation arrives later, hours not seconds) ; Claude batch not used |
| **CD-7** | Spend controls | PL-6 revised chain with Preview spend-cap budgets (CP8) |
| **CD-8** | Infra phases | A/B/C sizing (§4); HA before first paying customer; Enterprise Plus at Phase C |
| **CD-9** | Commitments | None first 6 months; then SQL/Redis 1-y CUD; FSP evaluate Phase B; PT only above 1-GSU cost (CP10) |
| **CD-10** | Cloud Run billing modes | API request-based; Executor measured (CP11); concurrency Executor 4 |
| **CD-11** | Search cost | per-company quota 300 queries/month default; Claude search in Claude pool (CP12) |
| **CD-12** | Doc AI quota | raise to 60 req/min Mumbai before launch; batch >15 pages (CP13) |
| **CD-13** | Hosting/email/EAS | Next.js on Cloud Run; SES provisional; EAS Free→Starter (CP17) |
| **CD-14** | Performance targets | keep N-53 + capacity list (CP15); no vendor SLO exists to borrow |
| **CD-15** | Cost telemetry | OD-12 + monthly price-book review (CP16) |
| **CD-16** | Numbers register | finalise §9 values (N-01…N-58) as "Stage 18 confirmed" with Stage 21 tests where marked |

## 9. Numbers register – Stage 18 column (proposed)
| # | Stage 18 value |
|---|---|
| N-01 | user 20 req/min, company 300 req/min (burst 2×), Cloud Armor edge 600 req/min/IP |
| N-02 | message 32k chars (~8k tokens) |
| N-03/N-04 | confirmed 16k/48k/200k; 6k/20k/80k |
| N-05 | 30k (test arm 100k) – Stage 21 |
| N-06…N-09 | confirmed as locked |
| N-10 | confirmed |
| N-11 | uploads 50/user/day; OCR 1,000 pages/company/month; audio 120 min/user/month; project files 500 |
| N-12…N-17 | confirmed |
| N-18 | 300 search queries/company/month; web search default OFF |
| N-19 | Research 5 runs/company/month default (run caps unchanged) |
| N-20 | long tasks 20/company/month; 2 concurrent/user |
| N-21 | → N-43 |
| N-22 | confirmed |
| N-23 | API concurrency 80, timeout 60 min (SSE ≥20 min); Executor concurrency 4, timeout 15 min |
| N-24 | confirmed |
| N-25 | min instances Phase A: API 1 / Executor 1; B 2/3; C 3/5; Executor 2 vCPU/4 GiB |
| N-26…N-28 | confirmed |
| N-29 | Claude pool default OFF; ON = ₹2,000/company/month |
| N-30 | 600 turns/user/month; Deep ≤10 %; storage 5 GB/company; seats unlimited within plan |
| N-31…N-35 | confirmed |
| N-36 | **price book §3.1** (incl. Gemini 2027 row, grounding $14/1k, Doc AI $1.50/1k, Embedding 2 $0.20) |
| N-37 | FX: Google monthly `currency_conversion_rate` (reconciliation) + FBIL 1 PM IST reference (estimates); planning ₹88 |
| N-38 | PT decision point: Claude spend > 1 GSU-month (~$2,000–5,200) for 3 consecutive months |
| N-39 | artifacts: 5 MB each, 20 versions kept, 50 per chat |
| N-40…N-49 | confirmed |
| N-50…N-56 | confirmed |
| N-57 | ledger vs billing drift tolerance **2 %** per model per day → ticket |
| N-58 | confirmed (observability prices unchanged) |
| **N-59 (new)** | Cost assumptions X1–X13 (this doc §2) |
| **N-60 (new)** | Infra phases A/B/C sizing (§4) |
| **N-61 (new)** | Spend-cap budgets at 150 % of monthly forecast per project+service; alert budgets 50/80/90/100 % |
| **N-62 (new)** | Capacity: Gemini tier-1 2M TPM; Claude 2,500 QPM/25M TPM; Doc AI 60 req/min (after raise); Tasks 500/s; Cloud Run 1,000 conc/inst |

## 10. LV-1 / Stage 21
1. Measure real tokens per turn by profile (X6) on the prompt test kit → recalibrate cost model.
2. Verify Gemini implicit-cache hit rate with our system prompt size (≥6,144 tokens) and Claude cache read ratios in the ledger.
3. Executor CPU utilisation + concurrency 4 under load (Locust) → request- vs instance-based decision; min-instance cold-start effect.
4. Cached-batch billing rule (F4 conflict) observed on first batch invoice.
5. Spend-cap budget (Preview) dry run on dev project: block + recovery time.
6. Document AI 60 req/min quota granted; batch path timing.
7. Billing export `currency_conversion_rate` + labels visible; ledger drift ≤2 %.
8. First invoice: egress line for Vertex GLOBAL traffic (CP14) and GST/seller check (LW-35).

## 11. Lawyer list additions
LW-35 GST treatment: Google Cloud India (18 %) vs Google Asia Pacific (0 % with GSTIN, RCM by recipient) – which entity invoices us; input credit · LW-36 Claude "Separate Offering" model-card terms on Vertex – contract chain for customers · LW-37 Email provider DPA (SES/Zoho) for verification mails containing user email addresses.

## 12. Doc-sync debt
- Stage 1/2: cost numbers; Gemini 2027 price; seat-cap requirement.
- Stage 4 L8 PL-6: spend-cap budgets chain; FSP/CUD timing; Cloud Run billing modes; labels on revision template.
- Stage 7: price book + FX rule; Claude 1M standard price; no Claude batch; effort mapping confirmation; Opus cache read 0.05×.
- Stage 9: Doc AI 6 req/min default → quota raise; batch >15 pages.
- Stage 10: Research as Cloud Run jobs (Tasks 30-min limit); Research quota default.
- Stage 12/13: judge sampling via batch (CD-6); embedding batch.
- Stage 17: price-book review job; N-57 = 2 %.
- Registers: N-01…N-62 Stage 18 column, LW-35…37, LV-100…107.

## 13. Sources
cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing · consumption-options · priority-paygo · standard-paygo · quotas · partner-models/claude (quotas, batch, web-search) · provisioned-throughput/supported-models · context-cache-overview · batch-inference · thinking · gemini-3-8-flash guide · embedding-2 · cloud.google.com/run/pricing + run/cud + run/quotas + billing-settings + cpu + min-instances · sql/pricing + storage-options + configure-pitr + quotas + data-cache · memorystore redis/cluster/valkey pricing + quotas · storage/pricing + request-rate + signed-urls · tasks/scheduler/pubsub pricing + tasks quotas · secret-manager/kms/artifact-registry/binary-authorization/artifact-analysis pricing · bigquery/pricing · vpc/network-pricing · armor/pricing + common-use-cases · security/products/recaptcha · certificate-manager/dns/cdn pricing · security-command-center/pricing + cloud-run-threat-detection · products/observability/pricing · docs free-cloud-features · cuds-flexible-savings-plans · billing currency / vat-overview / budgets / budgets-spend-caps / disable-billing-with-notifications · model-armor · sensitive-data-protection/pricing · document-ai pricing/limits/quotas/processors-list · speech-to-text + text-to-speech pricing · platform.claude.com pricing, prompt-caching, batch-processing, effort, thinking, token-counting, code-execution-tool, errors, models overviews, claude-on-vertex-ai · claude.com/pricing · support.claude.com Team plan + usage credits · help.openai.com business models/limits, flexible pricing, file uploads · openai.com/business/pricing · knowledge.workspace.google.com payment plans · workspace.google.com/pricing + terms/sla · support.google.com/gemini 14620100 · perplexity.ai help-center pricing/Enterprise Max · vercel.com pricing/regions/bom1/functions · expo.dev pricing + usage-based-pricing · Play registration · SendGrid/Mailgun/SES/Resend/Postmark pricing + privacy · fbil.org.in notices · cbic-gst.gov.in Notification 10/2017 IGST · github.com/pgvector/pgvector.
