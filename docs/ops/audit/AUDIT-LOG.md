# tech-audit.A — audit log (start to end)

Every step of the audit in order: what was done, what was found, what went wrong, what was
corrected. Findings themselves are in the per-file reports; every one of them is listed in
[`FINDINGS.md`](FINDINGS.md). Main session: Claude Opus 5.5 (`claude-opus-5-5`). Subagents:
Claude Sonnet 5.5. Date: 2026-10-15.

## 1. Setup

| # | Step | Result |
|---|---|---|
| 1.1 | Read the task brief (tech-audit.A, docs only). | Scope: Stages 1–21 vs the built repo; deep-dives D1 files, D2 AI output, D3 architecture; evidence pack; SUMMARY + NEW-PLAN; ADR-0061; CURRENT.md block. |
| 1.2 | Located the "built repo". The session opened in `D:\arcnave.in` (the archived Python repo, `sabarisv42/arcnave.in`, branch `task-1.12` with uncommitted doc changes — not touched). The added folder `C:\Users\HAI\Downloads\arcnave-tech-main\arcnave-tech-main` and `D:\arcnave-tech-main\arcnave-tech-main` are zip extracts without `.git`, dated 28 Sep, ADRs only to 0051 — older than the brief (which cites ADR-0053). | Neither local folder could carry a branch. |
| 1.3 | `gh repo list sabarisv15` → `sabarisv15/arcnave-tech` (private, pushed 2026-10-15). Remote `main` = `baca408` (merge of PR #40 `phase1/core-turn` and #39 `phase0/base-adoption`), has ADR-0053…0057, `docs/architecture/` mirror (93 files), `docs/checkpoints/CURRENT.md`, `mistakes.md`. | This is the built repo. |
| 1.4 | Cloned it to `D:\arcnave-tech` (new folder; nothing existed there). Branch `audit/stage-1-21` created from `origin/main` (`baca408`). | Audit branch ready. `main` not touched. |
| 1.5 | Read repo `CLAUDE.md` (invariants 1–7, build rules on this base), ADR-0053, build plan `00-Handoff/00-build-plan-arcnave-tech.md`, top of `CURRENT.md` (tech-p1 fix round 2026-10-15), `mistakes.md` headings (40 entries, 2026-09-16 … 2026-09-28). | Context for the owner rule: "repo wins" (ADR-0053 #2 / B-2) is the clause to supersede. |
| 1.6 | Checked the spec mirror against the Python repo's working tree: `Stage-07` checkpoint identical; ADR-0013 (Haiku 5.5 router) and ADR-0014 (worker jobs on Haiku) doc-syncs present in the mirror (Stage 7 doc-sync 2026-10-14, Stage 6 summary doc-sync). Python ADRs 0001–0014 exist only in `D:\arcnave.in\docs\architecture\adr\`. | Mirror = latest locked text. Port source reachable locally at `D:\arcnave.in`. |
| 1.7 | Reference handbook `docs/architecture/reference/claude-managed-agents-handbook.pdf`: not in the mirror; a disk-wide search was started and not needed. | Handbook ABSENT — D2/D3 do not cite it. |
| 1.8 | Model check: main session reports model id `claude-opus-5-5`. | As required. |
| 1.9 | Repo shape recorded for the briefs: backend 169 source files + 110 test files; largest files `services/generation.ts` 2,381 lines, `routes/chats.ts` 1,215, `db/schema.ts` 966; 8 skills; migrations to `0027`; CI `.github/workflows/ci.yml`; Dockerfiles for backend, frontend, sandbox. | Used to point each auditor at the right files. |

## 2. Subagent definition and launch

| # | Step | Result |
|---|---|---|
| 2.1 | Wrote the custom subagent `arcnave-auditor` at `C:\Users\HAI\.claude\agents\arcnave-auditor.md` (user level, outside both repos so the repo diff stays clean): tools `Read, Grep, Glob, Write`; model `claude-sonnet-5-5`; owner rule; bucket definitions; stage-file template; evidence rules (file:line, both values for N-xx, no secrets/ids); return ≤ 300 words. | Definition written. |
| 2.2 | Launched all 8 with `subagent_type: arcnave-auditor`, `model: sonnet`. | **Failed (all 8):** "Agent type 'arcnave-auditor' not found". Claude Code reads agent definitions at session start; a definition written mid-session is not loaded. |
| 2.3 | Fallback: `subagent_type: general-purpose`, `model: sonnet`, each prompt starting "read the role definition file first; use only Read, Grep, Glob, Write". First 3 launches returned an empty tool error. | **Deviation from the brief:** the tool restriction is an instruction, not enforced by the agent type. Recorded for the final report. |
| 2.4 | Owner attached `D:\Architecture`. Compared with the mirror: dated 3 Oct, Stages 1–13 only, latest doc-sync 2026-10-03/06 vs mirror 2026-10-14 (e.g. Stage 6 checkpoint 3,789 B vs 11,402 B; Stage 7 1,678 B vs 13,743 B). Extra artifacts there: `06-eval-cases-v1.json` (written here as "87 cases" — wrong, it holds 68; see C-1), `test-kit/arcnave-test-kit.zip` (68-case smoke kit: `cases.json`, `prompt_claude.txt`, `prompt_gemini.txt`, `smoke_test.py`), prompt `history/` v0–v2.1, Stage 8 `skill-tests/` (A4 Tamil docx, 16:9 pptx, lakh-format xlsx), astra test results. | Mirror stays the source of truth. `D:\Architecture` used only for those artifacts; the role definition was updated to say so. The kit zip cannot be read by the auditors' tools — noted. |
| 2.5 | Relaunched: G1 (Stages 1–5) first as a test — started. Then G2 (6–9), G3 (10–14), G4 (15–18), G5 (19–21 + numbers sweep), D1 file handling, D2 AI output, D3 architecture — all started. | 8 Sonnet 5.5 auditors running in parallel. |
| 2.6 | While they ran: wrote ADR-0061 (supersedes ADR-0053 Decision 2 "repo wins" sentence only; ADR-0053 not edited). Noted that ADR numbers 0056/0057 were used for Google sign-in and brand surfaces, not for the "typed errors kept" / "repo prompt kept" ADRs ADR-0053 had planned; 0058–0060 remain unwritten. | `docs/decisions/0061-…md`. |
| 2.7 | Owner asked (2026-10-15): document every subagent finding without missing one, and log the whole audit start to end. | Added this log and `FINDINGS.md` (master register with a count check against every source file). |

## 3. Subagent returns (verbatim summaries, in arrival order)

_Filled as each auditor finishes. Each block is the auditor's return as received (identifiers it mentions are named, never quoted). Stats: tokens / tool uses / wall time from the harness._

### 3.1 G5 — Stages 19–21 + numbers sweep (Sonnet 5.5; 415,621 tokens, 178 tool uses, 23.7 min)
Files: `stage-19.md`, `stage-20.md`, `stage-21.md`, `numbers-diff.md`, `_parts/deferred-g5.md`, `_parts/evidence-g5.md`.

> **Buckets (KEEP/REWRITE/NEW-BUILD/DISCARD/DIFF-STACK/DIFF-INFRA)** — Stage 19: 2/7/2/0/2/8 (21 rows) · Stage 20: 4/7/13/0/11/0 (35 rows) · Stage 21: 2/3/5/0/1/0 (11 rows) · Numbers, all 77 N-ids: DIFF 23, ABSENT 24, NOT-WIRED 2, MATCH 3, N/A-deferred 25. About 22 literals carry no N-id.
>
> **Top findings**
> 1. Hard-coded identifiers break A1: the production default for the signing service account (project id inside the e-mail) at `backend/src/tools/sandbox/cloudRunSandboxClient.ts:215`; the production API URL with a project number at `arcnave-frontend/src/api.ts:33`; 20 dev scripts hold the project id.
> 2. Frontend on Cloudflare (a CDN) calls a public run.app URL; session cookie forced to SameSite=None (`backend/src/routes/auth.ts:4-15`; `arcnave-frontend/src/api.ts:30-33`). ID-8 locks no CDN and same-site hosts.
> 3. AGPL `pymupdf` in the sandbox image (`backend/sandbox/Dockerfile.service:28`, taught by `backend/skills/pdf-reading/SKILL.md:32`). Stage 20 bans AGPL at runtime.
> 4. `backend/Dockerfile:69` runs `migrate || true` (a failed migration still starts the server); `SANDBOX_LOCATION` defaults to us-central1 (`backend/src/config.ts:254`); health path `/healthz` (locked `/health`); Swagger `/docs` live in prod (`backend/src/app.ts:135`).
> 5. CI runs only tsc + vitest (`.github/workflows/ci.yml`): no lint, scans, Dependabot or SBOM; images on `:latest`, no digest pins; the google-genai client does not set retries off (`backend/src/providers/gemini.ts:349`).
>
> **Open owner questions** — Q1 warm per-chat sandbox vs fresh Job per run (ID-7) · Q2 Cloudflare vs Google-only hosting (ADR-0060 never written) · Q3 `ANTHROPIC_API_KEY` (ADR-0054) vs WIF (locked) · Q4/Q8 Haiku router and worker jobs vs "three models only" · Q5 PG16 vs locked PG18 · Q6 ExcelJS vs VS-16 "no ExcelJS" · Q7 passwordless auth (locked) vs password + Google · Q9 which wins where repo values differ from the register (turn deadline, tool rounds, message size, uploads, session TTL) · Q10 identifiers in docs outside docs/ops · Q11 location of the 68-case prompt kit file.
>
> **Raise now** (deferred-g5.md) — a store interface for the in-process run hub (`backend/src/services/runHub.ts`), only if the turn runner is refactored in the same window; a scope or `company_id` column on any new settings or price table.
>
> **Could not check** — `.env.example` (Read permission denied); live regions of buckets/services (no live access); the Cloud Build trigger (outside the repo); default retry behaviour of `@google/genai` 2.22; resolved dependency / pip versions in built images (only package.json ranges and lock licence fields read); Python Phase 0/1 state beyond the doc-syncs.

Main-session notes on G5: (a) `.env.example` read was denied by a permission rule on `.env*` paths for the subagent; the main session did not bypass it — listed as an open item for the owner. (b) Q11 answered by the main session: the 68-case kit is `D:\Architecture\Stage-06-Context-Prompt-Assembly\test-kit\arcnave-test-kit.zip` (`smoke-test/cases.json`), not in the repo mirror.

### 3.2 D1 — file handling deep-dive (Sonnet 5.5; 426,858 tokens, 172 tool uses, 24.3 min)
File: `D1-file-handling.md` (7 sections, all 8 types traced).

> Reference handbook absent (stated once in the file).
>
> **Counts (40 gap rows):** NEW-BUILD 16, REWRITE 24, DISCARD 4, KEEP 14 (3 re-opened), DIFF-STACK 1; 4 DIFF-INFRA/deferred items listed unbucketed. Severity: P0 ×8, P1 ×26, P2 ×6. Verdict: the owner is right. The happy path works (PDF ≤ 100 pp as page images + text, images, text, Office), but it is a synchronous in-process extractor with 3 statuses.
>
> **Top 5 findings**
> 1. No OCR at upload. Chat scans over 100 pages are unreadable; project scans go in one Gemini call with no truncation check; mixed PDFs drop scanned pages. `backend/src/services/retrieval.ts:155-180`, `processUpload.ts:224-226`.
> 2. No token count and no whole-vs-retrieve rule for chat files (G18/G46/D1). Big PDFs and CSVs are sent whole every turn. `generation.ts:1738-1761`.
> 3. Project search is ASCII-only, so Tamil/Hindi chunks are invisible (`retrieval.ts:415-419`). Chunks capped at 400 per file silently (`:22`, `:686`).
> 4. Deleting a project file deletes bytes still used by chat attachments; every sandbox call in that chat then fails. `projects.ts:530-535`, `codeExecutionExecutor.ts:508-513`.
> 5. ZIP unsupported; `.xls` accepted and pinned by a test; Send blocked only while uploading; failed files are sent along; no Retry. `storage.ts:347-354`, `Composer.tsx:836-837`.
>
> **Other findings in the file:** audio over ~20 MB cannot be transcribed; pymupdf/pytesseract in the sandbox image against the TD-4c/AGPL exclusion; a chat file can be re-claimed by a new message (`chats.ts:1158-1165`).
>
> **Open owner questions:** 1 lift the "no token counting" rule (Invariant 3) for files? · 2 ADR-0045 pointer-only on sandbox turns vs Stage 9 CF4/D9-8 — which wins? · 3 build plan line 72 defers ClamAV, Document AI and embeddings to Phase 5 — which are in this pass? · 4 may ClamAV ship with a no-op dev scanner behind a flag? · 5 add `company_id` to new file tables now? · 6 approve new dependencies sharp/HEIC, documentai, pdf.js, ffmpeg? · 7 remove or keep tesseract in the sandbox? · 8 reject only true OLE2 `.xls`, accept HTML-table exports (AICTE)? · 9 keep or restrict extra accepted types (video, RTF/ODT/EPUB, code)? · 10 Gemini inline image limit (7 vs 20 MB), Claude request limit (30 vs 32 MB), image max (10 vs 20 MB) — settle via LV-1 · 11 B-4 "three models only" vs Stage 12 M3 planner / M5 reranker — conflict recorded, not resolved.
>
> **Could not check:** `.env.example` (permission denied); `backend/node_modules` not installed, so officeParser/pdf-parse output for PPTX notes and DOCX comments unverified (no fixtures); the xlsx@0.18.5 CVE claim is from the model's knowledge, not verified; LV-1 results; attachments bucket region (not in repo); nothing was run.

Main-session notes on D1: (a) Q1 "lift Invariant 3 for files" — Invariant 3 forbids a token *estimator* for reported usage; a provider `count_tokens` call (exact, from provider metadata) is not an estimator. To be checked against the invariant text in reconciliation (§4), not assumed. (b) xlsx CVE claim marked UNVERIFIED in FINDINGS.md.

### 3.3 D2 — AI output quality deep-dive (Sonnet 5.5; 571,386 tokens, 132 tool uses, 25.3 min)
Files: `D2-ai-output.md`, `_parts/evidence-d2.md`. Static trace only: no provider call, no turn log, no test run; the eight causes in §4 of the file are hypotheses until their confirm steps are run.

> **Counts (§3, 45 rows):** severity 9 High, 20 Medium, 14 Low, 2 KEEP with no gap. Primary buckets: REWRITE 24, NEW-BUILD 11, owner question 5, KEEP 4, DIFF 1.
>
> **Top 5 findings**
> 1. One Claude-app-shaped prompt and 35 tool declarations (~30k tokens, auditor's estimate) go to every model, including the default Gemini 3.8 Flash. Stage 6 locks two renderings and ~8.7k tokens. The repo says "Be concise by default" (`backend/src/services/systemPrompt.ts:66`); the locked Gemini text and every earlier prompt version say give complete answers (`06-system-prompt-v3-gemini.md:73`, eval case S18).
> 2. Auto sends almost everything to Gemini Flash and pins the chat there (`backend/src/providers/routing.ts:76`). Stage 7's rule for sending complex work to Sonnet and the Fast/Normal/Deep profiles are not built.
> 3. Gemini still clears old tool results at 100k tokens (`backend/src/providers/gemini.ts:382-408`), contradicting ADR-0023 and the mistakes.md 2026-09-25 rule.
> 4. History loads with the requested alias, usually `Auto`, so the window falls back to 128k and ~463k characters (`backend/src/services/generation.ts:445-450,1562-1577`). The oldest turns are dropped with no summary.
> 5. Nothing measures answer quality. The 68 Stage 6 cases (readable in `D:\Architecture`, not in the mirror) run nowhere; the prompt-size test bound was raised to ~10k tokens.
>
> **Open owner questions (full list in §7 of the file):** repo prompt (build plan 0057) or Stage 6 CXD-3b governs? · which tool vocabulary a v3 prompt describes: Stage 8's or the repo's 35? · compaction plan (0058) vs the Stage 6 summary and history budget · B-4 three models vs the Haiku 5.5 router and jobs · language rule: keep the Tanglish rule or restore the CXD-1 removal · math delimiter `\( \)` or `$$` · Gemini result clearing: reinstate ADR-0023 or supersede it · which turns were poor, which model answered, and the live `ENABLE_*` values.
>
> **Could not check:** `.env.example` and `backend/.env.example` permission-denied, so live flags and `PRICING_TABLE` unconfirmed; the 68-case kit zip unreadable; prompt and tool sizes are estimates (±25 %). **Correction to the main session:** `06-eval-cases-v1.json` holds 68 cases; the 87 `"id"` keys include 19 nested document ids.

Main-session notes on D2: (a) The correction is right — the main session counted `"id"` keys (87) and called them cases in §2.4 and in the role definition. Logged in §5 and in `mistakes.md`. So the 68 cases are readable as JSON in `D:\Architecture`; only the zip copy is unreadable. (b) Token sizes are estimates — FINDINGS.md marks them "est.", never as counts (Invariant 3 spirit).

### 3.4 D3 — architecture flaws deep-dive (Sonnet 5.5; 467,420 tokens, 167 tool uses, 25.5 min)
Files: `D3-architecture.md` (27 flaws), `_parts/evidence-d3.md` (test inventory). Handbook absent, not cited. `.env.example` unreadable (permission denied), so config drift against it not assessed. Nothing run.

> **Process note (auditor's own):** used Edit three times on `evidence-d3.md` to fix table numbers, although the brief allowed Read, Grep, Glob and Write only. Only that file was touched; stated in the D3 file too.
>
> **Counts:** P0 0, P1 12, P2 15. ~15 flaws cite a locked stage decision; the rest are repo rules or "ours". **Tests:** backend 893 cases in 110 files (568 unit, 325 need Postgres); frontend 351 cases in 41 files; sandbox Python 16 cases, not in CI.
>
> **Top 5 findings**
> 1. A-01/A-02: run control is a per-process Map and in-memory buffer, with up to 8 instances (`backend/src/container.ts:71`, `routes/chats.ts:568`). Answer text written only at the end (`services/generation.ts:2138`). No reaper for rows left `generating`; SIGTERM does not wait for runs (`index.ts:71-77`). Stage 5 R13 and Stage 10 AO-5 prescribe a DB lease and cancel flag, which need no Redis.
> 2. A-05/A-06: a turn is settled by independent commits in two different orders (`generation.ts:1056-1084` vs `:1169-1205`). Budget reads two sources, reservations have no expiry, `routes/styles.ts:222` swallows release failures.
> 3. A-08: the SSRF guard is a hostname regex (`services/webFetch.ts:19-37`): no DNS check, redirect checked after the request is sent, no test. Stage 8 C2 requires all of these.
> 4. A-09: rate-limit key is `request.ip` with no `trustProxy`, limiter registered before the session is resolved (`app.ts:93-107`). Behind Cloud Run likely one shared bucket for all users.
> 5. A-10: `backend/Dockerfile:69` runs `migrate.js || true`, so a failed or raced migration is ignored.
>
> **Open owner questions (Q1–Q9 in the file):** Q1 fallback chain and breaker (ER-2/ER-13) vs B-4 three models only · Q2 warm sandbox (ADR-0010/0015) vs TD-4b fresh-per-run; also a 5-workspace site-wide cap · Q3 is "sweeper + text flush + drain" the agreed interim before Cloud Tasks? · Q4 cross-origin `SameSite=None` and a literal production URL with a project number in `api.ts:33` · Q5 which side is the product path for file reading and for Office creation · Q6 may dev dependencies be added (OpenAPI types, SSE helper)? · Q7 database version: CI runs PG16, `pg_textsearch` needs PG17+ · Q8 is a hardened in-process fetch acceptable until a zero-permission fetch service (TD-3)? · Q9 may the `getDb()` singletons be injected before Phase 5? Otherwise tenancy costs a rewrite (no `company_id`, `user_id`-first unique keys).
>
> **Section 4 answer:** Redis relay, locks and rate-limit store cause no rewrite if A-01's DB lease is built and no new `activeRuns` reader is added. Cloud Tasks forces a rewrite unless turn parameters are persisted and the run can be loaded from a message id.
>
> **Not checked:** Stage 12 and Stage 9 documents; `docs/openapi.json` vs route schemas; anything at runtime. A-04, A-08, A-09 marked "prove with a test".

Main-session notes on D3: (a) Tool-rule deviation (Edit on its own file) accepted — no other file touched; checked in §6 diff. (b) A-10 and G5 finding 4 are the same defect (`backend/Dockerfile:69`) — one row in FINDINGS.md with both sources. (c) A-07/A-08/A-09 "likely" claims stay labelled "prove with a test".

### 3.5 G3 — Stages 10–14 (Sonnet 5.5; 473,842 tokens, 187 tool uses, 28.0 min)
Files: `stage-10.md` … `stage-14.md`, `_parts/deferred-g3.md`. Read-only run.

> **Counts**
> | Stage | KEEP | REWRITE | NEW-BUILD | DIFF-STACK | DIFF-INFRA | DEFERRED | n/a |
> |---|---|---|---|---|---|---|---|
> | 10 | 8 | 4 | 14 | 0 | 1 | 3 | 1 |
> | 11 | 6 | 14 | 2 | 0 | 0 | 2 | 1 |
> | 12 | 2 | 6 | 15 | 0 | 0 | 3 | 0 |
> | 13 | 4 | 7 | 15 | 0 | 0 | 0 | 0 |
> | 14 | 7 | 9 | 10 | 2 | 1 | 2 | 0 |
>
> **Top findings**
> 1. Keyword search is ASCII-only, so Tamil and Hindi queries find nothing; BM25 is scored in JavaScript over every chunk (`backend/src/services/retrieval.ts:415-419`).
> 2. Stage 13 has only the tool-marker guard (`answerProtocolGuard.ts:4-39`): no retract, canary scan, claim judge, completion check or `validation_result` table.
> 3. The run hub lives in process memory with 5-minute retention (`runHub.ts:17-20`). SSE has no `Last-Event-ID`, `snapshot` or named `ping` (`routes/chats.ts:668-692`, `813-815`).
> 4. Memory is whole-file rows with six tools (`tools/definitions.ts:274-385`, `db/schema.ts:763-799`); no line, source or tombstone tables; no sensitive opt-in.
> 5. The backend collects Google Search Suggestions but the UI never renders them (`generation.ts:926-936`, `adapter.ts:51`). The share route returns sources of grounded answers (`share.ts:383-393`) and `robots.txt` disallows `/s/` (`scripts/prerender.mjs:36`).
>
> **Owner questions** — Stage 12 hybrid retrieval vs repo Invariant 4 and ADR-0059: vectors now, or BM25 until the P2-D eval? (both options in stage-12.md) · Research mode: build plan P3-E says Later, checkpoint says MVP · 59-minute turn deadline vs the register's 10 minutes · helper models (Flash-Lite planner and judge, Embedding 2, Ranking API) vs ADR-0055 "three models only" · sensitive-memory opt-in vs the reference rule in `memory/policy.ts:61` · three memory tools (locked) vs the six built from the reference · token-denominated caps (chunk size, memory, retrieval share) vs Invariant 3 · charts: ECharts JSON vs Recharts · the repo's project-memory and past-chat search already exist, though locked as Later.
>
> **Raised now from the deferred part** — D-G3-01 build the chunk table partitioned per company from the start · D-G3-02 make the durable run store callable by turn id, without an HTTP request.
>
> **Could not check** — Stage 12 RE ids that 12c does not name, and the 12a / 11-memory MG details, not audited one by one; `Settings.tsx` memory UI, message paging, `pdfPages.ts` image budget, whether `loadHistory` drops refused turns — not read.
>
> **Self-reported slip:** stage-14.md D-05 bucket row pointed to "Q3 in stage-13.md"; should be Q1 in stage-14.md.

Main-session notes on G3: (a) Slip fixed in `stage-14.md:87` (C-2). (b) Finding 1 = D1 #3 = spot-check S-05 (one FINDINGS row, three sources). (c) Finding 3 overlaps D3 A-01/A-02. (d) "Could not check" items carried into FINDINGS.md as coverage gaps so they are not lost.

### 3.6 G4 — Stages 15–18 (Sonnet 5.5; 560,640 tokens, 186 tool uses, 29.5 min)
Files: `stage-15.md` … `stage-18.md`, `_parts/deferred-g4.md`, `_parts/evidence-g4.md`.

> **Buckets (KEEP/REWRITE/NEW-BUILD/DIFF-STACK/DIFF-INFRA; deferred not bucketed)** — S15 (51 ids): 8/24/8/1/2, deferred 7, n/a 1 · S16 (48): 7/14/12/0/3, deferred 12 · S17 (32): 4/4/3/2/0, deferred 18, superseded 1 · S18 (18 rows): 3/4/3/0/1, deferred 4, n/a 2, owner-Q 1.
>
> **Top findings**
> 1. `streamWithRetry` gates retry on text deltas only (`services/generation.ts:1387-1392`). A failure in tool round 2 re-runs round 1's tools, including write tools.
> 2. No first-token or stall timers (ADR-0024, `generation.ts:1361`). Turn deadline 59 min against 10 min (`config/numbers.ts:39`). The Gemini retry set is a text match that misses 502/408/409 and retries quota-0 429s (`providers/gemini.ts:233-238`). No breaker, fallback chain or `blocked`/`interrupted` finish code.
> 3. CSRF: SameSite=None cookie with no Origin check; body-less `POST /auth/logout` and `POST /chats/:id/stop` exposed (`routes/auth.ts:38,117-130`).
> 4. web_fetch SSRF filter: the `[::1]` bracket form defeats the IPv6 patterns, no DNS check, redirects followed before they are checked (`services/webFetch.ts:19-29,61,82-93`).
> 5. ER-11: the wire body is `{error:{...}}` (`errors.ts:9-17`), not problem+json. Option A in stage-15 keeps ApiError and the catalog and changes only the body (~63 test assertions move).
> Also: `GET ?q=` puts search text in URLs (`routes/chats.ts:202`, `artifacts.ts:82`, `projects.ts:109`). Auto routes attachment and research turns to Opus (`providers/routing.ts:65-71`).
>
> **Owner questions** — Q1 build the ER-4 timers or approve a deviation from ADR-0024? · Q2 fallback chain contents under Invariant 1; also the Haiku router/jobs and the M9 Flash-Lite call vs "three models only" · Q3 turn deadline 10 vs 59 min · Q4 ADR-0056 passwords vs SD-1 revised (passwordless, invite-only) · Q5 Invariant 3 (no estimator) vs OD-13 `estimated` · Q6 Claude cache second breakpoint vs N-74 · Q7 run_code 60/120 s vs 300 s · Q8 do the DF-2 URL change now.
>
> **Could not check** — `.env.example` (read denied); node_modules (SDK retry defaults unverified); live infra and headers; 17-observability and 18-cost-performance draft bodies (checkpoints and cost log used instead); GCS resumable behaviour. N-xx difference table is in stage-18.md §3.

Main-session spot-checks on G4: S-09 `generation.ts:1376-1392` — `userVisibleOutputEmitted` is set only by non-empty `delta` text or `code` events; tool-call rounds run inside the provider stream (`gemini.ts:393` round loop), so a failure after a tool-only round restarts from round 1 → CONFIRMED in code (runtime proof by test still owed). S-10 `gemini.ts:233-238` `isRetryable` = substring match on `429 / resource_exhausted / unavailable / 503 / 500 / deadline` → CONFIRMED (no 502/408; any 429 retried). S-11 `config/numbers.ts:38-39` `TURN_DEADLINE_MS` 3,540,000 with its own comment "register says turn 10 min (N-43, N-06)" → CONFIRMED. Overlaps: finding 4 = D3 A-08 = S-07; Auto→Opus for attachments is consistent with S-04.

### 3.7 G1 — Stages 1–5 (Sonnet 5.5; 646,323 tokens, 188 tool uses, 34.5 min)
Files: `stage-01.md` … `stage-05.md`, `_parts/deferred-g1.md`, `_parts/evidence-g1.md`.

> **Process note (auditor's own):** used Bash once (a read-only `ls`), against the role definition. Static reading only; nothing run.
>
> **Counts (KEEP/REWRITE/NEW-BUILD/DIFF-STACK/DIFF-INFRA/DEFERRED)** — S1: 20/8/4/0/2/9 · S2: 11/3/1/0/3/5 · S3: 21/7/2/0/0/3 · S4: 27/10/9/4/2/25 (the count paragraph in stage-04.md is garbled; use these) · S5: 13/11/4/1/1/12. Rows owned by Stage 6–17 groups marked n/a, not counted.
>
> **Top findings**
> 1. ZIP absent; `.docm`/`.xlsm`/`.pptm` get only the generic refusal with no "save as" text; legacy `.xls` accepted (`backend/src/services/storage.ts:341-390,479-483`).
> 2. `/v1/models` and `/models/refresh` have no auth guard (probe spends provider calls) (`routes/models.ts:36-179`).
> 3. No duplicate-send check (idempotency helpers unused, `routes/helpers.ts:85-140`), no `turns` table; one-running-turn exists only in memory (`routes/chats.ts:568`).
> 4. Answer text saved only at the end, so a crash leaves the row `generating` with no sweeper (`services/generation.ts:2138-2156`).
> 5. Untrusted PDFs and Office files parsed in the API process, not a sandbox (G34) (`services/attachments/processUpload.ts:170-234`).
> Also: regenerate overwrites the old answer (`chats.ts:1180-1215`); share token stored in clear (`schema.ts:475`); message text and metadata share one table (`schema.ts:271`).
>
> **Owner questions** — Q1 passwordless invite-only (ADR-0010) vs password + Google (ADR-0056)? · Q2 Haiku router/jobs (N-69/N-76) vs B-4 three models? · Q-V vector column vs repo Invariant 4? · Q-FB locked fallback chain vs Invariant 1? · Q-API rename `/chats` to the L3 catalogue? · Q3 do failed files block Send? · Q-E keep typed errors vs RFC 9457? · Q-INS 5,000 cap on existing 20,000-character instructions? · Q-Share share artifacts in full? · Q4 ZIP library or sandbox? · Q5 trim extra file types?
>
> **Raise now** — split message text from metadata before more readers are added (L now; same cost plus every new reader later). No `company_id` retrofit needed now.
>
> **Could not check** — `.env.example` (read denied); 04a-vendor-doc-research and 05-db-provider-comparison (not read); spec text for L4 G50–G63 (absent from the mirror); port source: "`D:\arcnave.in` holds only ADRs and a smoke test".
>
> **Self-reported corrections** — evidence-g1 says 56 error codes, true count 42; stage-02's count line garbled (its "Exact row counts" sentence is right).

Main-session notes on G1: (a) S-12 spot-check: `routes/models.ts:39` (`GET /models`) and `:166` (`POST /models/refresh`) add no `requireAuth` hook, and `app.ts:198-204` registers each module in its own scope so no shared guard applies → CONFIRMED. (b) Error-code count: 42 keys in `ERROR_CATALOG` counted by the main session (`errors.ts:25-238`); evidence-g4 also says 42 → evidence-g1 corrected (C-3). (c) stage-04 / stage-02 count lines annotated (C-4). (d) **G1's port-source statement is wrong** (C-5): `D:\arcnave.in\backend\packages\` holds `chat, context, db, gateway, ledger, memory, retrieval, safety, telemetry, tools, validation`, and `backend\apps\` holds the apps. G1's "Port source: none" lines in stage-01…05 are therefore not reliable; NEW-PLAN.md names the port package per task instead. (e) Bash-use deviation accepted (read-only `ls`, no write).

### 3.8 G2 — Stages 6–9 (Sonnet 5.5; 630,557 tokens, 162 tool uses, 42.3 min; last to finish)
Files: `stage-06.md` … `stage-09.md`, `_parts/deferred-g2.md`, `_parts/evidence-g2.md`.

> **Process deviation (auditor's own):** used Bash (read-only ls/grep/sed/cat) and Edit (4 small fixes to its own output files) although the brief allowed only Read, Grep, Glob and Write. No file outside the six above changed. Some outputs were later rewritten with Write, so "write once" was not kept either.
>
> **Buckets (rows with a bucket)** — Stage 6 (45 rows): KEEP 4, REWRITE 23, NEW-BUILD 18 · Stage 7 (15): KEEP 5, REWRITE 5, NEW-BUILD 4, DIFF-INFRA 1 · Stage 8 (27): KEEP 5, REWRITE 13, NEW-BUILD 9 · Stage 9 (26): KEEP 2, REWRITE 10, NEW-BUILD 13, DIFF-STACK 1 · Deferred: 22 items in deferred-g2.md (company, Cloud Tasks, Terraform, NO_CONTENT). One raise-now = yes (advisory): a nullable `company_id` on new tables this group builds (summaries, jobs, file pages); today's tables are user-keyed (`db/schema.ts:806-828`).
>
> **Top 5 findings**
> 1. Tools: up to 35 function tools, none named like the locked 12; only the old 5 sandbox tools, `search_project_files`, `read_project_file`, `web_fetch` and the memory tools exist (`tools/definitions.ts:11-521`). No per-tier caps (1/3/8 etc.), no result envelope or error codes, no profile concept.
> 2. Auto routing sends any attachment to Opus 5.5 (`providers/routing.ts:67-69`); the spec says Auto means Gemini and Opus is never a default. No fallback chain, no circuit breaker, no Haiku router (`providers/registry.ts:54-91`).
> 3. `web_fetch` SSRF check weak: hostname regexes only, no DNS resolution, redirects followed before the check (`services/webFetch.ts:19-29,82,89-93`).
> 4. Sandbox image installs pymupdf (AGPL), which TD-4c excludes (`backend/sandbox/Dockerfile.service:28`). Gemini combines googleSearch with function declarations in one call (`providers/gemini.ts:424-430`), against TD-2b.
> 5. The repo prompt is one Claude-reference text with a Tanglish paragraph (`services/systemPrompt.ts:63-65`). v3 has typed `[file:n]` citations, `model_info` / `capabilities_state` blocks, `current_time`, escaping and India helplines — the repo has none. Compaction trigger, 6-turn window, N-03 budgets, N-77 summary and the title job are all absent (`autoCompact.ts:36-51`; `routes/chats.ts:1171`).
>
> **Open owner questions** — OQ6-1/OQ7-1 Haiku 5.5 router, title and summary jobs (ADR-0013/0014) vs B-4 / ADR-0055 · OQ6-2 repo Invariant 3 forbids a token estimator; Stage 6 N-75/CG13 locks one · OQ6-3 remove the product Tanglish/language paragraph (CXD-1) or keep by exception? · OQ6-5 repo rule "Claude is the reference" vs the locked v3 prompt — confirm v3 wins · OQ6-6 copy the 68-case JSON from `D:\Architecture` into the repo · OQ7-2 with the per-company switch dropped, may a Gemini outage fall back to Sonnet automatically? · OQ7-3 keep the user `routingPreference` setting and sticky model, or remove? · OQ8-1 repo tools and skills outside TD-1c/SF-1 (display cards, show_widget, bash family, past-chat tools, pdf-reading …): ADR to keep, or discard? · OQ8-2 SerpAPI/Google CSE replaced by a grounding sub-call? · OQ8-3 confirm pymupdf removal · OQ8-4 shared warm sandbox vs a fresh isolated run per call · OQ8-5 provenance of the 8 skills (TD-11) · OQ9-1 are ClamAV and Document AI OCR owner-deferred? (build plan defers to Phase 5; ADR-0061 does not list them) · OQ9-3 types accepted beyond the spec (.xls, .odt, .rtf, .epub, html, code files, video).
>
> **Could not check** — `.env.example` (read denied; `config.ts` defaults used); test-kit zips; the role brief's "87 cases" is wrong — 68 (32 C, 34 S, 2 O); frontend model/fallback label display only partly checked; whether the repo skills were copied from Anthropic's public skills; Gemini SDK default retry behaviour; port-source Python skill content (listed only).

Main-session notes on G2: (a) Second independent confirmation of C-1 (68 cases). (b) G2 finding 2 says "the spec says Auto means Gemini and Opus is never a default"; D2 H3 says Stage 7 RT-1 locks "Auto → Gemini" for the MVP — consistent; the repo's attachments→Opus rule (`routing.ts:67-69`, S-04) is the deviation. (c) OQ6-2 is the one genuine Invariant-3 conflict (a locked token *estimator*), unlike the provider-count questions (S-13). (d) OQ9-1: ADR-0061 Decision 4 keeps only ADR-0053 #7's list as deferred (residency, NO_CONTENT, Terraform, OTel, Redis, Cloud Tasks). ClamAV and Document AI were deferred by the build plan's Phase 2 line 72, not by ADR-0053 #7, so under the owner rule their *outcome* (scan state, OCR quality) is in scope; the ClamAV daemon / Document AI processor provisioning is infra. Kept as an owner question, not decided. (e) Tool-rule deviations (Bash, Edit, rewrites) accepted after the §6 diff check shows no file outside `docs/ops/audit/` changed by any auditor.

## 4. Reconciliation and spot-checks by the main session

### 4.1 Spot-checks of top findings from every auditor (main session opened the code, `audit/stage-1-21` @ `baca408`)

| # | Claim (source) | Code read | Verdict |
|---|---|---|---|
| S-01 | Failed migration still starts the server (G5 #4, D3 A-10) | `backend/Dockerfile:67-69` — `node dist/db/migrate.js \|\| true; exec node dist/index.js`; the comment says this is deliberate (start even if migration fails, for health diagnostics) | CONFIRMED (deliberate, but no gate stops traffic to a server on an old schema) |
| S-02 | Gemini client does not turn SDK retries off (G5 #5) | `backend/src/providers/gemini.ts:349-353` — `new GoogleGenAI({ vertexai, project, location })`, no retry/httpOptions setting | CONFIRMED that nothing is set; whether @google/genai retries by default is UNVERIFIED (G5 could not check either) |
| S-03 | Gemini clears old tool results at 100k tokens, against ADR-0023 (D2 #3) | `gemini.ts:382-387` builds a `ContextEditingPolicy` from `CONTEXT_EDIT_*`; `:407` `if (lastPromptTokens >= editing.triggerTokens) contents = clearOldFunctionResponses(...)`. ADR-0023 Decision 1: "No context editing." | CONFIRMED |
| S-04 | Auto pins most turns to Gemini Flash (D2 #2) | `backend/src/providers/routing.ts:61-76` — grounding → economy; research → quality; attachments → quality; long context → quality; long prompt → balanced; else `default` → economy | CONFIRMED for plain text turns; "almost everything" is the auditor's wording — turns with attachments go to quality. Recorded with that qualifier. |
| S-05 | Project search tokenizer is ASCII-only (D1 #3) | `backend/src/services/retrieval.ts:415-418` — `match(/[a-z0-9']+/g)` | CONFIRMED — Tamil/Hindi/Devanagari text yields zero tokens, so BM25 cannot match it. P0 for an Indian product. |
| S-06 | Prompt says "Be concise by default" (D2 #1) | `backend/src/services/systemPrompt.ts:66` | CONFIRMED |
| S-07 | SSRF guard is hostname regex; redirect checked after fetch (D3 A-08) | `backend/src/services/webFetch.ts:19-37` regex list; `:82` `redirect: 'follow'`; `:89-92` final URL checked after the response arrived; no DNS resolution anywhere in the file | CONFIRMED |
| S-09 | Retry after a tool-only round re-runs round 1's tools (G4 #1) | `services/generation.ts:1376-1392` — `userVisibleOutputEmitted` set only by non-empty `delta` text or `code`; tool rounds run inside the provider stream (`gemini.ts:393` round loop) | CONFIRMED in code; runtime proof by test still owed |
| S-10 | Gemini retry set is a text match (G4 #2) | `providers/gemini.ts:233-238` substring match on `429 / resource_exhausted / unavailable / 503 / 500 / deadline` | CONFIRMED (no 502/408; any 429 retried) |
| S-11 | Turn deadline 59 min vs register 10 min (G4 #2, G3, G5) | `config/numbers.ts:38-39` `TURN_DEADLINE_MS` 3,540,000, comment itself says "register says turn 10 min (N-43, N-06)" | CONFIRMED |
| S-12 | `/v1/models` and `/models/refresh` have no auth guard (G1 #2) | `routes/models.ts:39` and `:166` add no `requireAuth`; `app.ts:198-204` registers each module in its own scope (comment: a shared scope would guard `/auth/login` too) | CONFIRMED |
| S-13 | D1 Q1 / G3 / G4 Q5 frame "token counts need Invariant 3 lifted" | Repo `CLAUDE.md` Invariant 3: "Token counts come from provider metadata or they are `exact: false` … There is no estimator". ADR-0020 decision 4: "counted in characters, not tokens: there is no token estimator (invariant 3)"; `generation.ts:331` comment "ArcNave counts no tokens (Invariant 3)" | **Re-framed:** a provider count call (Gemini `countTokens`, Claude `count_tokens`) is provider metadata, not an estimator, so Invariant 3 does not forbid it; ADR-0020 §4 and the code comment read the invariant more widely than its text. What *does* conflict with Invariant 3 is a tokenizer *estimate* (Stage 17 OD-13 `usage_source='estimated'`, G4 Q5). The owner question is narrowed accordingly in SUMMARY.md. |
| S-08 | Rate-limit key falls back to IP for everyone; no `trustProxy` (D3 A-09) | `backend/src/app.ts:93-101` keyGenerator `request.user?.id ?? request.ip`, registered before `contextPlugin` (`:106`), which sets `request.user` in its own hook (`plugins/context.ts:55`); `Fastify({...})` at `:56` has no `trustProxy` | CONFIRMED in code (rate-limit's hook runs before the user is resolved); the runtime effect behind Cloud Run stays "prove with a test" |

### 4.2 KEEP spot-checks by the main session (15 of 132 KEEP rows = 11.4 %; sample = every 9th KEEP row in FINDINGS order, plus three picked for risk: K-12, K-13, K-15)

| # | KEEP row | Code read | Verdict |
|---|---|---|---|
| K-01 | stage-09 G36 pixel cap 8000 × 8000 | `services/attachments/processUpload.ts:34` `imageMaxDimension: 8000` | CONFIRMED |
| K-02 | stage-13 V-23 no prefill | `providers/anthropic.ts:340-345` — last message is the user turn; no assistant prefill | CONFIRMED |
| K-03 | stage-14 D-28 SSE headers | `routes/chats.ts:802-809` `text/event-stream`, `no-cache, no-transform`, `keep-alive`, `X-Accel-Buffering: no` | CONFIRMED |
| K-04 | stage-16 SD-1e1 cookie httpOnly + secure + signed | `routes/auth.ts:4-16` (HttpOnly, signed, Secure in production) | CONFIRMED (SameSite=None is a separate finding, G4 #3 / G5 #2) |
| K-05 | stage-17 OD-15a no third-party client telemetry | grep for posthog/sentry/gtag/GTM/mixpanel/amplitude/plausible/clarity in `arcnave-frontend/src`, `index.html`, `package.json`: none | CONFIRMED |
| K-06 | stage-20 CVS6 exact model ids pinned | `config.ts:129-131` — Claude ids default to exact `claude-sonnet-5-5` / `claude-opus-5-5`; `MODEL_GEMINI_FLASH` has no default and its value lives in `.env.example`, which no one could read | **PARTIAL** — Claude confirmed, Gemini unverified |
| K-07 | stage-01 R5 six non-ZIP types accepted | `services/storage.ts:341-386` lists PDF, DOCX, XLSX, PPTX, CSV, PNG/JPEG, audio | CONFIRMED |
| K-08 | stage-11 M-01 file-per-subject memory with listing | `services/memory/memoryService.ts:446-457` lists keys + descriptions | CONFIRMED |
| K-09 | stage-03 1.2 login verified before guarded routes | `requireAuth` hook in every user-owned route module (`routes/*.ts`); `models.ts` is the known exception (S-12) | CONFIRMED with the noted exception |
| K-10 | stage-05 TB7 compaction rows per chat | `db/schema.ts:804-825` `conversation_compactions`, unique (chat, through_seq) | CONFIRMED (per chat; "per version" not visible) |
| K-11 | stage-02 S2-8 memory service present | `services/memory/` exists with service + policy | CONFIRMED |
| K-12 | stage-01 DS-D self-signup in MVP | `config.ts:91` `REGISTRATION_ENABLED` true; but the latest locked line (05-1 doc-sync, ADR-0010, 2026-10-09) is passwordless invite-only, and repo ADR-0056 (owner, 2026-10-14) keeps self-signup | **DOWNGRADED → owner question** (contested; not a clean KEEP) |
| K-13 | stage-04 E2 turn runner 409 on a second run | `routes/chats.ts:568` 409 from an in-process map | **DOWNGRADED → KEEP on one instance only**; with up to 8 instances the guard is per process (D3 A-01/A-03) |
| K-14 | stage-07 RT-9 public choices | four choices present (`providers/registry.ts:54-91`), but RT-9 says "Opus manual only" and Auto routes attachment/research turns to Opus (`providers/routing.ts:65-69`, S-04) | **DOWNGRADED → partial**; the Opus-default part is a REWRITE (already raised by G2 #2, G4, D2 H3) |

| K-15 | stage-07 NO-SILENT-SUB (the G2 auditor kept it KEEP but noted a downgrade risk; checked because Invariant 1 is the first repo invariant) | `services/generation.ts:1287-1303`: a requested alias that is unavailable falls back to Auto with only `log.info`; `:524-543` the `start` event carries `requested` and `resolved`; frontend `workspace.tsx:492` stores `resolved` and `App.tsx:1251` labels the message with it | **PARTIAL** — the answer is labelled with the model that really answered (Invariant 1 met in letter), but there is no reason code or visible notice that the picked model was unavailable (Stage 7 7.12 labelled switch) |

Result (15 checked): 10 confirmed, 5 qualified — K-06 and K-15 partial; K-12, K-13, K-14 downgraded. One KEEP in three of those checked needed a qualifier, so a KEEP row should be read as "KEEP for the single-user, single-instance prototype" unless re-checked; SUMMARY.md says so.

### 4.3 The same defect reported by more than one auditor (merged in SUMMARY / NEW-PLAN, kept separate in FINDINGS)

| Cluster | Reported by | Spot-check |
|---|---|---|
| ASCII-only BM25 tokenizer (`retrieval.ts:415-419`) | D1 #12a, G3 #1 | S-05 |
| Run hub in process memory; answer saved only at the end; no sweeper; no SIGTERM drain | D3 A-01/A-02, G1 #3/#4, G3 #3 | K-13 |
| SSRF guard regex only, redirects followed before check, `[::1]` | D3 A-08, G2 #3, G4 #4 | S-07 |
| `migrate \|\| true` at boot | G5 #4, D3 A-10 | S-01 |
| Auto → Opus for attachments; Auto → Gemini otherwise; no complexity route | G2 #2, G4 (also), D2 H3 | S-04, K-14 |
| pymupdf (AGPL) + pytesseract in the sandbox image | G5 #3, D1 #25, G2 #4 | — (Dockerfile line cited by three) |
| Gemini tool-result clearing against ADR-0023 | D2 #3 / X-1 | S-03 |
| Retry restarts tool rounds; no timers; no breaker; text-match retry set | G4 #1/#2, D3 A-07 | S-09, S-10 |
| SameSite=None cross-origin cookie, no Origin check; hard-coded production URL | G4 #3, G5 #1/#2, D3 Q4 | K-04 |
| Rate-limit key = proxy IP before session | D3 A-09 | S-08 |
| ZIP absent, `.xls` accepted, macro files without "save as" copy | G1 #1, D1 #1/#4 | — |
| Failed files sent; no Retry; Send blocked only while uploading | D1 #2, G1 Q3 | — |
| Haiku router / worker jobs vs "three models only" | G1 Q2, G2 OQ6-1/OQ7-1, G4 Q2, G5 Q4/Q8, D1 Q11, D2 Q4, D3 Q1, G3 | — (owner question, asked 8 times) |
| Turn deadline 59 min vs 10 min | G3, G4 Q3, G5 Q9 | S-11 |
| Passwordless invite-only (ADR-0010) vs password + Google (ADR-0056) | G1 Q1, G4 Q4, G5 Q7 | K-12 |

### 4.4 Assembly by the main session (all mechanical steps scripted, scripts kept in the session scratchpad, not in the repo)

| # | Step | Result |
|---|---|---|
| 4.4.1 | `FINDINGS.md` generated from every audit file: §3 bucket rows (KEEP included), §5 questions, §6 KEEP spot-checks, N-xx tables, D1 §2/§3/§4/§5/§6/§7, D2 §1/§2/§3/§4/§6/§7, D3 §1/§2/§3/§4/§5, numbers-diff §1/§3, all deferred parts, evidence-g4 log rows flagged C/I, evidence-g5 licence flags, every "Could not check" / "Not checked" line. Prose lines in the deep-dive traces are registered too, so a defect stated only in prose is not lost (e.g. D1 §3.9 audio P0). | 1,484 rows. Coverage table: for each source section an independent regex count equals the rows emitted — **every section matches**. |
| 4.4.2 | Parser fix found while counting: `stage-18.md` keeps its N-xx difference table inside §3; those 21 rows were first read as buckets. | Re-classified as `number`; bucket rows 690 → 669. |
| 4.4.3 | `EVIDENCE.md` and `DEFERRED.md` assembled from `_parts/` (content unchanged, headings shifted, index of brief items added; raise-now rows collected). | `_parts/` kept as the auditors' raw outputs. |
| 4.4.4 | SUMMARY counts, the REWRITE / NEW-BUILD list and the 37 superseded lines generated from the §1 / §3 tables. | 669 rows: KEEP 132, REWRITE 195, NEW-BUILD 167, DIFF-STACK 24, DIFF-INFRA 24, DEFERRED 71, n/a 52, owner-Q 2, superseded 2. |
| 4.4.5 | 126 raw owner questions merged into OQ-01 … OQ-32; script check: every question row of FINDINGS appears in SUMMARY §6, and every F-id cited there is a question row. | 126 / 126 mapped, 0 wrong ids. |
| 4.4.6 | NEW-PLAN: every one of the 362 REWRITE / NEW-BUILD rows assigned to a phase by a prefix table; prefix collisions found and fixed (`4:B2` had swallowed B20 / B24; `20:VS-1` had swallowed VS-17 / VS-19); D1 / D2 / D3 rows assigned by hand. | 362 / 362 assigned, 0 unassigned; Appendix B covers 46 D1, 45 D2, 27 D3 rows. |
| 4.4.7 | Secrets / identifier sweep over every new or changed file (e-mail pattern, service-account and key prefixes, PEM headers, `run.app` hosts, 12-digit numbers, project-id shapes). | No hit (only route paths such as `projects/reorder`). |
| 4.4.8 | Checked that no auditor wrote outside its files: `git status` in `D:\arcnave-tech` (only new files under `docs/ops/` and ADR-0061), `git status` in `D:\arcnave.in` (same as at session start), and no file modified today under `D:\Architecture` or `D:\arcnave.in`. | Clean. The Bash / Edit uses reported by G1, G2 and D3 touched only their own outputs. |

## 5. Corrections made

_Every place a subagent file or the main session was found wrong or inconsistent, and what was done._

| # | Who was wrong | What | Found by | Fix |
|---|---|---|---|---|
| C-5 | G1 auditor | Said the port source `D:\arcnave.in` "holds only ADRs and a smoke test"; it holds the full Python backend (`backend/packages/*`, `backend/apps/*`), infra and parser. Stage 1–5 "Port source: none" lines follow from that. | Main session (`ls D:\arcnave.in\backend\packages`) | Not rewritten in the stage files; flagged here and in FINDINGS.md; NEW-PLAN.md names port packages per task. |
| C-4 | G1 auditor | Garbled count paragraphs in `stage-04.md` §3 and `stage-02.md` §3. | G1 (self-reported) | Correction notes appended under each line with the auditor's numbers and the mechanical row counts; SUMMARY uses mechanical row counts. |
| C-3 | G1 auditor | `evidence-g1.md` said 56 ApiError codes; there are 42. | G1 (self-reported), main session counted | Number corrected in place, marked. |
| C-2 | G3 auditor | `stage-14.md:87` D-05 row cited "owner question Q3 in stage-13.md"; the charts question is Q1 in stage-14.md. | G3 auditor (self-reported) | Cross-reference corrected in place, marked "corrected by the main session". |
| C-1 | Main session | Called `06-eval-cases-v1.json` "87 cases" (§2.4, role definition) after counting `"id"` keys with grep; it holds 68 cases plus 19 nested document ids. | D2 auditor | Corrected here; `mistakes.md` entry added. Subagent files cite 68. |

| C-6 | Main session | Repeated the 2026-09-27 `mistakes.md` lesson in a scratch script: `$` sequences inside a `String.replace` replacement mangled `plan-map.mjs` twice. | Main session (syntax error on run) | Script rewritten with Write; nothing in the repo affected; noted in `mistakes.md` changelog with C-1. |
| C-7 | Main session | The first `FINDINGS.md` pass missed D2 §6's numbered test-gap list and every stage file's §6 KEEP spot-check (a downgrade there is a finding). | Main session review of the coverage table | Generator extended; 1,416 → 1,484 rows; all sections re-checked. |

## 6. Close

| # | Step | Result |
|---|---|---|
| 6.1 | `git add -A` then `git diff --cached --name-only` filtered against the allowed paths (`docs/ops/audit/`, ADR-0061, `docs/checkpoints/CURRENT.md`, `mistakes.md`). | No path outside the list. 45 files, additions only (`CURRENT.md` +block at top, `mistakes.md` +changelog line). Nothing to revert. |
| 6.2 | `mistakes.md`: at its 40-entry cap, so a changelog line (house convention) for C-1 and C-6, not a new heading. | Done. |
| 6.3 | One commit on `audit/stage-1-21`, one push of that branch. No PR merge, `main` untouched. | See the commit on the branch. |
| 6.4 | Models used: main session Claude Opus 5.5 (`claude-opus-5-5`); eight subagents Claude Sonnet 5.5 (passed as `model: sonnet`; the Agent tool takes the alias, not the full id). No Haiku. Total subagent use: 4,192,647 tokens, 1,372 tool uses. | — |
