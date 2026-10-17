# P22 code review (ADR-0068)

One reviewer: the `code-review` skill at `medium`, over the uncommitted P22 tree, before the final
gate run. The independent second reviewer that ADR-0068 asks for was not available to this agent
(no sub-agent tool in a wave-2 worktree); the orchestrator runs it at merge.

| # | Finding | Verdict | Change |
|---|---|---|---|
| 1 | `usageFromCalls` returned `exact: false` with summed counts: breaks Invariant 3 ("exact: false with zeros") | **Confirmed** | Turn usage is zeros when any call is inexact; each call row keeps its own counts. ADR-0079 deviation rewritten; ledger test and the Gemini characterization entry back to zeros (that snapshot entry no longer changes). |
| 2 | A failed-call row was added for every error, including our own (a DB write) | **Confirmed** | Only for a `ProviderError` or the turn deadline; the ledger test uses a `ProviderError`. |
| 3 | Fork maps a file id with no copy back to the old chat's id | Partly | Kept: the retry names the prompt's files, which are always copied; a fallback still names the same bytes, never drops a file (Invariant 1). Listed as an open risk. |
| 4 | A purged root unlocks the family | Not reachable | Deleting any chat deletes the whole family (ADR-0038 §6), so no live version outlives its root. Recorded in the result file. |
| 5 | After a fork, earlier rows keep the old chat's ids until the end-of-run reload | Accepted risk | Regenerate and edit are disabled while the chat runs; feedback on an earlier row during the run can 404 until the reload. Open risk in the result file. |
| 6 | A Claude stop raised by the SDK skipped the partial `call_usage` | **Confirmed** | Both adapters yield the in-flight partial in the catch before rethrowing; new test "a stop the SDK raises as an error still reports the partial". |
| 7 | Ledger keys accepted by every storage operation | **Confirmed** | Accepted by put / get / exists / size only; `delete` refuses one (test). |
| 8 | `output_tps` counted untimed calls' tokens | **Confirmed** | Only timed calls in numerator and denominator. |
| 9 | Calls priced three or four times | Partly | The ledger now writes the calls `record` priced; `done` and the log line still price once each (cheap, from code rows). |
| 10 | `mistakes.md` / `CURRENT.md` untouched; `p22-result.md` missing | By rule | The wave rules forbid those edits (lines proposed in the result file); the result file is written. |
