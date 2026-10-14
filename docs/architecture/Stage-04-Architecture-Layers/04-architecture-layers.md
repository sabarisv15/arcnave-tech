# ArcNave – Stage 4: Architecture Layers (technical)
_Last updated: 2026-09-30 · Status: DRAFT_
_Based on: 01, 02, 03 (all LOCKED) + 04a-vendor-doc-research.md (changes C1–C10 applied)_

## 0. Layer map
```
L1  Client layer            Web app · Android app
────────────────────────────────────────────────────────────────
L2  Edge layer              Load balancer · TLS · WAF · size limits
────────────────────────────────────────────────────────────────
L3  API layer               REST + streaming endpoints · auth check · idempotency
────────────────────────────────────────────────────────────────
L4  Orchestration layer     Turn pipeline (state machine) · policy · plan · tool loop
────────────────────────────────────────────────────────────────
L5  Intelligence services   Model Gateway · Context · Retrieval · Memory · Tools · Speech · Safety
────────────────────────────────────────────────────────────────
L6  Async processing layer  Job queue · File pipeline · Embedding/indexing · Memory writer
────────────────────────────────────────────────────────────────
L7  Data layer              Relational DB · Object storage · Vector index · Cache · Audit log
════════════════════════════════════════════════════════════════
L8  Platform (cross-cutting) Identity · Secrets · Config/flags · Observability · Usage & budget · CI/CD · IAM
```
Deploy mapping (from Stage 2): L3 + L4 + L5 (sync parts) → **API service**. L6 (+ L5 code it needs) → **Background worker**. L7 = managed services in Mumbai. L8 = shared.

## 1. Layer rules (ArcNave design)
1. A layer only calls the layer directly below it, through a defined interface. No skipping (e.g., client never calls a model; orchestrator never writes SQL directly – it uses repositories).
2. **Ports & adapters:** every external vendor (Gemini, Claude, embedding model, vector DB, speech, storage) sits behind an interface ("port") with one "adapter" per vendor. Swap vendor = new adapter, no change above.
3. **Tenant context travels with every call:** {company_id, user_id, role, request_id} passed down every layer; every query/filter uses company_id.
4. **One internal format:** ArcNave has its own message/event format. Adapters translate to/from Gemini and Claude formats at the edge of L5.
5. **Stateless API service:** no user state in server memory; state in L7 (DB/cache). Any instance can serve any request → autoscaling works.

## 2. Layer details

### L1 – Client layer (Web + Android)
| Component | Job |
|---|---|
| Composer | Text box, attach button, mic button, model picker (list from server) |
| Upload client | Gets one-time signed upload URL from L3, uploads directly to storage, polls/receives file status |
| Mic capture | Records audio → sends to Speech endpoint → inserts text (editable) |
| Stream renderer | Receives stream events, renders markdown/tables/code progressively |
| Session + reconnect | Holds login token; on network drop, reconnects and fetches the saved/continuing answer (D3) |
| Local state | Drafts, UI state only. No business logic, no secrets |

### L2 – Edge layer
| Component | Job |
|---|---|
| HTTPS load balancer | Single public entry, TLS, routes to API service |
| WAF / DDoS protection | Block abusive traffic, IP rules |
| Request limits | Max body size, timeouts (long-lived for streaming) |
| CORS | Only ArcNave web origin allowed |

### L3 – API layer (API service)
| Endpoint group | Job |
|---|---|
| Auth check (middleware) | Verify login token → tenant context (1.2) |
| Chat | Create turn (streaming response), stop turn (7.2), resume stream (D3) |
| Conversations | List / open / rename / delete chats |
| Files | Issue signed upload URL; file status; delete |
| Speech | Audio → text |
| Models | Allowed models for this user (Claude hidden if switch OFF) |
| Admin | Company settings (Claude switch, quotas), users, roles |
| Cross-cutting | Schema validation (1.3), idempotency key check (1.4), rate limit (1.5) |

### L4 – Orchestration layer (the brain)
Runs one **turn** as a pipeline of steps (state machine). Each step = small replaceable module.
```
RECEIVED → POLICY_CHECK → PLAN → SAFETY_IN → BUILD_CONTEXT → GENERATE ⇄ TOOL_LOOP → VALIDATE → SAVE → DONE
                                     (any step can go → FAILED / STOPPED)
```
| Module | Job | Detail stage |
|---|---|---|
| Policy engine | Model allowed? Claude switch? quota/budget left? | 16, 18 |
| Planner / classifier | Decide request type: chat / file-QA / tool / multi-step; decide full-content vs RAG [C2]. **Query-aware routing** lives here: look at the question → pick model + tools | 7, 10 |
| Context builder call | Ask Context service to assemble prompt within token budget | 6 |
| Generation runner | Call Model Gateway, forward stream events to client | 7, 14 |
| Tool loop runner | Handle tool calls, enforce max steps, timeouts, permissions | 8 |
| Validator call | Check output before final save / before showing structured output | 13 |
| Event emitter | Sends typed stream events: `ack`, `status`, `delta`, `citation`, `tool_status`, `done`, `error`; every event has `sequence_number`, buffered for resume [C5, C7] | 14 |
| Turn state store | Saves step progress so a turn can resume/continue after disconnect | 14, 15 |

### L5 – Intelligence services layer
| Service | Inside it | Detail stage |
|---|---|---|
| **Model Gateway** | Unified request {system, messages, tools, params, tenant, budget} → adapter (GeminiAdapter: global endpoint; ClaudeAdapter: global endpoint) → unified event stream {text_delta, tool_call, citation, usage, finish_reason} [C7]. Also: token counting, retry, fallback chain, cost calculation, timeouts | 7, 15, 18 |
| **Context service** | Prompt templates, system rules (+ company rules), history window + summaries, memory + retrieved chunks insertion, token budgeting/trimming | 6 |
| **Retrieval service** | **Embeddings at query time**: user question → embedding vector → vector search (filtered by company_id + allowed files) + keyword/BM25 search (hybrid) → rank fusion → rerank → score threshold → top chunks with citations [C1]. **Query-aware retrieval**: rewrite/expand the query using chat history before searching | 12 |
| **Memory service** | Read relevant memories for this user; write/update/delete API (writes done async by worker) | 11 |
| **Tool service** | Tool registry (name, schema, permissions per company), executors, tool guardrails [C6], web search as pluggable adapter [C8], sandbox for risky tools, result size limits | 8 |
| **Speech service** | Audio → text adapter | 9 |
| **Safety service** | Hooks at 3 points [C6]: input (blocking or parallel), output, tool pre/post; prompt-injection guard for file/web text; PII rules | 16 |

### L6 – Async processing layer (Background worker)
| Pipeline | Steps | Detail stage |
|---|---|---|
| Job queue | Every async job: queued → running → done / failed; retries with backoff; dead-letter queue for repeated failures | 15, 19 |
| **File pipeline** | Receive upload event → malware scan → real file-type detection (not just extension) → ZIP unpack with zip-bomb guard (max files/size/depth) → per-type extractor (PDF text + OCR for scans, DOCX, XLSX sheets→tables, PPTX slides, images, audio→transcript) → clean + normalize → **chunking** → (optional) contextualize chunks [C3] → **embedding (document side)** + keyword index → write indexes → mark file "ready" | 9, 12 |
| Memory writer | After a turn: extract memory candidates → dedupe/update → store | 11 |
| Conversation jobs | Title generation, history summarization | 6 |
| Deletion jobs | User/company deletes → remove from DB, storage, vector index, memory (DPDP) | 16 |

### L7 – Data layer (all Mumbai)
| Store | Holds | Candidate (not locked) |
|---|---|---|
| Relational DB | Companies, users, roles, settings, conversations, messages, file metadata, jobs, usage ledger | Cloud SQL PostgreSQL |
| Object storage | Raw uploads, extracted text, generated files | Cloud Storage |
| Vector index | Chunk embeddings + metadata (company_id, file_id, page) | pgvector / Vertex AI Vector Search |
| Keyword index | BM25/full-text index of chunks [C1] | Postgres full-text / search engine – Stage 12 |
| Memory store | User memories | Decided in Stage 11 |
| Cache | Rate-limit counters, idempotency keys, sequence-numbered stream buffers (for resume) [C5] | Memorystore (Redis) |
| Audit log | Admin actions, data access, deletions | Cloud Logging / DB table |

### L8 – Platform (cross-cutting)
| Component | Job | Detail stage |
|---|---|---|
| Identity | Email/password + Google login, tokens | 16 |
| Secrets | API keys, DB passwords (never in code) | 16 |
| Config & feature flags | Turn features on/off per company without redeploy | 19 |
| Prompt & Config registry | Versioned system prompts, model params, tool sets; rollback [C9] | 6, 19 |
| Evaluation harness | Fixed test sets to measure routing/retrieval/answer quality before changes (ArcNave rec.) | 17 |
| Observability | Logs, traces (one request_id across all layers), metrics, alerts | 17 |
| Usage & budget | Token/cost ledger per request; hard stop for Claude ₹1,000 and company quotas | 18 |
| CI/CD | Build, test, deploy both services | 21 |
| IAM | Separate service accounts per service, least privilege | 16 |

## 3. Where "embeddings" and "query-aware" sit (summary)
| Concept | Layer | When |
|---|---|---|
| Document embeddings | L6 File pipeline | When a file is uploaded (once) |
| Query embedding | L5 Retrieval | On every question needing file/history search |
| Query rewriting (query-aware retrieval) | L5 Retrieval | Before search, uses chat history |
| Reranking (query-aware ordering) | L5 Retrieval | After search, orders chunks by relevance to the question |
| Query-aware model routing | L4 Planner | Before generation, picks model/tools from the question |
| Embedding model choice, dimensions, chunk size, vector DB | – | Stage 12 (verify with docs) |


## 3b. AI model roles inside ArcNave (not only chat models)
Rule: EVERY model call (not just chat) goes through the Model Gateway → one place for adapters, cost tracking, budget, fallback, logging.
| # | Role | Job | Layer | When | Candidate (NOT locked – verify Mumbai availability + docs in Stage 7/12/20) |
|---|---|---|---|---|---|
| M1 | Main generation | Write the answer | L5 Gateway | Every turn | Gemini (global endpoint), Claude (global) |
| M2 | Router / classifier (query-aware routing) | Read question → pick model, tools, full-vs-RAG | L4 Planner | Every turn (must be very fast/cheap) | Rules first + small fast LLM (e.g., Gemini Flash-Lite) |
| M3 | Query rewriter (query-aware retrieval) | Rewrite question using chat history into good search queries | L5 Retrieval | When search needed | Small fast LLM |
| M4 | Embedding model | Text → vector. Same model for documents and queries (query mode vs document mode) | L6 (docs), L5 (query) | Upload + every search | Vertex embedding models (e.g., gemini-embedding / multilingual) |
| M5 | Reranker | Scores each (question, chunk) pair; keeps the best top-N | L5 Retrieval | After search | Vertex AI ranking API / other reranker |
| M6 | Chunk contextualizer (optional, L-4) | Adds 50–100 token context to each chunk | L6 | Upload | Small LLM + caching |
| M7 | Summarizer | History compaction, chat titles | L6 / L5 Context | Async | Small LLM |
| M8 | Memory extractor | Pick facts worth remembering | L6 | Async after turn | Small LLM (Stage 11) |
| M9 | Safety classifier | Input/output/tool checks | L5 Safety | Every turn | Rules + model (Stage 16) |
| M10 | Speech-to-text | Mic/audio → text | L5 Speech / L6 | Mic + audio files | Gemini audio / Cloud Speech-to-Text |
| M11 | OCR / vision | Scanned PDFs, images → text | L6 | Upload | Gemini vision / Document AI |
### India availability check (verified 2026-09-30, official GCP docs)
IMPORTANT difference: "endpoint available in Mumbai" ≠ "ML processing guaranteed in India". GCP data-residency page lists guarantees per model; unlisted = no guarantee.
| Role | Finding | Source |
|---|---|---|
| M1/M2/M3/M6/M7/M8 (Gemini LLM) | India ML-processing guarantee ONLY for **Gemini 2.5 Flash (128K context)**. 2.5 Flash 1M, 2.5 Flash-Lite, 2.5 Pro, 2.0 models: no India guarantee (endpoint exists in Mumbai). Gemini 3.x not in table | data-residency |
| M4 Embedding | **No embedding model** has India guarantee (gemini-embedding-001, text-embedding-004/005, multilingual-002, multimodal). Japan has text-embedding-004 + multilingual-002 | data-residency |
| M5 Reranker | Vertex Ranking API = **locations/global only**; models semantic-ranker-default-004 / fast-004; ≤200 records/request; ≤1024 tokens/record; 25 languages | ranking docs |
| M10 Speech | Chirp 3 = us / eu multi-region GA (data-residency also lists Japan, Singapore); **not India**. en-IN, hi-IN GA; ta-IN preview | chirp-3 docs |
| M11 OCR | Document AI in asia-south1: OCR v2.1.1 (Preview), Form Parser (all), **Layout Parser not supported** | document-ai regions |
→ C3 RESOLVED (Option R): global/managed services allowed for all roles; storage stays Mumbai.

## 4. Open decisions (Stage 4)
- L-1. Orchestrator: custom code pipeline vs framework (e.g., Google ADK, LangGraph). Rec: start thin custom pipeline (Anthropic guidance A1); final in Stage 10; keep L4 behind an interface.
- L-4. Contextual retrieval (C3) in MVP? Rec: build the slot now, switch on after cost/quality test (Stage 12/18).
- L-5. Input safety mode: Rec: cheap rule checks blocking + model-based checks parallel (keeps fast reply).
- L-2. Stream protocol to client: SSE vs WebSocket. Rec: decide in Stage 14.
- L-3. Cache layer (Redis) needed from day 1? Rec: yes (rate limits, idempotency, stream resume) – confirm cost in Stage 18/19.
