# ArcNave – Checkpoint · Stage 20 Vendor and tool selection – LOCKED 2026-10-03
_User OK 2026-10-03 (VS-1…VS-32 as recommended). Final word over 20-vendor-tool-selection.md (draft). Evidence: 20-astra-results.md + 20-astra-package-register.md (official registries/docs, 3 Oct 2026). Version numbers are the audit snapshot; the implementation lock (uv.lock, image digests) is a Stage 21 deliverable._

## Docs
| Doc | What |
|---|---|
| 20-astra-prompt.md / 20-astra-results.md / 20-astra-package-register.md | Research prompt, Astra audit (A–M + SaaS register + final selections), per-package licence/version/maintenance ledger |
| 20-vendor-tool-selection.md | BOM decisions VS-1…VS-32, licence rules, Claude-only CVS1–CVS8, LV-1, lawyer, doc-sync |

## Corrections to earlier assumptions
remend = Apache-2.0 · @wuba/react-native-echarts npm MIT vs repo Apache → verify shipped package · bge-reranker-v2-m3 model Apache-2.0 (code MIT) · Bleach unmaintained (Jun 2026) → nh3 · Sentry = FSL-1.1-ALv2 · Semgrep rules = internal-use licence · google-cloud-aiplatform generative namespaces removed → google-genai only · Claude on Vertex: no Files API / URL sources, citations ∧ `output_config.format` exclusive · pg_textsearch shared-index RLS side channel → per-company partitioned BM25 index · Gemini `countTokens` 3,000 RPM cap.

## Locked BOM (one line each)
- **VS-1** Python 3.13 (GIL) on digest-pinned `python:3.13-slim-trixie`; separate parser (LibreOffice) and browser (Playwright) images.
- **VS-2** Uvicorn 1 worker/container, HTTP/1.1 upstream; FastAPI/Starlette/Pydantic v2/httpx/anyio/python-multipart; sse-starlette for SSE.
- **VS-3** uv + committed `uv.lock`, `uv sync --locked`, hashes; OS packages, model and font assets pinned.
- **VS-4** `limits` (async Redis sliding-window counter) for request limits + own atomic Redis token-budget accounting; Cloud Armor at edge; no slowapi.
- **VS-5** Plain Cloud Tasks HTTP handlers + Cloud Run Jobs; Postgres feature-flag table; no arq/taskiq/celery.
- **VS-6** pytest + pytest-asyncio + Hypothesis + RESPX + Testcontainers; pgTAP via pg_prove (Cloud SQL 1.3.0); Locust + pytest failure injection.
- **VS-7** SQLAlchemy 2 + asyncpg + Alembic (no psycopg3); pgvector 0.8.5 (Cloud SQL); **pg_textsearch with per-company list-partitioned chunk tables (BM25 + HNSW index per partition) to close the shared-corpus-statistics side channel**; installed versions + Indic tokenisation verified in LV.
- **VS-8** NFC normalisation + pg_trgm; no transliteration runtime in MVP; IndicXlit self-hosted = optional Stage 21 eval.
- **VS-9** ONNX Runtime CPU int8 for bge-reranker-v2-m3 (Apache-2.0 model); optimum export; pin revision/tokenizer/graph.
- **VS-10** Token counting via provider APIs (Claude `count_tokens` free on Vertex incl. global; Gemini `countTokens` free, 3,000 RPM); counts cached per prompt version.
- **VS-11** redis-py; Memorystore Redis 7.2 without modules (streams/hashes only).
- **VS-12** Docling (MIT + model-asset register), pypdfium2, pypdf, python-docx/openpyxl/python-pptx, Pillow, python-magic+libmagic, ClamAV 1.5.4 GPL via clamd socket, `zipfile` only, FFmpeg LGPL build via subprocess (no pydub).
- **VS-13** Own LibreOffice parser image on the 26.8 branch once a verified Linux release exists (26.2.6 bridge until 30 Nov 2026); locked profile, macros off; Noto OFL-1.1.
- **VS-14** Playwright/Chromium official image for HTML→PDF/PNG and render tests, non-root + seccomp, isolated job/service only; LibreOffice for office conversions.
- **VS-15** DOMPurify (Apache-2.0 option) + nh3; Bleach rejected.
- **VS-16** Spreadsheet preview = bounded server rows (openpyxl/csv); no SheetJS/ExcelJS.
- **VS-17** Dictation bake-off in Stage 21: Gemini 3.8 Flash audio (provisional) vs Speech-to-Text v2 Chirp 3 asia-south1 (Hindi GA; Tamil + Mumbai Preview; $0.016/min; India processing).
- **VS-18** Next.js 16 standalone on Cloud Run Mumbai, Node 24 LTS; no Vercel.
- **VS-19** Expo SDK 57 / RN 0.86 / React 19.2.3 (New Architecture, Hermes); EAS Build hosted (code only); **no OTA in MVP** (store releases); Later self-hosted signed `expo-updates` endpoint on GCS Mumbai.
- **VS-20** UI libs confirmed (markdown-it, remend Apache, KaTeX, Shiki, @wuba echarts + ECharts, react-pdf + pdf.js, react-native-pdf, FlashList v2, react-virtuoso, react-native-webview, Noto).
- **VS-21** Google Identity Services (web) + Android Credential Manager; `qrcode` for TOTP enrolment; PyJWT + cryptography, argon2-cffi, pyotp; passkeys Later (py_webauthn).
- **VS-22** Email: Amazon SES ap-south-1 primary, Zoho ZeptoMail India DC second; US/EU-only providers excluded; mails carry email + codes only.
- **VS-23** Push: in-app only MVP; FCM/Expo push not approved for content payloads.
- **VS-24** Support: Zoho Desk India DC (free 3 users), AI/external integrations off; Freshdesk IND alternative.
- **VS-25** Status/on-call unchanged (Stage 17 OD-10/OD-11).
- **VS-26** CI security: gitleaks, Bandit, pip-audit, OSV-Scanner, Trivy, Dependabot, npm audit; Semgrep CE optional with rules-licence review; no TruffleHog/Renovate (AGPL); CodeQL only with licence.
- **VS-27** Terraform (BUSL-1.1, own-infra use) + hashicorp/google (MPL) + tflint + checkov.
- **VS-28** OpenTelemetry api/sdk 1.45 + contrib 0.66b0 (pinned), collector-contrib v0.162.0 by digest, OTLP exporters to Telemetry API; Locust, py-spy.
- **VS-29** anthropic[vertex] 1.11 (`AsyncAnthropicVertex`, `max_retries=0`, explicit timeouts); google-genai (Vertex mode); google-cloud-* clients + google-auth; cloud-sql-python-connector; no google-cloud-aiplatform generative namespaces.
- **VS-30** Structured output = Pydantic + provider-native (Gemini `response_schema`; Claude `output_config.format` + strict tools); Claude citations and JSON format never in one request.
- **VS-31** Own pytest eval harness (fixtures/results in India); promptfoo optional with telemetry off; guardrail libs and agent frameworks recorded, not used; SBOM via cyclonedx-bom + `gcloud artifacts sbom`.
- **VS-32** SaaS boundary: GitHub = code + synthetic fixtures only; Google Workspace/Cloud Identity = ops identity + company mail only; all customer data in Google Cloud India; ArcNave publishes its own subprocessor list.

## Licence rules (locked)
AGPL/SSPL excluded from runtime and CI; ELv2/BUSL/FSL per §3 of the draft; copyleft natives only via process boundary with `THIRD_PARTY_NOTICES`; model/data licences registered (bge Apache, IndicGuard CC-BY + Apache adapter on Gemma base, Noto OFL, Docling assets); no-training ≠ no-retention disclosures stand.

## Registers
LV-116…124 · LW-41…45 · N-67 (version pins = package register) · doc-sync Stage 20 section.

## Next
Cross-stage review 13–20 (00-Handoff/00-review-stages-13-20.md) → Stage 21 Implementation plan.

## Doc-sync 2026-10-03 (Stage 21 Task 0.1)
- **VS-33 (added)** Python dev tooling: `ruff` (MIT, lint + import sort, lock 0.16.10) and `mypy` (MIT, strict, lock 2.4.0) – dev dependency group only, never runtime. Lower bounds in `backend/pyproject.toml`; exact versions from `uv.lock`. Register rows added to 20-astra-package-register.md (licence from PyPI metadata; versions as locked by uv, not Astra-verified).

## Doc-sync 2026-10-04 (Stage 21 Task 0.4 brief)
- **VS-3 detail:** `backend/` is a uv workspace (virtual root, explicit member list, one `uv.lock`); members are `src/`-layout packages built with uv's own `uv_build`; images install with `uv sync --locked --no-dev --no-editable --package <app>`; CI uses `uv sync --locked --all-packages`.
- **VS-1 / VS-2 detail:** service images run as non-root uid 10001, Uvicorn one worker with `--no-access-log` (Stage 17 OD-2); the health path is `/health` (Cloud Run reserves some paths ending in `z`); FastAPI docs/OpenAPI URLs are disabled in the running service (API reference is generated offline).
- **Task 0.4 review 2026-10-04 – open items:** (a) Starlette's test client now warns that `httpx` is deprecated in favour of `httpx2` (not in the BOM) → decide before the warning becomes an error; (b) the lock file was produced with local uv 0.11.28 while the image uses 0.12.22 – pin uv 0.12.22 locally and in CI at the next backend task; (c) `fastapi` 0.142.2 brings `opentelemetry-api` 1.45.0 transitively (same version as VS-28); (d) when `packages/*` join the workspace, extend the Dockerfile copy list and ruff `known-first-party`. Image digests of `python:3.13-slim-trixie` and `ghcr.io/astral-sh/uv:0.12.22` recorded in the package register.

## Doc-sync 2026-10-04 (Stage 21 Task 0.7 review)
- **VS-3 uv workspace + images:** `uv sync --locked` needs the `pyproject.toml` of **every** workspace member in the build context; each image copies all member manifests but only the sources of the packages it installs. Adding a workspace member means touching every Dockerfile and `backend/.dockerignore`.
- **VS-29 constructors as written in Task 0.7 Part 1 (first live run = LV-108 in Part 2):** `AsyncAnthropicVertex(project_id, region, max_retries=0, timeout=<seconds>)`; google-genai `Client(vertexai=True, project, location, http_options=HttpOptions(timeout=<milliseconds>, retry_options=HttpRetryOptions(attempts=1)))` (Stage 15 ER-1 doc-sync). Gemini model id `gemini-3.8-flash` (GA, global – Google's model page as reported by Claude Code); default thinking counts against `max_output_tokens`. Gemini web grounding = `Tool(enterprise_web_search=EnterpriseWebSearch())`; Claude on Vertex = basic `web_search_20250305` only.
- **Rule exception:** `backend/apps/lvrunner` (dev LV-1 test tool, synthetic prompts) calls the SDKs directly; all product code still goes through `packages/gateway`.
- **Package register:** 16 transitive packages of `anthropic[vertex]` / `google-genai` added as "Added Stage 21 Task 0.7 (owner, not Astra-verified)".

## Doc-sync 2026-10-05 (Stage 21 Task 0.11 review – pg_textsearch verified live, LV-54 / LV-116 PASS, ADR-0005)
- **VS-7 refined by ADR-0005 (owner, 2026-10-05):** per-company partitions close the BM25 side channel **only when the query names the company's own partition and its own BM25 index**; through the parent's index B's scores moved in 3 / 3 rounds (up to 941,667 ppm, like the shared control 938,828), on its own partition 0 ppm in 3 / 3. Every partition carries its own RLS. 1,000 partitions: create ≈ 20–23 s, query p95 ≤ 3 ms, planning p95 ≤ 0.5 ms; 50 × `vector(1536)` + HNSW fine.
- **LV-54 (pg_textsearch 1.3.1 on Cloud SQL, preload listed):** BM25 top-5 correct; `simple` config does not stem (inflected query 0 hits) – `english` does (4); a `WHERE company_id` filter does not starve the top-k (8 / 8); **no field weights** (title vs body) in 1.3.1; Tamil and Hindi single-word queries 3 / 3 with `simple` (NFC); pg_trgm fuzzy fallback works (VS-8). The extension's GitHub page now shows v1.4.0; Cloud SQL offers 1.3.1 – re-check the Cloud SQL version before Phase 2.
- Packages locked in the LV runner (Task 0.11): `asyncpg` 0.31.0, `cloud-sql-python-connector` 1.22.0 (package register notes).

## Doc-sync 2026-10-05 (Stage 21 Task 0.12 brief – reranker export, Document AI client)
- **VS-9 detail:** the int8 reranker is produced in an image **build stage**: Hugging Face revision of `BAAI/bge-reranker-v2-m3` pinned by commit + per-file sha256 (`model.lock.json`, build fails on mismatch) → `optimum-onnx` export to ONNX fp32 → ONNX Runtime **dynamic int8** quantisation with an avx2-portable configuration (Cloud Run does not let us choose the CPU model) → fp32-vs-int8 parity numbers (Spearman, top-5 overlap, max score difference on fixed synthetic pairs) in `export.json`. Runtime image = `onnxruntime` + `tokenizers` + `numpy` + the int8 graph + `tokenizer.json`; no torch / transformers / optimum at runtime.
- **VS-3 detail:** the export tool chain (CPU-only PyTorch from the PyTorch CPU index, transformers, optimum, optimum-onnx, onnx, huggingface_hub) is installed from a **hashed build-time requirements lock** compiled with uv 0.12.22 – kept out of `uv.lock` (no torch in CI's `uv sync --all-packages`) and out of every runtime image. Its licence closure must stay free of AGPL / GPL / SSPL.
- **New package `tokenizers`** (Hugging Face, Apache-2.0) – runtime tokenizer of the reranker (VS-9 "pin tokenizer"); register row added by Task 0.12 (owner, not Astra-verified). `google-cloud-documentai` (register I1) enters the LV runner lock; called over REST with `retry=None` + explicit timeouts (ER-1).
- **CI capacity note:** GitHub-hosted runners for private repositories have 2 vCPU / 8 GB RAM / 14 GB disk (GitHub "GitHub-hosted runners" page, 2026-10-05); the reranker export may exceed it – a larger runner costs money (owner decision, FD-23 context).

## Doc-sync 2026-10-06 (Stage 21 Task 0.12 close)
- **Licences (Phase 5 THIRD_PARTY_NOTICES):** `certifi` (MPL-2.0, in every image since Task 0.7) and `tqdm` (MPL-2.0 / MIT, new in the lvexecutor runtime via `huggingface-hub` ← `tokenizers`) – unmodified use.
- **google-cloud-documentai 3.16.0:** see Stage 15 (no session replacement; no-retry in place).
- Reranker export tool chain: `optimum-onnx` 0.1.0 forces optimum 2.1.0, transformers 4.57.6, torch 2.9.1+cpu; build-time only (hashed `export/requirements.lock`); export peaks at 7.1 GB on the 8 GB runner.
- Reranker product choice (VS-9) re-opened by LV-115 FAIL → ADR pending.

## Doc-sync 2026-10-06 (ADR-0007 – reranker = Vertex Ranking API, owner)
- **VS-9 replaced for the product:** bge-reranker-v2-m3 + ONNX int8 export is no longer the reranker; the managed Vertex Ranking API (`semantic-ranker-default-004`) is (ADR-0007). The `lvexecutor` export tool chain stays a dev LV tool only; its build-time packages never enter a product image.
- Ranking API calls use plain REST with `google-auth` `AuthorizedSession` (no new SDK), retry-free in place (Task 0.12 F-5 pattern).

## Doc-sync 2026-10-09 (ADR-0010, FD-33)
- **VS-21:** argon2-cffi not used (no passwords); PyJWT (HS256 access tokens), pyotp (TOTP), google-auth (ID-token verification) used; QR rendered by the UI from the `otpauth://` URI.
- **VS-22 revised:** Amazon SES ap-south-1 **only** (à la carte, FD-32); ZeptoMail dropped (FD-33). **boto3** added for the `mailer` app only (owner OK 2026-10-09).

## Doc-sync 2026-10-10 (ADR-0012 – Claude through the first-party Claude API)
- **Claude SDK (ADR-0012):** `anthropic` (official Python SDK) with `AsyncAnthropic(max_retries=0)` and the WIF credential flow (as `apps/lvrunner`, Task 1.2) replaces `AsyncAnthropicVertex` in `packages/gateway`. Root `CLAUDE.md` forbidden-pattern line is updated by the Model Gateway task. google-genai (Gemini on Vertex) unchanged.
