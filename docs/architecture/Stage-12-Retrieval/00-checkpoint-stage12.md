# ArcNave – Checkpoint · Stage 12 Retrieval – LOCKED 2026-10-03
_User OK 2026-10-03. This checkpoint is the final word. Flow detail: 12c-retrieval-flow.md (Steps 0–9). Evidence: 12-retrieval.md + 12-astra-results.md. Scope: 12b-component-map.md._


> **Update 2026-10-03 (post-review, user OK) – D4 hosting:**
> - **A+ = bge-reranker-v2-m3 int8 inside the Turn Executor**, with: model baked into the image + warmed on start (uses the Executor min instances from R10); rerank only the **top 30** RRF candidates; **conditional rerank** (skip when keyword top-3 and vector top-3 agree, except Deep / low coverage); ONNX Runtime int8; Executor memory raised (2 → 4 GiB, the only extra cost). Stage 21 eval adds "skip vs always rerank" as a metric.
> - **Trigger to Option B (separate `rerank-svc` Cloud Run service, min 1):** p95 rerank > 200 ms or Executor RAM > 70%.
> - **Vertex Ranking API** ($1 / 1,000 queries of ≤100 docs, global, no Tamil) = Stage 21 bake-off candidate + emergency fallback for English-only tenants only; not primary (Tamil + ~₹1.9 lakh/month at 5,000 users vs ~₹5–10k for bge).

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - pg_textsearch (Timescale/Tiger Data, PostgreSQL licence) documents a **shared-corpus-statistics side channel under RLS** → chunk tables **list-partitioned per company** with BM25 + HNSW index per partition (VS-7); scale note: at ~1,000 companies re-evaluate (hash groups with verified statistics isolation, or Vertex Ranking fallback) – LV-116 (review R-3). Fuzzy matching = NFC + pg_trgm; no transliteration runtime MVP (VS-8).

## Docs
| Doc | What |
|---|---|
| 12a-scope-astra-prompt.md / 12a-scope-results.md | Scope research: full RAG component checklist (P1–P8) |
| 12b-component-map.md | Component map vs earlier decisions + LANG-1 |
| 12-astra-prompt.md / 12-astra-results.md | Detailed research (A–I) |
| 12-retrieval.md | Evidence, gaps RE1–RE53 (incl. audit), Claude-only CR1–CR8 |
| 12c-retrieval-flow.md | **One end-to-end flow** with every gap and decision in order |

## Locked decisions
**Language & testing**
- **LANG-1:** no hard-coded language logic. Start with variant A (raw query, NFC, one generic keyword config). Stage 21 test compares variants B (AI rewrite to English + native script), C (per-language keyword config) and D (Indic sentence splitting); the cheapest one near the best wins.
- **D1:** whole-file limit is decided by a Stage 21 regression test (quality + latency + cost). Build starts at 30k; Deep 100k is a test arm.

**Turn flow (12c Steps 1–8)**
- Scope = chat files + project files (**RT-1 revised**). Access is re-resolved every turn. RLS uses `SET LOCAL` and every query also has an explicit `company_id`. Filters taken from the question only narrow the scope.
- Each file is decided separately: sent whole or retrieved. Whole-sent files are excluded from search. Files not yet embedded use keyword search only, and the UI shows "N files indexing".
- **D2:** retrieval token share Fast 6k / Normal 20k / Deep 80k (provisional; tuned with D1).
- **D3 Query planner (M3):** one structured call to **Gemini 3.1 Flash-Lite** (provisional). It returns needs_retrieval, intent, standalone query (using previous cite ids), sub-queries, filters, needs_visual and LANG-1 variants. It runs only on turns that search files. Stage 21 compares it with Gemma 4 26B and gpt-oss-20b; the cheapest that passes wins. On timeout (~300 ms) the raw query is used.
- **Intent → action:**

  | Intent | Action |
  |---|---|
  | lookup | search |
  | whole-file summary / list-all | map-reduce (AO-6) |
  | compare | one sub-query per file |
  | numbers / Excel lookup | DuckDB / run_code |
  | no file needed | skip search |

- **Search:**
  - Keyword search (BM25 via pg_textsearch, field weights A–D; fallback ts_rank_cd + pg_bigm/pg_trgm) runs in parallel with the planner.
  - Gemini Embedding 2 (1,536 dims, prefix format, token pre-count, 1 page per image). Query cache in Redis Mumbai, key hashed with company and model version.
  - Vector search: exact or HNSW chosen by the in-scope row count, with exact fallback; text plus page-image vectors.
- **Merge:** RRF k=60 → same-page text and image merged into one entry → near-duplicates removed (both citations kept) → **reranker** → MMR (Normal/Deep) → coverage flag from the reranker score.
- **D4 Reranker (M5): always in the architecture.** Provisional model bge-reranker-v2-m3 (int8), **hosted inside the Turn Executor** (no separate server at start; a dedicated or GPU server comes when traffic needs it, Stage 19). Final pick by Stage 21 bake-off. If the reranker is down, the RRF order is used.
- **Selection:**
  - Fill the D2 share in this order: top chunks → page images → neighbours ±1, as merged spans.
  - Never resend a chunk already in history.
  - Claude page images ≤2,000 px from the first turn; image budget per chat.
- **Prompt:**
  - Documents first, question last; most relevant first; same-file chunks in page order.
  - **Citation registry per chat** (cite_id → file_version + page / sheet!range / time + hash).
  - Claude: `search_result` blocks with citations OFF plus separate image blocks. Gemini: documents block.
  - Flags passed: coverage, indexing, degraded.
- **D5:** extra `file_search` calls per turn: Fast 1 / Normal 3 / Deep 6. Results already in context come back as "already provided as [file:n]".
- **After the turn:**
  - A provider-neutral retrieval record is stored per turn: regenerate reuses it, edit re-runs it, model switch re-renders it.
  - At compaction, old passages and images become stubs.
  - Replaced files show "source replaced".
- **D6 = (a) Remove:** a deleted file leaves search immediately, and its text is also removed from the chat's earlier turns (replaced with a "[source deleted]" stub; Claude history is rebuilt from the edit point under the R1 rule).
- **Degraded mode:**
  - Planner fails → raw query.
  - Embedding fails → keyword search only.
  - Reranker fails → RRF order.
  - DB slow → statement_timeout and partial results.
  - In every case the model is told "search may be incomplete" and an alert fires.
- **Ops:**
  - Latency budget: planner 300 / embed 250 / search 100 / rerank 200 / assemble 50 ms → p95 ≤800 ms (LV-1).
  - Per-company search caps and timeouts; separate DB pool for retrieval.
  - Upload embeddings go in a separate low-priority lane.
  - Index builds run off-peak with CONCURRENTLY.
  - Versioned re-embedding with switch and rollback.
  - DuckDB (locked down) added to the sandbox image.
  - Retrieval reads the primary DB; logs hold ids only.
- **Not in MVP:** context compression, parent-section expansion, file summaries, HyDE/step-back, graph RAG, ColBERT/ColPali, SPLADE, Vertex RAG Engine.

## Cost note (rough, final in Stage 18)
- Planner: ≈ ₹0.05 per search turn (~1.5% of answer cost). About ₹1,250/month at 50 users, ₹1.25 lakh/month at 5,000 users.
- Reranker inside Turn Executor ≈ ₹0 extra at start.
- At 5,000 users, a self-hosted planner (Mumbai L4, invitation-only) may cost less → Stage 18/19.

## Query-aware models in the architecture (user check)
- **M3 Query planner:** understands the question before search.
- **M5 Reranker:** reads the question together with each passage (cross-encoder).
- Query-aware compression: Later (eval).

## LV-1 additions
1. pg_textsearch: language config, scoped top-k, field weights.
2. Exact vs HNSW crossover and recall (Vector Assist).
3. bge-reranker int8 latency inside the Turn Executor (CPU).
4. Flash-Lite planner latency.
5. Embedding 2 latency from Mumbai.
6. End-to-end p95 ≤800 ms.
7. Tamil/Indic tokenisation in Postgres FTS.

## Stage 21 tests
- Retrieval eval set: English / Tanglish / Hinglish / Tamil / Hindi questions × English / Tamil / Hindi docs incl. scanned, cross-language and no-answer cases.
- Metrics: recall@10, nDCG@10, MRR.
- Compared together: LANG-1 variants A–D, reranker options, planner models, D1 30k vs 100k.

## Doc-sync debt – APPLIED 2026-10-03 (see 00-Handoff/00-doc-sync-register.md)
- **L5c:**
  - R4: Ranking API, no Tamil.
  - R9: Embedding 2 uses prefixes, not task types.
  - RT-1: revised scope (chat + project files).
  - R20: query cache is now MVP.
- **Stage 5 data model:**
  - chat_citation registry
  - retrieval_record per turn
  - file index_status
  - embed_model version on vectors
  - page index + label on chunks
  - audio segment locators
- **Stage 6:**
  - CXD-4 per-file whole-vs-retrieve + D1 test.
  - CXD-5 stubs for old passages/images at compaction.
  - CXD-6 retrieval share D2.
  - Prompt: coverage/degraded flags; search_result citations off.
- **Stage 7 model registry:**
  - M3 = gemini-3.1-flash-lite (provisional).
  - M4 = Gemini Embedding 2.
  - M5 = bge-reranker-v2-m3 in the Turn Executor (provisional).
- **Stage 8:**
  - TD-4c: add DuckDB.
  - 08d `file_search`: per-profile call limits (D5) + max_results aligned with D2; "already provided" behaviour.
- **Stage 9:**
  - Several tables per sheet detection.
  - Audio 60–120 s segments.
  - Page label.
  - Furniture excluded from chunks.
- **L7:** extensions pg_textsearch + pg_bigm; retrieval DB pool; HNSW per embed_model.

## Lawyer list
- D6 removal of deleted-file text from chat history (DPDP erasure "reasonable time" – confirm approach).

## Doc-sync 2026-10-05 (Stage 21 Task 0.11 review – keyword path, LV-54 / LV-116, ADR-0005)
- **Keyword (BM25) path (ADR-0005):** every query names the company's own chunk partition and that partition's own BM25 index – never the parent's index (through the parent, another company's inserts moved scores by up to ≈ 94 %; on the own partition 0). Same addressing for HNSW by default.
- **LV-54 facts for the retrieval design (Phase 2):** language config decides stemming (`simple` none, `english` stems) – LANG-1 variant choice must be tested per language; Tamil / Hindi exact-word matching works with `simple`; no field weights in pg_textsearch 1.3.1, so a title boost (#7) needs another design in Phase 2; company-scoped top-k is filled correctly; pg_trgm fallback works.

## Doc-sync 2026-10-06 (Stage 21 Task 0.12 close)
- **LV-115 FAIL – CPU reranker too slow (N-26 latency + RAM triggers hit):** bge-reranker-v2-m3 int8 (ONNX Runtime, CPU, AVX2 + AVX512-VNNI, no AMX) on 2 vCPU / 4 GiB: p95 58,957 ms for 30 candidates × 512 tokens, 19,917 ms for 10 candidates (target 200 ms); warm-up 54 s; length 1,024 (batch 8) and 4 concurrent requests at 512 → container killed (signal 9), memory utilisation peak 0.81. Startup itself is fine (ready ≈ 70 s).
- **Reranker hosting → ADR pending owner decision.** Options to cost per user per day: GPU (L4) in Mumbai (invitation only), a smaller reranker, Vertex Ranking API (global, no Tamil), reranking only in some modes / fewer candidates.
- int8 vs fp32 parity (export): Spearman 0.9865, top-5 overlap 0.8, max logit difference 0.65 → input for the Stage 21 reranker bake-off.

## Doc-sync 2026-10-06 (ADR-0007 – reranker = Vertex Ranking API, owner)
- **D4 / M5 changed:** reranker = **Vertex AI Ranking API** on `global`, model pinned to `semantic-ranker-default-004` (GA), top 30 RRF candidates, `ignoreRecordDetailsInResponse`, called from the Executor via `packages/retrieval`, ADC, no SDK retries, explicit timeout. Option A+ (bge int8 in the Executor) and the option-B trigger are withdrawn (LV-115 FAIL).
- **LV-129 (synthetic multilingual set):** default-004 nDCG@10 0.969 (Tamil 0.988, Hindi 0.968, Tanglish 0.928, cross 0.954), p95 581 ms from the VPC; fast-004 0.942 / p95 353 ms; default-005 (Preview) 0.986. LV-130 Gemini Flash-Lite as reranker 0.933–0.965 but p95 ≈ 3 s → rejected.
- **Budget:** rerank p95 ≤ **600 ms** (N-26), retrieval p95 ≤ **1,200 ms** (N-27, provisional – Phase 2 measures). On timeout / error / 429 → RRF order + `degraded` flag, no retry in the turn. Conditional rerank stays.
- Upgrade: re-run LV-129 when 005 is GA and move the pin; fast-004 if latency must drop; GPU-hosted open model only at ≈ 700–1,700 users or if quality / terms fail.
- **ADR-0007 update (owner, 2026-10-06):** development (Phase 2 build, synthetic data) uses `semantic-ranker-default-005` (Preview, best quality) once LV-131 has measured its latency; production needs a GA model – 005 if GA before the Phase 5 exit and within 600 ms, else `default-004`.

## Doc-sync 2026-10-07 (Stage 21 Task 0.14 review – LV-131 Ranking API 005 latency PASS)
- **LV-131 PASS:** `semantic-ranker-default-005` (Preview) p95 484 ms (p50 203, max 496), `fast-005` p95 344 ms; 20 × 200 each, sequential, from the dev VPC through the private VIP, top 30, the long Tamil + the English query of the synthetic set – within N-26 (600 ms). For comparison LV-129: `default-004` p95 581 ms.
- **ADR-0007 decision 4 applies: development (Phase 2 build, synthetic data) uses `default-005`.** Production rule unchanged – 005 only if GA before the Phase 5 exit and within LV-129 quality + 600 ms, else `default-004`. Check 005's launch stage at the Phase 2 and Phase 5 exits. The degrade path (RRF order + `degraded` flag on timeout / error / 429) stays.

## Doc-sync 2026-10-08 (Stage 21 Task 1.3 close – planner latency + router merge, LV-134)
- **Planner latency risk:** D3 planned a ~300 ms planner timeout (N-27: planner 300 ms in parallel with search). LV-130 and LV-133 measured a ≈ 1 s floor for any Flash-Lite call from the dev VPC to `global` (LV-133 p50 976 / p95 1,249 ms) – a 300 ms planner would almost always time out. N-27 and the D3 timeout are re-decided in Phase 2 with LV-134 / LV-58 numbers.
- **Router + planner overlap:** both classify intent; the router's `file_question` / `needs files` signal can decide whether the planner runs. Candidate: one "turn analyzer" call (router + planner) – **LV-134** (Phase 2, before the planner brief) compares merged vs separate calls. The M9 safety screen is **not** merged (independence from the routed prompt, own calibration LV-84, it also screens tool outputs).
- LV-16 split: router = LV-133 (done, ADR-0009), planner = LV-134, safety screen = LV-84.

## Doc-sync 2026-10-08 (owner – M3 query planner model → 3.5 Flash-Lite, provisional)
- **D3 query planner (M3) = `gemini-3.5-flash-lite` (provisional)**, replacing `gemini-3.1-flash-lite` (D3 and the 2026-10-03 registry line above). Reason: LV-133 3.1 Flash-Lite p95 7.9 s (max 23.8 s) vs 3.5 Flash-Lite p95 1.25 s from the dev VPC; the planner sits on the turn path. Stage 7 doc-sync 2026-10-08 (helper models).
- **LV-134** decides (merged turn analyzer vs separate planner call; planner quality, p95, tokens, ₹ / user / day). Alternatives (Gemma 4 26B / gpt-oss-20b) only if 3.5 Flash-Lite fails. The N-27 / D3 timeout re-decision (block above) is unchanged.
