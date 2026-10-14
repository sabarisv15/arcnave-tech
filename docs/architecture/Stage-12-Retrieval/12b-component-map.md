# ArcNave – Stage 12 · Retrieval component map (scope check) – DRAFT
_2026-10-03 · Input: 12a-scope-results.md (Astra scope research, official sources) mapped against what ArcNave already decided (Stage 4 L5c R1–R22, Stage 6 CXD-4/6/10, Stage 9, Stage 10 AO-3/AO-6, Stage 11). Purpose: nothing missed before the detailed Stage 12 research._

**Legend:** ✅ already decided (where) · 🔲 **Stage 12 must decide** · ⏩ another stage · ❌ not in MVP (reason)
**Key fact from research:** no official source makes every component mandatory; vendors call query transformation and reranking *optional*, and Anthropic says "always run evals". So Stage 12 picks components **by eval**, not by list.

## P1 Ingestion & indexing (mostly Stage 9)
| ID | Component | Status |
|---|---|---|
| P1.01–03 | File routing, layout parsing, OCR | ✅ Stage 9 (Docling, Document AI OCR) |
| P1.04 | Image descriptions + original image refs | ✅ page-image vectors (V-1); LLM image descriptions ❌ Later (S9) |
| P1.05 | Audio transcript segments | ✅ timestamps (G41); 🔲 transcript chunking by time segment |
| P1.06 | **Cleaning: repeated headers/footers, page numbers, boilerplate** | 🔲 **gap** |
| P1.07 | **Unicode normalisation (NFC; Tamil/Devanagari, zero-width joiners)** | 🔲 **gap – affects keyword search + trigram** |
| P1.08–09 | Fixed + structure-aware chunking | ✅ ~800 tok, 15% overlap, heading path (V-6) |
| P1.10 | Semantic chunking | ❌ eval-only option |
| P1.11 | **Parent/child (hierarchical) chunks** | 🔲 **gap** (with P4.10) |
| P1.12 | Late chunking | ❌ needs token-level embeddings (not in Gemini Embedding API) |
| P1.13 | Metadata + provenance | ✅ JSON sidecar (G47) |
| P1.14 | Contextual enrichment | ✅ slot, OFF until eval (V-10) |
| P1.15 | Chunk / file summaries | 🔲 decide (file-level summary for routing & "what is this file about"); Anthropic reports weak gains for generic summaries |
| P1.16 | Hypothetical questions per chunk | ❌ Later (eval-only) |
| P1.17–18 | Embedding + index; task types; no silent truncation | ✅ (V-8, E1) – final model 🔲 |
| P1.19–21 | Dedupe, versioning, re-index on replace | ✅ UD-1, G42, G45 |
| P1.22 | Multiple indexes / scopes | ✅ chat + project scope (one table, scope filter) |
| P1.23 | Readiness | ✅ D1 / AO-12 |
| P1.24 | Whole-document path | ✅ CXD-4 (≤30k tokens) – 🔲 revisit threshold per profile (Google: long context is the default starting point) |

## P2 Query understanding (Stage 12 core)
| ID | Component | Status |
|---|---|---|
| P2.01 | **Retrieval gate / mode** (auto-retrieve every turn vs model calls file_search vs both) | 🔲 **decide** |
| P2.02 | Intent / type classification (lookup, summary, compare, numeric) | 🔲 decide (R14 numeric → code ✅) |
| P2.03 | Conversational rewrite | ✅ M3 rewriter + prompt (Stage 6); model pick 🔲 |
| P2.04 | Decomposition into sub-queries | 🔲 |
| P2.05 | Multi-query expansion | ✅ partly (rewrite gives 1–3 queries + English) |
| P2.06–07 | HyDE, step-back | ❌ eval-only |
| P2.08 | Language detection | 🔲 |
| P2.09 | Query translation | ✅ partly (original + English query) |
| P2.10 | **Romanised Tanglish/Hinglish → Tamil/Hindi script** | 🔲 **critical** (no vendor guarantees code-mixed quality) |
| P2.11 | **Filters taken from the query** (file name, page, date, "March invoice") | 🔲 **gap** |
| P2.12 | Routing to index / modality / tool (text vs page images vs code vs memory vs web) | 🔲 |
| P2.13 | Clarify before search | ✅ AO-3 |

## P3 Search
| ID | Component | Status |
|---|---|---|
| P3.01 | Dense | ✅ pgvector |
| P3.02 | **Keyword: Postgres FTS is not BM25** | 🔲 decide (FTS ts_rank vs BM25 extension if Cloud SQL supports one; Tamil/Hindi configs) |
| P3.03 / P3.05 / P3.10 / P3.11 | SPLADE, ColBERT, graph, federated | ❌ not MVP |
| P3.04 | Hybrid | ✅ R5 |
| P3.06 | **Exact vs approximate (HNSW) search** | 🔲 **gap** – small chat scopes: exact scan inside filter; big projects: HNSW + iterative scan (L7: filtered HNSW can under-return) |
| P3.07–08 | Metadata + access filtering | ✅ R1, R12 |
| P3.09 | Multimodal | ✅ page vectors (V-1) |
| P3.12 | **Multi-field search (file name, title, headings, sheet names)** | 🔲 **gap** |

## P4 Ranking & selection
| ID | Component | Status |
|---|---|---|
| P4.01–02 | Multi-stage, RRF fusion | ✅ R11, R5 – 🔲 RRF k, candidate counts |
| P4.03 | Cross-encoder rerank | 🔲 pick (Vertex Ranking API – global, 25 languages – vs self-hosted multilingual) |
| P4.04 | LLM rerank | 🔲 option for Deep |
| P4.05 | **Diversity (MMR)** | 🔲 gap |
| P4.06 | Threshold | ✅ R5 – 🔲 calibration by eval |
| P4.07 | Final top-N per profile | ✅ visual pages 3/8/20 (V-3); 🔲 text chunks per profile |
| P4.08 | Adaptive count | ❌ trained method; simple rule by intent 🔲 |
| P4.09 / P4.10 | Neighbour expansion / **parent expansion** | ✅ R21 / 🔲 gap |
| P4.11–12 | Duplicate + near-duplicate removal after merge | 🔲 gap (small) |

## P5 Post-retrieval
| ID | Component | Status |
|---|---|---|
| P5.01 | Context compression | 🔲 (cost vs quality) |
| P5.02 | **Ordering in prompt ("lost in the middle")** | 🔲 gap |
| P5.03–05 | Token budget, assembly, citations | ✅ CXD-6, G46, CXD-10 |
| P5.06 | Claim-level grounding check | ⏩ Stage 13 |
| P5.07 | **"Not found" handling when evidence is weak** | 🔲 gap (threshold → tell model coverage is partial; prompt rule exists) |
| P5.08 | Iterative / agentic re-retrieval | ✅ model may call file_search again within step limits – 🔲 confirm limits |
| P5.09 | Self-reflection | ✅ partly (AO-10 completion check) |
| P5.10 | Trust boundaries | ✅ UC-1 |

## P6 Structured data
| ID | Component | Status |
|---|---|---|
| P6.01–02 | Tables, header repeat | ✅ Docling, V-6 |
| P6.03 | **Several tables inside one sheet / CSV cleaning** | 🔲 gap |
| P6.04–05 | **SQL over spreadsheets** (e.g. DuckDB in the sandbox) vs pandas only | 🔲 decide |
| P6.06–07 | Code analysis in isolated sandbox | ✅ run_code |
| P6.08 | Formula fidelity | ✅ Stage 8/9 (two loads, cached values) |

## P7 Evaluation (Anthropic: "always run evals")
| ID | Component | Status |
|---|---|---|
| P7.01 / P7.03 | **Retrieval eval set with expected sources** (Indian docs, Tanglish/Hindi/Tamil queries) | 🔲 design in Stage 12, run Stage 21 |
| P7.02 | Metrics recall@k, MRR, nDCG | ✅ R17 recall@k – 🔲 add MRR/nDCG |
| P7.04–06 | Faithfulness, relevance, human review | ⏩ Stage 13 / 21 |
| P7.07–09 | Regression, online, per-stage tests | ⏩ Stage 17 / 21 |

## P8 Operations
| ID | Component | Status |
|---|---|---|
| P8.01 | Latency budget | ✅ p95 ≤800 ms – 🔲 per-step budget |
| P8.02 / P8.07 | Doc-embedding + ingestion caching | ✅ dedupe |
| P8.03 | Query-embedding cache | ✅ R20 Later – 🔲 reconsider MVP (cheap) |
| P8.04–05 | Result cache | ❌ |
| P8.06 | Prompt caching | ✅ |
| P8.08–09 | Quotas, backoff | ✅ E5–E7 |
| P8.10–12, P8.15 | Freshness, deletion, tenant isolation, expiry | ✅ G42, R19, RLS, chat delete |
| P8.13–14 | Observability, cost | ⏩ Stage 17 / 18 |
| P8.16 | Re-embed on model change | ✅ R3 |
| P8.17 | **Safe index switch during re-embedding** (dual column / version flag) | 🔲 gap |

## Result
- Already decided: ~45 components.
- **Stage 12 must decide: 26 items (🔲)**, including 12 gaps that the first detailed prompt did not cover: P1.06, P1.07, P1.11/P4.10, P2.11, P3.06, P3.12, P4.05, P4.11–12, P5.02, P5.07, P6.03–05, P8.17.
- Not in MVP: SPLADE, ColBERT/ColPali, graph RAG, federated, late chunking, HyDE / step-back / hypothetical questions (eval-only).
- Detailed research prompt updated → 12-astra-prompt.md v3 (Section I added).

## Addendum 2026-10-03 – Does Claude have language-specific retrieval/chunking? (official check)
- **Claude model has no retrieval layer of its own; Anthropic has no embedding model.** Official: "Anthropic does not offer its own embedding model" → recommends Voyage AI (voyage-4 family "multilingual retrieval", voyage-context-4 contextualized chunks, rerank-2.5). No Tamil/Hindi statement on that page. Voyage is not on Vertex / India storage → not usable for ArcNave. (platform.claude.com/docs/en/build-with-claude/embeddings)
- **Claude citations chunking is language-agnostic:** plain text and PDF "chunked into sentences"; custom content "used as-is and no further chunking is done". No language-specific or non-English sentence-splitting rule documented. (…/build-with-claude/citations)
- Claude multilingual guidance (saved fact): native script works better than transliteration; Hindi benchmarked, Tamil not.
- **ArcNave implication (new gap P1.09-IN):** language handling is our job – our chunker must split Indic sentences correctly (Hindi danda "।" and "॥", Tamil full stop), we pass our chunks to Claude as search_result / custom-content blocks (so Claude's sentence splitter is never relied on), plus Unicode normalisation (P1.07), per-language keyword config (P3.02) and Tanglish transliteration (P2.10).

## Direction agreed in discussion 2026-10-03 (to confirm in Stage 12 decisions) – LANG-1 "no hard-coded language logic"
- User point: models (Claude, Gemini) already understand/answer Tamil + Tanglish well → don't build language rules.
- Agreed split: **AI handles language** wherever an LLM is in the path; only the non-LLM search parts need minimal, generic handling.
  1. Query rewrite (M3, already an LLM step): prompt asks for standalone query + English version + native-script version when the user wrote romanised Tamil/Hindi → covers P2.08/P2.09/P2.10 with one prompt line, no extra component.
  2. Unicode NFC normalisation at index + query time: 1 generic line of code, not language rules.
  3. Keyword search: one generic config ('simple') for all languages; no per-language stemmers unless eval shows need.
  4. Chunking: token/structure-based (Docling); chunks passed to Claude as search_result/custom-content blocks, so no dependence on sentence splitting.
  5. Eval (Tanglish/Tamil/Hindi queries over English + Tamil docs) decides if anything more is needed.
