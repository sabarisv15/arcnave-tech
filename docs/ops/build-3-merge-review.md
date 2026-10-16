# build-3 merge with main — review record (tech-ops.3b)

Subject: merge commit of `origin/main` (`681a63a`) into `build/gateway-security` (`c84a385`), plus the
round-1 fix commit. Rules: ADR-0068 (review after a big change), at most two rounds.

## Commands

- `/code-review high` on the merge (this session, forked skill run).
- R-A (backend: `config.ts`, `health.ts`, `models.ts`, `index.ts`, `registry*`, `drizzle`, `Dockerfile`)
  and R-B (docs, openapi, CURRENT, mistakes, ADR renumber, cross references): fresh Opus reviewers,
  Read / Grep / Glob only, given the diff of the merge on top of `origin/main`, the resolution doc,
  the `CLAUDE.md` invariants, ADR-0064, ADR-0071.
- Every cited `file:line` re-opened by the main session before it was accepted.

## Round 1

Counts: BLOCKER 0, MAJOR 1 (the same finding from two reviewers), MINOR 13.

| # | Source | Severity | Finding | Decision | Covered by |
|---|---|---|---|---|---|
| 1 | code-review, R-B | MAJOR | `CURRENT.md:6` links `build-3-merge-review.md`, which did not exist | **Fixed**: this file | link resolves; `Glob docs/ops/build-3-merge-review.md` |
| 2 | R-B | MINOR | Resolution doc's `rg` check claimed output that is wrong | **Fixed**: wording now says every hit is main's ADR, a link to it, or the record's own text | re-run `rg` |
| 3 | R-B | MINOR | CLAUDE.md row incomplete; the test-count line is stale (1,353) after the merge | **Fixed**: `CLAUDE.md:45` now says 1,499; row updated | gate numbers |
| 4 | R-B | MINOR | mistakes.md row understated the branch's entries | **Fixed**: seven added, seven pruned | n/a (prose) |
| 5 | R-B | MINOR | Edit of main's PR #42 heading not recorded; "not deployed from this branch" unclear | **Fixed**: recorded in the resolution table; heading now says it is merged and that deploy state is not recorded there | n/a |
| 6 | R-B | MINOR | `mistakes.md:818` says 25 files; the count at `c84a385` is 21 | **Fixed**: 21 (`git grep -l` over the pre-merge tree) | n/a |
| 7 | code-review | MINOR | `mistakes.md`: pruning the sign-out entry leaves its rule only in the changelog | **Rejected**: owner's rule for this task is "cap 40, prune oldest"; the rule is kept in the changelog line; no other entry is more disposable | n/a |
| 8 | code-review | MINOR | Dev scripts (`runClaudeBehaviorEvaluation.ts:33`, `runBehaviorEvaluation.ts:252`, `measureTokens.ts:18`) call `loadConfig({...})` without `ANTHROPIC_API_KEY` | **Deferred**: code from PR #42 already on main, not changed by the merge; dev scripts only | none; owner/next task |
| 9 | code-review | MINOR | The same scripts hard-code `claude-sonnet-5` instead of `claude-sonnet-5-5` | **Deferred**: pre-existing on main, dev scripts only | none |
| 10 | code-review | MINOR | `project-8bcf740a-…` literal remains in 17 dev scripts under `backend/src/scripts` (three cited: `runBehaviorEvaluation.ts:253`, `runClaudeBehaviorEvaluation.ts:34`, `runReliabilityMatrix.ts:272`) | **Deferred**: pre-existing, `scripts/` is outside the P04 guard | none |
| 11 | code-review | MINOR | `registry.ts:119` checks credentials before whether the alias is enabled (differs from `providerReadiness`' "in use") | **Deferred**: PR #42 behaviour on main, owner-approved there; not a merge effect | `registry.test.ts` |
| 12 | code-review | MINOR | `config.ts:624`: Gemini-only deployment with default Claude ids reads `degraded` | **Deferred**: documented in ADR-0064 Consequences; live service has the key mounted (PR #42 body). Owner to confirm after deploy | `registry.test.ts` |
| 13 | R-A | MINOR | `claude-platform-live-checklist.md:26` asks for `GET /readyz` on the public URL; ADR-0065 moved liveness to `/health` because Google answers `/healthz` itself | **Deferred**: docs from main; if `/readyz` is intercepted, the owner uses the startup log or `/v1/models`; a `/ready` alias would be its own change | none |
| 14 | R-A | MINOR | `index.ts:107` always logs a `/docs` URL, which production disables | **Deferred**: cosmetic, branch code | none |

R-A: no semantic conflict between the two sides; one readiness code path (`providerReadiness`); no
reference to the removed `CONTEXT_EDIT_*` keys; `drizzle` has 30 files with no repeated number and a
matching journal; `Dockerfile:73` keeps `&&` with the advisory lock.
R-B: renumber complete and correct (every hit judged by its sentence; all decision links resolve;
no repeated number in `docs/decisions`).

## Round 2

Fresh reviewers R-A2 (claims in this record against the files, the round-1 fixes, anything the merge
caused) and R-B2 (cross-references, links, counts, number prefixes), Read / Grep / Glob only, on the
uncommitted round-1 fixes. Gates re-run after the round-1 fixes: backend `tsc` clean, `vitest`
138 files / 1,499 passed / 19 skipped; frontend `tsc -b` clean, 44 files / 411; `npm run openapi`
no diff.

Counts: BLOCKER 0, MAJOR 0, MINOR 3 (R-B2: none).

| # | Severity | Finding | Decision |
|---|---|---|---|
| 15 | MINOR | Round-1 count said MINOR 12; the table has 13 | **Fixed** |
| 16 | MINOR | Row 10: the project literal is in many scripts (17 files), not three | **Fixed** (wording; still deferred, `scripts/` is outside the P04 guard) |
| 17 | MINOR | Row 8 cited `runBehaviorEvaluation.ts:253`; the `loadConfig` call is line 252 | **Fixed** |

Confirmed by command, not by the reviewers: `git diff ff1cab5 c84a385 -- backend/src/scripts` is empty,
so rows 8-10 are code the branch never touched (main's PR #42 and older). A MAJOR open after round 2:
none. Deferred items 8-14 are for the owner / a later task.
