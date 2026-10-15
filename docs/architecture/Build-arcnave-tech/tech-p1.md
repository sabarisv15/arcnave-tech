# tech-p1 – Phase 1: core turn, web chat, brand – PROMPT (2026-10-14)

_Paste the block below into the Claude Code cloud session. Result section to be appended after the report._

```
# Task tech-p1 – Phase 1: core turn, web chat, brand (one stretch)

Repo: https://github.com/sabarisv15/arcnave-tech. Start from branch `phase0/base-adoption` (PR #39, commits 8622146 + 5c32f78); create `phase1/core-turn` from it. Never push to `main` (push to main = live deploy).
Read first: CLAUDE.md (incl. "Build rules on this base"), mistakes.md, docs/decisions/0053-*.md, docs/architecture/README.md, docs/architecture/00-Handoff/00-build-plan-arcnave-tech.md (§0, §2, Phase 1).
Rules: no .env/secrets committed; no SDK retries; no temperature/top_p/top_k; model SDK calls only in backend/src/providers/; no new literal for a value that has an N-id (docs/architecture/00-Handoff/00-numbers-register.md) – read it from config/settings with the N-id in a comment. Reply in Tanglish at the end.
Cadence: commit locally as you like, but ONE squashed commit + ONE push at the end of the whole phase; full test suite only at the end (step F). Do not wait for CI.

## Models (name the ones you actually used in the report)
- Opus 5.5: items C, B, G1 (gateway, auth, layout refactor).
- Sonnet 5.5: items 0, A, E, D, G0, G2, G3, G4, docs.
- Haiku 5.5: only as a test-runner subagent.

## Item 0 – Phase 0 verify (Sonnet)
`cd backend && npm ci && npx tsc --noEmit` and `cd arcnave-frontend && npm ci && npx tsc -b` must be clean on the starting branch (the Phase 0 session could not run them – npm registry was unreachable there). Fix only what Phase 0 broke, if anything; report it.

## Item C – Claude via the first-party API, 3 models (Opus)
1. New `backend/src/providers/anthropic.ts` using `@anthropic-ai/sdk` (`new Anthropic({ apiKey: cfg.anthropicApiKey, maxRetries: 0, timeout: <from N-id> })`). Port the whole Provider contract from `anthropicVertex.ts` (streaming, tools, thinking/effort via `output_config`, cache_control breakpoints, usage incl. cache read/write, refusal event, PDF/image blocks). Keep `anthropicVertex.ts` only if something still imports it; otherwise delete it and its tests (ADR records the change).
2. `config.ts`: `ANTHROPIC_API_KEY` (secret, required only when a Claude alias is configured), `MODEL_SONNET` default `claude-sonnet-5-5`, `MODEL_OPUS` default `claude-opus-5-5` (verify the exact first-party model ids from docs.claude.com/en/docs/about-claude/models and cite the page in the ADR). Remove `MODEL_GPT_OSS`, `GPT_OSS_LOCATION`, `gptOssVertex.ts`, the `openai-oss` provider and alias everywhere (registry, capabilities table, routing, frontend model picker, tests, .env.example, compose.yaml, docs/openapi.json via `npm run openapi`).
3. `providers/registry.ts`: delete the hard gate that marks Claude `not_configured` outside tests ("Only Gemini 3.8 Flash is active"). Status now comes only from configuration + probes + real outcomes. Aliases = exactly Gemini 3.8 Flash, Sonnet 5.5, Opus 5.5 (+ Auto).
4. Retry/timeout matrix: read `docs/architecture/Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md` and the N-ids it cites. Align `streamWithRetry` (generation.ts) and provider timeouts to that matrix (which status codes retry, how many times, backoff, first-token and total timeouts). Where the repo already matches, say so; where the matrix is stricter, change the code; where the repo is deliberately different (ADR-0024 no TTFT cutoff), keep the repo and note it in the ADR.
5. Usage: every Claude request's usage (input, output, cache read, cache write) lands in `usage_records` exactly as Gemini's does (ADR-0021 sums every request of the loop).
6. ADRs: `0054-claude-first-party-api.md`, `0055-three-models.md` (supersede the relevant parts of ADR-0002/0003). Update docs/backend-research.md section that says Claude is via Vertex.
Tests: unit tests for the new provider with a fake SDK client (no network); registry tests updated for 3 aliases; `architectureParity.test.ts` / `capabilityRegression.test.ts` updated.

## Item A – Price table INR + settings (Sonnet)
1. `backend/src/config/numbers.ts` (new): typed constants for every N-id the backend currently expresses as an env literal or inline number in config.ts (limits, timeouts, retries, budgets, upload caps). Each entry: value, `nId`, source comment. config.ts defaults read from it. Do not change any value – only move it; list every moved number in the report with its N-id. Numbers that have no N-id stay where they are and are listed as "no N-id".
2. Price table: keep the `PRICING_TABLE` env mechanism but add `inrPerUsd` (N-id from the cost log, docs/architecture/00-Handoff/00-cost-decision-log.md) and compute `cost_inr` beside `cost_usd` in `usage_records` (migration 0025; both nullable; null is not zero – invariant 2). `/usage` responses carry both. Frontend usage view shows ₹ first.
3. Seed values for the 3 models from the price rows in docs/architecture/Stage-18-Cost-Performance/00-checkpoint-stage18.md (USD per 1M, incl. cache read/write) as `.env.example` documentation, not committed secrets.

## Item B – Google sign-in (Opus)
1. Backend: `POST /v1/auth/google` takes a Google ID token (GIS), verifies it with `google-auth-library`'s `OAuth2Client.verifyIdToken` against `GOOGLE_OAUTH_CLIENT_ID` (config; feature off when unset → route returns `ApiError('google_signin_disabled')`, add to ERROR_CATALOG). Links by verified e-mail to an existing user or creates one (no password; `users.password_hash` becomes nullable – migration 0026 – and `/auth/login` returns `invalid_credentials` for password-less users). Issues the same server-side session cookie as `/auth/login`. `REGISTRATION_ENABLED=false` also blocks new Google accounts.
2. Frontend: Google button on the sign-in page using the official GIS script (`accounts.google.com/gsi/client`), rendered in the "G1" style from the brand sheet (Google Neutral theme, 48 px, 12 px corners). `VITE_GOOGLE_OAUTH_CLIENT_ID` env; button hidden when unset.
3. Tests: route tests with a fake token verifier injected through the container (never call Google); link-existing / create-new / disabled / registration-closed cases.
4. ADR `0056-google-sign-in.md`. Report what the owner must create in Google Cloud Console (OAuth client id, authorised origins) – you cannot create it.

## Item E – Content-leak check, shadow mode (Sonnet)
`backend/src/test/contentLeak.test.ts`: run one full fake-provider turn through `GenerationService` with sentinel strings in the user message, an attached text file, the memory topic and the model reply; capture every pino log line emitted (inject a pino destination) and assert none contains a sentinel. If it fails, do NOT silence the log sites: mark the test `it.fails`/`todo` with a comment listing each offending log site (file:line), and put the list in the report. Enforce mode is Phase 5.

## Item D – Prompt test kit (Sonnet)
Read `docs/architecture/Stage-06-Context-Prompt-Assembly/00-checkpoint-stage6.md` for the prompt test kit (68 cases, critical gates). Create `backend/src/test/promptKit/` with a runner (vitest) that checks the assembled system prompt + tool declarations (via `promptAssembly`/`systemPrompt`, no provider calls) against each case that can be checked offline; cases that need a live model become `it.skip` with the reason "needs live model (LV-xx)". If the checkpoint lists only the kit's categories and not the 68 cases, scaffold the categories, implement every case it does list, and report the gap. Critical gates fail the suite.

## Item G – Brand (frontend)
Sources (read with the Artifact tool, action "read"; if that tool is unavailable in your session, STOP after Item E and report – the owner will attach the HTML):
- Brand sheet: https://claude.ai/artifact/SJVz4XjsrrpKm7yU8Hb7Am
- App surfaces brand sheet: https://claude.ai/artifact/RCUWeBDErmSUC1rqGUYReG
- Locked design (only locked items): https://claude.ai/artifact/UcTovdqXxB6qcTvhF6StFv
Take every token (hex colours, font names/weights, radii, spacing, logo SVG, animation timings) from those pages – do not invent values. Locked facts you will find there: palette "Kulam & Marigold" (teal-green + marigold + terracotta), UI font Onest (W2 weights: body/menu 500, labels/buttons 600, headings 700), answer text Source Serif (Tamil → Noto Serif Tamil), light mode default, sidebar light green / main white, no animation in the app shell, logo "D1" (glowing dots + sky seed) with the "scattered → one point" motion, icons Lucide "N2" (leaf-tile corners, sky seed on the active icon), wordmark "L4 Sprout cut" (English + Tamil ஆர்க்நேவ்).
- G0 (Sonnet): `arcnave-frontend/src/brand/` – `tokens.css` (CSS variables), fonts (self-hosted via @fontsource where available: Onest, Source Serif 4 already present, Noto Serif Tamil), `logo/` SVG + the living-dots component and the AI-state animations (writing, searching, reading, running, creating, thinking = Mazhai cloud, done = seal stamp, needs-input = chat bubble, error = detour), `icons.tsx` wrapper, `wordmark.svg`. Save the three artifact HTML files under `arcnave-frontend/docs/brand/` as the reference.
- G1 (Opus): app shell "M2 icon rail" (collapsible rail that really collapses/expands, state in localStorage with try/catch), sidebar light green, main white, composer "K3" (lifted, green edge, leaf corners) on every screen, message layout "M1" (Claude style), logo 32 px next to the AI-state label.
- G2 (Sonnet): sign-in flow "SI4" (claude.ai/login structure, "scattered → one point" animation in the right panel), Google button "G1" (Item B), code entry, link-confirm, 2-step setup, invite e-mail + first-sign-in welcome, session-expired screen; splash v3 (3 s first open, 1 s quick open; none on web).
- G3 (Sonnet): chat states with the AI-state logo animations, serif answers (Tamil in Noto Serif Tamil), Settings page as locked.
- G4 (Sonnet): projects, artifacts, library/settings surfaces per the app-surfaces sheet.
Keep every existing frontend test green; add tests for the rail collapse, the composer presence on each route, and the Google button visibility rule.

## F – Finish (one time, at the end)
1. `backend`: `npx tsc --noEmit`, `npx vitest run` (full), `npm run openapi`. `arcnave-frontend`: `npx tsc -b`, `npx vite build`, `npx vitest run`. All clean.
2. `mistakes.md`: entries for anything that went wrong. `docs/checkpoints/CURRENT.md`: one "2026-10-xx Phase 1" block. `docs/architecture/build-tasks/tech-p1.md`: this brief verbatim + a result section.
3. ONE squashed commit on `phase1/core-turn`: `feat(phase1): Claude first-party + 3 models, INR prices + numbers, Google sign-in, leak check, prompt kit, brand`. ONE push. Open a PR with base `phase0/base-adoption` (or `main` if #39 is already merged). Do not merge.
4. Report in Tanglish: per item what changed (files), numbers moved (N-ids), leak-check result, prompt-kit coverage (n of 68), brand tokens source, models used, PR link, and the owner to-dos (Anthropic key in backend/.env as ANTHROPIC_API_KEY, Google OAuth client, branch protection).
```

## Result
_(append after the Claude Code report)_
