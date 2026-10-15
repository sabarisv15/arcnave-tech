# ArcNave – Stage 4 · L5 Intelligence Services – deep dive
_Last updated: 2026-10-01 · Status: DRAFT · Parent: 04-architecture-layers.md · L1–L4 LOCKED_
_Scope: service boundaries, contracts and gateway internals. Content details stay in later stages (6 Context, 7 Routing, 8 Tools, 11 Memory, 12 Retrieval, 16 Safety)._

## 1. Services in L5
| Service | One-line job | Called by | Detail stage |
|---|---|---|---|
| **Model Gateway** | The ONLY door to every AI model (chat, embed, rerank, speech, OCR) | L4, L6 | here + 7 |
| Context service | Builds the prompt in cache-friendly order within token budget | L4 | 6 |
| Retrieval service | Query rewrite → embed → hybrid search → fuse → rerank → cite | L4, Context | 12 |
| Memory service | Read memories (write via worker) | Context, L6 | 11 |
| Tool service | Registry, schemas, executors, guardrails, sandbox adapter | L4 | 8 |
| Speech service | Audio → text | L3, L6 | 9 |
| Safety service | Input / output / tool checks | L4 | 16 |

## 2. Model Gateway – contract
**Input (UnifiedRequest):** tenant ctx · profile + config version · model ref `provider/model@version` (or Auto, resolved in L4) · system blocks marked static/dynamic · messages (with provider reasoning blobs) · tools (strict schemas) · tool_choice (normalized) · effort (normalized) · max_output_tokens · response_format (JSON schema) · sampling · cache hints · safety settings · timeouts · request id.
**Output (UnifiedEvent stream):** `start · thinking_delta · text_delta · tool_call(id, name, args, provider_blob) · citation · usage(input, output, thinking, cache_read, cache_write) · finish(normalized_reason, raw_reason) · error(normalized_code, provider, request_id)`.
**Other operations:** `count_tokens · embed · rerank · transcribe · ocr`.
**Inside:** adapters (Gemini via Google Gen AI SDK on Vertex global; Claude via Anthropic Vertex SDK global; embedding; rerank; speech; OCR) · capability matrix · schema translator · event normalizer · usage normalizer · retry/backoff · fallback chain · provider rate limiter · circuit breaker per model · effective-dated price table · pre-flight size/token check · request-id capture · metrics (time-to-first-token, tokens/s, errors).

## 3. Documented facts (verified 2026-10-01)
- **Claude prompt caching:** order tools → system → messages; ≤4 breakpoints; automatic caching (one top-level `cache_control`); min 512 tokens (Opus/Sonnet 5.5); 5-min write 1.25×, 1-h write 2×, read 0.1× (Opus 5.5 0.05×); 1-h TTL available on Google Cloud; invalidated by changing tools, web-search/citations toggle, thinking params, tool_choice, images, effort; **Google Cloud cache isolation is organization-level**.
- **Claude token counting:** free, GA on Google Cloud, separate RPM; estimate; base64 PDFs/images only; server tools not countable; Claude 4.7+ tokenizer ≈30% more tokens → count per target model; previous-turn thinking counts as input on models that keep all turns.
- **Claude structured outputs:** GA on Google Cloud; constrained decoding ("always valid"); limits: no recursive schemas, no numeric/string length constraints, `additionalProperties:false` required; refusal or `max_tokens` can still break schema; first use compiles grammar (cached 24 h; changing tools invalidates).
- **Gemini context caching (Vertex):** implicit (default, no storage cost, 90% discount) + explicit (storage cost); min 4,096 tokens for Gemini 3.x; default TTL 60 min; max 10 MB; put large common content first, send similar prefixes close in time.
- **Gemini structured output:** `responseMimeType` + `responseSchema`; supports anyOf, enum, min/max, minItems/maxItems, nullable, propertyOrdering; schema size counts toward input tokens; complex schemas may error.
- **Gemini safety filters:** categories hate, harassment, sexual, dangerous; thresholds BLOCK_LOW/MEDIUM/ONLY_HIGH, OFF, BLOCK_NONE; **default OFF for Gemini 2.5 Flash and later**; CSAM and PII/SPII filters not configurable; blocked → finishReason SAFETY, content empty.
- **OpenAI prompt caching:** prefix-based, ≥1,024 tokens; static first, append-only, disable tools with `tool_choice:none` instead of removing; `prompt_cache_key` gives separate cache accounting per customer and helps "prevent cache-hit probing across customers".
- **Perplexity Router API:** one key, models named `creator/name`, OpenAI + Anthropic compatible schemas, routes to healthy deployment automatically.
- (from earlier) Gemini 3.8 Flash price doubles on 1 Jan 2027; Claude on Google Cloud request ≤30 MB; Claude has no audio input.

## 4. Gaps – all vendors
| # | Gap | Seen in | Rec |
|---|---|---|---|
| L5-G1 | **Cache-friendly prompt order**: static (tools, base rules) first, append-only history, dynamic bits (date, user name) late | Anthropic, Google, OpenAI | MVP |
| L5-G2 | Claude cache plan: automatic caching + ≤4 breakpoints; 5-min default, 1-h for long system blocks; keep invalidators stable | Anthropic | MVP |
| L5-G3 | Gemini implicit caching (≥4,096-token prefix); explicit cache later | Google | MVP implicit |
| L5-G4 | **Tenant cache isolation**: Claude cache is org-wide on Google Cloud and all ArcNave companies share one org → put a per-company marker early in the prefix so caches never cross companies (same idea as OpenAI `prompt_cache_key`) | Anthropic, OpenAI | **MVP – security** |
| L5-G5 | **Schema translator**: Claude JSON schema limits ≠ Gemini schema features; one ArcNave schema → per-provider form; always validate (refusal/max_tokens can break it) | Anthropic, Google | MVP |
| L5-G6 | Token counting per target model (Claude free count endpoint, Gemini countTokens); never reuse counts across models | Anthropic, Google | MVP |
| L5-G7 | **Gemini safety thresholds set explicitly** (default is OFF) per ArcNave policy; read safety ratings as signals | Google | MVP |
| L5-G8 | **Usage normalizer**: input / output / thinking / cache-read / cache-write from each provider into one schema | All | MVP |
| L5-G9 | Model naming `provider/model@version`; profiles pin versions; Auto alias resolved in L4 | Perplexity | MVP |
| L5-G10 | Circuit breaker + health per model (route away from failing model automatically) | Perplexity | MVP |
| L5-G11 | **Effective-dated price table** (e.g., Gemini 3.8 Flash doubles 1 Jan 2027) for cost/budget | Google | MVP |
| L5-G12 | Pre-flight size check (Claude 30 MB request; Gemini cache 10 MB) | Anthropic, Google | MVP |
| L5-G13 | Keep schemas/tool definitions lean (count as input tokens) | Google, Anthropic | MVP rule |
| L5-G14 | **Modality matrix**: Claude = text/images/PDF (no audio/video); Gemini = text/image/audio/video/PDF → audio for Claude goes through speech-to-text first | Anthropic, Google | MVP |
| L5-G15 | Event normalizer (Claude SSE events vs Gemini chunks → UnifiedEvent) | Anthropic, Google | MVP |
| L5-G16 | SDK choice: Google Gen AI SDK (Python) for Gemini, Anthropic Vertex SDK (Python) for Claude; ArcNave manages history itself (so signatures/thinking handled by us, L4 G26–G28) | Google, Anthropic | MVP |
| L5-G17 | Model Armor (Vertex safety layer) as optional extra | Google | Stage 16 |

## 5. Gaps – Claude only (high confidence)
| # | Gap | Rec |
|---|---|---|
| CL1 | Cache hierarchy tools→system→messages; ≤4 breakpoints or automatic; min 512 tokens (5.5 models) | MVP |
| CL2 | TTL 5 min (1.25× write) vs 1 h (2× write, available on Google Cloud); reads 0.1× (Opus 5.5 0.05×) | MVP |
| CL3 | Cache invalidators: tools, web-search/citations toggle, thinking params, tool_choice, images, effort → keep stable per chat | MVP |
| CL4 | Org-level cache isolation on Google Cloud → per-company prefix marker (L5-G4) | MVP – security |
| CL5 | Cached input tokens don't count toward input-tokens-per-minute limit → caching also raises throughput | MVP |
| CL6 | Token counting free, GA on Google Cloud, separate RPM; estimate only; base64 only | MVP |
| CL7 | New tokenizer (4.7+) ≈30% more tokens → recount per model; budgets per model | MVP |
| CL8 | Previous-turn thinking blocks count as input tokens → include in context budget | MVP |
| CL9 | Structured outputs GA on Google Cloud; schema limits; refusal/max_tokens can break schema; first-use grammar latency (cached 24 h) | MVP |
| CL10 | PDFs/images only as base64 (no URL / Files API on Vertex) within 30 MB | MVP |
| CL11 | Claude citations supported on Vertex → option for file-grounded answers | Stage 12/13 |
| CL12 | Claude web search tool supported on Vertex → candidate web-search adapter | Stage 8 |

## 6. Open decisions (L5)
| ID | Question | Recommendation |
|---|---|---|
| S-1 | Claude cache TTL default | 5 min for chat; 1 h only for big stable system/file blocks |
| S-2 | Gemini safety thresholds | BLOCK_MEDIUM_AND_ABOVE for all 4 categories + our own Safety service (final in Stage 16) |
| S-3 | Gateway as in-process library vs separate service | In-process Python module (inside API service + worker) for MVP; can become its own service later |

Sources: platform.claude.com/docs/en/build-with-claude/{prompt-caching, token-counting, structured-outputs} ; docs.cloud.google.com/vertex-ai/generative-ai/docs/{context-cache/context-cache-overview, multimodal/configure-safety-filters, multimodal/control-generated-output} ; developers.openai.com/api/docs/guides/prompt-caching ; docs.perplexity.ai/docs/router/quickstart
