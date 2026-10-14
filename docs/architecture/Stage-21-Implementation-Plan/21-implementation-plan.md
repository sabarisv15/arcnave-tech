# ArcNave – Stage 21 · Implementation plan – LOCKED 2026-10-03 (IP-1…IP-10 OK)
_2026-10-03 · Synthesis of Stages 1–20 (no new research). Inputs: 20 checkpoints, review 1–12 + 13–20, LV-1 register (127 tests), lawyer list (45), numbers register (68), cost log (FD-01…21), package register (version pins). Domain **arcnave.in**. Segment: general-purpose B2B first (academics = first vertical Later)._

## 0. Principles
1. **Live-verify before code**: every LV-1 item that can change a design decision runs in Phase 0 against the real GCP project; code starts only on verified facts.
2. **Thin vertical slices**: each phase ends with something a user can click (not a layer).
3. **Build with Claude Code, one package at a time**, from the checkpoint docs: each task hands Claude Code the relevant checkpoint + contract docs, never the whole repo.
4. **Quality gates are code**: prompt test kit (68), skill evals (99 %), pgTAP RLS suite, content-leak CI test, licence/SBOM check – all in CI before Phase 6.
5. **Numbers come from the register** (N-01…68) – no literals in code; `settings` table + `price_book`.
6. **Nothing locked changes without a doc-sync** – the registers stay the single source of truth during build.
7. **Documentation is a phase-exit gate** (IP-10): every phase ends with product docs, API reference, architecture/ADRs, ops runbooks, legal/trust texts, changelog and the startup-programme pack updated (`docs/` in repo, structure in checkpoint §3). Claude's role during build = code review + documentation; coding = Claude Code.

## 1. Repository and workspace layout
```
arcnave/                      (GitHub org arcnave, private)
  infra/        Terraform: bootstrap/ (org policies, logging location, projects) · modules/ · environments/{dev,staging,prod}
  backend/      Python 3.13, uv · apps/api · apps/executor · apps/worker · apps/fetcher · packages/{gateway,context,retrieval,memory,tools,safety,validation,ledger,telemetry,db}
  parser/       LibreOffice + Docling image (isolated)
  sandbox/      Cloud Run Job image for run_code (isolated)
  browser/      Playwright image (artifact render tests, HTML→PDF)
  web/          Next.js 16 (app + admin + ops builds)
  mobile/       Expo SDK 57 Android
  prompts/      policy-spec v3 → system prompts (Claude/Gemini), skills/, evals/, test-kit/
  docs/         copy of Architecture checkpoints (read-only mirror) + ADRs for build-time deviations
  .github/      Actions: ci.yml (lint, tests, security scans), deploy-dev.yml, deploy-staging.yml, release-prod.yml (Cloud Deploy)
```
Claude Code conventions: `CLAUDE.md` at repo root lists the checkpoint docs, numbers register, forbidden patterns (content in logs, literals for N-xx, direct SDK retries, temperature params), and the test commands. One `CLAUDE.md` per app folder with its contracts.

## 2. Phases (24 weeks, 1 developer + Claude Code; dates relative to start)
### Phase 0 – Foundation + live verification (weeks 1–2)
**Build:** org policies + Logging location (bootstrap Terraform, by hand once) · projects dev/staging/cicd (prod later) · VPC/subnets/PGA/PSA · Artifact Registry · WIF + GitHub Actions skeleton · Cloud SQL dev (no HA) + Redis Basic · Secret Manager replicas · skeleton FastAPI "hello" on Cloud Run with OTel sidecar → Logging/Trace in Mumbai.
**LV-1 batch 1 (design-changing):** LV-01/02/17/18 (Vertex quotas, GLOBAL features, 429/529), LV-108 (GLOBAL via PGA no NAT), LV-11/12/101 (cache minimums + hit), LV-07/81 (Claude betas on Vertex), LV-35/105 (Doc AI Mumbai + quota raise), LV-109/27/125/126 (Cloud Run Job sandbox cold start, isolation, egress), LV-23/110 (RLS + pooling), LV-25/111 (ALB SSE 20 min), LV-115 (Executor startup < 4 min with reranker), LV-54/116 (pg_textsearch per-company partitions + side channel), LV-15/34 (google-genai tool schema), LV-77 (SDK retries off), LV-93/122 (usage parsing, count_tokens).
**Exit:** all batch-1 results recorded in the LV register; any FAIL → ADR + doc-sync before Phase 1.

### Phase 1 – Core turn, web chat (weeks 3–6)
**Build:** db package (Alembic, RLS, `company`, `user`, `company_plan`, `usage_counter`, `chat`, `message`, `turn`, `usage_ledger`, `price_book`, `settings`, `audit_event`) · auth (email/password Argon2id, Google sign-in GIS, TOTP, sessions/refresh rotation, reCAPTCHA) · self-signup + invite/bulk invite · API service (REST + SSE relay via Redis streams, RFC 9457 errors, request-id) · Turn Executor via Cloud Tasks (checkpoints, fencing, cancel) · Model Gateway (Gemini 3.8 Flash + Claude Sonnet/Opus via Vertex GLOBAL, no retries, timeouts matrix, usage capture, cost INR) · Context assembly v1 (policy-spec v3 prompts, history, summaries) · budget reservations + pool/per-user caps · basic memory (document memory, in-turn write, snapshot) · web app: chat, streaming, thinking summary, model/effort selector, edit/regenerate/versions, settings.
**LV-1:** LV-13/14/19/48/49/52/53/59 (prompt kit 68 on Gemini + Sonnet), LV-100 (real tokens/turn → cost model recalibration).
**Exit:** 3 internal users chat daily on dev for one week; ledger matches billing export within 2 % (LV-94); content-leak CI test green (LV-91).

### Phase 2 – Files and retrieval (weeks 7–10)
**Build:** upload sessions (resumable, limits N-10), ClamAV scan + quarantine, parser service (Docling, pypdfium2, LibreOffice→PDF, OCR via Doc AI + Gemini fallback, audio via Gemini provisional), chunking 800/15 %, Embedding 2 (text + page images), per-company partitioned chunk tables (BM25 + HNSW), planner (Flash-Lite), reranker (ONNX int8 in Executor), RRF, citation registry, file_search tool, projects (files + instructions + chats), citation viewer web (pdf.js highlight), Send-block until ready (D1), small-file fast lane.
**LV-1:** LV-03/09/36/37/38/39/40/41/42/43/44/45 (files), LV-55/56/57/58 (retrieval + LANG-1 A–D), LV-117 (dictation bake-off Gemini vs Chirp 3), LV-118 (reranker int8 quality), LV-120 (LibreOffice 26.8).
**Exit:** 20 Indian sample docs (PDF/DOCX/XLSX/scanned/Tamil/Hindi) → retrieval p95 ≤ 800 ms, citation match ≥ target (LV-72), file fast lane ≤ 10 s.

### Phase 3 – Tools, artifacts, Research (weeks 11–14)
**Build:** tool registry (11 tools), run_code sandbox = Cloud Run Job per run (inputs via signed URLs, dispatch deadline 20 s), fetcher service (NAT), web search (Gemini grounding / Claude native, suggestions rendering), artifacts (docx/xlsx/pptx/csv/charts/HTML) + LibreOffice render gate + qpdf, usercontent.arcnave.in preview (iframe sandbox, CSP), 6 skill packs + evals (99 % gate), Research mode (plan → helpers → report, Cloud Run Jobs, quotas), in-app notifications, long-task quotas, admin panel v1 (members, plan/pool usage with "last updated", model switches), share links (company-only default).
**LV-1:** LV-28/29/30/31/32/33 (tools/sandbox), LV-46/47/50 (agents/Research), LV-60 (skills 99 %), LV-65/119 (artifact render, Playwright), LV-75 (search suggestions), LV-123 (echarts licence).
**Exit:** end-to-end "upload → ask → chart artifact → share" demo; Research run on 20 questions within 30 min/50 searches.

### Phase 4 – Quality and safety (weeks 15–17)
**Build:** Stage 13 validators (claim judge Flash-Lite async, completion check, auto-continue, retract list, numbers reconciliation, artifact gate, canary/secret scan, sampling 10 %), M9 safety screen (rules + Flash-Lite structured verdict), crisis path (Tele-MANAS), abuse ladder + appeals, Model Armor shadow (English sample), safety_events + ops review queue, red-team set (HarmBench/JailbreakBench subsets + IndicGuard + own Tanglish/Hinglish + audio), prompt test kit full run on Gemini + Sonnet + Opus, memory eval set.
**LV-1:** LV-51/61/62/63/64/66/67 (validation, memory evals), LV-84/85 (M9 calibration, red-team), LV-16 (Flash-Lite roles), L11 Flash-Lite-for-Fast test + L5/L6 (Stage 18 levers).
**Exit:** judge agreement vs human labels on 200 items meets threshold fixed in this phase; red-team pass thresholds met; 68-case kit critical gates 100 %.

### Phase 5 – Ops hardening and production (weeks 18–20)
**Build:** prod project + HA (Cloud SQL HA, Redis Standard) before first paying customer, Cloud Deploy canary 25/50/100 + verification job, Binary Authorization enforce, SBOM/notices register, full observability (metrics catalogue, 4 SLOs, burn-rate alerts, PagerDuty/Pub/Sub/email/Slack, status page, dashboards), audit WORM bucket + hash chain, spend-cap budgets + alert budgets, secret rotation handlers, DR runbook drill to Delhi, chaos tests, pgTAP RLS suite in CI, security review checklist (SE1–SE21), privacy notice/ToS/AUP/grievance texts from lawyer (LW-01…45 closure tracker), Cloud Armor CRS enforce after tuning.
**LV-1:** LV-20/21/22/24/26, LV-76/78/79/80/82 (errors/chaos), LV-83/86/87/88/89/90 (security), LV-92/95/96/97/98/99 (observability), LV-102/103/104/106 (cost controls), LV-112/113/114 (deploy/DR/Armor), LV-121 (reproducible builds), LV-124 (SES/Zoho), LV-127 (ops IAP + bulk invite).
**Exit:** production deploy via canary, DR drill RTO/RPO recorded, all P0 security items closed, lawyer sign-off on launch texts.

### Phase 6 – Android app + pilot (weeks 21–24)
**Build:** Expo app (chat/stream/resume, files, mic dictation, memory, artifacts/pdf viewer, KaTeX WebView, hardened WebView, notifications), store release (no OTA), pilot with 5–10 companies (general-purpose), cost recalibration from real ledger (FD-01/FD-03 actuals), price per company fixed (FD-15 floors), plan pools tuned, feedback loop to backlog.
**LV-1:** LV-68/69/70/71/73/74 (rendering), LV-107 (pilot usage → price), LV-82 (reconnect on network switch).
**Exit:** first paying company live; monthly cost within +10 % of model; ops on-call rota running.

## 3. LV-1 test pack organisation
- `lv1/` folder in repo: one script/notebook per LV id, output JSON → `00-lv1-register.md` Result column (manual paste or script).
- Batches: **B1 Phase 0 (design-changing, 24 tests)** · B2 Phase 1 (10) · B3 Phase 2 (17) · B4 Phase 3 (12) · B5 Phase 4 (12) · B6 Phase 5 (32) · B7 Phase 6 (8). Total 127 (LV-05/06/08/10 informational, run when touched).
- A FAIL on a design-changing test → ADR in `docs/adr/` + doc-sync block on the affected checkpoint + register update, before dependent code.

## 4. Skills, prompts, evals deliverables
- Policy spec v3 → system prompts (Claude/Gemini) versioned in `prompts/`, config_version stamped per turn.
- 6 skill packs (Stage 8) with SF-1..10 framework, each with ≥30 eval cases; 99 % pass gate in CI (nightly on dev, costs tracked).
- Prompt test kit 68 cases (Stage 6) as pytest; critical gates block release.
- Red-team set (Stage 16) in `prompts/evals/safety/` with thresholds set in Phase 4.
- Memory eval set (Stage 11), retrieval eval set + LANG-1 variants (Stage 12), validation calibration set (Stage 13).
- Accreditation skill packs → Later (first vertical).

## 5. Numbers to confirm during build (numbers register "Stage 21" column)
N-05 whole-file limit 30k vs 100k (regression test) · N-25 min instances by measured load · N-27 retrieval latency budget actuals · N-36 price book actuals vs invoice · N-53 SLO targets after 4 weeks of data · N-59 token averages (FD-01) · N-63/64 after pilot · N-65/66 sizing/pool budget from Locust.

## 6. Lawyer / compliance track (parallel from week 1)
LW-01…45 grouped: (a) contracts + DPA + processor template, ToS/AUP/18+/grievance (needed by Phase 5) · (b) DPDP Rules mapping, legal_hold scope, CERT-In class, retention table (Phase 5) · (c) vendor disclosures (Vertex GLOBAL/Singapore, Brave, reCAPTCHA, SES/Zoho, PagerDuty/status page, GitHub) → subprocessor list + privacy notice (Phase 5) · (d) licences: THIRD_PARTY_NOTICES, IndicGuard, Semgrep rules, echarts licence check (Phase 3–5) · (e) GST entity + invoice (Phase 6).

## 7. Risks and mitigations
| Risk | Mitigation |
|---|---|
| LV batch-1 fails on a core assumption (PGA to GLOBAL, sandbox cold start, cache minimum) | Phase 0 before code; ADR + fallback listed per test (NAT for fetcher only, GKE gVisor, explicit cache) |
| Gemini 2027 price doubling before pilot pricing | price book row + price-revision clause; Flash-Lite-for-Fast test in Phase 4 |
| One developer bandwidth | Claude Code per package with contracts; strict phase exits; Android last |
| Tamil/Hindi quality (OCR, speech, retrieval, safety) | bake-offs in Phases 2 and 4 with human-rated sets; LANG-1 test-decided |
| Preview dependencies (Chirp Tamil/Mumbai, Cloud Run sandboxes, spend caps) | Preview items never on the critical path; GA fallbacks named |
| Cost overrun in pilot | spend caps 150 % forecast, per-company pools, daily ledger drift check |

## 8. Decisions (OK 2026-10-03)
| ID | Question | Recommendation |
|---|---|---|
| **IP-1** | Build order | Phases 0–6 as above (verification first, Android last) |
| **IP-2** | Timeline | 24 weeks to first paying company; Phase exits are gates, dates slip rather than gates |
| **IP-3** | Repo/workspace | Monorepo layout §1 with per-app CLAUDE.md |
| **IP-4** | LV-1 execution | 7 batches mapped to phases; FAIL → ADR + doc-sync before dependent code |
| **IP-5** | Quality gates in CI | prompt kit critical gates, skill evals 99 %, pgTAP RLS, content-leak test, licence/SBOM check, security scans |
| **IP-6** | Pilot | 5–10 general-purpose companies in Phase 6; price fixed from FD-15 floors after real usage |
| **IP-7** | HA/prod timing | prod project created Phase 5; HA on before first paying customer (Phase 6 start) |
| **IP-8** | Lawyer track | parallel from week 1, sign-off gate at Phase 5 exit |
| **IP-9** | Academics vertical | Later: after Phase 6 stable – accreditation skill packs + college plan (FD-16…19) |
| **IP-10** | Documentation | Phase-exit gate; docs.claude.com-style structure (product / API / architecture / ops / legal-trust / changelog) + startup-programme pack; owner reviews docs with code |

## 9. Doc-sync / registers
- Numbers register "Stage 21" column items (§5); LV register batch tags B1–B7; lawyer list grouping (a)–(e).
- Memory + Project: Stage 21 checkpoint after OK; architecture phase complete → build phase begins.
