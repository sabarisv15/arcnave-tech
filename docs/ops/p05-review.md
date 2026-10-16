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
