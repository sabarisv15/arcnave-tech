# ArcNave – Stage 4 checkpoint (all layers locked)
_2026-10-01 · Stage 4 Architecture layers: L1–L8 LOCKED_

> **Doc-sync 2026-10-03 (domain):** owner holds **arcnave.in** (not arcnave.tech). All hostnames read `app.arcnave.in`, `api.arcnave.in`, `usercontent.arcnave.in`, `share.arcnave.in`, `ops.arcnave.in`; Cloud Identity org = arcnave.in; wildcard cert `*.arcnave.in` + apex; CAA/DNSSEC on arcnave.in. Every earlier "arcnave.tech" reference means arcnave.in.

## Layer status
| Layer | Status | Doc |
|---|---|---|
| L1 Client · L2 Edge · L3 API | LOCKED | D:\Architecture (04-L1, 04-L2, 04-L3) |
| L4 Orchestration | LOCKED | architecture/04-L4-final-lock.md (+ claude-gaps, round2) |
| L5 Intelligence services | LOCKED (2 audits) | architecture/04-L5*.md |
| L6 Async | LOCKED | architecture/04-L6-async-layer.md |
| L7 Data | LOCKED (D17 corrected by L8 P20) | architecture/04-L7-data-layer.md |
| L8 Platform | LOCKED | architecture/04-L8-platform-layer.md |

## Open user decisions
1. Stage-1 assumptions A1–A6 (never confirmed): A1 multi-tenant isolation per company · A2 roles = company admin + user · A3 "fast reply" = first words within ~2–3 s · A4 peak load 3–5× average · A5 mic = speech-to-text only (dictation) · A6 memory per user inside company.
2. L-4 contextual retrieval slot (rec: build slot, switch on after testing).
3. Billing: is the GCP billing account paid (Claude needs paid, P2)?
(L-3 Redis day 1 → resolved by L4 O-3 + L6: Redis used for stream relay + locks.)

## Doc sync debt (update before Stage 21)
- 02 high-level: 3 deploys (API, Turn Executor, worker) + web.
- 03 lifecycle: Turn Executor via Cloud Tasks, Redis relay, checkpoint resume.
- L1 UI states: retract, model auto-switch note, low-confidence note, messages-left counter, memory controls, admin instructions, Thinking panel (TH-1), failed-file Retry/Remove (AS-D6), share link hides thinking + Google-grounded answers (SL-1), force app update (P31).
- L3 endpoints: /memory, /admin/instructions, job/file status, signed upload URL, min-app-version.
- Copy Project docs to D:\Architecture when computer link returns.

## LV-1 live verification pack (run in GCP before build)
Vertex quotas/usage tier for our 3 models + embeddings · global endpoint feature limits (caching, batch) · Gemini image/PDF/inline limits on Vertex · grounding Service Specific Terms · Claude safety classifiers page · Claude batch on Vertex · Claude betas listed for Google Cloud (drop_block, compaction, tool search, web fetch, clear_at, fallback credit) · Claude thinking account binding (project vs org) · gemini-embedding-001 batch size · gemini-3.5-transcribe on Vertex · D-1 in-memory cache vs implicit cache · Cloud Tasks dispatch latency + task size · Redis RDB location · Cloud SQL cloudsqlsuperuser BYPASSRLS · pooling + SET LOCAL · India org policy + Vertex global endpoint still works · VPC-SC vs Vertex global/Claude · spend-cap budget covers Claude.

## Next
Stage 5 Data flow (reuse saved facts; research only new topics).
