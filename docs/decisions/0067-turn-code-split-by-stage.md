# ADR-0067: The turn code split by stage, behaviour-neutral

- Status: accepted (task tech-build.3 Part C, 2026-10-16). Tested by typecheck, characterization
  snapshots and the full backend suite; not deployed. The live checks are in
  `docs/ops/build-3-result.md`.
- Date: 2026-10-16
- Task: tech-build.3 Part C = P05 of [`docs/ops/audit/NEW-PLAN.md`](../ops/audit/NEW-PLAN.md)
  (Stage 2 S2-4, RL2; D3 A-13, A-14 option A).
- Supersedes: nothing. Keeps every earlier ADR: no behaviour changes here.
- Models used: Opus 5.5 (this worker).

Sources read for this ADR (2026-10-16, fetched, not from memory):

- Claude docs, How tool use works — https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works
- Claude docs, Build a tool-using agent — https://platform.claude.com/docs/en/agents-and-tools/tool-use/build-a-tool-using-agent
- Claude docs, Tool runner (SDK) — https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner
- Claude docs, How the agent loop works (Agent SDK) — https://platform.claude.com/docs/en/agent-sdk/agent-loop

## Claude

Anthropic documents what a turn does, not how its own servers lay the code out. The pages above
describe the loop a client drives (a `tool_use` stop reason, the tools run, the results sent back
in a new request, until `end_turn` or `max_tokens`), the SDK's tool runner that automates it, and
the server-side loop of server tools. None of them, nor anything else found on
platform.claude.com, docs.anthropic.com or support.claude.com, describes how claude.ai's turn
service is divided into modules. **There is no Claude reference for this layout; the layout is
ours** (D3 A-13 / A-14 option A, picked by the audit).

## ArcNave before this change

- `backend/src/services/generation.ts` was 2,458 lines: one `GenerationService` class whose
  `runTurn` generator ran from line 426 to 1292, plus 17 private methods (history, attachments,
  model resolution, the retry loop, the system prompt, persistence) and the free helpers.
- `backend/src/routes/chats.ts` was 1,240 lines; the generate route checked one-run-per-chat,
  called `appendTurn` / `resetForRetry` (lines 1085-1240, including the file-count rule), read the
  turn's attachments with the ownership filter, and closed out a failed row inline.

## Gap

Every later phase (P07, P08, P10, P11, P13, P15) edits this code. In one file every change risks
the money path, and turn-start SQL lived in a route. Nothing differs from Claude here, because
Claude publishes nothing to differ from; the gap is ours to close.

## Fix (ours)

Mechanical moves only: functions and methods cut and pasted, with the minimum glue. No logic,
no ordering, no SQL, no transaction boundary, no error and no status code changed.

| File | Stage | What it holds |
| --- | --- | --- |
| `services/generation.ts` (914 lines) | orchestration | `GenerationService`: constructor, `run` (the turn deadline), `runTurn` (the turn generator, still one generator: it owns the turn's shared state) and a re-export of every name the file exported before |
| `services/turn/services.ts` | — | `TurnServices`: what the stage functions read in place of `this` |
| `services/turn/events.ts` | — | the SSE event shapes and DTOs (`StreamEvent`, `toUsageDto`, `toSourceDto`, `computeCostFor`, `presentedFiles`) |
| `services/turn/input.ts` | — | `GenerateInput`, `AgentLoopInput`, `PreferencesRow` |
| `services/turn/context.ts` | context build 1 | preferences, project, history (`loadHistory`), compaction before the turn, the previous request's size |
| `services/turn/contextAttachments.ts` | context build 2 | attachment hydration, history byte budget, model limits, the chat's file list, Office files read with code |
| `services/turn/contextPrompt.ts` | context build 3 | the skills context (`buildSkillsContext`, cut from `runTurn`) and the system instruction |
| `services/turn/modelRouting.ts` | routing | `resolveModel`, the chat's sticky model, the routing tier |
| `services/turn/toolset.ts` | tools | `buildToolExecutors` (cut from `runTurn`; D3's "buildToolset") |
| `services/turn/providerLoop.ts` | provider loop | `streamWithRetry` (Stage 15 retry gate), overflow recovery, `FailedAfterToolRun`, `mapProviderError`, `refusalError`, `retryDelayMs`, `visualDrafts` |
| `services/turn/persistence.ts` | persistence | `persistEvent`, `persistToolCall`, `finalise` |
| `services/turn/turnStart.ts` | turn start | `loadChat` (chat ownership, used by every chat route), `startTurn` (one run per chat, then append or retry), `appendTurn` (file rules, N-10 per-chat count under the row lock), `resetForRetry`, `loadTurnAttachments` (file ownership), `markTurnFailed` |

The glue, all of it:

- A method that left the class takes `svc: TurnServices` first, and `this.x` became `svc.x` in its
  body; every call `this.m(...)` became `m(this.svc, ...)`. The class builds `this.svc` once in
  its constructor from the same values its fields hold.
- The private `reduceHistoryForOverflow` method only delegated to the exported function of the
  same name; the retry loop now calls the function directly.
- `runTurn` has a local `previousContextTokens`, so the moved function is imported as
  `previousContextTokensOf` there (a `const` cannot call a function of its own name).
- Two blocks of `runTurn` became functions with their inputs passed in and their results
  returned: the skills context and the tool executors. Neither awaits anything new; the tool
  block has no await at all. Because the tool executors take the answer's `segments` (a visual
  joins the timeline), its declaration (an empty array, no side effect) moved up above them.
- `isTurnDeadline` is now exported from `providerLoop.ts` (it was file-private).
- The route's turn start became `startTurn`, `loadTurnAttachments` and `markTurnFailed` calls;
  their bodies are the route's lines, with `user.id` / `assistantMessageId` / `body.code` /
  `request.log` passed as parameters. `loadChat`, `appendTurn` and `resetForRetry` are unchanged
  but for their `request` parameter type, narrowed to the services they read.
- Every moved module that logs creates the same `logger.child({ module: 'generation' })`, so log
  lines carry the module tag they had.

Not done here, on purpose: `runTurn` still holds the stream loop, the forced answer and the
settle step in one generator (D3's `streamAndCollect` / `settleTurn`). They share about fifteen
mutable locals; cutting them apart is not a mechanical move, and P07/P08 change that code anyway.

### Proof

1. `backend/src/test/turnCharacterization.integration.test.ts` was committed alone, with its
   snapshot, on the unsplit code (commit A). It records, normalising only ids, storage keys,
   timestamps and the date line: every provider request the fake provider received, the real
   Gemini and Claude adapters' SDK calls (fake clients), every SSE frame and every row the turn
   wrote, for plain chat, files, a tool loop, a forced answer, a retried call, a partial end after
   a tool ran, a refusal, a provider error, a turn blocked before the stream, a regenerated reply
   and the turn-start refusals (404, 409, 422).
2. The split (commit B) changes no snapshot: `git diff A B -- '*.snap'` is empty, and the tests
   pass without `-u`.
3. The full backend suite passes with no test edited.

## Consequences

- Old import paths keep working: every name `services/generation.ts` exported is re-exported.
- A change to one stage now edits one file. P07 (prompt) edits `contextPrompt.ts`, P08 (turn
  rows, executor) `turnStart.ts` and `persistence.ts`.
- Found, not fixed (no logic change here): a message with several files lists them in the
  database's row order, because `loadTurnAttachments`' query has no `ORDER BY`. Logged for
  DEFERRED in the wip file.

## Post-split fix (review R1#2, separate from the moves)

A behaviour change, made after the split and kept out of it: `resetForRetry`
(`services/turn/turnStart.ts`) now deletes the message's `tool_calls` with its sources and
research events. `persistToolCall` inserts with `onConflictDoNothing` on
`uq_tool_call_ordinal (message_id, ordinal)`, so a regenerated reply that ran tools kept the old
attempt's calls, dropped the new attempt's, and `loadHistory` replayed the stale calls (and
Gemini thought signatures) on later turns. Nothing references a `tool_calls` row: no foreign key
points at the table; the message's `segments` that name tool call ids are cleared by the same
reset; display blocks (`display_<toolCallId>`) are rebuilt from the rows themselves; artifacts
are keyed by chat and presented files by message, never by tool call. Test:
`routes/regenerateToolCalls.integration.test.ts` (fails without the delete). The characterization
snapshots are unchanged (their regenerate scenario runs no tool).
