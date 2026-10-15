# ArcNave – Existing frontend review (arcnave-frontend)

> **USER DECISION 2026-09-30: DESIGN REFERENCE ONLY.** No change to any locked decision. Backend = Python + FastAPI + our L3 API design. Web = Next.js (reuse React components/visual design from this code), Android = React Native. Section 2 proposals are NOT adopted; kept only as notes (e.g., error-code list and SSE event names can inspire L3/L4 details).
_Reviewed 2026-09-30 · Only structure/contract read, not content · Source: D:\arcnave-tech-main\arcnave-tech-main\arcnave-frontend_

## 1. What exists (facts from code)
- Stack: **Vite 6 + React 19 + TypeScript SPA** (react-router), Radix UI, react-markdown + GFM + KaTeX + highlight, Mermaid, Recharts, docx-preview, JSZip, Vitest tests.
- Deploy: Cloudflare Workers static assets (`wrangler deploy`) AND a Dockerfile (nginx on :8080 that proxies `/v1` to backend → single origin).
- README: "talks to the ArcNave backend in ../backend", Postgres; no mock data. A `backend/` folder exists next to it (NOT reviewed – access not granted).
- Auth: **server-held session in HttpOnly cookie**, `credentials: "include"`, same-origin `/v1`; register/login/logout/password/me. No Google login found.
- Modes: **chat · search · research**; model alias or `Auto`; reasoning effort; response styles.
- API contract (already coded): `/auth/*`, `/models` (+refresh), `/chats` (list with cursor + q), `POST /chats/:id/generate` (SSE), `/chats/:id/stop`, `/chats/:id/branch`, message feedback + log, `/chats/:id/share`, `/share-links`, `/files/uploads` → PUT to storage → `/files/:id/complete`, file preview/download, `/projects` (+files, sources, reindex, reorder), `/artifacts` (+versions, restore, export, share), `/memory` (+project memory, export, import, delete all), `/styles` (+summarize), `/preferences`, `/usage` (+limits, messages, CSV export), `/account` (+export).
- SSE events: `start, research, delta, thinking, sources, code, tool_use, tool_result, artifact_created, ui_block, ui_draft, debug, done, error`.
- Error codes (~40, typed, UI switches on `code`): incl. rate_limit, budget_exceeded, run_in_progress, idempotency_conflict, context_overflow, provider_payload_limit, provider_timeout, empty_response, model_refused, turn_deadline_exceeded, too_many_files, upload_incomplete, registration_closed…
- Reads `X-Request-ID` header.
- UI features: generative-UI blocks (cards, chart, comparison, dashboard, metric, sources, steps, table, timeline, visual), slides view, sandbox frame (renders artifacts), code blocks, tool activity, follow-up suggestions, clarifying question options, thinking display, dictation (mic), Office/DOCX file previews, usage & budgets, personalization, keyboard shortcuts, light/dark, responsive.

## 2. Impact on our locked decisions
| # | Finding | Conflicts with | Proposed change |
|---|---|---|---|
| FE-1 | Web = Vite React SPA, not Next.js | L1 UI-1 | Keep Vite SPA; Android = React Native (Expo) still (shares TS types/API client) |
| FE-2 | Deploy = Cloudflare / nginx Docker | L2 E-1 (Cloud Run behind GCP LB + Cloud Armor) | Use existing Dockerfile on Cloud Run Mumbai; drop Cloudflare deploy (one edge/security policy) |
| FE-3 | Same-origin `/v1` + HttpOnly cookie sessions | L2 hostnames (`api.` separate) + L3 "verify login token" | Web: `app.arcnave.tech/v1` same-origin, cookie session (keep). Android: bearer/refresh tokens (cookies awkward on mobile). `api.arcnave.tech` for Android. Backend supports both |
| FE-4 | No Google login in UI | R13 (email+Google) | Add Google sign-in to frontend + backend |
| FE-5 | Endpoint names differ (`/chats`, `/generate`, `/branch`, `/share-links`…) | L3 endpoint catalogue | **Adopt frontend contract as source of truth**; write it as OpenAPI |
| FE-6 | SSE lacks `ping`, `seq`, resume, retract | L2-G1, L3-G2, L3-G5, D3 | Add `ping`, `seq`/`id`, resume endpoint, `retract` event; verify client ignores unknown events (L3-G1) |
| FE-7 | Modes Search + Research, tools, code, artifacts, gen-UI, projects, memory, styles, usage budgets | Stage 1 MVP scope (text, file, mic, model select) | **Scope decision needed** – frontend implies a much bigger MVP (web search tool, deep research agent, code sandbox, artifacts, projects/RAG) |
| FE-8 | `/account/export`, `/memory/export`, `/usage/export` exist | G8 "no export" | Data/account export already built → keep (good for DPDP) |
| FE-9 | Error catalogue exists | L2-G2 / L3 error format | Adopt its codes ✅ |
| FE-10 | Upload = signed URL PUT → complete | 0.2 / L3 | Same ✅ |
