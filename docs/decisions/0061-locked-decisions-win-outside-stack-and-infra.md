# ADR-0061: Locked stage decisions win everywhere except tech stack and infra

- Status: accepted (owner rule, 2026-10-15)
- Date: 2026-10-15
- Task: tech-audit.A
- Supersedes in part: [ADR-0053](0053-prototype-base-and-target-spec.md) Decision 2, second sentence
  only ("Where this repo already does the job differently and well, the repo wins for the
  prototype and an ADR records the difference"). ADR-0053 is not edited; its other decisions stand.
- Relates to: build plan `docs/architecture/00-Handoff/00-build-plan-arcnave-tech.md` B-2 (same
  sentence, same supersession); the audit under [`docs/ops/audit/`](../ops/audit/SUMMARY.md).

## Context

ADR-0053 made this repo the build base and the 21 stage checkpoints the target spec, with one
escape hatch: where the repo already did a job "differently and well", the repo won for the
prototype. The owner reports three problems with the product as it stands: file handling is very
poor, AI output is very poor, and the architecture has many flaws. "Repo wins" let each of those
stay as it was whenever an ADR described the difference, and three planned ADRs (0056 typed
errors kept over RFC 9457, 0057 repo prompt kept over policy-spec v3, 0058 compaction kept) were
meant to rest on it. The repo is private and has no real users, so rewriting or discarding code
costs time, not users.

## Decision

1. **The repo must match every locked stage decision 100 %, except tech stack and infra.**
   - *Tech stack* = language, framework and library choices the Python design named (Python →
     Node 22, FastAPI → Fastify 5, SQLAlchemy/Alembic → Drizzle, pytest → vitest, Python SDKs →
     their Node equivalents). A difference that is only the stack is recorded as DIFF-STACK and
     needs no change.
   - *Infra* = Terraform, Cloud Tasks, Redis and the Cloud Run service layout. A difference that is
     only infra is DIFF-INFRA.
2. **"Repo wins" is withdrawn** outside those two. Where the repo differs from a locked decision,
   the decision's **outcome** must be met. **How** it is met is chosen by safety first, then least
   time; rewriting or discarding existing code is allowed.
3. A locked decision is the latest doc-sync line in the stage checkpoint mirror under
   `docs/architecture/`; older lines it replaces are superseded and are not built.
4. The other ADR-0053 decisions are owner decisions, not "repo wins", and stand: single user
   first (3), three models (4), Claude first-party API (5), per-company Claude switch dropped (6),
   Phase 5 deferral of residency / NO_CONTENT enforce / Terraform / OTel / Redis / Cloud Tasks (7),
   workflow and branch rules (8–11). Where one of them conflicts with a locked stage decision
   (for example decision 4 "three models only" against the Haiku 5.5 router and worker jobs), the
   conflict goes to the owner as a question; no task resolves it on its own.
5. Planned ADRs that rested on "repo wins" (0056 typed errors kept, 0057 repo prompt kept, 0058
   compaction kept, as listed in ADR-0053's Consequences) are **not** accepted by default. Each is
   either written as an owner-approved deviation with its own ADR, or the locked outcome is built.
   (The numbers 0056 and 0057 were since used for Google sign-in and brand surfaces.)

## Consequences

- `docs/ops/audit/` holds the conformance audit of Stages 1–21 against the repo (per-stage
  buckets KEEP / REWRITE / NEW-BUILD / DISCARD / DIFF-STACK / DIFF-INFRA, owner-deferred items in
  `DEFERRED.md`) and `NEW-PLAN.md`, a proposed build/rewrite order. The owner decides the plan.
- Task briefs cite the locked decision id they satisfy; "the repo already does it differently"
  is no longer a reason to skip one.
- The invariants in `CLAUDE.md`, the Tanglish rule and the "Claude is the reference" rule are
  unchanged. Where the reference rule and a locked decision disagree, stop and ask the owner
  (as ADR-0053 already says).
