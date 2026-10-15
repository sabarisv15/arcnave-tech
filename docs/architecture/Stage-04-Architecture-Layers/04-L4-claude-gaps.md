# ArcNave – Stage 4 · L4 Orchestration – Claude-only gap list (high confidence)
_Verified 2026-10-01 · Source: Anthropic official docs + Anthropic engineering blog only_
_ArcNave uses Claude Sonnet 5.5 / Opus 5.5 via Vertex (Google Cloud) global endpoint._

## A. Tool loop
| # | Gap | Anthropic fact | Rec |
|---|---|---|---|
| C1 | Tool loop contract | `stop_reason: "tool_use"` → app runs client tools → sends `tool_result` → continue. Server tools run on Anthropic (only **web search** is available on Vertex; code execution, web fetch, MCP connector are not) | MVP |
| C2 | Parallel tool calls | Several `tool_use` blocks in one reply; read-only → run concurrently, side-effects → sequential; return ONE `tool_result` per call, all in the next user message, tool results before any text; skipped/failed → `is_error: true` | MVP |
| C3 | **No forced tool use on Opus 5.5 / Sonnet 5.5** | `tool_choice` `any`/`tool` → 400; only `auto`/`none`. Use strict tool use / structured outputs instead | MVP |
| C4 | Strict tool schemas | `strict: true` guarantees tool calls match the schema | MVP |
| C5 | Validate tool inputs in app | Sonnet may guess missing required params (e.g., invents a location) | MVP |
| C6 | Offer only relevant tools | Tool definitions + tool system prompt (~286–804 tokens) are billed input; bloated tool sets confuse the model | MVP |
| C7 | Tool design rules | Few consolidated tools, namespacing, semantic return fields, concise/detailed formats, pagination/truncation, actionable error messages, evaluate tools | Stage 8 rules; L4 enforces result-size cap |

## B. Stop reasons, refusals, failures
| # | Gap | Anthropic fact | Rec |
|---|---|---|---|
| C8 | Handle every stop reason | `end_turn, max_tokens, stop_sequence, tool_use, pause_turn, refusal, model_context_window_exceeded` | MVP |
| C9 | Empty response | Empty `end_turn` possible → don't retry unchanged; add a new user "continue" message | MVP |
| C10 | `max_tokens` mid tool call | Incomplete `tool_use` → retry with higher `max_tokens` | MVP |
| C11 | **Refusal handling** | Opus/Sonnet 5.5 classifiers → `stop_reason: "refusal"` + `stop_details.category`; can come mid-stream → discard partial output (→ `retract` event) | MVP |
| C12 | **Client-side fallback** | Server-side `fallbacks` NOT supported on Vertex → ArcNave retries refused request on another model itself | MVP |
| C13 | Mid-stream errors | Error event can arrive after HTTP 200 (e.g., overloaded); `ping` events in stream | MVP |
| C14 | Overload / rate limits | 529 overloaded; 429 with `retry-after`; SDK retries twice with backoff by default | MVP |
| C15 | Stream recovery | Interrupted stream: keep partial text; Claude 4.6+ → add user message asking to continue; partial `tool_use`/thinking can't be recovered (restart from last text block) | MVP |

## C. Thinking, effort, budgets
| # | Gap | Anthropic fact | Rec |
|---|---|---|---|
| C16 | Thinking can't be turned off | Opus 5.5: always on; Sonnet 5.5: lowest = `between_tools`; `disabled` → 400 | MVP |
| C17 | **Thinking blocks must be passed back unmodified** | In tool loops, every `thinking` / `redacted_thinking` block returned exactly as received (even empty) | MVP – critical |
| C18 | **Thinking blocks bound to conversation prefix** | Replayed blocks valid only if system prompt, tools and earlier messages are unchanged; else 400 (accounts from 31 Aug 2026) or `drop_block` (beta) → ArcNave policy: drop old-turn thinking when history is trimmed/summarized or tools change | MVP – critical (verify beta on Vertex) |
| C19 | Effort control | `effort` low/medium/high/xhigh/max (GA on Google Cloud); Opus 5.5 default medium; lower effort = fewer, terser tool calls; Sonnet 5.5 chat → start medium/low | MVP |
| C20 | Effort vs cache | Changing top-level effort breaks prompt cache; per-message effort (beta) keeps it on Opus/Sonnet 5.5 | MVP (keep effort constant per chat) |
| C21 | `max_tokens` sizing | Thinking counts toward `max_tokens`; set large at high effort; Sonnet 5.5 max 128K | MVP |
| C22 | Task budgets | Advisory loop budget (beta, min 20K); `max_tokens` remains the hard cap; too small → early stop/refusal-like | Later (verify on Vertex) |

## D. Conversation & context
| # | Gap | Anthropic fact | Rec |
|---|---|---|---|
| C23 | No assistant prefill | Claude 4.6+ reject prefilled last assistant message → conversation must end with user message | MVP |
| C24 | Stable prefix | Keep system prompt + tools stable per chat → better caching (cached input not counted in ITPM) and valid thinking blocks | MVP |
| C25 | Own compaction | Server-side context editing/compaction not stated for Vertex → ArcNave summarizes history itself | MVP |
| C26 | Context rot | More tokens → worse recall; just-in-time references, compaction, notes, sub-agent summaries | Stage 6/12 |
| C27 | Size limits | Google Cloud request ≤ 30 MB; Sonnet/Opus 5.5 1M context | MVP checks |

## E. Agent patterns & operations
| # | Gap | Anthropic fact | Rec |
|---|---|---|---|
| C28 | Start simple | "Begin by using LLM APIs directly"; add complexity only when it demonstrably helps (routing, chaining, parallel, orchestrator-workers, evaluator-optimizer) | MVP = routing + single loop |
| C29 | Effort scaling | Simple 1 agent 3–10 tool calls; comparisons 2–4 sub-agents × 10–15 calls; complex >10 sub-agents | MVP (profiles) |
| C30 | Multi-agent cost | Agents ≈4× chat tokens; multi-agent ≈15× | Later (Research) |
| C31 | Checkpoint + resume | "Minor system failures can be catastrophic" → resume from failure point | MVP |
| C32 | Rainbow deployments | Keep old + new versions running while shifting traffic so running agents don't break | MVP |
| C33 | LLM-as-judge evals | One prompt, 0.0–1.0 score + pass/fail most consistent; plus human testing | MVP (offline) |
| C34 | Request-id | Every response has `request-id` → store per model call for support | MVP |

Sources: platform.claude.com/docs/en/agents-and-tools/tool-use/{overview, parallel-tool-use} ; build-with-claude/{handling-stop-reasons, refusals-and-fallback, streaming, effort, task-budgets, context-editing, claude-on-vertex-ai} ; api/{errors, rate-limits} ; pricing ; anthropic.com/engineering/{building-effective-agents, multi-agent-research-system, effective-context-engineering-for-ai-agents, writing-tools-for-agents}

## Decision (user, 2026-10-01)
- C1–C34 accepted as recommended.
- User question: use a managed sandbox instead of our own Python? → Clarified: O-1 "own Python runner" = orchestration control code (not code execution). Code-execution sandbox = a TOOL, decided in Stage 8. Options recorded:
  (a) Gemini built-in code execution – Python, preset libs (pandas, numpy, matplotlib…), cannot install libs, 30 s max, inline CSV (no XLSX listed), no file outputs except charts, Gemini-only, no extra charge.
  (b) Vertex Agent Engine Code Execution – managed isolated sandbox, no network, state kept up to 14 days (configurable), file I/O up to 100 MB, preset libs, **us-central1 only**, any model via our Tool service; launch stage + pricing not stated → verify.
  (c) Own sandbox on Cloud Run (Mumbai) – full control (any libs e.g. openpyxl), more security work.
  (d) Perplexity Agent API sandbox – extra vendor; not preferred.
