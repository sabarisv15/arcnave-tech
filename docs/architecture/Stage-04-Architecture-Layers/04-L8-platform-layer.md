# ArcNave – Stage 4 · L8 Platform Layer – audit
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01: P1–P32, PL-1–PL-7) · Method: 1 auditor, new topics only (L6/L7 facts reused) · Labels: Vendor / Partial / ArcNave rec_

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - Binary Authorization on prod Cloud Run; Artifact Analysis + SBOM; pip hash pinning + pip-audit + Dependabot; Actions SHA-pinned; Cloud Armor CRS 4.22; SCC Standard + Cloud Run Threat Detection; secret rotation handlers; no NAT (PGA only); security headers (SD-6 / SE10–SE12).

> **Doc-sync 2026-10-03 (Stage 17) – see Stage-17-Observability/00-checkpoint-stage17.md:**
> - Telemetry = Google-native + OTel SDK + **Collector sidecar** per Cloud Run service (OTLP → `telemetry.asia-south1.rep.googleapis.com`, allowlist processor, self-observability alerts) (OD-1/OD-2).
> - Sampling: head 10 % + forced 100 % for errors/fallbacks/Research/admin; no tail sampler (OD-4).
> - SLOs (availability 99.5 %, turn completion 99 %, first-visible p90 3 s/8 s, Research 97 %) with multi-window burn-rate paging; page/ticket catalogue in checkpoint; **"Claude limit 80 %" alert redefined** as 429 rate >5 %/5 min + spend-rate (no Vertex rate-limit headers) (OD-9).
> - Notifications Pub/Sub + email + Slack; PagerDuty free (US) content-free payloads; uptime checks 3 checkers US/EU/Singapore; dashboards via Terraform `google_monitoring_dashboard`; Locust for load tests; Cloud Profiler not used (OD-10/OD-11/OD-16/OD-17).

> **Doc-sync 2026-10-03 (Stage 18) – see Stage-18-Cost-Performance/00-checkpoint-stage18.md + 00-Handoff/00-cost-decision-log.md:**
> - PL-6 spend chain revised: ledger reservations (real-time) → alert budgets 50/80/90/100 % → **spend-cap budgets (Preview) per project+service at 150 % of forecast** → kill switch; never disable billing (FD-10). Commitments: none months 0–6; Phase B SQL/Redis 1-y CUD + Gemini FSP 10 % (Claude excluded); Claude PT at ~1,000 users (FD-14). Cloud Run: API request-based, Executor measured, concurrency 4; billing labels on revision template (CD-10).

> **Doc-sync 2026-10-03 (Stage 19) – see Stage-19-Infrastructure/00-checkpoint-stage19.md:**
> - Hierarchy org → folder `arcnave` → dev/staging/prod + cicd; Logging default location on folder before projects; folder org policies list in checkpoint (ID-1). **Assured Workloads India Data Boundary not adopted** (disables global Cloud Armor) (ID-2). Subnets: run-main /24 (PGA, no NAT), run-isolated /26 (deny-all egress), fetcher /28 (Cloud NAT static IP) (ID-3). Secrets: global + replicas Mumbai/Delhi – **regional secrets cannot be mounted by Cloud Run** (ID-11). CI/CD: WIF conditions on repo ID/ref/env, SHA-pinned actions, Artifact Analysis gate, Binary Authorization enforce prod, **Cloud Deploy canary 25/50/100 + repairRolloutRule replaces manual 10/50/100 (PL-3 refined)** (ID-12). Migrator identity + job before promotion (ID-13). Terraform modules + environments, separate state, no Bucket Lock on state (ID-14). Quotas to raise before launch (ID-17).

## Key facts (official, loaded)
- Cloud Run traffic change: in-flight requests finish; a split persists for later deploys; tags get no min instances; rare SIGTERM on busy instance possible.
- **Cloud Run does not support regional secrets** → use standard secrets with user-managed replication (asia-south1/asia-south2). Env-var secrets read once (pin version); volume secrets read latest (rotation).
- Direct VPC egress: subnet ≥/26, ~2× IPs per instance, startup connections can take ≥1 min. Static egress IP = Cloud NAT + all-traffic.
- Ingress internal: Cloud Tasks/Scheduler allowed only same project + default run.app URL. Default URL can be disabled.
- Secure-by-default orgs (after 3 May 2024): no SA keys, domain-restricted sharing (blocks allUsers → use --no-invoker-iam-check for public services), no Editor on default SAs, uniform bucket access.
- IAP on Cloud Run or on LB (not both); IAP incompatible with Cloud CDN.
- Data Access audit logs off by default, costly.
- Budgets only alert (delayed). Spend-cap budgets (preview Jul 2026): Vertex AI, Gemini API, Cloud Run; per project+service; monthly; gross cost; not instant; manual lift ≤1 h; partner models not mentioned. Disabling billing can delete resources. Lower quotas ≠ spend cap.
- **Free trial: no quota increases, no Marketplace/partner models (Claude)**; new customers only; credits expire 3 months; credit kept after upgrade.
- Org needs Cloud Identity/Workspace on verified domain. gcp.resourceLocations controls only where resources are created, not API calls (`in:india-locations`).
- WIF direct preferred; attribute condition on numeric repository_id; OIDC token 5 min.
- Artifact scanning only for images pulled in last 30 days. Uptime checks: no India checker region (≥3 regions). Error Reporting global. Log-based metrics billed.
- Terraform cloud_run_v2_service supports traffic, invoker_iam_disabled, default_uri_disabled, Direct VPC, iap; state in GCS with locking, versioning recommended.
- Expo OTA = JS/assets only; Play Integrity server-side, 10k/day default, not sole defence.

## Items
| # | Item | Sev | Comp | Source | Rec |
|---|---|---|---|---|---|
| P1 | Two $300 trials on two accounts: "new customers only" eligibility risk; one company → one paid billing account | Important | 8.1 | Vendor | MVP |
| P2 | **Free trial can't pay for Claude or raise quotas** → upgrade billing to paid before Claude tests (credit kept) | Critical | 8.1 | Vendor | MVP (PL-1) |
| P3 | Order: create org (Cloud Identity Free on arcnave.tech) → org policies + log location → projects → move old projects | Critical | 8.1 | Vendor | MVP |
| P4 | Projects: arcnave-prod, arcnave-dev (staging via tags), arcnave-cicd; folders prod/nonprod/common | Important | 8.1 | Partial | MVP (PL-2) |
| P5 | GitHub Actions + direct WIF, condition on numeric repository_id + branch; no SA keys | Critical | 8.2 | Vendor | MVP |
| P6 | Rainbow deploy: --no-traffic --tag → smoke test → gradual traffic; in-flight turns finish; rare SIGTERM → checkpoint resume | Critical | 8.2 | Vendor + ArcNave | MVP |
| P7 | Split persists → CI always sets traffic; Terraform ignores traffic/image | Important | 8.2 | Vendor | MVP |
| P8 | Same image digest dev → prod; keep old revisions; expand/contract schema | Important | 8.2 | ArcNave rec | MVP |
| P9 | Artifact Registry asia-south1 after location policy; scanning stops after 30 d unpulled | Minor | 8.2 | Vendor | MVP |
| P10 | One service account per service, least-privilege roles; never default compute SA | Critical | 8.3 | Vendor | MVP |
| P11 | Domain-restricted sharing blocks public access → --no-invoker-iam-check + ingress internal-and-LB for public API/web | Critical | 8.3 | Vendor | MVP |
| P12 | Ops panel IAP: LB or Cloud Run, not both; no CDN on ops | Important | 8.3 | Vendor | MVP |
| P13 | Data Access logs: Secret Manager DATA_READ, IAM ADMIN_READ; NOT Vertex data logs (may capture prompts) | Important | 8.3 | Partial | MVP |
| P14 | Break-glass admin account with hardware key + usage alert | Important | 8.3 | ArcNave rec | MVP |
| P15 | Direct VPC egress private-ranges-only to Cloud SQL/Redis; subnet sized for 2× instances × 2 (rollout overlap) | Critical | 8.4 | Vendor + ArcNave | MVP |
| P16 | Startup connection delay → readiness waits for DB/Redis; API min instances | Important | 8.4 | Vendor | MVP |
| P17 | **Executor: Cloud Tasks needs run.app URL** → ingress internal + keep default URL + IAM invoker; disable default URL only on public services | Critical | 8.4 | Vendor | MVP |
| P18 | Fixed egress IP (Cloud NAT) only if customers allowlist | Minor | 8.4 | Vendor | Later |
| P19 | VPC-SC vs Vertex global/Claude unknown → not in MVP; LV-1 | Important | 8.4 | Partial | Later |
| P20 | **Corrects L7 D17:** Cloud Run can't use regional secrets → standard secrets, user-managed replication asia-south1/asia-south2 | Critical | 8.5 | Vendor | MVP |
| P21 | Rotating secrets as volume; fixed as env pinned version | Important | 8.5 | Vendor | MVP |
| P22 | Vertex auth via service identity (ADC); no API keys/key files | Critical | 8.5 | Vendor | MVP |
| P23 | Feature flags/runtime config in DB with version stamping (L4) | Minor | 8.5 | ArcNave rec | MVP |
| P24 | Spend-cap budgets (preview) on prod + lower on dev; app hard cap stays (Claude coverage unknown) | Critical | 8.6 | Vendor | MVP |
| P25 | Budget Pub/Sub → L4 kill switch; never auto-disable billing | Important | 8.6 | Vendor | MVP |
| P26 | Read Vertex quotas for our models + embeddings; request increases on paid billing; enable Claude per model + org policy allow | Critical | 8.6 | Partial | MVP |
| P27 | Quota lowering = soft brake only | Minor | 8.6 | Vendor | Later |
| P28 | Uptime checks via LB from ≥3 regions; alerts 5xx, latency, instances, Tasks failures, budget | Important | 8.7 | Vendor | MVP |
| P29 | Error Reporting global → no PII in exceptions; few log-based metrics (billed) | Important | 8.7 | Vendor | MVP |
| P30 | Terraform state GCS asia-south1 in cicd project, versioning ON, locking; deletion_protection on prod | Important | 8.8 | Vendor | MVP |
| P31 | API version header + min-supported-app-version (force update); OTA can't change native code | Important | 8.9 | Vendor + ArcNave | MVP |
| P32 | Play Integrity on login/expensive calls, server-checked, with rate limits | Important | 8.9 | Vendor | Later (before Play launch) |

## Decisions
| ID | Question | Rec |
|---|---|---|
| PL-1 | Billing | One company paid billing account now (trial credit kept); don't rely on 2 personal trials |
| PL-2 | Projects | prod + dev (staging via tags) + cicd, under arcnave.tech org |
| PL-3 | Deploy | GitHub Actions + WIF; tag → smoke test → 10% → 50% → 100% |
| PL-4 | Network | Direct VPC egress (no connector) |
| PL-5 | Secrets | User-managed replication asia-south1/asia-south2 (replaces L7 D17) |
| PL-6 | Cost guard | App hard cap → spend-cap budgets → Pub/Sub kill switch → email; never disable billing |
| PL-7 | IaC | Terraform for all infra from day 1 |
