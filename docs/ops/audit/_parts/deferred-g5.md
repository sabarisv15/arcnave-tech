# Owner-deferred items G5 (Stages 19, 20, 21 and numbers sweep)

Not bucketed. "Raise now" = skipping it forces a rewrite of something built now. Auditor model: Sonnet 5.5.

| Id | Locked line | Why deferred | Raise now? | Evidence | Cost if raised / if skipped |
|---|---|---|---|---|---|
| ID-1, ID-3 | Folder org policies, VPC, subnets, PGA, firewall tags | Terraform | No | Repo has no `infra/` (searched `**/*.tf`, none; only `docs/deploy/*.md` gcloud notes) | Skipping costs nothing in code. |
| ID-5 / VS-11 / N-48 | Memorystore Redis, redis-py | Redis | **Yes, interface only** | Run hub, rate limits and stream buffer are in-process: `backend/src/services/runHub.ts:17-20`, `backend/src/app.ts:93-101`, `backend/src/container.ts:68` | Put the run hub behind a small store interface (Py ADR-0011 `StreamStore`) when the executor is touched: M. Later rewrite of `runHub` + `chats.ts` SSE route if not: M-L. No Redis client needed now. |
| ID-4 (IAM DB login, connector), N-66 pools | Cloud SQL IAM auth, per-role logins | Roles / Terraform | No | `DATABASE_URL` carries a password (`backend/src/config.ts:97`); socket host option `:107` | Config-only change later. |
| ID-6 / N-65 / N-25 / N-23 | Per-service Cloud Run sizing, min instances | Cloud Run layout | No | Only sandbox sizing in `docs/deploy/warm-sandbox.md:43-44` | None in code. |
| ID-8 (ALB, DNS, certs, DNSSEC) | Global external ALB, hosts, CAA | Terraform | No (code parts bucketed in stage-19) | - | - |
| ID-9, N-01 edge 600/min | Cloud Armor CRS, rate limits per IP / user | Terraform | No | App-level limiter exists (`app.ts:93-101`, `config.ts:366-371`) | - |
| ID-10 | One runtime SA per service, custom Vertex role | Terraform / roles | No | - | - |
| ID-11 | Global secrets, volume mounts, rotation | Terraform | No (key vs WIF is an owner question, see stage-19 section 5) | `ANTHROPIC_API_KEY` env `config.ts:122`; `COOKIE_SECRET` `:88` | - |
| ID-12 (Cloud Deploy canary, WIF, attestation, Binary Authorization) | Deploy pipeline | Terraform / CI infra | No | Deploy is a Cloud Build trigger outside the repo (`.github/workflows/ci.yml:2-3`) | - |
| ID-13 (migrator SA, DDL role, advisory lock, migration job) | DDL role split | Roles / RLS | No for the role split; **the fail-closed part is bucketed** (stage-19 S19-13) | `backend/Dockerfile:69` swallows failure; `backend/src/db/migrate.ts:17-27` uses a dedicated connection | Role split later: S-M. |
| ID-14 | Terraform modules, state, drift plan | Terraform | No | - | - |
| ID-15 | Backups asia-south2, PITR, Delhi DR runbook, Gemini OCR fallback, DB-polling dispatch | Terraform / Cloud Tasks | No | - | - |
| ID-16 (Cloud Scheduler, Cloud Tasks, Pub/Sub for rotation and budgets) | Scheduler `Asia/Kolkata`, queues | Cloud Tasks | No | In-process timers `backend/src/index.ts:15-58` | When a worker exists: M. |
| ID-17 | Quota raises before launch | Ops / Terraform | No | - | - |
| R-4 (ops console on IAP), R-8 VPC-SC for isolated project | Ops host, perimeter | Company / roles, Terraform | No | - | - |
| Doc-sync 2026-10-03 ... 2026-10-13 dev-infra lines (ADR-0008 NAT, Direct VPC sizing, CIDR plan, LV resources, mailer/SES egress, executor service, queue `turns`, Cloud SQL stop rule, FD-22/23/30) | Python-build dev environment state | Terraform / Cloud Tasks / Redis | No | - | - |
| VS-4 (`limits` + Redis token budget), VS-5 (Cloud Tasks handlers, Postgres flag table), VS-27 (Terraform, tflint, checkov), VS-28 (OTel SDK, collector), VS-31 (SBOM export of images) | Tooling that belongs to deferred infra | Redis / Cloud Tasks / Terraform / OTel | No | `@fastify/rate-limit` in-process `backend/package.json:28` | - |
| IP-7 (prod project, HA before first paying customer), IP-8 (lawyer track), IP-9 (academics later), IP-2/IP-6 (timeline, pilot) | Plan / business | Phase 5-6 | No | - | - |
| Stage 21 C1 (project id allowed in telemetry fields) | OTel resource attribute | OTel | No | No OTel in repo | - |
| N-22, N-44, N-70 (job timeout part), N-71, N-73 (Redis / lease rows), N-76 (worker, outbox, queue `background-low`) | Cloud Tasks / Postgres stream store / worker | Cloud Tasks / Redis | No | - | - |
| N-50, N-51 (partly), N-52, N-53, N-54, N-55, N-56, N-57 | Sampling, retention of log buckets, SLOs, alerts | OTel / Terraform | No | - | - |
| N-32, N-60, N-61, N-62, N-63, N-64, N-58, N-38 | HA switch, infra phases, spend caps, capacity, cost ceilings, vendor prices | Cost / Terraform | No | - | - |
| N-29, N-30 (company Claude pool, company plan), N-11 / N-18 / N-19 / N-20 per-company quotas | Company / tenancy | Tenancy | **Yes, shape only** | Usage is per user: `backend/src/db/schema.ts:102` (`monthly_token_budget`); no `company` anywhere (searched `company` in `schema.ts`: not a table) | Any new table written now (settings, price_book, quota counters) should carry a nullable `company_id` / scope column: S per table. Retrofitting every existing table later: L. Owner decided "single user first" (ADR-0053 #3); this is only a flag. |
| RLS / pgTAP suite (IP-5 gate) | Postgres RLS | RLS | No | - | - |
| NO_CONTENT enforce (Stage 17), N-52 | Enforce in Phase 5 | NO_CONTENT enforce | **Partly done**: the shadow test exists (`backend/src/test/contentLeak.test.ts`, per `docs/architecture/Build-arcnave-tech/tech-p1.md` result row E); request logging is still on (see stage-20 VS-2 row) | - | - |

## Raise-now list (short)
1. Run-hub store interface (ID-5 row) - only if the turn runner / `generation.ts` is refactored in the same window.
2. `company_id` / scope column on any new settings, price_book or counter table (N-29 / N-30 row).
Everything else can wait without forcing a rewrite of code written now.
