# P11 result — error matrix, timers, labelled fallback

Task: tech-p05 wave 2, NEW-PLAN P11. Worktree branch `wave2/p11`, base P08 head `38882aa`.
Decision: [ADR-0081](../decisions/0081-error-matrix-and-labelled-fallback.md) (ADR-0076 got a
"superseded in part" note line). Live checklist: [`p11-live-checklist.md`](p11-live-checklist.md).
Migration `0033_fallback_and_refusal` (journal idx 31 on this branch, `when` 1792700000000; the
orchestrator renumbers idx after 0031 / 0032). Model used: Opus 5.5 (one agent, no sub-agents).

## DONE / SKIP

| Item | State | Where |
|---|---|---|
| Gateway: retries, overflow cut, attempts' usage, chain (D3 A-07) | DONE | `providers/gateway.ts`; `providerLoop.ts` re-exports the moved helpers |
| Classifier ER-2f/g/h, closed kinds, `ProviderError.kind/partialUsage/refusalCategory` | DONE | `providers/failures.ts`, `types.ts`, `anthropic.ts` (`ERROR_TYPE_STATUS`, 401 credentials, 403 config, 413 payload), `gemini.ts` |
| `response_blocked` + frontend copy | DONE | `errors.ts`, `arcnave-frontend/src/api.ts` |
| Finish mapping ER-3c/d, AL-4 | DONE | `providers/finish.ts`, `gemini.ts`, `anthropic.ts`, `streamAndCollect.ts`, `forcedAnswer.ts` |
| Failure after text → `interrupted`, kept, `partial: true`; cut marker in history (ours) | DONE | `streamAndCollect.ts`, `settle.ts`, `history/failedExchanges.ts`, `turn/context.ts` |
| Tool timers ER-4c (web_search 20 s, file search 2 s, memory 2 s) | DONE | `tools/dispatchingExecutor.ts`, `toolset.ts` |
| Breaker N-47, kill switch `MODELS_DISABLED`, retry budget 10 % | DONE | `breaker.ts`, `retryBudget.ts`, `registry.ts` (`disabled`) |
| E18 token bucket | DONE, ships OFF | `rateLimiter.ts` |
| Labelled fallback, capability stripping by rebuild, `model_switch`, `done.fallback`, stored label | DONE | `fallback.ts`, `generation.ts` (hop build), `turnContext.ts` (`quiet`), `turnStore.ts`, `schema.ts`, `routes/chats.ts` |
| K-15: picked unavailable → its chain, labelled; Auto + Gemini down → Sonnet, labelled | DONE | `modelRouting.ts`, `prepareTurn.ts` |
| Hop re-reserves through P08's reservation | DONE | `buildTurnContext` → `usage.adjust` on each rebuild |
| SD-9a explicit thresholds; SD-9b refusal never falls back | DONE | `gemini.ts` `GEMINI_SAFETY_SETTINGS`; failures table |
| AL-5 thinking-400 repair, once, no tool re-run | DONE | `anthropic.ts` (`isThinkingSignature400`, `withoutThinking`) |
| AL-1 partial usage; P22 `CallUsage` per attempt (`AttemptCall`, `// P22 contract`) | DONE (rows kept on `state.attempts`; orchestrator wires `recordCalls`) | `gateway.ts`, `turnState.ts` |
| AL-2 `usage_records.refusal_category` | DONE | `schema.ts`, `usage.ts`, `turnStore.ts` |
| Forced answer through the gateway; Stop → stopped; deadline → `turn_deadline_exceeded` | DONE | `forcedAnswer.ts` |
| ER-12a support code + switch label; ER-12b `INCIDENT_BANNER` + `GET /v1/status` + banner | DONE | `routes/status.ts`, `app.ts`, `ChatStates.tsx`, `App.tsx`, `workspace.tsx` |
| ER-4a/b first-token / stall timers | SKIP (OQ-16) — `GatewayTurn.onAttempt` hook only | |
| ER-4d deadline value | SKIP (OQ-15) — ER-4f rule built on the existing 59 min | |
| ER-11 RFC 9457 body | SKIP (OQ-17) | |
| ER-3 one "continue" recovery after text | NOT DONE — Turn Executor design (Stage 21 Task 1.11), not in P11's Covers; M-17 = 0 attempts as the brief says | |
| run_code timer | P18 | |

## Evidence per exit test

| Exit test | File | Result |
|---|---|---|
| Matrix, one case per M-01 … M-30 (variants per status / reason): attempt count per model, delay bounds (J1 [0,1 s), J2 [0,2 s), RA exact), hop + reason or none, final code + catalogue title with fallback off; injected clock, seeded random (mulberry32 42); real adapters with scripted SDK clients | `backend/src/providers/errorMatrix.test.ts` | 58/58 |
| Breaker: 5 in 30 s (and not 4, not spread), 10 of 20, half-open 30 s single trial, failed trial reopens, late admission cannot close, admission once, kill switch overrides (alias or id), per model | `backend/src/providers/breaker.test.ts` | 9/9 |
| Retry budget / token bucket | `backend/src/providers/retryBudget.test.ts` | 4/4 |
| Route, two fakes: Gemini 503×3 → Sonnet (frames, `done.fallback`, stored row, usage row on Sonnet); Opus `claude_limit` → Gemini (Sonnet skipped); safety block no hop (`blocked`, `refusal_category`); refusal no hop; no tool twice across a hop; failure after text `interrupted` + cut marker next turn; picked Sonnet disabled → Gemini labelled (K-15); Auto with Gemini disabled → Sonnet; deadline → no hop; `/v1/status` banner and none | `backend/src/routes/fallback.integration.test.ts` | 12/12, ×2 |
| Tool timers | `backend/src/tools/dispatchingExecutor.test.ts` | pass |
| Cut marker | `backend/src/services/history/failedExchanges.test.ts` | pass |
| Frontend: label text per reason, Continue on interrupted, support code, `response_blocked` tone, errorCopy entry for every final code, incident banner | `arcnave-frontend/src/ChatStates.test.tsx` | 45/45 |

Mutation check (recorded, not kept): removing `shown ||` from the hop guard in `gateway.stream`
fails 3 tests (fallback "failure after text", matrix M-17, M-24 after text).

## Gates (tree unchanged during the run)

| Gate | Command | Result |
|---|---|---|
| Backend typecheck | `cd backend && npx tsc --noEmit` | clean |
| Backend suite (sequential, alone) | `TEST_DATABASE_URL=…/arcnave_test_p11 npx vitest run` | **152 files, 1,749 passed, 23 skipped, 0 failed** (649 s) |
| Snapshots after `-u`, twice | `npx vitest run src/test/turnCharacterization*.ts src/test/goldenRequests.integration.test.ts` | 48/48 ×2 |
| Migrations on an empty DB | `DATABASE_URL=…/arcnave_mig_p11 npm run db:migrate` | `migrations applied`; `messages.fallback_from/fallback_reason`, `usage_records.refusal_category` present |
| OpenAPI | `npm run openapi` | regenerated: message `fallbackFrom` / `fallbackReason`, `GET /status` |
| Frontend | `npx tsc -b`; `npx vite build`; `npx vitest run` | clean; built (chunk-size warning only); **45 files, 449 passed** |

## Snapshots re-recorded (only these three files, every diff read)

- `goldenRequests.integration.test.ts.snap` — every Gemini request gains `safetySettings`
  (4 × BLOCK_MEDIUM_AND_ABOVE, SD-9a). Nothing else.
- `turnCharacterization.integration.test.ts.snap` — the Gemini wire gains `safetySettings`; "a
  refused turn": message `finishReason` null → `blocked`, usage `finishReason` → `blocked`, `status`
  `error` → `blocked` (M-14, AL-2).
- `turnCharacterizationPaths.integration.test.ts.snap` — (R) the refusal as above; (9) model not
  found: `yield model_switch` after start, a second (Sonnet) request rebuilt for Sonnet, message and
  usage on Sonnet 5.5, both models marked unavailable, final `model_unavailable`; (8d) renamed
  ("saved as stopped"): no error frame, message `stopped`, finish `cancelled`, usage `cancelled`
  (DEFERRED P11; the old snapshot removed as obsolete); "long texts" gains the Sonnet system prompt
  of scenario 9.

## Tests changed deliberately

- `routes/gatewayTurn.integration.test.ts`: X-3 history now has the stopped answer's cut marker;
  the 502 / quota test now asserts the hop (Gemini 3 + Sonnet 3 attempts; quota 1 + 1) and its
  label (one fake serves both slots in that file).
- `routes/providerTimeout.integration.test.ts`: 2 → 4 attempts (one retry on each model) + label.
- `test/stopThenGreeting.integration.test.ts`: the stopped partial is now marked (assertion flipped).
- `test/turnCharacterizationPaths.integration.test.ts` (8d): stopped, not `empty_response`.
- `providers/gemini.adapter-loop.test.ts`: five fixtures' answer rounds gained `finishReason: STOP`
  (a stream with no finish reason is a failure now, Stage 21 doc-sync 2026-10-11).
- `test/brandNeutral.test.ts`: `fallback.ts` joins the provider files allowed to name the models.
- `test/harness.ts`: `RETRY_BUDGET_MIN_RESERVE`, `BREAKER_FAILURES`, `BREAKER_MIN_CALLS` raised
  (tests in one file share an app; the real values are tested in the unit files).
- No existing test expected `no_model_available` for Auto with Gemini *configured but down*; the
  one that expects it with nothing configured still passes.

## OWNER ITEMS

- OQ-16 first-token / stall timers; OQ-15 turn deadline value; OQ-17 RFC 9457 body (unchanged).
- E18 token-bucket capacity: no register value; ships off.
- `RETRY_BUDGET_MIN_RESERVE` = 2 (ours). With one user it decides alone: a Gemini outage spends both
  retries, and the Sonnet hop then gets none in that 30 s window. Suggest ≥ 4 (one full chain).
- The cut-marker wording (ours) and whether a `max_tokens` answer should get one too (not marked now).
- Live: AL-5 strip-and-retry is the documented recovery but unverified on our models (LV-1 item 6).

## Deviations

- Known finish reasons keep the provider's spelling (`STOP`, `end_turn`, `MAX_TOKENS`); only
  unknown ones become `other`, blocks `blocked`, `model_context_window_exceeded` `max_tokens`.
- A turn whose attempts span two models reports `exact: false` zeros (cost null) when the left model
  had billed partial usage; per-attempt rows stay exact.
- Research `progress` events of a failed first model are not withdrawn after a hop (rare; search mode).

## For the orchestrator (proposed lines; not written by this agent)

- **mistakes.md** (changelog, no new heading): "2026-10-17 (tech-p05 P11) — (1) a hop guard made
  every fallback test pass while the harness ran one fake in both slots; the instance-wide retry
  budget (reserve 2 / 30 s) and breaker silently cut attempts across tests sharing an app, so an
  attempt-count assertion passed by coincidence. Rule: per-instance limiters get test-wide values in
  the harness and their own unit tests with an injected clock. (2) `Promise.race(timer, tool)` where
  the timer aborts the tool before resolving lets the tool's AbortError win; settle the timeout
  result first, then abort. Verify: `dispatchingExecutor.test.ts` 'tool timers'. (3) a scripted
  step list consumed with `shift()` was reused for a second run and silently became defaults;
  build fixtures per run (`errorMatrix.test.ts` scripts are factories)."
- **CURRENT.md**: "P11 error matrix + labelled fallback (ADR-0081): gateway.ts owns retries,
  breaker (N-47), kill switch MODELS_DISABLED, retry budget, Gemini⇄Sonnet / Opus→Sonnet→Gemini
  chain with model_switch + stored label, response_blocked, interrupted partial answers with a
  history cut marker, N-43 tool timers, /v1/status banner. Migration 0033. Not deployed."
- **DEFERRED.md**: close "forced answer bypasses the retry wrapper", "stop/deadline during the
  forced answer saved as empty_response", "a stopped answer goes back unmarked", tech-p07 "silent
  fallback of a manual pick (K-15)". Open: ER-3 continuation after text (Turn Executor); audio retry
  still immediate; `state.attempts` → `ledger.recordCalls` at merge; research progress events not
  withdrawn after a hop.
