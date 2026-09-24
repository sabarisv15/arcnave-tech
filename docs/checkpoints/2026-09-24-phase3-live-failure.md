# Phase 3 status: why it is not done, and what happens next

**Date:** 2026-09-24 · **State:** Phase 3 merged and deployed (PR #8), **live acceptance
FAILED**. Steps 1–3 of the fix are implemented and merged (see "Fix status" at the end), and a
live re-test is pending. Phase 4 is not started. This page is written so someone new can pick it up cold.

## 1. Why the phased work started

ArcNave has a locked architecture for tools and skills. The router is only a policy boundary.
The **model** decides what to do. A **skill** says how to do it, and a **tool** does one
deterministic action. Code runs in a **sandbox**, **QA** checks the result, and the model
repairs it. An audit of the running code found 27 places where the code broke that design
(G1–G27, in [`docs/tools-skills-architecture.md`](../tools-skills-architecture.md)). The most
visible symptom: when a user gave the model a scanned bank statement, it could not count
transactions exactly. The router hid the tools, earlier files were forgotten, and nothing could
read table rows from a scanned page.

The fix was planned in phases
([`docs/superpowers/plans/2026-09-24-tools-pipeline-gap-fixes.md`](../superpowers/plans/2026-09-24-tools-pipeline-gap-fixes.md)):

| Phase | What | Status |
| --- | --- | --- |
| 0 | Architecture tests, ADR-0006, baseline | ✅ |
| 1 | Model authority: `search_tools` + `load_skill` on every tool turn (G1, G2, G3, G7) | ✅ live |
| 2 | Files carry across turns, never sent twice (G6, G15–G18, G26, G27) | ✅ live |
| 3 | Exact document intelligence: `extract_scanned_table_rows`, `analyze_table_rows`, G13, G14, G20 split | ⚠️ live, **acceptance failed** |
| 4 | One routing policy for chat and AgentLoop (G4, G5, G8) | not started |
| 5 | Agent loop and performance (G9–G12) | not started |
| 6 | Execution runtime hardening (G19, G21–G23, G25) | not started |

The rule was that each phase must pass its acceptance test before the next one starts.

## 2. What Phase 3 is supposed to do

A user attaches `kvbfedral.pdf` (12 scanned phone-photo pages, no text layer: one KVB statement
and one Federal Bank statement). They ask, in plain words, *"Count every transaction exactly and
classify them with party name and without party name."* The model should:

1. find `extract_scanned_table_rows` through `search_tools`;
2. extract. Each page is rendered with `pdftoppm` and Gemini vision reads its rows. Rows read
   with low confidence are read again from a 300 dpi crop. The skill script
   `normalize_table_rows.py` then normalises and indexes the rows;
3. call `analyze_table_rows`, where `analyze_table_rows.py` computes counts, totals, running
   balance and classification. The model does no arithmetic;
4. answer. The document's own figures are KVB 48 (41 debit, 7 credit), Federal 277 (244
   withdrawals, 33 deposits), combined 325, verified by hand from the statements.

Locally, with a fake provider and the process sandbox, all of this passed (762 tests).

## 3. What happened live

Test on production after deploy, `ENABLE_TRUSTED_CLI` and `ENABLE_SKILL_SCRIPTS` set to true
(revision `arcnave-sandbox-service-00125-pxk`):

- The model called `search_tools`, then `run_python` three times, then `read_uploaded_file`.
  Only after that did it call `extract_scanned_table_rows`.
- `extract_scanned_table_rows` **failed** with *"Row normalisation failed: Skill script
  produced no result."* Rendering and Gemini vision worked; the last step did not.
- The model fell back to two more `run_python` calls.
- After 240 s, Cloud Run's request timeout, the platform cut the connection (log: *"Truncated
  response body… request timed out"*). The UI showed **"Response stopped"**, with no answer and
  no error.

## 4. Root causes

| | Problem | Cause | Gap it belongs to |
| --- | --- | --- | --- |
| **A** | Far too slow | Every sandbox action starts a **new Cloud Run Job**, which takes 20–40 s: container start, input upload to GCS, signed URLs, then output download. One extraction needs 1 render job, up to one recheck job per low-confidence page, and 1 normalise job. A concurrency cap queues them. Every `run_python` the model makes is another job. | G23, plus the Job-per-call design itself |
| **B** | Skill script "produced no result" | The result file comes back only if the job uploads it to a signed URL. Signing and upload failures are swallowed as "non-blocking". The sandbox runner writes its upload warning to its own log, not to the result, so the caller only sees a missing file. *Not yet confirmed from job logs.* | **G22** (known, Phase 6) |
| **C** | Model wasted rounds | For a scanned PDF plus an exact-count request, `search_tools` did not rank the table tools first, and the pdf skill did not say "extract first, never read the PDF with `run_python`" strongly enough. The model used 8 tool calls. | Phase 3 (tool discovery) |
| **D** | Silent death | The server has no turn deadline below the platform timeout. When Cloud Run kills the request, nothing is saved but "stopped". | Phase 3 / Invariant 1 |

**The main lesson.** Phase 3 was marked "✅ locally", but locally the sandbox is a warm local
process, while production uses one cold Cloud Run Job per call. Phase 3's production path
depended on Phase 6 gaps (G22, G23) that were still open. Local tests could not show that.

## 5. Why Phase 3 is paused on a fix, not closed

The rule is that a phase closes only when its real acceptance test passes, and a failure is
fixed inside the same phase. So Phase 4 waits, and we are now in the **Phase 3 fix (steps
1–3)**:

1. **Trusted work runs locally in the backend, not as Cloud Run Jobs (fixes A and B).**
   `pdftoppm` renders and the packaged skill scripts are repository code, not model-written
   code. They only read JSON and images and have no network. They will run in the backend
   container through the same local process executor used in development, with timeouts and
   output caps. The backend image gains `poppler-utils` and `python3`. Model-written
   `run_python` stays in the Cloud Run Job sandbox, so isolation for untrusted code does not
   change. This changes where trusted CLI runs, which G20 and ADR-0007 assumed was the
   sandbox. **A new ADR is required in the same commit.** Expected effect: extraction goes from
   about 4 minutes to about 30–60 s, which is mostly Gemini vision. The upload that failed is
   gone.
2. **Better discovery (fixes C).** Scanned PDF plus a count/exact/classify request → the table
   tools rank first in `search_tools`. The pdf skill states the order: extract, then analyze,
   never `run_python` on the PDF. The model still decides, and no magic words are added.
3. **Deadline and clear errors (fixes D and B's reporting).** A server-side turn deadline
   shorter than the platform timeout ends a slow turn with a typed error and saves the tool
   results so far. Skill-script failures report the exit code, timeout and upload errors. The
   Cloud Run request timeout goes from 240 to 900 s; this is an infra setting, run by the owner.

**Done means:** the real PDF passes `backend/src/scripts/verifyPhase3KvbFederalLive.ts` locally
(48 / 277 / 325, no timeout), the suite is clean, the owner approves a deploy, and the same
prompt passes on production. Only then is Phase 3 closed and Phase 4 started.

## 6. After that

- **Phase 4:** one routing policy for the chat path and AgentLoop (G4, G5, G8).
- **Phase 5:** agent loop performance: prompt-cache-safe discovery, parallel calls, round
  budget, retry of transient failures (G9–G12).
- **Phase 6:** runtime hardening. The largest item is replacing Job-per-call with a
  **warm sandbox per chat**, the way Claude's code execution works: one container per
  conversation, created on first use, reused for every call in that chat, and killed when idle,
  with files kept on its disk. That makes model-written `run_python` fast as well. Also in this
  phase: no general egress (ADR-0007, G21), job sizing (G23), and typed staging errors (G22).

## 7. Where things are

- Code: `main` at `2bec9e3` (PR #8). Work branch: `claude/tools-skills-architecture-jyxa61`.
- Extraction: `backend/src/services/tables/scannedTableExtraction.ts`. Tools:
  `backend/src/tools/tableExtractionExecutor.ts`. Scripts: `backend/skills/pdf/scripts/`.
- Runtime and sandbox: `backend/src/tools/execution/executionRuntime.ts`,
  `backend/src/tools/sandbox/cloudRunSandboxClient.ts`, `backend/sandbox/runner.py`.
- Live acceptance harness: `backend/src/scripts/verifyPhase3KvbFederalLive.ts`.
- Production service: Cloud Run `arcnave-sandbox-service`, `asia-south1` (despite the name, this
  is the backend).

## Fix status (2026-09-24)

Steps 1–3 are implemented. Backend 772/772 and frontend 48/48 pass locally, and `tsc` is clean.
The backend image could not be built here because no Docker daemon was available, so Cloud
Build is the first build of the image with `poppler-utils` and `python3`.

- **Step 1:** [ADR-0008](../decisions/0008-trusted-work-runs-locally.md).
  `TRUSTED_WORK_ENGINE=local` (the default) routes `pdftoppm`/`pdfinfo`/`pdftotext` and the
  packaged skill scripts to a sanitized local child process: `ProcessSandboxClient` with
  `inheritEnv: false`, `python3`, and a `TRUSTED_WORK_TIMEOUT_MS` of 120 s. `run_python`,
  `soffice` and `pandoc` stay on the Cloud Run sandbox. A skill script that returns no result
  now says why: exit code, timeout, stderr, or an output that was written but not returned.
- **Step 2:** `search_tools` ranks `extract_scanned_table_rows` first and
  `analyze_table_rows` with it when a request asks for counts, totals or classification. The
  extract description and pdf skill 3B say to go straight to extraction.
- **Step 3:** `TURN_DEADLINE_MS` defaults to 3 540 000 (59 min) on the chat path. A turn that
  runs past it ends as the typed `turn_deadline_exceeded` error, with frontend copy, not as
  "stopped". **The owner must set the Cloud Run request timeout to 3600 s**:
  `gcloud run services update arcnave-sandbox-service --region asia-south1 --timeout=3600`.
  AgentLoop has its own internal timeout, which still ends as "stopped"; that path belongs to
  Phase 4 (G4/G5).

**Next:** after deploy, run the same prompt on `kvbfedral.pdf` live. Pass means 48 / 277 / 325,
no timeout, and extraction chosen early. Then Phase 3 closes.
