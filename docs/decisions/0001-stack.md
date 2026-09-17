# ADR-0001: Python / FastAPI / PostgreSQL for the ArcNave backend

- Status: **superseded by [ADR-0003](0003-node-stack.md)** (2026-09-17)
- Date: 2026-09-16

> **This decision was reversed the same day it was made.** The backend is Node 22 and
> TypeScript, not Python. Nothing below describes the code that exists.
>
> The text is kept unedited rather than rewritten, because an ADR is a record of what was
> decided and why, not a description of the current system — that is the checkpoint's job.
> Rewriting this one would erase the fact that the stack was chosen, argued for on these
> grounds, and then changed. Read it for the reasoning; read ADR-0003 for the outcome.

## Context

ArcNave is a React 19 + Vite frontend with a mock provider boundary in `src/adapter.ts`.
It needs a real backend that talks to Vertex AI (Gemini + Anthropic partner models),
streams generations, and owns persistence.

## Decision

Python 3.12 + FastAPI + SQLAlchemy 2.0 (async) + Alembic + PostgreSQL 16.

## Reasons

1. **The provider SDKs are Python-first.** `google-genai` and `anthropic[vertex]` are both
   first-class, currently maintained Python packages with the exact usage metadata we must
   record. A Node backend would use `@google/genai` and `@anthropic-ai/vertex-sdk`, which is
   viable, but the Vertex auth story (ADC, workload identity) is best documented in Python.
2. **Typed end to end.** Pydantic v2 models generate the OpenAPI schema that the frontend's
   TypeScript client is generated from, so contract drift becomes a build failure.
3. **SSE with real cancellation.** `sse-starlette` on ASGI gives us `http.disconnect` →
   `asyncio.CancelledError` inside the generator, which is how client cancellation reaches
   provider work. See `docs/backend-research.md` §6.

## Consequences

- The repo is polyglot. `backend/` and `arcnave-frontend/` have separate toolchains; the root
  `compose.yaml` and `CLAUDE.md` are the seams.
- Async SQLAlchemy means every repository call is awaited and no lazy relationship loading is
  safe outside a session. We use explicit `selectinload` and never rely on implicit IO.
- Type checking is `mypy --strict` on `app/`, which the provider SDKs do not fully support;
  those two adapter modules carry targeted `ignore_missing_imports`.
