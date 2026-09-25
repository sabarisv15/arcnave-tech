# ADR-0015: A chat's sandbox files outlive the instance, as Claude's containers do

- Status: accepted. Tested locally against the real sandbox server and Postgres; not deployed.
- Date: 2026-09-25
- Amends: [ADR-0010](0010-warm-sandbox-service.md)'s "a restart loses them".
  [ADR-0012](0012-deleted-chats-purge-after-30-days.md) gains the checkpoint as one more thing a
  purged chat takes with it.

## Context

Claude's code execution (platform.claude.com, "Code execution tool"):

> Containers expire 30 days after creation. After about 5 minutes of inactivity a container is
> checkpointed, and sending a request with its ID inside the 30-day window restores it.

The warm sandbox kept a chat's workspace only in the instance: gone after 2 hours idle
(`WORKSPACE_TTL_S`), when a sixth chat needed a slot, or on any restart or redeploy. Uploaded
files came back, because the backend re-sends inputs, but everything the code had written did
not. A user who came back after lunch to change a file the model had built found it gone.

The sandbox has no network and no IAM (ADR-0007), so it cannot write a checkpoint anywhere
itself.

## Decision

1. **The backend pulls checkpoints out and pushes them back.** The sandbox server gains:
   - a listing of workspaces idle for N seconds with runs not yet checkpointed;
   - a per-workspace listing of regular files (path, size, mtime), never following links, and
     leaving out `input/` (the backend re-sends inputs) and `.tmp/`;
   - chunked read and write of one file by path, walked one component at a time with
     `O_NOFOLLOW`. A write is accepted only into a fresh workspace, one that has not run yet, so
     a checkpoint can never overwrite newer files;
   - `restored` and `saved?generation=G` markers. Each run increments the workspace's
     generation. A checkpoint that began before a run leaves the workspace marked as changed.
2. **Every minute, the backend checkpoints workspaces idle for 5 minutes**
   (`SANDBOX_CHECKPOINT_IDLE_SECONDS`), at most 5 per sweep, one instance at a time (advisory
   lock). Only files whose size or mtime changed are copied. Each file version is one stored
   object; a manifest maps paths to objects; `sandbox_workspaces` points at the manifest.
   If a run happens while the copy is in progress, that checkpoint is discarded and retried.
3. **A run restores before it runs.** When the backend holds a checkpoint for the chat, the run
   says so. A fresh workspace answers `409 restore_state`, and the backend then writes each file
   back with its saved mtime. The restore has its own time budget of 60 s plus 1 s per 10 MB,
   and the code's timeout starts only after it.
4. **Eviction prefers checkpointed workspaces.** When all slots are taken, the idle workspace
   dropped is the least recently used one whose runs are all saved. Only when every idle
   workspace has unsaved runs is unsaved work dropped.
5. **Retention.** A checkpoint is deleted with its chat's purge (ADR-0012), and otherwise
   `SANDBOX_STATE_RETENTION_DAYS` (30) after the chat last ran code. Bytes are deleted before
   rows, and a failed delete is retried at the next sweep.

## Consequences

- A chat's working files survive idle time, eviction, restarts and redeploys, for 30 days after
  it last ran code. Claude counts 30 days from the container's creation. ArcNave counts from the
  last run, so an active chat does not lose its files.
- Files written in the last 5 minutes before an instance dies are lost, as they would be between
  Claude's checkpoints.
- A restore of a large workspace takes time before the code runs. The rate in the budget is not
  measured on Cloud Run yet.
- Storage holds up to 1.8 GiB per chat that has run code, for 30 days after its last run.
- Links, sockets and names outside `[A-Za-z0-9 ._()+@,=-]` are not checkpointed. The listing
  reports how many were left out.

## Rollout

The backend deploy applies migration 0010 (`sandbox_workspaces`). The sandbox image must be
rebuilt with this `server.py` first. An old image answers a checkpoint listing with 404, which
the sweep logs as a failure, and it ignores `restoreState`.
