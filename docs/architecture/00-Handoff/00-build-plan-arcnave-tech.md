# ArcNave – Build plan on the `arcnave-tech` base (CURRENT PLAN)
_Owner decision 2026-10-14. Status: **ACTIVE – this is the plan we follow now.** Every other architecture doc (Stage 1–21 checkpoints, registers, Python build tasks 0.x/1.x) is **reference only**: it is the target spec and the source of decision ids, not the build order._

## 0. What was decided (2026-10-14)
| # | Decision |
|---|---|
| B-1 | **Build base = `sabarisv15/arcnave-tech`** (Node 22 · Fastify 5 · Drizzle · Postgres 16 · React 19 + Vite · warm Python sandbox on Cloud Run, Mumbai). The Python build in `sabarisv42/arcnave.in` (Phase 0 + Tasks 1.1–1.14) is **archived as reference** (Terraform, CI, gateway design, numbers wiring are ported from it, not rewritten from scratch). |
| B-2 | The 21 stage checkpoints stay the **target spec**. Where the repo already does the job differently and well, the repo wins for the prototype and an ADR records the difference (list in §2). |
| B-3 | **Single user first.** No company / tenant / roles / RLS / pools / admin panel until the product is locally stable; those move to Phase 5. |
| B-4 | **Models = 3 only:** Gemini 3.8 Flash, Claude Sonnet 5.5, Claude Opus 5.5. gpt-oss alias removed. |
| B-5 | **Claude via the first-party Claude API** (ADR-0012, `$100` test credit), not Vertex. SDK retries 0; retries only in the app gateway per the Stage 15 matrix. |
| B-6 | Per-company Claude ON/OFF switch (Stage 1 C1) **dropped**. Per-user token budgets (already in repo) are the only cap for now. |
| B-7 | Data residency, NO_CONTENT logging (Stage 17), Terraform, OTel, Redis, Cloud Tasks executor: **applied when stable (Phase 5)**, not during the prototype. |
| B-8 | **Workflow unchanged:** reviewer (Claude) writes the brief → plan mode → Claude Code codes locally in `D:\arcnave-tech-main\arcnave-tech-main` → local code review → CI → next task. Models: Opus 5.5 for high-risk (gateway, auth, DB, executor), Sonnet 5.5 for the rest, Haiku 5.5 only as test-runner. |
| B-9 | **Branch-only work.** A push to `main` runs the Cloud Build trigger and deploys. Nobody pushes to `main`; PR merge = deploy = owner only, and only after the local-stable gate. |
| B-10 | **Phase order, not stage order:** per phase → compare scope with the repo → build/rewrite the gaps → phase exit → next phase. Conformance to each stage checkpoint is checked inside the task that touches that stage. |
| B-11 | **Gate before any dev run / Terraform apply = "local stable":** the AI answers user questions correctly locally, picks the right tools and skills, and the academic (campus) use cases have been iterated and checked. One dev run + one Terraform apply per 3 phases. |

## 1. Repo facts the plan is built on (verified 2026-10-14, HEAD `882e8de`, 28 Sep)
- Working product: detached runs + SSE replay, 16-round tool loop, warm sandbox (no egress, Tamil OCR), artifacts + 13 display cards, Markdown memory with 6 tools, Projects + BM25 search, share links, data export, 50 ADRs, ~900 backend + 195 frontend tests.
- Live today: **Gemini 3.8 Flash only** – `providers/registry.ts:133` hard-disables Claude and gpt-oss outside tests.
- Not in repo: Git CI, Terraform, Redis, Cloud Tasks, Document AI, pgvector (invariant 4 forbids an embedding column), Google login, ZIP upload, mobile app, company/tenant tables, OTel. Rate limits and the run hub are in-process → single instance.
- Local folder `D:\arcnave-tech-main\arcnave-tech-main` is **one day ahead** of GitHub (29 Sep: ADR-0052, Fable audit, checkpoint) and has **no `.git`**. Precondition P0-1 below.
- Two GitHub accounts: `sabarisv15` (arcnave-tech – build) and `sabarisv42` (arcnave.in – archived Python). CI/Claude Code auth = `sabarisv15`.

## 2. ADRs to write on the new base (one commit each, Phase 0 / first touching task)
| ADR | Supersedes / records |
|---|---|
| 0053 prototype base | B-1…B-11; Python build archived; repo CLAUDE.md gains our rules (branch-only, numbers register, model policy, NO_CONTENT target) |
| 0054 Claude first-party API | B-5; replaces Vertex Claude path (repo ADR-0001/0003 stack note) |
| 0055 three models | B-4; removes gpt-oss (repo ADR-0002 amended) |
| 0056 typed errors kept | Keep repo `ApiError` codes instead of RFC 9457 (Stage 15 doc-sync) |
| 0057 repo prompt kept | Keep repo system prompt (ADR-0049/0052 lineage) instead of policy-spec v3; prompt test kit ports onto it (Stage 6 doc-sync) |
| 0058 compaction kept for prototype | Stage 6 "no compaction" relaxed for the prototype; revisit at Phase 5 with real token data |
| 0059 retrieval | BM25 now; pgvector hybrid (Stage 12) at Phase 2 exit if eval shows the gap |
| 0060 frontend hosting | Cloudflare kept for prototype vs Stage 19 Google-only – decision pending (R10) |

## 3. Phases

### Phase 0 – Base adoption (precondition, ~2–3 days)
**Goal:** the local folder becomes the git source of truth with a PR gate; no product change.
| Task | What | Model | Needs from owner |
|---|---|---|---|
| P0-1 | Local folder → git: `git init`, remote `sabarisv15/arcnave-tech`, `fetch`, `reset --soft origin/main`, review `git status` (no `.env`), commit "29 Sep work", push `main` (owner runs it; this one push deploys – accept or disable the trigger first) | owner | run commands |
| P0-2 | GitHub Actions `ci.yml`: `npx tsc --noEmit`, `npx vitest run` with a Postgres service, frontend `tsc -b && vite build && npm test`; required check on PRs to `main` | Sonnet | – |
| P0-3 | ADR-0053 + CLAUDE.md merge (our forbidden patterns, branch rule, model policy, numbers register pointer, Tanglish rule stays) + `docs/architecture/` read-only mirror of the 21 checkpoints + registers | Sonnet | – |
| P0-4 | Numbers register wiring: `settings` table (or typed config module) with `N-xx` comments; replace `.env` literals that map to N-ids; price table rows in **INR** (N-36) | Sonnet | – |
**Exit:** CI green on a no-op PR; `main` protected; ADR-0053 merged (owner merge = one deploy, or trigger paused).

### Phase 1 – Core turn, web chat (~2–3 weeks incl. local-stable iteration)
Already in repo and kept: users/chats/messages/usage tables, Argon2id auth, self-signup, SSE + replay, stop, per-user budgets, Markdown memory, web chat UI (stream, thinking, model/effort, edit/regenerate/versions, settings).
| Task | What | Model | Needs |
|---|---|---|---|
| P1-C | **Gateway:** `providers/anthropic.ts` on first-party API (`maxRetries: 0`, timeout matrix N-xx), remove Vertex Claude path and registry gate, remove gpt-oss, aliases = 3, app-level retry/timeout aligned to Stage 15 matrix, usage capture → ledger, cost INR | Opus | Claude API key in `backend/.env` (never committed) |
| P1-A | Price table + settings from P0-4 used by gateway and usage; `cost_inr` column (USD kept null-safe, invariant 2) | Sonnet | – |
| P1-B | **Google sign-in** (GIS) beside email/password; same session model | Opus | OAuth client id/secret |
| P1-E | **Content-leak CI test** (LV-91 target): log/trace lines must carry no user/model text – shadow mode first (report), enforce at Phase 5 | Sonnet | – |
| P1-D | **Prompt test kit** (Stage 6, 68 cases) ported as vitest against the repo prompt; critical gates block CI | Sonnet | – |
| P1-F | Academic use-case iteration on dev-local: campus question set, tool/skill pick checks, Tanglish/Tamil replies; fixes logged in `mistakes.md` | Sonnet / Opus as needed | owner's question set |
**Decisions in this phase:** ADR-0054/55/56/57/58.
**Exit (= local-stable gate B-11):** 3 models answer locally; kit critical gates 100 %; academic set passes owner review; then **dev run 1 + Terraform (ported) apply 1**.

### Phase 2 – Files and retrieval (~2 weeks)
Already in repo and kept: resumable upload to GCS, 500 MB / 20 files / 1,000 pages limits (to be re-pointed at N-10), poppler page images + text, office-via-sandbox read, Gemini OCR for scanned project files, Projects with files + instructions, BM25 `search_project_files`, citations from grounding.
| Task | What | Model |
|---|---|---|
| P2-A | **ZIP upload** (UD-2: one level, allowed types only, no nested ZIP), plus CSV/TXT/MD confirm, macro/legacy office rejection message (Stage 1 doc-sync) | Sonnet |
| P2-B | Upload limits from N-10 via settings; Send-block until file ready (D1) and failed-file Retry/Remove (AS-D6) UI check | Sonnet |
| P2-C | Sandbox + model-input bucket region → `asia-south1` (R11); verify GCS bucket location | Sonnet |
| P2-D | Retrieval eval set (Stage 12, LANG-1 A–D) on 20 Indian sample docs (PDF/DOCX/XLSX/scanned/Tamil/Hindi) against BM25; result decides ADR-0059 (pgvector hybrid now or Phase 5) | Opus (eval design) / Sonnet (run) |
| P2-E | Citation viewer check (pdf.js highlight) vs Stage 14; chunking numbers (N-xx) wired | Sonnet |
Deferred to Phase 5: ClamAV quarantine (DB-6), Document AI OCR (keep Gemini OCR), Cloud Tasks file queue (AS-D1), embeddings/reranker.
**Exit:** 20-doc set → retrieval p95 and citation match recorded (LV-72 targets); ZIP + region done.

### Phase 3 – Tools, artifacts, skills (~2 weeks)
Already in repo and kept: tool registry + turn router, warm sandbox (per-chat workspace, egress deny), web search/fetch/image search, artifacts (document/code/webpage/svg/slides) with versions and side panel, 13 display cards, 8 skills (Anthropic public set), share links, parallel tool calls, Continue at round limit.
| Task | What | Model |
|---|---|---|
| P3-A | Tool list conformance vs TD-1c (12 tools) – map repo tools to the Stage 8 names, document deltas, no renames unless required | Sonnet |
| P3-B | Flags on by default for dev (`ENABLE_TOOL_USE`, web, python) with N-xx caps; search per-turn caps 1/3/8 (TD-14) | Sonnet |
| P3-C | **6 skill packs** (Stage 8 SF-1…10) with ≥30 eval cases each; 99 % gate as nightly CI job | Opus (pack design) / Sonnet |
| P3-D | Artifact gate v1 (VD-7 subset): reopen docx/xlsx/pptx in sandbox + qpdf/pypdf strict; 1 repair | Sonnet |
| P3-E | Research mode: repo has grounded-search only; Stage 10 Research (plan → helpers → report) **Later** – record in ADR | – |
Deferred: admin panel v1 (company), long-task quotas per company, in-app notifications.
**Exit:** "upload → ask → chart/docx artifact → share" demo passes; skill evals ≥ 99 %.

### Phase 4 – Quality and safety (~2 weeks)
Repo has: answer-protocol guard, UI validator/authorizer, refusal as typed event, memory privacy regexes. Missing: Stage 13 validators, M9 safety screen, red-team set.
| Task | What | Model |
|---|---|---|
| P4-A | Stage 13 RP-1/RP-2 cheap checks: completion check (VD-6 deterministic), truncation auto-continue (VD-3), structured-output post-check (VD-4), retract list (VD-5), canary/secret scan | Opus |
| P4-B | RP-3 async claim judge on Flash-Lite (VD-1) for answers that used files/web; annotate only (VD-2); sampling 10 % | Opus |
| P4-C | M9 safety screen (rules + Flash-Lite structured verdict), crisis path text, `safety_events` table (ids/codes only) | Opus |
| P4-D | Red-team set (HarmBench/JailbreakBench subsets + own Tanglish/Hinglish) + memory eval set + full prompt kit on 3 models | Sonnet |
**Exit:** judge agreement vs human labels on 200 items meets the threshold fixed here; red-team thresholds met; kit critical gates 100 % on all 3 models. **Dev run 2 + Terraform apply 2.**

### Phase 5 – Company, ops hardening, production (~4 weeks)
Everything deferred lands here, in this order:
1. **Tenancy:** `company`, `company_plan`, membership + roles, invite/bulk invite, Postgres RLS on all 28+ tables with pgTAP suite in CI, per-company pools (N-11/N-18/N-30), admin panel v1, share links company-only default. (Opus)
2. **Scale:** Redis (rate limits, run-hub pub/sub, SSE relay), Cloud Tasks turn executor with checkpoints/fencing/cancel, Cloud Tasks file queue, Cloud Run min instances per N-25. (Opus)
3. **Observability + NO_CONTENT:** OTel OTLP, metrics catalogue, 4 SLOs, burn-rate alerts; `turn_logs` reduced to ids/codes/sizes/durations (ADR-0050 superseded); content-leak test switched to enforce. (Sonnet)
4. **Infra as code:** Terraform ported from the Python repo (projects, VPC/PSA, Cloud SQL HA, Redis, Secret Manager, WIF, Artifact Registry), Cloud Deploy canary, Binary Authorization, frontend hosting decision (ADR-0060). (Sonnet, apply = owner)
5. **Security:** TOTP, reCAPTCHA, session refresh rotation, SameSite cookie fix (same-origin API), Cloud Armor, audit WORM bucket, secret rotation; security checklist SE1–SE21. (Opus)
6. **Data + legal:** residency re-check (storage Mumbai, processing disclosure), retention table, DPDP mapping, privacy notice/ToS/AUP from lawyer (LW-01…45 tracker). (owner + lawyer)
7. **Retrieval upgrade** if ADR-0059 says so: pgvector + pg_textsearch hybrid, Embedding, reranker; Document AI OCR; ClamAV.
**Exit:** prod project live via canary, DR drill recorded, P0 security closed, lawyer sign-off. **Dev run 3 + Terraform apply 3 (+ prod).**

### Phase 6 – Android app + pilot (~4 weeks)
Expo SDK 57 app (chat/stream/resume, files, mic dictation, memory, artifacts/pdf viewer, hardened WebView, notifications), store release; pilot with 5–10 companies; cost recalibration from the real ledger (FD-01/03), price per company (FD-15 floors). Academics vertical (accreditation packs, college plan FD-16…19) after this.

## 4. Tracking
- Task briefs: `architecture/Stage-21-Implementation-Plan/build-tasks/tech-pX.Y.md` (new prefix `tech-` so they never mix with the archived Python `task-x.y.md`).
- Checkpoint for build state: repo `docs/checkpoints/CURRENT.md` (one block per task, as the repo already does) + this doc's phase table updated at each phase exit.
- Decision ids keep their stage names (TD-1c, VD-6, N-10 …) so every brief can cite the checkpoint.
- `mistakes.md` stays the repo's bug log; our review findings that are process lessons go there too.

## 5. Next action
P0-1 (owner, local git sync + push) → P0-2 brief.
