# P05 review — `runTurn` split (task tech-p05)

Branch `build/turn-split`; reviewed range `b448929..8524b64` (STEP0 = the step-0 tests after review
gate 0; HEAD = step 6). ADR-0068 step 5 (code review after every big prompt). Main re-opened every
cited file:line before accepting or rejecting a finding.

## Commands

All started together after step 6:

| Reviewer | How | Given |
|---|---|---|
| `/code-review` | skill, `b448929..HEAD high` (forked) | the diff |
| `/security-review` | skill (after `git remote set-head origin main`, which it needs); one Opus read-only sub-task, confidence ≥ 8 kept | the branch against `origin/main` |
| R-A | fresh Opus 5.5 background agent, Read / Grep / Glob only | the pre-split `generation.ts`, the new files, CLAUDE.md invariants, ADR-0067: "is every step a pure move?" |
| R-B | fresh Opus 5.5 background agent, Read / Grep / Glob only | `git diff b448929..HEAD`, the pre-split file, the snapshot tests, invariants, ADR-0067: "would a behaviour change be caught? which paths are unprotected?" |

Before them, review gate 0 (one fresh Opus 5.5 read-only agent on the step-0 tests): see
`docs/ops/p05-result.md` "Review gate 0" — 0 BLOCKER, 2 MAJOR (both fixed by new scenarios before
any split commit), 6 MINOR.

## Round 1 (the only round)

| Reviewer | BLOCKER | MAJOR | MINOR | NIT | Changed behaviour found in the split |
|---|---|---|---|---|---|
| `/code-review` | 0 | 0 introduced (1 pre-existing) | 4 | 5 | none ("the refactor itself is faithful") |
| `/security-review` | 0 | 0 | 0 | 0 | none (every log call, `userId` / `projectId` source and gate checked) |
| R-A | 0 | 0 | 1 (pre-existing) | 2 | none ("every step is a pure move") |
| R-B | 0 | 0 | coverage gaps only (finding 8), none introduced | 0 | none; every gap is code moved verbatim |

Severities for `/code-review` are main's (the skill does not rate): the reservation leak is the
only one that would be MAJOR, and it predates the split.

### Findings and outcome

| # | Finding | From | Severity | Main's check | Outcome |
|---|---|---|---|---|---|
| 1 | A throw between `usage.reserve` and the stream outside `limitToModel` keeps the reservation (`turn/turnContext.ts:167`, `:180-260`; old `generation.ts:392-510`) | `/code-review`, R-A, R-B, gate 0 | MAJOR, pre-existing | confirmed by reading old and new; the split moved it verbatim | **deferred** (DEFERRED.md "tech-p05"; fixing it is a behaviour change, out of a behaviour-neutral task) |
| 2 | ADR-0073 cited in six new files but missing; ADR-0067 says the stream, forced answer and settle were not split | `/code-review`, R-A, R-B | MINOR | confirmed | **fixed**: ADR-0073 written (supersedes only that decision of ADR-0067; ADR-0067 not edited) |
| 3 | A stop or deadline during the forced answer is saved as `empty_response` | `/code-review` | MINOR, pre-existing | confirmed; pinned by scenario (8d) | **deferred** |
| 4 | The forced answer calls `provider.stream` without the retry wrapper, after the reservation was released | `/code-review` | MINOR, pre-existing | confirmed (`turn/forcedAnswer.ts:48`, `streamAndCollect.ts:274-276`); the brief named it | **deferred** |
| 5 | `AnswerProtocolGuard.finish()` keeps `codeDelimiter`, hiding `[Tool call]` in the forced answer | `/code-review` | — | not reachable: the forced answer runs only when the collected text trims empty, and a fence character is always in that text (`answerProtocolGuard.ts:14`, `:34-37`); R-B reached the same conclusion | **rejected** |
| 6 | Module load order changes (`ui/validator.js` now loads via `streamAndCollect.ts`) | R-A | NIT | the set of modules is the same; none does order-dependent work at load; the full suite passes | **rejected** (no effect) |
| 7 | `addSegment` and the tail flush could live in `turnState.ts`; `forcedAnswer`'s `text` parameter is derivable; `listSkills` computed twice; history and current hydration could run in parallel; the project row type is written out three times | `/code-review` | NIT | true; none is a move (#4 changes timing) | **deferred** as cleanups (DEFERRED.md) |
| 8 | Unprotected paths: stop / deadline during compaction; deadline during the forced answer; a throw from `finalise` / `usage.record` / `persist*` after yields; answer-guard tail flush; draft ids after earlier calls; `finalise` order against release / record; consumer `.return()` mid-stream; `isAbort` without an abort; deadline with a partial end; log text; `buildToolExecutors` reading the pre-compaction history (it reads the reloaded one, as before) | R-B | MINOR each | confirmed; in each the moved text equals the old (R-A, R-B both checked token by token) | **deferred** (listed in DEFERRED.md and ADR-0073 as not protected) |

No BLOCKER or MAJOR against the split itself, so no code changed after round 1 and no second round
was needed (the rule asks for another round after fixes). The only change after round 1 is
documentation (ADR-0073, DEFERRED, this file, p05-result, mistakes, CURRENT).

## Covering tests

- Both characterization files, unchanged snapshots after every step:
  `backend/src/test/turnCharacterization.integration.test.ts` (14) and
  `backend/src/test/turnCharacterizationPaths.integration.test.ts` (23, of them 22 scenarios).
- The full backend suite after every step (`docs/ops/p05-result.md`).

## Final state

0 BLOCKER, 0 MAJOR open against the split. One pre-existing MAJOR (finding 1) deferred with its
phase (P08).

---

# P05 waves 1–3 review, round 1 (ADR-0068) — branch `build/turn-jobs`

Reviewed at `2c50e34` (waves 1–3: durable turns, ledger, helper jobs, error matrix, module
boundaries). Fixes in one commit on top ("fix(p05): review round 1 — …"; its sha is in the git log
and the final report). Worker model: Opus 5.5.

## Reviewers

| Reviewer | Result |
|---|---|
| `/code-review` skill | 10 findings (R1, R4–R10 and the two MINOR skips below; severities main's) |
| `/security-review` skill | 0 vulnerabilities at confidence ≥ 8 (no candidate reached the filter step). Checked: generate / stream / stop ownership (`loadChat`, turn ids never taken from the request, reattach only for `run.userId`, snapshot frames by the turn's own ids, 60 s session re-check, numeric `Last-Event-ID`); Idempotency-Key scoped to (user, key, endpoint) with a chat + body fingerprint; `PUT /chats/:id/active-version`, regenerate / fork attachment ownership, `copyMessages` / `copySummaries` from the caller's chat; deletion-ledger keys server-built, regex without `..`, prefix unreachable by `deleteOwned`, no new route taking a storage key; account delete still password-gated, export per user; memory / chat search user filters unchanged; `last_seen_at` throttle only; `/v1/status` returns only the ops banner; body limits only cap; SSE headers from the CORS / security plugins; logs ids / codes only; no hard-coded keys; no new `dangerouslySetInnerHTML` / `innerHTML` / `eval`. |
| Independent Opus 5.5 reviewer (read-only) | 0 BLOCKER / 3 MAJOR (R1 breaker settle, R2 budget on retries, R3 lock order; R1 and R3 reproduced) / 3 MINOR (R7 stream gap, the cold-cache count burst, R4 sweeper clock). R4 is MAJOR here because `/code-review` rated it so (a skewed instance interrupts healthy turns); the independent reviewer rated it MINOR. |

Every finding was re-checked against the code before it was fixed (file:line in the table).

## Findings

Mutation proof = the fix reverted (`git stash push -- <files>` or the hunk removed), the new test
run alone, the failing line recorded, the fix re-applied, the test passing.

| # | Finding (verified at) | Verdict | Commit | Mutation proof (fix reverted → failure; fix → pass) |
|---|---|---|---|---|
| R1 | MAJOR. `gateway.ts` `call`: an attempt's admission was settled only on normal end or in `catch`; a consumer that stops iterating (refusal → `refusalError`, a failed tool-call write) closes the generator with `return()`, so a half-open trial stayed in flight → `breaker_open` until restart. Confirmed: neither line runs on `return()`. | **fixed**: `finally { admission?.release() }` per attempt (the breaker settles an admission once, so it is a no-op after `success`/`failure`) | this | `npx vitest run src/providers/gatewayAdmission.test.ts` → `AssertionError: expected { ok: false, reason: 'breaker_open' } to deeply equal { ok: true }`; fixed: 1 passed |
| R2 | MAJOR. `usage.ts record`: one `exact:false` call (a 503 retry, a hop) zeroes the turn (`usageFromCalls`), and `commitTokens` was skipped at `total > 0` → the counter charged 0. Confirmed. | **fixed**: the counter commits the sum of the exact calls' tokens (enforcement); the turn row stays `exact:false` zeros (display, Invariant 3). A no-count call adds nothing (no exact zero, no estimate). | this | `npx vitest run src/routes/fallback.integration.test.ts -t "503 then success"` → `AssertionError: expected +0 to be 12`; fixed: 1 passed |
| R3 | MAJOR. Lock order: `settleTurnTx` locked the turn, then reached the chat (step 8 update, FK key-share); `startTurn` locks root → chat → turn. Confirmed and reproduced in the test (40P01). `startTurn` had no retry; 40P01 / 40001 were 500. | **fixed**: `lockChatFamily` (root, then chat) first in every settle; the sweeper selects unlocked, then chat `SKIP LOCKED`, then turn `SKIP LOCKED`; `startTurn` retried whole ≤ `DB_TX_MAX_RETRIES` (N-45) on 40001/40P01; both added to `DB_UNAVAILABLE_CODES` (503 `unavailable`, `Retry-After: 5`) | this | `npx vitest run src/services/turn/turnSettle.integration.test.ts` with the settle lock and the `app.ts` codes reverted → `AssertionError: expected [ 'ok', '40P01' ] to deeply equal [ 'ok', 'ok' ]` and `expected [ false, false ] to deeply equal [ true, true ]`; `turnStart.ts` reverted → `-t deadlock`: `Error: deadlock detected { code: '40P01' }`; fixed: 7 passed |
| R4 | MAJOR. `sweepTurns` compared `lease_expires_at` (DB clock, `dbNowPlus`) with the app's `new Date()`. Confirmed. | **fixed**: SQL `now()` in both predicates; `now` still dates the key / legacy / reservation cut-offs (all written on the app clock) | this | `-t "R4"` with `lt(turns.leaseExpiresAt, now)` restored → `AssertionError: expected { state: 'interrupted', … } to deeply equal { state: 'running', fencingToken: 1 }`; fixed: 2 passed |
| R5 | `turnLease.ts`: heartbeat / cancel-check ran until `runtime.stop()` in launch's `finally`; a tick that read the settled state called `lose()` (abort `interrupted`). Confirmed (the in-flight tick case). | **fixed**: `TurnBinding.onSettled`, called by `settleTurn` after commit; the runtime stops its timers and ignores ticks in flight (`settled`) | this | `-t "R5"` with `turnLease.ts` reverted → `AssertionError: expected true to be false` (`runtime.lost`); fixed: 1 passed |
| R6 | `launch.ts`: binding starts with `reservation: null`; a throw in `loadTurnInput` → `failTurn` settled without releasing the held row. Confirmed. | **fixed**: `failTurn` looks up the turn's held reservation by `turn_id` when the binding has none (`heldReservation`, shared with `loadTurnInput`) | this | `-t "R6"` with the lookup removed → `AssertionError: expected [ { status: 'held' } ] to deeply equal [ { status: 'released' } ]`; fixed: 1 passed |
| R7 | MINOR. `streamLive`: a snapshot with `seq < firstBuffered - 1` resumed live from the buffer head, skipping the frames between. Confirmed. | **fixed**: when the buffer cannot continue from the snapshot (or there is none), the connection follows the stored row (`streamStored`) until the turn ends | this | `npx vitest run src/routes/turnStream.test.ts` (buffer cap 3) with `turnStream.ts` reverted → `AssertionError: expected +0 to be 1`; fixed: 2 passed |
| R8 | `rateLimiter.reserve` took a token even when the gateway then refused the wait (> cap). Confirmed. | **fixed**: `reserve(key, maxWaitMs)` takes no token on a refusal | this | `npx vitest run src/providers/retryBudget.test.ts` → `AssertionError: expected 10000 to be +0`; fixed: 3 passed |
| R9 | `helperJobs.record`: provider hard-coded `'anthropic'`. Confirmed. | **fixed**: `HelperCallUsage.provider` = the helper registry entry's provider, used for the ledger row | this | `npx vitest run src/services/helpers/helperJobs.test.ts` → `AssertionError: expected 'anthropic' to be 'google'`; fixed: 1 passed |
| R10 | `turnStore.ts` `SWEEP_BATCH = 1_000` (N-73 value) as a literal; it slipped past numbersGuard (b) because 1,000 is in `COMMON_VALUES`. Confirmed. | **fixed**: `NUMBERS.SWEEP_BATCH` (N-73); a numbersGuard rule (a) row pins `turnStore.ts`, and the `COMMON_VALUES` note no longer lists the sweep batch | this | `npx vitest run src/test/numbersGuard.test.ts` with HEAD's `turnStore.ts` → `"N-73 services/turn/turnStore.ts:380: const SWEEP_BATCH = 1_000;"`; fixed: 6 passed |
| R11a | MINOR. `runHub` serialises each event twice (`JSON.stringify` for the size, then for the frame). | **deferred** (performance only, no behaviour) | — | — |
| R11b | MINOR. Count burst on a cold cache. | **deferred** (DEFERRED: concurrency cap) | — | — |
| R11c | `costUsd` null on retried turns. | **owner item** (needs a billing source for the no-count call; Invariant 2 keeps it null) | — | — |

## Gates (after all fixes, one run each, nothing else running)

| Gate | Result |
|---|---|
| backend `npx tsc --noEmit` | clean |
| backend `npm run lint` | 0 errors, 145 warnings (the touched files add none: their two warnings are pre-existing) |
| backend `npx vitest run` | 164 files passed; 1,866 passed, 23 skipped (1,889) |
| characterization snapshots | unchanged (no `.snap` in the diff) |
| frontend | not touched; not run |
| `npm run openapi` | not needed (no route schema changed) |

## For the orchestrator (proposed lines; this worker did not edit these files)

- **mistakes.md**: "2026-10-17 — A generator's admission was released only on end or throw.
  Symptom: a half-open breaker refused a model until restart after one refusal. Cause: a consumer
  that stops iterating calls `return()`; neither the success line nor `catch` runs. Rule: any
  resource taken inside an async generator is released in `finally`. Verify:
  `src/providers/gatewayAdmission.test.ts`."
- **mistakes.md**: "2026-10-17 — Two transactions took the same rows in opposite orders. Symptom:
  40P01 on Stop-then-Send. Cause: settle locked turn → chat, start chat → turn. Rule: every
  transaction that touches a turn locks root chat → chat → turn; a sweep takes them `SKIP LOCKED`
  in that order. Verify: `turnSettle.integration.test.ts` 'lock order (review R3)'."
- **mistakes.md**: "2026-10-17 — A DB-clock timestamp compared with the app clock. Rule: a value
  written with `now()` is compared with `now()`. Verify: 'the sweeper reads the database clock'."
- **CURRENT.md**: p05 review round 1 done; R1–R10 fixed, R11 deferred / owner; suite 1,866 passed.
- **DEFERRED.md**: runHub double `JSON.stringify` (perf); count burst on a cold cache (concurrency
  cap); `costUsd` null on retried turns (owner: billing source).
