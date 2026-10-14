# ADR-0053: This repo is the prototype base; the 21-stage architecture is the target spec

- Status: accepted
- Date: 2026-10-14
- Relates to: ADR-0001 (Python stack, superseded by ADR-0003), ADR-0002 (model aliases), ADR-0050 (turn log). Amended by ADR-0054…0060 as those tasks land (list below).

## Context

ArcNave had two codebases on 2026-10-14:

1. **This repo** (`sabarisv15/arcnave-tech`): Node 22 / Fastify 5 / Drizzle / Postgres 16 / React 19 + Vite / warm Python sandbox on Cloud Run (asia-south1). A working single-user product: detached runs with SSE replay, a 16-round tool loop, artifacts and display cards, Markdown memory with six tools, projects with BM25 search, share links, data export; 52 ADRs, ~900 backend and 195 frontend tests. Live today with Gemini 3.8 Flash only (`providers/registry.ts` disables the Claude and gpt-oss aliases outside tests).
2. **A Python build** (`sabarisv42/arcnave.in`): Python 3.13 / FastAPI / SQLAlchemy / Terraform, built from a 21-stage architecture (requirements → implementation plan, with numbered decisions, a numbers register N-xx, an LV-1 live-test register and a cost log). It reached Phase 0 (infra, CI) and Phase 1 tasks 1.1–1.14 (gateway, ledger, auth skeleton) — foundation, no product surface yet.

A gap audit of the 21 stages against this repo (owner's Architecture folder, `00-Handoff/00-build-plan-arcnave-tech.md`) found: 8 stages already satisfied here, 4 needing a port from the Python design, 5 that are company-phase work, 6 that need a decision. Reaching this repo's feature level on the Python build was estimated at 2–3 months; adopting this repo and closing the gaps at 2–3 weeks to a locally stable product.

## Decision

1. **This repo is the build base.** The Python build is archived as reference; its Terraform, CI shape, gateway design and numbers wiring are ported here when their phase comes, not rewritten.
2. **The 21 stage checkpoints are the target spec.** They live as a read-only mirror under `docs/architecture/` (edit in the owner's Architecture folder, never here). Decision ids (TD-1c, VD-6, N-10 …) are cited in briefs and ADRs. Where this repo already does the job differently and well, the repo wins for the prototype and an ADR records the difference.
3. **Single user first.** No company/tenant tables, roles, RLS, pooled budgets or admin panel until the product is locally stable; all of that is Phase 5 of the build plan.
4. **Three models only:** Gemini 3.8 Flash, Claude Sonnet 5.5, Claude Opus 5.5. The gpt-oss alias is removed (ADR-0055).
5. **Claude through the first-party Claude API**, not Vertex (ADR-0054). SDK retries stay 0; retries live only in the app gateway per the Stage 15 matrix.
6. The per-company Claude ON/OFF switch from Stage 1 (C1) is **dropped**. Per-user token budgets (already here) are the only cap for now.
7. Data residency controls, NO_CONTENT logging (Stage 17), Terraform, OpenTelemetry, Redis and a Cloud Tasks executor are **applied in Phase 5**, when the product is stable — not during the prototype. `turn_logs` (ADR-0050) stays until then.
8. **Workflow:** the reviewer (Claude) writes each task prompt naming the model per item; the work runs in a Claude cloud session on a branch, is pushed, and the owner pulls locally. Opus 5.5 for high-risk items (gateway, auth, DB, executor, layout refactor), Sonnet 5.5 for the rest, Haiku 5.5 only as a test runner. Every report names the models actually used.
9. **Branch-only work.** A push to `main` runs the Cloud Build trigger and deploys. Nobody pushes to `main`; a PR merge is a deploy and is the owner's call, only after the local-stable gate.
10. **Phase order, not stage order.** Per phase: compare the phase's scope with the repo → build or rewrite the gaps → phase exit → next phase. Stage conformance is checked inside the task that touches that stage.
11. **Gate before any dev run or Terraform apply = "local stable":** the AI answers user questions correctly locally, picks the right tools and skills, and the academic (campus) use cases have been iterated and checked. One dev run and one Terraform apply per three phases.

## Consequences

- Repo `CLAUDE.md` gains a "Build rules on this base" section (branch rule, model policy, numbers register, forbidden patterns, logging target, brief location). The seven invariants and the Tanglish rule are unchanged.
- `.github/workflows/ci.yml` runs typecheck + tests for backend and frontend on PRs and non-main branches; the owner sets branch protection on `main` to require both checks.
- Task briefs live in `docs/architecture/build-tasks/tech-pX.Y.md`; one commit and one push per task; the session does not wait for CI (the owner reads it).
- From Task tech-p1.A onward no new literal is written for a value that has an N-id in `docs/architecture/00-Handoff/00-numbers-register.md`; it is read from settings/config with the N-id in a comment.
- ADRs that follow from this one: 0054 Claude first-party API · 0055 three models · 0056 typed `ApiError` kept over RFC 9457 · 0057 repo system prompt kept, prompt test kit ports onto it · 0058 compaction kept for the prototype · 0059 retrieval (BM25 now, hybrid decided at Phase 2 exit) · 0060 frontend hosting.
- The "Claude is the reference for every change" rule (`.claude/rules/claude-reference.md`) still applies to product behaviour; the stage checkpoints add the ArcNave-specific decisions on top of it (tenancy, budgets, India, numbers). Where the two disagree, stop and ask the owner.
