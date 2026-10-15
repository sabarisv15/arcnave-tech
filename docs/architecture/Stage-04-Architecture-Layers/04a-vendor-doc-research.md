# ArcNave – Stage 4 input: Vendor documentation research
_Verified 2026-09-30 · Official docs only · Internal architecture of ChatGPT / claude.ai / Perplexity apps is NOT public and is not assumed._

## 1. Documented facts
### OpenAI (ChatGPT platform)
- O1. Retrieval (vector stores): query rewriting (`rewrite_query`), hybrid search = semantic + keyword combined by reciprocal rank fusion, ranker + `score_threshold`, metadata attribute filters, max 50 results, vector store expiry policies. File search returns citations (annotations with file_id/filename).
- O2. File search types include PDF, DOCX, DOC, PPTX, code, text/markdown/HTML/JSON (UTF-8/16/ASCII).
- O3. Conversation state: manual history, `previous_response_id`, or Conversations API (durable object). All prior input tokens billed each turn. Server-side compaction (`context_management`, `compact_threshold`, `/responses/compact`).
- O4. Background mode: long tasks run async; with streaming each event has `sequence_number`; client reconnects with `starting_after` to resume; cancel endpoint is idempotent.
- O5. Agents SDK guardrails: input guardrails (parallel = faster but may spend tokens; blocking = agent never runs if tripped), output guardrails, tool guardrails (validate/block before and after each tool call); "tripwire" halts run.
### Anthropic (Claude)
- A1. "Building effective agents": patterns = prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer, agents. Advice: "Begin by using LLM APIs directly"; "consider adding complexity only when it demonstrably improves outcomes."
- A2. Contextual Retrieval: LLM writes 50–100 token context per chunk, prepended before embedding AND BM25 indexing; rank fusion; reported top-20 retrieval failure reduction 35% (contextual embeddings), 49% (+ contextual BM25), 67% (+ reranking); top-20 chunks recommended; rerank ~150→20. For knowledge < 200,000 tokens (~500 pages) put it all in the prompt instead of RAG.
- A3. Context editing (tool-result clearing, thinking clearing) runs server-side on Claude API; server-side compaction recommended. Vertex availability NOT stated in that doc → ArcNave must not depend on it.
- A4. (from earlier) On Vertex: no Files API, no server-side fallback, no code execution/web fetch; web search tool supported; citations supported.
### Perplexity
- P1. Products: Agent API (multi-provider, tools, streaming, background), Search API (ranked web results, domain filters, content extraction), Embeddings API, Router API, Presets, Profiles (reusable, versioned configs), Skills (on-demand domain expertise).
- P2. Agent API: `max_steps`, `models` fallback chain (≤5), model decides tool calls, web_search $2.50/1K (fast $1/1K).

## 2. Impact on ArcNave layers
Result: **8 layers stay the same. No layer added/removed. 9 components added/changed inside layers.**

| # | Change | Layer | Evidence |
|---|---|---|---|
| C1 | Hybrid retrieval: vector + keyword (BM25) + rank fusion + rerank + score threshold + metadata filter | L5 Retrieval, L7 (+ keyword index) | O1, A2 |
| C2 | Planner decides "full content vs RAG" per request (small total content → send all) | L4 Planner | A2 (threshold ArcNave-specific, set in Stage 12/18) |
| C3 | Optional chunk "contextualizer" step before embedding + keyword indexing | L6 File pipeline | A2 |
| C4 | ArcNave owns conversation state + its own compaction (no dependence on provider server-side state) | L5 Context, L7 | O3, A3, multi-provider need |
| C5 | Stream events carry `sequence_number`; buffered; client resumes with last number (D3) | L4 Event emitter, L7 stream buffer | O4 |
| C6 | Safety hooks at 3 points: input (blocking/parallel), output, tool pre/post | L5 Safety, L4 Tool loop | O5 |
| C7 | Citations/source refs in ArcNave internal format + UI | L5 Model Gateway format, L1 renderer | O1, A4, P1 |
| C8 | Web search as pluggable tool adapter (Claude web search / Gemini Google Search grounding / Perplexity Search API) | L5 Tools | A4, P1 |
| C9 | Versioned Prompt & Config registry (system prompts, model params, tool sets, per-version rollback) | L8 Platform | P1 (Profiles/Presets idea) |
| C10 | Orchestrator: start with thin custom pipeline; add patterns (routing, chaining, orchestrator-workers) only when measured benefit | L4 (supports L-1) | A1 |

## 3. ArcNave recommendation (not from docs)
- Evaluation harness in L8: fixed test question set to measure routing, retrieval and answer quality before changing prompts/models (needed to prove "demonstrably improves", A1).

## 4. Still to check in later stages
- Gemini/Vertex equivalents (Vertex RAG Engine, Google Search grounding, context caching, Agent Engine) + Mumbai availability → Stages 7, 11, 12, 20.
- ChatGPT/Claude/Perplexity/Gemini memory docs → Stage 11.

Sources: developers.openai.com/api/docs/guides/{retrieval, tools-file-search, conversation-state, background} ; openai.github.io/openai-agents-python/guardrails ; anthropic.com/engineering/building-effective-agents ; anthropic.com/news/contextual-retrieval ; platform.claude.com/docs/en/build-with-claude/context-editing ; docs.perplexity.ai/llms.txt
