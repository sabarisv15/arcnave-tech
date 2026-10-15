# ArcNave – Stage 12 · Retrieval flow (all gaps + decisions in flow order) – LOCKED 2026-10-03 (final word: 00-checkpoint-stage12.md)
_2026-10-03 · Consolidates 12-retrieval.md (RE1–RE53, CR1–CR8, RD-1…RD-16, audit corrections) and 12b (scope map) into one end-to-end flow. Where items conflict, this file wins. ⭐ = user decision needed._

## Step 0 – At upload (before any question; Stage 9 pipeline + Stage 12 additions)
1. Text cleaning: page furniture (headers, footers, page numbers) is kept out of chunks but kept for provenance; Unicode NFC (no NFKC; joiners kept) – RE20.
2. Chunking: ~800 tokens with 15% overlap and the heading path (Stage 9); **audio by 60–120 s segments with t_start–t_end** – RE40; each chunk stores **PDF page index + printed page label** (DOCX: heading + page) – RE48.
3. Embedding: Gemini Embedding 2 (1,536 dims), **prefix format**, **tokens counted first** (no silent cut at 8,192), **1 page per image request** – RE2–RE4; `embed_model` version stored – RE18.
4. Keyword index: BM25 (pg_textsearch) with field weights – A file name/title, B headings, C sheet/slide names, D body – RE7, RE8.
5. File status: `index_status` = text_ready → vectors_ready – RE32.
6. Quota: upload embeddings go through a batch/low lane and never eat the chat-search quota – RE34.
7. Storage layout: company_id on every row; dedupe only inside a company – RE50; large companies get their own partition or partial index – RE28, RE45.

## Step 1 – Turn starts: which files are in scope, and how is each one sent?
1. **Scope** = this chat's files + this project's files (**RT-1 revised**). The allowed file ids are re-read from current membership on every turn – RE36.
2. **Security:** RLS with `SET LOCAL` **plus** an explicit `company_id = $1` in every query; planner filters can only narrow the scope, never widen it – RE10, RE46.
3. **Per file, not all-or-nothing:** files that fit the whole-file budget are sent whole; the rest go to search; whole-sent files are left out of search this turn; the decision is stored per turn – RE31.
   - ⭐ **D1 – Whole-file limit:** Fast/Normal 30k (as locked) · **Deep up to ~100k** (new).
4. **Retrieval token share inside the profile budget** – RE25 (replaces the old RD-8 counts):
   - ⭐ **D2 –** Fast **6k** / Normal **20k** / Deep **80k** (provisional; Stage 18 + eval tune).
5. Files that are text_ready but not vectors_ready → keyword search only, and the UI shows "N files still indexing" – RE32.

## Step 2 – Should we search, and for what? (query planner)
1. ⭐ **D3 – Query planner (RE9):** one `gemini-3.5-flash-lite` call (MINIMAL thinking, JSON schema). It returns:
   - `needs_retrieval`: skip search for "thanks", "make it shorter", plain writing tasks – RE26;
   - `intent` → the action table below – RE41;
   - standalone query (follow-ups get the **previous turn's cite ids**, so "page 5 of that file" works) – RE42;
   - `sub_queries` for comparisons (one per file) – P2.04;
   - `filters` (file name, page, date, type) – RE10;
   - `needs_visual` (charts / scanned pages);
   - language variants – only if the LANG-1 test picks variant B.

   **Intent → action table (RE41):**
   | Intent | Action |
   |---|---|
   | lookup | normal search (Steps 3–6) |
   | summarise / list-all of a big file | **map-reduce job (AO-6)**, not top-N chunks |
   | compare A vs B | one sub-query per file, results balanced across files |
   | numbers / Excel row lookup | **code: DuckDB / run_code**, cited as sheet!range – RE39, R14 |
   | no file needed | skip search |

2. **In parallel with the planner:** keyword search on the raw question + embedding of the raw question – RE22, RE49.
3. Planner timeout (~300 ms) → use the raw question – RE30.

## Step 3 – Search
1. Query embedding: Redis cache key = hash(company, model@version, dims, prefix, NFC query), 1 h, Mumbai – RE35; embedding timeout → keyword-only + coverage "low" – RE30.
2. **Vector search** – RE28:
   - few rows in scope → **forced exact search** (perfect recall);
   - many rows → HNSW + iterative scan, then exact fallback if fewer than k come back;
   - text chunks always; page-image vectors when `needs_visual` is set or the file is visual.
3. **Keyword search:** BM25; fallback `ts_rank_cd`; pg_bigm / pg_trgm if Tamil words split badly – RE7, RE33 (LV-1).
4. Everything runs inside the scope + filters; statement timeout; per-company concurrency cap – RE45.

## Step 4 – Merge and rank
1. **RRF (k = 60)** over keyword + text-vector + image-vector lists, by **rank** not score – RE5.
2. Same page from the OCR-text hit and the page-image hit → **one** entry (file_version, page) – RE47.
3. Near-duplicates (≥0.95) across files → shown once, **both citations kept** – RE12.
4. ⭐ **D4 – Reranker (RE1):**
   - A: none;
   - **B: bge-reranker-v2-m3 on our Mumbai server** ⭐ (Tamil works, data stays in India; latency checked in LV-1; fallback A);
   - C: Google Ranking API (no Tamil);
   - D: Flash-Lite AI rerank (1–2 s, Deep only).

   Reranker down → keep the RRF order – RE30.
5. Variety (MMR λ 0.5) **after** the rerank, on Normal/Deep – RE44.
6. **Coverage flag** high / low / none from the reranker score (fallback: keyword and vector agree on the top 3) – RE15, RE44.

## Step 5 – Choose what goes to the model
1. Fill the retrieval share (D2) in this order: top chunks → page images → neighbours ±1. Adjacent chunks are merged into one span (overlap removed); neighbours count **inside** the share – RE25.
2. **Never resend a chunk already in this chat's history** – refer to its existing id – RE26, RE49.
3. Claude page images: **≤2,000 px JPEG from the first turn**; a per-chat image count/size budget that includes history – RE27.
4. Parent-section expansion: Later (eval) – RE24. Compression: Later (it breaks citations) – RE23.

## Step 6 – Build the prompt
1. Order: documents first, question last; most relevant first; chunks from one file in page order – RE14.
2. **Citation registry per chat** – RE29: `cite_id` → file_version + page / sheet!range / time + text hash. The same chunk keeps the same `[file:n]` for the whole chat.
3. Claude: `search_result` blocks with **citations OFF** (Stage 9 rule: keep `[file:n]`), page images as separate image blocks beside them – CR1–CR4.
4. Gemini: documents block (Stage 6 layout).
5. Flags to the model: coverage, "N files still indexing", "search may be incomplete" (degraded mode) – RE15, RE30, RE32.

## Step 7 – While the model answers
1. The model may call `file_search` for more:
   - ⭐ **D5 – call limits per turn:** Fast 1 / Normal 3 / Deep 6; max_results aligned with D2 – RE53.
   - Results already in context come back as "already provided as [file:3]" – RE49.
2. Research-mode helpers share one citation registry per run, each with its own search budget, and access is re-checked on every call – RE43.

## Step 8 – After the answer and in later turns
1. Each turn stores a **provider-neutral retrieval record** (what was searched, what was sent, the ids) – RE42:
   - regenerate → reuse that record (access re-checked);
   - edit → re-run on that branch;
   - model switch → re-render the record for the other provider and re-check the budget.
2. **History growth:** at CXD-5 compaction, old passages and images become stubs (id, file, page); the model re-fetches them if needed – RE26, RE27.
3. **File replaced or re-processed:** old citations point to the file version → the viewer shows "source replaced" – RE38.
4. **File deleted** – RE37: it leaves search **at once**; index cleanup is scheduled; retrieval reads the primary DB; logs hold ids only.
   - ⭐ **D6 – Deleted file text already sent in earlier turns of this chat:**
     - (a) **Remove** it from history (DPDP-safe; Claude cache breaks for that chat);
     - (b) keep it as part of the chat.

## Step 9 – Ops and quality (always on)
1. Latency budget (provisional): planner 300 / embed 250 / search 100 / rerank 200 / assemble 50 ms, with keyword search and the planner running in parallel → p95 ≤800 ms, measured in LV-1 – RE22, RE52.
2. Noisy neighbours: per-company caps, statement timeouts, HNSW memory sizing, index builds and backfills off-peak with CONCURRENTLY, a separate DB pool for retrieval – RE45.
3. Embedding model change: new version column → backfill → check → switch → rollback possible – RE18.
4. Eval set (RE21): English / Tanglish / Hinglish / Tamil / Hindi questions × English / Tamil / Hindi documents (including scanned), cross-language and no-answer cases; recall@10, nDCG@10, MRR. Run in Stage 21 together with LANG-1 variants A–D and reranker options A–D.
5. Excel SQL: **DuckDB added to the sandbox image (locked down)**; Stage 9 detects several tables in one sheet – RE17.

## Decision list (only these need the user)
| # | Decision | Recommendation |
|---|---|---|
| D1 | Whole-file limit | Fast/Normal 30k (as locked) · Deep ~100k |
| D2 | Retrieval token share | Fast 6k / Normal 20k / Deep 80k (provisional) |
| D3 | Query planner | One Flash-Lite call with needs_retrieval, intent, filters, sub-queries, needs_visual |
| D4 | Reranker | **B** bge-reranker-v2-m3 on a Mumbai server (fallback A) |
| D5 | file_search calls per turn | Fast 1 / Normal 3 / Deep 6 |
| D6 | Deleted file text in old turns | (a) remove · (b) keep – user choice |

All other items are technical defaults that follow from official docs: RRF k=60, exact/HNSW by size, BM25 with fallback, cache key, citation registry, degraded mode, DuckDB, versioned re-embedding, eval set.

## Decision updates (user, 2026-10-03)
- **D1:** whole-file limit (30k vs ~100k per profile) **decided by regression test of performance** in Stage 21 (quality + latency + cost), not fixed now. Build starts at 30k (Deep 100k as a test arm).
- **D4:** reranker **always in the architecture** (user: every enterprise RAG has one – confirmed: Azure semantic ranker, AWS Bedrock KB rerank, Vertex AI Search/RAG Engine ranking, OpenAI file_search ranker, Perplexity cross-encoder stage, Anthropic contextual retrieval rerank; vendors label it "optional" but all ship one). Option A only as outage fallback. Model: **bge-reranker-v2-m3 (Mumbai) provisional**; final by Stage 21 bake-off (bge vs mxbai-rerank-v2 vs Vertex Ranking for non-Tamil vs Flash-Lite LLM rerank on Deep).
- **D3 cost check (official Vertex pricing, 3 Oct 2026; per 1k planner calls ≈1.5k in + 150 out):**
  | Model | $ in/out per 1M | ≈$ / 1k calls | Tamil/Hindi statement | Note |
  |---|---|---|---|---|
  | gpt-oss-20b (MaaS) | 0.07 / 0.25 | ~0.14 + reasoning | none | cheapest; region docs conflict |
  | Gemma 4 26B A4B (MaaS) | 0.15 / 0.60 | ~0.32 | "140+ languages" | Apache 2.0; processing us |
  | **Gemini 3.1 Flash-Lite** | 0.25 / 1.50 | ~0.60 | ta + hi listed | GA to ≥May 2027; minimal thinking |
  | Gemini 3.5 Flash-Lite (old pick) | 0.30 / 2.50 | ~0.83 | ta + hi listed | GA |
  | GLM-4.7 / GLM-5 (MaaS) | 0.60 / 2.20 · 1.00 / 3.20 | ~1.23 / ~1.98 | English + Chinese only | **more expensive – rejected** |
  | Self-host L4 Cloud Run Mumbai | ~$760/month fixed | — | — | invitation-only region; pays off only >~1.3M calls/month |
  Gemini 2.5 Flash-Lite retires 20 Oct 2026 (not usable). No cheap model has documented in-region processing in Mumbai (global endpoint, as allowed by C3).
- **D3 recommendation:** provisional **Gemini 3.1 Flash-Lite** (≈27% cheaper than 3.5, same JSON + language support); Stage 21 planner eval on Tanglish/Hinglish/Tamil compares 3.1 Flash-Lite vs Gemma 4 26B vs gpt-oss-20b → cheapest model that passes wins. Planner runs only on turns that search files, not every turn.
