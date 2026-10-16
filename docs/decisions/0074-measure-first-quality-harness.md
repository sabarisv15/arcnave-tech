# ADR-0074: Measure answer quality before changing it: the offline kit, an owner-run live runner, golden requests

- Status: accepted (task tech-p03, 2026-10-16). Tested offline; the live runner has not been run
  (it spends quota and is owner-run). Not merged, not deployed.
- Date: 2026-10-16
- Task: tech-p03 = P03 in [`docs/ops/audit/NEW-PLAN.md`](../ops/audit/NEW-PLAN.md) (Stage 6 CXD-7, Stage 21 S21-05 / S21-03,
  Stage 4 E15, D2 H7 / X-5 / X-6). Evidence: [`docs/ops/p03-result.md`](../ops/p03-result.md).
- Supersedes: nothing. The derived kit (`src/test/promptKit/`, `behaviorEvaluation.test.ts`) stays.
- Models used: Sonnet 5.5 (main, all writing); fresh Opus 5.5 read-only reviewer.

## Claude

Source: Claude docs, "Define success criteria and build evaluations"
(platform.claude.com/docs/en/test-and-evaluate/develop-tests, read 2026-10-16). It says to set
specific, measurable criteria and design evals that mirror the real task distribution with edge
cases, to automate grading where possible, to favour volume over hand-graded quality, and that for
LLM-based grading "generally best practice [is] to use a different model to evaluate than the model
used to generate the evaluated output". That is the basis for a cross-vendor judge (also Stage 6
CXD-7). The page does not say when a judge may gate; waiting for calibration against human grades is
ours. **There is no Claude-published harness to copy**; the layout below is ours.

## ArcNave before this change

- The 68 Stage 6 cases were not in the repository. `src/test/promptKit/cases.ts` held *derived*
  cases (string checks on the prompt) and `behaviorEvaluation.test.ts` 12 string contracts: 0 of the
  68 locked cases were executable (D2 §6).
- The live scripts in `src/scripts/` targeted a retired model name, an old prompt builder and
  removed tools; none was wired to an owner run (X-6).
- Nothing recorded what a provider is actually sent for a canonical turn, or how big each prompt
  section and tool declaration is, so P07 (prompt) and P10 (routing) had no "before".

## Decision

1. **Measure first, change nothing.** P03 edits no system prompt, tool, routing or gateway code.
   Production source is untouched except the repair of seven stale owner-run scripts (their stale
   literals only). What the harness finds is a *known gap*, listed with a reason, never patched here.
2. **The 68 cases live in the repository, unedited.** `backend/evals/prompt-kit/06-eval-cases-v1.json`
   is byte-identical to the Stage 6 master (sha256 `2bb6eae6…2765c`, confirmed by the owner with
   `Get-FileHash`). A strict schema parse, 68 unique ids, known gates and rule ids are tests. The
   owner's three extra cases are a separate file (`arcnave-extra-cases.json`) and a separate report
   section; the master is never edited to hold them.
3. **Two kinds of check, never mixed.** *Offline* (vitest, no provider): a case is offline-checkable
   only when its pass condition has a request-side precondition (a tool declared or absent, a rule in
   the prompt); the check reads the request the deployed builders produce. *Live-only*: anything about
   what a model says or does. When in doubt, live-only. 48 cases are offline-checkable, 20 live-only.
4. **A gap is recorded, not hidden and not fixed.** A failing offline requirement is listed in
   `EXPECTED_GAPS` (case:requirement and why). The test fails if a listed gap starts passing (delete
   the entry: the gap closed) and if an unlisted requirement fails. It does not use `it.fails` or skip.
5. **The live runner is owner-run and unreachable from CI.** `npm run eval:prompt` needs `LIVE=1`,
   explicit `--models` (no default), `--cases` or `--all`, and a typed confirmation or `--yes`. It uses the
   existing adapters (SDK retries stay off, no retry loop, no new SDK call outside `src/providers/`) and
   the deployed prompt and tool builders, with mock tools. Tests prove the guard (the real script exits 2
   without `LIVE`) and that no workflow, npm test script or source file names it.
6. **Cross-vendor judge, report-only.** Claude answers are judged by Gemini 3.8 Flash and Gemini answers
   by Sonnet 5.5 (Stage 6 CXD-7), configurable by `EVAL_JUDGE_FOR_CLAUDE` / `EVAL_JUDGE_FOR_GEMINI`; a
   same-vendor judge is refused. The judge instruction is the kit's own. Verdicts are reported and gate
   nothing until the judge is calibrated against human grades.
7. **Honest numbers.** Tokens are the provider's or `exact:false`; cost is `null` unless the existing
   pricing function priced it (Invariants 2 and 3). The commit-able summary has no model text (Stage 17).
8. **Golden request snapshots**: five canonical turns on the Gemini and Claude paths, captured on the wire
   through the real adapters and fake SDK clients, with the P05 normaliser. A prompt change shows as a
   snapshot diff; P07 updates them on purpose.
9. **Size budgets and a grep guard**: per-section and per-tool character budgets at today's figure + 5%
   (baseline P03, P07 reduces) and a test that no application source names a sampling parameter.
10. **The derived kit is not retired.** Its string checks stay until the new runner has been run by the
    owner and a baseline exists (the plan's own condition). Retiring them is a later, separate change.

## Gap

- The live runner builds the request and runs the adapter loop; it does not run the database-backed
  `runTurn` (history loader, compaction, file pipeline). Cases needing those run with the nearest
  deployed form and report an `approximations` count. Recorded in DEFERRED.md.
- The offline gates measure whether the request gives the model what a rule needs, not whether the
  model obeys. 34 case/requirement gaps are open (see `p03-result.md`).
- No judge calibration yet.

## Fix

P07 closes prompt gaps and lowers the budgets and snapshots on purpose; P10 does the same for routing;
a judge calibration set makes the verdicts a gate; a DB-backed live runner removes the approximations.
