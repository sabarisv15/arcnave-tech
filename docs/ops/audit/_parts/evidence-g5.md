# Evidence pack G5 (Stages 19-21 and numbers sweep) - names and shapes only

Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Read-only; paths relative to `D:\arcnave-tech` unless `arcnave.in:` (port source).
Not readable: `.env.example` (permission denied for the auditor), so no env-template line is cited anywhere. Only declared ranges were read (resolved versions sit in the lock files).

## (a) Dependencies

### backend/package.json (`name: arcnave-backend`, `engines.node >=22`, ESM)
Prod (`dependencies`, lines 23-51):
@anthropic-ai/sdk ^0.126.0 · @fastify/cookie ^11.1.2 · @fastify/cors ^11.3.0 · @fastify/multipart ^10.1.1 · @fastify/rate-limit ^11.2.0 · @fastify/swagger ^9.8.1 · @fastify/swagger-ui ^6.1.1 · @google-cloud/storage ^8.2.0 · @google/genai ^2.22.0 · @node-rs/argon2 ^2.2.1 · @pdf-lib/fontkit ^1.1.1 · docx ^9.7.1 · drizzle-orm ^0.45.2 · exceljs ^4.4.0 · fastify ^5.12.5 · fastify-type-provider-zod ^7.0.0 · fflate ^0.8.3 · google-auth-library ^11.1.0 · image-size ^1.2.1 · officeparser ^8.0.0 · pdf-lib ^1.17.1 · pdf-parse ^2.4.5 · pino ^10.3.1 · postgres ^3.4.9 · pptxgenjs ^4.0.1 · xlsx ^0.18.5 · zod ^4.6.5
Dev (lines 52-63): @types/node ^24.9.1 · drizzle-kit ^0.31.10 · eslint ^9.39.1 · jszip ^3.10.2 · pino-pretty ^13.1.2 · puppeteer-core ^25.11.0 · tsx ^4.23.13 · typescript ^5.9.3 · typescript-eslint ^8.46.2 · vitest ^5.0.1
Notes: `jszip` is dev-only but imported by production code (`backend/src/tools/execution/executionRuntime.ts:18`, `backend/src/services/documents/verify/*.ts`); it still ships because `exceljs` depends on it (not verified in the lock; low risk). No Redis, Cloud Tasks, OTel, Eventarc, Pub/Sub, ClamAV, FFmpeg, pgvector client in the list.

### arcnave-frontend/package.json (`name: arcnave-ai`)
Prod (lines 15-41): @fontsource-variable/{inter,jetbrains-mono,noto-sans-tamil,noto-serif-tamil,onest,source-serif-4} ^5.3 · @fontsource/opendyslexic ^5.3.0 · @radix-ui/react-{dialog ^1.1.6, dropdown-menu ^2.1.6, hover-card ^1.1.6, tooltip ^1.1.8} · docx-preview ^0.4.1 · jszip ^3.10.1 · katex ^0.18.9 · lucide-react ^0.468.0 · mermaid ^12.0.0 · react ^19.1.0 · react-dom ^19.1.0 · react-markdown ^10.1.0 · react-router-dom ^7.6.0 · recharts ^3.10.1 · rehype-highlight ^7.0.2 · rehype-katex ^7.0.1 · remark-gfm ^4.0.1 · remark-math ^6.0.0
Dev (lines 42-53): @types/{jsdom ^30.0.0, react ^19.1.0, react-dom ^19.1.0} · @vitejs/plugin-react ^4.4.1 · jsdom ^30.1.1 · prettier ^3.9.6 · typescript ~5.8.3 · vite ^6.3.5 · vitest ^4.1.11 · wrangler ^4.38.0
Notes: Vite SPA (not Next.js 16, VS-18), no Expo app, no pdf.js / react-pdf / ECharts / Shiki / markdown-it / remend / DOMPurify. `wrangler` = Cloudflare deploy tool (`arcnave-frontend/package.json:9`, `arcnave-frontend/wrangler.jsonc`).

### Sandbox Python packages (no version pins anywhere)
- Job image `backend/sandbox/Dockerfile:9-15`: base `python:3.12-slim`; apt `poppler-utils pandoc libreoffice-nogui`; pip `pandas numpy matplotlib openpyxl`; user `sandbox` (non-root, `:17-19`).
- Warm service image `backend/sandbox/Dockerfile.service:12-31`: base `python:3.12-slim`; apt `poppler-utils pandoc libreoffice-nogui tesseract-ocr(+eng,+tam) fonts-dejavu-core fonts-noto-core`; pip `pandas numpy scipy matplotlib openpyxl xlrd xlsxwriter pdfplumber pypdf pymupdf python-docx python-pptx pillow pytesseract opencv-python-headless tabulate chardet`. Server runs as root on purpose (`:9-10`).
- Backend runtime image apt (`backend/Dockerfile:34-36`): `dumb-init poppler-utils python3`.

### Licence flags
| Item | Where | Licence | Flag |
|---|---|---|---|
| `pymupdf` (PyMuPDF/MuPDF) | `backend/sandbox/Dockerfile.service:28`; used by `backend/skills/pdf-reading/SKILL.md:32-67` | AGPL-3.0 (or commercial) - from general knowledge, not re-read | VIOLATES Stage 20 licence rule "AGPL excluded from runtime" (VS-12 names pypdfium2 / pypdf). |
| `xlsx` (SheetJS CE 0.18.x) and `exceljs` | `backend/package.json:37,49`; used `backend/src/services/retrieval.ts:13-14`, `services/documents/sheetPreview.ts:6`, `xlsxRenderer.ts:8`, `verify/xlsxVerify.ts:7` | Apache-2.0 / MIT (npm metadata, not re-read) | VS-16 says "no SheetJS/ExcelJS" (npm `xlsx` stale). Not a licence issue, a locked-vendor issue. |
| `jszip` | backend lock line 6072; frontend lock line 5249 | `(MIT OR GPL-3.0-or-later)` | Dual; choose MIT. Record in a notices register (none exists). |
| `@img/sharp-libvips-*`, `@img/sharp-*` | arcnave-frontend/package-lock.json lines 1396-1835 | LGPL-3.0-or-later (dev, transitive) | Build-time only; confirm it never ships. |
| pandoc, poppler-utils, tesseract, LibreOffice | sandbox Dockerfiles; poppler also `backend/Dockerfile:35` | GPL-2 / GPL / Apache / MPL via process boundary | Allowed by Stage 20 rule (process boundary) only with a `THIRD_PARTY_NOTICES` register - none exists in the repo. |
Search done: lock-file `license` fields for GPL, SSPL, BUSL, ELv2, Elastic, CC-BY-NC, UNLICENSED, FSL in both lock files - hits above only; no AGPL/SSPL/BUSL package in either lock.

## (b) Dockerfiles, Cloud Build, CI
| File | Facts |
|---|---|
| `backend/Dockerfile` | 3 stages (`deps`, `build`, `runtime`) on `node:22-bookworm-slim` (no digest, `:12,18,28`); `npm ci --omit=dev --ignore-scripts`; runtime adds `dumb-init`; `USER node` (`:56`); `EXPOSE 8080`; HEALTHCHECK on `/healthz` (`:63-64`); `ENTRYPOINT dumb-init`; `CMD sh -c "node dist/db/migrate.js \|\| true; exec node dist/index.js"` (`:69`) - migration failure is swallowed, runs inside the serving container. Copies `drizzle`, `skills`. |
| `arcnave-frontend/Dockerfile` | `node:22-bookworm-slim` build (`npm ci`, `npm run build` = tsc -b + vite build + prerender) then `nginx:1.27-alpine` (`:19`); port 8080 (`:26`); no `USER` directive (comment at `:24-25` claims an unprivileged user); `nginx.conf` proxies `/v1` to `backend:8080` with `proxy_buffering off` (`nginx.conf:36,46`) and `/healthz`,`/readyz` (`:56-57`); headers nosniff, X-Frame DENY, Referrer-Policy (`:19-21`). |
| `backend/sandbox/Dockerfile` | Job image, see (a). `ENTRYPOINT python3 runner.py`. |
| `backend/sandbox/Dockerfile.service` | Warm service, see (a). `EXPOSE 8080`, `WORK_ROOT=/work`. |
| `backend/sandbox/cloudbuild.service.yaml` | One step: docker build `sandbox/Dockerfile.service`; image `asia-south1-docker.pkg.dev/${PROJECT_ID}/cloud-run-source-deploy/arcnave-python-runner:latest` (`:10`) - `:latest` tag. The deploy trigger for `main` is "outside" the repo (`.github/workflows/ci.yml:2-3`); no trigger file found (searched `**/cloudbuild*`). |
| `compose.yaml` | Local stack: `postgres:16-alpine`, backend, frontend (nginx) on one origin. |
| `.github/workflows/ci.yml` (only workflow) | Triggers: `pull_request`, push on non-main branches; concurrency per ref. Job `backend` (ubuntu-latest, `postgres:16-alpine` service, Node 22, apt `poppler-utils python3`, `npm ci`, `npx tsc --noEmit`, `npx vitest run`); job `frontend` (Node 22, `npm ci`, `npx tsc -b`, `npx vite build`, `npx vitest run`; prerender skipped). No lint, no security scan (gitleaks/OSV/Trivy/npm audit), no SBOM/licence check, no Dependabot (`.github/` holds ci.yml only), no image build, no coverage gate. `backend/package.json:14` defines `lint` (eslint) but CI does not run it. |

## (c) ADR index

### Repo ADRs `docs/decisions` (files present: 0001-0016, 0018-0057, 0061; absent: 0017, 0058, 0059, 0060)
| No | Title | Status |
|---|---|---|
| 0001 | Python / FastAPI / PostgreSQL stack | superseded by 0003 |
| 0002 | UI model aliases resolve through a configured registry | accepted (gpt-oss part removed by 0055) |
| 0003 | Node 22 / TypeScript / Fastify / Drizzle | accepted |
| 0004 | File-handling parity with Claude.ai / ChatGPT | accepted (intake now 0011) |
| 0005 | Self-hosted Cloud Run sandbox for run_python | accepted; egress superseded by 0007, engine by 0010 |
| 0006 | TurnRouter is a policy boundary only | accepted (amended by 0022) |
| 0007 | Sandbox has no general outbound internet | accepted, implemented 2026-09-25 |
| 0008 | Trusted work runs in the backend process | accepted; sandbox part superseded by 0010 |
| 0009 | A run outlives the connection that started it | accepted |
| 0010 | run_python on a warm sandbox service, workspace per chat | accepted (capacity amended by 0014) |
| 0011 | Upload step 1 follows Claude's published rules | accepted |
| 0012 | Deleted chats leave the back end within 30 days | accepted |
| 0013 | PDFs sent as page images and text | accepted |
| 0014 | Sandbox resources per chat | accepted; decision 1 did not work live |
| 0015 | Sandbox files outlive the instance | accepted, not deployed |
| 0016 | Gemini reads PDF page images from Cloud Storage | accepted, not live |
| 0018 | Skills follow Claude's Agent Skills rules | accepted |
| 0019 | Long chats keep the whole conversation, compact as Claude does | accepted; trigger superseded by 0027 |
| 0020 | Project files in the prompt whole while they fit | accepted (amended by 0029) |
| 0021 | Turn usage = sum of provider requests | accepted |
| 0022 | Model sees what earlier turns did | accepted; decision 2 superseded |
| 0023 | Tool results stay in history | accepted |
| 0024 | Provider timeouts follow Claude's SDK, no first-token cutoff | accepted |
| 0025 | Memory by topic | accepted |
| 0026 | Every tool call of a response runs (parallel) | accepted |
| 0027 | Compaction runs as the window fills | accepted |
| 0028 | A turn never waits on a model probe | accepted |
| 0029 | Past the whole-file limit, project knowledge is searched | accepted |
| 0030 | Thought summary shown, Gemini thinking billed as output | accepted |
| 0031 | Model capability set up at ArcNave level | accepted |
| 0032 | One loop; the model reads the request | accepted |
| 0033 | Styles (presets and custom) | proposed |
| 0034 | Clickable options via turn-ending tool | proposed |
| 0035 | Model-written HTML runs only in a script-only sandbox | accepted |
| 0036 | Sandboxed visuals inherit theme | accepted |
| 0037 | A visual is drawn while the model writes it | accepted |
| 0038 | Editing a prompt makes another version | accepted |
| 0039 | Public share links | accepted |
| 0040 | Memory import/export, data export, account deletion | accepted |
| 0041 | Slides artifacts | accepted |
| 0042 | Voice dictation with the browser's speech recognition | accepted (phase 1) |
| 0043 | Contextual follow-ups and safe answer rendering | accepted |
| 0044 | PDF reading is its own skill, exact figures computed | accepted |
| 0045 | Office files read with code when a sandbox exists | accepted |
| 0046 | Tools and skills cut to the reference | accepted |
| 0047 | Tools and skills match the reference | accepted |
| 0048 | Artifacts, questions, visuals, cards as the reference | accepted |
| 0049 | Prompt and skills line by line with the reference | accepted |
| 0050 | A turn log under every reply | accepted |
| 0051 | Public startup positioning for college teams | accepted |
| 0052 | Reference rules from the audit and turn logs | accepted |
| 0053 | Prototype base; 21-stage architecture is the target spec | accepted; Decision 2 second sentence superseded in part by 0061 |
| 0054 | Claude through the first-party Claude API | accepted (API key, not WIF: its decision 6) |
| 0055 | Three models | accepted |
| 0056 | Google sign-in beside e-mail and password | accepted (number reused: ADR-0053 had reserved 0056 for "typed errors kept") |
| 0057 | Surfaces and chart colours from the brand sheet | accepted (number reused: reserved for "repo prompt kept") |
| 0061 | Locked decisions win outside tech stack and infra | accepted (owner rule 2026-10-15) |
Not written although ADR-0053 listed them: 0058 compaction kept, 0059 retrieval, 0060 frontend hosting.

### Python ADRs `arcnave.in:docs/architecture/adr` 0001-0014 - ported?
| No | Title | Ported to repo? |
|---|---|---|
| 0001 | Dev telemetry uses the global Telemetry API endpoint | No (OTel deferred) |
| 0002 | Dev Claude via external GCP project | No - retired by Py 0012 |
| 0003 | Cost plan does not rely on implicit Gemini cache | No (cost decision; repo parses `cachedContentTokenCount` only, `backend/src/providers/gemini.ts:243,263`) |
| 0004 | Gemini explicit context cache | No - no `cachedContents` create in `gemini.ts`; only scripts reference it |
| 0005 | BM25 own-partition query, RLS per partition | No (tenancy deferred; repo FTS is a GIN index, `backend/drizzle/0007_smart_maximus.sql:43`) |
| 0006 | Mumbai OCR pinned Document AI RC + Gemini fallback | No (Document AI Phase 5; repo uses Gemini OCR) |
| 0007 | Reranker = Vertex Ranking API | No (Phase 2) |
| 0008 | Dev Claude direct API with WIF | No - widened by Py 0012 |
| 0009 | Mini-LLM turn router | No - conflicts build-plan B-4 / repo ADR-0055, owner question |
| 0010 | Passwordless invite-only auth, SES mailer | No - repo is password + Google (ADR-0056); owner question (Stage 16 audit) |
| 0011 | Redis deferred, stream buffer on Postgres | Partly in spirit (ADR-0053 #7), no `StreamStore` interface (in-process `runHub.ts`) |
| 0012 | Claude through the first-party API | Yes as repo ADR-0054 (deviation: API key instead of WIF) |
| 0013 | Router = Haiku 5.5 thinking disabled | No - same conflict as 0009 |
| 0014 | Worker jobs on Haiku 5.5 | No - same conflict (B-4 three models only) |
