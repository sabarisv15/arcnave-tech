# ArcNave – Stage 7 · Model routing – DRAFT
_2026-10-02 · Source: GPT Astra (official URLs + quotes, checked 2 Oct 2026) + saved facts · Status: **LOCKED 2026-10-02** (RT-1–RT-10 + 7.9–7.14, user OK) · STAGE 7 COMPLETE_

> **Doc-sync 2026-10-03 (Stage 12) – Stage 12 Retrieval (see Stage-12-Retrieval/00-checkpoint-stage12.md):**
> - Model registry: **M3 query planner = gemini-3.1-flash-lite** (provisional; Stage 21 vs Gemma 4 26B / gpt-oss-20b; GLM rejected – costlier, EN/ZH only); **M4 = Gemini Embedding 2** (GA, 1,536 dims); **M5 reranker = bge-reranker-v2-m3 int8 inside Turn Executor** (provisional). Gemini 2.5 Flash-Lite retires 20 Oct 2026 – not used.


> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - Capability matrix additions (Stage 9): Claude 5.5 PDF ≤600 pages (needs 1M context), image tokens = ceil(w/28)×ceil(h/28) (max ~4,784/image), >20 images → ≤2,000 px; Gemini 3.8 Flash Vertex PDF 50 MB / 3,000 pages, 560 tokens/page, images ≤3,000 incl. HEIC; Gemini native document MIME types = application/pdf + text/plain.


> **Doc-sync 2026-10-03 (Stage 17) – see Stage-17-Observability/00-checkpoint-stage17.md:**
> - Usage ledger: `provider_request_id` → `provider_ref_type` + `provider_ref` (Message id / header / null – Vertex header not guaranteed); `usage_source` ('provider' | 'estimated'). Claude stream usage: `message_delta.usage` is **cumulative – replace, don't sum**; thinking tokens = `usage.output_tokens_details.thinking_tokens` on final delta only; `output_tokens` = billed total; fields nullable (OD-13).
> - `X-Vertex-AI-Labels` low-cardinality only (`env`, `profile`, `service`), PayGo only. `anthropic-ratelimit-*` headers not documented on Vertex → 429-rate + spend-rate alert instead of 80 % quota (OD-9/OD-12). Three latency clocks: `provider_ttft`, `first_visible_ms`, `turn_total_ms` (OD-8).

> **Doc-sync 2026-10-03 (Stage 18) – see Stage-18-Cost-Performance/00-checkpoint-stage18.md + 00-Handoff/00-cost-decision-log.md:**
> - Price book with `effective_from` (Gemini 3.8 doubles 1 Jan 2027); FX = Google monthly rate (reconciliation) + FBIL reference (estimates). Claude 5.5: 1M context standard price, Opus cache read 0.05×; **Opus never default** (explicit user choice inside Claude pool); no Claude batch on GLOBAL endpoint. Effort mapping confirmed (Gemini LOW/MEDIUM/HIGH, no MINIMAL; Claude effort low on Fast). Flash-Lite as main model for Fast turns = Stage 21 quality test (L11). Per-turn cost reference FD-02.

## Real-product evidence
| | ChatGPT Business/Ent | Claude Team/Ent | Gemini app/Workspace | Perplexity Ent |
|---|---|---|---|---|
| Auto choice | Adds reasoning automatically on Instant; formula not documented | No task-based Auto; automatic **safety** fallback Sonnet 5.5 → Sonnet 5 (labelled) | Manual tiers (Flash-Lite / Flash / Pro) | **Best** picks model by query type ✅ |
| Override + label | User picks reasoning level; per-answer model label not documented | Model + effort shown in composer; fallback answers labelled ✅ | Pick by model name | Custom → pick model |
| Fast vs thinking | Instant/Medium/High/Extra High = same model, different effort ✅ | Effort low…max separate from thinking; 5.5 thinking can't be turned off; Ent admins cap effort ✅ | Flash-Lite speed, Flash balanced, Pro complex | Thinking toggle |
| Limit / outage | Continue with another model, credits, or wait; reset time shown | Warn → block with reset time, or usage credits; capacity → "try again soon" | Continue with Fast in same chat; notifications | Restricted in heavy usage |
| Mid-chat switch | Per-message model choice ✅ | Next response uses new setting ✅ | Continue with Fast ✅ | Change in session ✅ |
| Admin restrict | Eligible models per role ✅ | Ent: enable/disable models, role subsets, effort caps ✅ | Gemini on/off; per-model not documented | Restrict providers or models ✅ |
**Pattern:** model and effort are chosen separately; automatic routing exists but criteria are not published; fallbacks/limits are labelled to the user.

## Key vendor facts
- No managed cost/quality router covers Gemini + Claude (Model Optimizer = 2025 experimental, docs removed; API Gateway model routing = preview, routes by tag only). → own router.
- Google: Flash-Lite recommended for "intent routing … classification". Anthropic: routing = classify then specialise. OpenAI: baseline with capable model, then shrink with evals. No official router latency number.
- Router/small-role candidates (GA, global): `gemini-3.5-flash-lite` $0.30/$2.50 · `gemini-3.1-flash-lite` $0.25/$1.50 · `claude-haiku-4-5@20251001` $1/$5. Vertex latency numbers not published.
- Gemini 3.8 Flash thinking LOW/MEDIUM/HIGH, default MEDIUM, no MINIMAL; thinking tokens billed; `thinking_level` only.
- Sonnet 5.5: everyday/scoped work, docs/sheets/slides; adaptive thinking; **API default effort high**. Opus 5.5: complex open-ended; thinking always on; API default medium. Anthropic: chat → medium/low; harder → high; xhigh/max only if evals show gain.
- Official benchmarks (vendor-published, different harnesses): SWE-bench Pro Gemini 3.8 Flash 61.6% / Sonnet 81.3% / Opus 89.9%; Terminal-Bench 4.0 19.1% / 70.6% / 66.4%; HLE 45.4% / 56.9% / 64.4% (no tools). Indian languages: Claude MILU (11 Indian langs) Sonnet 91.6% / Opus 93.1%; Gemini 3.8 no Indian-language score.
- Inputs: Gemini 3.8 Flash text/image/PDF/audio/video; Sonnet/Opus 5.5 text/image/PDF only.
- Quotas (global defaults): Sonnet 5.5 2,500 QPM / 25M in TPM / 2.5M out TPM; Opus 5.5 2,000 QPM / 20M / 2M; shared per model lineage. Gemini 3.8 Standard PayGo: spend-based tiers (2M TPM at $10–250/30 d) but 3.8 not yet in tier list; spikes can 429.
- Errors: Google 429 → exponential backoff, ≥1 s initial, ≤2 retries, smooth traffic. Claude 529 mapping on Vertex not documented.
- Switching history: Gemini – keep signed parts unchanged; foreign function calls → `skip_thought_signature_validator` (last resort); history must end on a user turn. Claude – synthetic assistant turns allowed; convert tool calls to tool_use/tool_result pairs; never invent thinking. Sonnet → Opus keeps readable thinking; Opus → Sonnet drops it automatically (keep stored copy); changing effort breaks cache.

## Gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| MR1 | Auto = hard rules first, then small classifier for the rest | ✅ Vendor (Google, Anthropic) | MVP |
| MR2 | Model and effort chosen separately | ✅ Vendor (ChatGPT, Claude) | MVP |
| MR3 | Hard rules: audio/video → Gemini; Claude switch off / budget out → Gemini only | ✅ Vendor (Vertex input lists) + locked UI-5/R2 | MVP |
| MR4 | Label the model on every answer (Auto pick, fallback) | ✅ Vendor (Claude) | MVP |
| MR5 | User override; mid-chat switch applies to next answer | ✅ Vendor (all 4) | MVP |
| MR6 | Limit hit → continue with allowed model + message + reset info | ✅ Vendor (ChatGPT, Gemini, Claude) | MVP |
| MR7 | Overload → ≤2 retries (backoff ≥1 s) → policy-filtered fallback (R3) with label | ✅ Vendor (Google) | MVP |
| MR8 | Company-admin model allowlist + effort cap | ✅ Vendor (ChatGPT, Claude Ent, Perplexity) | Later (UI-5 ArcNave-team switch in MVP) |
| MR9 | Provider-native history kept beside normalized history; foreign tool calls converted; Gemini sentinel signature only for imported calls | ✅ Vendor | MVP |
| MR10 | Claude↔Claude switch: API drops unreadable thinking; keep stored | ✅ Vendor | MVP (refines R1) |
| MR11 | Effort map per profile; no xhigh/max without eval proof | ✅ Vendor | MVP |
| MR12 | Gemini 3.8 throughput tier unclear; spike 429 at scale → smoothing, monitoring, Priority PayGo / Provisioned Throughput when needed | ⚠️ Partial | MVP monitor; Stage 18/19 plan |
| MR13 | No managed optimizer for our pool → own router | ✅ Vendor | MVP |
| MR14 | Model role registry (M1–M11): role → primary, fallbacks, effort, version pin, allowed profiles | 🔧 ArcNave | MVP |
| MR15 | Router eval: label set, compare with "always Sonnet" baseline, shrink | ✅ Vendor (OpenAI) | MVP (run Stage 21) |
| MR16 | Coding/agentic + complex artifacts much stronger on Claude → Auto sends these to Sonnet when allowed | ✅ Vendor benchmarks | MVP |
| MR17 | Router latency budget + timeout → default Gemini Normal | 🔧 ArcNave | MVP (LV-1 measure) |
| MR18 | Gemini price doubles 1 Jan 2027 ($1.50/$7.50) → revisit Auto thresholds | ✅ Vendor price | Stage 18 |
| MR19 | Harmful refusal never falls back (R4); Claude.ai safety-switch pattern not used | Locked RV-2 | MVP |

## Claude-only
| # | Fact | Rec |
|---|---|---|
| CR1 | Sonnet 5.5 API default effort = high | Always send effort explicitly (Normal = medium) |
| CR2 | Opus 5.5 thinking always on; default medium | Opus only in Deep / explicit pick |
| CR3 | Sonnet rejects thinking disabled; between_tools only low–high | Adapter rule |
| CR4 | No forced tool use on 5.5 (auto/none only) | Orchestrator controls flow, not tool_choice |
| CR5 | Opus → Sonnet drops thinking; Sonnet → Opus keeps | Store full history; let API filter |
| CR6 | Effort change invalidates cache | Effort fixed per chat profile; change = new cache |
| CR7 | Quota shared across versions of a lineage | Version upgrades don't add capacity |
| CR8 | No audio/video input | MR3 rule |

## Decisions (user OK 2026-10-02)
| ID | Decision |
|---|---|
| RT-1 | MVP Auto = **rules only** (input type, size/pages, profile, Claude switch, Claude budget) → Gemini 3.8 Flash; effort by profile. Router reads file **metadata**, never the whole file. Signals logged for later |
| RT-2 | Classifier router (`gemini-3.5-flash-lite`, ~400 ms timeout → default) = **Later**, when per-company Claude budgets + logged data justify it |
| RT-3 | Tier map used once the classifier exists: simple → Gemini low · normal → Gemini medium · complex (coding, artifact building, multi-file analysis) → Sonnet medium · hard open-ended in Deep → Opus medium · Claude not allowed → Gemini high |
| RT-4 | Effort per profile (manual or Auto): Fast = low · Normal = medium · Deep = high; xhigh/max off until eval proves gain; always sent explicitly |
| RT-5 | Every answer shows the model (+ "Auto chose", + fallback note) |
| RT-6 | 429/overload: ≤2 retries (backoff ≥1 s) → next allowed model (fallback matrix) with label; Claude limit reached → Gemini + message |
| RT-7 | **Per-company monthly Claude limit**, set by ArcNave team, priced into the company plan (replaces Stage 1 "₹1,000/month total") |
| RT-8 | MVP: ArcNave team controls per-company Claude switch + limit; company-admin model allowlist / effort cap Later |
| RT-9 | Model role registry (M1–M11) in config |
| RT-10 | Monitor Gemini 429/TPM; smooth bursts; higher tier / Priority PayGo before large customers (Stage 19) |

## 7.9 Capability matrix (used by routing rules)
| | Gemini 3.8 Flash | Claude Sonnet 5.5 | Claude Opus 5.5 |
|---|---|---|---|
| Inputs | text, image, PDF, audio, video | text, image, PDF | text, image, PDF |
| Context | 1,048,576 in / 65,536 out | 1M (no long-context premium) | 1M |
| PDF | ≤50 MB / 3,000 pages | ≤600 pages; whole request ≤30 MB | same |
| Images | many per request | ≤5 MB each, ≤8000 px (>20 images ≤2000 px), ≤600 | same |
| Audio | yes (inline ≤20 MB, ~9.5 h) | no | no |
| Tools | function calling; Google Search grounding | function calling; web_search tool ($10/1k, org policy must allow) | same |
| Thinking / effort | LOW/MEDIUM/HIGH, default MEDIUM, can't turn off | adaptive; API default effort **high**; can't disable | always on; default medium |
| Caching | implicit (min 4,096 vs 6,144 – LV-1) | min 512 tokens; read 0.1× | read 0.05× |
| Price /1M (in/out) | $0.75/$3.75 → $1.50/$7.50 from 1 Jan 2027 | $2/$10 | $4/$20 |
| Global quota | spend tier (3.8 not in list yet) | 2,500 QPM · 25M in TPM | 2,000 QPM · 20M in TPM |
| Knowledge cutoff | Mar 2026 | Jun 2026 | Jun 2026 |
| Retirement | per Google model policy | not before 28 Sep 2027 | not before 22 Sep 2027 |
Rules derived: audio/video → Gemini only · PDF >600 pages or request >30 MB → Gemini (or OCR text + selected pages to Claude) · Claude switch off / limit reached → Gemini.

## 7.10 Model role registry (current picks)
| Role | Primary | Fallback | Decided in | Status |
|---|---|---|---|---|
| M1 Generation | Gemini 3.8 Flash (default/Auto); Sonnet 5.5, Opus 5.5 on manual pick (Opus also Deep) | Fallback matrix | Stage 7 | ✅ |
| M2 Router | none (rules) | – | Stage 7 | ✅ MVP; Flash-Lite later |
| M3 Query rewriter | candidate Flash-Lite / Gemini Flash | Gemini Flash | Stage 12 | TBD |
| M4 Embedding | candidate gemini-embedding-001 | – | Stage 12 | TBD |
| M5 Reranker | candidate Vertex Ranking API | skip rerank | Stage 12 | TBD |
| M6 Contextualizer | candidate Flash-Lite | off | Stage 12 | TBD |
| M7 Summarizer + title | Gemini 3.8 Flash | Flash-Lite | Stage 6 (GD-2, CXD-5) | ✅ (cost check Stage 18) |
| M8 Memory extractor | Gemini Flash (provisional) | skip turn | Stage 11 | TBD |
| M9 Safety screen | own Gemini screen (Flash-Lite to verify) | rules only | Stage 16 | TBD |
| M10 Speech | Gemini vs Chirp 3 | other | Stage 9 | TBD |
| M11 OCR | Document AI vs Gemini | other | Stage 9 | TBD |
Registry row fields: role · model + exact version · fallbacks · effort/thinking · max output tokens · allowed profiles · enabled · eval set id · rollout % · config version (stamped on every turn, L4-G48).

## 7.11 Claude budget mechanics
| Item | Rule |
|---|---|
| Limit | Monthly ₹ limit per company, set by ArcNave team (Claude switch OFF = no limit needed) |
| Counting | R2: reserve worst-case cost before each Claude call, settle actual usage after; counter = settled + reserved |
| 80% | Company admin notified (admin panel banner + email) |
| 100% | New Claude calls refused by reservation → manual Claude pick answered by Gemini with message "Your company's Claude limit for this month is reached"; answer already running finishes (already reserved) |
| Reset | 1st of each calendar month (IST); ArcNave team can raise mid-month |
| Platform guard | ArcNave-wide spend caps + kill switch (PL-6) still apply on top |
| Per-user limits | Later (company admin) |

## 7.12 Fallback matrix
| Situation | Action |
|---|---|
| Gemini 429/5xx after 2 retries | → Sonnet 5.5 (same effort) **only if** company Claude ON + limit left; else "busy, try again" + retry button |
| Sonnet failure after 2 retries | → Gemini Flash |
| Opus failure after 2 retries | → Sonnet (if limit left) → Gemini Flash |
| Claude limit reached | → Gemini Flash + message |
| Claude refusal, allowed category (RV-2) | → Gemini; stays on Gemini for the rest of the chat (sticky) |
| Harmful refusal (Claude) / Gemini SAFETY, PROHIBITED_CONTENT, SPII block | No fallback; show refusal/blocked message (R4) |
| Audio/video input and Gemini down | No alternative → error with retry |
| Mid-stream failure | Resume/retract rules → Stage 15 |
Every fallback answer carries the label "Answered by X because Y was unavailable". Overload fallback applies to that turn only; next turn tries the chosen model again.

## 7.13 Regenerate with routing
- User can regenerate with any allowed model (ED-1); new version stores its model label.
- Auto regenerate: same rules as a new turn (normally the same model unless state changed, e.g. limit reached).
- Different model than history → history converted (MR9): Gemini sentinel signature only for imported function calls; Claude synthetic assistant turns; thinking from other models never sent.

## 7.14 Model upgrade process
1. Pin exact versions (D-3); never auto-updating aliases.
2. New version → registry row added, disabled.
3. Run prompt eval set (Stage 6 kit) + routing checks on the new version; critical gates must pass.
4. Canary: ArcNave's own company → 10% of companies → 100%.
5. Keep old version for rollback until its retirement date; watch Google/Anthropic retirement notices (Google blocks new access ~1 month before retirement).
6. Every turn stamps model version + config version (L4-G48) for debugging.
