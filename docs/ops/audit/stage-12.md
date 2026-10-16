# Stage 12 — Retrieval: conformance audit

Sources read: `Stage-12-Retrieval/00-checkpoint-stage12.md` (incl. doc-syncs 2026-10-03 ×2, 2026-10-05, 2026-10-06 ×2, 2026-10-07, 2026-10-08 ×2), `12c-retrieval-flow.md`, `12b-component-map.md`, `12-retrieval.md` (RD table only), `12a-scope-results.md` (headings only — it is research, no locked outcome beyond what 12b/12c carry); `00-numbers-register.md` (N-04, N-05, N-07, N-14, N-15, N-26, N-27, N-28); `00-build-plan-arcnave-tech.md` (ADR-0059, P2-D); repo `CLAUDE.md` (Invariants 3, 4), ADR-0061; code `backend/src/services/retrieval.ts`, `tools/executor.ts`, `tools/definitions.ts:1-60`, `services/generation.ts:1930-2050`, `services/memory/chatSearch.ts`, `db/schema.ts:140-210`, `config.ts:159-180`, `backend/sandbox/Dockerfile*`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Port source: `arcnave.in:backend/apps/lvrunner/src/arcnave_lvrunner/{rerank.py,rank_clients.py,rankmetrics.py,lv129.py,lv131.py}` (reranker/Ranking API measurement tools and nDCG/MRR metrics only — LV test code, not a retrieval package). There is no `packages/retrieval` in the archived build.

## 1. Locked decisions
The latest doc-sync wins: reranker = Vertex Ranking API (2026-10-06 / 2026-10-07, ADR-0007) — the earlier "A+ bge-reranker in the Executor" update and the draft D4 option B are SUPERSEDED; planner model = `gemini-3.5-flash-lite` (2026-10-08), replacing `gemini-3.1-flash-lite`, planner timeout ~300 ms re-decided in Phase 2 (LV-134); BM25 addressed on the company's own partition (2026-10-05, ADR-0005); table list-partitioned per company (2026-10-03 Stage 20 review, VS-7).

12-retrieval.md draft ids (RD-1…RD-16) map to the rows below; where 12c / the checkpoint disagree with the draft, 12c wins. Draft **RD-8** (text chunks Fast 5 / Normal 12 / Deep 30) is SUPERSEDED by D2 (token share); **RD-7** options A–D are SUPERSEDED by ADR-0007. RE1–RE53 are not listed one by one: the RE ids that 12c names are carried in each row; the rest are technical defaults folded into the rows.

| Id | Decision (one line) | Status |
|---|---|---|
| L-01 LANG-1 | No hard-coded language logic; start with variant A (raw query, NFC, one generic keyword config); Stage 21 compares B (AI rewrite to English + native script), C (per-language config), D (Indic sentence splitting) | LOCKED |
| L-02 D1 (RD-11) | Whole-file limit decided by Stage 21 test; build starts at 30k (Deep 100k test arm); per file: sent whole or retrieved; whole-sent files excluded from search; not-yet-embedded files keyword-only with "N files indexing" (RE31, RE32) | LOCKED |
| L-03 Step 0 chunking | Page furniture out of chunks (kept for provenance), NFC (no NFKC, joiners kept), ~800 tokens / 15 % overlap + heading path, PDF page index + printed page label (RE20, RE48) | LOCKED |
| L-04 Step 0 embeddings (RD-3, RD-13) | Gemini Embedding 2, 1,536 dims, prefix format, tokens counted first, 1 page per image request; `embed_model` version; `index_status` text_ready → vectors_ready; low-priority upload lane; versioned re-embedding with switch + rollback (RE2–RE4, RE18, RE32, RE34) | LOCKED |
| L-05 Audio | 60–120 s segments with t_start–t_end (RE40) | LOCKED |
| L-06 Scope (RT-1 revised, RD-1) | Scope = chat files + project files; access re-resolved every turn; RLS `SET LOCAL` + explicit `company_id`; planner filters only narrow (RE10, RE36, RE46, RE50) | LOCKED (RLS/company part DEFERRED) |
| L-07 D2 | Retrieval share Fast 6k / Normal 20k / Deep 80k (provisional) (RE25) | LOCKED (N-04) |
| L-08 D3 (RD-2) | Query planner: one `gemini-3.5-flash-lite` call → needs_retrieval, intent, standalone query (previous cite ids), sub-queries, filters, needs_visual, LANG-1 variants; only on turns that search files; timeout → raw query (RE9, RE26, RE30, RE41, RE42) | LOCKED (model provisional; LV-134 decides merged turn analyzer vs separate; timeout re-decided) |
| L-09 Intent table | lookup → search; summarise/list-all → map-reduce (AO-6); compare → one sub-query per file; numbers/Excel → DuckDB / run_code; none → skip | LOCKED |
| L-10 Keyword (RD-4) | BM25 via pg_textsearch (field weights A–D — LV-54: not available in 1.3.1, title boost needs another design), `simple` config, fallback `ts_rank_cd` + pg_bigm/pg_trgm; runs parallel with the planner; own-partition addressing (ADR-0005) (RE7, RE8, RE33) | LOCKED |
| L-11 Vector (RD-5) | Exact search when few rows in scope, HNSW + iterative scan with exact fallback otherwise; text vectors always, page-image vectors when needs_visual (RE28) | LOCKED |
| L-12 Cache (RD-16) | Query-embedding cache in Redis, key = hash(company, model@version, dims, prefix, NFC query), 1 h (RE35) | LOCKED — DEFERRED (Redis) |
| L-13 Merge (RD-6, RD-10) | RRF k=60; same page text+image merged; near-duplicates ≥0.95 shown once with both citations; MMR λ 0.5 on Normal/Deep after rerank; coverage flag high/low/none (RE5, RE12, RE15, RE44, RE47) | LOCKED |
| L-14 D4 / M5 (RD-7) | Reranker always in architecture: Vertex AI Ranking API (`global`, `semantic-ranker-default-004` GA; development `-005` Preview), top 30 RRF candidates, no SDK retries, explicit timeout, conditional rerank, RRF order + `degraded` on error/429 (RE1); p95 ≤ 600 ms (N-26) | LOCKED (ADR-0007) |
| L-15 Selection | Fill the D2 share: top chunks → page images → neighbours ±1 as merged spans; never resend a chunk already in history; Claude page images ≤2,000 px from the first turn with a per-chat image budget (RE25–RE27, RE49) | LOCKED |
| L-16 Prompt (RD-9) | Documents first, question last, most relevant first, same file in page order; citation registry per chat (`cite_id` → file_version + page / sheet!range / time + hash, `[file:n]`); Claude `search_result` blocks with citations OFF + image blocks; Gemini documents block; flags coverage / indexing / degraded (RE14, RE15, RE29, RE30, RE32, CR1–CR4) | LOCKED |
| L-17 D5 | Extra `file_search` calls per turn Fast 1 / Normal 3 / Deep 6; results already in context return "already provided as [file:n]" (RE53, RE49, RE43) | LOCKED (N-07) |
| L-18 After the turn | Provider-neutral retrieval record per turn (regenerate reuses, edit re-runs, model switch re-renders); compaction turns old passages/images into stubs; replaced files show "source replaced" (RE42, RE26, RE27, RE38) | LOCKED |
| L-19 D6a | Deleted file leaves search immediately; index cleanup scheduled; retrieval reads primary DB (RE37) | LOCKED |
| L-20 D6b | Deleted file's text also removed from earlier turns of the chat ("[source deleted]" stub; Claude history rebuilt from the edit point) | LOCKED (lawyer item) |
| L-21 Degraded mode | Planner fail → raw query; embedding fail → keyword only; reranker fail → RRF order; DB slow → statement_timeout + partial; model told "search may be incomplete"; alert | LOCKED |
| L-22 Ops (RD-12) | DuckDB (locked down) in the sandbox image; several tables per sheet detection (Stage 9); latency budget N-27; versioned re-embedding (see L-04) (RE17, RE39, RE45, RE52) | LOCKED |
| L-23 Ops: tenancy | Per-company search caps and timeouts, separate retrieval DB pool, off-peak CONCURRENTLY index builds | LOCKED — DEFERRED |
| L-24 Not in MVP | Context compression (RD-14), parent-section expansion, file summaries, HyDE/step-back, graph RAG, ColBERT/ColPali, SPLADE, Vertex RAG Engine | LOCKED |
| L-25 Eval (RD-15) | Labelled set English/Tanglish/Hinglish/Tamil/Hindi × English/Tamil/Hindi docs incl. scanned, cross-language, no-answer; recall@10, nDCG@10, MRR; compares LANG-1 A–D, reranker options, planner models, D1 30k vs 100k | LOCKED (Stage 21; designed in Phase 2 P2-D) |
| L-26 VS-7 / ADR-0005 | Chunk tables list-partitioned per company, BM25 + HNSW per partition; at ~1,000 companies re-evaluate | LOCKED — DEFERRED (company) |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched: …)" |
|---|---|
| L-01 | Tokenizer keeps only ASCII: `text.toLowerCase().match(/[a-z0-9']+/g)` plus an English stop list (`retrieval.ts:410-419`); BM25 returns `[]` when no term survives (`:458-459`) → a Tamil or Hindi query finds nothing and Tamil/Hindi chunks tokenise to nothing. No NFC (searched `normalize(` in `retrieval.ts`: none). Contrast: `memory/chatSearch.ts:65-66` and `schema.ts:794` use Postgres `'simple'`, `memoryService.ts:10-13` uses `\p{L}\p{N}`. |
| L-02 | Project files only: all files whole while every file is fully indexed and the total ≤ `PROJECT_FULL_CONTEXT_MAX_CHARS` 200,000 chars (`generation.ts:1957-1965`, `config.ts:171`); else the model is told to use `search_project_files` / `read_project_file` (`generation.ts:1975-1984`); a turn with no tools gets 8 excerpts / 12,000 chars (`generation.ts:336-337, 1994-2010`). Not per file, not in tokens, no "N files indexing" flag (`indexing` exists only as a Projects-page UI state, `Pages.tsx:366,489`). Chat attachments are sent as bytes/pages/text up to 100 PDF pages (`generation.ts:251-261`, ADR-0013/0020), never searched. |
| L-03 | `CHUNK_TARGET_CHARS` 1,400, `CHUNK_OVERLAP_CHARS` 180, `MAX_CHUNKS_PER_FILE` 400 (`retrieval.ts:20-22`); split on blank lines, hard split of long paragraphs (`:370-408`); chunked per page, `page` column 1-based (`:677-704`, `schema.ts:199-201`); extra chunks beyond 400 are silently dropped (`:686`, flag `whole` false `:632`). No heading path, no page label, no furniture removal, no NFC. Scanned PDF OCR returns one page-less block (`:166-180`). |
| L-04 | not found (searched: `embedding`, `pgvector`, `vector(`, `embed_model`, `index_status` in `backend/src`, `drizzle/*.sql`, `package.json`: only comments saying there is none, `retrieval.ts:5-7`, `schema.ts:183-184`). |
| L-05 | Audio/video is transcribed to **one text block** (`retrieval.ts:189-215`); no timestamps or segments. |
| L-06 | Scope = one `projectId` (`retrieval.ts:451-486`, `tools/executor.ts:51-57`); membership is the project row; chat files never indexed. No company_id, no RLS, no `SET LOCAL`. |
| L-07 | not found as budgets; fixed caps in L-02. |
| L-08 | not found (searched: `planner`, `needs_retrieval`, `intent` in `backend/src` non-test; the only router is rule-based, `services/routing/turnRouter.ts`). |
| L-09 | Numbers/Excel: the model reads files with code in the sandbox (`generation.ts:314-324`, ADR-0045); no DuckDB (searched `duckdb` in `backend/sandbox`, `backend/src`: none; `Dockerfile.service:27-28` has openpyxl/pdfplumber/pypdf). Summarise-all: no map-reduce (see Stage 10 AO-6). |
| L-10 | BM25 scored **in JavaScript over every ready chunk of the project, loaded per query** (`retrieval.ts:451-487, 503-547`); k1 1.5, b 0.75 (`:490-491`); no field weights, no SQL/FTS index on `file_chunks` (`schema.ts:203-206`: only ordinal and project indexes). |
| L-11 | not found (see L-04). |
| L-12 | not found; Redis absent. |
| L-13 | not found (searched: `rrf`, `reciprocal`, `mmr`, `coverage` in `backend/src` non-test). Single BM25 list sorted by score (`retrieval.ts:542-547`). |
| L-14 | not found (searched: `ranking`, `semantic-ranker`, `rerank` in `backend/src`). |
| L-15 | Excerpts joined until a char budget (`retrieval.ts:555-571`); PDFs as page images + text (ADR-0013). No "already in history" dedupe, no ±1 neighbours (`read_project_file` pages by char offset `tools/executor.ts:98-130`). 2,000 px / per-chat image budget: not verified (`attachments/pdfPages.ts` not read). |
| L-16 | Excerpts are plain `--- file (p. N) ---` blocks (`retrieval.ts:555-571`), tool results are JSON with fileId/filename/page/score/text (`executor.ts:87-95`). No `[file:n]` registry (searched `\[file:`, `cite_id`, `chat_citation` in `backend/src`, frontend: none), no `search_result` blocks, no coverage/indexing/degraded flags. Web-source chips exist only as `#source-N` links the frontend resolves (`Content.tsx:252-264`); no producer of those links found in `backend/src`. |
| L-17 | `search_project_files` takes `limit` ≤10 per call (`executor.ts:31-34`); no per-turn call cap (searched `perTurn`, `MAX_CALLS` in `tools/`: none); no "already provided". Tool name is `search_project_files`, not `file_search`. |
| L-18 | not found (searched: `retrieval_record`, `stub` in `backend/src`); old tool results are replayed in full (ADR-0023) or compacted (`services/compaction`). |
| L-19 | `file_chunks.project_file_id` `onDelete: cascade` (`schema.ts:190-195`); search joins `project_files.status = ready` (`retrieval.ts:472`). |
| L-20 | not found; deleted-file text stays in earlier turns. |
| L-21 | not found (no stages to degrade; only `ExtractionUnsupported` at index time `retrieval.ts:25-31`). |
| L-22 | DuckDB: see L-09. Statement timeouts / pools: not found (`config/numbers.ts:69-73` has only `DB_POOL_MAX` 10). |
| L-24 | None of the excluded components is built; the Vertex RAG Engine is not referenced (searched `rag`, `Vertex AI Search` in `backend/src`: only the comment `retrieval.ts:6-7` naming it as a possible replacement seam). |
| L-25 | not found (searched: `ndcg`, `recall@`, `mrr` in `backend/src`); `scripts/evalScope.ts` exists for scope evaluation (not read). Build plan P2-D schedules it. |
| L-23, L-26 | not found (no company). |

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| L-01 | REWRITE | English-only tokenizer and stop list make Tamil/Hindi invisible (retrieval.ts:415-419) |
| L-02 | REWRITE | all-or-nothing project chars, no per-file decision, no chat scope |
| L-03 | REWRITE | 1,400/180 chars, 400-chunk cap, no heading path / label / NFC / furniture removal |
| L-04 | NEW-BUILD | no embeddings, versions, index_status — **blocked by owner question Q1 (Invariant 4 / ADR-0059)** |
| L-05 | NEW-BUILD | audio gets time segments |
| L-06 | REWRITE | scope becomes chat+project, access re-resolved each turn (RLS deferred) |
| L-07 | REWRITE | char caps → 6k/20k/80k token share (Q3 on token counting) |
| L-08 | NEW-BUILD | planner call; model question Q2 |
| L-09 | NEW-BUILD | intent routing; DuckDB under L-22 |
| L-10 | REWRITE | move scoring out of JS into Postgres (tsvector `simple` / pg_textsearch) |
| L-11 | NEW-BUILD | pgvector search — blocked by Q1 |
| L-12 | DEFERRED | Redis |
| L-13 | NEW-BUILD | RRF, merge, MMR, coverage |
| L-14 | NEW-BUILD | Vertex Ranking API client in the provider layer |
| L-15 | NEW-BUILD | selection order, history dedupe |
| L-16 | NEW-BUILD | citation registry + prompt layout + flags |
| L-17 | NEW-BUILD | per-turn call caps + "already provided" |
| L-18 | NEW-BUILD | retrieval record + stubs |
| L-19 | KEEP | cascade delete + ready-only search (schema.ts:190-195, retrieval.ts:472) |
| L-20 | NEW-BUILD | stub earlier turns |
| L-21 | NEW-BUILD | degraded flags |
| L-22 | NEW-BUILD | DuckDB in sandbox image + several-tables detection |
| L-23 | DEFERRED | per-company caps / pool |
| L-24 | KEEP | none of the excluded parts exists |
| L-25 | NEW-BUILD | labelled set + metrics (reuse rankmetrics.py ideas) |
| L-26 | DEFERRED | per-company partitions (raise-now flag in deferred file) |

Mapping of draft ids: RD-1→L-06/L-16 · RD-2→L-08 · RD-3→L-04 · RD-4→L-10 · RD-5→L-11 · RD-6→L-13 · RD-7→L-14 · RD-8→SUPERSEDED (L-07) · RD-9→L-16 · RD-10→L-13 · RD-11→L-02 · RD-12→L-22 · RD-13→L-04 · RD-14→L-24 · RD-15→L-25 · RD-16→L-12.

Counts (26 ids): KEEP 2 · REWRITE 6 · NEW-BUILD 15 · DIFF-STACK 0 · DIFF-INFRA 0 · DISCARD 0 · DEFERRED 3.

## 4. Non-KEEP items

### L-04 / L-11 — embeddings and vector search versus repo Invariant 4 and ADR-0059 (owner question Q1)
- Conflict: Stage 12 locks hybrid retrieval (BM25 + Gemini Embedding 2 vectors via pgvector, RRF, Ranking API rerank). Repo `CLAUDE.md` Invariant 4 says "Retrieval is lexical … do not add an `embedding` column we cannot search"; `schema.ts:183-184` repeats it; the tool description says "keyword matching, not semantic" (`definitions.ts:14-19`). Planned ADR-0059 (build plan §2 and P2-D): "BM25 now; pgvector hybrid decided at Phase 2 exit if the eval shows the gap". Per ADR-0061 the locked outcome must be met; per ADR-0053/ADR-0061 §4 an owner decision that conflicts goes to the owner. Not resolved here.
- Exact change (either option): build vectors behind the existing seam `Retriever` (`retrieval.ts:434-441`): `file_chunks` gets `embed_model`, `embedding vector(1536)` (HNSW partial index per model), `index_status`; embedding call in `backend/src/providers/` (model SDK rule, `CLAUDE.md` build rules); upload path writes text_ready then vectors_ready; query-time exact/HNSW chosen by in-scope row count. Update Invariant 4 and the tool description in the same commit (the invariant's reason — a column nobody can search — no longer holds, but its "do not call it semantic when it is not" part stays: describe the retriever as hybrid exactly when vectors are on).
- Option A (follow the lock now; amend Invariant 4 via ADR-0059): NEW-BUILD pgvector + `vector(1536)` + Embedding 2 + RRF + reranker now, ahead of the eval. Time L · risk medium (extension in compose/CI Postgres, embedding cost on every upload, an invariant edit) · breaks `retrieval.test.ts`, `projectKnowledge.integration.test.ts` expectations of lexical-only output and the Invariant 4 text.
- Option B (ADR-0059 as planned): keep BM25, build every non-vector part of Stage 12 now (L-01, L-03, L-06, L-08, L-10, L-13 over one list, L-15–L-18, L-21, L-25 eval first), run P2-D (LANG-1 A–D on 20 Indian docs), then vectors if the eval shows the gap. Time M now + L later · risk: if the eval is run on weak BM25 the gap decision may be wrong; locked outcome unmet until then.
- Pick: B for everything not vector-dependent, with the seam kept open, **A is the rule-conformant end state** — the owner must choose Q1 before any `embedding` column is added. No code in this audit touches vectors.

### L-01 + L-10 — language-neutral keyword search in Postgres
- Exact change: delete the ASCII tokenizer and stop list; NFC-normalise text at index and query time; store a `tsvector` (`simple` config) per chunk with a GIN index (field weights A–D for file name / headings / sheet names / body via `setweight`), query with `ts_rank_cd` scoped by the in-scope file ids with a statement timeout; `pg_textsearch` BM25 is the locked primary but LV-54 shows no field weights, so weights stay on the tsvector side; keep `rankBm25` only as a unit-test reference or delete it. Files: `retrieval.ts:410-547`, `tools/executor.ts`, `schema.ts:186-207` + migration, `tools/definitions.ts:12-34` (description stays "keyword"), tests `retrieval.test.ts`. Port source: none (facts only in checkpoint doc-sync 2026-10-05).
- Option A (REWRITE to `pg_textsearch` BM25 on the chunk table): locked primary, true BM25. Time M · risk: extension must exist in the compose image, CI service and Cloud SQL (LV-54 passed on dev) · breaks tests that call `rankBm25`.
- Option B (REWRITE to GIN `tsvector('simple')` + `ts_rank_cd`, the locked fallback): runs on stock Postgres 16, no image change. Time M · risk: ranking is not BM25 (document this in the tool description, Invariant 4) · breaks `rankBm25` tests.
- Pick: B now (keeps the app runnable and CI unchanged; same tsvector pattern as `schema.ts:794`), switch to A when the Postgres image/Cloud SQL flags carry the extension. Fixes the Tamil/Hindi blind spot immediately.

### L-02 / L-03 / L-06 / L-07 — scope, whole-vs-retrieve, chunking, budgets
- Exact change: scope = this chat's attachments + the project's files, access re-read each turn; per-file decision (whole if the file fits the D1 budget, else retrieve; whole-sent files excluded from search); "N files indexing" flag; chunk ~800 tokens / 15 % overlap with heading path, page index + printed label, NFC, furniture excluded (but stored); no silent drop at 400 chunks (raise the per-file cap to cover N-10's 1,000 pages or fail loudly); budgets 6k/20k/80k from `config/numbers.ts` with N-ids. Files: `retrieval.ts`, `generation.ts:1930-2050`, `tools/executor.ts`, `schema.ts` (`file_chunks` gets `attachment_id` or a unified `source_file_id`), `processUpload.ts`, `config.ts:171`. Port source: none.
- Option A (NEW-BUILD a `files` scope layer that indexes chat attachments into the same chunk table, switch the prompt builder, then retire project-only code): Time L · risk medium (indexing cost per upload; Gemini OCR per scanned file) · breaks `projectKnowledge.integration.test.ts`, `attachmentBudget.integration.test.ts`.
- Option B (REWRITE only the project path: chunk numbers, label, NFC, per-file decision; chat files stay in the prompt as today): Time M · risk: Stage 12 scope (RT-1 revised) stays unmet for chat files.
- Pick: A, in this order: chunker (L-03) → keyword store (L-10) → per-file decision (L-02) → chat scope (L-06). Token sizes need Q3.

### L-08 / L-09 — query planner and intent routing
- Exact change: one structured call per file-searching turn (needs_retrieval, intent, standalone query using previous cite ids, sub-queries, filters, needs_visual); intent table to action; timeout → raw query; LV-134 compares merged turn analyzer vs separate calls. Files: new `services/retrieval/planner.ts`, model call in `providers/` (gateway rule), `generation.ts`. Port source: none (`arcnave.in:backend/apps/lvrunner/src/arcnave_lvrunner/router.py` and `lv135.py` are router measurement tools).
- Option A (NEW-BUILD with `gemini-3.5-flash-lite` as locked): Time M · risk: adds a model outside ADR-0055 "three models" (Q2) and ~1 s floor per call (doc-sync 2026-10-08).
- Option B (use Gemini 3.8 Flash, MINIMAL thinking, for the planner): Time S · risk: more cost per call than Flash-Lite; no model-policy conflict.
- Pick: wait for Q2; build the structured-call plumbing and the intent switch with Option B's model so the plan runs today.

### L-13 / L-14 — merge, rerank, coverage
- Exact change: RRF k=60 over the lists, same-page merge, near-dup ≥0.95 with both citations kept, conditional rerank through the Vertex Ranking API (top 30; development `-005`, production pin per ADR-0007), MMR λ 0.5, coverage from the reranker score; on timeout/error/429 RRF order + `degraded`. Files: new `services/retrieval/{merge,rerank}.ts`, `providers/rank.ts` (no SDK retries, explicit timeout, ADC). Port source: `arcnave.in:backend/apps/lvrunner/src/arcnave_lvrunner/rerank.py`, `rank_clients.py` (request shape, timeouts), `rankmetrics.py` (nDCG@10/MRR).
- Option A (NEW-BUILD all after a single keyword list exists, RRF with one list is the identity): Time M. Option B (add the reranker first over BM25 top 30): Time S · risk: reranks only lexical candidates.
- Pick: A; rerank is useful already over the keyword list, so ship it with L-10.

### L-15 / L-16 / L-17 / L-18 — selection, citation registry, call caps, retrieval record
- Exact change: per-chat citation registry (`chat_citation`: cite_id, file_version, page / sheet!range / t_start, text hash) so `[file:n]` is stable for the chat; prompt layout (documents first, question last); Claude `search_result` blocks with citations OFF; Gemini documents block; flags coverage / indexing / degraded; `file_search` replaces `search_project_files` (Stage 8 TD-1c names) with per-profile caps 1/3/6 and "already provided"; `retrieval_record` per turn reused by regenerate and re-rendered on model switch; compaction stubs; "source replaced". Files: new tables + migration, `services/retrieval/*`, `generation.ts`, `anthropic.ts`/`gemini.ts` message builders, `compaction`, frontend Stage 14 RD-4. Port source: none.
- Option A (NEW-BUILD registry first, then switch tool results to cite ids, then the record): Time L · risk medium · breaks `executor` tests and prompt-kit cases that expect JSON results.
- Option B (REWRITE existing tool results to add ids only): Time M · risk: no stability across turns, regenerate/edit unmet.
- Pick: A. D5 caps need the profile (Stage 10 O-2).

### L-05 / L-20 / L-21 / L-22 / L-25 — smaller items
- L-05: audio transcription with timestamps (Gemini returns segments), chunk 60–120 s with `t_start`/`t_end` (`retrieval.ts:189-215`). Time S–M.
- L-20: replace deleted-file text in earlier turns with "[source deleted]" at read time (history builder `generation.ts` `loadHistory`) and rebuild Claude history from the edit point. Time M; lawyer item remains.
- L-21: `degraded`/`indexing` flags in the prompt + alert-ready log counters (ids only). Time S, after L-08/L-13.
- L-22: add DuckDB (pip) to `backend/sandbox/Dockerfile.service:27-28`, lock down network (already no egress, ADR-0007), several-tables detection on upload. Time S.
- L-25: 20 Indian sample docs + labelled queries; metrics recall@10 / nDCG@10 / MRR; run LANG-1 A–D against BM25 (build plan P2-D). Time M (Opus design, Sonnet run).
- Pick: A for each (build in the flow order above).

## 5. Open questions for the owner
- Q1. Invariant 4 / ADR-0059 versus the Stage 12 hybrid lock (see §4 L-04/L-11): build pgvector + Embedding 2 + RRF + Ranking API now and amend Invariant 4 (Option A), or keep BM25 until the P2-D eval decides (Option B, the ADR-0059 plan)? Embedding every upload costs money (Embedding 2 $0.20 / M text tokens, N-36) and the eval needs both arms.
- Q2. Model policy: the planner is `gemini-3.5-flash-lite` (and, per the 2026-10-08 doc-sync, may merge with the Haiku 5.5 router, ADR-0013); repo ADR-0055 / B-4 say three models only (Gemini 3.8 Flash, Sonnet 5.5, Opus 5.5). Embedding 2 and the Ranking API are non-chat models. Do the helper models (planner, embedding, ranking, router, judge) sit outside the "three models" rule?
- Q3. N-14 (~800 tokens) and N-03/N-04/N-05 (tokens) need a token count; Invariant 3 forbids an estimator, N-75 introduces one for context. Express chunk size and the retrieval share in characters (recommended, as `numbers.ts` already does) or approve a counting call/estimator?
- Q4. D1 says Stage 21 decides 30k vs 100k; the repo has 200,000 chars all-or-nothing. Keep 200,000 chars until the test, or start at the locked 30k tokens?

## 6. KEEP spot-check
(2 KEEP rows; both re-opened = 100 %.)
| Id | file:line | Result |
|---|---|---|
| L-19 | `schema.ts:190-195` (`onDelete: cascade` from `project_files`), `retrieval.ts:472` (`status = ready`) | confirmed for project files; text in earlier turns is not removed (that is L-20) |
| L-24 | `retrieval.ts` has no compression / HyDE / graph / SPLADE; no Vertex RAG Engine call (searched `rag`, `Vertex AI Search` → comment only) | confirmed |

## Numbers that differ (N-xx)
| N | Register value (line in `00-numbers-register.md`) | Repo value (file:line) |
|---|---|---|
| N-04 | retrieval share Fast 6k / Normal 20k / Deep 80k (l.9) | 8 excerpts / 12,000 chars without tools (`generation.ts:336-337`); whole-project cap 200,000 chars (`config.ts:171`) |
| N-05 | whole-file 30k tokens, Deep 100k test arm (l.10) | 200,000 chars total for all project files (`config.ts:171`) |
| N-07 | file_search per turn 1-3-6 (l.12) | per-call limit ≤10, no per-turn cap (`tools/executor.ts:31-34`) |
| N-14 | ~800 tokens / ~15 % overlap (l.19) | 1,400 chars / 180 chars (12.9 %), max 400 chunks (`retrieval.ts:20-22`) |
| N-15 | 1,536 dims (l.20) | no vector column (`schema.ts:183-184`) |
| N-26 | Ranking API `-004`, top 30, p95 ≤ 600 ms (l.31) | none |
| N-27 | planner 300 / embed 250 / search 100 / rerank 600 / assemble 50 → p95 ≤ 1,200 ms (l.32) | none |
| N-28 | planner timeout ~300 ms (l.33; re-decided in Phase 2 per doc-sync 2026-10-08) | none |
