# ArcNave – Stage 4 · L5c Retrieval Service – full audit
_2026-10-01 · Status: LOCKED (2026-10-01) · Labels: Vendor / Partial / ArcNave rec_

> **Doc-sync 2026-10-03 (Stage 12) – Stage 12 Retrieval (see Stage-12-Retrieval/00-checkpoint-stage12.md):**
> - **RT-1 revised:** scope = chat files + project files; allowed ids re-resolved every turn; RLS SET LOCAL + explicit company_id.
> - **R4:** Vertex Ranking API does NOT support Tamil → reranker = bge-reranker-v2-m3 (int8) inside Turn Executor, always on; final by Stage 21 bake-off.
> - **R9:** Gemini Embedding 2 has no task_type – uses text prefixes (query / document); 8,192-token silent truncation → pre-count.
> - **R20:** query-embedding cache is MVP (Redis Mumbai, hashed key incl. company + model version, 1 h).
> - Pipeline now: planner (M3 Flash-Lite) ‖ BM25 keyword → embed → exact/HNSW by row count → RRF k=60 → dedupe → rerank → MMR → coverage flag → per-profile share → citation registry. Full flow: 12c-retrieval-flow.md.


## Contract
Input: question + chat context, tenant ctx, retrieval scope (allowed file ids), k, filters, language. Output: ranked chunks {chunk_id, file_id, page/section, text, score, source_meta, embedding_version} ready for citations.
Pipeline: query rewrite (M3) → query embedding (M4, RETRIEVAL_QUERY) → vector + keyword search (tenant/scope filter INSIDE query) → rank fusion → rerank (M5) → threshold → neighbor expansion → token-budget fit → citation-ready output.

## Audit dimensions
1 Query understanding · 2 Embedding · 3 Search · 4 Ranking · 5 Output/citations · 6 Scope & security · 7 Consistency/deletion · 8 Latency/quota · 9 Multilingual/structured data · 10 Evaluation — all checked.

## Items
| # | Item | Source | Rec |
|---|---|---|---|
| R1 | Tenant + scope filter inside the search query | ArcNave rec | MVP – security |
| R2 | Embedding limits (2,048 tokens/text silent truncate → autoTruncate=false; 250 texts / 20k tokens per request; dims configurable) | Vendor (Google) | MVP |
| R3 | Embedding model+version per chunk; model change = re-embed | ArcNave rec | MVP |
| R4 | Vertex Ranking API (global, ≤200 records, ≤1,024 tokens/record) | Vendor (Google) | Stage 12 |
| R5 | Hybrid (vector + BM25) + rank fusion + threshold + query rewrite | Vendor (OpenAI, Anthropic, Perplexity) | MVP |
| R6 | Managed Vertex RAG Engine vs own pipeline | Vendor (Google) | Stage 12 |
| R7 | Contextual retrieval slot | Vendor (Anthropic) | Slot MVP |
| R8 | Citation-ready output (source, page) | Vendor | MVP |
| R9 | **Asymmetric task types**: questions RETRIEVAL_QUERY, chunks RETRIEVAL_DOCUMENT (gemini-embedding-001, multilingual-002, text-005) | Vendor (Google) | MVP |
| R10 | **Self-contained spans** as retrieval unit (Perplexity indexes sub-document spans; Anthropic contextualized chunks) | Vendor (Perplexity official blog, Anthropic) | MVP |
| R11 | **Multi-stage ranking**: fast first stage, many candidates → cross-encoder rerank → top-N | Vendor (Perplexity, Anthropic ~150→20) | MVP |
| R12 | **Retrieval scope + file permission**: which files searchable this turn (MVP: files attached in this chat); file visible only to uploader unless shared | ArcNave rec | MVP – security |
| R13 | Claude `search_result` blocks (source, title, content; one citation setting for all results in a request; cited_text not billed as output) ; Gemini citations normalized | Vendor (Anthropic) | MVP |
| R14 | **XLSX/CSV numbers**: don't answer aggregations via text chunks → route to code/sandbox or table query | ArcNave rec (+ Gemini code execution exists) | MVP planner rule |
| R15 | Tamil/Hindi questions over English docs → multilingual embedding + eval cases | Partial (Google multilingual models) + ArcNave | MVP |
| R16 | Latency budget for retrieval (reference: Perplexity Search API p50 358 ms, p95 763 ms) | Partial (Perplexity) | MVP measure |
| R17 | Retrieval evals (recall@k on fixed set; Perplexity open-sourced search_evals) | Vendor pattern | MVP offline |
| R18 | Similarity metric consistency; quantization (INT8/binary) to cut storage | Vendor (Perplexity embeddings) | Stage 12 |
| R19 | Deletion propagation to vector + keyword indexes | ArcNave rec | MVP (DPDP) |
| R20 | Query-embedding cache | ArcNave rec | Later |
| R21 | Neighbor-chunk expansion | ArcNave rec | Stage 12 |
| R22 | Embedding quota (gemini-embedding-001 5M TPM regional) | Vendor (Google) | MVP check |

## Decisions
| ID | Question | Rec |
|---|---|---|
| RT-1 | MVP retrieval scope | Files attached in the current chat only |
| RT-2 | Own pipeline vs Vertex RAG Engine | Decide Stage 12 (lean own: hybrid + tenant filters + contextual retrieval control) |
| RT-3 | Retrieval latency target | p95 ≤ ~800 ms (validate in load test) |

## Lock (user, 2026-10-01)
- R1–R22 accepted; RT-1 chat-attached files only; RT-2 Stage 12; RT-3 p95 ≤ ~800 ms target. Model picks per role decided in their stages (map in chat recap).
