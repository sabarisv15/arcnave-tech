# ADR-0010: run_python runs on a warm sandbox service with a workspace per chat

- Status: accepted. Capacity amended by [ADR-0014](0014-sandbox-resources-per-chat.md): files
  on an ephemeral disk, 3 GiB per run, 2 runs at once.
- Date: 2026-09-24
- Supersedes: [ADR-0005](0005-cloud-run-sandbox.md)'s "one fresh Cloud Run Job execution per
  `run_python` call" as the production engine. The Job remains a configurable engine
  (`SANDBOX_ENGINE=cloud-run`). Also supersedes [ADR-0008](0008-trusted-work-runs-locally.md)'s
  statement that `run_python` stays on the Cloud Run Job. Its other rules stand: model-written
  code never runs in the backend, and trusted work runs locally.
- Takes the "warm per-chat sandbox" item from Phase 6 of the tools pipeline plan.
  ADR-0007 (no general egress) applies, and was implemented on this service on 2026-09-25.

## Context

The two failed live KVB turns (audit, 2026-09-24) spent their rounds on the sandbox, not on
the task:

- **Cold start.** Every call was a cold Job execution: 20–40 s each.
- **No state.** Nothing persisted between calls. The model re-probed libraries and re-parsed
  the PDF in every call.
- **Missing input.** Without a staging bucket, inputs over 2 MiB were silently left out. The
  4.7 MB PDF never reached the code, which then failed with "file not found" although the
  `input_files` argument was correct.

Claude's and ChatGPT's code tools work on the same kind of file because the machine is warm,
keeps the chat's files, and has the libraries.

## Decision

1. **A long-lived Cloud Run service** (`arcnave-python-runner`, `backend/sandbox/server.py`,
   `Dockerfile.service`), kept warm (min 1, no CPU throttling), reachable only through Cloud
   Run IAM by the backend's service account, with a zero-IAM runtime account.
2. **One workspace per chat**, keyed by a hash of user and chat ids. Files persist between
   calls and turns; Python variables do not. Workspaces expire after 2 h idle and are evicted
   least-recently-used when all slots are taken.
3. **Isolation between chats is enforced by the kernel.** The server runs as root; each
   workspace has its own uid and a 0700 directory. Code runs demoted, in its own session, with a
   clean environment and resource limits. Everything left running under that uid is killed and
   reaped after each call. All root-side file access uses directory descriptors with
   `O_NOFOLLOW`, so code that swaps `input/` or `output/` for a symlink cannot make the server
   read or write elsewhere. Tests: `backend/sandbox/test/test_server.py`.
4. **Inputs move by content hash, in 16 MiB chunks.** Each run names its inputs with their
   sha256. The server answers `409` with the names it lacks, and only those are uploaded. A large
   file is sent once per chat, there is no size ceiling from the transport, and nothing is
   skipped silently. The Job engine now refuses an input over its inline limit with an error.
5. **Output back.** Files the call wrote or changed in `output/` are returned to the user.
   Images written to `view/` are returned to the model as image content (Gemini 3 multimodal
   function response; Claude image blocks), at most 4 per call and 5 MB each. This lets the
   model read a high-resolution crop of a scanned page instead of guessing.
6. **The image carries the document stack**: pandas, pdfplumber, pymupdf, pypdf, python-docx,
   python-pptx, openpyxl, opencv, tesseract (eng, tam), poppler, pandoc, LibreOffice. Nothing
   is installed at runtime.
7. The model's `run_python` description is chosen by engine (`RUN_PYTHON_WARM` vs
   `RUN_PYTHON`), so it is never told "fresh each call" while its files are kept, or the
   reverse.

## Consequences

- **Capacity.** Calls take roughly as long as their code: about 70–400 ms locally for small
  scripts, compared with 20–40 s before. The code timeout is 5 minutes instead of 10 s.
  `max-instances=1` is the capacity limit until calls are routed by workspace. Workspaces live
  in instance memory, so a restart loses them; inputs are re-sent automatically.
- **Egress.** Closed on 2026-09-25: the service sends all traffic into a VPC with no NAT and a
  deny-all egress rule (ADR-0007, "Implementation").
- **Shared kernel.** Chats share one container kernel, isolated by uid, not by VM. This is
  weaker than ChatGPT's per-user container and stronger than the per-call Job's empty neighbour.
  If ArcNave is opened to untrusted users at scale, move to gVisor or a per-user sandbox.
- **Workspaces on disk.** Decided in [ADR-0014](0014-sandbox-resources-per-chat.md): workspaces
  move from the in-memory filesystem to a 10 GiB ephemeral disk, 5 chats of 1.8 GiB each.
  Runbook steps 7 and 8.
- **Setup.** `docs/deploy/warm-sandbox.md`.
