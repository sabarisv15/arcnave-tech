# ADR-0003: Node 22 / TypeScript / Fastify / Drizzle for the ArcNave backend

- Status: accepted
- Date: 2026-09-17
- Amended by: [ADR-0054](0054-claude-first-party-api.md) (Claude via the first-party API, not Vertex)
- Supersedes: [ADR-0001](0001-stack.md)

## Context

[ADR-0001](0001-stack.md) chose Python 3.12 + FastAPI + SQLAlchemy. The product owner reversed
that the same day, before implementation, and asked for Node and TypeScript. This ADR records
what was actually built and why it holds up — not a retroactive justification.

The frontend is React 19 + Vite + TypeScript. The backend has to talk to Vertex AI (Gemini and
Anthropic partner models), stream generations with real cancellation, own persistence, and
account for tokens exactly.

## Decision

Node 22 + TypeScript 5.9 + Fastify 5 + Zod 4 + Drizzle ORM + PostgreSQL 16.

## Reasons

1. **One language across the repo.** The stated reason for the reversal, and the one that
   matters most in practice. A contributor moves between `arcnave-frontend/src` and
   `backend/src` without changing toolchain, idiom, or type system. ADR-0001's polyglot
   consequence was real and is now gone.

2. **The contract is generated from the validators.** Fastify plus `fastify-type-provider-zod`
   means one Zod schema per route validates the request *and* produces the OpenAPI entry.
   `npm run openapi` writes `docs/openapi.json` from the running app, so the document cannot
   describe a route the server does not serve. This is the same property ADR-0001 wanted from
   Pydantic, obtained the same way.

3. **Cancellation reaches the provider.** ADR-0001's third reason was the strongest and it
   turned out to be no argument for Python at all. `AbortController` and `AbortSignal` are
   platform primitives; the route registers a controller in `services.activeRuns`, the socket
   `close` event and `POST /chats/:id/stop` both abort it, and every provider adapter passes
   the signal down to the real HTTP request. Verified by
   `src/routes/chats.integration.test.ts`, which cancels a run mid-stream from a second
   connection and asserts the output is cut short.

4. **The provider SDKs are fine.** `@google/genai` and `@anthropic-ai/vertex-sdk` are both
   first-party and current. ADR-0001's claim that the Vertex auth story is "best documented in
   Python" did not survive contact: `google-auth-library` handles ADC and workload identity
   with no more ceremony than its Python counterpart.

5. **Drizzle over an ORM with a session lifecycle.** Migrations are readable SQL that gets
   reviewed. Queries are typed from the schema. There is no lazy loading, so there is no class
   of bug where a property access silently issues a query — which is the async-SQLAlchemy
   hazard ADR-0001 listed as a consequence it would have to manage.

## What was rejected

- **TypeScript 7.** GA, but `typescript-eslint` still caps at `<6.1.0`. Revisit when it does not.
- **An embedding-based retriever.** Retrieval is BM25 over extracted text, and the product says
  so. A vector column we cannot search would be a capability claim we have not earned; the
  `Retriever` interface is the seam for replacing it. See [ADR-0002](0002-model-aliases.md) for
  the same principle applied to model labels.
- **JWTs.** Sessions are database rows, so they are revocable and a password change can end
  other sessions. A stateless token cannot do that without a revocation list, which is a
  session table with extra steps.

## Consequences

- `npm run openapi` must be re-run when a route's schema changes, and `docs/openapi.json` is
  committed so drift shows up in a diff.
- `activeRuns` is an in-process `Map`, so `POST /chats/:id/stop` only reaches a run on the same
  instance. Horizontal scaling needs shared signalling (Redis pub/sub) first. Recorded as a
  known limitation rather than quietly assumed away.
- Tests are `vitest`. Provider adapters are injected through the service container, so the
  suite cannot reach Vertex however it is run.
- The repo is no longer polyglot, but it is still two npm projects with separate lockfiles.
  `compose.yaml` and the root `CLAUDE.md` are the seams, as ADR-0001 anticipated.
