# ArcNave – Stage 3: Request Lifecycle
_Last updated: 2026-09-30 · Status: LOCKED_
_Based on: 01 (LOCKED), 02 (LOCKED) · Claude region per C2 = global endpoint_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - Generation phase runs in the **Turn Executor** via Cloud Tasks; API service relays the stream from Redis (~15 min) then DB; checkpoint after each step; 1 retry from checkpoint on crash (AS-D3).
> - Cooperative cancel (Stage 10 AO-5), completion check before final answer (AO-10), memory saved in-turn after the answer text (Stage 11 MEM-WRITE=1).


Goal: every step from the moment a user starts typing until the answer is fully on screen and saved. Deeper design for each step comes in the stage noted in [brackets].

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - Phase 1.6 "₹1,000 Claude cap" → per-company monthly Claude limit (RT-7).

## Phase 0 – Before "Send" (inside Web/Android app)
| # | Step | Details |
|---|---|---|
| 0.1 | Load composer | App asks server for allowed models for this user (Claude hidden if company switch OFF) |
| 0.2 | Attach file | Upload starts IMMEDIATELY on attach (not on send). App gets a secure one-time upload link → file goes straight to storage (Mumbai) → Background worker starts extraction. File chip shows: uploading → processing → ready / failed [Stage 9] |
| 0.3 | Mic | Record → Speech-to-Text → text placed in composer. User can edit before sending [Stage 9] |
| 0.4 | Pick model | User picks model (or "Auto" – see D2) |
| 0.5 | Press Send | App creates a unique request ID (prevents double-send if network retries) |

## Phase 1 – Receive & check (API service)
| # | Step | Details |
|---|---|---|
| 1.1 | Receive | {conversation, message text, file IDs, model choice, request ID} |
| 1.2 | Who is this? | Verify login token → user, company, role [Stage 16] |
| 1.3 | Input check | Message length, file count/size limits; every file ID belongs to same company + user; files are "ready" |
| 1.4 | Duplicate check | Same request ID seen before → return that result, do not run again |
| 1.5 | Rate limit | Per user and per company (stops abuse / runaway cost) |
| 1.6 | Policy + budget | Model allowed for this company? Claude switch ON? Company quota left? ₹1,000 Claude cap left? |
| 1.7 | Save user message | Stored in DB (Mumbai) with status "received" + trace ID |
| 1.8 | Open stream | Stream connection to app; send "received" signal at once (target < 0.5 s) |

## Phase 2 – Understand & plan (Orchestrator)
| # | Step | Details |
|---|---|---|
| 2.1 | Classify request | Simple chat / question on files / needs tool / multi-step task [Stage 7, 10] |
| 2.2 | Input safety check | Policy check; treat text inside files as data, not instructions (prompt-injection guard) [Stage 16] |
| 2.3 | Choose model | Model + region (Gemini→global endpoint, Claude→global endpoint) + fallback model [Stage 7] |

## Phase 3 – Build context (Orchestrator)
| # | Step | Details |
|---|---|---|
| 3.1 | System instructions | ArcNave base rules (+ company custom rules, if any) [Stage 6] |
| 3.2 | Conversation history | Recent turns in full; older turns as summary [Stage 6] |
| 3.3 | Memory | Fetch relevant user memory [Stage 11] |
| 3.4 | File content | Small file → include fully; large file → retrieve only relevant parts [Stage 12] |
| 3.5 | Tools | Attach only tools relevant to this request [Stage 8] |
| 3.6 | Size + cost check | Fits model's context limit and per-request cost cap; trim if needed [Stage 6, 18] |
| 3.7 | Convert | Model Gateway adapter converts to Gemini or Claude request format |

## Phase 4 – Generate (Model Gateway)
| # | Step | Details |
|---|---|---|
| 4.1 | Call model | Streaming call, Gemini + Claude: global endpoint (C2, C3); with timeout |
| 4.2 | Early failure | Error before first word → retry once / switch to fallback model [Stage 15] |
| 4.3 | Stream words | Each chunk forwarded to app immediately (target first words ≈ 1–3 s) |
| 4.4 | Tool loop | Model asks for a tool → pause → run tool → give result back → continue. Max-steps limit to prevent endless loops [Stage 8, 10] |
| 4.5 | Finish reason | Normal stop / hit length limit / safety block / error – each handled differently [Stage 15] |

## Phase 5 – Finish & validate
| # | Step | Details |
|---|---|---|
| 5.1 | Validate | Empty? Cut off? Broken table/code/format? Blocked content? [Stage 13] |
| 5.2 | Stream vs check rule | Normal chat: stream live + light checks. Structured output (tables, JSON, actions): check BEFORE showing [Stage 13, 14] |
| 5.3 | "Done" signal | Sent with model used + status |

## Phase 6 – Save & after-work
| # | Step | Details | Sync/Async |
|---|---|---|---|
| 6.1 | Save answer | Assistant message + status + model + tokens + cost | Sync |
| 6.2 | Update counters | User/company quota, Claude budget | Sync |
| 6.3 | Memory update | Extract anything worth remembering [Stage 11] | Async (worker) |
| 6.4 | Chat title | Auto-title for new conversations | Async |
| 6.5 | History summary | Summarize long conversations for future context | Async |
| 6.6 | Logs + trace | Timing of each step, errors, cost [Stage 17] | Async |

## Phase 7 – Show on screen (Web/Android)
| # | Step | Details |
|---|---|---|
| 7.1 | Render | Text, markdown, tables, code blocks, file references [Stage 14] |
| 7.2 | Stop button | User stops → model call cancelled → partial answer kept (see D4) |
| 7.3 | Network drop (mobile) | Answer keeps generating on server and is saved; app shows it when reconnected (see D3) |

## Timing targets (assumption – to confirm in Stage 18)
- "Received" signal: < 0.5 s
- First words (normal chat): ~1–3 s
- File questions: first words after file is "ready"; progress shown while processing

## Decisions (user confirmed 2026-09-30 – all recommendations accepted)
- D1. Send while file still processing? Rec: block Send until file "ready", show progress.
- D2. "Auto" option in model picker (ArcNave chooses best model)? Rec: yes, default = Auto (Gemini).
- D3. Mobile network drop: continue on server + show on reconnect? Rec: yes.
- D4. Stop button: keep partial answer? Rec: yes, marked "stopped".

## Documentation cross-check (Claude + Perplexity, verified 2026-09-30)
Only official API docs used. Internal architecture of claude.ai / Perplexity apps is NOT public – not compared.

| ArcNave step | Claude docs (platform.claude.com) | Perplexity docs (docs.perplexity.ai) | Result |
|---|---|---|---|
| Tools: model decides when/which tool | "Claude determines when to call a tool based on the user's request and the tool's description" | "The model decides when to call it based on your prompt and instructions" | ✅ Match |
| Tools: app decides which tools to offer (3.5) | Tools passed in `tools` array; `tool_choice` auto/any/tool/none (NOTE: Claude Opus 5.5 / Sonnet 5.5 accept only auto/none – no forced tool use; use strict tool use / structured outputs instead) | Tools enabled via `tools` array | ✅ Match |
| Tools: app executes client tools (4.4) | Client tools run in your app (`stop_reason: tool_use` → you send `tool_result`); server tools run on Anthropic | Custom functions run by caller; built-in tools run by Perplexity | ✅ Match |
| Tool definitions cost tokens (3.5) | Tool definitions + tool system prompt (~286–804 tokens) billed as input | Web search $2.50 / 1K calls (fast $1.00) + tokens | ✅ Match |
| Max-steps limit (4.4) | `pause_turn` = server-tool loop hit iteration limit; client loop limit is app's job | `max_steps` caps loop; default 1 without preset | ✅ Match |
| Fallback model (2.3, 4.2) | On Vertex: server-side `fallbacks` NOT supported → use client-side fallback | `models`: fallback chain up to 5 | ✅ Match (ArcNave does fallback in Model Gateway) |
| Finish reasons (4.5) | end_turn, max_tokens, stop_sequence, tool_use, pause_turn, refusal, model_context_window_exceeded; empty end_turn possible | Not detailed | ⚠️ Add all Claude reasons + empty-response case to Stage 15 |
| Streaming (4.3) | Supported | Supported | ✅ Match |
| Background / async (6.x) | Batch API NOT on Vertex | `background` mode exists | ✅ ArcNave uses own worker |
| File upload (0.2) | On Vertex: Files API + URL sources NOT supported; request payload max 30 MB | File inputs supported | ✅ Confirms ArcNave own File Processing layer; ⚠️ 30 MB cap → Stage 9 |
| Context size check (3.6) | Sonnet 4.6+ 1M tokens; Sonnet 4.5 / Haiku 4.5 200K on Vertex | – | ✅ Needed per model |
| Region (1.6, 2.3) | Regional endpoints only for Sonnet 4.6 and earlier; newer models = global or US/EU multi-region only | – | ✅ Resolved: C2 = Claude via global endpoint |

Other facts:
- Claude web search tool IS supported on Vertex; code execution, web fetch, MCP connector, Batch, Files API are NOT.
- Perplexity Sonar Chat Completions is legacy (support ended 27 Sep 2026); current product = Agent API (multi-provider models, built-in tools, custom functions, streaming, background mode, file inputs).

Sources: platform.claude.com/docs/en/agents-and-tools/tool-use/overview ; /build-with-claude/claude-on-vertex-ai ; /build-with-claude/handling-stop-reasons ; docs.perplexity.ai/docs/agent-api/tools ; /agent-api/building-agents/define-the-run ; /sonar/overview
