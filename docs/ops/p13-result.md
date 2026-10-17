# P13 result — history budget, rolling summary, title and router-shadow jobs

Task: tech-p05 wave 2, NEW-PLAN P13. Branch `wave2/p13` (local, not pushed), base P08 head
`38882aa37fc2ac3bbf999d2667a80b33f5cb62b2` (`log -1` checked after the hard reset).
Decision: [ADR-0080](../decisions/0080-history-summary-and-helper-jobs.md) (ADR-0019 / ADR-0027
superseded for the compaction, ADR-0055 amended; each carries a note line). Live checklist:
[`p13-live-checklist.md`](p13-live-checklist.md). Migration `0032_history_summaries` (journal idx 31
in this branch, `when` 1792600000000; the orchestrator renumbers after P22's 0031). Model used:
Opus 5.5 (one agent, no sub-agents). Haiku 5.5 facts checked with the `claude-api` skill and the
installed SDK types (`@anthropic-ai/sdk` 0.126: `OutputConfig.format`, `ThinkingConfigDisabled`).

## DONE / SKIP

| Brief item | State | Where |
|---|---|---|
| 0 Haiku 5.5 helper row (`role: 'helper'`), `MODEL_HAIKU`, spec (`knowledgeCutoff: null`, `thinkingOff: 'disabled'`), `GenerationRequest.thinking?: 'off'` (refused unless the spec allows), `complete()` / `classify()` (structured output), no helper fallback, no `cache_control` | DONE | `providers/registry.ts`, `capabilitiesTable.ts`, `types.ts`, `anthropic.ts`, `services/helpers/helperCall.ts` |
| 1 `summaries` table, branch-path checks, copy on branch with `idFor` remap | DONE | `db/schema.ts` (`// --- P13`), `drizzle/0032_*`, `services/summary/summaryStore.ts`, `routes/chats.ts` `copyMessages` |
| 2 60 % trigger job after settle (count API, no estimator), ≤ 30k in / 1,200 out / 60 s, HP-SUM, thinking off, failure leaves history whole | DONE | `services/summary/summaryJob.ts`, `prompts/helpers/summary-v1.md`, hook in `turn/settle.ts` |
| 2 N-75 local estimate | SKIP (OQ-08 owner item) | — |
| 3 Summary + last 6 turns, `<earlier_conversation_summary covers_upto version>` escaped | DONE | `turn/prepareTurn.ts`, `turn/contextPrompt.ts`, `prompt/sessionState.ts` |
| 4 Normal budget 48k (N-03); profiles | DONE (Normal only); profiles = P10 | `config/numbers.ts` |
| 5 HIST-WINDOW (≤ 6, within H, floor 2) + ours "drop older than 6 only once covered" (`HISTORY_KEEP_UNCOVERED`, default true) | DONE; ours = OWNER ITEM | `services/summary/historyWindow.ts`, `turnWindow.ts`, one call in `turn/turnContext.ts` |
| 6 STAMPS (+ ours `ctx_fixed_tokens`), `registry_version` null | DONE | `messages` columns, `turnWindow.ts` |
| 7 REC text + renderer (not wired) | DONE | `prompts/system/recovery/continue-v1.md`, `helpers/helperPrompts.ts` `renderRecovery` |
| 8 Title job, `chats.title_source`, CAS, rename wins; frontend refetch (picked over an SSE frame: the job runs after `done`) | DONE | `services/helpers/titleJob.ts`, `turn/turnStart.ts`, `routes/chats.ts` PATCH, `arcnave-frontend/src/workspace.tsx` |
| 9 Router M2 shadow, `ROUTER_SHADOW` off, never awaited, one coded log line | DONE | `services/routing/routerShadow.ts`, hook in `turn/prepareTurn.ts` |
| 9 Intent enum | SKIP (OWNER ITEM); placeholder marked ours | `ROUTER_INTENTS` |
| 10 OQ-09: `ENABLE_HISTORY_SUMMARY` default true; compaction off while it is on | DONE | `config.ts` (`loadConfig`) |
| Helper usage as the P22 `CallUsage` shape, coded log with token counts, nothing ledger-side | DONE | `HelperCallUsage` (`// P22 contract`), `helpers/helperJobs.ts` |

## Evidence per exit test

`backend/src/routes/historySummary.integration.test.ts` (fake provider + fake count API + helper
fake in `harness.ts`): **23 tests, green 3 times** (once alone, twice together with both
characterization files: 60/60 each).

| Exit test | Test | Result |
|---|---|---|
| below trigger → no row | `writes no row below the trigger` (six marked exchanges = 27,000 < 28,200; a short chat logs `below_trigger`) | pass |
| above trigger → one row covering exactly the uncovered turns minus the last 6 | `above the trigger writes one row …` (v1 covers seq 1; the helper input holds Q1, not Q2; 1,200 tokens, thinking off) | pass |
| next request carries escaped summary + 6 turns; stamps | `the next request carries …` (history = Q2–Q7, `covers_upto="1" version="1"`, `&lt;b>`; stamps `history_turns` 6, `summary_version` 1, `ctx_count_source` provider, `ctx_fixed_tokens` 1,000, `prompt_version` 12 hex; v2's input led by v1, escaped) | pass |
| branch: valid only up to the fork; fork inside the covered range does not use it | `a branch keeps a summary only up to the fork …` (fork at seq 2 copies v1 only, id remapped; fork at seq 0 copies none) + `a summary whose message is not in this chat …` | pass |
| count / job failure leaves history whole | `a failed or cut summary call writes nothing …` (helper error; `max_tokens` → `truncated`; count API down → `count_unavailable`; all 8 earlier turns still sent; stamps `none` / null) | pass |
| title set once; rename wins (CAS race) | `names the chat once …` (a regenerate and a 2nd turn do not rename), `a rename wins the race …` (job gated, PATCH lands, `title_skipped renamed`), `cleans what the model wrote …` | pass |
| ROUTER_SHADOW on → one log line + unchanged model; off → zero classify calls | `off: zero classify calls`; `on: one coded log line, never awaited …` (`done` arrives while the router is gated; `ok`, intent `chat`, tier `quality` from `"Chat"` / `"QUALITY"`; both answers stay Gemini); `matches an enum …` | pass |
| table-driven HIST-WINDOW | 5 budget rows (stage cap 6, ours keeps uncovered, drop to fit, floor 2 + `over_budget`, one exchange alone) + 2 rows (blocked, empty exchange out) + a no-count row | pass |
| helper unavailable → skip with code, no substitution | `without a helper model …` (`MODEL_HAIKU=''`: zero helper calls, 7 chat requests for 7 turns, `helper_unavailable` on both jobs) | pass |
| content-leak check on job log lines | `no log line of any job carries …` (a sentinel in prompts, answers, summary and title is absent from every captured line; every line has a `code`) | pass |

Mutation checks (recorded, reverted): removing the title CAS on `title_source = 'prompt'` fails
`a rename wins the race`; removing the summary's message-chat check and the branch copy's
`covers_upto_message_id IN kept` filter fails the branch and foreign-row tests.

Unit tests added: `providers/registry.test.ts` (helper row out of aliases / statuses / Auto;
`anthropic_not_configured`, `not_configured`, `probe_failed`), `providers/capabilitiesTable.test.ts`
(thinking off only on Haiku), frontend `src/titleRefresh.test.ts` (3).

## Gates (tree diff hash `3820af92…` equal before and after the final run)

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `cd backend && npx tsc --noEmit` | clean |
| Backend suite, run 1 | `TEST_DATABASE_URL=…/arcnave_test_p13 npx vitest run` | 149 files, 1 failed / 1,687 passed / 23 skipped: `gatewayTurn` "Auto with 600k characters … keeps the earliest turn" — the N-03 budget dropped the oldest turn (by design). The test now checks its subject, the D2 X-2 character backstop, with the count API down: 7/7 |
| Backend suite, final | same | **1,687 passed, 23 skipped, 1 failed**: `filePipeline.integration` parity test at its fixed 20 s timeout under parallel load (P22 / P11 suites ran at the same time; load average ~4). Rerun alone twice: **16/16, 16/16** (mistakes.md 2026-10-16: a timeout under parallel load is not a result) |
| Exit test + snapshots, twice | `npx vitest run src/test/turnCharacterization*.ts src/routes/historySummary.integration.test.ts` | 60/60 ×2 |
| Migrations on an empty DB | `DATABASE_URL=…/arcnave_mig_p13 npm run db:migrate` | `migrations applied`; `\d summaries` shows both uniques, the 6,000 CHECK and both FKs |
| OpenAPI | `npm run openapi` | `docs/openapi.json` unchanged (no route schema changed) |
| Frontend | `npx tsc -b` / `npx vite build` / `npx vitest run` | clean / built (chunk-size warning as before) / **46 files, 431 passed** |

## Characterization snapshots re-recorded (`-u`, one file)

`src/test/__snapshots__/turnCharacterizationPaths.integration.test.ts.snap`, 18 entries. Every diff
line is in the stored turn log: the `compaction | compacted: false` stage is gone (compaction off
while the summary is on), a `history window` stage appears (exchanges / kept / dropped / ctxTokens /
countSource / overBudget / summaryVersion), later stage numbers shift by one, and the timing JSON
loses `before_compaction` / `compaction` / `compacted`. No frame, row, request or counter changed.
Entries (3) and (12) (compaction) now run on their own app with `ENABLE_HISTORY_SUMMARY=false` and
are byte-identical to before. `turnCharacterization.integration` did not change.

Tests changed to keep testing the compaction one release behind its flag: `longChat` (its app runs
with `ENABLE_HISTORY_SUMMARY=false`), `toolHistory` (two compaction tests on their own app),
`turnCharacterizationPaths` (3), (12); `gatewayTurn` X-2 as above.

## OWNER ITEMS

1. Ours: `HISTORY_KEEP_UNCOVERED` (default true) — turns older than 6 are kept until a summary
   covers them; the stage says they go unsent. Confirm, or set false.
2. Router intent enum: none is written in the stages; `ROUTER_INTENTS` is a placeholder (ours).
3. OQ-08: N-75's local estimator not built; counting is the provider count API on every turn
   (cached per text).
4. Ours, no N-id: count cache 4,096 entries; router input cut at 4,000 characters; frontend title
   re-read at 3 s and 10 s; the `ctx_fixed_tokens` stamp.
5. Helper spend is not reserved against or counted in the user's budget until P22's ledger is wired.
6. Live: `ENABLE_CONTEXT_COMPACTION=true` on the service is ignored while the summary is on.

## Deviations (also in ADR-0080)

Counting inside the turn (the window needs H); the history keeps tool calls and attachments (not
"text only"); no durable job queue (N-76 worker deferred); the title job names only its own chat
(a PATCH still renames the family).

## Mistakes made in this task

1. A second test app (`createTestApp`) re-points the process-wide `setDb` handle; closing it left
   the main app's later tests on a closed pool (the `ask_user_input_v0` replay test failed only
   after the new compaction test ran). Rule: a test that opens and closes a second app restores
   `setDb(main.db, main.sql)` afterwards.
2. A comment naming two chat models in `providers/types.ts` tripped `brandNeutral` (model names
   only in the provider files). Caught by the test.

## For the orchestrator (proposed lines; not written by this agent)

- **mistakes.md** (changelog, no new heading): "2026-10-17 (tech-p05 P13) — A second
  `createTestApp` in a test file re-pointed the process-wide db handle (`setDb`); after it closed,
  the file's main app ran on a closed pool and an unrelated later test failed only in sequence.
  Rule: a test that opens a second app restores `setDb(main.db, main.sql)` when it closes it.
  Verify: `npx vitest run src/routes/toolHistory.integration.test.ts` 7/7."
- **CURRENT.md**: "P13 (ADR-0080) on `wave2/p13`: Haiku 5.5 helper row; `summaries` (0032) with the
  N-77 job after settle; N-03 48k history window + stamps; title job with `title_source` CAS; router
  M2 shadow (off). `ENABLE_HISTORY_SUMMARY` on by default retires the compaction behind its flag.
  Not deployed."
- **DEFERRED.md**: close CXD-5, CXD-6 (Normal), HIST-WINDOW, STAMPS, REC (text), HP-TITLE, RT-2
  (shadow). Add: Fast / Deep profiles (P10); router intent enum (owner); N-75 estimator (OQ-08);
  wire `HelperCallUsage` to `ledger.recordCalls` + Haiku price row (P22 merge); REC wiring
  (P11 / P15); delete the compaction code one release after the switch; a durable queue for helper
  jobs (N-76 worker).
