# ADR-0082: Module boundaries, numbers wired, ESLint in CI

- Status: accepted (task tech-p05 wave 3 = NEW-PLAN P21). Tested offline; not merged, not deployed.
- Date: 2026-10-17
- Task: P21 ([`docs/ops/p05-wave-plan.md`](../ops/p05-wave-plan.md) §2, §6). Evidence:
  [`docs/ops/p21-result.md`](../ops/p21-result.md). Live checklist:
  [`docs/ops/p21-live-checklist.md`](../ops/p21-live-checklist.md). No migration.
- Builds on: [ADR-0078](0078-durable-turns.md) (`streamRun` / `SseConnection`, run hub),
  [ADR-0079](0079-ledger-price-book-and-versions.md), [ADR-0080](0080-history-summary-and-helper-jobs.md),
  [ADR-0081](0081-error-matrix-and-labelled-fallback.md). Nothing they decided is reversed.
- Models used: Opus 5.5 (one agent).
- Behaviour: neutral. No N-id value changed (OQ-15 has no written default for any of them). The
  three intended differences are listed under "What a user or operator can see".

## Stage decisions applied

Stage 4 B2 (contract test only; the generator is OQ-29), C4 (per-route body limits); Stage 20 VS-33
(ESLint as dev-only dependencies, in CI); Stage 21 S21-10 (numbers register wired), S21-02 (proposed
below, not written); D3 A-15 (contract), A-16 (container injection), A-17 (numbers), A-18 (one path
per job), A-19 (dead code, scripts, flags), A-23 (silent catches), A-25 (auth read path), A-26 (SSE
through Fastify).

## Claude (the reference) and where ArcNave differs

- **Claude:** Anthropic publishes no guidance on a web backend's module layout, lint rules, body
  limits or numbers register; the `claude-api` skill and platform docs cover the API surface only
  (read 2026-10-17: nothing on these topics). The one Claude-side rule involved is CLAUDE.md's
  "model SDK calls outside `backend/src/providers/`" (Forbidden list), which ESLint and
  `moduleBoundaries.test.ts` now enforce.
- **ArcNave now / gap / fix:** everything below is a stage decision or ours, labelled as such. No
  Claude behaviour is changed.

## Decisions

### 1. Container injection (A-16)

`MemoryService`, `CompactionService` and the chat-search reads take their `Database` in the
constructor; the module singletons `memoryService` and `compactionService` are deleted, and
`chatSearch.ts`'s functions take a `DbLike` first, wrapped by a `ChatSearch` class. `Services` gains
`memory`, `compaction`, `chatSearch` (one construction line in `container.ts`); `TurnServices` gains
the same three, passed to `GenerationService` (a script that builds a `GenerationService` alone gets
them built on its own `db`). Routes read `request.services.memory`; the memory and chat tool
executors receive the store. `container.ts` uses `cfg.isProduction` (not `process.env.NODE_ENV`) and
checks both provider slots once with a typed error instead of `providers.google!`.

Test: `src/test/moduleBoundaries.test.ts` — no `getDb` import or call outside `container.ts` and
`db/client.ts`; no module-level `= new *Service(`; `process.env` only in `config.ts` and six listed
sites (child-process environment forwarding, and three switches read per call, see risks); model
SDK imports only under `providers/`; every swallowed error marked (A-23). Each check has a planted
violation.

### 2. Numbers wired (S21-10, A-17)

38 entries added to `config/numbers.ts` under `// --- P21`, each at the repo's current value with
the register row's value in its `source` where they differ. `config.ts` defaults and the code read
them with the N-id in a comment: N-01 (auth 10, share 60), N-02 (prompt 100,000), N-05, N-07
(`max_uses` 5), N-08 / N-68 (sandbox concurrency, code bytes, orchestration 45 s, lease slack, warm
transfer), N-09 (web fetch 10,000), N-10 (multipart `files`, image px), N-13 (history inline bytes,
visual pages), N-14 (1,400 / 180 characters), N-16 / N-77 (compaction trigger, floor, headroom,
ratio), N-17 (memory context, file bytes, list 100, import 500, item 20,000), N-24 / N-73 (run buffer
50,000 events, retention 5 min, list page 30 / 100, chat title 200), N-35 (instructions 20,000), N-39
(artifact 400,000), N-41 (sheet preview 200 × 50, 25 MB), N-43 / N-74 (connect 10 s, probe TTL 300 s),
N-74 (`preferences.max_output_tokens` column default), N-77 (summary text check). Two dead fallbacks
(`?? 8192`, `?? 0.15`, `?? 12_000_000` on always-set config values) were removed. `drizzle-kit
generate` reports no schema change.

Not wired (no N-id fits, or the register row is infra): `UNSENT_UPLOAD_TTL_HOURS`,
`SANDBOX_STATE_RETENTION_DAYS`, `SANDBOX_CHECKPOINT_IDLE_SECONDS` (N-33 / N-34 "family" only), the
session / checkpoint sweep intervals in `index.ts` and the export link lifetime (no register row).

Test: `src/test/numbersGuard.test.ts`, table-driven: (a) 28 rows of the old literals plus "a config
key named like a NUMBERS entry reads it"; (b) no NUMBERS value ≥ 1,000 written as a literal outside
`numbers.ts` (products evaluated), except eight round values shared by unrelated quantities (1,000,
1,024, 2,000, 5,000, 10,000, 20,000, 30,000, 60,000: unit conversions and round caps; their N-id
sites are pinned by (a)) and 14 coincident sites, each with its reason and a check that it still
exists; (c) a code line with an `N-nn` comment reads `NUMBERS.` or `cfg.` (one allowlisted word
value, N-69 effort `low`); (d) planted literals are caught by each detector.

OQ-15 values stay as they are (no written default): N-01, N-02, N-33, N-35, N-39, the turn deadline,
N-06 / N-74 without P10 profiles. OWNER ITEMS.

### 3. One path per job (A-18)

(b) Office / PDF renderers versus the Python skills: SKIP, OQ-13(b) owner item. The rest of A-18 is
already one path: the file pipeline (ADR-0062 / 0063, `FILE_PIPELINE=sync` is the parity switch the
test holds equal), helper jobs (ADR-0080), the gateway (ADR-0081). Nothing changed here.

### 4. Dead code and the shipped tree (A-19)

- `services/analytics/*` (profiler, quality, types) was imported only by its own test: deleted.
- `src/scripts/` (22 owner-run live scripts) moved to `backend/scripts/live/`: outside `rootDir`, so
  `tsconfig.build.json` no longer compiles them into `dist/` (the image), while `tsc --noEmit` still
  typechecks them (`tsconfig.json` includes `scripts/**`). Imports now read `../../src/...`;
  `liveScripts.test.ts` reads the new folder. `npm run eval:prompt` / `conformance:live`
  (`scripts/evalPrompt.ts`, `scripts/conformanceLive.ts`) are untouched.
- Default-off flags (changing a default is an owner item, unchanged): `ENABLE_TOOL_USE`,
  `ENABLE_RUN_PYTHON`, `ENABLE_TRUSTED_CLI`, `ENABLE_SKILL_SCRIPTS`, `ENABLE_WEB`,
  `ENABLE_GOOGLE_SEARCH_GROUNDING`, `ENABLE_ANTHROPIC_WEB_SEARCH`, `ENABLE_GEMINI_CODE_EXECUTION`,
  `ROUTER_SHADOW`, `SESSION_COOKIE_SECURE` (set per deployment), `FILE_SCANNER=none`.

### 5. Silent catches (A-23)

Every `catch {` and `.catch(() => …)` in the shipped tree now throws a typed error, logs a coded
line, or carries `// benign: <reason>`: 67 sites marked benign, 8 coded log lines added (style
summary budget release and usage row, attachment and project-file orphan bytes, file-job heartbeat,
skill load ×2, session `last_seen_at` write), one typed error. ids, codes and sizes only
(`errorLogFields`), never text (Stage 17 NO_CONTENT).

The typed error: memory import counted **every** failure of a memory as "skipped", so a database
failure answered 200 with `skipped: n`. Privacy refusals now throw `MemoryPrivacyError`; only that is
counted as skipped, and any other failure fails the request (500, `internal_error`). This is the one
place a swallowed error hid a user-visible failure.

### 6. Auth read path (A-25)

`AuthService.resolve` wrote `sessions.last_seen_at` on every authenticated request. It now writes
only when the stored value is older than `SESSION_LAST_SEEN_WRITE_MS` (ours, 15 min, no N-id;
nothing reads the column more finely), as a `WHERE last_seen_at < now − interval`, so concurrent
requests write once. A failed write is logged (coded) instead of dropped.

### 7. SSE through Fastify (A-26)

`SseConnection` calls `reply.hijack()` and writes its head as `{...reply.getHeaders(), SSE
headers}`: `@fastify/cors` (and the rate limiter) set their headers in their hooks and they reach the
stream; the security plugin's headers arrive through Node's `setHeader` merge as before. The
hand-built CORS block is removed. The run replay buffer gains a byte cap, `RUN_BUFFER_MAX_BYTES`
(ours, 64 MiB): past it the oldest frames drop, as past `RUN_BUFFER_MAX_EVENTS`, and a reconnect
from before them gets the stored `snapshot` (ADR-0078); the newest frame is always kept.

### 8. Per-route body limits (C4)

Global `bodyLimit` = `API_BODY_LIMIT_BYTES` (ours, 1 MiB). Before, the one global limit was the
upload limit (MAX_UPLOAD_BYTES + 1 MiB = 31 MiB) on every route, so:

| Route | Limit | Why |
|---|---|---|
| `POST /files`, `POST /projects/:id/files`, `PUT /projects/:id/files/:fileId` (multipart) | MAX_UPLOAD_BYTES + 1 MiB | upload; unchanged |
| `PUT /files/:id/content` (raw) | same | documented; the stream parser is bounded by `putStream` |
| `POST /artifacts`, `POST /artifacts/:id/versions` | 6 × (400,000 + 200) + 64 KiB ≈ 2.4 MB | N-39 400,000 UTF-16 units, each ≤ 6 bytes escaped in JSON |
| `POST /memory/import` | MAX_UPLOAD_BYTES + 1 MiB | 500 × 20,000-character items exceed any computed bound under the old limit |
| everything else | 1 MiB | largest schema: generate, 100,000 × 6 bytes ≈ 600 KB |

A style's `instructions` (no schema max, 4,000 checked in the handler) above 1 MiB now answers 413
instead of 422 `style_too_long`; it was refused before too.

### 9. Contract test (B2, A-15)

`arcnave-frontend/src/openapiContract.test.ts` maps 21 DTOs of `src/api.ts` to their response
schemas in `docs/openapi.json` and fails when a field the client declares is missing from the
contract (a rename on either side). Parsed with the TypeScript compiler API, no new dependency. The
generated client (openapi-typescript) is SKIP: OQ-29 owner item.

### 10. ESLint in CI (VS-33)

`backend/eslint.config.js` and `arcnave-frontend/eslint.config.js` (flat config):
`@eslint/js` recommended + `typescript-eslint` recommended; `no-empty` (catch included);
`no-restricted-imports` for `getDb` from `db/client.js` outside `container.ts` / `db/client.ts` /
tests, and for `@anthropic-ai/sdk` / `@google/genai` outside `src/providers/` (tests may import SDK
error classes; the frontend never). `npm run lint` in both packages; a Lint step in both CI jobs.

Dependencies (dev only, both older than two weeks, MIT): `eslint` 9.39.5 (2026-07-10),
`@eslint/js` 9.39.5 (2026-07-10), `typescript-eslint` 8.70.0 (2026-09-07). The backend had `eslint`
and `typescript-eslint` already; `@eslint/js` is now declared in both.

Errors fixed, not disabled: 4 `prefer-const`, 2 `no-useless-escape`, 2 `no-irregular-whitespace`
(a BOM literal written as `﻿`), an unused directive; three targeted
`eslint-disable-next-line` with a reason (two test generators that fail before their first event,
`no-control-regex` on the "not ASCII" class of the PDF renderer). A frontend directive naming the
uninstalled `react-hooks` plugin became a plain comment. No blanket disables.

Deliberate `warn` (zero errors): backend `no-explicit-any` 82 (33 src, 49 tests), `no-unused-vars`
63 (37 src, 26 tests) = 145; frontend `no-unused-vars` 16 (8 src, 8 tests), `no-explicit-any` 2 =
18. Cleanups, not defects; new code should not add to them.

### 11. S21-02: proposed `CLAUDE.md` additions (not written; owner confirms)

Under "Build rules on this base", **Forbidden**, add:

> - Identifiers (A1, amended by C1): no project id or number, Cloud SQL instance connection name,
>   or service-account / owner e-mail in code, tests, workflows, CI logs or app logs (telemetry may
>   carry the project id read from the runtime). Allowed only in ops docs, `lv1/results` and the
>   Terraform backend config. Passwords, keys and tokens are forbidden everywhere.
> - No hard-coded language detection or transliteration (LANG-1).
> - No Claude context-editing or compaction betas.
> - No Eventarc, Cloud CDN, Vertex RAG Engine, Model Armor enforcement, or AGPL dependency.
> - A dependency outside the Stage 20 BOM: stop and ask.
> - Owner-run live scripts live in `backend/scripts/live/` (outside the image); they may import
>   the SDKs and spend quota, and are never run by tests or CI.
> - `getDb()` only in `container.ts` / `db/client.ts`; numbers with an N-id only from
>   `config/numbers.ts`; `npm run lint` clean in both packages (ADR-0082; tests enforce each).

Per-app `backend/CLAUDE.md` and `arcnave-frontend/CLAUDE.md` are part of the same owner decision.

## What a user or operator can see

1. A JSON request above 1 MiB to a route without its own limit answers 413 `payload_too_large`;
   nothing the client sends comes near it (section 8).
2. A memory import that hits a database failure answers 500 instead of 200 "skipped".
3. SSE responses carry the CORS plugin's full header set (`Access-Control-Expose-Headers`, `Vary`)
   and the rate-limit headers.

## Consequences

- New services take their database from the container; the guard test fails on a new singleton.
- New N-id numbers go into `numbers.ts`; the guard fails on the literal.
- Open: the three per-call `process.env` switches in `executionRuntime.ts` and the signing-SA
  fallback in `cloudRunSandboxClient.ts` stay (allowlisted with reasons); moving them is a follow-up
  that changes how tests set them.
