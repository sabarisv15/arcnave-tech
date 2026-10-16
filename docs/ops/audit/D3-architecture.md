# D3 — Architecture flaws: deep-dive audit

Sources read: `CLAUDE.md`, `mistakes.md` (headings and the entries on storage, migrations, stop races,
fakes), ADRs 0009, 0015, 0028, 0050 (0010, 0021, 0024, 0026 read through their citations in code and
`docs/deploy/warm-sandbox.md`), `docs/checkpoints/CURRENT.md` (scaling lines), Stage 4 checkpoint
and L4 final lock, Stage 5 data model and flows, Stage 8 checkpoint and tool doc, Stage 10 checkpoint,
Stage 15 checkpoint (with its doc-syncs to 2026-10-13), Stage 19 checkpoint, and about 60 files under
`backend/src`, `backend/sandbox`, `arcnave-frontend/src`. Static read only: nothing was run, so every
behavioural claim is "from the code as written" and a few are marked "prove with a test".
`.env.example` could not be read (permission denied for this auditor), so config drift against it is
not assessed. The reference handbook (`reference/claude-managed-agents-handbook.pdf`) is absent and
is not cited anywhere below. Every pattern proposed in section 3 is labelled "ours" where no locked
stage names it. Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Companion file:
`docs/ops/audit/_parts/evidence-d3.md` (test inventory). Paths are relative to `D:\arcnave-tech`.

Size key for fix options: S under one day, M one to three days, L a week or more. Stage ids come from
`docs/architecture/`.

## 1. Summary verdict

The owner's impression is right. The repo is a single-instance, single-user process whose design
shows in the failure paths. The happy path is carefully built (typed errors at the edge, FOR UPDATE on
artifact versions, a Postgres semaphore for the sandbox, a content-leak test). The failures cluster in
five places:

1. **Run state lives in process memory and is not durable** (A-01, A-02, A-03, A-04). The backend is
   deployed with up to 8 instances (`docs/checkpoints/CURRENT.md:1211-1212`), yet the "one run per
   chat", stop, replay and cancel machinery is a per-process `Map` plus an in-memory event buffer
   (`backend/src/container.ts:71-74`, `backend/src/services/runHub.ts`). Answer text is written to the
   database only at the end of the turn, there is no reaper for rows left `generating`, and SIGTERM does
   not wait for runs. Stage 5 (turn row, lease, fencing, cooperative cancel by DB flag) prescribes the
   database half of the fix, and that half does not depend on Redis or Cloud Tasks.
2. **Money and state are written in several separate commits** (A-05, A-06). The turn's message row,
   usage ledger, token counters and budget reservation are independent writes with two different
   orderings (success path and error path). A crash or a thrown write loses spend or leaks budget.
3. **Boundaries drawn in the docs are not drawn in the code** (A-07, A-13, A-14, A-16). Retry logic sits in
   the orchestration service instead of behind the provider boundary; no circuit breaker exists; the
   "service container" is bypassed by global `getDb()` singletons; a 2,381-line service and a 1,215-line
   route own most of the product.
4. **Security-relevant guards are weaker than the locked rule** (A-08, A-09, A-10, A-24): the SSRF guard
   is a hostname regex with no DNS check, the rate-limit key is the proxy address and is computed before
   the session is resolved, migrations run at boot with `|| true`, and a shell string is built in the
   Docker path of the CLI runner.
5. **Tests prove the fakes** (A-27): no unit test for the turn pipeline, run hub, auth service or SSRF
   guard; no test for any concurrency, multi-instance or crash case in the list above; Python sandbox
   tests are not in CI.

Counts: 27 flaws. P0: 0. P1: 12 (A-01 to A-12). P2: 15 (A-13 to A-27). No P0 because none of the
findings loses committed user data or exposes another user's data on the current single-user,
single-tenant deployment; several become P0 once a second user or a second instance is real (A-01,
A-03, A-09).

Fifteen flaws (A-01, A-02, A-05 to A-12, A-19 to A-21, A-23, A-24) have a locked stage decision that
prescribes the outcome; A-03, A-15 and A-16 are partly prescribed; the rest are repo rules or ours.
Each flaw says which. Three flaws touch decisions this audit does not resolve and are in section 5
(B-4 and the fallback chain, TD-4b versus the warm sandbox, the database version).

What is solid and should be kept as the pattern: version append under `FOR UPDATE`
(`backend/src/routes/artifacts.ts:556-627`, test at `artifacts.integration.test.ts:162`); the advisory-lock
semaphore with leased rows (`backend/src/tools/sandbox/semaphore.ts:37-47`); SDK retries off for Claude
(`backend/src/providers/anthropic.ts:51`, guard at `anthropic.firstParty.test.ts:21`); the error handler
that logs type, code and SQLSTATE and never the message (`backend/src/app.ts:172-186`); the
no-unused-config test (`backend/src/configUsage.test.ts`).

## 2. Module map

### 2.1 Layers as the repo has them (backend/src)

Line counts are non-test source lines from Grep, rounded.

| Folder | Lines | What it holds | Notes |
|---|---:|---|---|
| `app.ts`, `index.ts`, `container.ts`, `plugins/context.ts`, `config.ts`, `config/numbers.ts`, `errors.ts`, `logger.ts`, `errorLog.ts`, `openapi.ts`, `types.ts` | 1,740 | Bootstrap, DI, auth hook, config, error catalogue | `container.ts` builds sandbox engines (`:98-215`) and a 12-field `Services` object. |
| `routes/` | 5,900 | HTTP handlers, Zod DTOs, direct Drizzle queries | At least 39 direct `db`/`tx` statements in 9 files (Grep); `chats.ts` 1,215 lines, `projects.ts` 863, `artifacts.ts` 682, `files.ts` 572. |
| `services/` | 14,400 | Turn pipeline (`generation.ts` 2,381), usage, auth, retrieval, memory, compaction, documents, attachments, ui, promptCache, analytics, retention | One flat folder mixing orchestration, domain and infrastructure clients. |
| `providers/` | 2,900 | Gemini and Claude adapters, registry, routing, capability table, grounding | No gateway wrapper: retry and timeouts live in `services/generation.ts`. |
| `tools/` | 5,300 | Tool definitions, executors, `execution/executionRuntime.ts` (818), `sandbox/*` clients (Cloud Run Job, warm service, local process) | Four execution engines (A-24). |
| `db/` | 1,100 | Drizzle schema (966), client, migrator | No repository layer; no company column anywhere. |
| `capabilities/` | 180 | Runtime capability registry that feeds the prompt | Ours. |
| `scripts/` | 4,650 | 24 one-off live scripts and evaluators, compiled with the app | Four import model SDKs directly (A-19). |
| `test/` (harness, fixtures, kit data) | 1,800 | Test support | |

Frontend (`arcnave-frontend/src`): 132 `.ts`/`.tsx` files, most in one flat folder plus `auth/`,
`brand/`, `generative-ui/`. Nine files over 650 lines (A-15).

### 2.2 Stage 4 layers against the repo

| Stage 4 layer (`00-checkpoint-stage4.md:6-14`) | Repo location | Match |
|---|---|---|
| L1 Client | `arcnave-frontend/src` | Present; hand-written API types (A-15). |
| L2 Edge (CDN, WAF, rate limit, hostnames) | none in repo; cookie `SameSite=None` cross-origin posture in `api.ts:19-29` | Infra; see Q4. |
| L3 API | `app.ts`, `routes/`, `plugins/context.ts` | Present; routes also hold SQL and orchestration (A-14). |
| L4 Orchestration (Turn Executor, planner, policy, validator; O-3 = API + Turn Executor + worker, `04-L4-final-lock.md:7`) | `services/generation.ts`, `services/routing/turnRouter.ts`, `providers/toolLoopPolicy.ts`, `services/answerProtocolGuard.ts`, `services/ui/validator.ts` | One in-process god service; no turn row, lease or executor boundary (A-01, A-13). Policy engine P1-P8 and validator V1-V8 are not separate components. |
| L5a Model gateway (G10 breaker, G15 normaliser, ER retry matrix) | `providers/*` (adapters, registry) plus retry in `services/generation.ts:1367-1453` | Partial: normaliser yes (`ProviderEvent`), breaker no, retry outside the boundary (A-07). |
| L5b Context service | `services/systemPrompt.ts`, `promptCache/`, `compaction/`, `history/`, `attachments/` | Present, scattered. |
| L5c Retrieval service | `services/retrieval.ts` | Whole-project scan in Node memory (A-11). |
| L5d Memory service | `services/memory/*` | Present; uses global `getDb()` (A-16). |
| L5e Tool service | `tools/*`, `services/webFetch.ts`, `webSearch.ts` | SSRF guard weak (A-08). |
| L5f Speech service | none server-side; `arcnave-frontend/src/Dictation.tsx` | Not built (other auditor). |
| L5g Safety service | `services/memory/privacy.ts`, `answerProtocolGuard.ts`, `ui/validator.ts` | No input-safety component (other auditor). |
| L6 Async (worker, outbox, jobs, DB-polling dispatch loop `ER-7`) | `setInterval` sweeps in `index.ts:21-58`; detached promise in `routes/chats.ts:585` | No job table, no worker (A-20, section 4). |
| L7 Data | `db/schema.ts`, Drizzle | No `company_id`, no RLS context, no repository layer (section 4). |
| L8 Platform | `Dockerfile`, CI, `docs/deploy/` | Migrations at boot (A-10). |

## 3. Flaw register

Format per flaw: evidence, severity, blast radius, whether a locked decision prescribes the outcome,
two fix options, pick. "Ours" means no stage names the pattern. Where a pick has several commits, each
commit keeps the app runnable (additive change first, switch second, delete last).

---

### A-01 — Run control state is a per-process Map and an in-memory buffer
- **Evidence:** `backend/src/container.ts:71` (`activeRuns: Map<string, AbortController>`) and `:74`
  (`runHub: RunHub`); `backend/src/routes/chats.ts:568` (`activeRuns.has`), `:582-583` (`set`,
  `runHub.start`), `:685-686` (reattach reads the hub), `:707-711` (stop aborts only a local
  controller and answers `stopped: false` otherwise), `:446` (chat delete aborts local runs only);
  `backend/src/routes/account.ts:104`; `backend/src/index.ts:71` (shutdown walks `activeRuns`);
  `backend/src/services/runHub.ts:10-12` ("in-process by design"). `RunHub.abortAll`
  (`runHub.ts:123`) has no caller (Grep). ADR-0009 "Consequences" admits multi-instance live resume is
  "not built". Deployment scales to 8 instances (`CURRENT.md:1211-1212`).
- **Severity:** P1. **Blast radius:** with more than one instance (a) two runs can start on the same
  chat, (b) Stop silently does nothing when it lands on another instance, (c) reattach returns
  `no_active_run` while the answer is still being produced, and the UI then polls a message whose text
  is empty because text is saved only at the end (A-02), (d) account deletion and chat delete cannot
  stop remote runs. Default Cloud Run request routing makes (b) and (c) likely, not rare.
- **Locked decision:** yes, the outcome. Stage 5 F2 (`05-data-flow.md:37`: lease plus fencing, R13),
  `turns` table with `fencing_token` and `deadline` (`05-1-data-model.md:49`), Stage 10 AO-5
  (cooperative cancel by DB flag, `00-checkpoint-stage10.md:22`), Stage 15 ER-5 (DB fencing decides
  commits, client polls DB when the relay is down, `00-checkpoint-stage15.md:21`). The Redis relay and
  Cloud Tasks executor are owner-deferred; the DB lease, cancel flag and fencing are not infra.
- **Option A (M, ours: "run lease row"):** add columns to the assistant message row (or the small
  `turns` table Stage 5 names): `run_owner` (instance id), `lease_expires_at`, `cancel_requested`,
  `started_at`, `heartbeat_at`. `generate` claims with one conditional `UPDATE ... WHERE no live lease
  RETURNING`. A heartbeat extends the lease every few seconds. `stop` writes `cancel_requested`; the
  owning instance checks it on a short tick and on each tool round (AO-5). Keep `RunHub` as the
  same-instance fast path and as the seam for a later Redis relay. Risk: lease timing; a long provider
  call must not lose the lease (heartbeat from a timer, not from the loop). Breaks:
  `chats.integration.test.ts:533` (error path), `runResume.integration.test.ts` unchanged; ADR-0009
  gets an amendment, not a rewrite.
- **Option B (L):** build the full Stage 5 turn executor now: `turns` table, Cloud Tasks dispatch, Redis
  stream relay. Risk: needs the owner-deferred infra; the app would not run until both exist.
- **Pick: A.** It meets the outcome without the deferred infra, and it is the DB fencing that ER-5 says
  stays authoritative even after Redis arrives, so no rework later. Commit order: (1) migration adding
  nullable columns; (2) claim and heartbeat written alongside the existing Map; (3) stop and delete
  read the flag; (4) remove `activeRuns`.

### A-02 — Runs are not durable: text saved only at the end, no reaper, no drain on SIGTERM
- **Evidence:** `backend/src/services/generation.ts:2138-2156` (`finalise` is the only write of the
  answer text, called at `:1056` and `:1169`); Grep for `'generating'` in non-test code finds writes
  only at `chats.ts:1154,1202` and a same-process repair at `chats.ts:643-652`; `index.ts:21-58` has
  sweeps for sessions, retention and sandbox checkpoints and none for stuck messages;
  `index.ts:71-77` aborts controllers, then `app.close()`, `closeDb()` and `process.exit(0)` without
  waiting for the detached run promises started at `chats.ts:585` (nothing holds a handle to await).
  `mistakes.md` records the "stuck generating" symptom three times (2026-09-16, 2026-09-17 twice).
  Same pattern for project files: status `indexing` is set at `routes/projects.ts:418,502` and cleared
  only by the in-request `runIndex`.
- **Severity:** P1. **Blast radius:** every deploy, scale-in, OOM or crash during a turn leaves the
  assistant row `generating` forever (spinner after reload), loses the partial answer and the
  provider spend (no usage row, see A-05). Minutes of tool work are lost each time.
- **Locked decision:** yes. Stage 5 expiry rule (`05-1-data-model.md:150`), Stage 15 ER-4 ("checkpoint
  after every step ... OOM/SIGKILL path", `00-checkpoint-stage15.md:20`), ER-3 (keep partial text,
  finish code `interrupted`), "bill partial streams from last cumulative usage"
  (`00-checkpoint-stage15.md:31`).
- **Option A (S to M, ours: "sweeper plus text flush"):** (1) a sweeper in `index.ts` under a lease row
  (A-21) marks messages `generating` whose lease expired (A-01) as `error` / finish code `interrupted`,
  keeps `text`, writes a usage row from the last known counters; same for `indexing` files. (2) The
  run flushes `text` and `segments` to the row every few seconds (a throttled `UPDATE`) so a reattach on
  another instance and a crash both show the partial answer. (3) On SIGTERM, `RunHub` returns a drain
  promise; shutdown waits up to the Cloud Run grace period before `closeDb()`.
- **Option B (L):** step checkpoints (Stage 5 F2 `checkpoint + schema_version`) and resume from the
  last step on any instance. Needs the executor from A-01 option B.
- **Pick: A.** Safe order: sweeper first (changes nothing for healthy rows), then flush, then drain.
  Tests to add: kill-between-writes simulation; SIGTERM with a running fake turn.

### A-03 — Concurrent send: check-then-set gap and unlocked `max(seq)`
- **Evidence:** `backend/src/routes/chats.ts:568` checks `activeRuns.has`, awaits `appendTurn` or
  `resetForRetry` at `:574-576`, and only sets at `:582`; a second request can pass the check in that
  window. `appendTurn` takes `FOR UPDATE` on the chat row only when attachments are present
  (`chats.ts:1096-1098`) and allocates `coalesce(max(seq), -1) + 1` at `:1125-1129`. The unique index
  `uq_message_seq` (`backend/src/db/schema.ts:310`) stops duplicate rows, but the loser gets a raw
  unique-violation that `app.ts:175-186` turns into `internal_error` (500), not a typed code.
  `CLAUDE.md` rule: "A transaction is not a lock ... Not a bare SELECT max(...)". The same bare-max
  pattern is at `routes/projects.ts:191-194` (`position`) and `services/generation.ts:2063`
  (`researchEvents.ordinal`, guarded by `onConflictDoNothing`).
- **Severity:** P1 (double click, two tabs, or two instances). **Blast radius:** a duplicated user turn
  cannot be stored (good), but the loser sees a generic 500 and the winner may already be streaming.
  With two instances the in-memory guard is absent entirely (A-01).
- **Locked decision:** partly. Stage 5 `turns` plus lease (A-01) removes the race; the `FOR UPDATE`
  rule is the repo's own invariant (`CLAUDE.md`). Idempotency for sends is ER-10 ("send retry same
  Idempotency-Key", `00-checkpoint-stage15.md:26`), see A-19.
- **Option A (S):** always lock the chat row at the top of `appendTurn` (move the `.for('update')` out of
  the `if`), and claim `activeRuns` synchronously before the first `await`. Map the unique-violation on
  `uq_message_seq` to `run_in_progress`. Risk: low. Breaks: none expected; add the two missing tests.
- **Option B (M):** per-chat sequence counter column incremented in the same `UPDATE ... RETURNING`
  (ours: "counter row"). Risk: migration plus backfill; also touches branch copy (`copyMessages`
  writes explicit seqs).
- **Pick: A**, and fold the claim into A-01's lease so it holds across instances.

### A-04 — Retry (regenerate) is unguarded writes and keeps stale tool calls
- **Evidence:** `backend/src/routes/chats.ts:1196-1212`: delete sources, delete research events, update
  the message; no transaction. It does not delete `tool_calls`. A new attempt numbers its events from
  `contextEvents.length` (`generation.ts:880`, `eventOrdinal++` at `:998`) and writes each tool call
  with `onConflictDoNothing` (`generation.ts:2107`) against `uq_tool_call_ordinal` (`schema.ts:397`).
  So leftover rows from the first attempt win and the new attempt's calls at the same ordinals are
  dropped without error. There is also no check that the message is the latest turn or that it is not
  `generating` on another instance. The one retry test (`chats.integration.test.ts:608-637`) has no
  tool rows.
- **Severity:** P1 (wrong tool history shown and replayed to the model on later turns, since
  `loadToolCalls` feeds history, `services/history/toolHistory.ts`). **Blast radius:** every regenerate
  of a tool-using answer. Prove with a test: run a tool turn, retry with different scripted tools, read
  `tool_calls`.
- **Locked decision:** ours (the data model names `tool_calls` per model call, `05-1-data-model.md:52`,
  not this table).
- **Option A (S):** one transaction: conditional `UPDATE messages SET status='generating' ... WHERE id AND
  status <> 'generating' RETURNING`, then delete sources, events and tool calls, then reset. Risk: low.
- **Option B (M):** make a retry a new assistant row on the same user turn with a version pointer (the
  tree in Stage 5 `messages.parent_id`). Risk: touches versions UI and `chatVersions.ts`.
- **Pick: A.** Add the tool-row retry test first (it should fail today).

### A-05 — A turn is settled by independent commits, in two different orders
- **Evidence:** error path `generation.ts:1056-1084`: `finalise` then `releaseReservation` then
  `usage.record`. Success path `:1169-1205`: `finalise`, `usage.record`, with the release in a
  `finally` at `:1095-1097`. `finalise` itself is three statements with no transaction
  (`:2138-2180`: message update, sources delete plus insert, chat touch). `usage.record` is an insert
  into `usage_records` followed by a second transaction that bumps counters (`services/usage.ts:341-371`).
  If `finalise` throws, no usage row is written although the provider billed; if `usage.record` throws
  after `finalise`, the message says `complete` while the route emits an `error` frame
  (`routes/chats.ts:629-654`) and the status guard `WHERE status = 'generating'` matches nothing. The
  forced-answer request at `generation.ts:1119` is a separate provider call whose usage is added later
  (`:1136`) and is lost if the process stops in between.
- **Severity:** P1. **Blast radius:** spend invisible or double counted; message state and ledger can
  disagree; support cannot tell from the database whether a turn finished.
- **Locked decision:** yes. Stage 5 F2 ("settle usage per call -> final assistant message + turn DONE in
  DB (fencing check)", `05-data-flow.md:37`), GG6 (reservation released or settled on every end state,
  `05-2-flows.md:68`), Stage 15 ("bill partial streams", `00-checkpoint-stage15.md:31`).
- **Option A (M, ours: "one settle function"):** `settleTurn(tx, {...})` does message update, sources,
  usage record, counter commit and reservation release in one transaction, called from both paths and
  from the sweeper in A-02. Risk: touches the money path; characterise first (A-27). Breaks:
  `usage.test.ts`, `usage.integration.test.ts`, `longChat.integration.test.ts` expectations of write
  order.
- **Option B (S):** reorder the error path to match the success path and wrap `finalise` in a
  transaction only. Leaves the counter commit separate.
- **Pick: A**, staged: add `settleTurn` beside the old code and make the error path use it; then the
  success path; then delete the duplicated blocks. Review item (money, DB).

### A-06 — Budget: two sources of truth, reservations with no owner or expiry
- **Evidence:** enforcement reads `usage_counters` (`services/usage.ts:258-274`, `uq_usage_period` at
  `schema.ts:663`); the displayed state sums `usage_records` (`usage.ts:376-390`, `budgetState`). A
  reservation is a bare `tokens_reserved + n` on the counter (`usage.ts:270`) with no turn id and no
  expiry; a crash between `reserve` (`generation.ts:694`) and release leaks the amount until the period
  rolls (the monthly counter keeps it for a month). `routes/styles.ts:201` reserves a literal `2048`,
  `:222` and `:237` swallow release and record failures (`.catch(() => {})`), `:168` takes
  `available[0]` as the model instead of the user's choice, and the route calls the provider directly
  through `summarizeStyleSamples` (`:210`), outside the turn pipeline and its retry and timeout.
- **Severity:** P1. **Blast radius:** users are blocked by phantom reservations; spend caps drift from the
  ledger; a styles call leaks budget silently.
- **Locked decision:** yes. Stage 5 `budget_reservations(id, company_id, turn_id, amount, status)`
  (`05-1-data-model.md:74`), R2, GG6 (`05-2-flows.md:68`), `usage_ledger` as the source (`:75`).
- **Option A (M):** `budget_reservations` rows keyed by message id with `status` and `expires_at`;
  `reserve` inserts, `settle` closes (inside A-05's transaction), the A-02 sweeper expires them;
  counters become a cache derived from the ledger. Route the styles call through a shared
  `runUtilityCall()` (ours) that reserves and settles the same way. Risk: M, touches enforcement.
- **Option B (S):** keep counters, add a reconcile job that recomputes `tokens_used` from
  `usage_records` and zeroes `tokens_reserved` for users with no `generating` message.
- **Pick: B first** (safe, additive, closes the leak), **then A** with A-05. Do not change the
  enforcement read until the reconcile job has run clean for a period (money path, owner OK).

### A-07 — Retries, timeouts and ER-1 live outside the provider boundary; no breaker
- **Evidence:** `services/generation.ts:1367-1453` (`streamWithRetry`, overflow retry) and `:2343`
  (`retryDelayMs`); `providers/anthropic.ts:4-6` points back at that function. The forced-answer
  request calls `provider.stream` directly (`generation.ts:1119`) with no retry and no typed timeout
  mapping. No circuit breaker, health route-away or fallback chain exists (Grep `breaker|circuit`: none).
  The Gemini client is built with no retry option (`providers/gemini.ts:349-353`) and no test pins one
  request per attempt (Grep `retryOptions|attempts` in `gemini.ts` and tests: 0 matches; the Claude guard
  is `anthropic.firstParty.test.ts:21`). Provider errors are logged as `String(err)`
  (`generation.ts:1414,1449`), which can carry content (NO_CONTENT enforce is owner-deferred; noted as a
  shadow finding only).
- **Severity:** P1. **Blast radius:** one transient 503 in the forced-answer path fails a turn that the
  main path would have retried; a hidden SDK-level re-send on the Gemini side would double requests
  and billing without the repo noticing.
- **Locked decision:** yes. ER-1, ER-2, ER-13 (`00-checkpoint-stage15.md:17-18,29`), ER-1 google-genai
  details (`:36`, `:66`), Stage 4 L5a (`04-L5a-model-gateway.md`), `CLAUDE.md` forbidden list ("retries
  live in the app gateway"). The repo's boundary equivalent is `backend/src/providers/`.
- **Option A (M, ours: "GatewayProvider decorator"):** a `Provider` wrapper in `providers/` that owns
  retry, overflow trim, first-event bookkeeping, typed timeout mapping and a per-alias in-process
  breaker (ER-13 says per model and instance). The registry hands out the wrapped provider; the forced
  answer uses it too. Gemini: set explicit single-attempt options and add the stub-count guard test.
  Risk: M; behaviour must stay identical (existing `retryPolicy.test.ts`, `providerTimeout`,
  `batch6OverflowStreamingSafety`). Breaks: tests that spy on `streamWithRetry`.
- **Option B (S):** only route the forced-answer call through `streamWithRetry` and add the Gemini guard
  test. Leaves the boundary where it is.
- **Pick: A**, and commit one is B's two edits (they sit inside A anyway). The fallback chain is not part
  of this pick: see Q1.

### A-08 — The SSRF guard is a hostname regex
- **Evidence:** `backend/src/services/webFetch.ts:19-37` (pattern list), `:61` (check), `:82`
  (`redirect: 'follow'`), `:89-93` (final URL checked after the request was sent), `:95-96` (whole body
  read with `response.text()` before the 1 MB slice). No DNS resolution: a public name that resolves to
  an internal address, or `metadata.google.internal` (not in the list), passes. WHATWG `URL.hostname`
  returns IPv6 addresses in brackets, so `/^::1$/` and `/^fe80:/i` cannot match (prove with a test).
  Unlisted: `fc00::/7`, `100.64.0.0/10`, IPv4-mapped IPv6. Error text embeds the raw URL
  (`:54`). No test: only a mock in `tools/webExecutor.test.ts:3-14`. `web_fetch` is limited to URLs
  already in the conversation (`generation.ts:714`), which lowers but does not remove reach.
- **Severity:** P1 (security boundary, weak but not trivially exploitable). **Blast radius:** server-side
  requests to loopback or internal names from a user-supplied URL; memory growth from large bodies.
- **Locked decision:** yes. Stage 8 C2 ("block private/loopback/link-local/metadata IPs (IPv4+IPv6),
  check all DNS answers, no auto-redirect or re-check each hop", `08-tool-execution.md:39`), TX6 and TD-3
  (`:58,88`: own fetch service, OWASP rules, zero-permission SA), Stage 4 L5e T19.
- **Option A (S to M, ours: "resolve then pin"):** resolve all A and AAAA answers with `dns.lookup(all)`,
  reject any non-global address (RFC 1918, loopback, link-local, CGNAT, ULA, mapped, metadata names),
  connect to the vetted address (custom `lookup` on the undici agent), manual redirects (max 3, same
  check per hop), stream the body with a byte cap. Add unit tests for each class. Risk: low.
- **Option B (L):** a separate fetch service with a zero-permission service account (TD-3). Infra;
  owner-deferred.
- **Pick: A** now; B remains the infra target (Q8).

### A-09 — Rate-limit key is the proxy address and is computed before the session exists
- **Evidence:** `backend/src/app.ts:93-101` registers `@fastify/rate-limit` with
  `keyGenerator: request.user?.id ?? request.ip` before `contextPlugin` (`app.ts:107`), whose
  `onRequest` hook is what sets `request.user` (`plugins/context.ts:40-56`); the limiter's default hook is
  also `onRequest`, so it runs first and `request.user` is still null (prove with a test using two users
  and one address). `Fastify({...})` at `app.ts:56-72` sets no `trustProxy`, so `request.ip` is the peer
  address; behind Cloud Run that is the platform front end, not the caller. Auth routes
  (`routes/auth.ts:62,82,105,154`), account (`account.ts:93`) and share reads (`share.ts:96`) key on that
  address. The store is the default in-memory one, so each of up to 8 instances counts separately.
  Tests raise all limits to 10,000 (`test/harness.ts:173-175`), so no test can notice.
- **Severity:** P1. **Blast radius:** in production all anonymous callers share one bucket of 10
  sign-ins a minute per instance (one noisy client locks everyone out); signed-in users share the
  generate and write buckets (`numbers.ts:65-67`: 20 and 120 a minute) instead of having their own.
- **Locked decision:** yes for the outcome (per-user and per-IP limits, N-01 20/min per user,
  Stage 4 L3 A-3 / L2). The Redis store is owner-deferred; the key is not.
- **Option A (S):** set `trustProxy` to the platform hop count from config; register the limiter after
  the context plugin or resolve the session inside `keyGenerator`; add a test with a forwarded header
  and two users. Risk: low; a wrong `trustProxy` makes the header spoofable, so the hop count must be
  config, not `true`.
- **Option B (M):** move to a Postgres or Redis counter. Not needed for the key fix.
- **Pick: A.** The later Redis store (`@fastify/rate-limit` supports a `redis` option) is a config
  change on top.

### A-10 — Migrations run at container boot and failures are ignored
- **Evidence:** `backend/Dockerfile:69`: `node dist/db/migrate.js || true; exec node dist/index.js`.
  `db/migrate.ts:3-8` says a failed migration "stops the deploy"; the `|| true` makes the opposite true.
  `db/migrate.ts:17-19` claims the migrator takes advisory locks; `mistakes.md` 2026-09-18 records
  concurrent cold-start instances failing on `CREATE TABLE` and marks it "Not yet fixed"
  (`mistakes.md:379-381`). The service then runs against the old schema.
- **Severity:** P1. **Blast radius:** a failed or raced migration yields a running backend on a
  mismatched schema (500s on new columns) with a green health check.
- **Locked decision:** yes. Stage 19 IN14 / ID-13 (migrator as its own job before promotion, expand then
  contract, advisory lock on a dedicated session connection, `19-infrastructure.md:72`,
  `00-checkpoint-stage19.md:36`). The job layout is infra; fail-closed and serialised are outcomes.
- **Option A (S):** remove `|| true`; take `pg_advisory_lock(<fixed key>)` on the migrator's own
  single connection before `migrate()` and release after; exit non-zero on failure. Risk: a bad
  migration now blocks start (intended). Breaks: none in tests; add a two-process test.
- **Option B (M):** move migration to a separate Cloud Build step or Cloud Run Job (Stage 19 shape).
  Infra and owner-deferred; A is the first step of it.
- **Pick: A.**

### A-11 — Retrieval loads every chunk of the project into Node memory per query
- **Evidence:** `backend/src/services/retrieval.ts:451-486` selects all `file_chunks` of the project
  joined to ready files, then runs BM25 in JavaScript (`:489-535`). `file_chunks` has only a unique
  and a project index (`schema.ts:204-205`), no text-search index. Context assembly can additionally
  put whole files in the prompt up to 200,000 characters (`config.ts:171`, `generation.ts:106`).
- **Severity:** P1 (scale). **Blast radius:** query time and memory grow with project size; N parallel
  searches multiply it per instance. Invariant 4 (lexical, not semantic) is respected in outcome.
- **Locked decision:** yes. Stage 4 L7 D7 and the L7 header (`04-L7-data-layer.md:5,51`: BM25 in
  Postgres, separate retrieval pool with `statement_timeout`), Stage 12 (retrieval, not re-read here).
  The repo CI database is PG16 (`.github/workflows/ci.yml:24`) while `pg_textsearch` needs PG17+ (Q7).
- **Option A (M, ours: "SQL prefilter then JS rank"):** add a `tsvector` column and GIN index to
  `file_chunks`; fetch the top few hundred candidates with `ts_rank_cd`, keep the existing JS BM25 as the
  final ranker so results and tests keep their meaning. Risk: M; ranking differences. Breaks:
  `retrieval.test.ts` (26, pure ranking, unchanged), `projectKnowledge.integration.test.ts`.
- **Option B (L):** `pg_textsearch` BM25 after the database version moves (infra decision).
- **Pick: A**; B when Q7 is answered.

### A-12 — Warm sandbox keeps per-chat state in one long-lived process (against TD-4b), capacity 5
- **Evidence:** `docs/deploy/warm-sandbox.md:43-63` (`--max-instances=1`, `MAX_WORKSPACES=5` across all
  users, 2 concurrent runs); `tools/sandbox/warmSandboxClient.ts:1-14`; ADR-0010 and ADR-0015
  (workspaces checkpointed to storage on a one-minute sweep). Locked: "TD-4b is realised as a fresh Cloud
  Run Job execution per run ... no long-lived sandbox" (`00-checkpoint-stage8.md:11,126`; LV-28 "N/A",
  `00-lv1-register.md:36`); Stage 16 SE13 "per-run fresh sandbox". The repo also has the fresh-per-run
  engine (`tools/sandbox/cloudRunSandboxClient.ts`) and a local process engine
  (`processSandboxClient.ts`), selected in `container.ts:139-197`, with the default `auto`
  (`config.ts:242`).
- **Severity:** P1 (isolation outcome differs from the lock; hard site-wide cap of five chats with live
  workspaces). **Blast radius:** workspace eviction loses files written in the last five minutes
  (ADR-0015 consequence); one shared process for all users' code between runs.
- **Locked decision:** yes (TD-4b, SE13). Whether the warm service counts as a DIFF-INFRA is an owner
  call; this audit does not resolve it (Q2).
- **Option A (S):** make `cloud-run` the default engine and keep `warm` as an explicit opt-in; document the
  isolation difference. Risk: cold start 20-40 s per call (`mistakes.md` 2026-09-24) until the trusted
  local path covers common work.
- **Option B (L):** route by workspace and scale the warm service (Stage 8 does not ask for this).
- **Pick: A pending Q2.**

---

P2 flaws follow. They are real but need no immediate ordering.

### A-13 — `services/generation.ts` (2,381 lines) is one class, one 830-line generator
- **Evidence:** `GenerationService` ctor takes 11 positional arguments (`generation.ts:343-358`);
  `runTurn` runs from `:414` to `:1247`; it imports about 60 modules (`:16-109`), builds tool executors
  per turn (`:705-775`), duplicates persistence (A-05), holds singletons `memoryService` and
  `compactionService` (`:88,91`) and the retry loop (A-07).
- **Severity:** P2. **Blast radius:** every change to the turn risks the money path; no unit test (A-27).
- **Locked decision:** Stage 4 L4 lists twelve components (planner, policy, validator, executor, ...); the
  structure is ours.
- **Option A (M, ours: "extract stages, keep the facade"):** write characterisation tests through
  `GenerationService.run` first, then extract `resolveTurn`, `buildToolset`, `streamAndCollect`, `settleTurn`
  (A-05) as functions in `services/turn/`. Risk: M.
- **Option B (L):** rewrite as the Stage 10 step machine beside the old path and switch.
- **Pick: A.**

### A-14 — `routes/chats.ts` (1,215 lines) holds DTOs, SQL, version logic and run orchestration
- **Evidence:** DTO schemas `chats.ts:49-186`; transcript assembly `:900-996`; family and version load
  `:999-1024`; branch copy `:1031-1082`; turn append and retry `:1085-1215`; SSE writer `:784-834`;
  detached run closure `:585-659`. The chat list uses a correlated `not exists` with
  `coalesce(root_chat_id, id)` on both sides (`:219-225`), which cannot use `ix_chats_root` and is
  quadratic per page. `versionsAt` (`services/chatVersions.ts:49-88`) is recomputed on every `GET
  /chats/:id` for all family chats. The version number is derived, not stored, so no numbering race
  exists there; `PATCH` has the lost-update problem in A-22.
- **Severity:** P2. **Blast radius:** change risk and list latency for users with many versions.
- **Locked decision:** Stage 5 DF-2 prescribes a message tree (`05-1-data-model.md:45-46`); the repo uses
  copy-on-edit chat families (ADR-0038). Flag for the data auditor; not resolved here.
- **Option A (M, ours):** move transcript, version and turn code to `services/chats/*`; routes keep
  schemas and call services; add a stored `family_id` (`coalesce(root_chat_id, id)`) column and index for
  the list query.
- **Option B (L):** adopt the Stage 5 tree.
- **Pick: A.**

### A-15 — Frontend: nine monoliths, hand-written API types, hard-coded production URL
- **Evidence:** line counts: `Settings.tsx` 1,519, `App.tsx` 1,454, `workspace.tsx` 1,233, `api.ts` 1,128,
  `Pages.tsx` 1,027, `Panels.tsx` 962, `Composer.tsx` 851, `Navigation.tsx` 702, `DisplayCards.tsx` 677;
  132 files in a mostly flat `src/`. `api.ts:14-17` says the types are "transcribed" from the Zod
  schemas. The production API base is a literal Cloud Run URL (`api.ts:30-33`), cross-origin with a
  `SameSite=None` cookie the file itself calls "temporary" (`api.ts:19-29`); `mistakes.md` 2026-09-17
  records the earlier same-site failure. Reconnect delays are an 8-step literal (`adapter.ts:163`)
  where ER-10 locks 1/2/4/8/16 s with jitter and 5 attempts.
- **Severity:** P2. **Blast radius:** DTO drift is caught only at runtime; one screen's change touches a
  1,500-line file; the URL puts a project number into source (the Python repo forbids that; this
  repo's `CLAUDE.md` is silent, so Q4 asks).
- **Locked decision:** ER-10 (reconnect), Stage 4 L1 / L2 (hostnames, same-origin edge) partly; module
  size is ours.
- **Option A (M, ours):** split by feature folder, move the base URL to a build variable, add a contract
  test that fails when `docs/openapi.json` and `api.ts` field names diverge.
- **Option B (M):** generate types from `docs/openapi.json` (a new dev dependency; needs owner OK, Q6).
- **Pick: A**, then B if the owner approves the dependency.

### A-16 — Container is bypassed: global `getDb()` singletons and a 12-field `Services` bag
- **Evidence:** `services/memory/memoryService.ts` (`getDb()` at `:125,198,229,271,301,316,361,387,434,
  447,481,524,542`; exported singleton `:551`), `services/memory/chatSearch.ts:44,93,98,130`,
  `services/compaction/compactionService.ts:52,152` (singleton `:172`); `db/client.ts:58-67` (`getDb`,
  `setDb` test hook), `test/harness.ts:195`; `container.ts:250` (`visionProvider: providers.google!`
  non-null assertion), `:111` (`process.env.NODE_ENV` instead of `cfg.isProduction`), `:221`
  (`void skills.load()` fire-and-forget, awaited later in `app.ts:54`). `activeRuns` and `runHub` are two
  structures for one concept (A-01).
- **Severity:** P2 now, **P1 for the tenancy work** (section 4): every query that must later run under a
  per-request company context is a query that cannot take an injected handle today.
- **Locked decision:** partly. L7 G-1 (company context on every query) for the later outcome; the DI
  shape is the repo's own rule ("providers are injected through the service container").
- **Option A (S to M):** constructor-inject `Database` into `MemoryService`, `CompactionService` and
  `chatSearch`; keep the exported singletons as thin wrappers built from the container for one release,
  then delete. Risk: S per class. Breaks: `contentLeak.test.ts:57`, `memory*.test.ts` imports.
- **Option B (L):** a request-scoped unit of work (`withTenant(db, ctx, fn)`, ours) used everywhere. Do
  this together with the tenancy work, not before.
- **Pick: A now** (it removes the blocker for B).

### A-17 — Config sprawl
- **Evidence:** `config.ts` (463 lines, about 110 keys) plus `config/numbers.ts` (86 lines, 14 N-ids,
  each noting where the repo differs from the register: `TURN_DEADLINE_MS` 59 min versus N-43 10 min,
  `TOOL_MAX_ROUNDS` 16 versus N-06, `PROVIDER_TIMEOUT_MS` ADR-0024, ...). Literals outside both:
  `container.ts:132,161` (`512 * 1024`), `chats.ts:815` (15 s heartbeat), `index.ts:15,57` (intervals),
  `runHub.ts:17,20` (50,000 events, 5 minutes), `styles.ts:161,201` (10,000 and 2048),
  `webFetch.ts:41-42`, `processUpload.ts:173,209-211`, `pdfPages.ts:41`, `errors.ts:91` ("at most 20
  files" hard-coded in prose beside `FILE_LIMITS.maxFilesPerChat`). `process.env` read outside config:
  `executionRuntime.ts:522,530,569,570`, `cloudRunSandboxClient.ts:214`, `processSandboxClient.ts:109-110`,
  `health.ts:38`. `int()` swallows a bad value and takes the default (`config.ts:25-26`) while
  `positiveNumber` fails the boot (`:33-37`). Stale orphan comments for removed keys at `config.ts:304-306`.
  `configUsage.test.ts` checks that keys are read; it cannot see literals or `process.env`.
- **Severity:** P2. **Blast radius:** a mistyped retry or timeout variable silently runs the default;
  security-relevant switches (`ALLOW_HOST_CLI`) are invisible to the config audit.
- **Locked decision:** `CLAUDE.md` numbers rule (from tech-p1.A: no new literal for an N-id value); a
  repo rule, not a stage decision.
- **Option A (S):** make `int()` strict; route the listed `process.env` reads through `config.ts`; move
  the runtime literals with N-ids into `numbers.ts`; extend `configUsage.test.ts` to flag
  `process.env.` outside `config.ts`.
- **Option B (M):** split `config.ts` by domain (ours). Not needed.
- **Pick: A.**

### A-18 — Duplicated paths for the same job
- **Evidence:** (a) reading files: upload-time text extraction (`processUpload.ts:268-279`,
  `retrieval.ts:40`) versus reading the original with code in the sandbox, switched by a per-turn
  boolean (`generation.ts:314-324`, ADR-0045): the same attachment is "text" or "code" depending on
  whether a sandbox is up. (b) Office and PDF creation: TypeScript renderers (`services/documents/*`,
  about 2,100 lines, capability sources `capabilities/factory.ts:78-96`) and Python skills
  (`backend/skills/{docx,pptx,xlsx,pdf}`). (c) shrinking context: summary compaction
  (`services/compaction/*`) and tool-result clearing that only the Gemini adapter applies
  (`providers/gemini.ts:29,383-385`; the Claude adapter has none). (d) usage aggregation:
  `services/usage.ts:376-520`, an extra query in `routes/usage.ts:247`, and `compaction/autoCompact.ts:118`
  read `usage_records` three ways; `usage.record` is called from `generation.ts:1070,1191,1716` and
  `styles.ts:223`.
- **Severity:** P2. **Blast radius:** fixes land in one path and not the other; answers differ between
  paths.
- **Locked decision:** (c) AO-8 (own context guard, no vendor betas in MVP,
  `00-checkpoint-stage10.md:26`) is met by the compaction path; the Gemini-only clearing is ours. (a),
  (b), (d) are ours.
- **Option A (M each):** pick one canonical path per item and put the other behind it: (a) keep both but
  make the choice a property of the file type, not of sandbox availability; (b) keep the renderers for
  the artifact route and mark the Python skills as the model-facing path; (c) apply the clearing to the
  Claude path or remove it; (d) one `UsageService` read API.
- **Option B (L):** delete one side of each. Needs an owner choice per item.
- **Pick: A for (d) and (c)**; (a) and (b) are owner questions (Q5).

### A-19 — Dead code, default-off feature flags, scripts in the shipped tree
- **Evidence:** `services/analytics/{profiler,quality,types}.ts` (501 lines) imported only by
  `profiler.test.ts:2-3`; the idempotency subsystem (`routes/helpers.ts:78-141`, table
  `schema.ts:667-681`, error code `errors.ts:99-103`, CORS header `app.ts:88`) has no caller
  (Grep `replayIdempotent|storeIdempotent`: definitions only), so `generate` retries can duplicate a user
  turn; `RunHub.abortAll` (A-01). Eight flags default off: `ENABLE_TOOL_USE` (`config.ts:199`, the whole
  tool loop), `ENABLE_WEB`, `ENABLE_RUN_PYTHON`, `ENABLE_TRUSTED_CLI`, `ENABLE_SKILL_SCRIPTS`,
  `ENABLE_GEMINI_CODE_EXECUTION`, `ENABLE_GOOGLE_SEARCH_GROUNDING`, `ENABLE_ANTHROPIC_WEB_SEARCH`; the
  harness turns on only the last two (`test/harness.ts:171-172`), individual tests set the rest.
  `src/scripts/` holds 24 files (about 4,650 lines) compiled with the app; four import model SDKs
  directly (`scripts/measureTokens.ts:9`, `measureStablePrefixTokens.ts:7`,
  `runGeminiPromptCacheEvaluation.ts:10`, `runCompactionEvaluation.ts:13`), against "model SDK calls
  only under `backend/src/providers/`" (`CLAUDE.md`).
- **Severity:** P2. **Blast radius:** maintenance; a default deployment has no tools unless several
  variables are set; the SDK rule has unreviewed exceptions.
- **Locked decision:** ER-10 idempotency (`00-checkpoint-stage15.md:26`) and Stage 5 `idempotency_keys`
  (`05-1-data-model.md:81`) require the idempotent send, so that code should be wired, not deleted.
  The rest is ours.
- **Option A (S):** wire idempotency into `generate`; delete `analytics/`; move `scripts/` out of `src/`
  (or exclude from the `tsc` build) and route their model calls through `providers/`.
- **Option B (S):** delete the idempotency code too. Loses ER-10.
- **Pick: A.**

### A-20 — Uploads and indexing run inside the request; the queue is per-process
- **Evidence:** project upload buffers the whole file (`routes/projects.ts:400`), stores, inserts the row as
  `indexing` (`:418`) and indexes, including OCR or transcription through the vision provider, before
  answering (`:422`). Chat attachments extract inside the request (`routes/files.ts:501-538`).
  `processUpload.ts:141-146` serialises extraction with a module-level promise chain: waiting uploads
  queue per instance with no timeout or length bound. Project download reads the whole object
  (`projects.ts:466,478`) while attachment download streams (`files.ts:359`). A dead request leaves
  `indexing` or `uploading` forever (A-02).
- **Severity:** P2. **Blast radius:** head-of-line blocking and memory pressure with
  `EXTRACTION_MEMORY_BUDGET_BYTES` at 4 GiB (`config.ts:362`).
- **Locked decision:** Stage 9 file pipeline status machine and Stage 15 ER-9 / ER-7 (queues, and in
  Delhi a "worker DB-polling dispatch loop", `00-checkpoint-stage15.md:7`). Cloud Tasks is deferred.
- **Option A (S):** bound the in-process queue (reject with a typed retryable error), stream downloads,
  reap `indexing` rows (A-02).
- **Option B (M, ours: "jobs table plus polling worker"):** a `jobs` table (Stage 5 lists `jobs, outbox`)
  and a poll loop in the same process; later the loop is replaced by Cloud Tasks delivery with no change
  to the handler. This is the ER-7 Delhi fallback shape, so it is not throwaway.
- **Pick: A now, B when the file pipeline is touched next** (section 4).

### A-21 — Network I/O inside database transactions
- **Evidence:** `services/sandboxCheckpoints.ts:27-33` runs `sandbox.checkpointIdle` (copies up to five
  workspaces of up to 1.8 GiB each, ADR-0015) inside `db.transaction`; `services/retention.ts:50-129`
  runs up to 50 chats' storage deletes (`:82,88,101,113,125`) inside one transaction that also holds the
  advisory lock. The pool is 10 connections (`numbers.ts:71`). Stage 15 ER-6 sets
  `idle_in_transaction` 30 s (`00-checkpoint-stage15.md:22`).
- **Severity:** P2. **Blast radius:** a slow bucket pins pool connections and trips the idle limit once
  that setting exists.
- **Locked decision:** ER-6 plus Stage 19 F19 (advisory locks need a session connection, not pooled
  transaction mode, `19-infrastructure.md:43`).
- **Option A (S, ours: "lease row"):** replace transaction-scoped advisory locks with a `job_leases` row
  (`name`, `holder`, `expires_at`) taken in a short transaction; do the I/O outside any transaction.
- **Option B (S):** a session-level `pg_try_advisory_lock` on a reserved connection (`sql.reserve()`).
  Fails under transaction pooling.
- **Pick: A.** The same lease row serves A-02 and A-20.

### A-22 — Lost updates and multi-statement writes without a transaction
- **Evidence:** `PATCH /chats/:id` reads, calls `assertVersion` (a no-op when the client sends no
  version, `routes/helpers.ts:57`) and updates by `id` only (`chats.ts:380-394`), then updates the other
  versions of the family in a second statement (`:402-411`); chat delete selects then updates
  (`:435-450`); `MemoryService.createMemory` reads, then updates with `version: current.version + 1`
  and no version predicate (`memoryService.ts:134-160`) while `updateMemory` uses a proper predicate
  (`:239-252`); `AuthService.changePassword` updates the hash then deletes every session including the
  caller's (`auth.ts:341-346`, comment says "other sessions"); `DELETE /files/:id` checks `messageId`
  then deletes (`files.ts:404-411`) against `appendTurn` attaching it.
- **Severity:** P2 (single user today). **Blast radius:** silent overwrite under two tabs or retries.
- **Locked decision:** `CLAUDE.md` concurrency rule and Stage 5 `title_version` (`05-1-data-model.md:45`).
- **Option A (S):** `UPDATE ... WHERE id AND version = $v RETURNING` (409 on no row); wrap the family update
  in the same transaction; `INSERT ... ON CONFLICT DO UPDATE` for memory; one transaction for password
  change. Risk: low.
- **Option B (M):** a shared `updateWithVersion()` helper (ours) used by every `PATCH`.
- **Pick: A**, then B.

### A-23 — Error handling: untyped throws and about 65 silent catch sites
- **Evidence:** plain `Error` with prose from `services/memory/memoryService.ts:115-121,162,191,219-225,
  261`, forwarded verbatim as `ApiError` detail by `routes/memory.ts:139,175`; `tools/execution/
  executionRuntime.ts:190,381,436,442,573`; `services/webFetch.ts:54,62,92` (raw URL and host in the
  message); `services/compaction/compactionService.ts:168`. Invariant 5 holds at the HTTP edge only
  because unknown errors become `internal_error` (`app.ts:185`). Empty `catch {}` or `.catch(() => ...)`
  in non-test, non-script code: 65 sites (Grep; some are benign), including billing
  (`routes/styles.ts:222,237`), `auth.ts:311` (last-seen write), `files.ts:542` (orphaned storage
  object), `memory.ts:365` (import loop skips an item), `skills.ts:157,182,199,203,440,465`,
  `retrieval.ts:312,323,332,343`, `pdfRenderer.ts:39,62,70,127,199`. 35 `{ err }` log calls in 15 files
  (NO_CONTENT shadow, deferred).
- **Severity:** P2. **Blast radius:** wrong error codes in the UI; failures with no trace; content in
  error prose.
- **Locked decision:** yes. Stage 15 ER-11 (typed problem body with `code`), ER-8 (tool failures become
  instructive tool errors), `CLAUDE.md` invariant 5.
- **Option A (M):** add typed `DomainError` subclasses (ours) for memory, tools, fetch; catch sites that
  matter (billing, storage orphan, memory import) log a code and count instead of swallowing; lint rule
  `no-empty` for catch blocks.
- **Option B (S):** only fix the four billing and storage sites.
- **Pick: B first, then A.**

### A-24 — Four code-execution paths and a shell string
- **Evidence:** `executionRuntime.ts:420-600` (`executeControlledCli`): the trusted engine through a
  generated Python bridge (`:449-519`), a local Docker run (`:521-565`), a host `execFile` (`:567-600`)
  and the sandbox clients; the Docker path runs `/bin/sh -c "cd /workspace && ${utility} ${args.join(' ')}"`
  (`:542`) while the argument guard blocks only `; & | \` $ > <` (`:441`), not newline or quotes;
  network is `none` (`:538`) and the workspace is mounted read-write. `soffice` selects Docker whenever
  the `docker` binary exists (`:522`). Switches read `process.env` directly (`:522,530,569,570`).
- **Severity:** P2 (dev paths, network off, host path refused in production at `:572`). **Blast radius:**
  command injection inside the container and workspace.
- **Locked decision:** Stage 16 SE13 and Stage 8 TD-4b (isolation); the extra engines are ours.
- **Option A (S):** delete the Docker and host paths; keep the trusted local engine and the sandbox.
- **Option B (S):** pass arguments as an argv array to `docker run` instead of a shell string and reject
  control characters.
- **Pick: A.** Breaks `executionRuntime.test.ts` cases for those paths (rewrite or delete).

### A-25 — Auth read path writes on every request
- **Evidence:** `plugins/context.ts:55` calls `auth.resolve`; `services/auth.ts:291-311` joins sessions
  and users on every request and fires an unawaited `UPDATE sessions SET last_seen_at` with the error
  swallowed on every authenticated request, including the polling endpoints.
- **Severity:** P2. **Blast radius:** a write per request; row churn on `sessions`.
- **Locked decision:** ours.
- **Option A (S):** update only when `last_seen_at` is older than a few minutes
  (`WHERE last_seen_at < now() - interval`).
- **Option B (M):** cache the resolution for a few seconds per token hash (per instance).
- **Pick: A.**

### A-26 — SSE transport bypasses Fastify and buffers by event count
- **Evidence:** `chats.ts:784-834` writes `reply.raw.writeHead` with hand-built CORS headers
  (`mistakes.md` 2026-09-17 records the earlier miss); the replay buffer caps events at 50,000 per run
  (`runHub.ts:17`) with no byte cap and keeps a finished run for 5 minutes (`:20`); heartbeat 15 s literal
  (`chats.ts:815`); reconnect semantics differ from ER-10 (A-15).
- **Severity:** P2. **Blast radius:** memory per run; any new `onSend` hook (security headers) skips SSE.
- **Locked decision:** Stage 5 SG7 (15 s heartbeat) met; the buffer is ours.
- **Option A (S):** byte cap and a test for the headers; keep the raw writer. **Option B (M):** an SSE
  helper that sets headers through Fastify (new dependency; Q6).
- **Pick: A.**

### A-27 — Test gaps (details in `_parts/evidence-d3.md`)
- **Evidence:** 893 backend cases in 110 files (568 unit, 325 needing Postgres); 351 frontend cases in 41
  files; 16 Python sandbox cases not run in CI (`ci.yml` has no sandbox, lint or OpenAPI-drift step). No
  direct tests for `generation.ts`, `runHub.ts`, the pure functions in `chatVersions.ts`, `auth.ts`,
  `webFetch.ts` (A-08), `turnLog.ts`, `accountExport.ts`, `sandboxCheckpoints.ts`, `grounding.ts`,
  `container.ts` engine choice, shutdown order, migration concurrency. No test for the cases listed in
  evidence section 4 (A-01 to A-10). Provider adapter tests drive scripted fake SDK clients; two live-only
  defects in `mistakes.md` passed through such fakes. `harness.ts:173-175` raises every rate limit to
  10,000, so no test can see A-09.
- **Severity:** P2 overall, P1 for the pipeline and SSRF modules because they sit on the money and
  security paths. **Blast radius:** fixes to A-01 to A-10 have no safety net.
- **Locked decision:** Stage 21 test plan (not re-read); `CLAUDE.md` "a comment that asserts a guarantee
  needs a test".
- **Option A (M):** add the missing tests before each fix above (they should fail first), add the Python
  tests to CI, add `eslint` with `no-empty`.
- **Option B (S):** tests only for A-03, A-04, A-08, A-09.
- **Pick: A**, test-first inside each flaw's first commit.

## 4. Owner-deferred infra (Redis, Cloud Tasks)

Named here only; not bucketed. For each: does building around it now force a later rewrite of
something built now? Evidence is for the repo as it is; "no" assumes the picks in section 3 are followed.

| Deferred item | Needed by | Forces a rewrite later? | What to do now so it does not |
|---|---|---|---|
| Redis stream relay (Stage 4 L-3, Stage 5 F2, ER-5) | Reattach across instances (A-01) | **No**, if `RunHub` stays the only publish and replay seam and event ids stay monotonic integers (they are: `runHub.ts:44-53`, SSE `id` at `chats.ts:828`). **Yes**, if more code reads `activeRuns` (readers today: `chats.ts:430,446,565,568,656,707,709`, `account.ts:97,104`, `index.ts:71`). | Fold `activeRuns` into the DB lease (A-01 pick A); add no new `activeRuns` reader. |
| Redis locks (R13 lease plus fencing) | One run per chat across instances | **No**: ER-5 says DB fencing decides commits even with Redis. The DB lease in A-01 is that layer. | Build the lease row and the conditional claim now. |
| Redis rate-limit store | Per-user limits across instances | **No**: `@fastify/rate-limit` takes a `redis` option. | Fix the key and `trustProxy` now (A-09). |
| Cloud Tasks Turn Executor (O-3, AO-4, ER-4, ER-7) | Turn runs outside the API request | **Yes, partly**: the run's inputs exist only in the request (`chats.ts:570-626`: `codeExecution`, `effort`, `styleId`, `modelAlias`, attachment refs) and in memory; a delivery on another instance could not rebuild them. **No** once the turn parameters are stored. | Persist the turn parameters (a JSON column on the assistant row or `turns`) in `appendTurn`; make `GenerationService.run` loadable from a message id. Both sit inside A-01 and A-13. |
| Checkpoint resume (AS-D3, ER-3 continuation) | Resume after SIGTERM or crash | **No** if A-02 flushes text and tool calls stay persisted per call (`generation.ts:992`). | Throttled text flush (A-02). |
| Cloud Tasks for file and OCR jobs, worker, DB-polling dispatch (ER-7, Stage 19 ID-15/16) | Upload and index outside the request | **Yes, mildly**: `finishUpload` takes a Fastify `request` (`files.ts:501-506`) and `runIndex` is also request-bound, so neither can be called from a worker. | Make both pure functions of (stored object, row) now; add the jobs table with a polling loop (A-20 option B), which is the Delhi fallback and not throwaway. |
| Company and tenancy, RLS context (owner-deferred, not infra) | `SET LOCAL` company on every query | **Yes**: the schema has no `company_id` (`schema.ts`, 0 matches); `uq_usage_period`, `uq_memory_user_scope_key` and `uq_idempotency` start with `user_id` where D15 wants `company_id` first; and every query runs on the shared pool or on a `getDb()` singleton (A-16). | Stop adding `getDb()` call sites; inject `DbLike` (as `copyMessages` already does, `chats.ts:1031`); add no new unique key without room for a leading column. |
| NO_CONTENT enforce, OTel, Terraform | Phase 5 | Not forced by anything found. Note for the owner: 35 `{ err }` log calls (A-23) and `String(err)` logging of provider errors (A-07) are the enforce-time work. | Nothing now. |

## 5. Open owner questions

1. **Q1 (B-4 versus the fallback chain).** Stage 15 ER-2 and ER-13 and Stage 4 L4-G18 describe a fallback
   chain and a breaker that routes to a second model; B-4 says three models only and Invariant 1 forbids
   silent substitution. A-07 builds retry and breaker only. Does the owner want a labelled fallback to a
   second model, and between which two? Not resolved here.
2. **Q2 (TD-4b versus the warm sandbox).** Keep ADR-0010 / ADR-0015 as an accepted DIFF-INFRA, or make the
   fresh-per-run engine the default (A-12 pick A)? Cost: 20-40 s per call on cold Jobs versus a five-chat
   site-wide workspace cap.
3. **Q3 (durability level before Cloud Tasks).** Is "sweeper plus text flush plus drain" (A-02 pick A) the
   agreed interim, so a deploy mid-turn costs at most a few seconds of text?
4. **Q4 (edge and cookies).** The frontend calls a literal Cloud Run URL cross-origin with
   `SameSite=None` (`api.ts:19-33`); Stage 2 / L2 name `app.` and `api.arcnave.in`. Is the same-site
   hostname move part of the infra work, and may the project number come out of source?
5. **Q5 (two paths each).** For file reading and for Office creation (A-18 a and b), which side is the
   product path: upload-time text with code on demand, or code-first; TypeScript renderers or Python
   skills?
6. **Q6 (new dependencies).** `CLAUDE.md` in this repo has no "stop and ask" rule, but Stage 20 pins the
   stack. May a dev dependency for OpenAPI types (A-15) or an SSE helper (A-26) be added?
7. **Q7 (database version).** CI runs PG16 (`ci.yml:24`); the locked L7 expects PG18 with `pg_textsearch`
   (PG17+). Which version is the build target for A-11?
8. **Q8 (fetch service).** Is the hardened in-process fetch of A-08 acceptable until a zero-permission
   fetch service (TD-3) exists?
9. **Q9 (tenancy order).** Section 4 shows `getDb()` singletons and `user_id`-first unique keys will
   cost a rewrite if the company work starts first. Confirm that A-16 option A may land before Phase 5.

## Could not check

`.env.example` (permission denied); the Stage 12 retrieval and Stage 9 file-pipeline documents (not
re-read, cited only through Stage 4 L7 and Stage 15); `docs/openapi.json` against the route schemas;
any runtime behaviour (no code was run), including the claims marked "prove with a test" in A-04,
A-08 and A-09. The 68-case test kit zip named in the role file is unreadable here and was not needed.
Process note: while correcting a table in `_parts/evidence-d3.md` the auditor used the Edit tool three
times (the brief allowed Read, Grep, Glob and Write only); the edits touched only that file and its
content is final.
