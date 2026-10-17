# P08 result — durable runs, one turn per chat

Task: tech-p05 wave 1, NEW-PLAN P08. Branch `build/turn-jobs`, base `65abe65`. Decision:
[ADR-0078](../decisions/0078-durable-turns.md) (ADR-0009 amended by a note). Live checklist:
[`p08-live-checklist.md`](p08-live-checklist.md). Model used: Opus 5.5 (one agent, no sub-agents).

## DONE / SKIP

| Item (wave plan §2 P08) | State | Where |
|---|---|---|
| `turns` table + `uq_turns_running_chat`; start under `FOR UPDATE` on the chat; 23505 → 409 | DONE | `drizzle/0030_durable_turns.sql`, `services/turn/turnStart.ts` |
| Lease 30 s / heartbeat 10 s / cancel check 2 s, fenced; Stop + chat delete + account delete set `cancel_requested`; `activeRuns` removed | DONE | `services/turn/turnLease.ts`, `routes/chats.ts`, `routes/account.ts`, `container.ts` |
| Throttled fenced flush (text, thinking, segments, `last_seq`), `TURN_FLUSH_MS` 1,000 (ours) | DONE | `turnLease.ts` `flush`, `streamAndCollect.ts` |
| Sweeper (boot + 60 s): expired leases, expired reservations, idempotency keys > 24 h, pre-0030 `generating` rows | DONE | `turnStore.sweepTurns`, `index.ts` |
| RunHub keeps each run's promise; `drain()` 5 s, 503 during drain, hard exit 9 s | DONE | `services/runHub.ts`, `services/shutdown.ts`, `index.ts` |
| Idempotency-Key end to end; frontend one UUID per send, reused on network retry | DONE | `turnStart.ts`, `routes/chats.ts` `peekIdempotent`, `arcnave-frontend/src/adapter.ts` |
| Precheck before the user message: budget 402, named model 400 | DONE | `services/turn/turnGate.ts` |
| Reservation N-74 in the start tx, lowered by the context build, held through the forced answer | DONE | `usage.ts` `reserve` / `adjust`, `turnContext.ts` |
| `ack` frame first | DONE | `services/turn/launch.ts` |
| One settle tx in the fixed order; `budget_reservations` with owner + expiry; styles reservation owner `utility` | DONE | `turnStore.settleTurnTx`, `routes/styles.ts` |
| Regenerate guarded in one tx (A-04) | DONE | `turnStart.resetForRetry` |
| SSE: `Last-Event-ID` beats `?after=`, named `ping` 15 s, `snapshot` + 250 ms poll, send timeout 15 s, 60 s session + chat re-check | DONE | `routes/turnStream.ts` |
| Frontend: jitter 1/2/4/8/16 s × 5, "Reconnecting…" banner + Retry, refetch on foreground, controller per chat, ping ignored, Last-Event-ID | DONE | `adapter.ts`, `workspace.tsx`, `App.tsx`, `Composer.tsx` |
| DB timeouts via `pgOptions` (harness too); `SET LOCAL` 30 s for retention, export, file-job commit, sweeper; 57014 / 55P03 / 53300 → 503 `unavailable` + Retry-After 5; settle retried ≤ 2 on 40001 / 40P01; migration N-70 `SET LOCAL` | DONE | `db/client.ts`, `app.ts`, `retention.ts`, `routes/account.ts`, `fileJobs.ts` |
| `turns.params` + `loadTurnInput`, used by the route | DONE | `turnStore.loadTurnInput`, `launch.ts` |
| DEFERRED: foreign attachment → 404; `loadTurnAttachments` ordered by `array_position`; usage row after `start` | DONE | `turnStart.ts`, `turnStore.ts` |
| A-21 advisory locks, A-22 lost updates outside the turn, durable `turn_stream_events` | SKIP (split, ADR-0078) | — |

## Evidence per exit test

All in `backend/src/routes/durableRuns.integration.test.ts` (two `createTestApp` instances, A and B,
on one database) unless named otherwise. Run three times in a row alone: 16/16 each time.

| Exit test | Test | Result |
|---|---|---|
| (a) send/send, send/regenerate, regenerate/regenerate across apps → one 200 + one 409 | `(a) …` ×3 | pass; the refused one is `run_in_progress`, two turns total, both `done` |
| (b) kill → sweeper → interrupted, text kept, usage exact:false / costUsd null, reservation expired, `tokens_reserved` 0, late settle fenced | `(b) a killed instance` | pass (the dying app's pool is ended with `sql.end`) |
| (c) Last-Event-ID k → k+1 only; header beats `?after=`; lost gap → snapshot; reattach on B → snapshots then end | `(c) …` ×3 (`RUN_BUFFER_MAX_EVENTS=3` for the gap) | pass |
| (d) same key sequential + parallel → same message id, one pair of rows, one provider call; different body → 409 | `(d) …` ×3 | pass |
| (e) drain waits for settle within budget; generate during drain → 503 | `(e) drain` | pass (`settled: true`, turn `interrupted` / `server_shutdown`, reservation `settled`) |
| budget refusal 402, no rows; named-model 400; ack first; ping arrives; deleted session → 401 frame | `frames and refusals` ×5 | pass |
| unit: pg error code table → 503 | `services/turn/turnSettle.integration.test.ts` | pass (table + a real lock wait past `lock_timeout` → 503 `unavailable`, `Retry-After: 5`) |
| unit: settle tx rollback | same file | pass (a failing usage step leaves the message `generating`, the turn `running`, the reservation `held`, the counters unchanged) |
| frontend adapter: Last-Event-ID, jitter bounds + 5 attempts, ping ignored, key reused | `arcnave-frontend/src/adapter.test.ts` "P08 reconnect contract" ×5 | pass |
| frontend workspace: two chats in parallel; Stop on one does not stop the other | `arcnave-frontend/src/workspace.test.tsx` | pass |

Mutation check (recorded, not kept): removing the fencing-token comparison in `settleTurnTx` leaves
(b) green, because the state check (`turns.state` no longer active after a takeover) fences the
late settle too. The token is the guard for a turn that is re-queued to another owner (the Cloud
Tasks seam); today state and token fence together.

## Gates (tree frozen during each run)

| Gate | Command | Result |
|---|---|---|
| Baseline (HEAD `65abe65`, separate worktree + database, before any edit) | `npx vitest run` | 146 files, 1,643 passed, 23 skipped, 0 failed |
| Backend typecheck | `cd backend && npx tsc --noEmit` | clean |
| Backend suite (final tree, sequential, tree hash equal before/after) | `npx vitest run` | **148 files passed, 1,662 passed, 23 skipped, 0 failed** (525 s) |
| — the run before it | same | 1 suite failed at teardown only: `migrate.integration.test.ts` `drop database … with (force)` → "permission denied to terminate process" (its 5 tests passed); alone 5/5 twice, then green in the final run. Environment, not code (mistakes.md 2026-10-16: a run's flake is rerun alone before it is called red). |
| New exit test, three times alone | `npx vitest run src/routes/durableRuns.integration.test.ts` | 16/16 ×3 |
| Snapshots, twice after `-u` | `npx vitest run src/test/turnCharacterization*.ts` | 37/37 ×2 |
| Migrations on an empty database | `DATABASE_URL=…/arcnave_p08_empty npm run db:migrate` | `migrations applied`; `\d turns` shows the partial unique index |
| OpenAPI | `npm run openapi` | `docs/openapi.json` regenerated (generate: headers + description) |
| Frontend typecheck | `cd arcnave-frontend && npx tsc -b` | clean |
| Frontend build | `npx vite build` | built (chunk-size warning only, as before) |
| Frontend suite | `npx vitest run` | **45 files, 428 passed** |

## Characterization snapshots re-recorded (`-u`, only these two files)

`src/test/__snapshots__/turnCharacterization.integration.test.ts.snap` (13 entries) and
`turnCharacterizationPaths.integration.test.ts.snap` (22 entries). Diffs were read with a script
that drops the `ack` frame and ignores UUID renumbering (the new turn id shifts every
`<uuid-n>` after it); what remains, entry by entry:

- **Every entry with a run**: an `ack` frame first (`{turnId, messageId, userMessageId}`), and the
  UUID numbering after it moves by the ids it introduces. Nothing else in the 13 + 15 entries below.
- **`turn-start refusals`**: "their file" (another user's attachment) was a 200 turn run without the
  file; it is now **404 `not_found`** and writes no rows (`again` chat keeps its title "New
  conversation", no messages, no usage). DEFERRED Part C, decided here.
- **Paths, effects order** (all turn entries: 1, 3–7, 9, 11–14, P, R, 2): `usage.reserve` moves
  before `run.start` (it is in the start transaction now), and `usage.record` comes before
  `usage.release` (the settle order: usage row and counters, then the reservation).
- **(8a)–(8d) forced answer**: `usage.release` moves after the forced-answer frames: the
  reservation is held through the forced answer (DEFERRED review gate 0).
- **(10) budget**: the second send is **HTTP 402** (`budget_exceeded`, meta `{period, used, limit}`)
  with no frames, no user/assistant rows, no turn log; counts `reserve` 2→1, terminal events `[1, 1]`
  → `[1, 0]`, workspace create/cleanup 2→1. The counters in `extra` are unchanged. Test code changed
  in one assertion (the error frame → the 402 body), and the reserve spy returns the new value.
- **(15) no adapter / (16) capability_unavailable**: `reserve` 0→1 (resp. 0→2) and `release` 0→1
  (0→2): the hold is taken at start and given back by the failed turn's settle.
- **(L) limitToModel fails**: the failure after `start` now writes a **usage row** (`exact: false`,
  zeros, `costUsd` / `costInr` null, `error` / `internal_error`; DEFERRED scenario L), and `record`
  0→1; `usage.release` after it.

`runResume`, `stopThenGreeting` and the usage write-order tests did not change; the golden requests
snapshot did not change (no provider request changed).

## OWNER ITEMS

- None blocking. Values marked "ours" for the owner to confirm or replace: `TURN_FLUSH_MS` 1,000,
  `SHUTDOWN_HARD_EXIT_MS` 9,000, `DB_RETRY_AFTER_S` 5, `RUN_BUFFER_MAX_EVENTS` 50,000 (was a constant).
- Behaviour change to confirm live: a named model that this deployment cannot serve at all is now
  a 400 before the send; Auto unchanged.

## Mistakes made in this task

1. A test fixture's budget (10 tokens) was below the cost I assumed for one fake turn (8 tokens is
   what `deltas(1)` reports, so 10 was not yet spent): derive a fixture's numbers from what the
   fake reports, not from memory. Caught by the first run.
2. The workspace test's session mock returned a new `user` object on every render; the provider's
   load effect depends on `user`, so it reloaded forever and `act` never settled (a timeout, not an
   error). A mocked hook must return stable identities.
3. The first fencing mutation check passed: the state check fences too. A mutation check must
   remove every guard of the property, or say which one it isolates.

## For the orchestrator (proposed lines; not written by this agent)

- **mistakes.md** (changelog line, no new heading): "2026-10-17 (tech-p05 P08) — A mocked React
  hook that returns a fresh object per render (`useSession: () => ({ user: {...} })`) made a
  provider's `[user]` effect reload forever and `act` hang until the test timeout. Rule: a hook mock
  returns one stable object. Verify: `arcnave-frontend/src/workspace.test.tsx` finishes in < 1 s."
- **CURRENT.md**: "P08 durable runs (ADR-0078) on `build/turn-jobs`: turns table + lease/fencing,
  one settle tx, sweeper, drain, Idempotency-Key, SSE `ack`/`snapshot`/`ping`/Last-Event-ID,
  N-45 DB timeouts, frontend jitter reconnect + controller per chat. Migration 0030. Not deployed."
- **DEFERRED.md**: close CR2 (`appendTurn` unlocked `max(seq)`), Part C "foreign attachmentId
  skipped" and "`loadTurnAttachments` no ORDER BY", review-gate-0 "reservation held on failures
  between reserve and stream", scenario (L) "failure after start writes no usage row". Add: A-21,
  A-22 (split from P08); `queued` state unused until an out-of-process executor; the forced answer
  still bypasses the retry wrapper (P11).
