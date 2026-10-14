# Architecture mirror (read-only)

Copy of the owner's Architecture folder (the 21-stage design, registers and the build plan).
**Edit there, not here**; this mirror is refreshed by the task that needs a newer copy.

- `00-Handoff/00-build-plan-arcnave-tech.md` — **the plan we follow** (ADR-0053). Phases 0–6, task ids `P0-1 … P6-x`.
- `00-Handoff/00-numbers-register.md` — every limit, timeout, size, quota (`N-xx`). No new literal for a value that has an N-id.
- `00-Handoff/00-lv1-register.md` — live-verification tests (LV-xx).
- `00-Handoff/00-cost-decision-log.md` — money decisions (FD-xx).
- `Stage-NN-*/` — the checkpoint (`00-checkpoint-stageN.md`, locked decision ids) plus the stage's main docs (layer docs L1–L8, policy spec v3 + system prompts v3, tool definitions, skill framework, retrieval flow, etc.). Astra research transcripts, prompt history and the archived Python task briefs are not mirrored.
- `Build-arcnave-tech/` — build log on this base: `README.md` (phase table), `tech-pN.md` (phase prompt + result).
- Brand: the locked design pages are under `arcnave-frontend/docs/brand/` (see its README).
- `build-tasks/` — task briefs for this repo (`tech-pX.Y.md`).

The stage docs were written for the earlier Python design; ADR-0053 says how they apply here: target spec, repo wins where it already does the job, differences recorded in ADRs 0054+.
