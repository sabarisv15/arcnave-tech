# ADR-0009: A generation run outlives the connection that started it

- Status: accepted; amended by [ADR-0078](0078-durable-turns.md) (2026-10-17): a reconnect on
  another instance now gets a `snapshot` of the stored reply, SIGTERM drains and settles runs as
  `interrupted`, and reconnect timing is N-46's. The text below is the decision as made.
- Date: 2026-09-24
- Supersedes: the "client disconnect aborts the run" behaviour described in
  `backend/src/routes/chats.ts` (its header comment, until this commit) and the
  `POST /chats/:id/generate` description ("Disconnecting cancels the underlying provider call").

## Context

A document turn runs for minutes. The run was tied to the HTTP socket: when a phone's network
dropped or a tab went to sleep, the backend aborted the provider call and every tool call in
flight. The user saw "Connection interrupted", and all of that work was lost. Claude and ChatGPT
keep generating on the server and show the reply when the user comes back.

## Decision

1. `POST /chats/:id/generate` starts the run detached. The run publishes each stream event to a
   per-chat buffer (`services.runHub`, `backend/src/services/runHub.ts`). The request that
   started it is only its first subscriber.
2. Every SSE frame carries an `id`: its index in the run. `GET /chats/:id/stream?after=N`
   replays the frames after `N` and then streams live frames until the run ends. A finished
   run stays replayable for 5 minutes, so a late reconnect still gets `done` or `error`.
3. Closing a connection only unsubscribes it. A run is aborted only by `POST /stop`, a chat
   delete, shutdown, or the turn deadline.
4. The frontend reconnects from the last frame id when a stream ends without `done`/`error`.
   It retries for about two minutes. A transcript load that finds a reply still `generating`
   reattaches to it. A `404 no_active_run` means this instance holds no run; the client then
   polls the persisted message.

## Consequences

- **Cloud Run must not throttle CPU outside requests** (`--no-cpu-throttling`). Otherwise a
  detached run stalls once no request is open. See `docs/deploy/warm-sandbox.md` §4.
- The buffer is in-process, like `activeRuns` was. A reconnect that reaches another instance gets
  `no_active_run` and falls back to reading the database. While the run is going, that shows no
  partial text: generation persists the text only at the end. Multi-instance live resume needs
  a shared bus, which is not built.
- An instance that shuts down still aborts its runs (SIGTERM). The rows end as `stopped`, as
  before.
