# ADR-0080: History budget, rolling summary, title job and router shadow on a helper model

- Status: accepted (task tech-p05 wave 2 = NEW-PLAN P13). Tested offline; not merged, not deployed.
- Date: 2026-10-17
- Task: P13 ([`docs/ops/p05-wave-plan.md`](../ops/p05-wave-plan.md) §2). Evidence:
  [`docs/ops/p13-result.md`](../ops/p13-result.md). Live checklist:
  [`docs/ops/p13-live-checklist.md`](../ops/p13-live-checklist.md).
- Supersedes: [ADR-0019](0019-long-chats-follow-claude.md) and [ADR-0027](0027-compaction-as-the-window-fills.md)
  for the compaction (trigger, kept turns, model, tag; both carry a note). The Stage 6 / Stage 7
  text naming "Flash-Lite" (or "the cheapest allowed model") for helper jobs, and OQ-01 / OQ6-1 /
  OQ7-1 as far as the helpers go: **every helper is Claude Haiku 5.5** (owner decision, 2026-10-17).
- Amends: [ADR-0055](0055-three-models.md) (one helper row; the three chat models stand).
- Migration: `0032_history_summaries`. Models used: Opus 5.5 (one agent).

## Stage decisions applied

Stage 3 6.4 (title) · Stage 6 CXD-5 (summary), CXD-6 (input budget, Normal only), HIST-WINDOW,
STAMPS, REC, HP-TITLE, HP-SUM · Stage 7 M7 (job rows), RT-2 / RT-3 (router M2 shadow, switch off).
Numbers (`backend/src/config/numbers.ts`, `// --- P13`): N-03 48,000; N-16 6; N-75 floor 2 and
the 1 s count timeout; N-77 0.6 / 30,000 / 1,200 / 60 s / 6,000; N-76 1,500 / 40 / 20 s / 60;
N-69 1.5 s; N-74 router 1,024. Each value was read against `00-numbers-register.md` rows 8, 21,
76, 81–84 on 2026-10-17.

## Claude (the reference) and where ArcNave differs

- **Helper model.** The Claude API's model guidance (the `claude-api` skill, cached 2026-10-06,
  read 2026-10-17, `shared/models.md` and `shared/model-migration.md` → "Migrating to Claude Haiku
  5.5") names `claude-haiku-5-5` "for high-volume, latency-sensitive work such as classification,
  routing, extraction, and sub-agent tasks": 1M context, 128K output, adaptive thinking on by
  default, `{type: "disabled"}` accepted at effort `high` or below, effort default `medium`,
  non-default sampling parameters and assistant prefill refused with a 400; $0.10 / $0.50 per MTok
  up to 100K-token prompts. Sonnet 5.5 and Opus 5.5 answer `{type: "disabled"}` with a 400 (same
  source). ArcNave sends `thinking: {type: "disabled"}` only where the capability spec says so
  (`thinkingOff`), and refuses it elsewhere before a request is made.
- **Structured output.** `output_config: {format: {type: "json_schema", schema}}` (same skill;
  checked in `node_modules/@anthropic-ai/sdk` 0.126 `messages.d.ts`: `OutputConfig.format:
  JSONOutputFormat`). The router's classify call uses it; title and summary are plain text.
- **Summarising a long conversation.** Claude's server-side compaction summarises when the
  context nears its trigger (default 150K tokens, beta `compact-2026-01-12`), and Claude Code
  compacts near the window (ADR-0027). ArcNave differs on purpose: Stage 6 CXD-5 / N-77 fixes the
  trigger at 60 % of the Normal input budget (48k) and keeps the newest 6 turns word for word; the
  stage wins (ADR-0071). The summary is our own job on Haiku 5.5, not the API's compaction (the
  chat models include Gemini, which has none).
- **Chat titles.** No Claude-published description of how the Claude app names chats was read for
  this task; the title job is the Stage 6 HP-TITLE / N-76 decision (ADR-0071).
- **Counting.** The provider count APIs (Claude `count_tokens`, Gemini `countTokens`) are provider
  metadata, not an estimate (Invariant 3; OQ-08 allows them). N-75's local byte estimator is not
  built (owner item OQ-08).

## Decision

1. **Helper row.** `ModelEntry.role: 'helper'`, alias `Haiku 5.5`, id `MODEL_HAIKU` (default
   `claude-haiku-5-5`, empty turns the jobs off). The registry keeps helper rows in their own map:
   never in `/models`, `availableEntries`, Auto, a chat alias, or a fallback chain (P11 contract).
   `helperStatus()` is static (key, id, adapter) plus the last real call's outcome (a 404 / 401
   keeps it unavailable for the probe TTL); no probe call. `CLAUDE_HAIKU_55_SPEC`,
   `knowledgeCutoff: null` (not on the page read).
2. **Adapter.** `providers/anthropic.ts`: `complete()` and `classify()` (one non-streaming request,
   no tools, no history, no `cache_control`, no sampling fields, thinking off, SDK retries 0), and
   `GenerationRequest.thinking?: 'off'` on the stream path, refused unless the spec allows it.
3. **No helper fallback (Invariant 1).** A helper that is not available, or an adapter without the
   method, makes the job `skipped` with code `helper_unavailable`; no other model is called.
4. **`summaries`** (migration 0032): `chat_id`, `covers_upto_message_id` (FK, cascade),
   `covers_upto_seq`, `summary_version`, `text` (CHECK ≤ 6,000 characters), `model`, `status`
   (`ready` | `discarded`), token counts; unique (chat, covered message) and (chat, version). A
   turn uses the newest ready row whose covered message exists, is in this chat (checked on the
   message row, not only the summary row), and is below the current user message. A branch copies
   the rows whose covered message it keeps, remapped to the copied ids; a fork inside the covered
   range copies none of the rows past the fork, so the branch never uses them.
5. **Summary job** (`services/summary/summaryJob.ts`), started by `settle.ts` after the settle
   transaction commits, never awaited, complete turns only: reads the stamps of the finished turn;
   no provider count → no job. Counts (chat model's family count API) the current summary and every
   uncovered exchange; when that sum is above 0.6 × (N-03 − the stamped fixed part), it covers the
   uncovered exchanges older than the newest `history_turns` (min 6, at least 2), oldest first up
   to 30,000 input tokens (the summary it replaces counts too), with HP-SUM
   (`prompts/helpers/summary-v1.md`, verbatim from `06-policy-spec-v3.md`), 1,200 output tokens,
   60 s. The previous summary leads the input (escaped), so the new row replaces it. A failed,
   timed-out, refused or cut (`max_tokens`) answer writes nothing: the history stays whole.
6. **History window** (`services/summary/historyWindow.ts`, applied once in the context build
   after the system instruction is known): the history starts after the summary's covered message
   (`loadHistory`'s existing after-seq), then keeps the newest 6 exchanges (and older uncovered
   ones, item 7), drops the oldest while
   the counted total (stable text + session state + tool declarations, the summary, the kept
   exchanges' text and tool calls, the new message) exceeds 48,000, down to the newest 2, which are
   always sent (`over_budget`). Failed, blocked and empty exchanges were already left out
   (`withoutFailedExchanges`). With no count nothing is dropped for size (no estimator), and the
   stamp says `none`. Attachments are not counted here (CXD-4's file budget sizes them).
7. **Ours, pending the owner:** `HISTORY_KEEP_UNCOVERED` (default true) keeps exchanges older than
   6 while no summary covers them. The stage's own text says turns past the window stay unsent
   ("known limit"); without this a short chat that never reaches the trigger would lose a file sent
   seven questions ago (the 2026-09-20 carry-forward entry in `mistakes.md`; `longChat` tests).
   `false` is the stage rule. OWNER ITEM.
8. **Rendering.** `<earlier_conversation_summary covers_upto="<seq>" version="<n>">` with the text
   escaped (`<` → `&lt;`), in the per-turn state (Claude: start of the user turn; Gemini: leading
   context part), as before. Skills read in covered turns come back in full (ADR-0027 rule, now
   also for summaries).
9. **Stamps** on the assistant row (nullable): `history_turns`, `history_dropped_turns`,
   `ctx_tokens`, `ctx_count_source` (`provider` | `none`), `over_budget`, `summary_version`,
   `prompt_version`, `registry_version` (null until P10), and **ours** `ctx_fixed_tokens` (the
   fixed part, which the summary trigger needs after the turn). Ids and counts only.
10. **REC.** `prompts/system/recovery/continue-v1.md` + `renderRecovery()`; not wired (P11 / P15).
11. **Title job** (`services/helpers/titleJob.ts`): after the first completed turn (answer seq 1),
    1,500 code points of the first message and of the first answer (escaped, tagged), HP-TITLE
    (`prompts/helpers/title-v1.md`), 40 output tokens, 20 s; the answer's first line, markup and
    quotes stripped, no trailing period, cut to 60 code points. `chats.title_source`: `default`
    (new chat) → `prompt` (the first message's 80-character placeholder, kept) → `generated`; a
    PATCH rename sets `user` (shared with the chat's versions). The write is a compare-and-set on
    `title_source = 'prompt'`, so a rename always wins and the title is set once. Frontend: after a
    run, while the chat still shows the placeholder, the chat list is read again at 3 s and 10 s
    (ours); picked over a `title` SSE frame because the job runs after `done`, when the stream may
    already be closed.
12. **Router M2 shadow** (`services/routing/routerShadow.ts`): `ROUTER_SHADOW` (default off); when
    on, one `classify` call `{intent, tier}` per turn after the rules picked the model, never
    awaited, 1.5 s, 1,024 output tokens, effort low, thinking off; enums matched without regard to
    case; status `ok` / `timeout` / `error` / `invalid` / `skipped`; one log line `router_shadow`
    with ids, enums, counts and duration. The route is never changed. The intent list is **ours, a
    placeholder pending the owner** (`chat`, `search`, `files`, `code`, `other`): no stage writes one.
13. **OQ-09 (CXD-5 written default: retire after the switch).** `ENABLE_HISTORY_SUMMARY` defaults to
    **true**: the stage's pick is to re-point the old compaction to the summary and retire it after
    the switch, and every failure of the new path (no helper, no count, a failed call) leaves the
    history whole rather than breaking the turn. While it is on, the
    compaction is off whatever `ENABLE_CONTEXT_COMPACTION` says (they never run together); `false`
    brings the compaction back per its own flag. The compaction code stays one release behind the
    flag, then goes (the stage's DISCARD list: `conversation_compactions`, `SUMMARY_PROMPT`,
    `<conversation_compaction>`, `STATIC_COMPACTION_POLICY_V1`).
14. **Usage and logs.** Each helper call builds the P22 `CallUsage` shape locally (`HelperCallUsage`,
    roles `title` / `summary` / `router`, `// P22 contract`); nothing is written ledger-side here
    (the orchestrator wires `recordCalls` at merge). Each job logs one coded line (`title_written`,
    `title_skipped`, `summary_written`, `summary_skipped`, `router_shadow`, `helper_job_failed`)
    with ids, codes, token counts and durations only; a Haiku price row is P22's, and until it
    exists a cost reads as null, never 0.

## Deviations from the plan (written reasons)

- **Counting happens in the turn too**, not only in the job: the window needs counts to keep H.
  Each text is counted once per process and family (LRU of 4,096 hashes, ours), so a turn counts
  only what is new (the new message, the last exchange, the fixed part when it changed). N-75's
  "count only above 0.8 × N-03 by estimate" cannot apply without the estimator.
- **History keeps tool calls and attachments** (not "text only"): dropping them would reopen the
  2026-09-25 entries in `mistakes.md` (follow-ups redid the work). The window counts the text and
  tool calls; attachments stay under the file budget.
- **Helper usage is not reserved or counted against the user's budget** in this package (the
  ledger is P22's; the wave plan says to persist nothing ledger-side).
- **No durable job queue** (N-76's worker / outbox is deferred): a job lost to a restart is not
  rerun; the next completed turn re-evaluates the trigger, and the title stays the placeholder.
- **Title in chat versions:** the job names only the chat whose first turn completed; a PATCH still
  renames the whole family.

## Consequences

- Long chats send a summary and the newest 6 turns instead of everything up to the window: the
  request shrinks from up to 1M tokens to about 48k. A long chat with large files must be checked
  live (checklist item 3).
- Every turn makes up to a few count calls (cached), on the chat model's family.
- Characterization snapshots changed only in their turn logs (the `history window` stage replaces
  the `compaction` stage; listed in `p13-result.md`).
