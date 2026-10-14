# ArcNave – Postgres provider comparison (DB-1 re-check)
_2026-10-01 · Source: GPT Astra (official docs/pricing) + Cloud SQL Mumbai rates from L7 audit (cloud.google.com/sql/pricing: Enterprise vCPU $0.0413/h, GiB $0.007/h; HA = 2×) · 730 h/month · storage extra_

| | Cloud SQL Enterprise | Aiven (GCP Mumbai) | Supabase (AWS Mumbai) | DigitalOcean (BLR1) | Neon | Self-managed VM |
|---|---|---|---|---|---|---|
| India region | ✅ Mumbai | ✅ Mumbai | ✅ Mumbai | ✅ Bangalore | ❌ none | ✅ Mumbai |
| Backups + PITR in India | ✅ (custom location) | ✅ (service region) | ❓ not documented | ❓ not documented | ❌ | ✅ if we build it |
| pgvector ≥0.8 | ✅ 0.8.5 | ✅ 0.8.6 | ❓ | ❓ | ✅ | ✅ |
| Private network from Cloud Run | ✅ private IP | ✅ VPC peering | ❌ (AWS PrivateLink only) | ❌ public + IP allowlist | ❌ | ✅ |
| Small, no HA / month | **≈$49** (1 vCPU/3.75 GB) + storage | $84.68 (1 vCPU/4 GB/80 GB) | ≈$130 (with PITR) | $30 (2 GB) | $23 (not India) | cheapest, unpriced |
| Small, HA / month | **≈$99** + storage | $219.73 | not documented | $60 now; new HA clusters restricted from Nov 2026 → Advanced $260 (no pg_trgm) | — | build ourselves |
| Pooler | ❌ (app pooling) | ✅ PgBouncer | ✅ Supavisor | ✅ PgBouncer | ✅ | install |
| SLA | 99.95% (HA only) | 99.99% | 99.9% Enterprise only | 99.95% standby | — | VM 99.9% only |

## Verdict
Cloud SQL Enterprise small tier is the cheapest option that meets all hard rules (India backups, private network, pgvector). "Expensive" applies to Enterprise Plus (~$370) / AlloyDB, not Enterprise. Outside options either fail residency (Neon), can't prove India backups (Supabase, DigitalOcean), lack private networking from Google Cloud, or cost more (Aiven).

## Decisions
- DB-1a: Keep Cloud SQL PostgreSQL **Enterprise** (not Plus), asia-south1.
- DB-1b: Start **without HA (~$49 + storage)** in early MVP; turn HA on (~$99) before first paying customer go-live (one setting change + restart). ← user decision
- DB-1c: PostgreSQL **18** (Cloud SQL default; pgvector 0.8.5 on PG13+; native uuidv7) – confirm pg_partman/pg_cron on PG18 in LV-1; fallback PG17 + app UUIDv7.
