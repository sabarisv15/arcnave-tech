# Stage 19 - Infrastructure: conformance audit
Sources read: `docs/architecture/Stage-19-Infrastructure/00-checkpoint-stage19.md` (all 259 lines, every doc-sync block to 2026-10-13), `19-infrastructure.md` (facts F1-F30, items IN1-IN20, CIN1-CIN6), `00-Handoff/00-build-plan-arcnave-tech.md`, `Build-arcnave-tech/tech-p0.md` + `tech-p1.md`, `docs/decisions/0053`, `0054`, `0061`; repo: `backend/Dockerfile`, `arcnave-frontend/Dockerfile`, `arcnave-frontend/nginx.conf`, `arcnave-frontend/wrangler.jsonc`, `backend/sandbox/*`, `.github/workflows/ci.yml`, `compose.yaml`, `backend/src/{config.ts,config/numbers.ts,index.ts,app.ts,routes/auth.ts,routes/health.ts,providers/anthropic.ts,providers/gemini.ts,db/migrate.ts}`, `arcnave-frontend/src/api.ts`, `docs/deploy/*.md`. `.env.example` was not readable (permission denied). Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Method note: the Python build's Phase 0/1 infra (Terraform, Cloud Tasks executor, Redis, Cloud Run layout, OTel) is infra by the owner rule. Items whose only difference is infra are DIFF-INFRA; items on the owner's deferred list (Terraform, Cloud Tasks, Redis, OTel, tenancy/RLS/roles, NO_CONTENT enforce) are not bucketed and sit in `_parts/deferred-g5.md`.

## 1. Locked decisions
| Id | Decision (one line) | Status |
|---|---|---|
| ID-1 | Folder org policies; `gcp.resourceLocations` = `in:in-locations` + `global` (ALB tier only); all data stores India-only | LOCKED (doc-sync 2026-10-03 adds `global`, 2026-10-07 adds `compute.skipDefaultNetworkCreation`) |
| ID-2 | Assured Workloads India Data Boundary not adopted | LOCKED |
| ID-3 | One VPC per project; subnets run-main /24, run-isolated /26, fetcher **/26** (SUPERSEDED /28 by 2026-10-04), PSA; PGA + private DNS; Delhi mirror; Cloud NAT only for fetcher | LOCKED; /28 line SUPERSEDED 2026-10-04 |
| ID-4 | Private IP, `ENCRYPTED_ONLY`, Cloud SQL connector, IAM DB login per service role, pool budget API 5+5 / Executor 4+2 / worker 3+2, sum <= max_connections - 50 | LOCKED; 2026-10-08 audit: size by `max_instances x (pool+overflow)` |
| ID-5 | Memorystore Redis Standard, AUTH + TLS at creation, RDB 6 h | LOCKED; creation time refined 2026-10-10 (ADR-0011) |
| ID-6 | Cloud Run per service (gen2, concurrency/timeout explicit, ingress internal+LB, OTel sidecar); Executor 4 GiB reason gone | LOCKED; Executor memory SUPERSEDED by 2026-10-06 (ADR-0007: size by measurement) |
| ID-7 | Sandbox runner = Cloud Run Job execution per run, signed-URL inputs, task timeout 120 s | LOCKED; confirmed 2026-10-05 (7-11 s start, 20 s deadline N-68, warm-up execution after deploy) |
| ID-8 | Global external ALB (EXTERNAL_MANAGED) + serverless NEGs; hosts app/api/share (`arcnave.in`), usercontent on **`arcnave.tech`**; **no Cloud CDN**; SSL policy MODERN + TLS 1.2; Certificate Manager; CAA; DNSSEC | LOCKED; host names SUPERSEDED by 2026-10-03 domain sync (`arcnave.in`) and 2026-10-06 (usercontent stays on `arcnave.tech`); `invoker_iam_disabled` pattern 2026-10-07 |
| ID-9 | Cloud Armor Standard CRS 4.22, rate limits 600/min per IP + per user, reCAPTCHA tokens, verbose logging OFF in prod | LOCKED |
| ID-10 | One runtime SA per service, custom Vertex role, groups, Access Approval, PAM break-glass, IAM DB login | LOCKED |
| ID-11 | Global secrets, replicas asia-south1 + asia-south2, volume mounts for rotating credentials, env for static config | LOCKED |
| ID-12 | GitHub Actions + WIF (SHA-pinned actions), images in asia-south1 registry (no `latest`), scan gate, SBOM, Binary Authorization, Cloud Deploy canary 25/50/100; `--no-traffic` + migrate | LOCKED; protected-environment line SUPERSEDED for dev by FD-23 (2026-10-04); order decided 2026-10-08 (`upgrade` before deploy, fail = no deploy) |
| ID-13 | Migrations: migrator SA + DDL role, migration job before promotion, expand -> deploy -> backfill -> contract, advisory lock on dedicated connection, rollback = traffic only | LOCKED; roles refined 2026-10-08 (`arcnave_owner` / `arcnave_app`) |
| ID-14 | Terraform modules + env roots, separate GCS state, plan/apply identities, weekly drift plan | LOCKED; deviations D-16 / S-1 / M-7 2026-10-08 |
| ID-15 | Backups asia-south2 x14, PITR 7 d, restore drill, Delhi runbook (DB-polling dispatch, Gemini OCR fallback) | LOCKED |
| ID-16 | No Eventarc; Cloud Scheduler `Asia/Kolkata`; Pub/Sub only for rotation and budget alerts, India storage policy | LOCKED |
| ID-17 | Quotas raised before launch; Quota Adjuster ON | LOCKED |
| ID-18 | Claude on Vertex `global` via PGA, no VPC-SC | SUPERSEDED by doc-sync 2026-10-10 (ADR-0012: first-party Claude API in every environment, WIF, NAT + egress firewall for tagged workloads) |
| DS19-A | Domain `arcnave.in` (not `.tech`); wildcard cert + apex | LOCKED 2026-10-03 / 2026-10-06 |
| DS19-B | User-content previews on a separate registrable domain `arcnave.tech` (nothing else there) | LOCKED 2026-10-06 |
| DS19-C | Review R-4 ops console on IAP; R-8 isolated egress = restricted VIP only; R-9 research jobs in run-main | LOCKED 2026-10-03 |
| DS19-D | Health path `/health` (Cloud Run reserves some paths ending in `z`) | LOCKED (Stage 20 doc-sync 2026-10-04, applies to the service images) |
| DS19-E | Dev cost plan FD-22, GitHub plan FD-23, Cloud SQL stop rule | LOCKED (Python-build operations) |
| DS19-F | Measured facts: LV-108 (Vertex via PGA, no NAT), LV-25/111 (ALB SSE), LV-110 (connector), LV-109/125/126/27 (sandbox) | LOCKED (results) |
| DS19-G | Claude path doc-syncs ADR-0002, ADR-0008, ADR-0012 | ADR-0002/0008 SUPERSEDED by ADR-0012 (2026-10-10) |
| DS19-H | `mailer` service, SES Mumbai, no VPC egress for mailer (ADR-0010) | LOCKED (auth/e-mail: see Stage 16 audit) |
| DS19-I | Executor service + queue `turns`, two-step switch, deploy order migrate -> executor -> api (Task 1.11) | LOCKED (Cloud Tasks / Cloud Run layout) |
| DS19-J | Connection budget vs max instances rule (2026-10-08 audit) | LOCKED |

## 2. Repo today
| Id | Evidence (file:line) or "not found" |
|---|---|
| ID-1 | Org policies: not found (searched `**/*.tf`, `infra/`: none). Region defaults in code: `backend/src/config.ts:254` `SANDBOX_LOCATION` default `us-central1`; `backend/sandbox/verify-deployment-config.sh:10` same default; `backend/src/config.ts:112` `VERTEX_LOCATION` default `global` (Gemini, allowed). Prod runtime regions are set in env, not in the repo (`docs/checkpoints/CURRENT.md:1176-1178` says `SANDBOX_LOCATION=asia-south1` was set on the service). GCS bucket location: not verifiable here (no repo file states it; `docs/deploy/model-inputs.md:16` creates the model-input bucket in asia-south1). |
| ID-2 | No Assured Workloads reference in repo (searched `docs/deploy`, `backend/src`). |
| ID-3 | No Terraform. Sandbox egress deny-all via VPC documented in `docs/deploy/warm-sandbox.md:105-115` and ADR-0007 (`docs/decisions/0007-sandbox-no-general-egress.md:59`, subnet 10.20.0.0/26 asia-south1). |
| ID-4 | `postgres` (postgres.js) pool `max = DB_POOL_MAX` = 10 (`backend/src/db/client.ts:35-36`, `config/numbers.ts:71`); URL with password `config.ts:97`; Cloud SQL socket `:107`; no statement/lock timeouts (`client.ts:35-52`). |
| ID-5 | No Redis: run hub in-process (`backend/src/container.ts:68`, `services/runHub.ts:17-20`). |
| ID-6 | Only a sandbox service documented: 2 vCPU / 8 GiB, concurrency 16, timeout 900 (`docs/deploy/warm-sandbox.md:43-44`); API timeout 3,600 s referenced at `config.ts:147-150`. |
| ID-7 | Both engines exist: warm service default when `SANDBOX_SERVICE_URL` set (`config.ts:239-244`), Cloud Run Job per call `config.ts:252-270`, `tools/sandbox/cloudRunSandboxClient.ts`, `tools/sandbox/signedUrl.ts`. Job path deprioritised by ADR-0010 (`config.ts:229-232` comment: "cold Cloud Run Job per call made one extraction take minutes"). Per-chat persistent workspaces: ADR-0010 / 0014 / 0015. |
| ID-8 | Frontend hosted on Cloudflare Workers assets (`arcnave-frontend/wrangler.jsonc:1-9`, `arcnave-frontend/package.json:9`); production API base is a public `*.run.app` URL baked into the bundle (`arcnave-frontend/src/api.ts:30-33`); session cookie is `SameSite=None` because frontend and API are cross-site (`backend/src/routes/auth.ts:4-15`); artifact HTML previews are same-origin sandboxed iframes with `sandbox="allow-scripts"` (`arcnave-frontend/src/SandboxFrame.tsx:11,188-192`), not a separate `usercontent` domain. No ALB, no CDN config in repo. A frontend Docker image with an nginx same-origin `/v1` proxy exists (`arcnave-frontend/Dockerfile:19-29`, `nginx.conf:36`). |
| ID-9 | App-level limiter `@fastify/rate-limit`, per user else per IP (`app.ts:93-101`); no Cloud Armor in repo. |
| ID-10 | Not found (no IaC). |
| ID-11 | `ANTHROPIC_API_KEY` / `COOKIE_SECRET` read from env (`config.ts:88,122`); production boot checks `config.ts:425-439`. No Secret Manager code. |
| ID-12 | Only `ci.yml` (tests, no build/push/deploy): `.github/workflows/ci.yml:1-78`. Deploy = Cloud Build trigger outside the repo (`ci.yml:2-3`). Sandbox image tagged `:latest` (`backend/sandbox/cloudbuild.service.yaml:10`); base images not digest-pinned (`backend/Dockerfile:12,18,28`, `arcnave-frontend/Dockerfile:7,19`, sandbox Dockerfiles). No WIF, no scan, no SBOM, no attestation. |
| ID-13 | Drizzle migrations in `backend/drizzle` (28 files); runner on a dedicated connection (`backend/src/db/migrate.ts:17-27`); started inside the serving container and failure ignored: `backend/Dockerfile:69` (`node dist/db/migrate.js \|\| true`). No migrator/app role split. |
| ID-14 | Not found. |
| ID-15 | Not found (Cloud SQL "arcnave-db" in asia-south1 per `docs/checkpoints/CURRENT.md:1766-1767`, PG16). |
| ID-16 | No Eventarc, Pub/Sub or Scheduler dependency: `backend/package.json:23-51` lists none. In-process housekeeping timers: `backend/src/index.ts:15-58`. |
| ID-17 | Not found (ops). |
| ID-18 | `new Anthropic({ apiKey, maxRetries: 0, timeout })` `backend/src/providers/anthropic.ts:44-55`; no Vertex Claude; Gemini via `GoogleGenAI({vertexai, project, location})` `providers/gemini.ts:349-353`. ADR-0054 decision 6 keeps an API key instead of WIF (`docs/decisions/0054-claude-first-party-api.md:57-59`). |
| DS19-A/B | `arcnave.in` used for the marketing site and prerender (`arcnave-frontend/scripts/prerender.mjs:23`); no `arcnave.tech` anywhere in code (searched `backend/src`, `arcnave-frontend/src`). |
| DS19-C | Not found (no ops console; sandbox egress deny only, see ID-3). |
| DS19-D | Health routes `/healthz` and `/readyz`: `backend/src/routes/health.ts:20,43`; `backend/Dockerfile:63-64`; `arcnave-frontend/nginx.conf:56-57`. |
| DS19-E/F/G/I/J | Python-build operations/results: not applicable to repo code except where bucketed below. |
| DS19-H | No mailer, no SES (searched `ses`, `mailer` in `backend/src`: none). |

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| S19-01 (ID-1 / R11 region defaults) | REWRITE | Code defaults a sandbox location to `us-central1`; every service/bucket must be asia-south1 |
| S19-02 (ID-2) | DIFF-INFRA | Nothing to build; policy decision only |
| S19-03 (ID-4, DS19-J) | DIFF-STACK | postgres.js + URL/socket instead of Python connector + IAM login; IAM login deferred, pool total matches N-66 |
| S19-04 (ID-6, DS19-I) | DIFF-INFRA | Cloud Run sizing / service layout |
| S19-05 (ID-7, DS19-F) | NEW-BUILD | Job-per-run exists as an engine but the product path is the warm shared service |
| S19-06 (ID-8 ALB, TLS, DNS, certs, DS19-A) | DIFF-INFRA | Edge is infra |
| S19-07 (ID-8 no-CDN, hosting) | REWRITE | Frontend on Cloudflare (worldwide CDN) vs Google-only Mumbai hosting, no CDN |
| S19-08 (ID-8 same-site hosts, cookie) | REWRITE | Bundle calls a public `run.app` URL; cookie forced to `SameSite=None` |
| S19-09 (DS19-B usercontent domain) | NEW-BUILD | Previews are same-origin iframes; locked design is a separate registrable domain |
| S19-10 (ID-9) | DIFF-INFRA | Cloud Armor is infra |
| S19-11 (ID-11) | DIFF-INFRA | Secret Manager mounts are infra; key-vs-WIF is an owner question |
| S19-12 (ID-12 pipeline, ID-15) | DIFF-INFRA | WIF, Cloud Deploy, attestation, Binary Authorization are pipeline infra |
| S19-13 (ID-12 images) | REWRITE | `:latest` tag, no digest pins, unpinned apt/pip in images |
| S19-14 (ID-13 fail-closed) | REWRITE | A failed migration is swallowed and the server starts anyway |
| S19-15 (ID-16) | KEEP | No Eventarc / Pub/Sub dependency (`backend/package.json:23-51`) |
| S19-16 (ID-18 outcome) | KEEP | Claude via first-party SDK with retries 0 (`providers/anthropic.ts:44-55`) |
| S19-17 (DS19-D health path) | REWRITE | `/healthz` is a Cloud Run reserved-style path; locked path is `/health` |
| S19-18 (SIGTERM deadline) | REWRITE | Shutdown has no deadline against Cloud Run's 10 s SIGKILL |
| S19-19 (DS19-C R-8 egress) | DIFF-INFRA | Deny-all VPC egress documented; restricted-VIP rule is a firewall detail |
| S19-20 (Postgres version) | DIFF-INFRA | Cloud SQL / CI run PG16, locked is PG18 Enterprise |
| S19-21 (LV runner, dev tools) | DIFF-STACK | Python `lvrunner` replaced by TypeScript scripts in `backend/src/scripts` |

Counts: KEEP 2 - REWRITE 7 - NEW-BUILD 2 - DISCARD 0 - DIFF-STACK 2 - DIFF-INFRA 8 (21 rows). Owner-deferred (not bucketed): ID-1 policies, ID-3, ID-5, ID-9 detail, ID-10, ID-14, ID-15, ID-16 scheduler/tasks, ID-17, DS19-C ops console, DS19-E/H/I - see `_parts/deferred-g5.md`.

## 4. Non-KEEP items
### S19-01 - Region defaults in code
- Exact change: `SANDBOX_LOCATION` must not default to a US region. Files touched: `backend/src/config.ts:254`, `backend/sandbox/verify-deployment-config.sh:10`; also check where production env is set (not in repo). Port source: none (arcnave.in is Terraform-driven). Also R11 live check: confirm the buckets named by `STORAGE_GCS_BUCKET` / `MODEL_INPUT_BUCKET` and the Cloud SQL instance are asia-south1 (cannot be proven from the repo).
- Option A (REWRITE): default to `asia-south1`. Time S. Risk low. Breaks: `cloudRunSandboxClient.test.ts` only uses `us-central1` as an arbitrary test value.
- Option B (REWRITE): no default - required when `SANDBOX_ENGINE` resolves to `cloud-run`, boot fails closed. Time S. Risk low; one more required env.
- Pick: B - a missing value then fails loudly instead of silently placing work in the US.

### S19-05 - Sandbox runner: fresh Cloud Run Job execution per run
- Exact change: make the single-use Cloud Run Job (inputs and results through V4 signed GCS URLs, identity with no roles, task timeout 120 s, dispatch-to-first-heartbeat deadline 20 s per N-68, one warm-up execution after each image deploy) the default product path; keep the warm service only as an explicit fallback until measured. Files: `backend/src/config.ts:239-270`, `backend/src/tools/sandbox/cloudRunSandboxClient.ts`, `signedUrl.ts`, `backend/sandbox/Dockerfile`, `docs/deploy/*`. Port source: arcnave.in:`backend/apps/sandbox` and Stage 19 doc-sync 2026-10-05 (not read in detail).
- Option A (NEW-BUILD): build the Job path to the locked shape beside the warm service, measure dispatch (target 7-11 s, N-68 20 s), then switch the default. Time M. Risk: per-chat workspaces that outlive runs (ADR-0014, ADR-0015, `sandboxCheckpoints`) assume a warm instance; files must move through GCS per run. Breaks ADR-0010 / 0014 / 0015 assumptions and `warmSandboxClient` tests when switched.
- Option B (DISCARD warm service): remove the warm path. Time L. Risk: loses OCR/render speed that ADR-0008/0010 were created for.
- Pick: A - outcome (no state reused between runs, no shared container) met without breaking the running product until the switch. Owner question Q1.

### S19-07 - Frontend hosting (Cloudflare vs Google-only, no CDN)
- Exact change: serve the SPA from the existing frontend image (`nginx`, same-origin `/v1` proxy) on Cloud Run Mumbai behind the edge, remove `wrangler` deploy. Files: `arcnave-frontend/wrangler.jsonc`, `arcnave-frontend/package.json:9,52`, `arcnave-frontend/scripts/assertDeploySource.mjs`, `arcnave-frontend/Dockerfile`. Port source: none.
- Option A (REWRITE): move hosting to Cloud Run (needs an infra apply: owner-gated per ADR-0053 #11). Time M. Risk: prerendered marketing pages need the Chromium prerender step in the image build (`package.json:8`). Breaks the current Cloudflare deploy path.
- Option B (keep Cloudflare for the prototype, ADR-0060 as owner-approved deviation): Time S. Risk: Cloudflare is a CDN that caches static assets worldwide - contradicts ID-8 "no CDN on any host" and is not in the VS-32 SaaS list; static assets hold no customer data.
- Pick: A for the target; B only if the owner writes ADR-0060. Owner question Q2.

### S19-08 - Same-site hosts instead of a public run.app URL and `SameSite=None`
- Exact change: production API base `/v1` (same origin) or an `api.` host on the same site; session cookie back to `SameSite=Lax`; direct public `run.app` access closed (ingress internal + LB). Files: `arcnave-frontend/src/api.ts:30-33` (hard-coded `run.app` URL containing a project number, also an A1 breach, see Stage 21), `backend/src/routes/auth.ts:4-15` and the cookie options, `backend/src/config.ts:86`. Port source: none (edge is infra).
- Option A (REWRITE): ship the same-origin build (`Dockerfile ARG VITE_API_BASE=/v1`, `arcnave-frontend/Dockerfile:12`) and drop the hard-coded fallback. Time S in code, depends on S19-07 + the ALB. Risk: needs infra before it works in production. Breaks the Cloudflare-hosted login unless S19-07 lands first.
- Option B (stopgap): keep cross-site cookies and document Safari login failure. Time 0. Risk: Safari / strict-Firefox users cannot sign in (`auth.ts:8-10`).
- Pick: A, sequenced after S19-07. Remove the hard-coded URL immediately (S) so no project number stays in the bundle.

### S19-09 - Separate user-content domain
- Exact change: serve model-written HTML artifact previews from `usercontent.arcnave.tech` (separate registrable domain, no cookies, CSP), iframe `sandbox` retained. Files: `arcnave-frontend/src/SandboxFrame.tsx`, share/artifact preview routes (`backend/src/routes/share.ts`, `artifacts.ts`). Port source: none (Stage 14 RN10/RN11 is the design owner). 
- Option A (NEW-BUILD): add a preview-serving route/host beside the current `srcdoc` iframe, switch when the ALB host exists. Time M. Risk: needs the domain, certificate and ALB (infra). Breaks nothing until switched.
- Option B: keep `srcdoc` iframes (CSP `default-src 'none'`, `connect-src 'none'` at `SandboxFrame.tsx:20-25`). Time 0. Risk: same-origin execution context; weaker than locked design.
- Pick: A, scheduled with the edge work; B stays until then.

### S19-13 - Image tags, digests and pins
- Exact change: no `latest` tag; base images by digest (`node:22-bookworm-slim`, `nginx:1.27-alpine`, `python:3.13-slim-trixie` for the sandbox); pin apt/pip sets in a lock file with hashes for the sandbox images. Files: `backend/Dockerfile:12,18,28`, `arcnave-frontend/Dockerfile:7,19`, `backend/sandbox/Dockerfile:9-15`, `Dockerfile.service:12-31`, `backend/sandbox/cloudbuild.service.yaml:10`. Port source: arcnave.in:`backend/Dockerfile` pattern (digest-pinned bases; not opened).
- Option A (REWRITE): tag with commit sha, deploy by digest, add pinned requirements. Time S-M. Risk: first rebuild may change behaviour (pandas, matplotlib versions). Breaks `backend/sandbox/test/*` expectations if versions shift.
- Option B (minimal): tag by sha only, pins later. Time S. Risk: leaves VS-3 open.
- Pick: A.

### S19-14 - Migration failure must stop the deploy
- Exact change: remove `|| true`; run migrations as a separate step (CI step or one-off job) before traffic moves, fail = no deploy; keep the dedicated advisory-lock connection and expand/contract discipline. Files: `backend/Dockerfile:69`, `backend/src/db/migrate.ts`. Role split (migrator vs app) deferred. Port source: arcnave.in:`backend/apps/migrator` (not opened).
- Option A (REWRITE): entrypoint `node dist/index.js`; migration in the deploy pipeline. Time S. Risk: until a pipeline step exists the owner runs migrations by hand (`npm run db:migrate`, `package.json:19`). Breaks `compose.yaml` first boot (relies on migrate-at-start, `compose.yaml:41`) unless a one-shot migrate service is added.
- Option B: keep migrate-at-start but exit non-zero on failure. Time S. Risk: every instance races to migrate (advisory lock holds), slower cold start.
- Pick: A with a `migrate` one-shot service in `compose.yaml`; Option B as a stopgap in the same commit if the pipeline step lags.

### S19-17 - Health path
- Exact change: expose `/health` (liveness) and keep `/readyz` only if Cloud Run does not reserve it; move Docker HEALTHCHECK and nginx proxy to the new path. Files: `backend/src/routes/health.ts:20,43`, `backend/Dockerfile:63-64`, `arcnave-frontend/nginx.conf:56-57`, tests. Port source: arcnave.in:`backend/apps/api` health route.
- Option A (REWRITE): add `/health`, keep `/healthz` as alias for one release. Time S. Risk low. Breaks nothing.
- Option B: rename outright. Time S. Risk: probes in the live Cloud Build/Cloud Run config must change in the same deploy.
- Pick: A.

### S19-18 - Shutdown deadline
- Exact change: bound `app.close()` + `closeDb()` to a budget well inside Cloud Run's 10 s SIGTERM->SIGKILL window (locked executor budget: 5 s, N-73), log `shutdown_overrun`. File: `backend/src/index.ts:61-85`. The checkpoint/resume of aborted runs belongs to the deferred executor.
- Option A (REWRITE): `Promise.race` with a timer then `process.exit(1)`. Time S. Risk low; an aborted run is still lost (ADR-0009 is connection-level only).
- Option B: leave as is. Risk: SIGKILL mid-write.
- Pick: A.

### S19-12 / S19-04 / S19-06 / S19-10 / S19-11 / S19-19 / S19-20 / S19-02 (DIFF-INFRA) and S19-03 / S19-21 (DIFF-STACK)
No code decision now; outcomes are infra or stack equivalents. One note each: S19-20 Postgres 16 means no `uuidv7()`, `pg_textsearch`, `pgTAP 1.3.0` per the PG18 doc-sync - matters when retrieval (Stage 12) is built; S19-03 the pool is 10 total vs register 5+5 (same total), `statement_timeout` / `lock_timeout` / `idle_in_transaction` are absent (`db/client.ts:35-52`, see numbers-diff N-45); S19-11 key vs WIF is Q3.

## 5. Open questions for the owner
- Q1. Warm per-chat sandbox workspace (repo ADR-0010/0014/0015) vs fresh Job execution per run (locked ID-7 + TD-4b). Locked outcome wins under ADR-0061; the file-persistence behaviour users have today changes.
- Q2. Frontend on Cloudflare (ADR-0060 never written) vs Google-only Mumbai hosting with no CDN. Which, and until when?
- Q3. Claude credential: ADR-0054 decision 6 (API key in env) vs the locked doc-sync 2026-10-10 / ADR-0012 (WIF, no key anywhere). Not resolved here.
- Q4. Router/worker jobs on Haiku 5.5 (Py ADR-0013/0014, numbers N-69, N-77) vs build-plan B-4 / ADR-0055 "three models only". Recorded, not resolved.
- Q5. Production Cloud SQL is PostgreSQL 16 (`docs/checkpoints/CURRENT.md:1766`); locked is PG18 Enterprise. Upgrade before Stage 12 retrieval work or run both?
- Could not check: real bucket / service regions (no live access), the Cloud Build trigger contents, `.env.example`.

## 6. KEEP spot-check
Both KEEP rows re-opened: S19-15 - `backend/package.json:23-51` lists no eventarc/pubsub/scheduler/tasks package, confirmed. S19-16 - `backend/src/providers/anthropic.ts:44-55` `maxRetries: 0`, explicit timeout, confirmed; the Gemini client (`providers/gemini.ts:349-353`) sets only per-request timeout (`:327,447`) and no `retryOptions`, so "google-genai retries off" is **not** shown in code - the default in `@google/genai` 2.22 is unverified; flagged under Stage 20 (CLAUDE.md forbidden pattern), so S19-16 remains KEEP for the Claude path only.
