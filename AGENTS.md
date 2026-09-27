# ArcNave — rules for coding agents (Antigravity, Claude Code, others)

`CLAUDE.md` is the full rulebook and applies to every agent, whatever its name. This file
repeats the parts an agent must never miss, because some tools read only `AGENTS.md`.

## Read first, in this order

1. `mistakes.md`: what already went wrong here. Do not repeat an entry.
2. `docs/checkpoints/CURRENT.md`: where the work stands.
3. The work package you were given (for UI parity: `docs/handover/2026-09-26-claude-ui-parity-plan.md`).
4. The ADRs in `docs/decisions/` that the work package names.

## Stack

React 19 + Vite frontend (`arcnave-frontend/`), Node 22 + Fastify 5 backend (`backend/`),
PostgreSQL 16 with Drizzle, Vertex AI models. Tests use Vitest.

## Invariants (never break these)

1. Never substitute silently. If a model, capability or source is unavailable, say so with a
   machine-readable reason.
2. Null is not zero. `costUsd: null` means "no verified price"; `0` means "free".
3. Exact means exact. Token counts come from provider metadata or are `exact: false`.
4. BM25 is not semantic search. Never describe retrieval as semantic.
5. Errors are typed. Every client-visible failure is an `ApiError` with a stable `code`; the
   frontend switches on `code`, never on the message text.
6. No secret is ever committed. No keys, no service-account JSON, no `.env` files.
7. ArcNave is its own brand. Launch files never describe ArcNave as following another assistant;
   provider names only where the code talks to that provider (ADR-0044).

## How to work

- Claude is the reference for every change (fix, bug, gap, feature, add, remove, downgrade,
  upgrade): find how Claude does it from a source, compare, match it, and record any deliberate
  difference in the ADR. Asked why ArcNave does something: Claude does X, ArcNave does Y, the
  gap, the fix. See `.claude/rules/claude-reference.md`. Launch files stay brand-neutral
  (Invariant 7 in `CLAUDE.md`).
- Work on one work package at a time, on its own branch, in its own conversation.
- Plan first. Produce an implementation plan and task list before editing code, and wait for
  the user's review when the work package says "ADR required".
- Read the files the work package names before changing them. Match the surrounding code's
  naming, comment density and idiom. Comments say why, not what.
- A decision changes only when its ADR changes, in the same commit. Supersede ADRs; never
  rewrite them.
- Tests must never call a real model provider. Use the fakes in `backend/src/test/harness.ts`.
- A schema change needs a migration generated with `npm run db:generate` (check its timestamp
  is later than every existing one, see `mistakes.md`), and `npm run openapi` after any route
  schema change, with `docs/openapi.json` committed.
- Do not add a dependency without saying why in the commit message. Prefer packages already
  in `package.json`.

## Verify before you say it is done

Run each of these and read the output. A green typecheck is not a passing test, and a passing
test is not a working screen.

```bash
cd backend && npx tsc --noEmit && npx vitest run
cd arcnave-frontend && npm run build && npm test
```

Then start the stack locally (`docker compose up --build`, or `npm run dev` in both folders)
and check the feature in the browser. Record a screenshot or recording of every acceptance
check in the walkthrough.

## Never do these

- Never deploy. Live deployment needs the user's explicit approval in the current task.
- Never use `gcloud run services update --set-env-vars`; only `--update-env-vars`, and only
  when the user asks.
- Never push to `main`. Never force-push a branch someone else owns.
- Never skip, delete or weaken a test to make the suite pass.
- Never commit user documents, test chats, or anything under `backend/var/`.

## Before you finish

1. Both suites and both builds clean.
2. Add anything you got wrong to `mistakes.md` (symptom, cause, rule, how to verify). Keep it at
   40 entries or fewer.
3. Update `docs/checkpoints/CURRENT.md` and tick the work package's checklist in the plan.
4. Explain what you did to the user in simple Tanglish (Tamil and English in Latin letters).
