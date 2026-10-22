# ArcNave

**ArcNave** is an open-source AI research workspace: a chat-first web app where you work with large language models, upload and read files, generate artifacts (documents, spreadsheets, slides, visuals), run code in a sandbox, and see exactly what every model call cost.

> **Status:** active development, single-user. Multi-user / company features are planned for a later phase.

## Why ArcNave is different

ArcNave is built around a few rules that are enforced in code and tests, not just documented:

1. **No silent substitution.** If a model, capability or source is unavailable, ArcNave says so with a machine-readable reason instead of quietly using something else.
2. **Null is not zero.** `costUsd: null` means "no verified price for this model"; `0` means "this cost nothing".
3. **Exact means exact.** Token counts come from provider metadata, or they are marked `exact: false`. There is no estimator.
4. **Retrieval is lexical (BM25), not semantic.** The docs and UI never claim otherwise.
5. **Typed errors.** Every client-visible failure is an `ApiError` with a stable `code`; the frontend switches on the code, never on message text.
6. **No secrets in the repo.** Credentials come from environment variables or Application Default Credentials. No key files are ever committed.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, React Router, Radix UI, Recharts, Mermaid, KaTeX |
| Backend | Node.js 22, Fastify 5, TypeScript, Zod, Swagger / OpenAPI |
| Database | PostgreSQL 16 with Drizzle ORM |
| Models | Claude (Sonnet, Opus) through the Claude API, Gemini through Vertex AI |
| Storage | Local volume, or Google Cloud Storage |
| Tests | Vitest (about 1,500 backend tests; providers are always faked, tests never spend provider quota) |
| Deploy | Docker Compose for local / self-hosting; Cloud Run (backend) and Cloudflare (frontend) for the hosted setup |

## Repository layout

```text
arcnave-frontend/   React + Vite web app
backend/            Fastify API
  src/                routes, services, providers, tools, plugins, db, config
  skills/             skill definitions
  sandbox/            code-execution sandbox
  prompts/            versioned system prompts
  drizzle/            database migrations
  evals/              prompt evaluations
docs/               architecture, ADRs (decisions), checkpoints, ops, openapi.json
tools/              helper tooling
compose.yaml        whole stack: Postgres + backend + frontend (nginx)
.env.example        environment template
CLAUDE.md, AGENTS.md  rules for contributors and coding agents
mistakes.md         log of past mistakes, so they are not repeated
```

## Quick start (Docker Compose)

Requirements: Docker with Compose.

```bash
git clone https://github.com/sabarisv15/arcnave-tech.git
cd arcnave-tech

cp .env.example .env
# Fill in POSTGRES_PASSWORD and COOKIE_SECRET (32+ characters):
#   openssl rand -base64 48

# For a plain-HTTP localhost trial, also set in .env:
#   NODE_ENV=development
#   SESSION_COOKIE_SECURE=false

docker compose up --build
```

Then open <http://localhost:8080>. Only the frontend publishes a port; nginx proxies `/v1` to the backend on the internal network.

> Without `SESSION_COOKIE_SECURE=false` the browser drops the Secure cookie over `http://`, and you will be signed out right after registering. Do not use these development settings in a real deployment.

## Connecting models

ArcNave runs without any model configured, and reports each model as unavailable with the reason. To enable them, set these in `.env`:

| Provider | Variables |
| --- | --- |
| Claude | `ANTHROPIC_API_KEY`, optionally `MODEL_SONNET`, `MODEL_OPUS` |
| Gemini (Vertex AI) | `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION`, `MODEL_GEMINI_FLASH`; credentials via Application Default Credentials |
| Cost tracking | `PRICING_TABLE`, `PRICING_INR_PER_USD` (a model with no price entry reports cost as `null`) |
| Web search | `ENABLE_GOOGLE_SEARCH_GROUNDING`, `ENABLE_ANTHROPIC_WEB_SEARCH` |

Never commit `.env` or any API key. For Vertex locally, run `gcloud auth application-default login` and uncomment the credentials mount in `compose.yaml`.

## Local development

Requirements: Node.js 22+, PostgreSQL 16 (or Docker).

```bash
# Backend (http://localhost:8080, Swagger UI at /docs)
cd backend
cp ../.env.example .env      # npm run dev reads backend/.env
npm install
npm run db:migrate
npm run dev

# Frontend
cd arcnave-frontend
npm install
npm run dev
```

Note that `docker compose` reads `./.env` and `npm run dev` reads `./backend/.env`; a value set in one does not reach the other.

## Tests and checks

```bash
# Backend
cd backend
npx tsc --noEmit
npx vitest run          # integration tests need PostgreSQL
npm run openapi         # regenerate docs/openapi.json after any route schema change

# Frontend
cd arcnave-frontend
npm run build
npm test
```

## Contributing

Contributions are welcome. Before you write code:

1. Read [`mistakes.md`](mistakes.md), the log of what has already gone wrong here.
2. Read [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) for the invariants and workflow.
3. Check [`docs/checkpoints/CURRENT.md`](docs/checkpoints/CURRENT.md) for where the work stands, and [`docs/decisions/`](docs/decisions/) for why things are the way they are.

Ground rules: work on a branch and open a pull request (never push to `main`, since `main` is what gets deployed); keep `tsc` and the test suites clean; never weaken or delete a test to make it pass; supersede ADRs rather than rewriting them.

## Documentation

- [Architecture and stage checkpoints](docs/architecture/)
- [Architecture decision records](docs/decisions/)
- [OpenAPI spec](docs/openapi.json)
- [Deployment notes](docs/deploy/)

## License

No license file has been added to this repository yet. Until one is added, the default copyright rules apply. The maintainer should choose and add a `LICENSE` file (for example MIT or Apache-2.0).
