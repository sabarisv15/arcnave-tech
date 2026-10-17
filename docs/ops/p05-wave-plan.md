# tech-p05 wave plan — P08, P22, P13, P11, P21 (B0 gate)

Written 2026-10-17 by the orchestrator (Opus 5.5) from five read-only planning agents (Opus 5.5),
one per package, on `build/turn-jobs` = `origin/main` @ `65abe65` (PR #47 merged). Spec:
[`audit/NEW-PLAN.md`](audit/NEW-PLAN.md) P08 / P22 / P13 / P11 / P21, [`audit/DEFERRED.md`](audit/DEFERRED.md),
the stage checkpoints, and the owner decisions of 2026-10-16 (task tech-ops.3e + tech-p05).

**B0 verdict: no unresolvable overlap.** Every file two packages touch is listed in §3 and marked
**orchestrator-only**: a wave-2 agent may change it only additively, inside the hunk this plan names,
and the orchestrator resolves the merge (P22 → P13 → P11). The two semantic dependencies inside
wave 2 (P13 and P11 both want P22's per-call usage API) are resolved by a contract fixed here (§4),
so no agent waits for another.

## 1. Numbers fixed by the orchestrator

| Package | Wave | Migration | ADR | Branch / worktree base |
|---|---|---|---|---|
| P08 durable runs | 1 | `0030_durable_turns` | 0078 | `build/turn-jobs` @ `65abe65` |
| P22 data model + ledger | 2 | `0031_ledger` | 0079 | P08 head |
| P13 history, summary, title | 2 | `0032_history_summaries` | 0080 (also supersedes the Stage "Flash-Lite" helper text: all helpers = Claude Haiku 5.5) | P08 head |
| P11 error matrix, fallback | 2 | `0033_fallback_and_refusal` (unavoidable: a reload must show the switch label) | 0081 | P08 head |
| P21 boundaries, numbers | 3 | none | 0082 | wave-2 merged head |

ADR-0077 is taken (reply composer). `_journal.json` entries: 30, 31, 32, 33 in that order, each `when`
later than the one before (`src/db/journal.test.ts` enforces it); the orchestrator renumbers `when`
at merge if needed.

## 2. Package scope (DONE / SKIP)

OQ-25 default (ADR-0062): **no `company_id`** anywhere. OQ blocked items without a written default
are skipped and listed under OWNER ITEMS (§6).

### P08 — wave 1 (one commit `feat(p08)`, done as P08a backend core then P08b stream + client)
- `turns` table, partial unique index one queued/running turn per chat; `appendTurn` / regenerate
  under `FOR UPDATE` on the chat, 23505 → 409 `run_in_progress`.
- DB lease + fencing token + cancel flag (heartbeat / lease / cancel check, N-73); Stop and delete
  set `cancel_requested`; `activeRuns` removed.
- Throttled fenced text flush; sweeper (boot + every N-76) marks expired leases `interrupted`
  (text kept, usage `exact:false` zeros, `costUsd` null), expires reservations, ages idempotency keys;
  SIGTERM `drain()` inside Cloud Run's 10 s (N-73).
- `Idempotency-Key` end to end (same body → same turn; different body → 409 `idempotency_conflict`).
- Budget / policy precheck before the user message is saved → HTTP 402 / 400, no rows written.
- Typed `ack` frame first; one settle transaction (`settleTx`) in a fixed order used by success,
  error, `markTurnFailed` and the sweeper; `budget_reservations` rows with owner (turn) and expiry.
- Regenerate guarded in one transaction.
- SSE: `Last-Event-ID`, `snapshot`, named `ping` (N-24), send timeout, 60 s session re-check.
- DB statement / lock / idle timeouts (N-45), `SET LOCAL` for sweeps / exports / file jobs; pg
  timeout codes → 503 `unavailable`.
- Turn parameters persisted (`turns.params`, ids and enums only) + `loadTurnInput`.
- Frontend: reconnect jitter 1/2/4/8/16 s × 5 (N-46), Idempotency-Key per send, a controller per chat.
- SPLIT out (follow-up task, not P08): A-21 retention / checkpoint advisory locks; A-22 lost updates
  outside the turn (memory, password, PATCH, file delete).

### P22 — wave 2
- Per-call usage rows: `call_usage` provider event, `model_calls` ledger (monthly partitions,
  DEFAULT partition), turn total = sum of calls; `usage_source` `provider | provider_partial | none`
  (no "estimated", Invariant 3); `costUsd` null if any call unpriced.
- Effective-dated price book (`config/priceBook.ts` + `price_table`, no overlapping rows), Sonnet 5.5
  / Opus 5.5 / Gemini 3.8 Flash from the `.env.example` comments, Haiku 5.5 rows for P13's helpers
  (≤ 100K-token tier only; cache rates unknown → null, never 0).
- Reservation rows: builds on P08's `budget_reservations` (adds `status` settle link, `price_version`).
- Deletion ledger in object storage (requested / completed, ids and counts only).
- Regenerate keeps the old answer as a version (ADR-0038 versions; supersedes ADR-0038 §5).
- Coded, allowlisted log lines (`logEvent`, `LOG_CODES`, `FIELD_ALLOWLIST`), four clocks (OD-8).
- Data map + sweep test (P5).
- **Moved to P22b (later task, not this run)** to keep wave-2 merges tractable: UUIDv7 + `updated_at`
  (P2), TB1 columns + paging, TB8 feedback table, F4c, F8b, OD-15b telemetry, V-20 / V-21.
- SKIP (owner items): rupee reservation + daily ceiling and money as decimals (OQ-27); message
  text / metadata split (OQ-25 has no default for "split now"); search text out of URLs (OQ-18);
  N-02 32 k and the 23-day purge value (OQ-15).

### P13 — wave 2
- Claude Haiku 5.5 as a **helper** registry row (`role: 'helper'`, never in `/models`, Auto or chat
  aliases; ADR-0055's three chat models unchanged), `MODEL_HAIKU`, thinking off for helper calls,
  `classify()` (structured output) in `providers/anthropic.ts`. No helper fallback: unavailable →
  job skipped with a code (Invariant 1).
- `summaries` table (`covers_upto_message_id`, branch-path aware, copied on branch), 60 % trigger
  (provider count API, OQ-08 allows it; no estimator), last 6 turns verbatim (N-16, N-77),
  `<earlier_conversation_summary>` escaped; Normal input budget (N-03).
- HIST-WINDOW + turn stamps + REC prompt text (`prompts/system/recovery/continue-v1.md`).
- Title job (N-76, 40 output tokens), `chats.title_source`, compare-and-set so a rename wins.
- Router M2 shadow (`ROUTER_SHADOW` off by default; never awaited; one coded log line).
- OQ-09 (CXD-5 written default): compaction retired behind its flag after the summary switch;
  ADR-0080 supersedes ADR-0019 / ADR-0027 for that part.
- SKIP (owner items): router intent enum (none written); N-75 local estimate (OQ-08).

### P11 — wave 2
- `providers/gateway.ts`: retries and the fallback chain live here only (SDK `maxRetries: 0` stays).
- Classifier (`failures.ts`), finish mapping (`finish.ts`, `blocked` / `interrupted` / `other` /
  `max_tokens`), the 30-row matrix M-01…M-30 (planning report kept in the P11 brief).
- Breaker (N-47), kill switch `MODELS_DISABLED`, retry budget (N-47 10 %).
- Labelled fallback (OQ-02 A): `model_switch` event + `done.fallback`, stored on the message
  (`messages.fallback_from / fallback_reason`), shown in the UI; fixes `modelRouting.ts:56` (K-15).
- Thinking-400 repair (one round, no tool re-run); Gemini safety thresholds explicit (SD-9a).
- Tool timers from config (N-43) except run_code (P18); forced answer through the gateway.
- Support code + `/status` incident banner (ER-12a/b).
- SKIP (owner items): ER-4a/b first-token / stall timers (OQ-16); ER-4d deadline value (OQ-15);
  ER-11 RFC 9457 body (OQ-17); E18 token-bucket capacity (no register value, ships off); the retry
  budget's minimum reserve of 2 (ours, needs the owner's OK — shipped as config, default 2).

### P21 — wave 3
- Container injection (memory, compaction, chat search), no module-level `getDb()` outside the
  container; numbers wired with N-id comments (values unchanged); ESLint backend + frontend in CI;
  silent catch sites typed / logged / marked; auth read path without writes; SSE through Fastify
  hooks (built on P08's `streamRun`); per-route body limits; openapi ↔ frontend contract test;
  dead code out. Inventories re-run against the wave-2 head.
- Exit tests: `numbersGuard.test.ts`, `moduleBoundaries.test.ts`, ESLint step in `ci.yml`.
- SKIP (owner items): OQ-15 values N-01, N-35, N-39 (+ N-06 / N-74 without P10 profiles); OQ-29
  OpenAPI type generator; OQ-13(b) renderers vs skills; A-19 flag defaults; repo `CLAUDE.md`
  additions (S21-02) are proposed in the ADR, not written, unless the owner confirms.

## 3. Shared files — orchestrator-only (wave 2)

"Additive hunk" = new export / new column / new case; no reorder, no rename, no reformat.

| File | P22 | P13 | P11 | Rule |
|---|---|---|---|---|
| `backend/src/db/schema.ts` | ledger tables, columns | `summaries`, `chats.titleSource`, stamps | `messages.fallback*`, `usage_records.refusalCategory` | each package appends its own block at the end of the file under a `// --- P<NN>` banner; new columns on existing tables go in that table's definition, one line each |
| `backend/drizzle/meta/_journal.json` + snapshots | 31 | 32 | 33 | orchestrator regenerates snapshots in merge order |
| `backend/src/container.ts` | pricing, ledger, deletionLedger | helper provider, job runner | gateway | one field each in `Services` + one construction line |
| `backend/src/config/numbers.ts` | — | N-16 / N-03 / N-76 / N-77 / N-69 entries | N-47 / N-43 entries | append under a `// --- P<NN>` banner |
| `backend/src/config.ts`, `.env.example` | `PRICE_SOURCE`, `DELETION_LEDGER_PREFIX` | `MODEL_HAIKU`, `ENABLE_HISTORY_SUMMARY`, `ROUTER_SHADOW` | `MODELS_DISABLED`, `INCIDENT_BANNER`, `FALLBACK_ENABLED`, rate limit | append only |
| `backend/src/app.ts` | — | — | `/status` route | one register line |
| `backend/src/providers/types.ts` | `call_usage` event | `thinking?: 'off'` | `ProviderError.kind / partialUsage` | additive members only |
| `backend/src/providers/anthropic.ts` | emit `call_usage` at each round end | `classify()`, thinking off | error-type classifier, thinking-400 repair | P22 touches only round-end usage sites; P13 adds a new method + one param branch; P11 owns error handling |
| `backend/src/providers/gemini.ts` | emit `call_usage` | — | finish mapping, safety settings | as above |
| `backend/src/providers/registry.ts` | — | helper row + `role` | `MODELS_DISABLED`, chain lookup | additive |
| `backend/src/services/usage.ts` | owner (ledger) | — | `refusalCategory` passthrough only | P11: one optional field |
| `services/turn/streamAndCollect.ts` | collect `call_usage` into `state.calls` | — | gateway call, failure → finish | P22: event case only; P11 owns the call / error flow |
| `services/turn/{settle,forcedAnswer,events,turnState,turnContext}.ts` | ledger write in `settleTx`, calls | post-settle job hook (`settle.ts`) | fallback label, finish | each adds a named step; nobody reorders `settleTx` (P08) |
| `services/turn/{prepareTurn,modelRouting}.ts` | — | shadow router hook, summary in context | K-15 chain | P13: one call site each; P11 owns `modelRouting.ts` |
| `services/turn/turnStart.ts` | regenerate → new version | `title_source` on insert | — | separate functions |
| `services/generation.ts` | timing log → `logEvent` | — | hop loop | P11 owns the run loop |
| `backend/src/routes/chats.ts` | versions, active version | PATCH `title_source`, copy summaries | DTO `fallback*` | separate handlers |
| `backend/src/test/harness.ts` | fake emits `call_usage` | fake count API, helper fake | two fakes / error injection | additive options |
| `arcnave-frontend/src/{types,workspace,adapter,api}.ts(x)` | version switch | title refresh | switch label, banner | additive |
| `docs/openapi.json` | — | — | — | orchestrator regenerates once after each merge |
| `mistakes.md`, `docs/checkpoints/CURRENT.md`, `DEFERRED.md` | — | — | — | orchestrator only; agents report lines in their result file |

Wave 1 (P08) and wave 3 (P21) run alone and may edit any file.

## 4. Wave-2 contracts (so nobody waits)

- **Per-call usage (P22 → P13, P11).** P22 defines `CallUsage` in `providers/types.ts`:
  `{ ordinal, attempt, role, providerModelId, usage, usageSource, finishReason, providerRef?, ttftMs?, durationMs? }`
  and `ledger.recordCalls(tx, turnRef, calls)`. P13's helper jobs and P11's attempts build the same
  shape locally with a `// P22 contract` comment; the orchestrator wires them to `recordCalls` at merge.
- **Settle order (P08).** Wave-2 packages add steps to `settleTx` by name; the order fixed by P08 stays.
- **Helper rows (P13 → P11).** P11's fallback chain never selects a row with `role: 'helper'`; helper
  calls never feed the breaker.

## 5. Process

- Each wave-2 agent: worktree, `git reset --hard <P08 head>` and check `git log -1` before work
  (mistakes.md 2026-10-16, stale worktree base); own test database
  `TEST_DATABASE_URL=postgres://arcnave:arcnave@localhost:5432/arcnave_test_p<NN>`; own files; own
  commit; no push; no `mistakes.md` / `CURRENT.md` / `DEFERRED.md` edits.
- Orchestrator: merge P22 → P13 → P11, backend `tsc` + `vitest` after each; `npm run db:migrate`
  on (1) an empty database and (2) a copy of a seeded database with backfill checks; then push.
- Per package: ADR, `docs/ops/p<NN>-result.md`, `docs/ops/p<NN>-live-checklist.md`, `openapi.json`.

## 6. OWNER ITEMS collected at plan time

OQ-15 values (N-01, N-02, N-33 purge days, N-35, N-39, turn deadline; N-06 / N-74 without P10);
OQ-16 first-token / stall timers; OQ-17 error body; OQ-18 search text in URLs; OQ-25 message
text split now; OQ-27 money as decimals, rupee ceiling; OQ-29 OpenAPI generator; OQ-13(b);
router M2 intent enum; E18 token-bucket capacity; retry-budget minimum reserve (ours, default 2);
A-19 default-off flags; S21-02 `CLAUDE.md` additions; P13's "drop turns older than 6 only once a
summary covers them" (ours).
