# Stage 20 - Vendor and tool selection: conformance audit
Sources read: `docs/architecture/Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md` (all doc-sync blocks to 2026-10-10), `20-vendor-tool-selection.md` (BOM, licence rules, CVS), `00-numbers-register.md` (N-67), `docs/architecture/00-Handoff/00-build-plan-arcnave-tech.md`; repo: both `package.json` + lock `license` fields, Dockerfiles, `ci.yml`, `backend/src/{app.ts,config.ts,providers/*,services/retrieval.ts,services/documents/*}`, `arcnave-frontend/src/{MermaidBlock.tsx,SandboxFrame.tsx}`, `backend/skills/pdf-reading/SKILL.md`. Port source for CI gates: `arcnave.in:.github/workflows/ci.yml` (gitleaks line 565, bandit 592, pip-audit 610), `arcnave.in:.github/dependabot.yml`, `arcnave.in:.github/actions/trivy-image`. Dependency and licence lists: `_parts/evidence-g5.md`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Mapping rule used: Python package -> Node equivalent is DIFF-STACK when the outcome is met; a vendor named in the BOM as "not used" or a licence rule is outcome, not stack.

## 1. Locked decisions
| Id | Decision (one line) | Status |
|---|---|---|
| VS-1 | Digest-pinned runtime base images; separate parser and browser images | LOCKED (language part DIFF-STACK) |
| VS-2 | One worker per container, HTTP/1.1; SSE via a library; FastAPI-class stack. Doc-sync 2026-10-04: non-root uid 10001, no access log, health path `/health`, API docs/OpenAPI URLs disabled in the running service | LOCKED |
| VS-3 | Lock file with hashes, `--locked` installs, OS/model/font assets pinned | LOCKED |
| VS-4 | Request limits via `limits` on Redis + own token-budget accounting; Cloud Armor | LOCKED (Redis: deferred) |
| VS-5 | Plain Cloud Tasks handlers + Cloud Run Jobs; Postgres feature-flag table | LOCKED (Cloud Tasks: deferred) |
| VS-6 | pytest, Hypothesis, RESPX, Testcontainers, pgTAP, Locust + failure injection | LOCKED |
| VS-7 | ORM + async driver + migrations; pgvector 0.8.5; pg_textsearch with per-company list-partitioned chunk tables (BM25 + HNSW per partition); refined by ADR-0005 (query names own partition) | LOCKED |
| VS-8 | NFC normalisation + pg_trgm; no transliteration runtime | LOCKED |
| VS-9 | Reranker bge-reranker ONNX int8 | SUPERSEDED by doc-sync 2026-10-06 (ADR-0007: Vertex Ranking API, REST via AuthorizedSession, retry-free) |
| VS-10 | Token counting through provider APIs, counts cached per prompt version | LOCKED |
| VS-11 | redis-py, Memorystore 7.2 | LOCKED (deferred) |
| VS-12 | Docling, pypdfium2, pypdf, office libs, Pillow, libmagic, ClamAV via clamd socket, `zipfile` only, FFmpeg LGPL via subprocess | LOCKED |
| VS-13 | Own LibreOffice parser image (26.8 branch), macros off, Noto fonts | LOCKED |
| VS-14 | Playwright/Chromium image for HTML->PDF/PNG, non-root + seccomp, isolated only | LOCKED |
| VS-15 | DOMPurify (web) + nh3 (server); Bleach rejected | LOCKED |
| VS-16 | Spreadsheet preview = bounded server rows; **no SheetJS / ExcelJS** | LOCKED |
| VS-17 | Dictation bake-off (Gemini audio vs Chirp 3 Mumbai) | LOCKED (test) |
| VS-18 | Next.js 16 standalone on Cloud Run Mumbai, Node 24 LTS, no Vercel | LOCKED |
| VS-19 | Expo SDK 57, no OTA in MVP | LOCKED (Phase 6) |
| VS-20 | UI libs: markdown-it + remend, KaTeX, Shiki, ECharts, react-pdf + pdf.js, FlashList, virtuoso, WebView, Noto | LOCKED |
| VS-21 | Google Identity Services + Android Credential Manager, TOTP, PyJWT, google-auth. Doc-sync 2026-10-09: argon2 not used (no passwords) | LOCKED (auth design: Stage 16 audit) |
| VS-22 | E-mail: Amazon SES ap-south-1 only (ZeptoMail dropped 2026-10-09, FD-33), `boto3` for the mailer | LOCKED |
| VS-23 | Push: in-app only, no FCM / Expo push for content | LOCKED |
| VS-24 | Support: Zoho Desk India DC | LOCKED (SaaS) |
| VS-25 | Status / on-call unchanged | LOCKED (SaaS) |
| VS-26 | CI security: gitleaks, Bandit, pip-audit, OSV-Scanner, Trivy, Dependabot, npm audit; no TruffleHog / Renovate | LOCKED |
| VS-27 | Terraform BUSL + google provider + tflint + checkov | LOCKED (deferred) |
| VS-28 | OTel SDK + collector-contrib by digest, OTLP | LOCKED (deferred) |
| VS-29 | `anthropic[vertex]` with `max_retries=0`; google-genai Vertex mode with retries off (`HttpRetryOptions(attempts=1)`, doc-sync 2026-10-04); connector | `AsyncAnthropicVertex` SUPERSEDED by 2026-10-10 (ADR-0012: `AsyncAnthropic(max_retries=0)` + WIF); rest LOCKED |
| VS-30 | Structured output: schema + provider-native; citations and JSON format never in one Claude request | LOCKED (Stage 13 audit) |
| VS-31 | Own eval harness, promptfoo optional, guardrail libs recorded not used, SBOM (cyclonedx + registry export) | LOCKED |
| VS-32 | SaaS boundary: GitHub code only, Workspace ops identity only, customer data in Google Cloud India, published subprocessor list | LOCKED |
| VS-33 | Dev tooling: lint + strict type check as dev-only dependencies | LOCKED (doc-sync 2026-10-03) |
| LR | Licence rules: AGPL/SSPL excluded from runtime and CI; ELv2/BUSL/FSL per section 3; copyleft natives only through a process boundary with `THIRD_PARTY_NOTICES`; model/data licences registered | LOCKED |
| CVS1-CVS8 | Claude-only facts: SDK retries off + explicit deadlines (1); `count_tokens` (2); no Files API on Vertex (3); output_config.format vs citations exclusive (4); betas per header (5); pin exact model ids (6); Agent SDK not used (7); schema cache (8) | CVS1, CVS3, CVS5, CVS8 Vertex-specific: SUPERSEDED by 2026-10-10 (first-party API); others LOCKED |
| DS20 | Doc-sync details: VS-3 workspace/image copy rules (Python only); VS-9 export chain (superseded); register rows added | n/a for the Node repo |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched ...)" |
|---|---|
| VS-1 | Node bases without digest: `backend/Dockerfile:12,18,28`, `arcnave-frontend/Dockerfile:7,19`; sandbox `python:3.12-slim` without digest: `backend/sandbox/Dockerfile:9`, `Dockerfile.service:12`. Separate parser image: not found. Browser image: not found. |
| VS-2 | Fastify 5 + `@fastify/*`; SSE written by hand with a 15 s comment ping `backend/src/routes/chats.ts:805-817`. Container runs as `node` (`backend/Dockerfile:56`) - frontend nginx image has no `USER` (`arcnave-frontend/Dockerfile:19-29`). Swagger UI served at `/docs` in every environment (`backend/src/app.ts:109-135`). Fastify logs every request (no `disableRequestLogging`, `app.ts:56-72`). Health `/healthz`/`/readyz` (`routes/health.ts:20,43`). |
| VS-3 | `npm ci --omit=dev --ignore-scripts` (`backend/Dockerfile:15,21`), lock files present with integrity hashes; OS packages unpinned (`:34-36`, sandbox Dockerfiles). |
| VS-4, VS-5, VS-11 | `@fastify/rate-limit` in-process `backend/package.json:28`, `app.ts:93-101`; flags are env booleans `config.ts:179-228`; no Redis / Tasks client (`package.json:23-51`). |
| VS-6 | vitest 5.0.1 backend (`backend/package.json:62`, `vitest.config.ts:5`), vitest 4.1.11 frontend; Postgres service in CI `.github/workflows/ci.yml:23-35`; no pgTAP, no load / chaos tool (searched `locust`, `k6`, `artillery`, `autocannon` in repo: none). |
| VS-7 | Drizzle + postgres.js (`package.json:36,47`); FTS is a GIN `to_tsvector('simple', ...)` index `backend/drizzle/0007_smart_maximus.sql:43`; no pgvector (CLAUDE.md invariant 4 forbids an embedding column), no `company_id` partitioning (searched `company` in `db/schema.ts`: 0 hits); Postgres 16 (`ci.yml:24`, `compose.yaml:16`). |
| VS-8 | `normalize('NFC')` / `pg_trgm` / `similarity(`: not found (searched `backend/src`, `backend/drizzle`). |
| VS-9 | No reranker, no Vertex Ranking call (searched `rank`, `discoveryengine`: none in `backend/src` providers). |
| VS-10 | `countTokens` only in dev scripts (`backend/src/scripts/measureTokens.ts:5-6`, `runGeminiPromptCacheEvaluation.ts:59`); turn budgeting uses provider usage after the call (`services/usage.ts`, invariant 3 in `CLAUDE.md:24-26`). |
| VS-12 | Libraries: `pdf-lib`, `pdf-parse`, `officeparser`, `docx`, `exceljs`, `xlsx`, `pptxgenjs`, `image-size`, `fflate`, `jszip` (`backend/package.json`); poppler CLI `backend/Dockerfile:35`; sandbox `pymupdf` (AGPL-3.0) `backend/sandbox/Dockerfile.service:28`, taught to the model by `backend/skills/pdf-reading/SKILL.md:32-67`; ClamAV, FFmpeg, ZIP handling: not found (searched `clam`, `ffmpeg`, `zip` in `backend/src`, only `fflate`/`jszip` for export and verify). |
| VS-13 | LibreOffice only as `libreoffice-nogui` inside the sandbox images (`Dockerfile:12`, `Dockerfile.service:19`); no separate isolated parser image, no version pin. |
| VS-14 | `puppeteer-core` dev dependency only (`backend/package.json:58`); no Chromium image (searched `chromium`, `playwright` in Dockerfiles: none). |
| VS-15 | Markdown rendered by `react-markdown` without `rehype-raw` (searched `arcnave-frontend/src` non-test: none); Mermaid `securityLevel: "strict"` `arcnave-frontend/src/MermaidBlock.tsx:123`; HTML artifacts in sandboxed iframe with CSP `default-src 'none'` `SandboxFrame.tsx:11,20-25`. No DOMPurify, no nh3 server-side. |
| VS-16 | `xlsx` imported in `backend/src/services/retrieval.ts:14`; `exceljs` in `retrieval.ts:13`, `services/documents/sheetPreview.ts:6`, `xlsxRenderer.ts:8`, `verify/xlsxVerify.ts:7`. Preview rows 200 / cols 50 `sheetPreview.ts:8-9`. |
| VS-17 | Browser speech recognition, client-side (`arcnave-frontend/src/Dictation.tsx:44`, ADR-0042); no Gemini-audio / Chirp path, no bake-off. |
| VS-18 | Vite 6 SPA + prerender (`arcnave-frontend/package.json:8`), Node 22 (`ci.yml:45`, Dockerfiles); no Next.js. |
| VS-19 | No Expo / mobile folder (searched repo root: `arcnave-frontend`, `backend`, `docs`, `tools` only). |
| VS-20 | `react-markdown`, `rehype-highlight`, `rehype-katex`, `katex`, `recharts`, `mermaid`, `docx-preview` (`arcnave-frontend/package.json:27-40`). pdf.js / react-pdf / ECharts / Shiki / FlashList / virtuoso: not found. |
| VS-21 | `google-auth-library` `OAuth2Client` ID-token check `backend/src/services/googleSignIn.ts:9`; password hashing `@node-rs/argon2` `backend/src/services/auth.ts:10`; TOTP / JWT / refresh: not found (searched `totp`, `otp`, `jwt`, `refresh` in `routes/auth.ts`, `services/auth.ts`). |
| VS-22 | No e-mail sender (searched `ses`, `smtp`, `mailer`, `nodemailer` in `backend/src`: none). |
| VS-23 | No push dependency in `backend/package.json:23-51` or `arcnave-frontend/package.json:15-41`. |
| VS-24, VS-25 | No repo artefact (SaaS). |
| VS-26 | `ci.yml` runs typecheck + tests only (`:41-78`); no gitleaks / OSV / Trivy / audit step, no `.github/dependabot.yml` (`.github` holds `workflows/ci.yml` only), no SBOM, no `THIRD_PARTY_NOTICES` (searched `**/THIRD_PARTY*`, `**/LICENSE*`, `**/sbom*`: none). |
| VS-27, VS-28 | No Terraform, no OTel (deferred). |
| VS-29 | `@anthropic-ai/sdk` `maxRetries: 0` + timeout `backend/src/providers/anthropic.ts:44-55`; `@google/genai` client built without `httpOptions.retryOptions` (`providers/gemini.ts:349-353`), per-request `httpOptions: { timeout }` only (`:327,447,644`). |
| VS-30 | Not assessed here (Stage 13 audit). |
| VS-31 | Eval scripts `backend/src/scripts/run*Evaluation.ts`, prompt kit `backend/src/test/promptKit/` (tech-p1 item D), `docs/evals/`. SBOM: not found. |
| VS-32 | Frontend deployed with Cloudflare (`arcnave-frontend/wrangler.jsonc`); model-written HTML may load scripts from `cdnjs.cloudflare.com` and `cdn.jsdelivr.net` (`SandboxFrame.tsx:21`, `backend/src/services/systemPrompt.ts:239`). |
| VS-33 | `typescript-eslint` + `eslint` in dev deps and a `lint` script (`backend/package.json:14,55,60`), but no ESLint config file (searched `backend/eslint.config.*`, `.eslintrc*`: none) and CI does not run lint. `tsconfig.json:9-10` has `strict` + `noUncheckedIndexedAccess`. |
| LR | AGPL package: `pymupdf` (above). No AGPL/SSPL/BUSL in either lock (lock `license` fields grepped). THIRD_PARTY_NOTICES: not found. |
| CVS | CVS1: `anthropic.ts:44-55`. CVS6: exact ids `claude-sonnet-5-5`, `claude-opus-5-5` `backend/src/config.ts:130-131`, `providers/capabilitiesTable.ts:109-112`. CVS7: no Agent SDK in `package.json`. |

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| VS-1 | REWRITE | Digest-pin base images, move sandbox to 3.13 (same work as stage-19 S19-13) |
| VS-2 | DIFF-STACK | Fastify 5 instead of FastAPI / Uvicorn |
| VS-2b | REWRITE | Docs UI public in production; per-request access logging on; frontend image root; `/health` path |
| VS-3 | DIFF-STACK | npm lock + `npm ci` instead of uv |
| VS-6 | DIFF-STACK | vitest + real Postgres service instead of pytest + Testcontainers |
| VS-6b | NEW-BUILD | No load / failure-injection harness (Phase 5 gate) |
| VS-7 | DIFF-STACK | Drizzle + postgres.js instead of SQLAlchemy / asyncpg / Alembic |
| VS-7b | NEW-BUILD | pgvector + pg_textsearch per-company partitions on PG18 absent (Stage 12 owner) |
| VS-8 | NEW-BUILD | No NFC normalisation, no pg_trgm |
| VS-9 | NEW-BUILD | Vertex Ranking API reranker absent (ADR-0007; Phase 2) |
| VS-10 | NEW-BUILD | No pre-send provider token counting (usage only after the call) |
| VS-12a | DIFF-STACK | pdf-lib / pdf-parse / officeparser / exceljs are the Node equivalents |
| VS-12b | REWRITE | `pymupdf` is AGPL; licence rule forbids it |
| VS-12c | NEW-BUILD | No ClamAV quarantine, no FFmpeg, no ZIP intake |
| VS-13 | NEW-BUILD | No isolated, pinned LibreOffice parser image |
| VS-14 | NEW-BUILD | No Playwright/Chromium render image |
| VS-15 | DIFF-STACK | Outcome (no raw HTML, strict Mermaid, CSP iframe) met by different libraries |
| VS-16 | REWRITE | Stale SheetJS `xlsx` in the retrieval path (ExcelJS kept as stack equivalent, see Q) |
| VS-17 | NEW-BUILD | Browser dictation only; no engine bake-off, audio leaves via browser vendor |
| VS-18 | DIFF-STACK | Vite SPA instead of Next.js 16, Node 22 instead of 24 (hosting is stage-19 S19-07) |
| VS-19 | NEW-BUILD | Expo app absent (Phase 6) |
| VS-20a | DIFF-STACK | react-markdown / rehype-highlight / recharts instead of markdown-it / Shiki / ECharts |
| VS-20b | NEW-BUILD | pdf.js / react-pdf citation viewer, virtualised lists absent |
| VS-21 | DIFF-STACK | google-auth-library = google-auth equivalent (rest is Stage 16) |
| VS-22 | NEW-BUILD | No SES mailer (conditional on the Stage 16 passwordless decision) |
| VS-23 | KEEP | No push dependency anywhere (`backend/package.json:23-51`) |
| VS-26 | NEW-BUILD | No secret / dependency / image scan, Dependabot, SBOM, notices register |
| VS-29a | DIFF-STACK | `@anthropic-ai/sdk`, `@google/genai`, `@google-cloud/storage`, `google-auth-library` |
| VS-29b | REWRITE | google-genai retries not explicitly off |
| VS-31 | DIFF-STACK | Own harness exists (scripts + prompt kit) |
| VS-32 | REWRITE | Cloudflare hosting and CDN-loaded scripts sit outside the stated SaaS boundary |
| VS-33 | REWRITE | ESLint declared but not configured or run |
| CVS1 | KEEP | `maxRetries: 0`, explicit timeout (`anthropic.ts:44-55`) |
| CVS6 | KEEP | Exact model ids pinned in config |
| CVS7 | KEEP | Agent SDK not used |
Not bucketed: VS-4, VS-5, VS-11, VS-27, VS-28 (owner-deferred), VS-24, VS-25 (SaaS, no repo artefact), VS-30 (Stage 13), CVS2 (= VS-10), CVS3/CVS5/CVS8 (Vertex-specific, SUPERSEDED 2026-10-10), CVS4 (Stage 13), LR copyleft-notices (folded into VS-26), DS20 (Python only).

Counts: KEEP 4 - REWRITE 7 - NEW-BUILD 13 - DISCARD 0 - DIFF-STACK 11 - DIFF-INFRA 0 (35 rows).

## 4. Non-KEEP items
### VS-1 - Image bases and pins
- Exact change: bases by digest; sandbox on `python:3.13-slim-trixie`; pinned requirements with hashes for the sandbox; apt versions recorded. Files: the four Dockerfiles in the evidence pack. Port source: arcnave.in image Dockerfiles (digest pattern).
- Option A (REWRITE): do it with S19-13. Time S-M. Risk: sandbox package upgrades change outputs. Breaks `backend/sandbox/test/*` if versions move.
- Option B: digest-pin only the Node bases. Time S. Risk: sandbox stays unreproducible.
- Pick: A.

### VS-2b - Running-service hygiene
- Exact change: register Swagger/`/docs` only when not production; `disableRequestLogging: true` and log id, code, status, duration (Stage 17 OD-2 / NO_CONTENT); frontend image `USER nginx`; `/health`. Files: `backend/src/app.ts:56-72,109-135`, `arcnave-frontend/Dockerfile`. Port source: arcnave.in:`backend/apps/api` app factory (docs URLs off).
- Option A (REWRITE): above. Time S. Risk: tests that fetch `/docs` or rely on request logs. Breaks `openapi` script? (`npm run openapi` builds the app offline, `package.json:21`; check it still works with docs off).
- Option B: leave docs on behind auth. Time S. Risk: attack surface in prod.
- Pick: A.

### VS-6b - Load and failure injection
- Exact change: a load / chaos suite (Locust is MIT and can stay a Python dev tool; k6 is AGPL, excluded) driving SSE turns with injected provider faults. Files: new `loadtest/` folder + CI optional job. Port source: arcnave.in:`backend/tests` fault injection and `lv1/` scripts (not opened). 
- Option A (NEW-BUILD): after Phase 4. Time M. Option B: reuse `backend/src/scripts/runReliabilityMatrix.ts`. Time S, covers only provider faults.
- Pick: B now, A in Phase 5.

### VS-7b - pgvector + pg_textsearch per-company partitions
- Exact change: PG18 Cloud SQL, `vector` extension, `pg_textsearch` index per company partition queried by its own partition (ADR-0005). Owner of the design: Stage 12 audit. Files: new Drizzle migrations, `retrieval.ts`. Repo invariant 4 (no embedding column) must be amended by ADR first. Port source: arcnave.in:`backend/packages/retrieval`, ADR-0005.
- Option A (NEW-BUILD): build beside the BM25-in-app path, switch after the retrieval eval (build-plan P2-D). Time L. Option B: keep the lexical path (ADR-0059 never written). Time 0, leaves Stage 12 unmet.
- Pick: A, scheduled with Stage 12. Tenancy shape question is in `_parts/deferred-g5.md`.

### VS-8 / VS-10 - Indic normalisation and provider token counts
- Exact change: NFC-normalise text at ingestion and before search; `pg_trgm` fuzzy fallback (needs migration); pre-send `count_tokens` / `countTokens` with caching per prompt version, only when near the budget. Files: `services/retrieval.ts`, `services/generation.ts`, `providers/*`. Port source: arcnave.in:`backend/packages/context`.
- Option A (NEW-BUILD both). Time S each. Risk: CLAUDE.md invariant 3 ("no estimator") stays true because counts come from providers, not estimates.
- Option B: skip counting until budgets exist. Time 0; leaves N-03 enforcement without a source.
- Pick: A for VS-8 now; VS-10 with context assembly (Stage 6).

### VS-9 - Vertex Ranking API reranker
- Exact change: REST call with `google-auth` `AuthorizedSession` (no new SDK, retry-free), model per N-26, top 30, p95 <= 600 ms. Files: new `providers/ranking.ts` (inside the providers boundary). Port source: arcnave.in:`backend/packages/retrieval` (reranker client).
- Option A (NEW-BUILD): with Phase 2. Time M. Option B: RRF only until retrieval is vector-based. Time S.
- Pick: A with Stage 12.

### VS-12b - Remove AGPL `pymupdf`
- Exact change: delete `pymupdf` from `Dockerfile.service`, replace in `pdf-reading/SKILL.md` and its tests with pypdfium2 (Apache/BSD) + poppler CLI + pdfplumber; update `skillContent.test.ts:32`. Files: `backend/sandbox/Dockerfile.service:28`, `backend/skills/pdf-reading/SKILL.md`, `backend/src/services/skillContent.test.ts`. Port source: none.
- Option A (REWRITE): swap and re-run the skill's golden cases. Time M. Risk: rendering helpers differ (`get_pixmap`, `get_images`, widgets) - SKILL examples rewritten.
- Option B: buy a commercial MuPDF licence. Time S. Risk: cost and still not in the locked BOM.
- Pick: A.

### VS-12c / VS-13 / VS-14 - ClamAV, parser image, render image
- Exact change: ClamAV daemon scan + quarantine before any parse; FFmpeg LGPL build for audio; ZIP intake with `fflate`-style guarded extraction (the locked rule is "zipfile only, no 7z"); separate isolated LibreOffice parser image; Chromium render image (non-root, seccomp). Files: new images + `services/attachments/processUpload.ts`. Build plan defers ClamAV to Phase 5 (DB-6). Port source: arcnave.in `parser/`, `browser/` (README stubs only), Stage 9 / 14 audits own the design.
- Option A (NEW-BUILD each, beside current sandbox paths). Time L total. Option B: keep LibreOffice in the sandbox until Phase 5. Time 0; violates VS-13 isolation.
- Pick: A, ordered by the build plan.

### VS-16 - SheetJS `xlsx`
- Exact change: remove `xlsx` (SheetJS CE 0.18.x, no longer updated on npm) from `retrieval.ts:14` and package.json; read XLSX through the sandbox/parser (openpyxl, bounded rows) or ExcelJS. Files: `backend/src/services/retrieval.ts`, `backend/package.json:49`. Port source: arcnave.in:`backend/packages/tools` spreadsheet reader.
- Option A (REWRITE): replace `xlsx` with ExcelJS now (already a dependency). Time S. Risk: legacy `.xls` support; ExcelJS stays against the literal VS-16 wording (Q6).
- Option B: do all spreadsheet reading in the sandbox with openpyxl (locked wording). Time M-L; needs the job-per-run path.
- Pick: A now, B if the owner holds VS-16 literally.

### VS-17 - Dictation engine
- Exact change: bake-off Gemini 3.8 Flash audio vs Chirp 3 Mumbai on Tamil / Hindi / Tanglish clips, then server-side transcription (residency); mic cap 2 min (N-12). Files: `arcnave-frontend/src/Dictation.tsx`, new route. Port source: none. 
- Option A (NEW-BUILD): after Phase 2. Time M. Option B: keep browser recognition and document that audio goes to the browser vendor. Time 0; residency gap.
- Pick: A.

### VS-19 / VS-20b / VS-22 - Expo app, pdf viewer, mailer
- VS-19: Expo SDK 57 app, Phase 6, NEW-BUILD (L). VS-20b: pdf.js highlight viewer (Stage 14), M. VS-22: SES Mumbai mailer with web-identity federation; only if the passwordless decision (Stage 16, Py ADR-0010) is taken; S-M. Option B for each: defer to its phase. Pick: A when the phase starts.

### VS-26 - CI security gates, SBOM, notices
- Exact change: add jobs for secret scan (gitleaks), dependency audit (`npm audit`, OSV-Scanner), image scan (Trivy), Dependabot (npm, docker, github-actions), CycloneDX SBOM, licence check against the Stage 20 rules, `THIRD_PARTY_NOTICES`. Files: `.github/workflows/ci.yml` (+ new workflow), `.github/dependabot.yml`. Port source: `arcnave.in:.github/workflows/ci.yml` lines 556-620 (hash-pinned installs, redacted output), `.github/dependabot.yml`, `.github/actions/trivy-image`.
- Option A (NEW-BUILD): port the pattern, npm instead of pip. Time M. Risk: GitHub Free minutes (2,000/month, FD-23). Breaks nothing.
- Option B: Dependabot + `npm audit` only. Time S.
- Pick: A in two commits (B first).

### VS-29b - google-genai retries explicitly off
- Exact change: build `GoogleGenAI` with `httpOptions.retryOptions` set to a single attempt (Node SDK option name to be confirmed against the installed 2.22 types), keep per-request timeout; add a test asserting the client options. File: `backend/src/providers/gemini.ts:349-353`. Port source: arcnave.in:`backend/packages/gateway` (HttpRetryOptions attempts=1).
- Option A (REWRITE). Time S. Risk low. Option B: leave and assume default is zero. Risk: hidden retries violate the CLAUDE.md forbidden pattern and the Stage 15 matrix.
- Pick: A.

### VS-32 - SaaS boundary
- Exact change: publish the subprocessor list (Stage 21 lawyer track), resolve Cloudflare hosting (stage-19 S19-07), decide whether model-written HTML may load scripts from two public CDNs (user browser contacts Cloudflare / jsDelivr; no server data). Files: `SandboxFrame.tsx:21`, `systemPrompt.ts:239`, docs. 
- Option A (REWRITE): vendor the allowed libraries into the preview origin. Time M. Option B: keep and disclose. Time S. Pick: B now, A with the usercontent domain (S19-09).

### VS-33 - Lint
- Exact change: add `eslint.config.js` (typescript-eslint strict), run `npm run lint` in CI for both packages, fix findings. Files: `backend/`, `arcnave-frontend/`, `ci.yml`. Port source: none (ruff pattern in `arcnave.in:.github/workflows/ci.yml:27-29`).
- Option A (REWRITE). Time S-M. Option B: type check only (current). Pick: A.

## 5. Open questions for the owner
- Q6. VS-16 literal "no ExcelJS": accept ExcelJS as the Node equivalent of openpyxl (stack), or read spreadsheets only in the sandbox/parser?
- Q7. Py ADR-0010 / VS-21 (no passwords, no argon2) vs repo password + Google (ADR-0056). Handled by the Stage 16 audit; repo still hashes passwords with `@node-rs/argon2` (`services/auth.ts:10`).
- Q8. Py ADR-0009/0013/0014 (Haiku 5.5 router and worker jobs; N-69, N-76, N-77) vs build-plan B-4 / ADR-0055. Recorded, not resolved.
- Q2 (Cloudflare) and Q3 (API key vs WIF) as in stage-19.
- Could not check: `@google/genai` 2.22 default retry behaviour; exact resolved dependency versions; pip package versions inside built images.

## 6. KEEP spot-check
4 KEEP rows, 2 re-opened (50 %). CVS6: `backend/src/config.ts:130-131` default ids `claude-sonnet-5-5` / `claude-opus-5-5`, confirmed. CVS7: `backend/package.json:23-51` no Claude Agent SDK, confirmed. VS-23 and CVS1 were checked in the same pass (no push packages in either `package.json`; `anthropic.ts:51` `maxRetries: 0`), confirmed.
