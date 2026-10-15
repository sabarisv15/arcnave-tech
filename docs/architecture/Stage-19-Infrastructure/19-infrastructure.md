# ArcNave – Stage 19 · Infrastructure – DRAFT (needs user OK)
_2026-10-03 · Source: Astra results 19-astra-results.md (official docs, 3 Oct 2026, A1–A5 + B–L) + locked inputs (Stage 4 L2/L6/L7/L8, Stage 5 DB-*, Stage 8 TD-4b sandbox, Stage 15 ER-*, Stage 16 SE9–SE13/SE17, Stage 17 OD-*, Stage 18 phases A/B/C) · Labels: ✅ Vendor/official · ⚠️ Partial · 🔧 ArcNave design · GA/Preview marked where documented; "U" = launch stage not separately declared._

## 0. Scope
Project/folder layout, org policies, networking, Cloud Run configuration per deploy, load balancer + Cloud Armor + certs + DNS, IAM + WIF, Terraform + CI/CD, database operations, backup/DR to Delhi, quotas to raise. Five corrections to earlier assumptions came out of the research:
1. **Cloud Run cannot mount regional secrets** → keep global secrets with user-managed replicas Mumbai + Delhi (PL-5 confirmed; "regional secrets" option dropped).
2. **`--concurrency=1` does not give a fresh container per request** → the per-run fresh sandbox (TD-4b) must be a **Cloud Run Job execution per run** (or Preview sandboxes later), not a service.
3. **Cloud CDN caches worldwide** → no CDN for usercontent/artifacts (residency); CDN only for static web assets without customer data (or none).
4. **Cloud Tasks and Document AI are not listed in Delhi** → Delhi DR runbook needs dispatch + OCR degradation paths.
5. **Assured Workloads India Data Boundary is free** but disables the global Cloud Armor policy → not adopted (DB-4 "after LV-1" stays "not adopted unless customer demands").

## 1. Real-product evidence
| | Claude | ChatGPT | Gemini | Perplexity |
|---|---|---|---|---|
| A1 Hosting / India | API on GCP + AWS; claude.ai topology + India storage not documented | **India storage at rest** for eligible Enterprise/Edu; inference residency EU/US/UAE only | Workspace data regions US/EU/none – no India | not documented |
| A2 SLA | not published | not published | Gemini Enterprise 99.5 % (StreamAssist) / 99.9 % (Search) | not published |
| A3 IP allowlist / SSO | CIDR allowlisting, SAML, SCIM; no fixed egress IPs | allowlisting OFF default, 5–15 min; SAML; no fixed egress | connector static IPs only | SSO (Pro), SCIM (Max) |
| A4 Subprocessors | list exists (unreadable in check) | Microsoft, CoreWeave, OCI, GCP, AWS, Cerebras, Cloudflare, Snowflake | Google Cloud list | list exists |
| A5 DR | not published | in-region backups/replicas | not published | not published |
**Pattern:** nobody publishes RPO/RTO or numeric SLAs for chat products; residency is sold as "storage at rest in region", inference elsewhere – exactly ArcNave's position (storage India, inference GLOBAL) → disclose the same way (LW-26).

## 2. Key facts (official)
| ID | Fact | Status |
|---|---|---|
| F1 | Hierarchy org → folder → dev/staging/prod; project IDs 6–30 chars; Logging default location set at folder/org **before** projects (`gcloud logging settings update --folder … --storage-location=asia-south1`) applies to new `_Default` + `_Required` | ✅ |
| F2 | `gcp.resourceLocations`: `in:asia-south1-locations`, `in:asia-south2-locations` (or `in:in-locations` incl. `IN` dual-region); not a storage commitment. `restrictCloudNATUsage` allowlists subnets; `allowedPolicyMemberDomains` takes customer IDs; Cloud Run custom constraint for Binary Authorization documented | ✅ |
| F3 | **Assured Workloads India Data Boundary**: free tier, Mumbai+Delhi, but sets `compute.disableGlobalCloudArmorPolicy=True` and disables SQL-based log alerting | ✅ |
| F4 | Direct VPC egress **GA**: subnet ≥ /26, ~2× instance count IPs, 20-min hold; instance quota 100–200/revision/region; `all-traffic` egress needed to deny internet | ✅ GA |
| F5 | PGA: private DNS `*.googleapis.com` → `private.googleapis.com` (199.36.153.8–11); GLOBAL Vertex host `aiplatform.googleapis.com`; Claude web_search blocked under VPC-SC + needs `vertexai.allowedPartnerModelFeatures` | ✅ |
| F6 | Cloud SQL: private IP (PSA) fine; Python Connector supports asyncpg + IAM DB auth (GA); `sslMode=ENCRYPTED_ONLY` must be set (default allows unencrypted); **Cloud Run SQL connection limit 100/instance**; `max_connections` by RAM: 8 GiB → 400, 16 GiB → 500, 64 GiB → 800; **managed connection pooling GA, Enterprise Plus only**, transaction mode, `max_prepared_statements=0` default (asyncpg needs >0), session SET/advisory locks unsupported | ✅ |
| F7 | Memorystore Redis: PRIVATE_SERVICE_ACCESS; AUTH + TLS (TLS 1.2+, set at creation); Standard = replica/failover; no managed cross-region replica; RDB 1/6/12/24 h | ✅ |
| F8 | No NAT = no internet only with `all-traffic`; fetcher needs own subnet + Cloud NAT static IP (`--nat-custom-subnet-ip-ranges`); 64,512 ports per NAT IP | ✅ |
| F9 | Cloud Tasks → internal Cloud Run OK (same project, `run.app` URL) with OIDC + `run.invoker`; audience = service URL; keep `run.app` URLs enabled | ✅ |
| F10 | Cloud Run: timeout default 300 s, max 3,600 s (set explicitly); concurrency max 1,000 (default 80 vs 80×vCPU – conflict → set explicitly); memory ceilings 1 vCPU→4 GiB, 2→8; fractional CPU needs concurrency 1; HTTP/1 request body 32 MiB, streaming responses exempt; startup limit 4 min (quota page) vs probe window 600 s (conflict → design for 4 min); SIGTERM→SIGKILL 10 s; liveness fail = SIGKILL | ✅ |
| F11 | Sidecars GA; GCS FUSE volumes GA; gen2 (microVM) GA, min 512 MiB; gen1 = gVisor; set `--execution-environment=gen2` explicitly | ✅ |
| F12 | Jobs GA: task timeout default 10 min, max 168 h; 10,000 tasks/execution, 10 retries; **`--concurrency=1` ≠ fresh container per request**; Cloud Run native sandboxes **Preview**; GKE gVisor documented | ✅ |
| F13 | Rollouts: `--no-traffic` + tags + `update-traffic`; Cloud Deploy canary GA ([25,50,75] + stable), `repairRolloutRule` | ✅ |
| F14 | IAM roles: `cloudsql.client` (+`instanceUser` for IAM login), `secretmanager.secretAccessor` per secret, `storage.objectAdmin` per bucket (or narrower), `cloudtasks.enqueuer`, `run.invoker`, `aiplatform.user` (or custom with `aiplatform.endpoints.predict`), `documentai.apiUser`, `logging.logWriter`, `cloudtrace.agent` | ✅ |
| F15 | WIF: issuer `https://token.actions.githubusercontent.com`; conditions on repository/owner **IDs** + ref/environment; `iam.workloadIdentityUser` on deploy SA; GitHub OIDC token 5 min; `auth@v3` is OSS, not a Google product | ✅ |
| F16 | **Regional secrets GA but not mountable by Cloud Run** → global secret + user-managed replicas; rotation via Pub/Sub notification; env secrets resolve at startup (pin version), volume secrets live (`latest`) | ✅ |
| F17 | Cloud SQL PG18 GA; default edition for PG16+ = **Enterprise Plus** (choose explicitly); HA SLA 99.95 % / 99.99 %; failover ~60 s; PITR 1–7 d / 1–35 d; backups custom location `asia-south2`; cross-region replica promotable (async, can lose recent commits) | ✅ |
| F18 | Flags: `shared_buffers` 10–60 % RAM; `cloudsql.enable_pg_textsearch`; **no `cloudsql.enable_pgvector` flag – `CREATE EXTENSION vector`**; pgvector 0.8.5 (HNSW ≤2,000 dims, iterative scans), pg_cron, pg_stat_statements; pg_textsearch needs maintenance release R20260712.01_06+ | ✅ |
| F19 | Alembic async template (`alembic init -t async`), expand/contract; advisory locks need a dedicated session connection (not transaction pooling) | ✅ |
| F20 | GCS: India dual-region `IN` (Mumbai+Delhi) valid; turbo replication RPO 15 min; soft delete default 7 d (0–90); V4 signed URL ≤7 d; Bucket Lock irreversible; 1k writes/5k reads per bucket initial | ✅ |
| F21 | Cloud Tasks Mumbai listed, **Delhi not listed**; task 1 MiB; dedupe 24 h; handler max 30 min. Scheduler default UTC → set `Asia/Kolkata`; 1,000 jobs. Eventarc GCS finalized → Cloud Run at-least-once, Pub/Sub transport → **India message-storage policy** | ✅ |
| F22 | Global external ALB: serverless NEG backend timeout **60 min fixed**; SSE buffering guarantee not documented (LV-25 stays); **Cloud CDN caches worldwide**; service-health multi-region failover GA (≥60 % ready, min 1 instance/region, IAP on Cloud Run not LB) | ✅ |
| F23 | Cloud Armor CRS 4.22 (`sqli-v422-stable` …, sensitivity 4), body inspection default 64 kB (8–64), rate keys IP/header/cookie/region, Adaptive Protection full = Enterprise, **verbose logging logs request snippets**; ingress `internal-and-cloud-load-balancing` blocks public `run.app` | ✅ |
| F24 | Certificate Manager DNS-auth wildcard GA; CAA `pki.goog` + `letsencrypt.org`; **SSL policy must be set (default COMPATIBLE/TLS 1.0)** → MODERN + min TLS 1.2; DNSSEC needs DS at registrar | ✅ |
| F25 | Artifact Registry `asia-south1-docker.pkg.dev`; cleanup policies; Binary Authorization GA (`--binary-authorization=default`, `--breakglass`); jobs checked at execution; continuous validation for Cloud Run not documented; Cloud Build SLSA L3 provenance; `gcloud artifacts sbom export`; GitHub attestations ≠ Binary Authorization attestor | ✅/⚠️ |
| F26 | Terraform: `modules/` + `environments/{dev,staging,prod}` separate backends (not CLI workspaces); GCS backend locking + versioning; **no Bucket Lock on state bucket**; `google_cloud_run_v2_service` GA | ✅ |
| F27 | SLAs: Cloud Run 99.95 % (services, not jobs); SQL Enterprise HA 99.95 %, Plus 99.99 %; Redis Standard 99.9 %; GCS regional 99.9 % / dual 99.95 %; Tasks 99.95 %; Premium LB 99.99 %; Vertex gen-AI inference SLA not established | ✅ |
| F28 | Delhi (asia-south2) has Cloud Run, Cloud SQL, Memorystore; **not Document AI, not Cloud Tasks**; Claude 5.5 GA on GLOBAL/US/EU (ML processing incl. Singapore), no Mumbai regional; Claude PT on GLOBAL unresolved (Anthropic: regional only); Claude batch not GLOBAL | ✅/⚠️ |
| F29 | Quotas: Cloud Run max instances default 100/revision, services 1,000/region; Tasks 500/s/queue; SQL instances 1,000/project; Redis 1 TB/region; Secret payload 64 KiB, access 90k/min; Logging ingest Mumbai 4.8 GB/min, **Delhi 300 MB/min**; Quota Adjuster GA (project) | ✅ |
| F30 | Anthropic Vertex SDK: `AnthropicVertex(project_id, region="global")`; ADC; no transport prescriptions (HTTP/2, pool) documented | ✅ |

## 3. Gaps / design items (IN)
| # | Item | Label | MVP/Later |
|---|---|---|---|
| IN1 | **Hierarchy**: org `arcnave.tech` → folder `arcnave` → projects `arcnave-dev`, `arcnave-staging`, `arcnave-prod` (+ `arcnave-cicd` for Artifact Registry/Terraform state, PL-2 kept) ; Logging settings on the **folder** before any project; org policies at folder: `gcp.resourceLocations` = `in:asia-south1-locations`, `in:asia-south2-locations` (global exempt automatically for addresses; Vertex GLOBAL is an API, not a resource), `iam.disableServiceAccountKeyCreation`, `storage.publicAccessPrevention`, `storage.uniformBucketLevelAccess`, `run.allowedIngress` internal + LB, `compute.restrictCloudNATUsage` allow only fetcher subnet, `iam.allowedPolicyMemberDomains` = our Workspace customer ID, Cloud Run custom constraint requiring Binary Authorization in prod | ✅ F1/F2 | MVP |
| IN2 | **Assured Workloads India Data Boundary: not adopted** (kills global Cloud Armor; adds nothing to storage residency we already enforce) – revisit only on customer contractual demand (regional ALB redesign) | ✅ F3 | Later/never |
| IN3 | **Network**: one VPC per project; subnets Mumbai `run-main /24` (Direct VPC egress `all-traffic` for API, Executor, worker), `run-isolated /26` (parser, sandbox jobs – egress all-traffic + **deny-all egress firewall except PGA ranges needed? → parser/sandbox need no Google APIs except GCS via FUSE/signed URL from Executor → deny all egress incl. Google APIs**; telemetry from these containers goes through the Executor (results carry metrics), sidecar collector not used there), `fetcher /28` (Cloud NAT + static IP, only `fetch_url` service), `psa` range for Cloud SQL + Redis; PGA on main subnet + private DNS zone `googleapis.com` → `private.googleapis.com`; Delhi subnets mirrored (DR) | ✅ F4/F5/F8 | MVP |
| IN4 | **Cloud SQL connectivity**: private IP (PSA), `sslMode=ENCRYPTED_ONLY`, **Cloud SQL Python Connector (asyncpg) with IAM DB auth** for app roles (no passwords to rotate except break-glass), per-role DB users (api, executor, worker, migrator); pool budget per service: API pool 5+5, Executor 4+2, worker 3+2 per instance × max instances ≤ `max_connections` − 50 reserve (8 GiB → 400); managed pooling only at Phase C (Enterprise Plus) with `max_prepared_statements>0` and **RLS `SET LOCAL` verified under transaction mode** (LV) | ✅ F6 | MVP |
| IN5 | **Redis**: Standard tier (HA switch), PRIVATE_SERVICE_ACCESS, AUTH + TLS 1.2 at creation, RDB 6 h (Standard), clients reconnect (ER-5 degraded mode) | ✅ F7 | MVP |
| IN6 | **Cloud Run per service** (all gen2 explicit, request-based unless noted): **API** 1 vCPU/1 GiB, concurrency 80, timeout 3,600 s, min 1 (A) → 3 (C), max 50; **Executor** 2 vCPU/4 GiB, concurrency 4, timeout 900 s, min 1 → 5, max 100, startup probe HTTP, CPU boost; **Worker** 1 vCPU/2 GiB, concurrency 10, min 0 (Cloud Tasks warm queue ER-7); **Parser** 2 vCPU/4 GiB, concurrency 2, timeout 600 s, min 0, isolated subnet; **Fetcher** 0.5 vCPU/512 MiB, concurrency 20, NAT subnet; **Web (Next.js)** 1 vCPU/512 MiB, concurrency 80, min 1; all with `--ingress=internal-and-cloud-load-balancing` (API, web, usercontent) or `internal` (others), OTel sidecar on API/Executor/worker/web only | 🔧 on ✅ F10/F11 | MVP |
| IN7 | **Sandbox runner = Cloud Run Job execution per run** (fresh microVM container each run, no state reuse; TD-4b satisfied): Executor triggers job execution with run id, inputs via GCS signed URL (read) + result bucket (write) – job SA has only those; task timeout 120 s (Deep), 10,000 tasks limit irrelevant; cold start ~ seconds → accepted (LV-27 measure); Preview Cloud Run sandboxes = Later candidate when GA; GKE gVisor = fallback if job cold start too slow | ✅ F12 | MVP |
| IN8 | **Service-to-service**: Cloud Tasks OIDC (queue SA) → Executor `run.invoker`; Executor SA → parser/fetcher invoker + `run.jobs.run`; audiences = service URLs; `run.app` URLs stay enabled; no internal ALB | ✅ F9 | MVP |
| IN9 | **Edge**: global external ALB (EXTERNAL_MANAGED) with serverless NEGs; hosts `app.arcnave.tech` (web), `api.arcnave.tech`, `usercontent.arcnave.tech`, `share.arcnave.tech`; **no Cloud CDN on any host** MVP (worldwide cache); SSL policy MODERN + min TLS 1.2; Certificate Manager DNS-auth wildcard `*.arcnave.tech` + apex; CAA records; static global IPv4 + IPv6; Cloud DNS + DNSSEC (DS at registrar) | ✅ F22/F24 | MVP |
| IN10 | **Cloud Armor Standard**: CRS 4.22 sqli/xss/lfi/rfi/rce/protocol (preview → enforce after LV), sensitivity 1→2 tuning, body inspection 64 kB, rate limits per IP (600/min) + per authenticated-user header key on `/v1/turns`, reCAPTCHA action tokens on signup/login, **verbose logging OFF in prod** (snippets = content), no geo blocking (E-5), Adaptive Protection alerting only (Standard) | ✅ F23 | MVP |
| IN11 | **IAM**: one runtime SA per service with F14 roles scoped per secret/bucket/queue; Vertex via custom role (`aiplatform.endpoints.predict` + needed `aiplatform.*` for grounding); groups `arcnave-ops`, `arcnave-dev`, `arcnave-security`; prod console access via groups + Access Approval/Transparency enabled; break-glass = time-boxed IAM grant via PAM entitlement (Google docs) + audit; humans never hold SQL passwords (IAM login) | ✅ F14 | MVP |
| IN12 | **Secrets**: global secrets, user-managed replication asia-south1 + asia-south2 (PL-5 confirmed, regional secrets rejected F16); mounted as **volumes** with `latest` for rotating credentials, env vars pinned for static config; rotation schedule → Pub/Sub (India storage policy) → rotation handler (SE9) | ✅ F16 | MVP |
| IN13 | **CI/CD**: GitHub Actions, WIF pool/provider with conditions on repository **ID**, `ref`, environment; deploy SA impersonation; `auth@v3`, `deploy-cloudrun` SHA-pinned; build on GitHub-hosted runners (no customer data in builds) → image to `asia-south1-docker.pkg.dev`; Artifact Analysis scan must finish before attestation (attestor key in KMS Mumbai); **Binary Authorization enforce in prod** (`--binary-authorization=default`), dry-run in staging; SBOM export per image to cicd bucket; **Cloud Deploy canary** for prod (25/50/100, verification job = smoke tests, repairRolloutRule rollback) – replaces manual 10/50/100 (PL-3 refined); dev/staging direct `--no-traffic` + migrate | ✅ F13/F15/F25 | MVP |
| IN14 | **Migrations**: Alembic async; **migrator SA + DB role** with DDL rights (app roles have none); migration = Cloud Run Job before Cloud Deploy promotion; expand → deploy → backfill (worker) → contract after old revisions retired; advisory lock on dedicated session connection; rollback = traffic only, never schema | ✅ F19 | MVP |
| IN15 | **Terraform**: repo `infra/` with `modules/` (project, network, run-service, sql, redis, buckets, edge, iam, monitoring) + `environments/{dev,staging,prod}` separate state in cicd-project GCS bucket (asia-south1, versioning, **no Bucket Lock**); PR = plan via read-only WIF identity + lock permission; apply via protected environment; weekly drift plan; org policies + Logging settings in a `bootstrap/` root run once by hand | ✅ F26 | MVP |
| IN16 | **Backups/DR**: Cloud SQL backups location `asia-south2`, 14 daily retained, PITR 7 d; quarterly restore drill (SE9); **Delhi runbook (SE17-3)**: restore SQL in Delhi, deploy API/Executor/worker/web images from `asia-south2` Artifact Registry replica, **dispatch fallback = DB-polling scheduler loop in worker (Cloud Tasks absent in Delhi)**, **OCR degraded = Gemini OCR fallback only (Document AI absent)**, Redis new instance (state not needed), GCS `IN` dual-region for uploads/derived/artifacts (turbo replication Later), audit bucket single-region Mumbai + copy job to Delhi; multi-region readiness failover (GA) = Later with cross-region read replica (RPO >0) | ✅ F17/F20/F21/F28 | MVP runbook · Later automation |
| IN17 | **Scheduling/events**: Cloud Scheduler `Asia/Kolkata`, OIDC → worker; Eventarc GCS finalized → parser **not used** (we already dispatch via Cloud Tasks from the upload-complete API call – avoids Pub/Sub + at-least-once dedupe); Pub/Sub only for Secret rotation + budget alerts with **message storage policy asia-south1** | ✅ F21 | MVP |
| IN18 | **Quotas to raise before launch** (prod + staging): Cloud Run max instances per revision 100 → 300 (API/Executor), regional CPU/memory, Direct VPC instances 200 → 400, Cloud Tasks queue dispatch defaults set explicitly (ER-7), Document AI 6 → 60 req/min Mumbai, Claude Sonnet 2,500 QPM (check granted), Gemini tier auto, Logging ingest OK, Cloud Armor rules; Quota Adjuster ON (project) | ✅ F29 | MVP |
| IN19 | **Privacy of infra logs**: Cloud Armor verbose off; ALB request logs sampling 10 % with query strings stripped? (ALB logs full URL → URL design: no content in query strings – already OD-2); SQL flags (OD-5); no CDN; Eventarc/Pub/Sub India policy | ✅ F23 | MVP |
| IN20 | **Claude on Vertex infra**: `AnthropicVertex(region="global")` host `aiplatform.googleapis.com` via PGA; web search needs org policy `vertexai.allowedPartnerModelFeatures` allow (set at folder) ; PT purchase only after Google confirms GLOBAL PT (unresolved) – N-38 unchanged; no VPC-SC | ✅ F5/F28/F30 | MVP |

## 4. Claude-only (CIN)
| # | Fact | Rule |
|---|---|---|
| CIN1 | SDK `AnthropicVertex(project_id, region="global")`; host `aiplatform.googleapis.com` | IN20; PGA path |
| CIN2 | Models GA on GLOBAL/US/EU; ML processing may include Singapore; no Mumbai regional | disclosure LW-26 unchanged |
| CIN3 | web_search blocked under VPC-SC; needs partner-feature org policy | IN20 |
| CIN4 | PT on GLOBAL unresolved (Anthropic: regional only); batch not GLOBAL | N-38 wait; no batch |
| CIN5 | No transport prescriptions (HTTP/2/pool) | use httpx defaults + Stage 15 timeouts; LV |
| CIN6 | No Anthropic reference architecture for Cloud Run + Vertex | ours is the reference |

## 5. Decisions (recommendations – need OK)
| ID | Question | Recommendation |
|---|---|---|
| **ID-1** | Hierarchy + org policies | IN1 (folder-level policies, Logging settings first, 4 projects) |
| **ID-2** | Assured Workloads India | Not adopted (IN2) |
| **ID-3** | Network layout | IN3 (3 subnets + PSA + PGA private DNS; fetcher-only NAT; isolated subnet deny-all) |
| **ID-4** | DB connectivity + pooling | Connector + IAM DB auth + ENCRYPTED_ONLY; pool budget; managed pooling Phase C only (IN4) |
| **ID-5** | Redis config | Standard + AUTH + TLS at creation (IN5) |
| **ID-6** | Cloud Run sizing per service | IN6 table (gen2 explicit, concurrency explicit, timeouts explicit) |
| **ID-7** | **Sandbox runner = Cloud Run Job per run** (service with concurrency 1 rejected) | IN7 |
| **ID-8** | Edge | Global ALB, 4 hosts, **no CDN**, TLS 1.2 policy, wildcard cert, DNSSEC (IN9) |
| **ID-9** | Cloud Armor | Standard, CRS 4.22 tuned, rate limits, reCAPTCHA, verbose logging off (IN10) |
| **ID-10** | IAM model | per-service SA, custom Vertex role, groups, PAM break-glass, IAM DB login (IN11) |
| **ID-11** | Secrets | global + Mumbai/Delhi replicas, volumes `latest` (IN12) |
| **ID-12** | CI/CD | WIF + SHA-pinned actions + Artifact Analysis gate + Binary Authorization + **Cloud Deploy canary 25/50/100** (IN13) |
| **ID-13** | Migrations | migrator identity + job before promotion, expand/contract (IN14) |
| **ID-14** | Terraform layout | modules + environments, separate state, bootstrap root (IN15) |
| **ID-15** | DR | Delhi runbook incl. Tasks/Doc AI fallbacks; backups in Delhi; `IN` dual-region buckets; automation Later (IN16) |
| **ID-16** | Events | no Eventarc; Pub/Sub India policy for rotation/budgets (IN17) |
| **ID-17** | Quotas | IN18 list raised before launch |
| **ID-18** | Claude infra | IN20 |

## 6. LV-1 / Stage 21
1. GLOBAL Vertex via PGA from Direct-VPC Cloud Run with no NAT (Gemini + Claude + web search) – connectivity test.
2. Cloud Run Job sandbox cold start + per-run isolation (no file leakage between executions); 120 s timeout behaviour.
3. Cloud SQL Connector + IAM auth + asyncpg pool budget under load; `SET LOCAL` tenant context under managed pooling (Phase C rehearsal on staging Plus instance).
4. ALB → Cloud Run SSE 20-min stream + 15 s ping (LV-25) with ingress LB-only.
5. Cloud Deploy canary + repairRolloutRule rollback drill; Binary Authorization block on unsigned image; breakglass audit.
6. Delhi DR drill: restore from asia-south2 backup, deploy images, worker polling dispatch, Gemini OCR fallback – RTO/RPO measured (LV-88 extended).
7. Cloud Armor CRS preview tuning on test traffic (false positives on Tamil/Hindi text, file uploads).
8. Startup within 4 min for Executor with reranker model load (int8 bge) – else lazy load.

## 7. Lawyer list additions
LW-39 Claude GLOBAL processing may include Singapore/US/EU – disclosure text (extends LW-26) · LW-40 Cloud Armor/ALB logs contain IPs + URLs (personal data) – retention + notice.

## 8. Doc-sync debt
- L2 edge: no CDN; SSL policy; hosts list; Armor verbose off.
- L6 async: sandbox = Cloud Run Job per run; no Eventarc; Scheduler TZ.
- L7 data: Connector + IAM auth; pool budget; managed pooling Phase C; `CREATE EXTENSION vector`; pg_textsearch flag; backups asia-south2 count 14.
- L8 platform: projects/folder/policies; subnets; Cloud Deploy canary replaces 10/50/100; Binary Authorization modes; Terraform layout; regional secrets rejected.
- Stage 8 TD-4b: sandbox lifecycle = job execution.
- Stage 9: Delhi has no Document AI → DR degraded OCR.
- Stage 15 ER-7/ER-12: Delhi dispatch fallback.
- Stage 16 SE12/SE17: Assured Workloads not adopted; DR runbook detail.
- Registers: LV-108…115, LW-39…40, N-65 (Cloud Run sizing table), N-66 (pool budget).

## 9. Sources
docs.cloud.google.com: resource-manager hierarchy/projects · organization-policy restrict-locations + constraints · run custom-constraints · logging default-settings · assured-workloads india-data-boundary · run connecting-vpc / vpc-direct-vpc / vpc-connectors / static-outbound-ip / securing ingress / service-to-service / request-timeout / about-concurrency / cpu / memory-limits / http2 / session-affinity / healthchecks / container-contract / containers / task-timeout / execution-environments / sandboxes / rollouts-rollbacks / configure-service-health / service-identity / secrets / max-instances / quotas / locations / release-notes · vpc configure-private-google-access · nat ports-and-addresses · sql private-ip / connect-connectors / iam-authentication / instance-settings / connect-run / release-notes / editions-intro / high-availability / configure-pitr / cross-region-replicas / flags / extensions / pg-textsearch / managed-connection-pooling / iam-roles / iam-logins / backups / restore / locations / quotas · memorystore create-manage / in-transit-encryption / tiers / rdb-snapshots / regions / quotas · tasks creating-http-target-tasks / quotas / queues / locations · scheduler cron / http-target-auth / quotas · eventarc understand-locations · storage bucket-locations / bucket-lock / soft-delete / autoclass / signed-urls / availability-durability / quotas · storage-transfer · load-balancing serverless-neg-concepts / ssl-policies / quotas · cdn overview · armor waf-rules / content-parsing / rate-limiting / bot-management / adaptive-protection / verbose-logging / quotas · certificate-manager dns-auth / best-practices / troubleshooting / release-notes / quotas · dns dnssec-config · iam workload-identity-federation-with-deployment-pipelines / roles-permissions · secret-manager release-notes / choosing-replication / secret-rotation / quotas · kms locations · artifact-registry repo-locations / cleanup-policy · artifact-analysis generate-store-sboms · build locations / build-provenance · binary-authorization run overview / enabling / breakglass / release-notes · deploy canary cloud-run / automation-rules / release-notes · terraform best-practices root-modules / blueprints · document-ai regions / quotas · logging quotas · quotas quota-adjuster · gemini-enterprise-agent-platform locations / partner-models claude (sonnet-5-5, opus-5-5, web-search, batch, quotas) / provisioned-throughput supported-models / standard-paygo / quotas · SLAs: run, sql, memorystore, storage, tasks, compute, vertex-ai · developer.hashicorp.com terraform backend gcs · registry.terraform.io cloud_run_v2_service · docs.github.com oidc / secure-use / artifact-attestations · github.com google-github-actions auth + deploy-cloudrun · alembic cookbook · postgresql.org 18 logging / explicit-locking · sqlalchemy pooling · pgvector · platform.claude.com claude-on-vertex-ai, wif-providers/gcp · product pages (Part A): support.claude.com, help.openai.com, support.google.com, perplexity help-center, trust pages, cloud.google.com/terms/gemini-enterprise/sla, openai subprocessor list.
