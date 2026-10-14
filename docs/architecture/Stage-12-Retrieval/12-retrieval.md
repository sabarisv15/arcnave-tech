# ArcNave – Stage 12 · Retrieval – LOCKED 2026-10-03 (final word: 00-checkpoint-stage12.md)
_2026-10-03 · Source: GPT Astra (official URLs + quotes, checked 3 Oct 2026; full answers in 12-astra-results.md) + scope map 12b-component-map.md · Status: DRAFT – decisions need user OK_
_Builds on: Stage 4 L5c (R1–R22, RT-1..3), Stage 6 CXD-4/6/10, Stage 9 (V-1…V-10, chunking, embedding provisional), Stage 10 (AO-6 whole-document map-reduce), LANG-1 (decide language handling by Stage 21 test)._

## 1. Evidence – products (files inside chats/projects)
| | Claude | ChatGPT | Gemini / NotebookLM | Perplexity |
|---|---|---|---|---|
| Whole file vs search | Projects switch to **RAG mode near the context limit**, capacity up to 10× ✅ | Enterprise: whole below **110k tokens**, above → partial + **hybrid index** ⚠️ | NotebookLM answers from selected sources; switch rule not documented ⚠️ | Short files whole, long files → relevant parts ✅ |
| Spreadsheets | XLSX needs code execution ⚠️ | **Spreadsheets always go to Code Interpreter** ✅ | Can chart; NotebookLM agentic chat runs code ⚠️ | Computer uses code ⚠️ |
| Citations | PDF page numbers ⚠️ | Preview/download ⚠️ | NotebookLM: hover shows quote, click opens in context ✅ | Inline citations, open file ⚠️ |
| Tamil / Tanglish retrieval guarantee | ❌ none | ❌ none | Output languages only ⚠️ | ❌ none |
| Quality / latency numbers | ❌ none published | ❌ | ❌ | ❌ |

## 2. Key vendor facts (new)
- **Gemini Embedding 2:**
  - **GA** (22 Apr 2026), served only from **global / us / eu** (no Mumbai). Vectors are stored in Mumbai, but processing is global (C3 allows this).
  - Input: **8,192 tokens; anything longer is silently truncated.**
  - Dimensions: default 3,072, MRL down to 1,536.
  - **No `task_type` field** – it uses text prefixes instead (`task: search result | query: …` / `title: … | text: …`).
  - **Text and page-image vectors share one space; a text query can retrieve images directly.** Google recommends **1 PDF page per request**.
  - Supports 100+ languages, but has **no Tamil/Hindi/Tanglish benchmark**.
  - Price: text $0.20/M tokens, image $0.45/M. Batch up to 1M rows. Published global quota: 200M TPM.
- **Vertex Ranking API** (GA; models 005 Preview, 004 GA):
  - **Hindi supported, Tamil NOT supported.**
  - Endpoint is global only; processing location not documented.
  - Limits: ≤1,000 records per request, 1,024 tokens per record.
  - Latency guidance "<100 ms". Price $1 per 1,000 units, where 1 unit = 100 records.
- **Cloud SQL PG18:**
  - Available: pgvector 0.8.5, pg_trgm, **pg_bigm**, and **pg_textsearch (BM25)**.
  - **Not available:** pgroonga, pg_search, rum, and ScaNN for PostgreSQL.
  - Core Postgres has **no BM25**. Built-in `tamil` and `hindi` stemmers exist.
  - Vector Assist can measure ANN recall against exact search.
- **pgvector:**
  - **Filters are applied after the ANN scan, so tenant/chat filters can lose recall.**
  - Iterative scans since 0.8.0; defaults `ef_search` 40, `max_scan_tuples` 20,000.
  - Exact search has perfect recall.
  - Use partial indexes or partitioning per filter value.
- **RRF:** the original paper uses k = 60. **MMR:** the common default λ is 0.5. **Near-duplicate filter:** the common default threshold is 0.95.
- **Rerankers (open source):**
  - **bge-reranker-v2-m3:** Apache-2.0, multilingual, ~8k tokens.
  - Jina v2: non-commercial licence, so not usable.
  - mxbai-rerank-base-v2: Apache-2.0, 100+ languages.
  - None of them publishes a Tamil benchmark or CPU latency.
  - LLM rerank takes 1–2 s (Google guidance).
- **Query step model:** `gemini-3.5-flash-lite` with MINIMAL thinking, which Google documents for classification, routing and JSON extraction. Structured output is supported. No latency number is published.
- **Indic tools:** IndicXlit (transliteration, 21 languages) and IndicTrans2 (translation). They exist, but nothing proves they improve retrieval (relevant to LANG-1).
- **Evaluation:**
  - MIRACL has 18 languages including Hindi but **no Tamil**, so we need our own labelled set.
  - Metrics: recall@k, nDCG@k, MRR, plus separate faithfulness checks.
  - OpenAI Evals shuts down on 30 Nov 2026, so we use our own harness (CXD-7) ✅.
- **Spreadsheets:**
  - DuckDB is MIT-licensed and reads CSV, Parquet and XLSX (not XLS).
  - It can be locked down (allowed_paths, external access off).
  - It does not auto-detect several tables in one sheet.
- **Re-embedding:** Embedding-001 and Embedding 2 spaces are **incompatible**, so a model change means re-embedding. Pattern: version column + filtered index + switch.

## 3. Gaps
| # | Gap | Source | MVP / Later |
|---|---|---|---|
| RE1 | **Tamil unsupported in the Vertex Ranking API** → the reranker must work for Tamil (or there is none) | ✅ Vendor | MVP → RD-7 |
| RE2 | Embedding 2 truncates silently at 8,192 tokens → count tokens before embedding (chunks are 800, so the risk is page images/metadata) | ✅ Vendor | MVP |
| RE3 | Embedding 2 uses text prefixes, not task types → update the R9 wording; embed queries and documents with their prefixes | ✅ Vendor | MVP |
| RE4 | One page per image-embedding request (quality) | ✅ Vendor | MVP |
| RE5 | Similarity scores are not probabilities → fuse text, page-image and keyword lists by **rank (RRF)**, not raw scores | ✅ Vendor | MVP |
| RE6 | Filtered ANN loses recall → **exact search for chat scope**, HNSW + iterative scan only for big project scopes | ✅ Vendor (pgvector) | MVP |
| RE7 | Core Postgres has no BM25 → use the **pg_textsearch** extension, with `ts_rank_cd` as fallback | ✅ Vendor | MVP (LV-1) |
| RE8 | Multi-field keyword weights: file name / title A, headings B, sheet / slide names C, body D | ✅ Vendor (Postgres setweight) | MVP |
| RE9 | **Query planner:** one fast structured call that gives the standalone query, filters, intent, a "needs page images" flag, and the language variants allowed by LANG-1 | ✅ Vendor (Flash-Lite, self-query, history-aware rewrite) + 🔧 | MVP |
| RE10 | Filters from the question (file name, page, date, type) are applied **inside** the RLS / chat scope and never widen access | ✅ Vendor (Postgres RLS) | MVP – security |
| RE11 | Retrieval mode: the app **prefetches** each turn **and** the model can call `file_search` for more; both are officially supported | ✅ Vendor (Claude search_result, OpenAI file_search) | MVP |
| RE12 | Near-duplicate removal (≥0.95) across files, keeping **both** citations | ✅ Vendor (LangChain) + 🔧 | MVP |
| RE13 | Diversity (MMR λ 0.5) for Normal/Deep | ✅ Vendor | MVP |
| RE14 | Order: documents first, question last; most relevant first; chunks from one file merged in page order | ✅ Vendor (Claude, Gemini, lost-in-the-middle) | MVP |
| RE15 | Weak evidence → a coverage flag (high / low / none) to the model and the UI; no refusal based on score alone | ✅ Vendor (Google NO_RELEVANT_CONTENT pattern) | MVP |
| RE16 | Whole-file threshold: ChatGPT Ent uses 110k and Claude goes up to the context limit, while ours is 30k (CXD-4) → **Deep profile may go up to ~100k** | ✅ Vendor | MVP (cost in Stage 18) |
| RE17 | Spreadsheet SQL: **DuckDB** (locked down) in the sandbox for SQL over CSV/Parquet; our own detection of several tables per sheet in Stage 9 | ✅ Vendor + 🔧 | MVP (image change) |
| RE18 | Re-embedding without downtime: `embed_model` column, partial HNSW per model, backfill, switch, rollback | ✅ Vendor | MVP design |
| RE19 | Query-embedding cache (Redis, key = model + normalised query, 1 h) | 🔧 ArcNave | MVP (cheap) |
| RE20 | Cleaning: Docling page furniture (headers, footers, page numbers) kept out of chunks but kept for provenance; NFC at index and query time (no NFKC; keep joiners) | ✅ Vendor (Docling, Unicode TR15) | MVP |
| RE21 | Retrieval eval set: own labelled set (English / Tanglish / Hinglish / Tamil / Hindi questions × English / Tamil / Hindi docs incl. scanned, cross-language and no-answer cases); recall@10, nDCG@10, MRR; LANG-1 variants A–D | ✅ Vendor (OpenAI, BEIR, LlamaIndex) | Design now, run in Stage 21 |
| RE22 | Latency risk: rewrite + embed (global) + search + rerank within p95 ≤800 ms is not proven → run keyword search on the raw query **in parallel** with the planner; measure in LV-1 | ⚠️ Partial | MVP + LV-1 |
| RE23 | Context compression (LLMLingua / extractors) can break citation offsets | ⚠️ Partial | Later (eval) |
| RE24 | Parent-chunk expansion vs neighbour expansion: no rule documented | ⚠️ Partial | Later (eval); MVP = neighbour ±1 (R21) |

## 4. Claude-only list
| # | Item | Effect |
|---|---|---|
| CR1 | `search_result` blocks are GA on Google Cloud, no beta header; **Claude cites whole blocks** | Our chunk = citation unit; split a block for finer citations |
| CR2 | Citations must be on for all results or off for all | One setting per request |
| CR3 | `search_result` cannot hold images | Page images go as separate image blocks next to their text block, with the same `[file:n]` id |
| CR4 | Claude cannot cite PDF images | Visual evidence is cited by our own `[file:n]` page id |
| CR5 | Long data at the top, query at the end; quote-first for long documents (the docs report "up to 30%" in experiments) | Assembly order (RE14); quote-first rule for Deep |
| CR6 | Claude Projects use RAG near the context limit | Matches our threshold approach (RE16) |
| CR7 | Anthropic has no embedding model; Voyage is not on Vertex and gives no India storage | Not used |
| CR8 | Prompt caching makes contextualisation cheaper (contextual retrieval blog) | Only relevant if V-10 is switched on; the contextualizer is Gemini Flash (M6) |

## 5. Retrieval pipeline (recommended)
```
Turn starts (chat has files over the whole-file threshold, or project files)
 ├─ in parallel ─ A) keyword search (BM25 / pg_textsearch, multi-field) on the raw query
 │              └ B) Query planner (gemini-3.5-flash-lite, MINIMAL thinking, JSON):
 │                   standalone query · intent · filters · needs_visual · [LANG-1 variants]
 ├─ C) embed planner query(s) (Gemini Embedding 2, 1,536, query prefix; Redis cache)
 ├─ D) vector search: text chunks (+ page images if needs_visual / visual files)
 │      chat scope → exact search inside filter ; project scope → HNSW + iterative scan
 │      all inside RLS + scope + planner filters
 ├─ E) RRF (k=60) over keyword + text-vector + image-vector lists → dedupe (≥0.95) → MMR (Normal/Deep)
 ├─ F) rerank top ~50 → reranker (RD-7) → coverage flag
 ├─ G) select top-N per profile + neighbour ±1 → token budget (CXD-6)
 └─ H) assemble: documents first (search_result blocks for Claude / documents block for Gemini),
        relevant first, same-file chunks in page order, page images beside, question last
 The model may call file_search for more (counts toward the step limit).
```

## 6. Decisions needed
| ID | Question | Recommendation |
|---|---|---|
| RD-1 | Retrieval mode | **App prefetch every turn + the model can call `file_search`** |
| RD-2 | Query planner | **One `gemini-3.5-flash-lite` call (MINIMAL thinking, JSON schema):** standalone query, intent, filters, needs_visual, language variants (LANG-1). Skipped on Fast when there is no chat history and the question is short |
| RD-3 | Embedding (confirms V-8) | **Gemini Embedding 2 GA, 1,536 dims**, prefix format, token pre-count, 1 page per image request; vectors in Mumbai, processing global |
| RD-4 | Keyword search | **pg_textsearch BM25** (LV-1: verify language config) with fallback `ts_rank_cd`; 'simple' config (LANG-1 A); field weights A–D |
| RD-5 | Vector search | **Exact search for chat scope; HNSW + iterative scan for project scope** above a size set in LV-1 (Vector Assist recall check); partial index per `embed_model` |
| RD-6 | Fusion | **RRF k=60**, dedupe ≥0.95 (keep both citations), MMR λ 0.5 on Normal/Deep |
| RD-7 | Reranker (M5) | Options:<br>**A** – none in MVP (vendors call it optional);<br>**B** – **self-hosted `bge-reranker-v2-m3` on Cloud Run Mumbai** (Apache, multilingual, data stays in India) ⭐ provisional, latency checked in LV-1, fallback to A;<br>**C** – Vertex Ranking API (no Tamil, global);<br>**D** – Flash-Lite LLM rerank (1–2 s), Deep only |
| RD-8 | How much goes to the model | Text chunks **Fast 5 / Normal 12 / Deep 30** (provisional), page images 3 / 8 / 20 (V-3), neighbour ±1; parent expansion Later |
| RD-9 | Order + format | Documents first, question last; most relevant first; same file in page order; Claude `search_result` blocks + image blocks; Gemini documents block |
| RD-10 | Weak evidence | Coverage flag high / low / none to the model and the UI ("may be elsewhere"); no score-only refusal; claim check in Stage 13 |
| RD-11 | Whole-file threshold | Keep 30k for Fast/Normal; **Deep up to ~100k tokens** whole (cost reviewed in Stage 18) |
| RD-12 | Spreadsheets | **Add DuckDB (locked down) to the sandbox image** for SQL over CSV/Parquet; detection of several tables per sheet added to Stage 9 extraction |
| RD-13 | Re-embedding | Versioned vectors + partial HNSW per model + backfill + switch flag + rollback |
| RD-14 | Compression | Not in MVP (citation risk); evaluate Later |
| RD-15 | Eval | Labelled retrieval set (RE21) designed now, run in Stage 21 together with LANG-1 variants and RD-7 options; targets set after the first run |
| RD-16 | Query-embedding cache | Redis, 1 h TTL, key = model + normalised query |

**LV-1 additions:**
1. pg_textsearch language / config support and speed.
2. Exact vs HNSW crossover for chat and project sizes.
3. bge-reranker-v2-m3 latency on Cloud Run Mumbai, CPU vs GPU (is a GPU available in asia-south1?).
4. Flash-Lite planner latency.
5. Embedding 2 latency from Mumbai.
6. End-to-end p95 ≤800 ms with A ‖ B parallel.

**Doc-sync:**
- L5c R9: Embedding 2 uses prefixes, not task types.
- R4: Ranking API, no Tamil.
- Stage 8 TD-4c: add DuckDB.
- Stage 9: detection of several tables per sheet.
- Stage 6 CXD-4: Deep threshold of ~100k.
- Model registry: M3 = gemini-3.5-flash-lite planner; M5 = bge-reranker-v2-m3 (provisional); M4 = Gemini Embedding 2.

**Confidence:**
- High for structure (every step has an official precedent).
- Medium for numbers (top-N, thresholds, latency) and for Tamil / Tanglish quality. Those are decided by the Stage 21 eval and LV-1, as agreed for LANG-1.

## 7. Sources
Full list with quotes in 12-astra-results.md. Main ones:
- support.claude.com/en/articles/11473015
- help.openai.com/en/articles/10029836
- docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/embedding-2
- docs.cloud.google.com/generative-ai-app-builder/docs/ranking and /languages-locales
- docs.cloud.google.com/sql/docs/postgres/extensions and /pg-textsearch
- github.com/pgvector/pgvector
- postgresql.org/docs/18 (textsearch)
- platform.claude.com/docs/en/build-with-claude/search-results
- huggingface.co/BAAI/bge-reranker-v2-m3
- cormack.uwaterloo.ca RRF paper
- duckdb.org/docs
- github.com/project-miracl/miracl

---

## 8. Gap audit 2026-10-03 (own cross-check + independent auditor) – new gaps RE25–RE53
_Method: (1) every 🔲 in 12b checked against RE/RD; (2) independent auditor (did not see my additions) read 12-retrieval, 12b, L5c, 06 context, Stage 9/10/11 checkpoints, 08d, 05-1, R1. Findings merged below. Severity: C = critical, I = important, M = minor._

### Corrections to items above
- **RD-8 numbers don't fit CXD-6 budgets** (Normal 12×3×800 + 8 images ≈ 41k of a 48k total; Fast > 16k) → replaced by RE25.
- **CR1/CR2 conflict with Stage 9 lock** ("Claude native citations Later, keep [file:n]") → MVP: `search_result` blocks with **citations disabled**; our `[file:n]` registry (RE29).
- **RE13/RE15 order fixed:** RRF → rerank → MMR on reranked set; coverage from reranker score (RE44).
- **RE6 refined** by RE28 (choose by in-scope row count, not chat vs project).
- **RD-16 cache key unsafe** → RE35.
- **RT-1 (chat files only) conflicts with DM-8 Projects in MVP + Stage 9** → RE36 formal revision.

### New gaps
| # | Gap | Sev | MVP/Later |
|---|---|---|---|
| RE25 | Retrieval token share per profile (provisional Fast 6k / Normal 20k / Deep 80k inside CXD-6); fill order whole files → top chunks → page images → neighbours; adjacent chunks merged into one span (overlap removed); neighbours count inside top-N | C | MVP |
| RE26 | Passages from earlier turns: planner `needs_retrieval` gate (skip on "thanks", rewrite-only, writing tasks); never resend a chunk already in history (refer to its id); at CXD-5 compaction replace old passages with stubs (id, file, location) – model re-fetches via read_file/file_search | C | MVP |
| RE27 | Claude page images pile up in history (>20 images → ≤2,000 px rule, 30 MB cap): render Claude page images ≤2,000 px JPEG from the first turn; per-chat image count/size budget incl. history; stub old images at compaction | C | MVP |
| RE28 | Exact vs HNSW chosen by **estimated in-scope row count**; force exact via scoped CTE; if ANN returns < k → exact fallback; per-company partition/partial index for large tenants; recall checked with Vector Assist in LV-1 | C | MVP |
| RE29 | **Citation registry per chat:** `chat_citation(cite_id → file_version_id, chunk_id, locator page/sheet!range/t_start–t_end, text_hash)`; same chunk = same id all chat; Claude citations OFF in MVP | C | MVP |
| RE30 | **Degraded mode:** per-step timeouts + fallbacks – planner (~300 ms) → raw query; embedding → keyword-only + coverage low; reranker → RRF order; DB statement_timeout → partial; flag to model "search may be incomplete"; alert | C | MVP |
| RE31 | Mixed small + big files: whole-vs-retrieve decided **per file** by budget; whole-sent files excluded from retrieval that turn; decision stored per turn (profile switch changes it) | C | MVP |
| RE32 | Files without vectors yet: `index_status` per file (text_ready / vectors_ready); keyword-only for those; start embedding when chat nears threshold; "N files still indexing" in coverage + UI | I | MVP |
| RE33 | Keyword index checks: pg_textsearch scoped top-k, Indic tokenisation, field weights (LV-1); fallback ts_rank_cd over scoped rows; pg_bigm / pg_trgm for Indic + Tanglish (L7 D7) | I | MVP + LV-1 |
| RE34 | Embedding quota: ingestion via batch / separate lane; reserved headroom for query embeddings; company upload quota never blocks chat queries | I | MVP |
| RE35 | Query-embedding cache key = SHA-256(company_id, embed_model@version, dims, prefix, NFC query); Redis Mumbai; values only; 1 h; invalidate on model change | I | MVP |
| RE36 | **Revise RT-1:** scope = chat files + project files (DM-8); allowed file ids resolved fresh every search from current membership/permissions | I | MVP |
| RE37 | Deletion: soft-deleted file leaves search at once (searchable flag / delete chunk rows, not join); deleted file text inside replayed history → decision needed (redact vs keep, DPDP); HNSW vacuum / REINDEX CONCURRENTLY plan; retrieval reads primary (no replica lag); traces ids only | I | MVP |
| RE38 | Re-processed / replaced file: citations point to file_version + locator; viewer shows "source replaced/deleted" | I | MVP |
| RE39 | Big spreadsheets (>30k, summary-only index): lookups + numeric questions routed to DuckDB / run_code, cited as sheet!range; optional row-group keyword index Later | I | MVP |
| RE40 | Audio transcripts chunked by 60–120 s segments with t_start–t_end locator (P1.05, G41) | I | MVP |
| RE41 | **Intent → action table:** lookup → top-N; summarise / list-all of a big file → AO-6 map-reduce (not top-N); compare → sub-queries per file (P2.04); numeric → code (R14); no-file → skip; count rule per intent (P4.08) | I | MVP |
| RE42 | Turn behaviours: follow-ups give planner previous cite ids; regenerate reuses stored retrieval set (access re-checked); edit → re-run on that branch; model switch → provider-neutral retrieval record rendered per provider + budget re-check | I | MVP |
| RE43 | Research-mode helpers: one citation registry per run, file_search budget + max_results per helper, access re-check per call | I | MVP |
| RE44 | Fusion order RRF → rerank → MMR; coverage from reranker score; fallback signal = keyword/vector agreement on top-3 | I | MVP |
| RE45 | Noisy neighbours: per-company concurrent-search cap, retrieval statement_timeout, HNSW memory sizing, off-peak throttled index builds/backfills (CONCURRENTLY), separate DB role/pool for retrieval (numbers Stage 18) | I | MVP |
| RE46 | RLS + pooling: `SET LOCAL` per transaction **and** explicit `company_id = $1` in every retrieval query | I | MVP – security |
| RE47 | One citation per page: fuse OCR-text hit and page-image hit on (file_version, page); cross-page chunk cites "pp 4–5" | M | MVP |
| RE48 | Store PDF page index + printed page label; DOCX cites heading + page | M | MVP |
| RE49 | Second file_search call: dedupe against ids already in context ("already provided as [file:3]"); embed raw query in parallel with planner | M | MVP |
| RE50 | Dedupe only within one company; access decided per file (confirms UD-1) | M | MVP |
| RE51 | File / chunk summaries (P1.15): Later (Stage 9 file card Later; Anthropic reports weak gains) | M | Later |
| RE52 | Per-step latency budget (provisional): planner 300 / embed 250 / search 100 / rerank 200 / assemble 50 ms, A‖B parallel; measured in LV-1 | I | MVP + LV-1 |
| RE53 | file_search limits per profile: calls per turn (Fast 1 / Normal 3 / Deep 6) and max_results reconciled with RE25 (08d default 8) | I | MVP |
