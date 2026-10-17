# tech-p05 wave 2 — merge of `wave2/p11` into `build/turn-jobs`

Written 2026-10-17 by the merge agent (Opus 5.5, delegated by the orchestrator). Base
`build/turn-jobs` @ `0368662` (P08 + P22 + P13, green), merged `wave2/p11` @ `ce14c10` (P11, base
P08 `38882aa`). One merge commit, not pushed. Decisions read: ADR-0078, 0079, 0080, 0081.

## 1. How P22's per-call usage and P11's attempts were unified

**One writer of ledger rows: the gateway.** `ProviderGateway.call` (`providers/gateway.ts`) is the
only place that knows, for every provider request, which attempt it is and which model it went
to, so it writes the P22 `CallUsage` rows straight into `state.calls` (`GatewayTurn.calls`,
`GatewayTurn.callRole`). P11's `AttemptCall` type and `state.attempts` are gone; the rows they
described are now real ledger rows, and `settleTx` writes them with `ledger.recordCalls` as before
(P22 step, order unchanged).

**One source per request** (so nothing is counted twice):

| The request … | Source of its row | `usage_source` |
|---|---|---|
| ended normally (each tool round) | the adapter's `call_usage` event, passed through the gateway, which stamps `attempt`, `providerModelId`, `provider` | `provider` (or `none` if the provider sent no counts) |
| was stopped (Stop, deadline, shutdown) | the adapter's in-flight `call_usage` (P22) — the gateway writes no failed row for a cancel | `provider_partial` / `none` |
| failed after the provider got it (HTTP error, mid-stream error, Gemini block / no finish reason, timeout) | the gateway's catch, from the new `ProviderError.failedRequestUsage` (that request's own counts only, never the earlier rounds of the attempt, which already have rows) | `provider_partial` when exact, else `none` with zeros, `exact: false`; `finish_reason` `error` |
| AL-5 thinking-signature 400 repaired inside the adapter | the adapter emits a `call_usage` for the refused request (`none`, `error`) before the re-send | `none` |
| from an adapter that reports only a whole-call total (fakes) | the gateway, from `completed`, when the attempt reported no `call_usage` | `provider` / `none` |
| never sent (breaker open, kill switch, local rate limit, deadline passed) | no row | — |

`attempt` = 1-based request number **on that model** in the call (a retry and the M-12 overflow
re-send each count; a hop restarts at 1 on the next model). `ordinal` = place in the turn across
models. `provider` is per row now (`CallUsage.provider`, `ledger.recordCalls` uses
`c.provider ?? turn.provider`), so a Gemini→Sonnet hop writes `google` rows and an `anthropic` row.
Each row is priced on its own model (`priceCalls` by `providerModelId`), the turn's cost is
`turnTotals` (null if any row is unpriced). The turn's `usage_records` row is on the answering
model (`state.served`), its counts are `usageFromCalls(state.calls)` (one inexact row → `exact:
false` zeros, Invariant 3), and `messages.fallback_from / fallback_reason` stay.

The gateway still adds AL-1 partial usage to the `completed` event and zeroes it across models
(`mixedModels`) — the matrix test reads that event — but no turn figure reads it any more:
`streamAndCollect` and `forcedAnswer` set `state.usage = usageFromCalls(state.calls)` on every
`call_usage`, `completed` and failure. P22's `addCall` / `addCallFromCompleted` / `addFailedCall`
were removed (dead after the merge). P11's deviation "a turn spanning two models reports
`exact:false` when the left model billed partial usage" is superseded: the sum is exact when
every row is exact, each priced at its own model's rate.

## 2. File-by-file resolutions

- `.env.example`, `config.ts`, `config/numbers.ts`, `container.ts`, `services/turn/services.ts`,
  `services/turn/input.ts`, `schema.ts`, `usage.ts`, `turnStore.ts`: both blocks kept (P13/P22 first,
  then P11). `GenerationService` takes `helperJobs` then `gateway`.
- `providers/types.ts`: `ProviderError.failedRequestUsage`; `CallUsage.provider?`; `attempt` comment
  updated (failed attempts now have rows).
- `providers/anthropic.ts`: P11's round loop (AL-5 repair, `roundOpened`, classifier) with P22's
  `thinkingParam` (P13), message id, round clocks, in-flight `call_usage` on a stop and per-round
  `call_usage`; `failedRequestUsage` on every thrown failure.
- `providers/gemini.ts`: P11's finish mapping (`roundFinish` undefined when absent, block / no-finish
  throw); the round's `call_usage` moved **after** those checks, so a blocked or unfinished request
  has only the gateway's failed row.
- `providers/gateway.ts`: row writing as above.
- `services/turn/streamAndCollect.ts`: P11's file (gateway, hop, `interrupted`, `blocked`) + P22's
  clocks, `call_usage` case, sum of calls, `calls`/`clocks` in the error settle.
- `services/turn/forcedAnswer.ts`: through `gateway.call` with `callRole: 'forced_answer'`; the one
  request's `lastRequest` kept (as P22 did).
- `services/turn/turnState.ts`: P22 `calls`/`clocks` + P11 `served`/`fallback`/`refusalCategory`.
- `services/generation.ts`: P22 `finished` + P11 hop builder; the `chat_turn_finished` line names
  the answering model after a hop.
- `arcnave-frontend/src/workspace.tsx`: P11's `done.fallback` and `model_switch` patches use P22's
  `runChat` (they follow a forked regenerate).
- `test/turnCharacterizationPaths.integration.test.ts`: union of imports.
- `settleTx` order (P08) untouched: P22's ledger step and P11's `refusal_category` / fallback
  columns are written inside the existing named steps.
- P13: helper rows (`role: 'helper'`) never in `nextInChain` (registry `availableEntries` excludes
  them) and never through `gateway.stream`; helper calls keep `helperJobs.record` rows.
- Data map: P11 adds no table (columns only); `dataMap.test.ts` passes.

## 3. Migration journal and snapshot

`0033_fallback_and_refusal`: journal idx 33, `when` 1792700000000 (> 0032's 1792600000000).
Snapshot regenerated: 0033 journal entry, snapshot and SQL moved aside, `npx drizzle-kit generate
--name fallback_and_refusal`; the generated SQL is the same three `ALTER TABLE … ADD COLUMN`
statements as P11's (P11's adds the two `SET LOCAL` lines, N-70) → P11's SQL kept, new snapshot
kept (`prevId` = 0032's `ed328ad6-…`, id `0df27ca0-…`), `when` restored. No repeated number
prefix in `drizzle/` or `docs/decisions/`.

## 4. Characterization snapshots (re-recorded with `-u` after the code was resolved)

`turnCharacterizationPaths` .snap taken from HEAD, then re-recorded; every remaining diff read
against both parents:

- **goldenRequests**: identical to P11's (SD-9a `safetySettings` on every Gemini request); vs HEAD
  only that.
- **turnCharacterization**: vs HEAD — P11 `safetySettings` (2 requests); "a refused turn"
  `finishReason`/`status` → `blocked` (P11 M-14); **"a transient failure is retried, then
  succeeds": turn usage `exact:false`, zeros (merge: the failed attempt now has its own `none`
  row)**. vs P11 — P22's regenerate entry ("keeps the earlier answer as a version", `ack.chatId`,
  version block) and the same retry row change.
- **turnCharacterizationPaths** (23 entries both sides): vs P11 — P13's `history window` stage in
  place of `compaction`, stage numbers shifted, timing JSON without `before_compaction` /
  `compaction` / `compacted`; **(4) context overflow re-sent and (8b) forced-answer request fails:
  turn usage `exact:false` zeros (merge: the failed request has a `none` row)**. vs HEAD — P11's
  (R) blocked, (9) model_switch + Sonnet rebuild, (8d) renamed "saved as stopped" (old entry
  removed), long texts with the Sonnet system prompt, plus (4) and (8b) as above.

No other change.

## 5. Gates (sequential, one suite at a time; tree hash equal before and after the full run)

| Gate | Command | Result |
|---|---|---|
| Test DB hygiene | `drop database if exists arcnave_test with (force)` before the merge | dropped; recreated by the suite |
| Backend typecheck | `cd backend && npx tsc --noEmit` | clean |
| Backend suite | `npx vitest run` | **159 files, 1,840 passed, 23 skipped, 0 failed** (632 s) |
| Snapshots + fallback, second run | `npx vitest run src/test/turnCharacterization*.ts src/test/goldenRequests.integration.test.ts src/routes/fallback.integration.test.ts` | 62/62 |
| New hop ledger tests, mutation | gateway failed-row write disabled | both new tests fail (2/14), restored |
| OpenAPI | `npm run openapi` | regenerated; equal to the merged file (P11's `fallbackFrom` / `fallbackReason`, `GET /status`) |
| Frontend | `npx tsc -b`; `npx vite build`; `npx vitest run` | clean; built (chunk-size warning as before); **46 files, 454 passed** |

New tests (`backend/src/routes/fallback.integration.test.ts`):
- "a hop writes one ledger row per model, priced separately, and the turn row is their sum":
  Gemini quota failure that reported 7 input tokens → row 1 `google` / `fake-flash`, attempt 1,
  `provider_partial`, 7/0; row 2 `anthropic` / `fake-sonnet`, attempt 1, `provider`, 10/2,
  `providerRef` kept; usage row on Sonnet 5.5 with 17/2 exact, both rows linked to it, cost = the
  rows' sum (null if one is unpriced); label stored.
- "Gemini 503 ×3 → Sonnet …": Gemini attempts 1, 2, 3 (`none`, `error`, zeros, inexact), Sonnet
  attempt 1 exact, ordinals 1–4; the turn row `exact:false`, zeros, cost null.

## 6. Migration checks

**(1) Empty database** `arcnave_mig_empty`: `DATABASE_URL=postgres://arcnave:arcnave@localhost:5432/arcnave_mig_empty npm run db:migrate`
twice → "migrations applied" both times; `drizzle.__drizzle_migrations` 34 rows, max `created_at`
1792700000000 after each (the second run applied nothing); `messages.fallback_from`,
`fallback_reason`, `history_turns`, `usage_records.refusal_category` present; `model_calls`
partitions `model_calls_default`, `model_calls_y2026m10`, `model_calls_y2026m11`.

**(2) Seeded copy** `arcnave_mig_seed`: migrated to 0029 with `65abe65`'s `backend/drizzle`
(`git archive 65abe65 backend/drizzle` into a scratch dir, this branch's `src/db/migrate.ts` run
from there: 30 rows, max `when` 1792300000000). Seed SQL:

```sql
INSERT INTO users (id, email) VALUES ('11111111-1111-1111-1111-111111111111', 'seed@example.test');
INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Seeded chat', now() - interval '3 hours', now() - interval '3 hours');
INSERT INTO messages (id, chat_id, user_id, seq, role, text, status, created_at) VALUES
  ('33333333-0000-0000-0000-000000000001', '22222222-…', '11111111-…', 0, 'user', 'Hello', 'complete', now() - interval '3 hours'),
  ('33333333-0000-0000-0000-000000000002', '22222222-…', '11111111-…', 1, 'assistant', 'Hi there', 'complete', now() - interval '3 hours'),
  ('33333333-0000-0000-0000-000000000003', '22222222-…', '11111111-…', 2, 'user', 'Tell me more', 'complete', now() - interval '2 hours'),
  ('33333333-0000-0000-0000-000000000004', '22222222-…', '11111111-…', 3, 'assistant', 'Partial text', 'generating', now() - interval '2 hours');
INSERT INTO usage_records (id, user_id, request_id, model_alias, provider, provider_model_id, started_at, message_id, chat_id,
  input_tokens, output_tokens, total_tokens, tokens_exact, cost_usd, status) VALUES
  ('44444444-0000-0000-0000-000000000001', '11111111-…', 'req-seed-1', 'Gemini 3.8 Flash', 'google', 'gemini-3.8-flash',
   now() - interval '3 hours', '33333333-…-0002', '22222222-…', 120, 30, 150, true, 0.000123, 'complete');
INSERT INTO usage_counters (user_id, period_kind, period_start, tokens_used, tokens_reserved) VALUES
  ('11111111-…', 'day', date_trunc('day', now()), 150, 4096);
INSERT INTO attachments (id, user_id, filename, mime_type, size_bytes, storage_key, message_id) VALUES
  ('55555555-0000-0000-0000-000000000001', '11111111-…', 'notes.txt', 'text/plain', 12, 'ab12/seed/notes.txt', '33333333-…-0001');
```

(ids shortened here; the run used the full literals.) Every row was read with `row_to_json` before
and after this branch's `npm run db:migrate`, then compared key by key.

| Check | Result |
|---|---|
| 0030–0033 applied | journal ids 31–34, `when` 1792400000000 … 1792700000000 |
| Old rows untouched | users/chats/messages (4)/usage_records/usage_counters/attachments: 0 changed values |
| New nullable columns null, not 0 | messages `fallback_*`, `history_*`, `ctx_*`, `over_budget`, `summary_version`, `prompt_version`, `registry_version`: all null on all 4 rows; usage_records `price_version`, four clocks, `output_tps`, `refusal_category`: null |
| price_table | 0 rows after the migration (by design, ADR-0079: rows at boot). The boot step `pricing.syncTable` run once, then again: 15 rows each time (Sonnet 4, Opus 4, Haiku 4, Gemini 3), idempotent |
| model_calls partitions | DEFAULT + 2026-10 + 2026-11 |
| pre-0030 `generating` row (ADR-0078 §8) | left `generating` by the migration; the boot sweep (`sweepTurns`) → `status error`, `error_code interrupted`, text "Partial text" kept, `legacyRowsMarked: 1`; a second sweep marks 0 |
| `chats.title_source` (ADR-0080) | no backfill: the existing chat reads `default` (column default), so the title job's CAS on `prompt` never renames a pre-0032 chat |
| usage_counters | `tokens_used` 150, `tokens_reserved` 4096 unchanged (see risk 4) |

The boot steps were run with a scratch script (`buildServices(config())`, `pricing.syncTable`,
`sweepTurns`) against `arcnave_mig_seed` only; nothing in the repo.

## 7. Open risks

1. **Any retried turn now shows no counts and no cost.** A 429/503 rejected before the stream
   opened has no provider usage, so its row is `none` with zeros and the turn is `exact:false`,
   cost null (Invariant 3; the brief's rule). Before the merge P22 had no row for a retried
   attempt. If the owner accepts "an HTTP error before the stream opened bills nothing" as a
   provider fact (to be checked against the Claude and Vertex billing docs), such rows could be
   `exact: true` zeros — not done (ours, needs a source).
2. `completed.usage` and `ProviderError.partialUsage` still carry P11's cumulative AL-1 figure,
   which nothing settles from now; a future reader could mistake it for the turn total.
3. Gemini's INVALID_ARGUMENT re-open of a round (P22 code) sends a rejected request without a row.
4. Pre-0030 `usage_counters.tokens_reserved` (4,096 in the seed) has no `budget_reservations` row,
   so no sweep releases it; it ages out with its period only (P08, not this merge).

## For the orchestrator (proposed lines; not written by this agent)

- **mistakes.md** (changelog, no new heading): "2026-10-17 (tech-p05 wave-2 merge) — Two wave-2
  packages each built a per-request usage record (P22 `call_usage` per round, P11 `AttemptCall`
  per attempt, with a cumulative `partialUsage`); wired side by side they count every earlier
  round of a failed attempt twice. Rule: when two producers describe the same request, pick one
  source per request and give the error the failed request's own counts
  (`ProviderError.failedRequestUsage`), never a running total. Verify:
  `npx vitest run src/routes/fallback.integration.test.ts` (hop: 2 rows, turn = sum)."
- **CURRENT.md**: "Wave 2 merged on `build/turn-jobs` (P22 → P13 → P11): the gateway writes every
  provider request as a `model_calls` row (attempt, model, provider per row; failed attempts
  `provider_partial` / `none`); a hop is priced per model, turn row = sum, label stored.
  Migrations 0030–0033 checked on an empty and a seeded DB. Backend 1,840 passed / 23 skipped,
  frontend 454. Not pushed, not deployed."
- **DEFERRED.md**: close "wire P11 attempts to `recordCalls`" and "`attempt` numbering from the
  gateway". Open: owner call on risk 1 (retried turn shows no counts); drop the cumulative AL-1
  figure from `completed` / `partialUsage` once the matrix test reads the rows; Gemini
  INVALID_ARGUMENT re-open without a row; legacy `tokens_reserved` with no reservation row.
