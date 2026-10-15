# ArcNave – Stage 5.3 · Data lifecycle
_2026-10-01 · Status: **LOCKED** (LD-1–LD-4 OK) · STAGE 5 COMPLETE · Summary of where each data type lives, how long, and how it is removed (all from locked decisions)_

| Data | Where | Kept until | Removed by |
|---|---|---|---|
| Chats, messages, message text, raw model blocks, citations, summaries, feedback text | Cloud SQL (Mumbai) | User/admin delete or company auto-retention (DM-10) | F8 cascade ≤23 d + backups → ≤30 d |
| Uploaded files + parsed text + page images | GCS (Mumbai) | With chat / project (reference count) | Cascade + GCS soft delete 7 d |
| Search pieces + embeddings | Cloud SQL | With their file | Cascade |
| Unfinished uploads | GCS + DB row | ~24 h | Sweeper (DF-4) |
| Mic audio | Temporary | Until transcript done (minutes) | Deleted right after (SPD-2) |
| Memories | Cloud SQL | User delete / expiry / source chat delete / admin OFF | F7/F8 |
| Share snapshots | Cloud SQL | Revoke / chat delete / admin turns sharing off | Immediate 404 + cascade |
| Stream buffer | Redis | ~15 min after answer done | TTL (SD-3) |
| Locks, rate-limit counters | Redis | Seconds–minutes | TTL |
| Idempotency keys | Cloud SQL | 24 h | Daily cleanup |
| Jobs / outbox rows | Cloud SQL | 30 d after finish (LD-1) | Daily cleanup |
| Usage / billing ledger (IDs, tokens, ₹ – no content) | Cloud SQL (monthly partitions) | Legal period (lawyer – XD-4) | Drop old partitions |
| Audit log (IDs + codes, no content) | Cloud SQL (monthly partitions) | ≥1 year (DPDP Rule 6 logs) (LD-2) | Drop old partitions |
| Safety review items | Cloud SQL | Content ≤30 d, then IDs/codes only (LD-3) | Daily job |
| Auth: password hash, sessions, invites, email/password-reset tokens | Cloud SQL | Account life; sessions/tokens short expiry | Expiry + account delete |
| Deletion ledger | Separate GCS log (Mumbai) | 1 year (LD-4) | Lifecycle rule |
| DB backups / PITR | Cloud SQL backups (Mumbai) | 7 d + 7 d | Automatic |
| Cloud Logging | asia-south1 log buckets | _Default 30 d (IDs only); _Required 400 d (admin activity, fixed) | Automatic |
| Provider transient copies | Google/Anthropic (Vertex) | Claude prompt cache ≤1 h; Google grounding logs ≤3 d; Google short in-memory cache | Provider side – disclosed in privacy policy |
| Cloud Tasks payloads | Cloud Tasks | Until task done (IDs only, no content) | Automatic |
| Whole company (offboarding) | All of the above | Export first (DM-12) | Full purge ≤30 d |
| Legal hold (DPDP Rule 8(3), if lawyer says) | Restricted store | 1 year | Switch DF-6 |

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - Legal hold (DPDP Rule 8(3)) = per data class switch, OFF until lawyer confirms; CERT-In 180-day ICT logs in India (ids-only buckets asia-south1).

## Decisions
| ID | Question | Rec |
|---|---|---|
| LD-1 | Jobs/outbox rows | Purge 30 d after finish |
| LD-2 | Audit log | Keep ≥1 year (IDs only) |
| LD-3 | Safety review content | Content ≤30 d, then codes only |
| LD-4 | Deletion ledger | Keep 1 year |

## Doc-sync 2026-10-08 (owner decision B1 – audit rows on company offboarding)
- **B1 (owner, 2026-10-08):** on company offboarding the full purge (≤ 30 d) covers every customer-content and personal-data table, **except `audit_event`**: its rows are pseudonymous (ids, codes, caller-computed HMAC hashes – no names, e-mails, IPs or content) and are kept for **≥ 1 year (LD-2)** for security investigation, then dropped with their monthly partition. The deletion ledger records that the company's audit rows remain until their partition ages out. Lawyer confirmation: **LW-48**.
