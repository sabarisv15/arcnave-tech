# ArcNave – Checkpoint · Stage 10 Agent / workflow orchestration – LOCKED 2026-10-02
_User OK 2026-10-02. This checkpoint is the final word over the drafts 10-agent-orchestration.md and 10b-research-mode.md._

> **Doc-sync 2026-10-03 (Stage 13) – see Stage-13-Output-Validation/00-checkpoint-stage13.md:**
> - AO-10 completion check detail = Stage 13 OV11/VD-6 (deterministic always; Flash-Lite on Normal/Deep tool or multi-part turns). RS-1 step 6 citation check = OV12 (same judge on the whole report, unsupported claims removed/softened before publish, source-quality grade recorded).

> **Doc-sync 2026-10-03 (Stage 18) – see Stage-18-Cost-Performance/00-checkpoint-stage18.md + 00-Handoff/00-cost-decision-log.md:**
> - Cloud Tasks HTTP task maximum is 30 min → Research runs execute as Cloud Run jobs (confirms ≥10-min rule). Research quota default 5 runs/company/month; worst-case run cost ₹115 (Gemini) / ₹195 (Sonnet) (FD-06).

## Docs
| Doc | What |
|---|---|
| 10-astra-prompt.md | Research prompt (incl. A9 Send-gating question) |
| 10-agent-orchestration.md | Evidence, vendor facts, gaps AG1–AG17, Claude-only CO1–CO7, decisions AO-1…AO-12 |
| 10b-research-mode.md | Research mode design RS-1…RS-8 |

## Locked decisions
**Normal chat (single agent)**
- AO-2 live step list from tool status labels + sources; editable plan only in Research mode.
- AO-3 clarifying questions before start only, one round, only if key input missing.
- AO-4 runtime: ≤10 min turns in Turn Executor (Cloud Tasks, locked); >10 min work (research, whole-document jobs) in Cloud Run jobs with checkpoints; Workflows Later (approvals/callbacks); LangGraph not adopted.
- AO-5 cooperative cancel (DB flag checked between steps and inside long tools) + partial results kept (extends D4).
- AO-6 whole-document tasks: own map-reduce over every chunk/page with coverage % ("1,000/1,000 pages"); list-all = extract per chunk + merge + dedupe.
- AO-7 notifications: in-app MVP; push Later (L1).
- AO-8 Claude context editing / compaction / task budgets (betas) not in MVP; own context guard (G46) + tool result caps.
- AO-10 completion check before final answer (Opus end_turn ≠ done).
- AO-11 per-company quotas for long tasks + "remaining" counter; numbers Stage 18.
- AO-12 D1 unchanged: Send blocked until file ready (no vendor documents otherwise).
- AG10 never xhigh/max effort; AG12 prompt rule "continue until done, ask only when blocked or before a risky step".
- Sub-agents and mid-task steering: not in normal chat (FD-1 kept).

**Research mode (MVP, provisional – AO-1)**
- RS-1 flow: clarify (≤1 round) → editable plan → 3–5 parallel helpers (web + user files) → notes checkpointed → lead writes report artifact (docx/PDF) + chat summary → citation check → in-app notify.
- RS-2 provider-consistent: Gemini research = Gemini helpers + Gemini lead; Claude research = Sonnet helpers (native web_search) + Sonnet/Opus lead. Google-grounded results never go to Claude.
- RS-3 per run: max 30 min, max 50 searches, max 5 helpers; scaled to question size (simple 3–10 searches / 1 helper; medium 10–15 / 2–4; large 30–50 / 5).
- RS-4 company monthly research quota + remaining counter (numbers after Stage 18).
- RS-5 Cloud Run job + checkpoints; cooperative cancel; Stop → partial report.
- RS-6 sources: web + chat/project files.
- RS-7 company admin Research ON/OFF; requires web search ON.
- RS-8 final keep / limit / paid add-on after Stage 21 test + Stage 18 cost.
- RG1 store only our model's notes + source links, never raw Google-grounded snippets (lawyer check).
- RG2 Gemini-grounded research reports follow SL-1 share rule (hidden/warned).
- RG3 Claude research: cost estimate reserved before start (R2); not enough Claude budget → offer Gemini.
- RG4 research run enables search for that run only (overrides per-chat toggle), cap 50.
- RG5 progress steps persisted in DB (runs exceed 15-min Redis stream window).
- RG6 chat running research shows progress + Stop; other chats free.
- RG7 effort: helpers medium, lead high; never xhigh/max.
- RG8 every helper call recorded in the usage ledger (G44).

## LV-1 / Stage 21 tests
1. Cooperative cancel latency (≤2 s).
2. 1,000-page map-reduce: time, cost, coverage on Cloud Run job.
3. Sonnet 5.5 medium vs high on 15-step tasks.
4. Gemini 3.8 Flash HIGH with 15 sequential tool calls + thought signatures.
5. Research mode on 20 Indian business questions (Gemini vs Claude): quality, time, searches, tokens, citation accuracy.

## Lawyer list additions
- RG1: storing derived research notes from Google-grounded results.

## Doc-sync debt
- L1 UI: Research mode (plan editor, progress, in-app notification, remaining counter), step list, completion states.
- Stage 8 TD-14: research-run search exception (cap 50).
- SL-1: applies to research report artifacts.
- Stage 5 data model: research_run, research_note, job progress tables.

## Deferred
- Stage 11: memory tool / Memory Bank evaluation.
- Stage 13: completion check + citation check details.
- Stage 15: provider fallback mid-research.
- Stage 17: India-hosted traces per step/helper.
- Stage 18: quotas, research cost per run, prices.
- Later: push notifications, steering mid-task, sub-agents in normal chat, Workflows for approvals.
