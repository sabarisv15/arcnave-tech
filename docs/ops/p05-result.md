# P05 result — `runTurn` split, proved by characterization snapshots (task tech-p05)

Branch `build/turn-split`, cut from `origin/main` at `cb30c94` (PR #43 merge); `git merge-base HEAD
origin/main` was HEAD at the start. Main session: Opus 5.5. Behaviour-neutral: mechanical moves
only; every oddity found goes to `DEFERRED.md`.

## Step 0 — the missing scenarios, on the unsplit code

Commit: STEP0 (sha in the table at the end).

- New file `backend/src/test/turnCharacterizationPaths.integration.test.ts` with its own snapshot
  `backend/src/test/__snapshots__/turnCharacterizationPaths.integration.test.ts.snap`: the same
  mechanism as the first 14 (`toMatchSnapshot`, the same normaliser, a "long texts" entry by
  sha256).
- The normaliser, `AttemptsProvider` and the helpers moved unchanged from
  `turnCharacterization.integration.test.ts` into `backend/src/test/turnSnapshot.ts`, shared by
  both files. The first file's `.snap` did not change with the move (`git status` showed no change
  to it; its 14 tests pass without `-u`).
- Each new scenario snapshots: the provider requests, the SSE frames, the rows
  (`messages` with status / error code / finish reason (`partial` is the finish reason
  `partial` plus `partial_after_tool_run`) / segments, `tool_calls`, `research_events`,
  `usage_records`, `message_sources`), the `turn_logs` row line by line, and:
  - `effects`: `usage.reserve` / `usage.release` / `usage.record <status>`, workspace create and
    cleanup, interleaved in order with every `yield <type>` of the turn generator (spies on the
    app's own `UsageService`, `ExecutionRuntime` and `GenerationService.run` instances; each calls
    through);
  - `counts`: terminal frames (`done` + `error`) per response, `reserve`, `release`, `record`,
    `workspaceCreate`, `workspaceCleanup`. `release` counts `usage.release`, the effect of
    `releaseReservation` (the closure is idempotent: it acts once, so a second call has no effect
    to count).
- Normalised, besides what the first file's normaliser replaces: stage times, the timing summary's
  milliseconds and the error stack in the turn log (the stack's file:line numbers move with any
  move of code, so a pure move would otherwise change the snapshot), a visual's random block id
  (`blk_…` → `<block-n>`), and the `runId: <chatId>_<messageId>` line (the `_` hides both UUIDs
  from the `\b`-bounded pattern). Stage names, their order, every fact a stage logs, the timing
  phase names and their order are kept.
- Each scenario also asserts the one thing its path exists for (a `ui_block` frame, no `done`
  after a stop, the `<project_knowledge>` block, ...).
- Run three times in a row with the first file, all green each time (the mistakes.md rule: a
  first run passed, the second failed on the random visual block id; fixed by the numbering above
  before the commit).

### The 16 paths

| # | Scenario | Path in `runTurn` (unsplit, `generation.ts`) |
|---|---|---|
| 1 | stop mid-stream | `:713-714` cancelled, `:842-844`, no `done` at `:876` |
| 2 | turn deadline | `:696`, `:716-759` |
| 3 | compaction + reload | `:283-295` |
| 4 | context-overflow retry | `turn/providerLoop.ts:90-112` |
| 5 | `sources` + searchEntryPoint | `:574-584` |
| 6 | `code` | `:586-593` |
| 7 | `ui_draft` + pending UI drain | `:595-606`, `:651-653` |
| 8a / 8b / 8c | forced answer: `tool_protocol_in_text` / request fails / empty | `:810-818`, `:820-831` |
| 9 | `ModelNotFoundError` | `:693-695` |
| 10 | budget refusal at `usage.reserve` | `:392` |
| 11 | project chat past the whole-file limit | `<project_knowledge>`, `search_project_files` through the project executor |
| 12 | skills read, given back after a compaction | `:345-353`, `:878` |
| 13 | non-empty context events | `:365-368`, `:528` |
| 14 | a turn with `effort` | `:383-387`, `:494`, `:891` |
| 15 | no adapter | `:225-230` |
| 16 | search / research without grounding | `:237-247` |

`max_tokens` and `pause_turn` have no branch in `runTurn`: no scenario for them.

### Proof that each scenario covers its path

Script: a scratch copy of `backend/` (hardlinked `node_modules`, its own database
`arcnave_test_proof`); each proof replaces one exact text (it must occur once), runs only that
scenario (`npx vitest run src/test/turnCharacterizationPaths.integration.test.ts -t '<id>'`),
and restores the file. First a control per scenario with nothing broken: **18 of 18 passed
(exit 0)**. Then the breaks: **22 of 22 failed**. The last column is the first line the broken run
changed (a snapshot diff line, `-` expected / `+` received, or the scenario's own assertion).

| Proof | Broken | Result | First failure |
|---|---|---|---|
| 1 | the stop branch does not set status cancelled | exit 1, 1 failed / 18 skipped (19) | `AssertionError: expected [ 'start', 'thinking', 'delta', …(2) ] to not include 'done'` |
| 1-release | the stream's finally does not release the reservation | exit 1, 1 failed / 18 skipped (19) | `-     "release": 1,` |
| 1-cleanup | the outer finally does not clean the workspace | exit 1, 1 failed / 18 skipped (19) | `-     "workspaceCleanup": 1,` |
| 2 | the deadline is not recognised | exit 1, 1 failed / 18 skipped (19) | `-     "code": "turn_deadline_exceeded",` |
| 3 | the history is not reloaded after a compaction | exit 1, 1 failed / 18 skipped (19) | `+           "text": "Turn 1",` |
| 4 | the overflow retry does not retry | exit 1, 1 failed / 18 skipped (19) | `AssertionError: expected 'error' to be 'done' // Object.is equality` |
| 5 | the sources event is not yielded | exit 1, 1 failed / 18 skipped (19) | `AssertionError: expected [ 'start', 'delta', 'debug', 'done' ] to include 'sources'` |
| 6 | the code event is not yielded | exit 1, 1 failed / 18 skipped (19) | `- 2` |
| 7-draft | the ui_draft event is not yielded | exit 1, 1 failed / 18 skipped (19) | `AssertionError: expected [ 'start', 'tool_use', …(5) ] to include 'ui_draft'` |
| 7-drain | the pending UI events are not drained | exit 1, 1 failed / 18 skipped (19) | `AssertionError: expected [ 'start', 'ui_draft', …(7) ] to include 'ui_block'` |
| 8a | the forced answer's tool_protocol_in_text branch is skipped | exit 1, 1 failed / 18 skipped (19) | `-     "code": "tool_protocol_in_text",` |
| 8b | the forced answer's failure is not caught | exit 1, 1 failed / 18 skipped (19) | `-     "code": "empty_response",` |
| 8c | the empty_response branch is skipped | exit 1, 1 failed / 18 skipped (19) | `-     "code": "empty_response",` |
| 9 | ModelNotFoundError does not mark the model unavailable | exit 1, 1 failed / 18 skipped (19) | `- false` |
| 10 | a budget refusal at reserve is swallowed | exit 1, 1 failed / 18 skipped (19) | `-     "code": "budget_exceeded",` |
| 11 | the project is not given to the tool executors | exit 1, 1 failed / 18 skipped (19) | `-   "ok": true,` |
| 12 | the skills read are not reported | exit 1, 1 failed / 18 skipped (19) | `-     "loadedSkills": [` |
| 13 | the context events are not yielded | exit 1, 1 failed / 18 skipped (19) | `AssertionError: expected undefined to match object { Object (event) }` |
| 13-ordinal | tool calls are numbered from 0, not after the context events | exit 1, 1 failed / 18 skipped (19) | `-         "ordinal": 1,` |
| 14 | the turn's effort is ignored | exit 1, 1 failed / 18 skipped (19) | `-       "reasoningEffort": "max",` |
| 15 | no adapter does not refuse | exit 1, 1 failed / 18 skipped (19) | `-     "code": "model_unavailable",` |
| 16 | search without grounding is not refused | exit 1, 1 failed / 18 skipped (19) | `-     "code": "capability_unavailable",` |

