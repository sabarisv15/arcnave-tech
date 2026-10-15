# ArcNave – Stage 4 · Contracts round (L4 Policy + Validator, L5 six services)
_Verified 2026-10-01 · Anthropic, Google Cloud/Gemini, OpenAI, Perplexity official docs · Detailed design stays in Stages 6, 8, 9, 11, 12, 13, 16_

---
> **Doc-sync 2026-10-03 (Stage 13) – see Stage-13-Output-Validation/00-checkpoint-stage13.md:**
> - Validator contract B: V-1 decided = VD-1 (Gemini 3.1 Flash-Lite claim judge, async, file/web answers; Check Grounding = bake-off/fallback); V-2 decided = VD-2 (annotate + weak-citation marks; Deep one regenerate; never silent edit). Actions keep pass · annotate · repair (1 reask) · regenerate (Deep) · retract (fixed list only). V3 slot filled; V7 stays Later.

## A. L4 – Policy engine contract
**Input:** tenant ctx (company, user, role) · requested model/profile/tools/files · live counters.
**Check order (stop at first deny):** login valid → company active → user role → kill switch / feature flags (G49) → model allowed for company (UI-5) → tools allowed → file ownership + ready → concurrency (G42) → rate limit → user/company quota → budgets (per-turn, company, Claude ₹ cap).
**Output:** `allow` | `deny(code, user_message)` | `degrade(new_model/profile, reason)` + effective limits for this turn.
**Speed:** rules cached in Redis (short TTL) with config version.

| # | Gap | Source | Rec |
|---|---|---|---|
| P1 | Fixed check order + first-deny-wins + typed deny codes | ArcNave | MVP |
| P2 | Policy cache (Redis, short TTL, versioned) | ArcNave | MVP |
| P3 | **Fail mode**: if policy data unavailable → fail closed (deny with retry message) | ArcNave | MVP (PE-1) |
| P4 | **Platform guard**: GCP org policy `vertexai.allowedModels` allow-lists only our models (`publishers/PUBLISHER/models/MODEL:predict`) so a bug can't call any other model | Google | MVP |
| P5 | **Partner features are DENIED by default in an organization**: Claude `structured_outputs` (and `web_search`) must be allowed via `vertexai.allowedPartnerModelFeatures`, else those calls fail | Google | **MVP – critical** |
| P6 | Repeat-offender handling: users repeatedly triggering refusals/blocks → warn, throttle, suspend | Anthropic | MVP |
| P7 | Degrade path when budget/quota/model unavailable (e.g., Claude cap reached) | ArcNave | MVP (PE-2) |
| P8 | Every policy decision logged with reason (audit, support) | ArcNave | MVP |

## B. L4 – Validator contract
**Input:** final answer (or structured output) + finish reason + sources used + turn plan.
**Modes:** streamed chat → check after `done`, may `retract`; structured/tool/JSON output → check BEFORE showing.
**Checks:** completeness (finish reasons) · schema validity · output safety · grounding (answers about files/web) · citation integrity (cited chunk exists AND belongs to tenant) · PII leak · format sanity.
**Actions:** `pass` · `annotate` (low-confidence note) · `repair` (re-ask with error) · `regenerate` (once) · `retract`.

| # | Gap | Source | Rec |
|---|---|---|---|
| V1 | Two modes (post-stream vs pre-show) + action ladder | OpenAI (moderation only after full output), ArcNave | MVP |
| V2 | Schema check always (Claude/Gemini guarantees break on refusal / max_tokens) | Anthropic, Google | MVP |
| V3 | **Grounding check** for file/web answers: Vertex Check Grounding API returns support score 0–1 + claims + citations, <500 ms, global, answer ≤4,096 tokens, ≤200 facts ×10k chars | Google | MVP slot; choose in Stage 13 (V-1) |
| V4 | Prompt-side hallucination controls: allow "I don't know"; quote-first for docs >20k tokens; verify each claim with a quote, remove unsupported | Anthropic | MVP (Stage 6 prompts) |
| V5 | Citation integrity (ids exist + tenant match) | ArcNave | MVP – security |
| V6 | Output guardrail tripwire → stop + controlled message | OpenAI Agents SDK | MVP |
| V7 | Best-of-N / self-consistency for Deep profile only (cost) | Anthropic | Later |
| V8 | Validator results stored per turn → evals | ArcNave | MVP |

---
## C. L5 – Context service contract
**Input:** turn plan (profile, model, full-vs-RAG, tools) · branch history · summaries · memory hits · retrieved chunks / file content · user message.
**Output:** provider-neutral prompt package + token report per section + cache markers.

| # | Gap | Source | Rec |
|---|---|---|---|
| CX1 | **Long documents at the TOP, question at the END** (improves quality on Claude and Gemini) | Anthropic, Google | MVP |
| CX2 | Wrap each document with tags + metadata (`<document><source>…<document_content>`) | Anthropic | MVP |
| CX3 | Untrusted content (files, web, tool output) clearly marked; untrusted-content policy in system prompt | Anthropic | MVP – security |
| CX4 | Token budget per section (system, history, memory, docs, answer room) per model | ArcNave | MVP |
| CX5 | Static first, dynamic late, per-company cache marker (L5-G1, G4) | All | MVP |
| CX6 | History = recent turns full + summary of older (own compaction) | Anthropic, OpenAI | MVP |
| CX7 | Many questions over one huge context lose accuracy → split / cache + multiple calls | Google | Stage 6 |

## D. L5 – Retrieval service contract
**Input:** query, chat context, tenant, allowed file ids, k, filters. **Output:** ranked chunks `{chunk_id, file_id, page, text, score, source_meta}`.

| # | Gap | Source | Rec |
|---|---|---|---|
| R1 | **Tenant + file filter inside the search query** (never only filter after) | ArcNave | MVP – security |
| R2 | Embedding limits: gemini-embedding-001 up to 3,072 dims (configurable), multilingual-002 768; 250 texts / request; **2,048 tokens per text silently truncated** unless `autoTruncate=false`; 20,000 tokens / request | Google | MVP (chunks < 2,048 tokens, autoTruncate off) |
| R3 | **Store embedding model + version per chunk**; changing model = re-embed everything (vectors not compatible) | ArcNave | MVP |
| R4 | Reranker: Vertex Ranking API global, ≤200 records, ≤1,024 tokens/record, 25 languages | Google | Stage 12 |
| R5 | Hybrid + rank fusion + threshold + query rewrite (C1, OpenAI retrieval) | OpenAI, Anthropic | MVP |
| R6 | Managed option: Vertex RAG Engine (24 regions; "data residency … not supported") vs own pipeline | Google | Stage 12 decision |
| R7 | Contextual retrieval slot (L-4) | Anthropic | Slot MVP |
| R8 | Return chunks in citation-ready form (source, page) | All | MVP |

## E. L5 – Memory service contract
**Ops:** `read(user, company, query)` · `write(candidates)` (async) · `list / edit / delete / delete_all / export` (user) · `disable` · TTL/expiry · "don't mention again".

| # | Gap | Source | Rec |
|---|---|---|---|
| M1 | Two kinds: saved memories vs reference to past chats (separate stores) | OpenAI | Stage 11 |
| M2 | User controls: turn off, delete item, delete all, temporary/unpersonalized chat, "don't mention again" | OpenAI | MVP |
| M3 | Company admin controls for memory | OpenAI | MVP (admin panel) |
| M4 | Scope isolation per user (+ company) | Google Memory Bank | MVP – security |
| M5 | Extraction + consolidation (update, not duplicate); TTL for stale memories | Google Memory Bank, Anthropic | Stage 11 |
| M6 | Size caps, sensitive-data stripping before write | Anthropic memory tool | MVP |
| M7 | Deletion: deleted memories gone from all stores; deletion-log retention policy stated (OpenAI keeps ≤30 days) | OpenAI | MVP (DPDP) |

## F. L5 – Tool service contract
**Registry entry:** name `^[a-zA-Z0-9_-]{1,128}$` (namespaced) · description (3–4+ sentences incl. when NOT to use) · strict input schema · optional input_examples · permissions (company/role) · side_effect + needs_approval flags · timeout · result size cap · concise/detailed formats · version.
**Execute:** validate input → permission → run (sandbox if risky) → wrap output as untrusted data (source label, JSON-encoded) → optional injection screen → `{content: text|image|document|search_result, is_error, instructive message}`.

| # | Gap | Source | Rec |
|---|---|---|---|
| T1 | Registry fields above | Anthropic, Google | MVP |
| T2 | Active tools per request ≤ 10–20 | Google | MVP |
| T3 | Detailed descriptions (most important factor) + input_examples for complex tools | Anthropic | MVP |
| T4 | Instructive error messages ("Rate limit exceeded. Retry after 60 seconds") | Anthropic | MVP |
| T5 | Tool output = untrusted: JSON-encode, label source, never put our instructions inside results | Anthropic | MVP – security |
| T6 | Screen tool outputs for injection (lightweight model) before model sees them | Anthropic | MVP for web/file tools |
| T7 | Least privilege + sandbox for risky tools | Anthropic | MVP |
| T8 | Tool versioning in config registry (G48) | ArcNave | MVP |

## G. L5 – Speech service contract
`transcribe(audio, language_hint=en-IN, mode=short|long) → text (+ optional timestamps, speakers)`.

| # | Gap | Source | Rec |
|---|---|---|---|
| SP1 | Gemini audio: aac, flac, mp3, m4a, mpeg, mpga, mp4, ogg, pcm, wav, webm; up to ~8.4 h / 1M tokens; **1 audio file per prompt**; timestamps + speaker labels | Google | MVP |
| SP2 | Chirp 3 option: us/eu; en-IN, hi-IN GA, ta-IN preview; Recognize <1 min, BatchRecognize 1 min–1 h, streaming | Google | Stage 9 choice |
| SP3 | Mic clips (short) → sync path; audio files → worker batch path | ArcNave | MVP |
| SP4 | Claude has no audio → transcript always made before Claude sees it | Anthropic | MVP |
| SP5 | Mic format from apps must be in supported list (e.g., webm/m4a) | Google | MVP (L1) |

## H. L5 – Safety service contract
`check_input(text, attachment_meta)` · `check_tool_output(content, source)` · `check_output(answer)` → `{allow | block | redact | flag, categories, scores}`.

| # | Gap | Source | Rec |
|---|---|---|---|
| SF1 | Lightweight-model harmlessness screen with structured-output verdict (input + tool outputs) | Anthropic | MVP |
| SF2 | Indirect prompt-injection rules (CX3, T5, T6) | Anthropic | MVP |
| SF3 | Model Armor: prompt injection/jailbreak, RAI categories, CSAM default, sensitive data, malicious URLs (≤256/request), docs ≤4 MB, inspect-only vs inspect-and-block; **languages listed: Chinese, English, French, German, Italian, Japanese, Korean, Portuguese, Spanish (no Hindi/Tamil)** | Google | Stage 16 candidate (SF-1) |
| SF4 | Gemini safety thresholds explicit (default OFF) + prompt `JAILBREAK` block reason | Google | MVP (S-2) |
| SF5 | Repeat-offender response (P6) | Anthropic | MVP |
| SF6 | Red-team with injected docs/emails/tool outputs before launch | Anthropic | MVP |
| SF7 | Continuous monitoring of blocked/flagged events | Anthropic | MVP |
| SF8 | Layered: platform filters + our screen + system-prompt policy | Anthropic, Google | MVP |

---
## I. Claude-only additions (continue CL numbering)
| # | Gap | Rec |
|---|---|---|
| CL13 | Long documents at top, query at end; XML document tags with source metadata | MVP |
| CL14 | Allow "I don't know"; quote-first for >20k-token docs; verify claims with quotes, remove unsupported | MVP |
| CL15 | `tool_result` content may be text / image / document / `search_result` (citation-friendly) | Stage 12 |
| CL16 | `tool_result` blocks must directly follow the `tool_use` turn and come FIRST in the user message; text after | MVP |
| CL17 | Instructive `is_error` messages; Claude retries invalid calls 2–3 times then apologizes | MVP |
| CL18 | Tool name regex, 3–4+ sentence descriptions, `input_examples` must be schema-valid (else 400; +20–200 tokens), consolidate with `action` param, namespacing | MVP |
| CL19 | Changing `tool_choice` invalidates message cache | MVP |
| CL20 | Untrusted content only inside `tool_result`; label source; JSON-encode; never put our instructions inside tool results; state policy in system prompt | MVP – security |
| CL21 | Harmlessness / injection screen with a lightweight model + structured-output boolean | MVP |
| CL22 | Repeat-offender throttling/ban | MVP |
| CL23 | Memory tool (supported on Vertex): client-side, our storage; path-traversal protection; size caps; expiry; strip sensitive data; API auto-adds "ALWAYS VIEW YOUR MEMORY DIRECTORY…" to system prompt when present | Stage 11 option |
| CL24 | **Claude structured outputs / web search on Vertex are denied by default for org projects → allow via org policy (P5)** | **MVP – critical** |

## J. Open decisions
| ID | Question | Recommendation |
|---|---|---|
| PE-1 | Policy fail mode | Fail closed |
| PE-2 | Claude budget/quota finished | Auto-switch to Gemini 3.8 Flash with a visible note (user can retry Claude later) |
| PE-3 | GCP org-policy allow-list of models | Yes (P4) |
| V-1 | Grounding check engine | Decide in Stage 13 (Vertex Check Grounding vs Claude citations vs own LLM check) |
| V-2 | Low grounding score | Show "low confidence" note; Deep profile regenerates once |
| SF-1 | Model Armor | Decide in Stage 16 (no Hindi/Tamil listed) – inspect-only first |

Sources: platform.claude.com/docs/en/{build-with-claude/prompt-engineering/claude-prompting-best-practices, test-and-evaluate/strengthen-guardrails/reduce-hallucinations, test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks, agents-and-tools/tool-use/define-tools, agents-and-tools/tool-use/handle-tool-calls, agents-and-tools/tool-use/memory-tool} ; docs.cloud.google.com/{generative-ai-app-builder/docs/check-grounding, vertex-ai/generative-ai/docs/embeddings/get-text-embeddings, vertex-ai/generative-ai/docs/rag-engine/rag-overview, agent-builder/agent-engine/memory-bank/overview, vertex-ai/generative-ai/docs/multimodal/audio-understanding, model-armor/overview, vertex-ai/generative-ai/docs/control-model-access} ; ai.google.dev/gemini-api/docs/long-context ; help.openai.com/en/articles/8590148-memory-faq
