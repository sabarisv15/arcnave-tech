# ADR-0014: Sandbox resources per chat: memory per run, files on disk

- Status: accepted. Code tested locally; the live disk and image are pending (see "Rollout").
- Date: 2026-09-25
- Amends: [ADR-0010](0010-warm-sandbox-service.md)'s capacity. The single warm instance stays.

## Context

Claude's code execution gives each container its own 5 GiB of memory, 5 GiB of disk and one CPU
(platform.claude.com, "Code execution tool"), so one container that runs away affects only
itself. The warm sandbox (ADR-0010) is one Cloud Run instance that all chats share, and it had
two problems:

- **Files were in memory.** Cloud Run's writable filesystem is memory-backed, so every chat's
  files took memory from every chat's code. At 8 GiB and 6 workspaces, each chat got 1 GiB.
- **Memory had no per-chat limit.** One chat's code could take the whole instance. When the
  instance was killed for memory, every chat lost its files.

A sandbox per chat, like Claude's, needs routing each chat to its own instance. Cloud Run's
session affinity is best effort only, so that is an architecture change and is not made here.

## Decision

1. **Files go on a Cloud Run ephemeral disk** mounted at `/work`, which is the server's
   `WORK_ROOT` already. It is instance-local ext4, not memory, and needs no network or IAM, so
   ADR-0007's closed egress is unchanged. Cloud Run allows at most 10 GiB of ephemeral disk per
   instance. So 5 workspaces of 1.8 GiB each: ext4 metadata and the 5% reserve for root leave
   about 9.3 GiB for the workspace uids.
2. **Each run gets 3 GiB of memory.** Measured with pandas on a 500 MB CSV, the largest upload:
   1.6 GB to read and group it, 2.36 GB to read, sort, merge and write it. A 48 MB .xlsx read
   peaked at 0.7 GB. Enforced twice:
   - `RLIMIT_DATA` per process, so a single allocation past the limit fails with `MemoryError`;
   - a watchdog that sums the resident memory of the run's processes every 100 ms and stops the
     run when the total passes the limit. The result carries `memory_exceeded` and a message
     telling the model to process the file in parts.
3. **At most 2 runs at once** (`MAX_CONCURRENT_RUNS`): 2 × 3 GiB on the 8 GiB instance, with room
   for the server. A third run waits for a slot, spending its own timeout, so the backend's
   deadline still holds. If none frees up in time, it gets a retryable `503 busy`.

## Consequences

- One chat's code over its memory stops that run only. Tested in a container limited to 8 GiB:
  a run that tried to take 6 GB was stopped at 3 GiB, a 500 MB CSV pipeline in another chat
  finished, and a third chat waited 9 s and then ran. The container was not killed.
- A chat has 1.8 GiB of disk, not Claude's 5 GiB, because of Cloud Run's 10 GiB limit.
- Compared with 16 GiB of memory for 2 GiB of disk per chat, the disk costs about ₹80 a month
  instead of about ₹12,900 (Tier 1 rate, $0.000109589 per GiB-hour).
- Ephemeral disk is a Preview feature with no SLA. The user accepted that for the testing phase.

## Rollout

1. Disk: `--add-volume=name=work,type=ephemeral-disk,size=10Gi --add-volume-mount=volume=work,mount-path=/work`
   with `MAX_WORKSPACES=5,MAX_WORKSPACE_BYTES=1932735283`.
2. Image: rebuild with this `server.py` and redeploy. The defaults are `RUN_MEMORY_BYTES` 3 GiB
   and `MAX_CONCURRENT_RUNS` 2.
3. Verify live: `shutil.disk_usage("/work")` reports about 10 GB, and a 1.5 GB file writes.
