# P21 result — module boundaries, numbers wired, ESLint in CI (ADR-0082)

Branch `build/turn-jobs`, base `9825d08` (checked: `git rev-parse --short HEAD` = `9825d08` before
work). One commit, not pushed. Model: Opus 5.5 (one agent, no sub-agents). Decision record:
[ADR-0082](../decisions/0082-module-boundaries-numbers-and-lint.md). Live checklist:
[`p21-live-checklist.md`](p21-live-checklist.md).

Every inventory was redone on `9825d08` (after P08 / P22 / P13 / P11), not taken from the planner's
`65abe65` list: `getDb` sites (memoryService 13 calls + singleton, chatSearch 4, compactionService
default param + singleton, 6 scripts), the numbers-diff §3 literals (several had already moved:
SSE ping is `SSE_PING_MS`, `attachmentIds` max is N-10, `FILE_LIMITS` moved to `pipeline.ts`), 93
`catch {` / `.catch(() =>` sites, the SSE head (`turnStream.ts` after P08), and every JSON route body.

## DONE / SKIP

| Item | Status | Where |
|---|---|---|
| A-16 container injection | DONE | `container.ts`, `services/memory/{memoryService,chatSearch}.ts`, `services/compaction/compactionService.ts`, `services/turn/{services,toolset,contextPrompt,prepareTurn}.ts`, `routes/memory.ts`, `tools/chatExecutor.ts` |
| S21-10 / A-17 numbers wired (values unchanged) | DONE | `config/numbers.ts` `// --- P21` (38 entries), `config.ts`, 20 code files |
| OQ-15 DIFF values | SKIP (owner) | no written default for any |
| A-18 (b) renderers vs Python skills | SKIP (OQ-13b) | rest already one path (ADR-0082 §3) |
| A-19 dead code | DONE | `services/analytics/*` deleted; `src/scripts` → `scripts/live`; flags listed in ADR §4 (defaults unchanged, owner item) |
| A-23 silent catches | DONE | 67 `benign:` marks, 8 coded log lines, 1 typed error (memory import) |
| A-25 auth read path | DONE | `services/auth.ts` (`SESSION_LAST_SEEN_WRITE_MS`, ours, 15 min) |
| A-26 SSE through Fastify | DONE | `routes/turnStream.ts` (hijack + plugin headers), `services/runHub.ts` byte cap (`RUN_BUFFER_MAX_BYTES`, ours, 64 MiB) |
| B2 / A-15 contract test | DONE | `arcnave-frontend/src/openapiContract.test.ts` (21 DTOs) |
| openapi-typescript generator | SKIP (OQ-29) | |
| C4 per-route body limits | DONE | `app.ts` (1 MiB), `routes/bodyLimits.ts`, files / projects / artifacts / memory routes |
| VS-33 ESLint + CI | DONE | `backend/eslint.config.js`, `arcnave-frontend/eslint.config.js`, `lint` scripts, `ci.yml` Lint steps |
| S21-02 CLAUDE.md | PROPOSED only | ADR-0082 §11 (CLAUDE.md not edited) |

## Evidence per exit test

- **`backend/src/test/numbersGuard.test.ts`** — 6/6. (a) 28 known rows + config-key rule, (b) value
  scan (8 common values, 14 coincident sites, each with reason and an existence check), (c) N-id
  comment lines, (d) planted literals: a `max(100_000)` prompt, `3_540_000`, `30 * 1024 * 1024`, an
  `// N-07` line without NUMBERS, and `TOOL_MAX_ROUNDS: int(16)` are each caught. Walks with
  `readFileSync` (storage.ts included, asserted).
- **`backend/src/test/moduleBoundaries.test.ts`** — 6/6: no `getDb` outside container / client, no
  module-level service singleton, `process.env` only in config.ts + 6 listed sites, SDK imports only
  under providers/, no unmarked swallowed error; planted violations caught for each.
- **ESLint** — backend `npm run lint`: 0 errors, 145 warnings (no-explicit-any 82 = 33 src + 49
  test; no-unused-vars 63 = 37 src + 26 test). Frontend: 0 errors, 18 warnings (no-unused-vars 16 =
  8 + 8; no-explicit-any 2). A planted file (getDb import, SDK import, `catch {}`) gives 3 errors.
  CI: `Lint` step in both jobs (`.github/workflows/ci.yml`).
- **Body limits** — `src/routes/p21Boundaries.integration.test.ts`: 2 MiB JSON on `POST /chats` →
  413 `payload_too_large` (it was accepted before: the old global limit was 3 MiB in tests); a
  1.5 MiB multipart project file → 202; a 100,000 × U+0001 prompt (≈ 600 KB JSON) → 200; a
  400,000 × `€` artifact (≈ 1.2 MB) → 201 on create and on a new version; a 1.1 MB memory import →
  200 with 60 added.
- **SSE headers** — `chats.integration.test.ts` "P21 A-26": generate and reattach (`GET /stream`)
  both carry `access-control-allow-origin`, `-allow-credentials`, `-expose-headers`, `vary`, nosniff,
  `X-Frame-Options`, HSTS, `Referrer-Policy`, `x-request-id`. The existing allowed / not-allowed
  origin tests pass unchanged.
- **last_seen_at** — `p21Boundaries` "writes last_seen_at once": first request moves an hour-old
  value, the second leaves it. With `SESSION_LAST_SEEN_WRITE_MS=0` (every request writes, the old
  behaviour) the test fails (`expected 1792224492056 to be 1792224492033`).
- **Contract test** — 3/3; planted rename `ArtifactDto.chatId` → `chatID` in `api.ts`: fails with
  `ArtifactDto.chatID: not in PATCH /artifacts/{id} 200` (and the content DTO), reverted
  (`git diff src/api.ts` empty). The test also renames a server field in a copy of the contract.
- **openapi** — `npm run openapi`: `docs/openapi.json` unchanged (no route schema changed).
- **Schema** — `npx drizzle-kit generate`: "No schema changes, nothing to migrate".

## Gates (sequential, one at a time)

| Gate | Result |
|---|---|
| Baseline backend vitest on `9825d08` (before any edit) | 1840 passed, 23 skipped, 0 failed (626 s) |
| backend `npx tsc --noEmit` | clean |
| backend `npm run lint` | 0 errors (145 warnings) |
| backend `npx vitest run` (run 1, final code tree) | 1854 passed, 23 skipped; 1 file failed in `afterAll` only: `migrate.integration.test.ts` "permission denied to terminate process" on `drop database … with (force)` of its scratch database. Rerun alone: 5/5. |
| backend `npx vitest run` (run 2, final code tree; only the ADR / result / checklist docs, which no test reads, were written during it) | **161 files passed, 1854 passed, 23 skipped, 0 failed** (+14 tests over baseline: 6 numbersGuard, 6 moduleBoundaries, 6 p21Boundaries, 1 SSE header; −5 deleted analytics tests) |
| frontend `npx tsc -b` | clean |
| frontend `npx vite build` | built (chunk-size warning only, unchanged) |
| frontend `npx vitest run` | 47 files, 457 passed |
| frontend `npm run lint` | 0 errors (18 warnings) |

Characterization and golden snapshots did not change (no snapshot file in the diff; the
`turnCharacterization*` and `goldenRequests` files pass).

## OWNER ITEMS

- OQ-15 values (unchanged): N-01 write 120 vs 20, N-02 100,000 vs 32k, N-33, N-35 20,000 vs
  3,000 / 5,000 / 300, N-39 400,000 chars vs 5 MB / 20 versions / 50 per chat, the turn deadline,
  N-06 / N-74 without P10 profiles.
- OQ-29: generated client types (openapi-typescript) — the contract test stands in until then.
- OQ-13(b): Office / PDF renderers versus the Python skills.
- A-19: default-off flags (ADR-0082 §4) — changing any default.
- S21-02: confirm the proposed CLAUDE.md text (ADR-0082 §11) and the per-app CLAUDE.md files.

## Open risks

1. `checkPrivacy` takes ~0.6 s on 19,000 repeated letters (one long token): a memory import of 500
   such items would run for minutes. Found while sizing the import test (the test uses words).
   Pre-existing; not changed here.
2. `executionRuntime.ts` (USE_DOCKER_SANDBOX, SANDBOX_IMAGE, ALLOW_HOST_CLI) and
   `cloudRunSandboxClient.ts` (SANDBOX_SIGNING_SA fallback) still read `process.env` at call time
   (allowlisted with reasons); moving them to config changes how their tests set them.
3. `memory import`: a database failure now fails the request (500) instead of counting the memory
   as skipped — intended (A-23), but visible.
4. The SSE head now also carries the rate limiter's `x-ratelimit-*` headers.
5. `migrate.integration.test.ts`'s `afterAll` can fail when another connection holds its scratch
   database (seen once in run 1); not caused by P21.

## For the orchestrator

- mistakes.md (not edited by me): "A 20,000-character single-token string takes 0.6 s in
  `checkPrivacy`: size performance fixtures with realistic text and record the pathological case as
  a finding" — candidate entry or DEFERRED line.
- DEFERRED.md (not edited): the A1 identifier lines that referred to `backend/src/scripts/` now
  apply to `backend/scripts/live/` (same 11 files, outside the image).
- CURRENT.md (not edited): P21 done on `build/turn-jobs`; next is the wave-3 merge gate.
- `docs/openapi.json`: unchanged, no regeneration needed.
