# Claude-parity audit — 2026-09-26

A read of ArcNave's turn path, memory and system prompt against Claude's published docs. Each
finding says how far it is verified:

- **Code** — read in this repo (file named).
- **Docs** — quoted from Claude's docs or Help Center, read on 2026-09-25/26.
- **Live** — seen on production. Almost nothing here is yet; the `turn timing` log (PR #18) is
  how the latency findings get confirmed before any of them is changed.

Google's docs (ai.google.dev) are blocked from the session that wrote this, so anything about
Gemini's own behaviour is marked unverified.

## Fix pass, 2026-09-26 (branch `claude/tools-skills-architecture-jyxa61`, not deployed)

Each finding below, with what was done. "Local" means tested here (backend 967 tests, frontend
58, typecheck and build clean); none of it is live yet.

| # | Status | Where |
|---|---|---|
| B1 compaction at 150k | Fixed: compacts as the window fills (1M − 33k, Claude Code's 967K); tool results whole; skills given back after | ADR-0027 |
| B2 model probe | Fixed: no probe on a turn; the request's outcome is recorded | ADR-0028 |
| B3 one tool per round | Fixed: every call runs; results in one message; Gemini replay grouped | ADR-0026 |
| B4 16 rounds | Kept: Claude's app also stops at a per-turn tool-use limit and offers Continue, as ArcNave does | config comment |
| B5 8,000-char output | Fixed: 30,000 (Claude Code's read-back), head and tail; stderr within 10,000 | `codeExecutionExecutor.ts` |
| B6 PDF re-download | Fixed: rendered pages reused before download | `generation.ts` |
| B7 `MODEL_INPUT_BUCKET` | Open: production setting, needs a look at the service | — |
| B8 thinking invisible | Fixed for Gemini: thought summaries shown and stored | ADR-0030 |
| B9 cache prefix | Fixed: memory text stable; project excerpts no longer per prompt | ADR-0025, ADR-0029 |
| B10 project RAG | Fixed: search tool past the limit | ADR-0029 |
| B11 cold start | Open: production setting (`minScale`) | — |
| B12 Drive save | Open: needs a Drive connector decision | — |
| C1 memory off | Fixed: on by default | ADR-0025 |
| C2 no create | Fixed: `save_memory`, `POST /memory`, `PATCH /memory/:id` | ADR-0025 |
| C3 false policy | Fixed: policy rewritten to the tools that exist | ADR-0025 |
| C4 regex distiller | Left off: the model saves as the user chats, as Claude does | ADR-0025 |
| C5 AND query | Fixed: any word matches | ADR-0025 |
| C6 Claude features | Partly: topics editable, per-project memory, chat search; incognito not done | ADR-0025 |
| D1 PDF→Excel heuristic | Fixed: model reads and passes rows; `sourceAttachmentId` copies text files only | `deliverableExecutor.ts` |
| D2 goal tools | Fixed: named only in agent mode with a goal | `systemPrompt.ts` |
| D3 parallel contradiction | Fixed by B3 | ADR-0026 |
| D4 no date | Fixed: current date in the user's time zone | `systemPrompt.ts` |
| D5 three file rules | Fixed: one rule ("Files for the user"); artifacts are in-app documents | `systemPrompt.ts`, `ui/policy.ts` |
| D6 XLSX charts | Fixed: prompt says charts go through openpyxl in run_python | `systemPrompt.ts` |
| D7 verify with no tool | Fixed: prompt says to read generate_deliverable's own report | `systemPrompt.ts` |
| D8 duplicate links | Fixed: every tool-made file gets a card; prompt says not to repeat links | `App.tsx` |
| D9 research without web | Fixed: research guidance and skill only with web tools | `systemPrompt.ts`, `generation.ts` |
| D10 python skill hidden | Fixed: listed like any skill, description true | skill frontmatter |
| D11 `output/` claim | Fixed: text follows the sandbox engine | `systemPrompt.ts` |
| D12 skill after compaction | Fixed by ADR-0027 (skills given back) | ADR-0027 |
| D13 AgentLoop | Fixed: removed | `systemPrompt.ts` |
| E Gemini thinking billing | Fixed: output includes `thoughtsTokenCount` (Vertex prices "response and reasoning" alike) | ADR-0030 |

A guard test now fails if the system prompt names a tool the turn cannot use
(`routes/promptToolParity.integration.test.ts`). It caught two of this pass's own lines.

Still to confirm live: the deploy, `turn timing` (probe gone, TTFT), Vertex accepting
`includeThoughts`, compaction on a real long chat, and the new memory flow.

## A. Fixed and merged (deploy of `18e7606` not yet confirmed)

| # | Finding | Fix |
|---|---|---|
| A1 | Past 100,000 tokens all but the last 3 tool results were cleared; follow-ups re-ran OCR. The trigger was an opt-in API default. | Clearing removed (ADR-0023), PR #16 |
| A2 | A 12 s first-token cutoff aborted large follow-ups; history PDFs (`pages`) did not count as media. Live log: `First token wait exceeded 12000ms`. | No cutoff; 10-min request timeout; retry only failures (ADR-0024), PR #18 |
| A3 | Tool calls shown as per-call cards. | Claude-style activity timeline (`ToolActivity.tsx`), PR #16 |
| A4 | No way to see where a turn's time goes. | One `turn timing` log line per turn, PR #18 |

## B. Latency and lifecycle (as found; status above)

| # | Finding | Evidence |
|---|---|---|
| B1 | Compaction triggers at 150,000 tokens (`COMPACTION_TRIGGER_TOKENS`) on Gemini's 1M window, keeps 2 turns (`KEEP_TURNS`), cuts each tool result to 2,000 chars, and runs an extra model call while the user waits. | Code: `config.ts`, `compaction/autoCompact.ts`. Docs: 150k is the opt-in compaction beta's default (`compact-2026-01-12`); the Claude app summarizes "when your conversation approaches the context window limit". |
| B2 | Model probe: a real one-token call before the turn, every `MODEL_PROBE_TTL_SECONDS` (300 s), blocking. Suspect for the ~5 s "Sending request". | Code: `resolveModel` → `registry.status` → `runProbe`. Docs: the Claude SDK has no pre-flight call (absence, not a stated rule). |
| B3 | One tool per round: extra calls get a "deferred" failure (Gemini); `disable_parallel_tool_use: true` (Claude adapter). | Code: `providers/gemini.ts`, `providers/anthropicVertex.ts`. Docs: "By default, Claude may call multiple tools in a single response." |
| B4 | `TOOL_MAX_ROUNDS` 16, then the answer is forced (`tool_limit`). | Code. No Claude limit found in docs. |
| B5 | `run_python` output capped at 8,000 chars (`RUN_PYTHON_MAX_OUTPUT_CHARS`). | Code. Claude's limit not checked. |
| B6 | Every turn re-downloads each history PDF from storage before the render cache is checked; the render cache is in-memory only; a cold instance re-renders and checks GCS metadata per page. | Code: `hydrateAttachmentBytes`, `pdfPages.ts`, `modelInputStore.ts`. Docs: Files API is "create-once, use-many-times" but "Google Cloud: not available". |
| B7 | Whether `MODEL_INPUT_BUCKET` is set on production (without it, page images go inline on every round). | Unknown — check the service's env. |
| B8 | Thinking is invisible (no Gemini `includeThoughts`); Claude models run with no `thinking` config. | Code. Docs: streaming carries `thinking_delta`. Gemini behaviour unverified. |
| B9 | Relevant memory and project chunks go into the system instruction and vary with each prompt, ahead of the whole history, so the history's cache prefix breaks. | Code: `buildSystemInstruction`, `promptAssembly.ts`. Docs: Claude's cache prefix is tools → system → messages. Gemini unverified. |
| B10 | Large projects: code picks chunks into the prompt; Claude uses a project-knowledge search tool the model calls. | Code. Docs: Help Center, "RAG for projects". |
| B11 | Cloud Run cold starts / min-instances unknown. | Check `autoscaling.knative.dev/minScale`. |
| B12 | No "save to Google Drive" for created files. | Docs: Help Center, "Create and edit files". Minor. |

## C. Memory (as found; status above)

| # | Finding | Evidence |
|---|---|---|
| C1 | `ENABLE_MEMORY` defaults to false; production value unknown. | Code: `config.ts` |
| C2 | No tool or route creates a memory: tools are search/read/update/forget; `update_memory` needs an existing id; the route has GET and DELETE only. | Code: `tools/definitions.ts`, `routes/memory.ts` |
| C3 | The memory policy says "Use memory tools to store durable information" and to invoke a tool when asked to remember — there is none. | Code: `services/memory/policy.ts` |
| C4 | Background distillation is off (`ENABLE_MEMORY_BACKGROUND_DISTILL`) and is five English regexes. | Code: `services/memory/distiller.ts` |
| C5 | Relevant-memory search passes the whole prompt to `websearch_to_tsquery`, which ANDs every word; the ILIKE fallback matches the whole prompt as one string. A memory about "KVB and Federal" does not match "federal la evlo entries and kvb la evlo entries?". | Code + Postgres test |
| C6 | Claude has: a synthesis of past chats updated every 24 hours, "remember/forget" by asking, topics viewable and editable in Settings, separate memory per project, incognito, and chat search as a tool. ArcNave has none of these. | Docs: Help Center, "chat search and memory" |

## D. System prompt vs code (as found; status above)

The full system prompt (27,812 chars for a plain chat turn with tools, python and memory on) was
captured from the test harness and each claim checked.

| # | Finding | Evidence |
|---|---|---|
| D1 | "Convert this PDF into Excel → `generate_deliverable` with `sourceAttachmentId`": conversion splits extracted text on pipes/tabs/double spaces/commas; `instructions` is only printed as a quote line; a scanned PDF fails ("requires structured parsing upstream"). | Code: `tools/deliverableExecutor.ts` |
| D2 | Prompt tells the model to use `get_goal`, `update_goal`, `get_context_remaining`; none is in the chat-path catalog (agent loop only, off by default). | Code: `ProjectToolRegistry` catalog |
| D3 | Prompt: "When independent retrieval operations can safely be performed together, do so" — the adapters run one call per round. | Code (see B3) |
| D4 | No current date in the system prompt. | Code. Docs: the claude.ai system prompt provides "the current date". |
| D5 | Three rules for "give me a file": `<professional_deliverables>` → `generate_deliverable`; `<artifacts>` → `create_artifact` ("spreadsheets, presentations… if the user explicitly asks for a file"); generative-UI policy → `create_artifact` for "save, download". | Code: `systemPrompt.ts`, `ui/policy.ts` |
| D6 | Prompt lists XLSX "charts"; the xlsx renderers have no chart support. | Code: `services/documents/` |
| D7 | Prompt says to verify the generated deliverable and fix issues; the model has no tool to open the generated file (validation runs inside the tool). | Code |
| D8 | Prompt asks for "the download link" / "direct markdown download links"; the UI also shows a card, so the link appears twice. | Code + live screenshot |
| D9 | `<research>` and the `research-deep-dive` skill are always present, though `ENABLE_WEB` defaults to false (skill then runs guidance-only). | Code |
| D10 | `python-sandbox-patterns` says it is "Applied automatically whenever run_python is available"; autoload runs only in the agent loop, and the skill is not listed in chat. | Code: `agentLoop.ts`, `skills.ts` |
| D11 | "Every file written to `output/` is returned as a download" holds for the warm sandbox only; other engines need `expected_outputs`, but the text does not change with the engine. | Code: `systemPrompt.ts` |
| D12 | "A skill loaded earlier is still in context; do not load it again" stops being true after compaction (2,000-char summary). | Code |
| D13 | `<files>` refers to "the AgentLoop", which is off by default. | Code |

Checked and correct: `read_uploaded_file` page ranges; skill frontmatter rules and progressive
loading; every catalog tool has an executor; PDF "Page X of Y" footers; DOCX headers, footers,
hyperlinks and orientation; XLSX formulas and frozen rows.

## E. Carried over

- Gemini `thoughtsTokenCount` billing not verified.
- Earlier 91 s hang: root cause unknown, no logs.
- Model-input bucket setup (B7).
- S4 custom skill upload.
- Live GCS / sandbox checkpoint checks.

## F. Corrections to earlier claims in the session

- "Claude uses the Files API" was compared directly; it is not available on Google Cloud.
- The 100k clearing and 150k compaction were opt-in API defaults taken as Claude-app behaviour.
- A "+1 s per 10k tokens" first-token budget was a guess and was dropped before merge.

## Proposed order

1. Confirm the deploy of `18e7606` and read `turn timing` logs.
2. Small prompt fixes: D2, D4, D5, D8, D9, D10, D13, plus a test that every tool the prompt
   names is in that turn's catalog and a skill whose `requires` tools are missing is not listed.
3. Designed changes, each with its own ADR: B1 compaction, B9/C memory, B2 probe, B3 parallel
   tools, B6 PDF caching, D1 conversion, D6 charts, D7 verification.
