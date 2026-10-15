# ArcNave – Stage 21 checkpoint · Implementation plan – LOCKED 2026-10-03
_Full plan: 21-implementation-plan.md. Architecture phase complete (Stages 1–21). Build phase begins._

## 1. Decisions
| ID | Decision |
|---|---|
| IP-1 | Build order Phases 0–6: verification first (Phase 0 = bootstrap + LV-1 batch 1), core turn, files/retrieval, tools/artifacts/Research, quality/safety, ops/prod, Android + pilot |
| IP-2 | 24 weeks to first paying company; phase exits are gates – dates slip, gates do not |
| IP-3 | Monorepo `D:\arcnave.in` (GitHub org arcnave, private), layout plan §1, root `CLAUDE.md` + one per app |
| IP-4 | LV-1 127 tests in 7 batches B1–B7 mapped to phases; FAIL on design-changing test → ADR + doc-sync before dependent code |
| IP-5 | CI gates: prompt kit critical cases, skill evals 99 %, pgTAP RLS, content-leak test, licence/SBOM, security scans |
| IP-6 | Pilot 5–10 general-purpose companies in Phase 6; price fixed from FD-15 floors after real usage |
| IP-7 | prod project in Phase 5; HA (Cloud SQL HA + Redis Standard) before first paying customer |
| IP-8 | Lawyer track parallel from week 1; sign-off gate at Phase 5 exit |
| IP-9 | Academics vertical Later (accreditation skill packs, college plan FD-16…19) |
| IP-10 | Documentation = phase-exit gate (see §3); roles: Claude Code writes code, Claude reviews code + writes/updates docs |

## 2. Working method during build
1. Claude writes a **task brief** (`Stage-21-Implementation-Plan/build-tasks/task-X.Y.md`): scope, input docs, contracts, acceptance tests, forbidden patterns.
2. Owner runs the brief in Claude Code inside `D:\arcnave.in`.
3. Claude reviews the result against checkpoints + registers → fix list (F-1…) → re-run until clean → task closed in `build-tasks/00-task-log.md`.
4. Phase exit: exit criteria from plan §2 met + LV-1 batch recorded + docs updated (§3) + changelog entry.
5. Any deviation from a locked decision → ADR in `docs/architecture/adr/` + doc-sync block in the affected checkpoint + register update.

## 3. Documentation structure (repo `docs/`)
| Folder | Content | Owner | Updated |
|---|---|---|---|
| `docs/product/` | help-centre style: getting started, chat & models, files & projects, memory, artifacts, Research, sharing, admin panel, account & security, limits & plans, FAQ | Claude | every phase |
| `docs/api/` | REST + SSE reference (from OpenAPI), auth, errors (RFC 9457 codes), rate limits, guides | Claude (generated + hand) | Phase 1+ |
| `docs/architecture/` | read-only mirror of Architecture checkpoints + registers, `adr/`, diagrams | Claude | every phase |
| `docs/ops/` | runbooks (5 security, DR, incident), on-call, deploy/canary, dashboards, cost ledger | Claude | Phase 5 |
| `docs/legal-trust/` | privacy notice, ToS/AUP, DPDP mapping, subprocessor list, data-residency & security overview (trust page) | lawyer + Claude | Phase 5 |
| `docs/changelog/` | release notes per release | Claude | every release |
| `docs/startup-pack/` | one-page overview, problem/solution, non-technical architecture, security & residency, cost model & pricing, roadmap, team, metrics; per-programme mapping (Google for Startups Cloud, Startup India/DPIIT, others) | Claude | every phase exit |

## 4. Registers
- Numbers register: "Stage 21" column items N-05, N-25, N-27, N-36, N-53, N-59, N-63/64, N-65/66 confirmed during build.
- LV-1 register: batch tags B1–B7; results filled per phase.
- Lawyer list: groups (a)–(e), closure tracked to Phase 5 exit.
- Build task log: `build-tasks/00-task-log.md`.

## 5. Next
Task 0.1 – repo skeleton + root CLAUDE.md + docs/ skeleton + lv1/ folder (brief: build-tasks/task-0.1.md).

## Doc-sync 2026-10-04 (build phase)
- **IP-3 repository:** the repo is `sabarisv42/arcnave.in` – private, personal account, GitHub Free (cost decision FD-23). GitHub org `arcnave` and a paid plan are revisited when a second person gets push access or before Phase 5. WIF trusts the numeric repository id, so a later transfer to an org does not change the trust.
- **IP-5 CI gates** run on GitHub Free (2,000 Actions minutes/month); deploy/apply lock for dev = `main` branch via WIF (Stage 19 doc-sync FD-23).
- **Dev cost plan FD-22:** dev Cloud SQL small and normally off; Redis from Phase 1; NAT from Phase 3 (Stage 19 doc-sync 2026-10-04).

## Doc-sync 2026-10-06 (owner – Claude live tests not on the Phase 0 critical path)
- **IP-4 refinement (owner, 2026-10-06):** the own-project Claude 5.5 tests of batch 1 (LV-01 Claude part, LV-02 final, LV-07, LV-81, LV-18 / LV-20 Claude halves; planned as Task 0.14) wait for Google's Claude quota (auto-denied 2026-10-06, escalated to the sales contact). They are **not** a Phase 0 exit blocker: if the quota arrives before Phase 1 starts, they run then; otherwise they run later, at the latest **before production (Phase 5 exit) and before the Claude add-on is offered to any customer** (owner, 2026-10-06: Claude is an opt-in add-on behind the Model Gateway; Gemini-only launch stays possible). Until then the Gateway's Claude path is built and tested against fakes; live Claude checks stay on ADR-0002 (external project, Claude 5, synthetic data only).
- **Phase 0 scope (owner, 2026-10-06):** every non-Claude foundation item is finished in Phase 0 so Phase 1 starts clean – including the edge / streaming test LV-25 / LV-111 (global external ALB + serverless NEG + SSE 20 min with 15 s pings; the dev ALB behind an on/off Terraform switch to limit cost ≈ ₹2 / hour).

## Doc-sync 2026-10-07 (Stage 21 Phase 0 exit – foundation record, batch-1 count, superseded plan text)
- **Phase 0 foundation record:** repo `docs/ops/phase-0-foundation-record.md` (commit `120f499`), Project `architecture/Stage-21-Implementation-Plan/phase-0-foundation-record.md` – Google Cloud inventory with reasons, decisions (ADR-0001…0007, FD-22…27 with ₹ / day and ₹ / user / day), Phase 0 spend, deviations D-1…D-15, gaps G-1…G-8. Read it before changing any foundation setting. Live proof of the record = Task 0.15 (read-only check + Terraform drift plans).
- **§3 batch-1 count corrected (G-4):** the plan text says "B1 Phase 0 (design-changing, 24 tests)", but the Phase 0 list in §2 names **28 ids** (LV-01, 02, 07, 11, 12, 15, 17, 18, 23, 25, 27, 34, 35, 54, 77, 81, 93, 101, 105, 108, 109, 110, 111, 115, 116, 122, 125, 126). The §2 list is authoritative. Status at the exit: 24 recorded (PASS / FAIL / PARTIAL), LV-07 / LV-81 wait for the own-project Claude quota (doc-sync 2026-10-06), LV-11 / LV-101 are measured from the usage ledger (Phase 1+). Every FAIL (LV-12, LV-35, LV-115, LV-129 latency) has its ADR and doc-sync – the §2 exit rule is met.
- **§2 Phase 2 text superseded (G-5):** "reranker (ONNX int8 in Executor)" is replaced by ADR-0007 (Vertex AI Ranking API; development `semantic-ranker-default-005`, production a GA model – 005 if GA before the Phase 5 exit, else `default-004`); **LV-118** (int8 export quality) has no subject any more – register row marked superseded; the reranker's quality check is LV-129 (re-run when 005 is GA). "OCR via Doc AI" in Phase 2 means the pinned Mumbai release-candidate version + Gemini fallback (ADR-0006). The locked plan file stays unchanged; this block is the correction.
- **§3 ADR path:** ADRs live in `docs/architecture/adr/` (not `docs/adr/`); index table in its README (2026-10-07).
- **Phase 0 exit – still open (2026-10-07):** Task 0.15 live check; owner decision on Data Access audit logs (G-1 – Stage 17 OD-5 not configured anywhere yet; reviewer recommends Phase 1); billing detail by service / project (G-2); startup pack v1 (`docs/startup-pack/`).

## Doc-sync 2026-10-07 (Phase 0 CLOSED)
- **Exit criteria met (plan §2, checkpoint §2 step 4):** batch-1 results recorded (24 of 28; LV-07 / LV-81 wait for the own-project Claude quota by owner decision 2026-10-06; LV-11 / LV-101 come from the Phase 1+ ledger); every FAIL has its ADR + doc-sync; docs updated (foundation record, live check, ADR index, startup pack v1, changelog).
- **Foundation proven live:** Task 0.15 live check (record = live, one mismatch) → Task 0.16 removed the `default` networks + folder policy against new ones; bootstrap and dev Terraform plans "No changes".
- **Phase 0 spend:** Google Cloud ₹764 of the Free Trial credit used (₹28,032.50 left; credit end date 3 Jan 2027 – real bills start then, the same week as the Gemini price doubling); ₹0 paid.
- **Carried into Phase 1 (owner decisions 2026-10-07):** Data Access audit logs ON in the first Phase 1 infra task (G-1, Stage 17 doc-sync); Gemini Cloud Assist APIs kept → into Terraform (G-11); built-in `postgres` user password (G-13); delete `lv-executor` (G-8); billing budget alert brought forward from Phase 5 – reviewer proposal, owner OK pending. Working place for Phase 1: Claude Code on the owner's PC for everything touching Google Cloud; a cloud session only for code-only tasks when named in the brief.

## Doc-sync 2026-10-08 (Stage 21 Task 1.5 close + independent audit – repo rule, hosts, Phase 2 gate)
- **Owner decision A1 (2026-10-08) – identifiers in the repo:** project ids, project numbers, instance connection names and service-account / owner e-mails must not appear in **code, tests, workflows, CI logs or application logs / traces / metrics** (platform audit logs – Cloud Audit Logs, pgAudit – carry principal identities by design and are allowed); they may appear in **ops / result documents, `lv1/results` (`env`) and Terraform backend config** (Google project ids are identifiers, not secrets). Passwords, keys, tokens and the external Claude project id (ADR-0002) stay forbidden everywhere. Briefs from Task 1.6 on use this wording; root `CLAUDE.md` is aligned in Task 1.6.
- **Phase 2 exit gate:** "retrieval p95 ≤ 800 ms" in the plan text is superseded by **N-27 p95 ≤ 1,200 ms** (provisional, ADR-0007; Phase 2 measures).
- **Hosts:** user-content previews = `usercontent.arcnave.tech` (Stage 19 doc-sync 2026-10-06 – nothing else on `arcnave.tech`); every other host is on `arcnave.in` – ops console = `ops.arcnave.in` (review R-4 named `ops.arcnave.tech` before the domain decision). Plan text "usercontent.arcnave.in" is superseded.
- **Independent audit (2026-10-08, fresh subagent, read-only at `3f3679f`):** no blocker; should-fix items go into Task 1.6 (handoff §12). Rule for every phase exit from now: a fresh-context audit of built vs decided before the exit is declared.

## Doc-sync 2026-10-08 (owner decision C1 – A1 and Google-required telemetry fields; second independent audit)
- **A1 amended (owner, 2026-10-08 "c1"):** one exception – Google-required telemetry fields may carry the project id: the Cloud Logging trace field `projects/<id>/traces/<trace>` on each JSON log line and the OTel resource attribute `gcp.project_id` on traces / metrics. The value comes from the runtime environment only (never hard-coded in code, tests or workflows). Everything else in A1 is unchanged.
- **Architecture docs follow A1 too:** project ids removed from the Stage 19 checkpoint and the LV register (reviewer, 2026-10-08); the changelog follows in Task 1.7. Allowed places stay: `docs/ops/**`, `docs/build-tasks/**`, `lv1/results/**`, Terraform backend config, and the Claude Project handoff (not the repo).
- **Second independent audit (2026-10-08, at `d1c6286`): not clean** – no blocker, 8 should-fix / 10 minor / 6 doc-only → **Task 1.7 = foundation close-out 3**; product coding starts with **Task 1.8 = Auth** (order unchanged: auth → chat tables → API + SSE + Redis → Model Gateway → Turn Executor → context / memory / budgets → web app). Reviewer decision recorded for ID-12 / ID-13 in dev: expand-only migrations, `db-migrate upgrade` before the code that needs it is deployed; Task 1.8 builds the `--no-traffic` → smoke → shift flow in `deploy-dev`.

## Doc-sync 2026-10-08 (Stage 21 Task 1.7 close – foundation close-out 3)
- **Task 1.7 DONE** (Part 1 `eb18df8` … `86d6214`, fix round 1 `e0380bb` … `953bb80`, result `0224adc`): every second-audit item is closed – S-1 … S-8, M-1 … M-10, DO-1 … DO-6 (S-3, M-5, DO-1 … DO-3 by the reviewer earlier). Decisions: Cloud SQL logging flags OFF (Stage 17), `postgres` / `template1` / `cloudsqladmin` unchanged (Stage 19), ID-12 migrate-before-deploy order (Stage 19), N-71 and N-45 `pool_recycle` (numbers register).
- **Brief checklist (reviewer error in 2.8):** every new API error path follows Stage 15 ER-11 (RFC 9457 problem+json + `code`, `request_id`, `retryable`, `retry_after_s`) – name ER-11 in every brief that adds a handler.
- **Next:** a third short independent audit (fresh context, read-only, at the post-close HEAD) → if clean, the foundation is "100 % done" (owner rule 2026-10-08) → Task 1.8 Auth (builds the ID-12 deploy flow).

## Doc-sync 2026-10-09 (Stage 21 Task 1.7b close – foundation 100 % done)
- **Third independent audit** (2026-10-09, fresh context, read-only at `27b3bbe`): no blocker, every second-audit item closed; T-1 … T-6 closed in Task 1.7b (`1b2fc8b` … `146bdf0`, result `44027d9`; CI faults ok, dev `upgrade` + `verify` 162 ok) and by the reviewer (T-4 handoff, T-5 `678bc45`).
- **Foundation status (owner rule 2026-10-08 "100 %, no pendings on our side"): DONE.** Open items that are not on our side or not due yet stay in the handoff §12: Claude Vertex quota (Google), Document AI quotas (Google), rolling partition run before 1 Feb 2027 (`maintain`), staging / prod (later phases).
- **Next: Task 1.8 Auth** – the first DB-using API service; builds the ID-12 deploy flow (`db-migrate upgrade` before deploy, `--no-traffic` → smoke → shift) and uses the ER-11 helper for every error.

## Doc-sync 2026-10-09 (ADR-0010 – Phase 1 auth)
- Phase 1 build line: "auth (email/password Argon2id … self-signup + invite)" → **passwordless invite-only auth** (Google + e-mail code / link, TOTP owner/admin, reCAPTCHA, sessions / refresh rotation), invitations single + bulk, ops tool, `mailer` service – **Task 1.8 (three parts)**.

## Doc-sync 2026-10-10 (Stage 21 Task 1.9 brief – chat core)
- Phase 1 order line "auth → chat tables → API + SSE + Redis → …" → **Task 1.9 = chat tables + chat API + SSE in one task (three parts, branch `task-1.9`, one batched dev run – owner working mode A + B)**; **Redis at final testing** (ADR-0011, FD-34). Real replies come with the Model Gateway task (fake reply source until then), Cloud Tasks dispatch with the Turn Executor task (in-process dev dispatcher until then).

## Doc-sync 2026-10-10 (ADR-0012 – Claude through the first-party Claude API)
- **Phase 1 Model Gateway scope (owner, 2026-10-10):** Gemini (Vertex) + Claude (**first-party Claude API**, WIF) – two parts (Gemini first, Claude + fallback second), one batched dev run. Claude live tests (LV-01 / 02 / 07 / 18 / 20 / 81 / 93 Claude halves) no longer wait for Google quota – they run on the first-party API (IP-4 refinement of 2026-10-06 superseded for Claude).

## Doc-sync 2026-10-10 (Stage 21 Task 1.10 brief – Model Gateway)
- **Task 1.10 = Model Gateway (block 4 of 9), brief `docs/build-tasks/task-1.10.md`**, branch `task-1.10`, two parts + one batched dev run, full reviewer review per part, subagents allowed (read / check). Part 1: gateway core, Gemini adapter + explicit cache, retries / breaker, price book + per-call ₹, router call type, interim context v0, migration 0006 (finish codes, `company_settings`), api model / profile choice (`claude_off` → Gemini), Stop-while-thinking fix. Reviewer brief revised after an independent check (dev-run order, locked ER-3 / ER-4 / OD-13 names kept). Part 2: Claude first-party adapter (WIF), cross-provider fallback, dev faults, root `CLAUDE.md` ADR-0012 lines, smoke `chat-models`, dev Terraform ≈ 3 / 1 / 0. Dev run spend cap ≈ ₹250; per-reply ₹ table from the `model_call` lines (owner's request 2026-10-10).
- Moved out of this task: per-turn router shadow (Turn Executor), ER-3 recovery attempt (Turn Executor), context assembly v1 + prompt kit (block 6), ledger tables / reservations / Claude ₹ limit / kill switch (block 7), Claude LV re-target in `lv-runner` + ADR-0002 clean-up (separate small task).

## Doc-sync 2026-10-12 (Stage 21 Task 1.11 brief – Turn Executor)
- **Task 1.11 = Turn Executor** (owner OK 2026-10-12, brief `docs/build-tasks/task-1.11.md`): Part 1 – shared package, executor service, Cloud Tasks dispatch, SIGTERM handling, Gemini cache switch, Terraform switch `turn_executor_enabled`, plans only; Part 2 – migration 0007 (`continuations`, `resumes`, resume window, parked stopped / deleted turns end at once), checkpoint v1, one ER-3 continuation, resume after crash / SIGTERM, dev chaos faults, router shadow built off, smoke `chat-executor`; one batched dev run with two applies. Branch `task-1.11`, full reviewer review per part, subagents allowed (read / check). Independent fresh-context check of the draft: 2 blockers (Cloud Tasks retry semantics; Stop / delete inside the resume window) + 12 should-fix + 10 minor – all fixed before the commit.
- **IP-3 layout addition:** `backend/packages/chat` (`arcnave-chat`) – the chat records, stream stores, reply sources, the turn runner and the shared HTTP helpers used by both `apps/api` and `apps/executor`; an app never imports another app.

## Doc-sync 2026-10-13 (Stage 21 Task 1.11 DONE – Turn Executor)
- **Task 1.11 DONE.** Part 1 (`aec7523` … `67fe302`) and Part 2 (`aac57b6`, 13 commits) reviewed **PASS, no fix round** (full diff, reviewer); dev run 2026-10-13 reviewed **PASS** (`8e87927`, `docs/ops/task-1.11-dev-run-result.md`): `main` `6c9eed1..aac57b6`, migration 0007, plans 10 / 0 / 0 and 2 / 1 / 2 applied by the owner, smokes `chat`, `chat-models`, `chat-executor` ×2 all `ok`. Measured: Cloud Tasks delivery, Stop 1.4 s, SIGTERM 500 in 15 ms, resume after SIGTERM and crash on a new instance (pause 23 – 36 s of 60 s), ER-3 continuation, rainbow, cold start ≈ 32 s. Registers updated: numbers (N-73 / 44 / 45 / 25), LV (22 / 46 / 76 / 78), Stage 15 / 18 / 19 checkpoints (all 2026-10-13).
- **Open from the run (carried):** DR-5 fencing / `last_seq` not readable → **N-8** (log them + `payload_bytes`, with the next task that touches the executor); F-13 exact case (Sonnet Fast after a cold start – smoke step in the next dev run); N-1 / N-2 / N-3 / N-6 (brief "Dev run review 2026-10-13"). Before any pilot with real users: executor min instances 1 with its ₹ (FD row), sign-in cold starts, Gemini continuation effort, Anthropic tier increase.
- **Next in order:** (1) process-setup task (brief template, CLAUDE.md trim, hooks – untested, settings deny rules, model policy, tiered review), piloted on the next two tasks; (2) Phase 1 left: context assembly v1 → budgets + usage ledger → basic memory → web app.
