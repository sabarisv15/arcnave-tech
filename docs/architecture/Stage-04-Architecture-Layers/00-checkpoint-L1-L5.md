# ArcNave – Checkpoint (Stages 1–3 + Stage 4 L1–L5) · 2026-10-01

## Lock status
| Item | Status |
|---|---|
| Stage 1 Requirements | LOCKED |
| Stage 2 High-level | LOCKED (needs sync: 3 deploys) |
| Stage 3 Lifecycle | LOCKED (needs sync: turn runs in Turn Executor) |
| L1 Client | LOCKED (needs sync: new UI states) |
| L2 Edge | LOCKED |
| L3 API | LOCKED (needs sync: memory + admin-instructions endpoints) |
| L4 Orchestration | LOCKED |
| L5 Gateway / Context / Retrieval | LOCKED |
| L5 Memory / Tools / Speech / Safety | CONTRACT ONLY – full audit pending |
| L6 Async · L7 Data · L8 Platform | NOT STARTED |

## Pending decisions (need answer now)
1. Stage 1 assumptions A1–A6 never explicitly confirmed (multi-tenant isolation, admin+user roles, "fast reply" definition, peak 3–5×, mic = speech-to-text only, memory per user inside company)
2. L-4 contextual retrieval in MVP? (rec: build slot, switch on after test)
3. L-5 input safety mode (rec: cheap rules blocking + model checks parallel)
4. L-3 Redis from day 1 (now required by G51/G52/P2) – confirm
5. S-2 Gemini safety thresholds BLOCK_MEDIUM_AND_ABOVE

## Deferred decisions (stage mapped)
E-5 country block (after launch) · A-3 rate-limit numbers (18) · V-1 grounding engine (13) · SF-1 Model Armor (16) · RT-2 RAG Engine vs own (12) · web search / tools list / sandbox (8) · model per role M2–M11 (6,7,9,11,12,16) · memory design (11) · cost (18, at the end)

## Doc sync debt
- 02: 3 deploys (API, Turn Executor, Worker)
- 03: Phase 4 runs in Turn Executor via Cloud Tasks; API relays from Redis
- L1: UI states → retract, model auto-switch note (PE-2), low-confidence note (V-2), rate-limit remaining (L3-G4), memory controls (M2), company instructions (admin, CI-1)
- L3: endpoints → /memory (list/edit/delete/disable/delete-all), /admin/instructions
- Copy local files to D:\Architecture: 04-L4-final-lock, 04-L5a/b/c, this checkpoint

## To verify (before build)
V2 promo credit expiry · Claude drop_block beta on Vertex · task budgets on Vertex · Cloud Tasks dispatch latency · Agent Engine sandbox price/stage · D-1 (does disabling Google in-memory cache remove implicit cache discount) · Gemini 3.8 Flash knowledge cutoff · cheaper Flash-Lite availability · Vertex quotas for our 3 models + embeddings
