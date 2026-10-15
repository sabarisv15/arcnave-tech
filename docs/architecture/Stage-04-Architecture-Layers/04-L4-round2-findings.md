# ArcNave – Stage 4 · L4 Orchestration – Round 2 vendor findings
_Verified 2026-10-01 · Append to 04-L4-orchestration-layer.md (section 5b)_

## Facts (official docs)
**Anthropic**
- Effort (`output_config.effort`): low / medium / high / xhigh / max. GA on Google Cloud. Opus 5.5 default = medium; others default high. Effort affects ALL output tokens incl. tool calls ("lower effort also means fewer and terser tool calls"). Sonnet 5.5: chat/latency-sensitive start medium or low; agentic multistep start medium → high. Changing top-level effort between requests breaks prompt cache; per-message effort (beta) keeps cache on Opus 5.5 / Sonnet 5.5.
- Task budgets (beta, header `task-budgets-2026-03-13`): advisory token budget for a whole agentic loop; model sees countdown and finishes gracefully; NOT a hard cap (max_tokens is); min 20,000; too small → model may refuse/stop early. Supported Opus 5.5, Sonnet 5.5 (Google Cloud support not stated → verify).
- Refusals: Opus 5.5 / Sonnet 5.5 have safety classifiers → normal response with `stop_reason: "refusal"` + `stop_details.category`; can arrive mid-stream → "treat any partial output as incomplete and discard it". Server-side `fallbacks` not on Vertex → client-side fallback to another model.
- Context engineering: "context rot" (more tokens → worse recall); just-in-time retrieval via lightweight references; compaction; structured note-taking; sub-agents return condensed summaries; system prompt at "right altitude".
- Writing tools for agents: few consolidated high-impact tools (not every API endpoint); namespacing; semantic return fields (name not uuid); pagination/truncation/filtering; `response_format` concise vs detailed; actionable error messages; tune descriptions; evaluate tools.
**OpenAI**
- Orchestration via LLM (flexible) vs via code ("more deterministic and predictable, in terms of speed, cost and performance"); agents-as-tools (manager keeps control) vs handoffs (specialist takes over); code tactics: structured outputs, chaining, evaluator agent, parallel `asyncio.gather`.
- Human-in-the-loop: tool `needs_approval` → run pauses with interruptions → approve/reject → resume; `RunState` serializable to DB/queue so approvals survive restarts.
- Sessions: backends (SQLite, Redis, SQLAlchemy, Mongo, encrypted wrapper, compaction session, branching session); `pop_item` for undo/edit; `limit=N` recent items.
**Perplexity**
- Agent API presets: fast (1 step, web_search) · low (5 steps, search+fetch) · medium (15) · high (15, stronger model) · xhigh (100 steps, Claude Opus 5.5, search+finance+sandbox). Dynamic (by name) vs frozen (copied values). Same cost/latency band on updates.
- `max_steps` reached → "the agent doesn't error — it makes one final pass to answer from what it has gathered so far". `models` = fallback chain ≤5 tried in order. Instructions replace preset prompt.

## New gaps (continue numbering)
| # | Gap | Seen in | Rec |
|---|---|---|---|
| L4-G14 | Planner sets **model effort** (low/med/high) per request class; keep constant inside a cached chat (or per-message effort) | Anthropic | MVP |
| L4-G15 | **Effort profiles** = bundles {model, effort, max steps, tools, fallback chain, deadline}, versioned in config registry (like presets) | Perplexity | MVP |
| L4-G16 | **Max steps hit → one final "answer with what you have" pass** (not an error) | Perplexity | MVP |
| L4-G17 | **Refusal handling**: discard partial streamed text (retract), retry on fallback model client-side | Anthropic | MVP |
| L4-G18 | Model fallback chain (ordered list) per profile | Perplexity | MVP |
| L4-G19 | Task budgets (advisory loop budget, min 20K) on top of our hard budget meter | Anthropic | Later (verify on Vertex) |
| L4-G20 | **Human approval for risky tools**: state `WAITING_APPROVAL`, `approval_required` event, approve/reject endpoint, resumable | OpenAI | State slot MVP; feature Later (no side-effect tools in MVP) |
| L4-G21 | Code-driven pipeline + LLM tool loop inside GENERATE step (not LLM-driven everything) | OpenAI, Anthropic | MVP (supports O-1 = custom) |
| L4-G22 | Just-in-time context (references + read tools) instead of pre-loading everything | Anthropic | Stage 12 decision |
| L4-G23 | Tool design rules (few tools, namespacing, concise/detailed, truncation, actionable errors); L4 enforces tool-result size cap | Anthropic | Stage 8 rules; cap MVP |
| L4-G24 | Sub-agents return condensed summaries only | Anthropic | Later (Research) |
| L4-G25 | Chat history encrypted at rest; branching for edit | OpenAI sessions | Covered (Stage 16, G1/G2) |

Sources: platform.claude.com/docs/en/build-with-claude/{effort, task-budgets, refusals-and-fallback} ; anthropic.com/engineering/{effective-context-engineering-for-ai-agents, writing-tools-for-agents} ; openai.github.io/openai-agents-python/{multi_agent, human_in_the_loop, sessions} ; docs.perplexity.ai/docs/agent-api/{presets, building-agents/define-the-run}

## Round 3 – Google Gemini / Vertex (verified 2026-10-01) – our DEFAULT model
Facts:
- Thought signatures (Vertex): Gemini 3 function calling → "you must return the thought signatures from previous responses … even when using MINIMAL"; missing → **400 error**. Sequential calls: each functionCall has a signature; parallel calls: only the FIRST functionCall has it. Injected/custom history: `skip_thought_signature_validator` only as last resort (hurts quality). Google Gen AI SDK chat history handles it automatically.
- Gemini thinking guide: when switching models, resend previous thought blocks; backend manages compatibility.
- Claude (from errors doc): Opus 5.5 / Sonnet 5.5 replayed thinking blocks are accepted only while system prompt, tools and earlier messages are unchanged; otherwise 400 (or `drop_block` via beta header). Thinking blocks must be passed back unmodified in tool loops.
- Function calling modes: AUTO · ANY (force) · VALIDATED · NONE; `allowed_function_names`; up to 512 declarations but keep "a maximum of 10-20" active tools; low temperature for tools; parallel calls supported; streamed function-call args (Gemini 3 Pro+).
- Thinking: `thinking_level` low/medium/high (+minimal on some); gemini-3.8-flash default **medium**; thinking tokens billed as output.
- FinishReason: STOP, MAX_TOKENS, SAFETY, RECITATION, OTHER, BLOCKLIST, PROHIBITED_CONTENT, SPII, MALFORMED_FUNCTION_CALL, MODEL_ARMOR, UNEXPECTED_TOOL_CALL (+image reasons). Prompt blockReason: SAFETY, OTHER, BLOCKLIST, PROHIBITED_CONTENT, MODEL_ARMOR, JAILBREAK…
- 429 guidance (Google Cloud blog): exponential backoff + jitter; global endpoint; context caching; smooth bursts; consumption options Standard PayGo / Priority PayGo (user-facing) / Provisioned Throughput / Flex PayGo (latency-tolerant) / Batch (~24 h).

| # | Gap | Seen in | Rec |
|---|---|---|---|
| L4-G26 | **Store + return Gemini thought signatures exactly** (per functionCall; parallel = first only). Missing → 400, whole turn breaks | Google | **MVP – critical** |
| L4-G27 | **Model switching inside one chat** (Auto, fallback, user changes Gemini↔Claude, regenerate with other model): store provider-specific reasoning blobs per message; send them only to the same provider; strip for the other | Google, Anthropic | **MVP – critical** |
| L4-G28 | **Claude thinking-block rules**: pass unmodified inside a tool loop; earlier-turn thinking only if prefix unchanged → ArcNave policy: drop old-turn thinking blocks when history is trimmed/summarized/tools change | Anthropic | **MVP – critical** (verify `drop_block` beta on Vertex) |
| L4-G29 | Map all Gemini finish/block reasons + Claude stop reasons into ONE ArcNave finish code set; MALFORMED_FUNCTION_CALL / UNEXPECTED_TOOL_CALL → retry once | Google | MVP |
| L4-G30 | **Model capability matrix** in Gateway (force-tool: Gemini yes, Claude 5.5 no; parallel calls; max tools; thinking control) | Google, Anthropic | MVP |
| L4-G31 | One ArcNave "effort" knob → Claude `effort` / Gemini `thinking_level` | Google, Anthropic | MVP |
| L4-G32 | Budget meter counts thinking tokens as output | Google | MVP |
| L4-G33 | 429 handling: backoff + jitter, traffic smoothing; pick consumption tier per job type (Priority for chat, Flex/Batch for background jobs) | Google | Retry MVP; tiers → Stage 18/19 |
| L4-G34 | Streamed tool-call arguments | Google | Later |
| L4-G35 | **Provider conformance tests** (automated tests per model: tool loop, signatures, refusal, model switch, max steps) run before every model/SDK upgrade | ArcNave rec | MVP |

Sources: docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures ; …/multimodal/function-calling ; …/reference/rest/v1/GenerateContentResponse ; ai.google.dev/gemini-api/docs/thinking ; cloud.google.com/blog/products/ai-machine-learning/reduce-429-errors-on-vertex-ai
