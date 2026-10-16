# tech-build.3-fix — review of the fix round

Task tech-build.3-fix, 2026-10-16, branch `build/gateway-security` on top of `fce4a22`. The lesson
of build-3 round 2 was that a fix nobody reviews makes the next finding; this file records the
review the fixes got before the push. Main session: Opus 5.5. Every cited file:line was re-opened
by main before a finding was accepted, rejected or deferred.

## Commands run

| Round | Diff reviewed | Reviewers (all started in one message) |
|---|---|---|
| 1 | `fce4a22..b13bfef` (W1 + W2 merged; 57 files, +2,182 / −257 in `backend` + `arcnave-frontend`) | `/code-review fce4a22..HEAD high` (forked); `/security-review` (skill; needed `git remote set-head origin build/gateway-security` so its `origin/HEAD...` diff resolves; it ran a finder sub-task, Opus 5.5); R-A (fresh Opus 5.5, Read/Grep/Glob, W1's diff `r1-diff-w1.patch` + the invariants + the tests); R-B (same, W2's diff `r1-diff-w2.patch`) |
| 2 | `b13bfef..6defcc7` (round-1 fixes) | `/code-review b13bfef..6defcc7 high`; R-A2 (text part); R-B2 (pipeline / sandbox part) — fresh agents, not the round-1 ones |
| 3 | `6defcc7..ebfbad3` (round-2 fixes) | `/code-review 6defcc7..ebfbad3 high`; R-A3; R-B3 — fresh |

Gates before each round, run in parallel (backend `npx tsc --noEmit` + `npx vitest run`, frontend
`npx tsc -b` + `npx vite build` + `npx vitest run`):

| Before | backend vitest | frontend vitest | tsc / build |
|---|---|---|---|
| baseline `fce4a22` | 134 files, 1,353 passed, 19 skipped | — | clean |
| round 1 (`b13bfef`) | 138 files, 1,471 passed, 19 skipped | 44 files, 411 passed | clean, built |
| round 2 (`6defcc7`) | 138 files, 1,491 passed, 19 skipped | 44 files, 411 passed | clean, built |
| round 3 (`ebfbad3`) | 138 files, 1,493 passed, 19 skipped | 44 files, 411 passed | clean, built |
| final (the commit) | see [build-3-fix-result.md](build-3-fix-result.md#gates) | | |

## Counts per round (after main's verification)

| Round | BLOCKER | MAJOR | MINOR | NIT | Result |
|---|---|---|---|---|---|
| 1 | 0 | 3 (+1 reviewer MAJOR main rates MINOR, counted there) | 12 | 14 | 3 MAJOR fixed; cheap MINORs and NITs fixed |
| 2 | 0 | 2 (both made by round 1) | 9 | 9 | 2 MAJOR fixed |
| 3 | 0 | 0 | 10 | 8 | loop ends; two test-only MINORs added |

Counts are unique findings after merging duplicates across the reviewers of a round.

Security review (round 1): **no finding at ≥ 8/10 confidence**; step 2 (false-positive filter)
had nothing to filter. One 2/10 note = F16 below.

## Round 1

| # | From | Sev (main) | file:line | Finding | Decision | Test covering it |
|---|---|---|---|---|---|---|
| 1 | /code-review #1, R-B MINOR 1 | **MAJOR** | `services/attachments/fileJobs.ts` `launch`, `takeLargeSlotIfNeeded` | A ZIP claimed in the fast lane that takes the large slot still counted as fast, so the pump filled the reserved fast slot with normal jobs and a small file waited behind a 500 MB expansion (Stage 9 G30, the goal of item 8) | **Fixed**: `countedNormal`; a fast ZIP that turns large counts as normal, or defers when the normal slots are full | `fileReviewFixes.integration.test.ts` "a small file still runs while the ZIP expands and a normal job runs" — fails on `b13bfef` (`expected [ …(2) ] to not include '<n2>'`) |
| 2 | /code-review #2, R-B MINOR 3 | **MAJOR** (copy) | `tools/sandbox/cloudRunSandboxClient.ts` `assertStagingCanSign`; `errors.ts`; `api.ts` | Every chat file is in `input/`, so every run in a chat with files fails; the copy said "Code without files still runs" | Round 1 narrowed the check to outputs; **round 2 reversed that** (see round 2 #1) and fixed the copy instead | round 2 #1 |
| 3 | R-A M1 | **MAJOR** | `providers/anthropic.ts:269`, `:292` | Escaping can make a 255-char name ~6× longer; the Messages API `DocumentBlockParam.title` is minLength 1 / maxLength 500 (verified on platform.claude.com/docs/en/api/messages); a too-long or empty title fails every later turn | **Fixed**: `documentTitle` (cap 500, no cut inside a reference, omitted when empty) | `anthropic.test.ts` "a 255-character name of quotes and pipes…" (fails on old: `expected 1504 to be less than or equal to 500`), "…sends no title, never an empty one" (fails: has `title`) |
| 4 | R-B MAJOR | MINOR (pre-existing) | `zipReader.ts`, `preflight.ts` vs officeparser `zipUtils.js` | Central-directory vs local-header mismatch (F16) | **Deferred**: not exploitable — main read xmldom 0.9.12 `sax.js` `entityReplacer` + `dom-parser.js:228` (fixed entity map only); security review 2/10 | — |
| 5 | /code-review #3, R-B MINOR 4 | MINOR (pre-existing) | `cloudRunSandboxClient.ts` signing `catch {}` | Signing failure with the SA set still loses files silently | **Deferred** (DEFERRED.md) | — |
| 6 | /code-review #4, R-B MINOR 5 | MINOR | `turn/persistence.ts` | `errorCode` not stored with the tool call | **Deferred** (migration) | — |
| 7 | /code-review #5, R-B MINOR 2 | MINOR | `fileJobs.ts` claim | Spurious one-time deferral while a claim holds `activeLarge` | **Deferred**; comment kept true (at most one deferral) | — |
| 8 | /code-review #6 | MINOR | `fileJobs.ts` | Deferral re-downloads | **Deferred** | — |
| 9 | /code-review #7 | NIT | `cloudRunSandboxClient.ts` | `hasInputFiles` repeats the staging walk | Round 1 removed it with the narrowing; round 2 restored it; **deferred** | — |
| 10 | /code-review #8 | NIT | `codeExecutionExecutor.ts` ×4 | Duplicated errorCode spread | **Fixed**: `runFailure` | existing executor and integration tests |
| 11 | /code-review #9 | MINOR | `fileJobs.ts:650` | `'large' in job` runtime check | **Fixed**: `process` / `runProjectJob` typed `ClaimedJob` | tsc |
| 12 | /code-review #10 | MINOR | docs | No live checklist for the fix | **Fixed** in docs (Part E) | — |
| 13 | R-A m1 | MINOR | `attachmentContent.ts:72-80` | Invisible characters (variation selectors, soft hyphen, Hangul fillers) and `"`/`\|`/more `<>` lookalikes missed | **Fixed**: `\p{Default_Ignorable_Code_Point}`; quote/bar lookalikes | `attachmentContent.test.ts` 14 new cases, all fail on old |
| 14 | R-A m2 | MINOR | `fileBudget.ts:95` | Sheet name raw in the excerpt header (`locator`) | **Fixed** (header); the `## Sheet:` line inside chunk text **deferred** (F12) | `untrustedNames.integration.test.ts` "an excerpt header shows its locator neutralised" (fails on old: `expected '--- a' to contain…`) |
| 15 | R-A m3 | MINOR | `persistence.ts` | Old stored tool results replay raw names | **Accepted**, recorded in ADR-0069 Consequences | — |
| 16 | R-A m4 | MINOR | `webFetch.cleaner.test.ts` | 2 s bound / memory | **Deferred**: the brief fixed the bound at 2 s | — |
| 17 | R-A NIT | NIT | `contextPrompt.ts:177` | `Files:` unquoted, `a, b` reads as two files | **Fixed**: each name quoted | `untrustedNames` F1 test asserts `Files: "<name>"` (fails on old) |
| 18 | R-A NIT | NIT | `webFetch.ts` | `<>`/`<` comment claim had no test | **Fixed**: test "a < that opens no tag stays as text" (guard; passes on old by design) | itself |
| 19 | R-A NIT | NIT | `attachmentContent.ts` comment | "never addressed by name" imprecise | **Fixed** wording | — |
| 20 | R-B NIT | NIT | `providers/types.ts` | `isRetryableProviderError` type guard unsound | **Fixed**: returns `boolean` | tsc |
| 21 | R-B NIT | NIT | `audio.ts` | comment claimed SDK timeout retried | **Fixed** (re-fixed in round 2) | — |
| 22 | R-B NIT | NIT | `ToolActivity.tsx` | prototype key lookup | **Fixed**: `Object.hasOwn` | `ToolFailureNotice.test.tsx` |
| 23 | R-B MINOR 6 | MINOR (pre-existing) | `audio.ts` | No backoff / Retry-After | **Deferred** (P11) | — |
| — | R-A, R-B, others | MINOR/NIT | various | the rest of the lists (title in comments, `--!>`, `</style>` in an attribute, raw sandbox output names, timing logs, F17 guard scope) | **Deferred** with reasons in DEFERRED.md | — |

## Round 2

| # | From | Sev (main) | file:line | Finding | Decision | Test |
|---|---|---|---|---|---|---|
| 1 | /code-review #1; R-B2 MINOR 1 | **MAJOR** (made by round 1) | `cloudRunSandboxClient.ts:430` | With the check narrowed to outputs, an input with no signed URL depends on the Job's own account reading the bucket; `runner.py` drops a failed input with a stderr line, so the file is lost silently (Invariant 1) | **Fixed**: fail closed again on inputs and outputs; truthful copy ("code cannot run in a chat that has files, or make a file"; model told not to retry); ADR-0070 §5 records both turns | `cloudRunSandboxClient.test.ts` "a run with an input file fails with sandbox_misconfigured…" — fails on `6defcc7` (run resolves) |
| 2 | /code-review #2; R-A2 MAJOR | **MAJOR** (made by round 1) | `anthropic.ts:272` | `slice(0, 499)` can split a surrogate pair; a lone surrogate in the title fails the request on every replay | **Fixed**: strip a trailing high surrogate in the same anchored regex | `anthropic.test.ts` "a cut never splits a surrogate pair…" — fails on `6defcc7` |
| 3 | /code-review #3 | MINOR (pre-existing) | `api.ts:304`, `ChatStates.tsx:68` | Other `errorCopy[code]` sites index prototype keys | **Deferred**: server codes are an enum | — |
| 4 | /code-review #4, R-B2 NIT 8 | MINOR | `fileJobs.ts:892` | spurious deferral (round 1 #7 again) | **Deferred** | — |
| 5 | /code-review #5; R-B2 MINOR 2 | MINOR | docs | checklist / mistakes.md not updated | **Fixed** in docs | — |
| 6 | /code-review #6; R-B2 NIT 7 | MINOR | `audio.ts:94` | comment asserted a guarantee (deadline < SDK timeout) without a test | **Fixed**: guarantee removed from the comment | — |
| 7 | /code-review #7; R-A2 MINOR 2/3 | MINOR | `derive.ts:87,91`, `retrieval.ts:208` | sheet name raw in chunk text and project sheet headers | **Deferred** (F12, P07) | — |
| 8 | /code-review #8 | NIT | `fileJobs.ts:84` | `countedNormal` derivable | **Rejected**: kept explicit; not strictly derivable when FILE_FAST_LANE_MAX_BYTES > FILE_LARGE_JOB_BYTES | — |
| 9 | /code-review #9; R-B2 MINOR 4 | MINOR | `fileReviewFixes.integration.test.ts:482` | `sleep(300)` let the test pass on old code on a slow runner | **Fixed**: asserts n2 still `queued` after the later small file is ready | same test, fails on `b13bfef` |
| 10 | R-B2 MINOR 3 | MINOR | `fileJobs.ts:897` | defer branch untested | **Fixed**: test "with every normal slot taken, a fast-lane ZIP that expands large waits instead…" | fails on `b13bfef` |
| 11 | R-B2 MINOR 5, R-B3 NIT 4 | NIT | `executionRuntime.ts` skill scripts | code dropped, chat-oriented message | **Deferred** (no production caller) | — |
| 12 | R-A2 NITs | NIT | `attachmentContent.ts:58` comment; `gemini.ts:76` empty attribute; `scenarios.ts:204` | stale comment, `filename=""`, stale fixture | **Fixed** | Gemini row added in round 3 |
| — | R-B2 NIT 6, R-A2 rest | NIT | | stale docblock, trim inconsistency, lookalike misses, `&` strip | fixed (docblock) / deferred | — |

## Round 3

No BLOCKER and no MAJOR from any of the three reviewers. Main re-opened each:

| # | From | Sev (main) | Finding | Decision |
|---|---|---|---|---|
| 1 | /code-review #1 | MINOR (pre-existing) | staging-loop catch swallows a GCS `save` / `stat` error | **Deferred** (with the signing-failure item) |
| 2 | /code-review #2 | MINOR (pre-existing) | signing failure with the SA set | **Deferred**; ADR-0070 §5 "Not changed" |
| 3 | /code-review #3 | — | fail-closed blocks code in every chat with files when the SA is unset | **Rejected as a defect**: a deliberate fail-closed decision (Invariant 1), with a typed error, truthful copy, a start-up log line and checklist step 2; the warm sandbox (production per CURRENT.md) is untouched. Recorded as a decision taken alone. Sub-point (bucket without `storageClient`, tests only) deferred. |
| 4 | /code-review #4, R-B3 MINOR 3 | MINOR | checklist understated the effect | **Fixed** (step 2, Part E 9) |
| 5 | /code-review #5 | MINOR | broken symlink: guard passes, staging aborts | **Deferred** with #1 |
| 6 | /code-review #6, R-B3 NIT 6 | MINOR | chat files downloaded before a certain refusal | **Deferred** |
| 7 | /code-review #7 | MINOR | mistakes.md entry | **Fixed** |
| 8 | /code-review #8, R-A3 NIT 1 | NIT | empty / trimmed name only at two sites | **Deferred** |
| 9 | /code-review #9 | NIT | `&` + lowercase stripped at the cut | **Rejected**: the text is being cut anyway; R-A3 agrees harmless |
| 10 | R-A3 MINOR | MINOR | Gemini empty-attribute change untested | **Fixed (test only)**: `gemini.gateway.test.ts` row `'​‮﻿' → <document>` — fails on `6defcc7` |
| 11 | R-B3 MINOR 1 | MINOR | outputs test passed on broken code (`setup(true)`) | **Fixed (test only)**: `setup(false)`; mutation (outputs branch removed) fails it |
| 12 | R-B3 MINOR 2 | MINOR | no end-to-end test of bash_tool in a chat with files | **Deferred**: the client test plus the present_files integration cover the guard and the code path |
| — | R-A3 NITs 2-3, R-B3 NITs 5, 7 | NIT | lone surrogate in stored names (verified impossible after Postgres), half-old test loop, error order, copy in two places | noted / deferred |

The two round-3 changes are test-only (no source line changed after round 3).

## Final state

**Open BLOCKER: 0. Open MAJOR: 0.** Everything not fixed is in
[audit/DEFERRED.md](audit/DEFERRED.md#tech-build3-fix--not-fixed-in-this-task-2026-10-16) with
its reason.
