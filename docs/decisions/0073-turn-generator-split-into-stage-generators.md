# ADR-0073: The turn generator split into stage generators, behaviour-neutral

- Status: accepted (task tech-p05, 2026-10-16). Tested by typecheck, the characterization
  snapshots and the full backend suite after every step; not merged, not deployed.
- Date: 2026-10-16
- Task: tech-p05 = the rest of P05 in [`docs/ops/audit/NEW-PLAN.md`](../ops/audit/NEW-PLAN.md)
  (Stage 2 S2-4, RL2; D3 A-13, A-14 option A), planned in `docs/ops/build-3-explain.md` §2c.
- Supersedes: **only** the decision in [ADR-0067](0067-turn-code-split-by-stage.md) to keep `runTurn`
  as one generator ("Not done here, on purpose: `runTurn` still holds the stream loop, the forced
  answer and the settle step in one generator"). Everything else in ADR-0067 stands; ADR-0067 is
  not edited.
- Models used: Opus 5.5 (main, all writing); Opus 5.5 read-only reviewers (gate 0, R-A, R-B,
  security sub-task). No Sonnet helper and no Haiku runner was needed: main ran the suites.

## Claude

As in ADR-0067: Anthropic documents what a turn does (the tool-use loop a client drives, the SDK
tool runner, the Agent SDK's loop), not how its own turn service is laid out in modules. **There is
no Claude reference for this layout; the layout is ours** (D3 A-13 / A-14 option A).

## ArcNave before this change

`services/generation.ts` was 916 lines; `runTurn` was `generation.ts:142-915`, **774 lines**:
26 blocks, 21 yield sites, three nested `try`, about 17 mutable locals shared from the stream to
the settle step, and two closures (`releaseReservation`, the tool executors' pushes into
`segments` / `pendingUiEvents`) running while the generator was suspended. ADR-0067 kept it whole
because the 14 snapshots then did not reach stop, the deadline, compaction, the overflow retry,
`sources` / `code` / `ui_draft`, the forced-answer failures, the budget refusal or
`ModelNotFoundError`.

## Gap

Every later phase that edits the turn (P07, P08, P10, P11, P13, P15) would edit one 774-line
generator, and the risky paths had no snapshot. Ours to close, as in ADR-0067.

## Fix (ours)

Step 0 first, on the unsplit code: 22 new characterization scenarios
(`backend/src/test/turnCharacterizationPaths.integration.test.ts`) for the 16 paths of
`build-3-explain.md` §2c (18 scenarios: the forced answer has three), plus four from review gate 0 (`limitToModel` releasing the reservation, a
partial end, a refusal / non-retried failure with counters, a stop during the forced answer). Each
records the ordered side effects (`usage.reserve` / `release` / `record`, workspace create /
cleanup) interleaved with every yield, the terminal-frame count, the rows and the `turn_logs` row;
each was shown to fail with its branch broken (`docs/ops/p05-result.md`).

Then six steps, one commit each, mechanical moves only:

| Step | New | What moved (old `generation.ts` lines) |
|---|---|---|
| 1 | `turn/turnState.ts` (`TurnState`, `createTurnState`, `TurnLogOutcome`) | the locals at `:512-537`, same initial values; every use reads `state.<name>` |
| 2 | `turn/settle.ts` (`settleTurn`) | finalise, `saved` stage, `usage.record`, `debug` + `done` (`:834-894`) |
| 3 | `turn/forcedAnswer.ts` (`forcedAnswer`) | the forced answer (`:768-832`); returns the text runTurn kept in a local |
| 4 | `turn/streamAndCollect.ts` (`streamAndCollect`) | the stream loop, its catch and its `finally` release (`:539-763`); the error branch's `return` is `return true`, and runTurn returns on it |
| 5 | `turn/turnContext.ts` (`buildTurnContext`) | tools and routing to the request (`:297-510`), with `reservationHeld` and the release closure |
| 6 | `turn/prepareTurn.ts` (`prepareTurn`, `compactStage`) | preferences to the capability gates (`:164-272`), and the compaction (`:282-295`) |

The glue, all of it: `this.x` → `svc.x` (the same objects, built once in the constructor); a
stage's inputs arrive in one object and what later stages read is returned; every module that logs
creates `logger.child({ module: 'generation' })`; the `input` that runTurn reassigned when the
attachments came from the history is returned by `prepareTurn` and runTurn reassigns it from there
(the outer catch and finally read only ids, which the reassignment never changes); runTurn's
`try` body is re-indented (whitespace only).

What stayed in runTurn: the workspace, the turn log, `logOutcome`, the `start` yield, `addSegment`
(a closure over the state, passed to the stream and the forced answer), and the outer `try` /
`catch` / `finally` (timing, `turn_logs`, workspace cleanup) unchanged. `runTurn` is now
**`generation.ts:129-248`, 120 lines**; `generation.ts` **249 lines**.

### Why it is behaviour-neutral

1. `git diff <step 0> <step n> -- '*.snap'` is empty after every step (byte-identical snapshot
   files), and the tests pass without `-u`: both characterization files, 37 tests, including the
   ordered effects that pin yield order, release-before-record on the error path, record-before-
   `done` on the settle path, one terminal frame (zero after a stop), one workspace cleanup.
2. The full backend suite passes after every step with the step-0 count (`docs/ops/p05-result.md`).
3. Two fresh reviewers on the diff (R-A: every step a pure move; R-B: would a change be caught) and
   `/code-review` found no changed behaviour (`docs/ops/p05-review.md`).

## Consequences

- P08 (durable runs) can change the settle order in `settle.ts` and the stream in
  `streamAndCollect.ts`, and a snapshot diff now tells a move from a change. P07 edits
  `contextPrompt.ts` / `turnContext.ts`, P11 the stream's catch, P13 `compactStage`.
- Still not split, on purpose: `run` (the deadline) and the outer `try` / `catch` / `finally` of
  `runTurn`; `addSegment` stays a closure in runTurn. Nothing else is left to cut mechanically.
- Found, not fixed (behaviour-neutral task; logged in `docs/ops/audit/DEFERRED.md`, "tech-p05"):
  the reservation is kept when a step between `usage.reserve` and the stream throws outside
  `limitToModel`; the forced answer calls `provider.stream` without the retry wrapper, after the
  reservation was released; a stop or the deadline during the forced answer is saved as
  `empty_response`, not stopped; a failure after `start` outside the stream writes no usage row.
- Not protected by any scenario (`docs/ops/p05-review.md`): a stop or deadline during compaction, a
  deadline during the forced answer, a throw from `finalise` / `usage.record` after yields, the
  answer guard's tail flush, draft ids after earlier calls, the relative order of `finalise`
  against release / record, log text.
