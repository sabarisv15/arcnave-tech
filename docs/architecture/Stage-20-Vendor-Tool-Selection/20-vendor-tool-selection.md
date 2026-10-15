# ArcNave – Stage 20 · Vendor and tool selection – DRAFT (needs user OK)
_2026-10-03 · Source: Astra results 20-astra-results.md (official docs/registries, 3 Oct 2026, 53 IDs) + 20-astra-package-register.md (per-package licence/version/maintenance ledger) + all locked stages · Labels: ✅ Vendor/official · ⚠️ Partial · 🔧 ArcNave decision · Licences as SPDX ids._

## 0. Scope and outcome
Final, licence-checked and maintenance-checked bill of materials for every library, service and vendor; decision for every item left open in Stages 1–19. Rule: permissive licences (MIT/Apache/BSD/PSF/MPL) in the runtime; AGPL/SSPL excluded from anything customer-serving; copyleft native binaries only via subprocess/daemon with notices kept; every SaaS that touches customer content must document India storage – otherwise it only touches code, ids or ops data.

**Corrections to earlier assumptions:** Uvicorn now has experimental HTTP/2 (irrelevant – HTTP/1.1 upstream stays) · remend is Apache-2.0 (not MIT) · @wuba/react-native-echarts npm says MIT, repo says Apache-2.0 → verify shipped package (LW-20 stays) · bge-reranker-v2-m3 **model** is Apache-2.0 (FlagEmbedding code MIT) · Bleach unmaintained since 5 Jun 2026 → nh3 · Sentry licence is FSL-1.1-ALv2 (not BUSL) · Semgrep rules carry a non-SPDX internal-use licence · google-cloud-aiplatform generative namespaces removed after 24 Jun 2026 → google-genai only · Claude on Vertex: Files API / URL sources unsupported, citations + `output_config.format` cannot be combined in one request · pg_textsearch is the Timescale/Tiger Data PostgreSQL-licensed extension and documents an **RLS side channel via shared corpus statistics** (design item VS-7).

## 1. Market evidence
| | Claude | ChatGPT | Gemini | Perplexity |
|---|---|---|---|---|
| A1 Subprocessors | Trust Center (list not extractable) | Microsoft (incl. India), AWS US, Google, Cloudflare, Intercom US, TaskUs PH, WorkOS, CoreWeave, Oracle, Cerebras, Snowflake, Okta… | Workspace/Cloud registers | Trust Center |
| A2 Open source / sandbox | Python SDK MIT; code execution = per-session gVisor containers (engineering blog) | SDKs; Code Interpreter sandboxed | google-genai Apache; old SDK deprecated | perplexity-py |
| A3 Status/support vendors | Atlassian Statuspage | Intercom (support) | – | Intercom (older FAQ) |
| A4 Mobile framework | not disclosed | Kotlin/Jetpack Compose (hiring page) | not disclosed | not disclosed |
| A5 Integrations | Google Workspace, Slack, M365/SharePoint, GitHub, custom MCP | Drive, SharePoint, Teams, Outlook, Slack, GitHub, GitLab, Box, Notion | Workspace apps | Drive, OneDrive, SharePoint, Dropbox, Box |
**Pattern:** vendors run US-centric SaaS stacks (Intercom, Statuspage, Cloudflare) and disclose them via subprocessor lists; ArcNave must publish the same kind of list (LW-26/LW-31) and keep customer content out of US-hosted auxiliaries. Integrations roadmap (Later): Google Drive + SharePoint first (both appear everywhere).

## 2. Bill of materials (decisions VS-1…VS-32)
### 2.1 Runtime and web stack
| # | Decision | Licence / version (3 Oct 2026) | Notes |
|---|---|---|---|
| VS-1 | **Python 3.13.16** (GIL build) on digest-pinned `python:3.13-slim-trixie` (Debian 13); separate images for parser (LibreOffice) and browser (Playwright) | PSF-2.0; 3.13 EOL Oct 2029 | no free-threading; 3.14 later after native deps validated |
| VS-2 | **Uvicorn**, one worker per container, HTTP/1.1 upstream; **sse-starlette** for SSE | uvicorn 0.54.0 BSD-3; sse-starlette 3.5.0 BSD-3; fastapi 0.142.2 MIT; starlette 1.7.0 BSD-3; pydantic 2.13.5 MIT; httpx 0.28.1 BSD-3; anyio 4.15.1 MIT; python-multipart 0.0.32 Apache | no gunicorn; Cloud Run scales instances |
| VS-3 | **uv** with committed `uv.lock`, `uv sync --locked`, hashes; OS packages/model/font assets pinned too | uv 0.12.22 MIT OR Apache | pip-tools/Poetry not used |
| VS-4 | Rate limiting: **`limits`** async Redis sliding-window counter for request counts + own atomic Redis token-budget accounting; Cloud Armor edge | limits 5.8.0 MIT | slowapi not needed |
| VS-5 | Jobs: **plain Cloud Tasks HTTP handlers** + Cloud Run Jobs; feature flags = Postgres table | – | arq/taskiq/celery not added; FastAPI BackgroundTasks not durable |
| VS-6 | Tests: pytest + pytest-asyncio, Hypothesis (MPL-2.0), RESPX, Testcontainers (Postgres/Redis), **pgTAP** (Cloud SQL 1.3.0) via pg_prove; Locust + pytest failure injection (no hosted chaos) | permissive | run DB tests against Cloud SQL version too |
### 2.2 Data and search
| # | Decision | Licence / version | Notes |
|---|---|---|---|
| VS-7 | SQLAlchemy 2 + asyncpg + Alembic; psycopg3 (LGPL) **not added**; pgvector 0.8.5 on Cloud SQL (upstream 0.8.7); **pg_textsearch** (Timescale, PostgreSQL licence) with **RLS side-channel mitigation: BM25 index per company via list-partitioned chunk tables (partition key company_id) – shared-corpus statistics never cross tenants**; verify installed version + Tamil/Hindi tokenisation (LANG-1) | PostgreSQL licence | design blocker resolved by partitioning; LV test |
| VS-8 | Indic text: `unicodedata.normalize("NFC")` + Postgres `normalize()`; **pg_trgm** for fuzzy; **no transliteration runtime MVP**; IndicXlit (MIT) self-hosted = optional Stage 21 eval if Tanglish evals demand | – | no drop-in Tanglish solution exists |
| VS-9 | Reranker: **ONNX Runtime CPU int8** of bge-reranker-v2-m3 (model Apache-2.0); export via optimum; PyTorch only in build/eval | onnxruntime MIT | pin model revision + tokenizer + graph |
| VS-10 | Token counting: **provider APIs** – Claude `count_tokens` on Vertex (free, global OK); Gemini `countTokens` (free, **3,000 RPM cap**); tiktoken not used | – | cache counts per prompt version |
| VS-11 | **redis-py**; Memorystore Redis 7.2, **no modules** (no RedisJSON) – streams/hashes only | redis-py MIT | Valkey GLIDE only if service changes |
### 2.3 File processing
| # | Decision | Licence / version | Notes |
|---|---|---|---|
| VS-12 | Docling (MIT; model assets own licence register), pypdfium2 (Apache/BSD + PDFium notices), pypdf (BSD), python-docx/openpyxl/python-pptx (MIT), Pillow (MIT-CMU), python-magic (MIT) + libmagic, **ClamAV 1.5.4 GPL-2.0 via clamd socket only**, **zipfile only** (no py7zr/7-Zip), **FFmpeg LGPL build (no `--enable-gpl/--enable-nonfree`) as subprocess, no pydub** | mixed; notices register | native binary licences recorded per build |
| VS-13 | **LibreOffice own parser image** on **26.8 branch** once a verified Linux release exists (26.2.6 bridge only until 30 Nov 2026); locked profile, macros off, no trusted locations; Noto fonts OFL-1.1 | MPL-2.0 + components | no official TDF Docker image |
| VS-14 | **Playwright/Chromium** (official `mcr.microsoft.com/playwright/python:v1.63.0-noble`) for HTML→PDF/PNG + rendering tests, non-root + seccomp, runs only in the isolated job/service; LibreOffice for office conversions; WeasyPrint not used | Apache-2.0 + Chromium BSD | not a sandbox by itself |
| VS-15 | Sanitiser: **DOMPurify** (Apache-2.0 option) web/WebView + **nh3** (MIT) server; Bleach rejected (unmaintained) | – | executable artifacts still go through usercontent sandbox (RD-6) |
| VS-16 | Spreadsheet preview: bounded server rows via openpyxl/csv (RD-5); **no SheetJS/ExcelJS** | – | npm `xlsx` stale |
| VS-17 | Dictation engine **bake-off in Stage 21**: Gemini 3.8 Flash audio (provisional, cheap, GLOBAL) vs **Speech-to-Text v2 Chirp 3 in asia-south1** (Hindi GA, **Tamil + Mumbai = Preview**, streaming ≤5 min, $0.016/min ≈ ₹2.8 per 2-min clip, processed in India); pick by Tanglish/Tamil accuracy, residency plus for Chirp | – | Stage 9 SPD-5 unchanged until test |
### 2.4 Front end
| # | Decision | Licence / version | Notes |
|---|---|---|---|
| VS-18 | **Next.js 16.x standalone on Cloud Run Mumbai, Node 24 LTS**; no Vercel | MIT | confirms ID-8/CD-13 |
| VS-19 | **Expo SDK 57 / React Native 0.86 / React 19.2.3** (New Architecture, Hermes); **EAS Build hosted OK (code only)**; **OTA updates: none in MVP** (store releases); Later self-hosted `expo-updates` endpoint on GCS Mumbai with code signing (hosted EAS Update signing needs Production plan; residency not documented) | MIT | Stage 18 EAS Free → Starter stands |
| VS-20 | UI libs confirmed: markdown-it (MIT), **remend (Apache-2.0)**, KaTeX (MIT), **Shiki** (MIT) for code highlight (Prism stale), @wuba/react-native-echarts (**verify licence in shipped package: npm MIT vs repo Apache**) + ECharts (Apache), react-pdf (MIT) + pdf.js (Apache), react-native-pdf (MIT; native AndroidPdfViewer Apache + PdfiumAndroidKt Apache/BSD + PDFium notices), FlashList v2, react-virtuoso, react-native-webview (MIT), Noto (OFL) | – | LW-20 updated |
| VS-21 | Auth clients: **Google Identity Services** (web) + **Android Credential Manager**; no legacy Google Sign-In; TOTP QR via `qrcode` (MIT); server **PyJWT + cryptography**, argon2-cffi, pyotp; passkeys Later py_webauthn (BSD) | MIT / Apache | python-jose not used |
### 2.5 Email, notifications, support
| # | Decision | Licence / vendor | Notes |
|---|---|---|---|
| VS-22 | Transactional email: **Amazon SES ap-south-1 (Mumbai)** primary ($0.10/1k + $0.12/GB), **Zoho ZeptoMail India DC** second; SendGrid/Mailgun/Postmark/Resend/Brevo excluded (US/EU only) | contract-dependent | LW-37 DPA; mails carry only email address + codes |
| VS-23 | Push: in-app only MVP (RD-8); FCM/Expo push **not approved** for content payloads (global storage); Later: content-free "you have an update" after data classification | – | |
| VS-24 | Support/grievance: **Zoho Desk India DC** (`desk.zoho.in`, free 3 users) with AI/external integrations off; Freshdesk IND alternative (some AI features route to US) | – | grievance officer mailbox (SD-14) |
| VS-25 | Status/on-call: Stage 17 OD-10/OD-11 unchanged (PagerDuty free US, free status page) – ids/public text only | – | |
### 2.6 Security tooling, IaC, observability, AI SDKs
| # | Decision | Licence / version | Notes |
|---|---|---|---|
| VS-26 | CI security: **gitleaks** (MIT), **Bandit** (Apache), **pip-audit** (Apache), **OSV-Scanner** (Apache), **Trivy** (Apache) for images/IaC, **Dependabot**, npm audit; Semgrep CE optional (LGPL engine; **rules licence internal-use only** – pin/review); **no TruffleHog / Renovate (AGPL)**; CodeQL only with GitHub Code Security licence; Artifact Analysis at registry (ID-12) | permissive | content-free CI inputs |
| VS-27 | IaC: **Terraform (BUSL-1.1, own-infra use OK)** + hashicorp/google (MPL-2.0) + **tflint** (MPL) + **checkov** (Apache); no tfsec; OpenTofu not needed | – | |
| VS-28 | Observability: opentelemetry-api/sdk 1.45.0 + contrib 0.66b0 (beta – pin), **collector-contrib v0.162.0 by digest**, **OTLP exporters to Telemetry API** (Google exporters deprecated); Locust, py-spy (MIT) | Apache-2.0 | OD-1 confirmed |
| VS-29 | AI SDKs: **anthropic[vertex] 1.11.0 (MIT) – `AsyncAnthropicVertex`, `max_retries=0`, explicit timeouts**; **google-genai (Apache) in Vertex mode**; google-cloud-storage/tasks/secret-manager/documentai/google-auth 2.59.1 (Apache); **google-cloud-aiplatform generative namespaces not used** (removed Jun 2026); cloud-sql-python-connector 1.22.0 (Apache) | – | ID-4 connector confirmed |
| VS-30 | Structured output: Pydantic + provider-native – Gemini `response_schema`; Claude `output_config.format` + `strict: true` tools; **citations and `output_config.format` never in the same Claude request** | – | Instructor/Outlines not used |
| VS-31 | Evals: **own pytest harness** with Vertex clients, fixtures/results in India; promptfoo (MIT) optional locally with `PROMPTFOO_DISABLE_TELEMETRY=1`; DeepEval/Inspect not adopted; guardrail libs (NeMo/Guardrails AI/LLM Guard) and agent frameworks (LangChain/LangGraph/ADK/OpenAI Agents/Claude Agent SDK) **recorded, not used** | – | SBOM via cyclonedx-bom (Apache) |
| VS-32 | SaaS boundary: GitHub (code + synthetic fixtures only; no India residency), Google Workspace/Cloud Identity for ops identity + company email only (no customer content; no India region), Google Cloud for all customer data; subprocessor list published | – | LW-26/LW-31 |

## 3. Licence rules (record)
- **AGPL-3.0** (Grafana, k6, TruffleHog, Renovate, Redis 8 option): excluded from anything customer-serving or modified; internal CI use also avoided (§13 network clause covers internal remote users).
- **ELv2** (Phoenix) / **BUSL-1.1** (Terraform – own infra OK) / **FSL-1.1** (Sentry – self-host Later allowed as non-competing use) / **SSPL/RSAL** (Redis 7.4+ – managed Memorystore contract governs; local dev uses Valkey BSD or Redis 7.2).
- **Copyleft natives via process boundary**: LibreOffice (MPL-2.0) subprocess, ClamAV (GPL-2.0) clamd socket, FFmpeg LGPL build; keep binary build configs + notices in a `THIRD_PARTY_NOTICES` register; no linking.
- **Model/data**: bge-reranker-v2-m3 Apache-2.0; IndicGuard dataset CC-BY-4.0 (attribution) + adapter Apache-2.0 on Gemma base (check Gemma terms); Noto OFL-1.1; Docling model assets registered individually.
- **Provider terms**: Anthropic – customer owns outputs, no training on customer content; Google – no training without permission, no ownership claim on outputs; **no-training ≠ no-retention** (Stage 16 SE16 disclosures stand).

## 4. Claude-only (CVS)
| # | Fact | Rule |
|---|---|---|
| CVS1 | `AsyncAnthropicVertex`; defaults 2 retries / 10-min timeout → set `max_retries=0`, explicit deadlines (ER-1) | VS-29 |
| CVS2 | `count_tokens` free on Vertex incl. global for Sonnet/Opus 5.5 | VS-10 |
| CVS3 | **Files API + URL sources unsupported on Vertex** → inline base64 within 30 MB; PDF ≤600 pages (1M ctx) | Stage 9 adapter |
| CVS4 | `output_config.format` JSON + strict tool schemas + citations + PDF input supported; citations ∧ format in one request → 400 | VS-30; Stage 13 citation turns separate from JSON turns |
| CVS5 | Beta features via `anthropic-beta` header per documented Vertex availability; Bedrock body field differs | LV-07 |
| CVS6 | Model retirement: direct API ≥60 days notice; **Vertex lifecycle dates may differ** → pin exact ids, monitor Google notices, keep evaluated fallback | Stage 7 D-3 |
| CVS7 | Claude Agent SDK (TS) under Anthropic Commercial Terms; Python wrapper MIT – neither used | VS-31 |
| CVS8 | Schema cache up to 24 h (direct docs); Vertex location not documented → no customer content in schema text | VS-30 |

## 5. LV-1 / Stage 21
1. pg_textsearch per-company partitioned BM25 index: side-channel test (tenant A terms must not change tenant B ranking) + installed version/flags.
2. Dictation bake-off: Gemini 3.8 Flash vs Chirp 3 Mumbai on Tanglish/Tamil/Hindi 2-min clips (accuracy, latency, cost).
3. ONNX int8 reranker export → Tamil/Hindi/Tanglish ranking vs PyTorch baseline (extends LV-56).
4. Playwright image on Cloud Run Job: RAM, cold start, non-root + seccomp, artifact→PDF fidelity.
5. LibreOffice 26.8 Linux build availability + Indic font/chart fidelity (LV-42) on the pinned version.
6. uv lock reproducibility: two builds → identical digests; SBOM (cyclonedx + `gcloud artifacts sbom`).
7. Gemini `countTokens` 3,000 RPM + Claude `count_tokens` latency; caching counts per prompt version.
8. @wuba/react-native-echarts shipped package licence file check (LW-20).
9. SES ap-south-1 + Zoho ZeptoMail India deliverability/DKIM/DMARC test; Zoho Desk India tenant.

## 6. Lawyer list additions
LW-41 THIRD_PARTY_NOTICES register + copyleft process-boundary memo (LibreOffice/ClamAV/FFmpeg) · LW-42 IndicGuard CC-BY attribution + Gemma base terms for the adapter · LW-43 Semgrep Rules License (internal use) if adopted · LW-44 Zoho Desk / SES / ZeptoMail DPAs and subprocessor review · LW-45 Subprocessor list for ArcNave customers (Google Cloud, SES/Zoho, PagerDuty, status page, GitHub for code).

## 7. Doc-sync debt
- Stage 7/Stage 4 L5a: `AsyncAnthropicVertex`, `count_tokens` free, no Files API/URL on Vertex, citations vs JSON exclusivity, model lifecycle rule.
- Stage 9: Chirp 3 Mumbai added to SPD-5 bake-off; FFmpeg LGPL subprocess; zipfile only; Docling asset register; Playwright for HTML render.
- Stage 12: pg_textsearch per-company partitioning (RLS side channel); pg_trgm + NFC.
- Stage 13: citation turns and structured-output turns separated (Claude).
- Stage 14: remend Apache, Shiki, DOMPurify Apache option, OTA none MVP.
- Stage 16: Bleach removed; sanitiser nh3; security tooling list; AGPL exclusions.
- Stage 17: OTLP exporters confirmed; collector digest pin.
- Stage 18/19: SES/Zoho, Zoho Desk, Next.js Cloud Run, uv, Python 3.13 image.
- Registers: LV-116…124, LW-41…45, N-67 (version pins table = package register).

## 8. Sources
20-astra-results.md Parts A–M + J1 SaaS register + L1 package register (PyPI/npm project pages, GitHub LICENSE files, SPDX, python.org, debian.org, docs.astral.sh, uvicorn.dev, fastapi.tiangolo.com, limits.readthedocs.io, pgvector CHANGELOG, Cloud SQL extensions/pg-textsearch, Tiger Data pg_textsearch docs, huggingface model cards, libreoffice.org + TDF blog, playwright.dev, DOMPurify/nh3/bleach docs, SheetJS docs, Speech-to-Text v2 docs/pricing, nextjs.org, vercel.com, docs.expo.dev, expo.dev subprocessors, GIS/Credential Manager docs, SES/Zoho/SendGrid/Mailgun/Postmark/Resend/Brevo pricing + region pages, Zoho Desk/Freshdesk/Help Scout docs, gitleaks/bandit/pip-audit/osv-scanner/trivy/semgrep/CodeQL docs, HashiCorp BUSL + provider LICENSE, tflint/checkov, OpenTelemetry releases, Google OTLP migration docs, anthropic SDK + claude-on-vertex-ai + Google partner-model pages, google-genai, google-cloud-aiplatform deprecations, promptfoo/DeepEval/Inspect telemetry docs, NeMo/Guardrails AI/LLM Guard, LangChain/LangGraph/ADK/OpenAI Agents licences, GitHub residency docs, Workspace data regions, redis.io licences, FFmpeg legal, ClamAV docs, Anthropic Trust/DPA/model-deprecation pages, product trust centres and subprocessor lists (Part A)).
