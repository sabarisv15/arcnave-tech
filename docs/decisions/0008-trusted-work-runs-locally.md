# ADR-0008: Trusted work runs in the backend process, not a Cloud Run Job

- Status: accepted; its "run_python stays on the Cloud Run sandbox" superseded by [ADR-0010](0010-warm-sandbox-service.md) (2026-09-24)
- Date: 2026-09-24
- Amends: [ADR-0005](0005-cloud-run-sandbox.md) and G20 in the tools pipeline plan, where the
  one Cloud Run sandbox ran trusted CLIs and skill scripts as well as `run_python`. ADR-0007
  (no general egress for the sandbox) is unchanged.

## Context

Phase 3's `extract_scanned_table_rows` passed locally and failed live on the real 12-page
scanned statement ([live failure record](../checkpoints/2026-09-24-phase3-live-failure.md)).
Every sandbox call is a fresh Cloud Run Job, which takes 20–40 s: start, staging upload,
signed URLs, and download. One extraction made 3–15 of them: a render, the per-page recheck
crops, and normalisation. Together with the model's own `run_python` calls, the turn ran past
Cloud Run's 240 s request timeout. The normalisation result also never came back, because an
output upload failure in the job is swallowed (G22).

Everything in that path is **trusted**. `pdftoppm` is a fixed binary with argv-only arguments
from our code, and the skill scripts are repository files that read JSON and write JSON using
only the Python standard library. None of it is model-written code.

## Decision

1. Poppler CLIs (`pdftoppm`, `pdfinfo`, `pdftotext`) and packaged skill scripts run as a child
   process of the backend (`TRUSTED_WORK_ENGINE=local`, the default). The backend image ships
   `poppler-utils` and `python3`.
2. That child gets a **sanitized environment**: PATH, HOME=tmp and locale only, never the
   backend's secrets. It runs in the per-turn workspace, with a deadline
   (`TRUSTED_WORK_TIMEOUT_MS`) and capped stdout/stderr.
3. **Model-written code never runs locally.** `run_python` stays on the Cloud Run sandbox, and
   the local executor is reachable only through the trusted-CLI allowlist and
   `runSkillScriptJson`/`executeTrustedSkillScript`, which load scripts from the skills
   directory. LibreOffice and pandoc also stay on the sandbox, since the backend image does not
   carry them.
4. The G20 grants are unchanged: `ENABLE_TRUSTED_CLI` and `ENABLE_SKILL_SCRIPTS` still decide
   whether the work may run at all. `TRUSTED_WORK_ENGINE=sandbox` restores the old routing.

## Consequences

- One extraction drops from minutes of job start-up to roughly the Gemini vision time. The
  output-upload failure mode disappears for this path.
- The backend image grows by poppler and python3 (tens of MB).
- A bug in a packaged script or in poppler now runs inside the backend container rather than an
  isolated job. We accept this: the inputs are our own JSON and rendered pages, the process has
  no secrets in its environment, and it is killed at its deadline. Anything a model writes is
  still isolated.
- The long-term answer to cold jobs for `run_python` is a warm sandbox per chat (Phase 6), not
  running more work locally.
