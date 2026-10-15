# ArcNave – Stage 4 · L5 final recap – Claude docs cross-check
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01; L5 fully locked) · Source: platform.claude.com docs (Vendor) unless marked_

Pages re-checked: citations, pdf-support, vision, models overview, adaptive-thinking, mid-conversation-system-messages, multilingual-support, search-results, structured-outputs, context-windows, tool-search-tool, context-editing, reduce-hallucinations, claude-on-vertex-ai, web-search-tool, mitigate-jailbreaks.

## New findings (not in L5 docs before)
| # | Finding | Service | Rec |
|---|---|---|---|
| N1 | Citations + structured outputs in same request → 400 | Gateway | MVP – capability rule: never both; JSON needed → separate step |
| N2 | Images on Google Cloud ≤5 MB each (base64); ≤8000 px; >20 images → ≤2000 px; ≤600 images/pages per request; JPEG/PNG/GIF/WebP only; 5.5 high-res tier up to 2576 px / 4,784 tokens | Gateway + Stage 9 | MVP – resize to ~2000 px, convert HEIC etc. |
| N3 | PDF to Claude: ≤600 pages; ~1,500–3,000 text tokens/page + page image; password/encrypted PDFs not supported | Gateway + Stage 9 | MVP – reject encrypted at upload; big PDFs via retrieval, not raw |
| N4 | Thinking display summarized/omitted – billed the same; some turns have no thinking block; usage has thinking_tokens | Gateway + L1 | MVP – normalizer reads thinking_tokens; UI shows "thinking" status only (TH-1) |
| N5 | Structured output caps: ≤20 strict tools, ≤24 optional params, ≤16 unions per request; compile timeout 180 s; enum case may differ; format change breaks cache; schema cached 24 h outside ZDR | Gateway + Safety | MVP – no customer data in schemas; case-insensitive enum check |
| N6 | 5.5 models: 1M context at standard price (no long-context premium); input > window → 400 "prompt is too long" | Gateway / Stage 18 | Fact |
| N7 | Sonnet 5.5 / Opus 5.5 have no automatic context awareness | L4 G46 | Already covered |
| N8 | Haiku 4.5 ($1/$5, 200K, cutoff Feb 2025) = Anthropic's suggested screen model; not in our project | Stage 7/16 option | Info |
| N9 | Batch = 50% discount (works with structured outputs); Vertex has Claude batch predictions | Stage 18 | Later |
| N10 | Mid-conversation system message rules: after a user turn, not first, not between tool_use/tool_result; never untrusted content; append, never edit (edit breaks cache + thinking) | Context | MVP |
| N11 | Turn-scoped system messages (clear_at, beta, Google Cloud listed) → per-turn date reminder without pile-up | Context | Use if conformance test passes (TH-2) |
| N12 | Mid-conversation tool add/remove = Claude API only, not Vertex | Tools | Confirms TL-6 (cache miss on change) |
| N13 | Multilingual: Hindi 96.7%, Bengali 95.4% of English (Sonnet 4.5); Tamil not benchmarked; native script beats transliteration → Tanglish risk; set reply-language rule in system prompt | Context / evals | MVP eval + Stage 6 rule |
| N14 | search_result: inside a tool_result all blocks must be search_result; citations all-or-nothing; text only; with web search on, citations must be on | Retrieval | MVP |
| N15 | Hallucination guardrails: allow "I don't know", quotes first for docs >20K tokens, only-provided-docs instruction | Stage 6/13 | MVP |
| N16 | Tool search tool, context editing, server compaction: Google Cloud not listed | Tools / Context | Confirms own compaction (C25), T25 later |
| N17 | Memory tool IS supported on Vertex (claude-on-vertex page) | Memory CM1 | Verified |
| N18 | Google page "Safety classifiers for Claude in Vertex AI" exists – content not readable now | Safety | Partial – read before Stage 16 |

## Decisions
| ID | Question | Rec |
|---|---|---|
| TH-1 | Show thinking in UI? | **User decision: SHOW.** Collapsible "Thinking" section with thinking summary, streamed (thinking_delta). Claude: set display "summarized" explicitly; Gemini: include_thoughts=true (thought summaries). Some turns have no thinking → hide section. Billing unchanged. Shared public links: hide thinking (rec). |
| TH-2 | Per-turn date injection method for Claude | clear_at turn-scoped message if conformance passes; else normal mid-conversation system message |
