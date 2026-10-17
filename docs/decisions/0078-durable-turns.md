# ADR-0078: Durable runs, one turn per chat

- Status: accepted (task tech-p05 wave 1 = NEW-PLAN P08). Tested offline; not merged, not deployed.
- Date: 2026-10-17
- Task: P08 ([`docs/ops/p05-wave-plan.md`](../ops/p05-wave-plan.md) §2). Evidence:
  [`docs/ops/p08-result.md`](../ops/p08-result.md). Live checklist:
  [`docs/ops/p08-live-checklist.md`](../ops/p08-live-checklist.md).
- Amends: [ADR-0009](0009-runs-outlive-connections.md) (see "Amendment to ADR-0009" below; ADR-0009
  itself is not rewritten).
- Supersedes in part: [ADR-0067](0067-turn-code-split-by-stage.md) / [ADR-0073](0073-turn-generator-split-into-stage-generators.md)
  for the settle step only ("moved unchanged": the settle is now one transaction in a fixed order),
  and the "one run per chat is `services.activeRuns`" statement in `container.ts` (removed).
- Models used: Opus 5.5.

## Stage decisions applied

Stage 3 1.4 (Idempotency-Key), 1.6 (budget / policy before the user message is saved), 1.7
(turn table, one running turn per chat), 1.8 (typed `ack`), 6.1 (one settle), 7.3 (sweeper /
drain); Stage 4 D8, H10 (DB timeouts); Stage 5 TB3, F3b (reconnect jitter); Stage 10 AO-4b (DB
lease + cancel flag), RG6 (a controller per chat in the tab); Stage 14 D-26 (`Last-Event-ID`,
`snapshot`, named `ping`, send timeout), D-29 (60 s session re-check); Stage 15 ER-6a, ER-10a,
ER-10c; Stage 19 S19-18 (SIGTERM inside Cloud Run's 10 s); D3 A-01–A-06; K-13. Numbers: N-24,
N-34, N-43, N-45, N-46, N-70, N-73, N-74, N-76 (`backend/src/config/numbers.ts`, `// --- P08`).

## Claude

- **Stream keep-alive.** The Claude Messages API stream "may also include any number of `ping`
  events" (`event: ping` / `data: {"type": "ping"}`;
  https://platform.claude.com/docs/en/build-with-claude/streaming, "Ping events", read 2026-10-17).
  ArcNave's named `ping` frame has the same name and body. It carries no `id:`, so it never moves a
  client's resume position.
- **Interrupted streams.** The same page's "Error recovery" section resumes an interrupted response
  by asking the model to continue from the partial text. ArcNave does not re-ask the model: the
  run continues on the server and the client reattaches to it. ArcNave differs on purpose (the
  stage decisions above; no second billed call for a dropped connection).
- **Turn table, lease, fencing, sweeper, Idempotency-Key, drain.** No Claude-published equivalent
  was found; these are Stage 3 / 10 / 15 / 19 decisions (ADR-0071: the stage wins). The specific
  mechanisms below that the stages do not fix (fencing token, `SKIP LOCKED` sweep, take-over at
  start) are labelled ours.

## Decision

1. **`turns`** (migration `0030_durable_turns`): one row per turn with `kind` send / regenerate,
   `state` queued / running / done / cancelled / failed / interrupted, `finish_code`, `params`
   (ids and enums only: mode, model alias, attachment ids, effort, style, platform, project, and
   the resolved model once `start` is sent; never the prompt), `fencing_token`, `lease_owner`,
   `lease_expires_at`, `heartbeat_at`, `cancel_requested`, `deadline`, `last_seq`. The partial
   unique index `uq_turns_running_chat (chat_id) WHERE state IN ('queued','running')` is the rule
   "one running turn per chat", on every instance.
2. **Start** (`services/turn/turnStart.ts`): every start takes `FOR UPDATE` on the chat row (it was
   taken only with files, and `max(seq)` was read unlocked: DEFERRED CR2), checks the
   Idempotency-Key, then the active turn (a lapsed lease is taken over first, ours), then writes the
   user + assistant pair (or resets the regenerated row with
   `UPDATE … WHERE status <> 'generating' RETURNING`, A-04), the turn, the budget reservation and the
   key, in one transaction. A 23505 on `uq_turns_running_chat` or `uq_message_seq` is 409
   `run_in_progress`. An attachment id the caller does not own is 404 (DEFERRED Part C).
3. **Precheck** (`turnGate.ts`) before anything is written: preferences, the budget (402
   `budget_exceeded`) and an explicitly named model this deployment cannot serve (unknown alias, or
   not configured: 400 `model_unavailable`). A configured model that fails at call time keeps its
   current path (P11). Auto is resolved when the turn runs.
4. **Lease and cancel** (`turnLease.ts`): heartbeat 10 s, lease 30 s, cancel check 2 s (N-73), every
   runner write fenced on `fencing_token`. Stop, chat delete and account delete set
   `cancel_requested` (the instance running the turn stops within 2 s) and abort a local run at once.
   `services.activeRuns` is removed.
5. **Flush**: the answer so far (text, thinking, segments) and `turns.last_seq` are written at most
   every `TURN_FLUSH_MS` = 1,000 ms (ours, no N-id). Tool calls stay persisted per call.
6. **One settle transaction** (`turnStore.settleTurnTx`), used by success, a provider error, a
   failure outside the stream (`failTurn`) and the sweeper, in this order: lock turn + fence check →
   message → sources → usage row → counter commit → reservation → turn state → `chats.updated_at`.
   Retried whole at most twice on 40001 / 40P01 (N-45). A failure after `start` writes a usage row
   `exact: false`, zeros, `costUsd` null (DEFERRED scenario L).
7. **Reservations** (`budget_reservations`): owner `turn` or `utility` (styles from samples),
   status held / settled / released / expired, `expires_at` = turn deadline + one lease (N-43 +
   N-73), and the counter periods they were taken from (a turn across midnight gives back to the day
   it reserved from). The turn reserves N-74's default ceiling at start; the context build lowers it
   to the model's real ceiling. It is held through the forced answer (DEFERRED, review gate 0) and
   ended by the settle.
8. **Sweeper** (`sweepTurns`, boot + every N-76 60 s, `SKIP LOCKED`): turns whose lease lapsed →
   `interrupted`, token bumped (the old runner is fenced out), message `error` / `interrupted` with
   the flushed text kept, usage `exact: false` zeros `costUsd` null when a model was resolved,
   reservation `expired`; held reservations past `expires_at` → expired; idempotency keys older than
   N-34 24 h deleted; assistant rows from before 0030 still `generating` past the turn deadline →
   `error` / `interrupted` (partial index `ix_messages_generating`).
9. **Drain** (`services/shutdown.ts`): SIGTERM refuses new generates (503 `server_shutdown`), aborts
   every local run with reason `server_shutdown`, waits up to N-73 5 s for each to settle (turn
   `interrupted`, finish `server_shutdown`), then closes the server and the pool; the process exits
   by force at 9 s (ours, under Cloud Run's 10 s).
10. **Idempotency-Key** on `POST /chats/:id/generate`: the key row `{turnId, assistantMessageId,
    userMessageId}` is written in the start transaction. Same key + same body (chat id + body) →
    reattach to that turn (hub, or `snapshot`), nothing new written, one provider call; another
    body → 409 `idempotency_conflict`. The frontend makes one UUID per send and reuses it when the
    POST itself fails on the network.
11. **SSE** (`routes/turnStream.ts`): `ack` `{turnId, messageId, userMessageId}` is the first frame
    of every run. `Last-Event-ID` wins over `?after=`. When the hub lost the gap, or the run is on
    another instance or ended, a `snapshot` frame (the stored assistant row with its tool calls,
    `id:` = `turns.last_seq`) is sent, then the row is polled every 250 ms (N-73) until the turn
    ends. Named `ping` every 15 s (N-24) without an id, replacing the `: heartbeat` comment; a frame
    the socket has not taken within 15 s ends the connection (N-73); every 60 s the session and chat
    are re-checked, and a revoked session ends the stream with an `error` frame `unauthorized`, a
    deleted chat with `not_found`.
12. **DB timeouts** (`db/client.pgOptions`, shared with the test harness): statement 5 s, lock 2 s,
    idle in transaction 30 s, connection lifetime 1,800 s (N-45). The retention sweep, account
    export, file-job commit and turn sweep raise the statement timeout to 30 s with `SET LOCAL`.
    SQLSTATE 57014 / 55P03 / 53300 → 503 `unavailable` with `Retry-After: 5` (ours: 5). Migration
    0030 sets N-70's `lock_timeout` 5 s and `statement_timeout` 300 s with `SET LOCAL`.
13. **`loadTurnInput(db, turnId)`** builds the run's input from the turn row (the prompt from the
    user message row; a regenerate answers the user message before it). The route uses it, so the
    run no longer depends on the request that started it (seam for the deferred Cloud Tasks
    executor, D-G3-02).
14. **Frontend**: reconnect with full jitter over 1 / 2 / 4 / 8 / 16 s, 5 attempts (N-46), replacing
    the fixed delays; a "Reconnecting…" banner with a manual Retry; a refetch when the tab returns
    to the foreground; one AbortController per chat (Stop on one chat does not stop another); `ping`
    ignored; `Last-Event-ID` sent on every reattach; `snapshot` replaces the row.

New error codes: `interrupted`, `server_shutdown`, `unavailable` (503 each); `idempotency_conflict`
and `budget_exceeded` already existed.

## Amendment to ADR-0009

ADR-0009's "Consequences" said a reconnect on another instance gets `no_active_run` and the
persisted message shows no partial text, and that SIGTERM ends rows as `stopped`. From this ADR on:
a reconnect on another instance gets a `snapshot` of the flushed row and follows it to the end;
`no_active_run` means the chat has never had a turn; SIGTERM ends a run `interrupted` /
`server_shutdown` after it settled. Decisions 1–4 of ADR-0009 stand (run detached from the socket,
frame ids, explicit stop, client reconnect), with the reconnect timing now N-46's.

## Deviations from the plan (written reasons)

- **`queued` is unused for now.** A turn is inserted `running` with this instance's lease, since
  this process runs it at once. `queued` stays in the state set for the out-of-process executor.
- **Precheck refuses only a named model that cannot be served at all** (unknown or not configured).
  Refusing a configured model whose last call failed would change the routing path that P11 owns.
- **The ping body is `{"type":"ping"}`** (the Claude API's), so the client's frame parser needs no
  special case beyond ignoring the type.

## Split out (follow-up, not P08)

- A-21: advisory locks for the retention and checkpoint sweeps beyond what exists.
- A-22: lost updates outside the turn (memory, password change, `PATCH`, file delete).
- A durable `turn_stream_events` table stays deferred; the `snapshot` frame stands in for it.
- The forced answer still bypasses the retry wrapper (P11).

## Consequences

- A turn's rows land together or not at all; a killed instance leaves an `interrupted` turn with
  its flushed text, found by the next sweep (≤ lease + 60 s) or at once by the next start on that chat.
- Every start costs one more insert (the turn) and one reservation row; every second of streaming
  at most one fenced flush.
- Tests run under production's statement and lock timeouts.
- Characterization snapshots changed (the `ack` frame, the settle order, the 402 refusal); each
  change is listed in `docs/ops/p08-result.md`.

## Amendment (2026-10-17, p05 review round 1, `docs/ops/p05-review.md`)

Decisions 2, 4, 6, 8, 11 and 12 are amended as follows; the text above is kept as decided.

- **Lock order (6, 8).** The settle now locks the chat first, in a start's order (the family's
  root, then the chat, then the turn): settle → chat → turn fence check → message → … The sweeper
  selects lapsed turns unlocked, then per turn takes the chat (`SKIP LOCKED`), then the turn
  (`SKIP LOCKED`). Turn-first locking deadlocked a Stop-then-Send (40P01, reproduced).
- **Start retry, 503 (2, 12).** `startTurn` is retried whole at most N-45 twice on 40001 / 40P01, as
  the settle is; 40001 / 40P01 that outlive the retries map to 503 `unavailable` with
  `Retry-After: 5`, not 500.
- **Database clock (8).** The sweeper compares `lease_expires_at` with SQL `now()`, the clock the
  lease was written on, not the app's clock.
- **Lease after settle (4).** The runner's heartbeat and cancel-check stop the moment its own settle
  commits (`TurnBinding.onSettled`); a tick in flight after that is not a lost lease.
- **Reservation on early failure (7).** `failTurn` finds the turn's held reservation by `turn_id`
  when the run's binding has none (the run failed before `loadTurnInput` returned) and settles it.
- **Stored mode on a gap (11).** A reconnect whose snapshot is older than the hub buffer's head no
  longer resumes live from the buffer (frames in between were skipped); it follows the stored row.
- **Budget counter on retried turns (6).** The counter commit is the sum of the tokens of the calls
  whose counts are exact (enforcement), even when the turn's usage row is `exact: false` with zeros
  (display, Invariant 3 unchanged). A call without counts adds nothing (never an exact zero).
