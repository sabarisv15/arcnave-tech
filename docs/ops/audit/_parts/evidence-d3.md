# D3 evidence — test inventory by area

Method: static read, Grep counts only (no test was run). A "case" is a line that starts (after
indentation) with `it(`, `test(`, or their `.skip` / `.only` / `.todo` forms. `it.each` rows and
cases built in a loop count once, so every number is a lower bound. Backend total by this count:
893 cases in 110 files (CLAUDE.md says "~900, 906 on 2026-09-28", so the count is close).
Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Paths are relative to `D:\arcnave-tech`.

"Integration" below means the file builds the full app through `src/test/harness.ts`
(`createTestApp`) or otherwise needs a live Postgres (`TEST_DATABASE_URL`, set in CI at
`.github/workflows/ci.yml:38` with `postgres:16-alpine` at `ci.yml:24`). "Unit" means no Postgres.
A fake provider (`FakeProvider`, `src/test/harness.ts`) stands behind every integration case, so
no case reaches a real model, a real GCS bucket or a real Cloud Run sandbox.

## 1. backend/src by folder

| Folder | Test files | Cases | Unit files / cases | Integration files / cases | Notes |
|---|---:|---:|---:|---:|---|
| `providers/` | 12 | 124 | 12 / 124 | 0 / 0 | adapter-loop tests drive scripted fake SDK clients (`anthropic.adapter-loop.test.ts:48`, `gemini.adapter-loop.test.ts:45` throw "no scripted response left"). Real SDK wire shape is never exercised. |
| `routes/` | 38 | 301 | 1 / 9 (`helpers.test.ts`) | 37 / 292 | Every route test is an integration test with a fake provider. |
| `services/` (top level and sub-folders) | 29 | 267 | 28 / 261 | 1 / 6 (`retention.integration.test.ts`) | See section 3 for services with no test file. |
| `tools/` | 17 | 124 | 14 / 101 | 3 / 23 (`semaphore.test.ts`, `sandbox/workspaceState.integration.test.ts`, `executor.integration.test.ts`) | `warmSandboxClient.test.ts` and `workspaceState.integration.test.ts` start the real Python `server.py` as a child process. |
| `db/` | 2 | 4 | 1 / 3 (`journal.test.ts`) | 1 / 1 (`modelAliasMigration.integration.test.ts`) | One test per migration risk; nothing tests `client.ts` or `migrate.ts`. |
| `capabilities/` | 1 | 2 | 1 / 2 | 0 | |
| `test/` (cross-cutting) | 9 | 68 | 8 / 65 | 1 / 3 (`contentLeak.test.ts`) | `behaviorEvaluation` 22, `batch6ContextRegression` 13, `batch6OverflowStreamingSafety` 11, `promptKit/promptKit` 8, `capabilityRegression` 7, others 1-3. |
| `src/` root (`errorLog`, `configUsage`) | 2 | 3 | 2 / 3 | 0 | `configUsage.test.ts` checks that every `config.ts` key is read somewhere; it does not check literals or `process.env` reads. |
| **Total** | **110** | **893** | **67 / 568** | **43 / 325** | |

Check sums: unit 568 + integration 325 = 893. Integration files 43 = 37 routes + 6 others.

Not counted as tests: `src/test/promptKit/{cases,scenarios}.ts` (1,299 lines of fixtures),
`src/test/harness.ts` (319 lines), `src/test/fixtures/*`.

## 2. Other test areas

| Area | Test files | Cases | Unit / integration | Notes |
|---|---:|---:|---|---|
| `backend/sandbox/test/` | 1 (`test_server.py`) plus `run-integration-tests.sh` | 16 (`def test_`) | Python, starts the real `server.py`; no Postgres | **Not run in CI**: `.github/workflows/ci.yml` has no step naming `sandbox`, `pytest`, `docker` or `lint` (Grep, 0 matches). `server.py` is 798 lines and `runner.py` 280 lines. |
| `arcnave-frontend/src` (all) | 41 | 351 | all unit (jsdom, `api` mocked) | No Playwright or browser test in the repo tree searched. Count by folder below. |
| `arcnave-frontend/src` root | 33 | 257 | | `types.test.ts` 28, `selection.test.ts` 20, `ChatStates.test.tsx` 17, `SandboxFrame.test.tsx` 15, `adapter.test.ts` 12, `ChatView.test.tsx` 12, `Surfaces.test.tsx` 12, `Settings.test.tsx` 11, `aiState.test.ts` 11, `Composer.test.ts` 10, `shortcuts.test.ts` 10 ... |
| `arcnave-frontend/src/auth` | 4 | 54 | | `screens.test.tsx` 26, `SignIn.test.tsx` 13, `Welcome.test.tsx` 9, `session.test.tsx` 6. |
| `arcnave-frontend/src/generative-ui` | 3 | 19 | | `generativeUi.test.ts` 8, `visualQa.test.tsx` 7, `visualBlock.test.tsx` 4. |
| `arcnave-frontend/src/brand` | 1 | 21 | | `brand.test.tsx`. |
| CI-level checks | | | | `ci.yml` runs `tsc --noEmit` + `vitest run` (backend) and `tsc -b` + `vite build` + `vitest run` (frontend). No lint, no OpenAPI drift check (`npm run openapi` is manual), no sandbox Python tests, no migration-apply test on an empty database beyond the vitest global setup. |

Frontend check sum: 33 root + 4 auth + 3 generative-ui + 1 brand = 41 files; 257 + 54 + 19 + 21 =
351 cases.

## 3. Areas with zero tests (by test-file import search)

Method: a module counts as "no direct test" when no `*.test.ts` file imports it by path (Grep on
`from '.../<name>.js'`) and no test file carries its name. Indirect coverage through a route
integration test is noted. Line counts are from Grep.

| Module | Lines | Direct tests | Indirect coverage | Why it matters |
|---|---:|---|---|---|
| `backend/src/services/generation.ts` | 2,381 | none (no `generation.test.ts`) | route integration tests and `test/*` regression files | The turn pipeline. Branches that only fail on error paths (A-05) are untested. |
| `backend/src/services/runHub.ts` | 126 | none | `runResume.integration.test.ts` (4 cases, same instance only) | Replay window, `canReplayFrom`, end listeners and 5-minute retention have no direct test. |
| `backend/src/services/chatVersions.ts` | 88 | none | `chatVersions.integration.test.ts` (9) | Pure functions (`ownerAt`, `versionsAt`) are easy to unit test and have no unit test. |
| `backend/src/services/auth.ts` | 357 | none | `auth.integration.test.ts` (2 cases), `googleSignIn.integration.test.ts` (5) | Session issue, resolve, rehash, change-password have 7 cases between them. |
| `backend/src/services/webFetch.ts` | 131 | none | `tools/webExecutor.test.ts` mocks it (`webExecutor.test.ts:3-14`) | SSRF guard (`isForbiddenHost`) has no test at all (A-08). |
| `backend/src/services/webSearch.ts` | 197 | none | mocked in `uiExecutor.test.ts:7` and `webExecutor.test.ts` | |
| `backend/src/services/turnLog.ts` | 279 | none | read through `chats.integration.test.ts` | ADR-0050 log content. |
| `backend/src/services/accountExport.ts` | 161 | none | `dataControls.integration.test.ts` (6) | |
| `backend/src/services/sandboxCheckpoints.ts` | 37 | none | none found | Advisory-lock sweep that holds a transaction open (A-21). |
| `backend/src/tools/sandbox/signedUrl.ts` | 90 | none | none found | |
| `backend/src/providers/grounding.ts` | 221 | none | adapter tests touch it indirectly | Source extraction for citations. |
| `backend/src/services/memory/chatSearch.ts` | 146 | none | `memory.integration.test.ts` imports `chatExecutor` | Uses `getDb()` (A-16). |
| `backend/src/services/documents/{docx,pdf,pptx}Renderer.ts`, `parse.ts`, `images.ts`, `verify/*` | about 2,300 | `documents.test.ts` (26) covers the facade; `xlsxRenderer.test.ts` (4) | | Only the xlsx renderer has its own test file. |
| `backend/src/container.ts`, `app.ts`, `index.ts` | 270 / 224 / 119 | none | `createTestApp` builds the app | Engine selection (`container.ts:98-215`), shutdown order (`index.ts:61-93`) and rate-limit setup (`app.ts:93-101`) are never asserted. |
| `backend/src/errors.ts`, `logger.ts`, `plugins/context.ts`, `routes/health.ts`, `routes/account.ts` | 284 / 89 / 70 / 93 / 113 | none by name | `contentLeak.test.ts`, `dataControls.integration.test.ts` | |
| `backend/src/db/client.ts`, `db/migrate.ts` | 85 / 46 | none | | Pool settings and the boot-time migration (A-10) are untested. |
| `arcnave-frontend/src/api.ts` | 1,128 | no `api.test.ts` | imported by 10 test files (mocked or for `ApiError`/`errorCopy`) | The HTTP boundary has no test of its own. |
| `arcnave-frontend/src/workspace.tsx` | 1,233 | none | `Shell.test.tsx`, `ChatView.test.tsx` render `App` | Stream reconnect and settle logic (`mistakes.md` 2026-09-17, 2026-09-26) is reached only through `App` renders. |
| `arcnave-frontend/src/{Navigation,Pages,Panels}.tsx` | 702 / 1,027 / 962 | `Surfaces.test.tsx` (12) imports `Pages` and `Panels` | | `Navigation.tsx` has no import in any test. |
| `arcnave-frontend/src/{SharedPage,ShareLink,SlidesView,FilePreviews,StylesModal}.tsx` | 147 / 140 / 196 / 186 / 496 | `Styles.test.tsx` (5) touches the styles modal | | |

## 4. Concurrency and multi-instance coverage (what is absent)

| Property | Test found | Where |
|---|---|---|
| Concurrent version append is safe | yes | `routes/artifacts.integration.test.ts:162` |
| Semaphore never grants above the cap while racing | yes | `tools/sandbox/semaphore.test.ts:49` |
| Concurrent runs in the sandbox are isolated | yes (unit, fake) | `tools/execution/executionRuntime.test.ts:401` |
| A second `generate` on a busy chat is refused | yes (single instance, sequential) | `routes/chats.integration.test.ts:533` |
| Two simultaneous `generate` calls on one chat (the `activeRuns.has` / `set` gap, A-03) | **none** | |
| `generate` without attachments racing on `max(seq)` (A-03) | **none** | |
| Retry of a message that already has tool calls (A-04) | **none**: Grep `retryMessageId` in tests finds 3 uses (`chats.integration.test.ts:629,645`, `officeTextOnce.integration.test.ts:88`); the first retries a plain-text answer with no tool rows | |
| Run on instance A, stop or reattach on instance B (A-01) | **none** | |
| Process death between `reserve` and `release` (A-06) | **none** | |
| `finalise` or `usage.record` throwing (A-05) | **none** | |
| SIGTERM while a detached run is writing (A-02) | **none** | |
| Rate-limit key is the signed-in user, not the proxy address (A-09) | **none** | `routes/*` tests raise limits to 10,000 (`harness.ts:173-175`), so the limiter never fires |
| Migration run twice concurrently (A-10) | **none** | `db/journal.test.ts` checks stamps only |

## 5. Tests that exercise fakes more than behaviour

- Provider adapters: `anthropic.adapter-loop.test.ts` and `gemini.adapter-loop.test.ts` use scripted
  fake SDK clients. `mistakes.md` records two defects that only appeared live because the fake
  accepted anything (2026-09-19 schema mutation by the Gemini SDK; 2026-09-24 a Gemini request shape).
- Route integration tests: all use `FakeProvider`; retries are shortened by `PROVIDER_RETRY_BASE_MS=5`
  (`harness.ts:178`). That shows the retry loop retries; it does not show the real SDKs stay at one
  request per attempt. The only ER-1 guard is `providers/anthropic.firstParty.test.ts:21`
  (`maxRetries` is 0). Nothing guards the google-genai side (`gemini.ts:349-353` sets no retry option;
  Grep for `retryOptions|attempts` in `providers/gemini.ts` and in tests: 0 matches).
- `services/architectureParity.test.ts` (5 cases) builds provider messages from literal fixtures
  and asserts their shape; it compares nothing against a second implementation.
- `test/contentLeak.test.ts` covers the happy path and one error path (shadow mode); its own header
  lists the provider-error `log.warn({ err })` sites as uncovered. Grep finds 35 `{ err }` log calls
  outside tests and `scripts/` in 15 files.
