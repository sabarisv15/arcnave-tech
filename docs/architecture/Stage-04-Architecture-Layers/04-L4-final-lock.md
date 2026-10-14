# ArcNave – Stage 4 · L4 Orchestration – FINAL LOCK
_2026-10-01 · Status: LOCKED_

## Accepted (user)
- Components 1–12 (04-L4-orchestration-layer.md)
- G1–G49, C1–C34 (Claude), P1–P8 (Policy), V1–V8 (Validator), G50–G63 (runtime / distributed / concurrent-action / cache stampede)
- O-1 own thin Python runner · O-2 profiles Fast/Normal/Deep (1–2/5/15 steps, 10 min) · **O-3 CHANGED → 3 deploys: API service (relay) + Turn Executor (Cloud Tasks) + Background worker**
- PE-1..3, V-1, V-2 as recommended

## Coverage proof
- 12/12 components have a contract and gap coverage
- 10 dimensions audited: flow, model behaviour, runtime platform, multi-server coordination, concurrent user/admin actions, data consistency, security, cost/limits, observability, deploy/test → all ✅
- Evidence: Anthropic (high), Google Gemini/Vertex/Cloud Run (high), OpenAI (medium-high), Perplexity (medium), real-product evidence (Anthropic cloud sessions, OpenAI background mode + Postgres blog, observed claude.ai/ChatGPT behaviour)

## Known open items (do NOT change the design; values / verification only)
1. Numbers: concurrency, timeouts, retry counts, rate limits → load tests (Stage 15/18)
2. Undocumented provider behaviour → provider conformance tests (G35)
3. To verify on Vertex: Claude `drop_block` beta, task budgets, Cloud Tasks dispatch latency, Agent Engine sandbox price/stage
4. Re-check vendor docs before build (prices, betas change)
5. Later features (Research multi-agent, side-effect tools + approvals) plug into existing slots (G10, G20, G40)
