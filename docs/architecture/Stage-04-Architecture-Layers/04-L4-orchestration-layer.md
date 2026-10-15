# ArcNave – Stage 4 · L4 Orchestration Layer (the brain) – deep dive
_Last updated: 2026-10-01 · Status: LOCKED_
_Parent: 04-architecture-layers.md · L1, L2, L3 LOCKED_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - Capability/format gating: disabled tools/formats not sent and execution rejected; profile step limits Fast 1–2 / Normal 5 / Deep 15; job polling via get_operation_status + pending_operations (Stage 6/8).
> - Tool set = **12 tools** (Stage 8 + Stage 11): file_search, read_file, web_search, fetch_url, run_code, create_artifact, update_artifact, load_skill, get_operation_status, memory_read, memory_write, memory_delete. Read tools parallel, write tools in order (TD-19).
> - Stage 10: loop guard (AG18), step budget → final answer (AG19), cooperative cancel (AO-5), completion check (AO-10), >10 min work in Cloud Run jobs.


> **Doc-sync 2026-10-03 (Stage 13) – see Stage-13-Output-Validation/00-checkpoint-stage13.md:**
> - L4-G29 finish-code map v2: Gemini adds FINISH_REASON_UNSPECIFIED, OTHER, MODEL_ARMOR, IMAGE_SAFETY, IMAGE_PROHIBITED_CONTENT, IMAGE_RECITATION, IMAGE_OTHER, NO_IMAGE; Claude pause_turn → continue loop; completion only after final message_delta (never from text). Recitation = keep partial + notice + regenerate, no provider fallback.
> - Validator (component 9) now has 3 release points (live / before show-act / after done) and a fixed retract list (VD-5); V-1 → VD-1 Flash-Lite claim judge; V-2 → VD-2 annotate + Deep regenerate; completion check per VD-6; tool-input streaming buffered (not fine-grained).

> **Doc-sync 2026-10-03 (Stage 15) – see Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md:**
> - G38 timeout hierarchy + G39 retry matrix now have provisional numbers (ER-2/ER-4, numbers register N-42/N-43); SDK retries off (ER-1); component 8 deadline = asyncio.timeout + cooperative cancel, Cloud Run 504 never relied on (EH5); G43 + retry budget ≤10 % (EH20); circuit breaker thresholds (ER-13); fallback strips model-specific settings (EH18); unknown events tolerated (EH23).

## 1. Job of L4
Runs ONE turn (user message → final saved answer) as a controlled, resumable state machine. Decides the order of work; calls L5 services; never talks to vendors directly.

## 2. Turn state machine
```
RECEIVED → POLICY_CHECK → PLAN → SAFETY_IN → BUILD_CONTEXT → GENERATE ─┬─→ VALIDATE → FINALIZE → DONE
                                                         ↑           │
                                                         └─ TOOL_RESULTS ← TOOL_CALLS (loop, max steps)
Terminal/side exits (from any step): STOPPED · FAILED · BLOCKED(safety) · BUDGET_EXCEEDED · DEADLINE_EXCEEDED
```
- Every state change is **checkpointed** (turn row in DB + stream buffer in Redis) → resume after crash / network drop.
- Every exit produces a **controlled final message** (never a raw crash) + typed error code.

## 3. Components
| # | Component | Job (technical) |
|---|---|---|
| 1 | Turn runner | Drives the state machine; one active turn per chat (409 `run_in_progress`) |
| 2 | Policy engine | Model allowed (UI-5), quotas, Claude ₹ budget, file readiness |
| 3 | Planner / router (M2) | Classify request (chat / file-QA / tool / multi-step); pick model (Auto), tools to offer, full-content vs RAG, **effort budget** (max tool steps, max tokens) |
| 4 | Context builder call | Asks L5 Context service for the prompt within token budget |
| 5 | Generation runner | Streams from Model Gateway; forwards `delta`/`thinking` events; handles finish reasons |
| 6 | Tool loop runner | Receives tool calls → permission check → run (read-only tools **in parallel**, side-effect tools **sequential**) → return **one result per call, all together**, failed/not-run calls as `is_error` → loop; per-tool timeout; tool concurrency limit; unknown-tool handling; max steps |
| 7 | Budget meter | Running token/cost counter for this turn; stops before crossing per-turn / company / Claude caps |
| 8 | Deadline & cancel | Turn deadline; Stop button cancels model call + running tools (idempotent) |
| 9 | Validator call | Output checks (Stage 13); may emit `retract` (L3-G5) |
| 10 | Event emitter | `ack, status, thinking, delta, citation, tool_status, ping, retract, error, done`; each with `seq` |
| 11 | Checkpoint store | Turn state + last seq + partial output → resume (D3) |
| 12 | Tracer | One `trace_id` per turn; spans per step, model call, tool call (Stage 17) |

## 4. Patterns supported (Anthropic "Building effective agents")
- **MVP:** routing (planner) + single agent tool loop. Start simple.
- **Later (Research mode):** orchestrator-workers (lead + parallel sub-agents), evaluator-optimizer. Only when evals show benefit.

## 5. Gap check vs vendor docs (verified 2026-09-30)
Facts: OpenAI Agents SDK loop = LLM call → final output / handoff / tool calls → re-run; `max_turns` → `MaxTurnsExceeded`; typed errors `ModelBehaviorError`, `ModelTimeoutError`, `ToolTimeoutError`, guardrail tripwires; error handlers can return "a controlled final output instead of ending the run"; run config has tool concurrency limits, `tool_not_found_behavior`, `tool_error_formatter`, tracing (`trace_id`, `workflow_name`). Anthropic parallel tool use: Claude may return several `tool_use` blocks; run independent read-only calls concurrently, side-effect calls sequentially; return one `tool_result` per call, all in the next user message, results before text; not-run calls → `is_error: true`. Anthropic multi-agent research: orchestrator-worker; agents ≈4× chat tokens, multi-agent ≈15×; effort scaling (simple 1 agent 3–10 tool calls; comparison 2–4 sub-agents × 10–15 calls; complex >10 sub-agents); parallelism cut research time up to 90%; checkpoint + resume because "minor system failures can be catastrophic"; **rainbow deployments** so running agents aren't broken; LLM-as-judge (0.0–1.0 + pass/fail) most consistent, plus human testing. Google ADK: open-source, Python/TS/Go/Java/Kotlin; LLM, workflow (Sequential/Parallel/Loop), custom, graph agents; sessions/state/memory; context assembly that filters events and summarizes old turns; callbacks; evaluation; deploy to Agent Runtime / Cloud Run / GKE; model-agnostic (Gemini, Claude, OpenAI, LiteLLM).

| # | Gap | Seen in | Rec |
|---|---|---|---|
| L4-G1 | Every failure path ends in a **controlled final message** (max steps, refusal, invalid output) | OpenAI Agents SDK | MVP |
| L4-G2 | Typed failure classes (malformed model output, model timeout, tool timeout, max steps, guardrail) mapped to our error codes | OpenAI Agents SDK | MVP |
| L4-G3 | Parallel tool calls: read-only concurrent, side-effect sequential; one result per call; `is_error` for failed/skipped | Anthropic | MVP |
| L4-G4 | Tool concurrency limit, unknown-tool handling, tool-error formatter | OpenAI Agents SDK | MVP |
| L4-G5 | Checkpoint + resume of a running turn | Anthropic | MVP |
| L4-G6 | **Deploy without killing running answers** (gradual traffic shift + drain old instances) | Anthropic (rainbow) | MVP |
| L4-G7 | **Effort scaling**: planner sets tool-call/token budget by question complexity | Anthropic | MVP |
| L4-G8 | Per-turn trace with trace_id + step spans | OpenAI Agents SDK | MVP |
| L4-G9 | LLM-as-judge scoring (0–1 + pass/fail) in evaluation harness, plus human review | Anthropic | MVP (offline evals) |
| L4-G10 | Multi-agent orchestrator-workers (≈15× tokens) | Anthropic | Later (Research mode) |
| L4-G11 | Handoffs between specialist agents | OpenAI Agents SDK | Later |
| L4-G12 | Structured context assembly (filter events, summarize old turns) | Google ADK | Covered (L5 Context, C4) |
| L4-G13 | Input/output guardrail tripwires | OpenAI Agents SDK | Covered (C6) |

## 6. Open decisions (L4)
| ID | Question | Options | Recommendation |
|---|---|---|---|
| O-1 (=L-1) | Orchestrator build | (a) Thin custom runner in Python; (b) Google ADK (Python, Gemini+Claude, sessions, eval, Cloud Run); (c) OpenAI Agents SDK | (a) for MVP – full control of our SSE/seq/resume contract, simple loop; keep interfaces so ADK can be adopted for Research mode (re-check in Stage 10) |
| O-2 | Default limits | max tool steps / turn deadline | 8 tool steps, 10-min turn deadline (under Cloud Run 15-min guidance); tunable per company in ops |
| O-3 | Where turns run | (a) inside API service while streaming; (b) always in background worker | (a) in MVP; background path added with Research mode |

Sources: openai.github.io/openai-agents-python/running_agents ; platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use ; anthropic.com/engineering/multi-agent-research-system ; anthropic.com/engineering/building-effective-agents ; adk.dev

## 7. Decisions (user, 2026-10-01)
- G1–G13 (round 1), G14–G35 (round 2/3) and Claude list C1–C34 accepted as recommended (see 04-L4-round2-findings.md, 04-L4-claude-gaps.md).
- O-1: DECIDED (a) – own thin Python orchestration runner (control flow), condition: output quality must be high → enforced via Stage 13 validation + evals (G35, C33).
- Code-execution sandbox: Stage 8 decision (options in 04-L4-claude-gaps.md).
- O-2: DECIDED – effort profiles Fast (1–2 tool steps) / Normal (5) / Deep (15), turn deadline 10 min, tunable per company in ops.
- O-3: DECIDED – MVP turns run inside API service while streaming (with checkpoints); background-worker path added with Research mode.

## 8. Self-audit – extra L4 technical items (2026-10-01)
| # | Item | What it means | Rec |
|---|---|---|---|
| L4-G36 | **Turn record spec** | What is checkpointed: turn_id, state, step no., profile, model calls (model, region, request-id, usage incl. thinking/cache tokens), tool calls (id, input, result, status), last seq, partial text, provider reasoning blobs (Gemini signatures / Claude thinking) | MVP (schema in Stage 5) |
| L4-G37 | **Async concurrency model** | Python asyncio; one task per turn; cancellation propagates to model stream + tools; slow client → bounded stream buffer (no memory blow-up) | MVP |
| L4-G38 | **Timeout hierarchy** | first-token timeout · stall (no tokens for N s) timeout · per-tool timeout · turn deadline (10 min). Stall → retry/fallback | MVP |
| L4-G39 | **Retry / fallback matrix** | Which error → retry how many times → when switch model → never silently retry after user already saw partial text (retract first) | MVP (numbers in Stage 15) |
| L4-G40 | **Side-effect tool idempotency** | Tool call id used as idempotency key so resume/retry never runs an action twice | MVP (slot; real side-effect tools later) |
| L4-G41 | **Branch-aware history** | Edit/regenerate (G1/G2): build history along the selected branch path only; regenerate can use another model (then apply C18/G27 rules) | MVP |
| L4-G42 | **Per-company fairness** | Max concurrent turns per company/user so one tenant can't take all capacity or provider quota | MVP |
| L4-G43 | **Client-side provider rate limiter** | Token-bucket per model/provider in ArcNave so bursts don't create 429 storms | MVP |
| L4-G44 | **Per-call usage ledger write** | Every model call's tokens (input, output, thinking, cached) written for cost + budget | MVP (details Stage 18) |
| L4-G45 | **Profile sampling settings** | temperature/top_p per profile (low for tool use) | MVP |
| L4-G46 | **In-turn context growth guard** | Long tool loops (Deep = 15 steps) grow context; trim/shorten OLD tool results inside the turn before hitting limits (Claude server-side context editing not stated for Vertex → do it ourselves; respect C17/C18) | MVP |
| L4-G47 | **Planner fallback + latency budget** | Rules first; LLM router only when rules unsure; router failure/slow → default Normal profile (never block the turn) | MVP |
| L4-G48 | **Config version stamping** | Every turn records prompt version, profile version, model id/version, tool-set version → any bad answer is reproducible | MVP |
| L4-G49 | **Kill switch** | Ops can instantly disable a model, tool or profile (provider incident, bad release) without redeploy | MVP |

### Audit checklist (2026-10-01)
Lifecycle ✅ · Control/limits ✅ · Reliability (retry, fallback, resume, timeouts) ✅ · Safety hooks ✅ · Cost/budget ✅ · Observability/trace ✅ · Multi-tenant fairness ✅ · Model-specific rules (Claude C1–C34, Gemini G26–G33) ✅ · Deployment (rainbow, drain) ✅ · Testing (G35, C33) ✅
Exact numbers (timeouts, retries, limits) are set in Stages 15/18; content of prompts in Stage 6.

## 9. Where system prompt, context and policy live
| Thing | Who decides WHEN | Who builds WHAT | Stored where | Detailed in |
|---|---|---|---|---|
| System prompt (rules, tone, citations, language, current date) | L4 BUILD_CONTEXT step picks prompt version for the profile | L5 Context service | Versioned Prompt & Config registry (L8, C9) | **Stage 6** |
| Context (history, summaries, memory, file chunks, tool list) | L4 planner (full vs RAG, which tools) | L5 Context / Retrieval / Memory services | DB + vector index | **Stage 6, 11, 12** |
| Business policy (quota, model allowed, Claude switch, limits) | L4 Policy engine | L4 Policy engine | DB + ops console config | Stage 16/18 |
| Safety policy (content rules, prompt-injection, PII) | L4 hooks (input / tool / output) | L5 Safety service | Config registry | **Stage 16** |
| Model behaviour policy (refuse style, answer format) | – | Written inside system prompt | Config registry | Stage 6, 13 |

- 2026-10-01 · G36–G49 accepted. **L4 LOCKED.**
