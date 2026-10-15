# ArcNave – Checkpoint: Stage 6 (Context + System prompt) – LOCKED 2026-10-02
_Read this first when resuming. Stage 7 (Model routing) is next._

## Final artefacts
| Doc | What |
|---|---|
| 06-context-assembly.md | Gaps CG1–CG20, Claude-only CC1–CC6, decisions CXD-1–10 (LOCKED) |
| 06-policy-spec-v3.md | Master rule list (~95 rule IDs, C/S priority, prompt vs backend), shared runtime layout, implementation contract, helper prompts |
| 06-system-prompt-v3-claude.md | Claude rendering (XML, reasons, 7 examples) |
| 06-system-prompt-v3-gemini.md | Gemini rendering (12 critical rules first, compact, 3 examples) |
| 06-eval-cases-v1.json + D:\Architecture\arcnave-test-kit.zip | 68 test cases, mock tools, cross-vendor judge; **run deferred to Stage 21** (budget) – est. ~₹200 for Gemini+Sonnet 1 run, ~₹1,600 full |
| 06-CR1-artifacts.md + 06-astra-stage6b-results.md | Artifacts in MVP (4 types) + decisions AR-1–6, SK-1, LG-1–4, MEM-6 |
| 06-opus55-prompt-decode.md, 06-perplexity-presets-decode.md, 06-system-prompt-references.md | Reference analysis (structure only) |
| v0, v1, v2, v2.1 prompt docs | History only – superseded by v3 |

## Key decisions (user OK)
- Quality bar: ArcNave prompt quality must match Claude level (claude.ai).
- CXD-3b: one policy spec → per-model prompts. Language section removed (CXD-1).
- Precedence ArcNave > company (≤3,000 chars) > project (≤5,000) > user; updates replace older blocks, stay below base.
- App state (model_info, capabilities incl. per-format flags, profile, company/project) on system side; time + pending operations per turn; documents → memory → question last.
- Citations typed `[file:n]`/`[web:n]`; built-in web search citations from native metadata; claim-support check not yet built.
- Budgets Fast 16k / Normal 48k / Deep 200k; full file ≤30k tokens after processing, else retrieval; whole-document tasks → batch job.
- Artifacts MVP: docs, xlsx/pptx/csv, charts, HTML previews (separate domain, sandbox, CSP); built-in skills MVP, company skills Later.
- R1 updated: no thinking strip for append-only mid-chat updates.

## Doc sync owed (do in the named stage)
| Item | Stage |
|---|---|
| L1: artifact side panel, versions, downloads, KaTeX math, AI banner, memory-used mark, typed citation rendering, HTML preview (iframe sandbox, Android WebView rules) | 8 / 16 |
| L2: separate user-content domain | 16 |
| L4: capability/format gating, profile step limits, job polling + pending_operations | 8 / 10 |
| L5b: session state on system side, escaping, versioned blocks | 10 |
| L5e: mock tool list → real tools (file_search, web_search, fetch_url, run_code, memory_save/delete, create/update_artifact, load_skill, get_operation_status), idempotency keys | 8 |
| L7 + 05-1 data model: artifact, artifact_version tables; deletion map entries | 8 / 9 |
| Skill bodies (docx, xlsx, pptx, pdf, chart, web_page) | 8 / 9 |
| Scanned PDF: OCR at upload, page images, batch whole-document jobs, OCR engine research | 9 |

## LV-1 additions (live tests)
Gemini 3.8 Flash implicit-cache minimum (4,096 vs 6,144 tokens) · Claude `clear_at` turn-scoped system message after user turn · Claude mid-conversation system message format/precedence · exact prompt token counts (free countTokens / count_tokens) · Gemini mock-tool schema in google-genai (test kit untested locally).

## Lawyer list additions
SEBI applicability of stock questions (PT-3) · SPDI Rules 2011 until DPDP §43A omission (~May 2027) · Anthropic AUP AI-disclosure for internal B2B use · MeitY Mar 2024 advisory labelling · high-risk human-review workflow (PT-2).

## Not included / team-owned
Harmful-request, crisis and abuse test cases – written and reviewed by the team, added to the eval before Stage 21 lock.

## Doc-sync 2026-10-05 (Stage 21 Task 0.9 review – Gemini explicit-cache layout, FD-26 / ADR-0004)
- **Gemini main calls use an explicit context cache** (ADR-0004). The cached block = base system prompt (policy spec v3, Gemini rendering) + the enabled tools + tool config `VALIDATED`. It is identical for every company with the same tool set: **no company, project, user, memory or date text inside it**.
- A request that uses the cache **cannot** carry its own system instruction, tools or tool config (LV-128: 400 `INVALID_ARGUMENT`). Therefore, for Gemini, the per-turn blocks – IST date/time, company / project / user instructions, memory snapshot, summaries, retrieved text – move from the system instruction into the **contents**, as a leading context part of the turn. Precedence rules are unchanged (they stay below the base rules).
- **Quality check in Phase 1:** the prompt test kit (68 cases) runs with this layout and must show that company instructions are still followed and that the base rules still win over contents (injection cases). If not → ADR before release.
- Minimum explicit-cache size 4,096 tokens: the base prompt + tools (≈ 6.5k + ≈ 2.2k) is above it; never pad.
- Claude rendering is unchanged (Claude prompt caching with `cache_control`, LV-02).

## Doc-sync 2026-10-10 (Stage 21 Task 1.10 brief – Model Gateway, interim context v0)
- **Prompt sources in the repo:** `prompts/policy-spec/` now holds unchanged copies of `06-policy-spec-v3.md`, `06-system-prompt-v3-gemini.md`, `06-system-prompt-v3-claude.md` (master = this Architecture folder). Runtime files `prompts/system/v3/{gemini,claude}.md` = exactly the code block of each rendering; prompt version = first 12 hex of the file's SHA-256; a CI test guards the copy.
- **Interim context v0 (until context assembly v1, block 6):** base prompt (Gemini: in the explicit cache, ADR-0004; Claude: system block with a cache breakpoint) + session state `<model_info>` (served model, knowledge cutoff) + `<capabilities_state>` all off, `formats=""` + `<profile>`; no skills list, memory, company or project blocks; `<current_time>` IST per turn (Gemini: leading content part of the user turn; Claude: start of the user turn – no `clear_at` beta); history = last N-16 6 turns of the active branch, text only, no token budget yet (N-03 with block 6); user / history text escaped (`<` → `&lt;`). The 68-case prompt kit runs with context assembly v1.

## Doc-sync 2026-10-11 (Stage 21 Task 1.10 Part 1 review – interim context v0 as built)
- **Renderings (Task 1.10 Part 1):** `<current_time>2026-10-11T01:45:30+05:30 Sunday IST</current_time>` (IST ISO-8601 with offset, English weekday, zone name); the session-state block = the spec's three elements without a wrapper. History = walk back from the current user message to the sixth earlier user message; only messages with text (an answer that failed empty is not sent); two user messages in a row are joined into one user turn by the adapter.
- **Blocked exchanges (reviewer rule, Task 1.10 fix round 1 R-3):** an assistant message whose turn ended **`blocked`** and the user message directly before it on the branch are left out of later history – one safety block must not block the next turns. The current user message is always sent (a regenerate / edit of a blocked question works); after a successful regenerate the question and the new answer are history again. Partial text of a `failed` / `interrupted` answer stays in history. Context assembly v1 (block 6) keeps this rule.

## Doc-sync 2026-10-12 (Stage 21 Task 1.10 close – interim context v0 on dev)
- **Whitespace-only history (fix round 2 R2-2):** a history message whose text is empty after `strip()` is left out (a partial answer cut after a whitespace-only delta is stored as it came; the Claude API refuses a whitespace-only text block). Both providers; the stored text is unchanged; the current user text cannot be whitespace-only (`check_message_text`).
- **Gemini base prompt below the explicit-cache minimum (dev run 2026-10-12):** the whole first Gemini request (v3 base prompt + session state + time + a short question) was 4,166 input tokens; the cache create answered "below minimum" (Gemini 3: 4,096) → every Gemini call is uncached, storage ₹0. Never padded (ADR-0004). Context assembly v1 (block 6: skills list, memory, company / project blocks) will grow the cached prefix – re-check there; if the prefix stays below the minimum, switch the cache attempt off by configuration (the first Gemini turn of each instance spends ≈ 4 s on the attempt).

## Doc-sync 2026-10-12 (Stage 21 Task 1.11 brief – continuation text, Gemini cache switch)
- **Prompt kit – stream-recovery text v1** (`prompts/system/recovery/continue-v1.md`, source = the Task 1.11 brief): "Your previous response was interrupted. It ended with the text inside <previous_response>. Continue from exactly where it stopped: do not repeat any of it, do not start again, and do not mention the interruption." followed by the escaped partial inside `<previous_response>`; placed as the last text block of the current user turn; version stamped on the turn.
- **ADR-0004 operation:** new gateway setting `GATEWAY_GEMINI_EXPLICIT_CACHE` (`on` default / `off`). The v3 Gemini base prompt is below the 4,096-token minimum (Task 1.10 dev run), so the dev executor runs `off` (no doomed cache attempt per scaled-to-zero instance); context assembly v1 re-decides. Interim context v0 moves to `packages/chat` with the runner (context v1 goes to `packages/context`).

## Doc-sync 2026-10-14 (Task 1.12 close, Task 1.14 brief)
- **Context v1a as built (Task 1.12, N-75):** history = newest ≤ 6 turns (N-16) while the cumulative estimate ≤ `H` (N-03[profile] − fixed part − user text − retrieval reserve 0); the newest 2 turns are always sent (floor) and `over_budget` is set when they exceed `H`; a count-API call only when the estimate > 80 % of N-03, and the count can only shrink the selection. **The floor of 2 and the overflow drop are new rules, not in CXD-5.** Five stamp fields on the turn: `history_turns`, `history_dropped_turns`, `ctx_tokens`, `ctx_count_source`, `over_budget` (also on `chat_turn_finished` and, as internal diagnostics, `GET /v1/turns/{id}`).
- **Fallback budget (Task 1.12 open issue 1):** `H`, the count and the stamp describe the planned model; after a fallback hop (e.g. Gemini → Sonnet) the served request has another fixed part and tokenizer, and may exceed N-03 while `over_budget` is false. A second selection per hop is a later design decision (not built).
- **Summary (Task 1.14 brief, N-77 – not built yet):** table `summaries` (per conversation, `covers_upto_message_id`), used only when that message is on the current branch path. Block tag **`<earlier_conversation_summary>`** (escaped text) next to `<current_time>` (Gemini: leading context part of the turn; Claude: start of the user turn); history = the summary + only the turns after the covered message, `H` reduced by the summary estimate. **Cover set** = uncovered turns older than the last `history_turns` turns of the finished turn (at least 2), oldest first up to `SUMMARY_INPUT_MAX_TOKENS`; trigger 60 % of (N-03 − fixed part). New stamp field `summary_version`. Job on the worker, Haiku 5.5, thinking disabled, no fallback (ADR-0014). Known limit: a chat of many short turns never passes the trigger, so turns beyond the window stay unsent (N-16 as locked). Instructions (company / project / user) come with **Task 1.15**.
