# ArcNave – Stage 4 · L7 Data Layer – audit
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01: D1–D28, DB-1–DB-7) · Method: 1 independent auditor (Google Cloud, Postgres, pgvector, OpenAI, MeitY) · Labels: Vendor / Partial / ArcNave rec_

> **Doc-sync 2026-10-03 (Stage 12) – Stage 12 Retrieval (see Stage-12-Retrieval/00-checkpoint-stage12.md):**
> - Extensions: **pg_textsearch (BM25)** + **pg_bigm** (+ pg_trgm, pgvector 0.8.5) on Cloud SQL PG18; separate DB pool/role for retrieval with statement_timeout; HNSW partial index per embed_model; large companies may get partitions; retrieval reads primary (no replica lag); off-peak CONCURRENTLY index builds.


> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - New tables: artifact, artifact_version (Stage 6/8); research_run, research_note, job progress (Stage 10); memory_doc, memory_line, memory_line_source, memory_tombstone, memory_settings (Stage 11) – all with tenant_id + FORCE RLS and deletion-map entries.
> - Page images are NOT stored; rendered on demand from the stored PDF (Stage 9 G49).


> **Doc-sync 2026-10-03 (Stage 15) – see Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md:**
> - DB failover rules ER-6: pool pre_ping + recycle, whole-transaction retry ≤2, per-role timeouts (API 5 s / retrieval 2 s / executor 30 s, lock 2 s, idle-in-tx 30 s), 53300 → 503 + Retry-After; Redis degraded mode thresholds ER-5 (down >5 s → DB polling 2 s).

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - Cloud SQL `ENCRYPTED_ONLY`; pgAudit DDL/ROLE/MISC only; quarterly restore drill with deletion-ledger replay; `legal_hold` per data class (SD-13); CERT-In 180-day logs in India satisfied by asia-south1 buckets; Data Access logs GCS + Secret Manager.

> **Doc-sync 2026-10-03 (Stage 17) – see Stage-17-Observability/00-checkpoint-stage17.md:**
> - Cloud Monitoring storage follows resource location: custom metrics only against regional (asia-south1) Cloud Run resources, never `global`; no personal data in metric labels (OD-7).
> - Postgres flags: `log_parameter_max_length=0`, `log_parameter_max_length_on_error=0`, `log_statement=none`, `log_min_duration_statement=-1`; Query Insights client-address/app-tag OFF. Memorystore `slowlog-log-slower-than=-1`, no MONITOR in prod, opaque key convention `{prefix}:{hash}`.
> - New table `audit_event` (RLS, append-only role, ids-only OWASP fields, daily per-company hash chain) mirrored to `security-audit` log bucket (400 d) + GCS asia-south1 Bucket Lock 1 y (OD-5/OD-6).
> - Google Data Access logs ON for Secret Manager, private GCS, IAM, Cloud SQL admin, Cloud Run admin; **Vertex Data Access OFF**. Ledger columns: `provider_ref_type` + `provider_ref` (nullable), `usage_source` (OD-13).

> **Doc-sync 2026-10-03 (Stage 19) – see Stage-19-Infrastructure/00-checkpoint-stage19.md:**
> - Connectivity: private IP + `sslMode=ENCRYPTED_ONLY` + Cloud SQL Python Connector (asyncpg) with **IAM database authentication** per service role; pool budget per instance API 5+5, Executor 4+2, worker 3+2, Σ ≤ max_connections − 50 (8 GiB → 400), Cloud Run 100 conn/instance; managed connection pooling only Phase C (Enterprise Plus; `max_prepared_statements>0`; verify `SET LOCAL` under transaction mode). Extensions: `CREATE EXTENSION vector` (0.8.5, no Cloud SQL flag), `cloudsql.enable_pg_textsearch` flag (maintenance release R20260712.01_06+). Backups location asia-south2 ×14, PITR 7 d; uploads/derived/artifacts buckets = `IN` dual-region (Mumbai+Delhi); audit bucket Mumbai + copy (ID-4/ID-15).

## Key facts (all official pages loaded unless noted)
- Cloud SQL PG: Enterprise 99.95% (maintenance excluded, few-minute downtime), PITR ≤7 d; Enterprise Plus 99.99%, sub-second maintenance, PITR ≤35 d, Managed Connection Pooling (EP only; transaction mode breaks SET/RESET, PREPARE, LISTEN, session advisory locks). HA = 2 zones sync, failover ~60 s, 2× cost. Cross-region replica async; DR failover EP only. Both editions in asia-south1/asia-south2.
- **Backups default to the nearest multi-region** ("asia" = many Asian countries); custom backup location possible; existing backups don't move; backups fail if org policy disallows region. Backup retention 1–365 (default 7 Ent / 15 EP); log retention ≤ backup retention; final backup kept 30 d after instance delete. WAL in same region.
- Cloud Run → Cloud SQL: 100 connections per instance per DB.
- pgvector 0.8.5 on Cloud SQL (PG13+); pg_trgm, pg_bigm, pg_textsearch (BM25, PG17+). Index limits: vector ≤2,000 dims, halfvec ≤4,000; ef_search 40 can return too few rows with filters; iterative scans 0.8+.
- Postgres snowball has hindi_stem, tamil_stem (PG18 docs); RLS bypassed by owner/superuser/BYPASSRLS unless FORCE; unique/FK checks bypass RLS.
- Firestore vector ≤2,048 dims, flat index, no keyword search. AlloyDB in asia-south1 (ScaNN dims not stated).
- GCS: soft delete ON by default 7 d (7–90), billed; V4 signed URLs ≤7 d; no native malware scan (ClamAV reference design); orgs after 3 May 2024 enforce uniform bucket access.
- CMEK supported: Cloud SQL, AlloyDB, GCS, Memorystore, Cloud Tasks, Logging, Secret Manager, BigQuery, Pub/Sub, Vertex AI. Secret Manager regional secrets in asia-south1; auto-replicated secrets unrestricted.
- **Cloud Logging _Default/_Required buckets are global, location can't be changed later; _Required keeps 400 d.** Trace buckets can be regional.
- Assured Workloads India Data Boundary (free tier): restricts resources to asia-south1/asia-south2, covers Vertex AI too.
- OpenAI Postgres: 1 primary + ~50 replicas, PgBouncer, strict 5-s schema-change timeout, priority isolation, no new tables on main DB. OpenAI offers India data residency at rest (not inference).
- DPDP Rules 2025: security incl. encryption/masking + logs ≥1 year; breach report within 72 h; 48-h notice before erasure (purpose-end erasure); most rules commence 18 months after notification.

## Items
| # | Item | Sev | Comp | Source | Rec |
|---|---|---|---|---|---|
| D1 | **Cloud SQL backups go to multi-region by default (outside India)** → set custom backup location asia-south1 before first backup | Critical | 7.1 | Vendor | MVP |
| D2 | Enterprise maintenance = minutes downtime → IST night window + reconnect/retry | Important | 7.1 | Vendor | MVP |
| D3 | HA failover ~60 s, connections drop → pool pre-ping + retry; executor resume (AS15) | Important | 7.1 | Vendor | MVP |
| D4 | DR replica asia-south2 async; DR failover EP only | Minor | 7.1 | Vendor | Later |
| D5 | **3,072-dim vectors can't be HNSW-indexed** → halfvec(3072) or ≤2,000 dims; dims = embedding version | Critical | 7.2 | Vendor | MVP (dims Stage 12) |
| D6 | **Tenant filter + ANN can silently return too few rows** → iterative_scan, partial index/partition; small scope → exact scan | Critical | 7.2 | Vendor | MVP |
| D7 | Keyword search per language: english/simple, hindi/tamil stemmer custom config, Tanglish → pg_trgm; language tag per chunk; BM25 (PG17) after benchmark | Important | 7.2 | Vendor + ArcNave | MVP |
| D8 | AlloyDB ScaNN dims / Vertex Vector Search price unknown | Minor | 7.2 | — | Later |
| D9 | GCS soft delete adds 7 d; versioning adds more → delete job + soft delete ≤30 d; versioning off | Important | 7.3 | Vendor | MVP |
| D10 | Signed URLs short (minutes), bound content-type/size; resumable session per upload | Important | 7.3 | Vendor | MVP |
| D11 | No native malware scan → ClamAV quarantine flow (unscanned → clean/quarantine); mirror signature DB | Important | 7.3 | Vendor | MVP (DB-6) |
| D12 | One regional bucket per environment, `tenant/<company_id>/…` prefixes enforced in code | Minor | 7.3 | ArcNave rec | MVP |
| D13 | RLS bypass: app role must not own tables; FORCE RLS; cloudsqlsuperuser BYPASSRLS unverified | Critical | 7.4 | Vendor | MVP |
| D14 | Pooling + SET LOCAL behaviour undocumented → tenant_id in every query + RLS; test | Critical | 7.4 | Vendor + ArcNave | MVP |
| D15 | Unique/FK checks bypass RLS → composite keys with tenant_id first | Important | 7.4 | Vendor | MVP |
| D16 | CMEK is per resource, not per company → per-company envelope keys needed for crypto-shredding | Important | 7.5 | ArcNave rec | DB-5 |
| D17 | ~~Regional secrets asia-south1~~ **Corrected by L8 P20:** Cloud Run can't use regional secrets → standard secrets with user-managed replication asia-south1/asia-south2 (auto-replicated secrets go anywhere) | Important | 7.5 | Vendor | MVP |
| D18 | **Rows can't be deleted from backups** → backup 7 d + PITR 7 d so deletion still ≤30 d | Critical | 7.6 | Vendor + ArcNave | MVP (DB-3) |
| D19 | DPDP logs ≥1 year vs erasure ≤30 d → logs hold IDs only, never content | Important | 7.6 | Vendor | MVP |
| D20 | Redis snapshots hold stream content → RDB off (relay only) or short TTL | Minor | 7.6 | ArcNave rec | MVP |
| D21 | **Log buckets default GLOBAL, can't move later** → set org default log location asia-south1 BEFORE creating projects | Critical | 7.7 | Vendor | MVP |
| D22 | Location guard: org policy gcp.resourceLocations (India regions) or Assured Workloads India Data Boundary | Critical | 7.7 | Vendor | MVP (DB-4) |
| D23 | Trace bucket location asia-south1; Error Reporting location unknown → no PII in exceptions | Important | 7.7 | Vendor | MVP |
| D24 | BigQuery dataset location asia-south1 at creation (immutable) | Minor | 7.7 | Partial | Later |
| D25 | Connection budget: Σ(max instances × pool) across 3 deploys < max_connections → cap max instances | Critical | 7.8 | Vendor | MVP |
| D26 | No managed pooler on Enterprise; with EP transaction mode breaks prepared statements → asyncpg statement cache off | Important | 7.8 | Vendor + Partial | MVP |
| D27 | Migrations: lock/statement timeouts, expand/contract, idle-in-transaction timeout | Important | 7.8 | Vendor (OpenAI) | MVP |
| D28 | **Conflict check:** India Data Boundary also covers Vertex AI → may block our Vertex GLOBAL endpoint + Claude (C3). Must not break model calls | Critical | 7.7 | ArcNave rec (cross-layer) | DB-4 / LV-1 |

## Decisions
| ID | Question | Rec |
|---|---|---|
| DB-1 | Primary DB | Cloud SQL PostgreSQL 17, Enterprise, HA, asia-south1; move to Enterprise Plus when pooling / zero-downtime maintenance needed |
| DB-2 | Vector + keyword | pgvector in same DB (halfvec or ≤2,000 dims, iterative scan) + Postgres FTS + pg_trgm; Vertex Vector Search not MVP |
| DB-3 | Backups | Custom location asia-south1; 7-day backups + 7-day PITR (deletion stays ≤30 d) |
| DB-4 | Residency guard | Org policy gcp.resourceLocations = asia-south1/asia-south2 + org default log location asia-south1 before projects exist; Assured Workloads boundary only after LV-1 confirms Vertex global still works |
| DB-5 | Extra encryption | MVP: Google default + secrets per PL-5 (user-managed replication asia-south1/2); per-company envelope keys / CMEK later (on customer demand) |
| DB-6 | Malware scan | ClamAV quarantine flow in MVP |
| DB-7 | Tenancy | tenant_id in every table/query + FORCE RLS, app role not owner, composite unique keys |
