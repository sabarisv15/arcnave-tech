# ArcNave

React 19 + Vite frontend, Node 22 + Fastify 5 backend, PostgreSQL 16, Vertex AI.

**Read [`mistakes.md`](mistakes.md) before writing code, and add to it before you finish.**
It is the log of what has already gone wrong here. Every entry cost a debugging session; none
of them should cost a second one.

Then read [`docs/checkpoints/CURRENT.md`](docs/checkpoints/CURRENT.md) for where the work
stands, and [`docs/decisions/`](docs/decisions/) for why the shape is what it is.

---

## Invariants

These are not style preferences. Each one exists because the alternative ships a lie to a user.

1. **Never substitute silently.** If a model, capability, or source is unavailable, say so with
   a machine-readable reason. Do not fall back to a different model and present it as the one
   asked for. [ADR-0002](docs/decisions/0002-model-aliases.md).
2. **Null is not zero.** `costUsd: null` means "no verified price for this model". `0` means
   "this cost nothing". They render differently and must never collapse.
3. **Exact means exact.** Token counts come from provider metadata or they are `exact: false`
   with zeros. There is no estimator in this codebase and there must not be one.
4. **BM25 is not semantic search.** Retrieval is lexical. Do not describe it as semantic, and
   do not add an `embedding` column we cannot search.
5. **Errors are typed.** Every client-visible failure is an `ApiError` with a stable `code`.
   The frontend switches on `code`, never on prose.
6. **No secret is ever committed.** Credentials come from Application Default Credentials —
   workload identity on GCP, `gcloud auth application-default login` locally. No service
   account key is written to a file in this repo, pasted into a config, or baked into an image.
7. **ArcNave is its own brand.** Launch files (`backend/src` outside tests and scripts,
   `backend/skills`, `backend/sandbox`, `arcnave-frontend/src`) never describe ArcNave as
   following another assistant ("as Claude does"). Provider names appear only where the code
   talks to that provider. Reference files (`docs/`, `tools/`, tests) may name anything.
   [ADR-0044](docs/decisions/0044-pdf-reading-and-exact-figures.md).

## Commands

```bash
# Backend
cd backend
npm run dev            # :8080, Swagger UI at /docs
npx tsc --noEmit       # must be clean before any commit
npx vitest run         # 167 tests; needs Postgres for the integration files
npm run openapi        # regenerate docs/openapi.json — run after any schema change
npm run db:migrate

# Frontend
cd arcnave-frontend
npm run build          # tsc -b && vite build
npm test

# Whole stack
cp .env.example .env   # fill in POSTGRES_PASSWORD and COOKIE_SECRET
docker compose up --build
```

**Environment files live in two places, by design.** `docker compose` reads `./.env`;
`npm run dev` reads `./backend/.env` via `--env-file-if-exists`. Same variable names, one
template (`.env.example`), but a value set in one does not reach the other. Neither is
committed.

Postgres for local development runs as a container named `arcnave-pg`:

```bash
docker start arcnave-pg
```

## Rules for changing this codebase

- **Verify before claiming.** Run the command and read the output. A green typecheck is not a
  passing test, a passing test is not a running server, and a Dockerfile that builds is not a
  program that starts — `mistakes.md` has an entry for each of those.
- **Local first, production second.** Every code or configuration change must be tested in the
  local environment before deployment. Run the applicable local typechecks, tests, builds, and
  smoke checks; inspect their output; fix failures; and only then request deployment approval.
  **Live deployment always requires the user's explicit approval in the current task**; never
  infer approval from an earlier deployment or from a general request to make changes. Never use
  a live deployment as the first test. This rule applies to every worker, including Antigravity,
  Claude, and parallel/automated agents. After approval and deployment, perform a separate live
  verification.
- **Never write a validator for a value you have not traced to its consumer.** An enum at an
  API boundary is a promise the system acts on that value.
- **A transaction is not a lock.** Serialising writers needs `FOR UPDATE`, or a unique
  constraint plus a retry. Not a bare `SELECT max(...)`.
- **Tests must never reach a provider.** Providers are injected through the service container;
  `src/test/harness.ts` supplies fakes. Nothing in the suite may spend Vertex quota.
- **A decision is not changed until the document recording it is changed**, in the same commit.
  ADRs are superseded, not rewritten — the record of what was decided has value even when the
  decision was reversed.
- **Comments state why, not what.** And a comment that asserts a guarantee needs a test that
  fails when the guarantee stops holding.
- **Response style (Tanglish):** After every execution or task, always explain what was done in simple, clear Tanglish (Tamil + English in Latin script).

## Before you finish a task

1. `npx tsc --noEmit` and `npx vitest run` both clean.
2. If a route schema changed, `npm run openapi` and commit `docs/openapi.json`.
3. **Add anything you got wrong to [`mistakes.md`](mistakes.md)** — symptom, cause, rule,
   and how to verify. Prune if it is over 40 entries. This step is skipped exactly when
   context is tightest and the lesson is most valuable, so do it deliberately.
4. Update `docs/checkpoints/CURRENT.md` if the state of the work moved.
5. In your response to the user, explain what was done in simple Tanglish.
