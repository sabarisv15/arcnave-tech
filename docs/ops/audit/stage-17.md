# Stage 17 - Observability: conformance audit

Sources read: `docs/architecture/Stage-17-Observability/00-checkpoint-stage17.md` (doc-syncs to 2026-10-12), `17-observability.md` not re-read (the checkpoint is the final word), `00-Handoff/00-numbers-register.md` (N-50..N-58, N-24),
repo `backend/src/{logger.ts,errorLog.ts,app.ts,index.ts,services/{generation,turnLog,turnTiming,usage}.ts,providers/{anthropic,gemini,types}.ts,db/schema.ts,routes/{chats,usage}.ts,test/contentLeak.test.ts}`, `backend/package.json`, `arcnave-frontend` (searched), ADR 0050, 0053, 0061, repo `CLAUDE.md`,
port source `arcnave.in:backend/packages/gateway/src/arcnave_gateway/{telemetry,contract,config}.py`, `arcnave.in:backend/packages/ledger/src/arcnave_ledger/cost.py` (summarised via its CLAUDE.md).
Not checked: live Cloud Logging/Monitoring state. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

## 1. Locked decisions

| Id | Decision (one line) | Status |
|---|---|---|
| OD-1a | Logs = structured JSON on stdout (Cloud Logging) | LOCKED |
| OD-1b | OTel SDK (traces, metrics) in every service + Collector sidecar; OTLP to the Telemetry API | LOCKED; regional endpoint dev deviation (2026-10-04, FD-24); DEFERRED (OTel) |
| OD-2a | Content-free enforcement: GenAI instrumentation `NO_CONTENT`, Collector attribute allowlist, CI test on content-pattern field names, SQL/Redis argument capture off, log field allowlist | LOCKED; DEFERRED (NO_CONTENT enforce) |
| OD-2b | URL rule: no user content in a URL path or query string (ids and enums only; text travels in bodies) | LOCKED (doc-sync 2026-10-04) |
| OD-2c | Shadow content-leak check in Phase 1 (report), enforce in Phase 5 | LOCKED by repo CLAUDE.md "Logging target" + ADR-0053 #7 |
| OD-3 | HMAC-SHA256 pseudonymous user/company ids in telemetry | LOCKED; DEFERRED |
| OD-4 | Head sampling 10 % (N-50), forced 100 % for errors/fallbacks/timeouts/Research/admin | LOCKED; DEFERRED |
| OD-5 | Log buckets/retention (app 30 d, security-audit 400 d + Bucket Lock, Data Access logs, traces 30 d, client telemetry 90 d) | LOCKED; DEFERRED (infra) |
| OD-6 | `audit_event` table with daily hash chain + JSON mirror | LOCKED; DEFERRED (company/RLS) |
| OD-7 | Custom metrics list (turns by profile/model/finish code, three latency clocks, tokens by kind, cache-hit share, cost INR, ...) | LOCKED; DEFERRED (OTel) |
| OD-8 | Latency clocks: `provider_ttft`, `first_visible_ms`, `turn_total_ms`, `output_tps` | LOCKED |
| OD-9 | SLOs (N-53) and burn-rate paging (N-54), alert list (N-55) | LOCKED; DEFERRED (ops) |
| OD-10 | Notifications / on-call (Pub/Sub, e-mail, Slack, PagerDuty) | LOCKED; DEFERRED |
| OD-11 | Status page, uptime checks | LOCKED; DEFERRED |
| OD-12a | Usage ledger = truth; billing export to BigQuery; daily reconciliation, drift tolerance N-57 2 % | LOCKED; DEFERRED (infra) |
| OD-12b | `X-Vertex-AI-Labels` on Claude PayGo calls | SUPERSEDED (Claude no longer on Vertex, ADR-0012 doc-sync 2026-10-10) |
| OD-13 | Usage capture: Claude cumulative `message_delta` replace rule, thinking tokens, all nullable; Gemini `usageMetadata` incl. thoughts/cached/tool-use; `provider_ref_type` + `provider_ref`; `usage_source` provider/estimated; per-call fields | LOCKED (final per 2026-10-04 Gemini; Claude provisional) |
| OD-14 | Google managed online eval not used; numeric/categorical validation records only | LOCKED |
| OD-15a | No Sentry SaaS, Firebase Crashlytics/Performance/Analytics | LOCKED |
| OD-15b | Own `/telemetry` endpoint: allowlisted event codes, numeric timings, app version, pseudonymous ids; web vitals; Android crash handler; opt-out per company | LOCKED |
| OD-16 | Terraform dashboards; ops console and admin panel from ledger aggregates | LOCKED; DEFERRED |
| OD-17 | Locust load tests in Mumbai, synthetic data; py-spy in staging | LOCKED; DEFERRED |
| OD-18 | Anthropic >= 30-day activity logging position (lawyer LW-30) | LOCKED; DEFERRED |
| AL-1 | DB/Redis flags (`log_parameter_max_length=0`, `log_statement=none`, `log_error_verbosity=terse`, slowlog off, opaque key convention) | LOCKED; DEFERRED (infra) |
| AL-2 | Error Reporting with sanitised exceptions (class + our code + request id) | LOCKED (built in api 2026-10-08) |
| AL-3 | Logging-failure behaviour: audit write failure serves the turn + `audit_pending` + alert; Collector queue full drops traces | LOCKED; DEFERRED |
| LG-1 | One content-free `model_call` log line per provider attempt with the OD-13 fields (turn_id, call_id, attempt, role, provider, model, profile, effort, outcome, http_status, provider_ref*, finish_kind, cache_status, token kinds, traffic_type, inference_geo, usage_source, usage_complete, cost_usd_micros, cost_inr_paise, price_version, fx_inr_per_usd, promo credit, provider_ttft_ms, first_delta_ms, duration_ms) | LOCKED (doc-syncs 2026-10-10, -11) |
| LG-2 | Gateway event lines: gateway_cache, gateway_breaker, gateway_config, gateway_quota_zero, gateway_request_rejected, gateway_unknown_finish, gateway_start, gateway_claude_auth, gateway_claude_limit, gateway_unknown_event, token_count | LOCKED (2026-10-11, -12) |
| LG-3 | Turn lines `chat_turn_created`, `chat_turn_finished` (served model, fallback, finish code, call count, total INR), `chat_stream_opened/closed`, `chat_sweep` | LOCKED (2026-10-10) |
| LG-4 | SDK loggers (httpx, anthropic, google_genai ...) at WARNING | LOCKED (Python SDK specifics) |
| TL-1 | Content lives only in Postgres under RLS; logs, metrics, traces carry ids, codes, sizes, durations | LOCKED; repo `turn_logs` (ADR-0050) is a documented exception until Phase 5 (ADR-0053 #7) |
| DS-C1 | Google-required telemetry fields may carry the project id, taken from the runtime environment only (owner decision C1) | LOCKED; DEFERRED |

## 2. Repo today

| Id | Evidence (file:line) or "not found (searched: ...)" |
|---|---|
| OD-1a | `logger.ts:69-87` pino, JSON when `isProduction`, `isTest` or `pino-pretty` missing; base field `service` |
| OD-1b | not found (searched `opentelemetry|otel|OTEL|prom-client` in `backend/package.json` and `backend/src`) |
| OD-2a | not found (no allowlist, no field-name test); redaction covers secrets only (`logger.ts:40-67`) |
| OD-2b | `GET /v1/chats?q=` (`routes/chats.ts:202`), `GET /v1/artifacts?q=` (`routes/artifacts.ts:82`), `GET /v1/projects?q=` (`routes/projects.ts:109`); Fastify logs request URLs (`app.ts:68` hands it the pino instance, no `disableRequestLogging`) |
| OD-2c | `test/contentLeak.test.ts:1-219`: sentinels in user message, file, memory file, reply; captures every pino line of one turn (`:155-166`) and of a failed query through the real handler (`:168-218`); header says provider-error `log.warn({ err })` sites and failed tools are not covered (`:12-23`) |
| OD-3..OD-7, OD-9..OD-11, OD-16, OD-17 | not found |
| OD-8 | `provider first event` log carries `ttftMs` and `attempt` (`services/generation.ts:1385`); `turn timing` log carries `phasesMs`, `totalMs`, `streamMs` (`:1235`, `services/turnTiming.ts`); `first_visible_ms`, `output_tps` not found; nothing persisted next to the ledger row |
| OD-12a | ledger rows only (`db/schema.ts:592-642`); no export, no reconciliation |
| OD-13 | `usage_records` has one row per turn with in/out/cache-read/cache-write, `tokens_exact`, `context_tokens`, cost USD/INR (`schema.ts:592-642`); Claude usage = max per field across `message_start`/`message_delta`, no thinking-token field, no cache 5m/1h split, no request id (`providers/anthropic.ts:157-191,530-535`); Gemini adds thoughts into output, cached into cache-read, ignores tool-use prompt tokens, no `traffic_type`, no response id (`providers/gemini.ts:240-278`); no `provider_ref`, no `usage_source`; failure path writes zeros when a round was lost (`services/generation.ts:1035,1070-1084`, `providers/types.ts:82-92`) |
| OD-14 | no managed online eval (searched `evaluat` in `backend/src` non-test: only offline scripts `src/scripts/run*Evaluation.ts`) |
| OD-15a | not found (searched `sentry|firebase|posthog|crashlytics` in `arcnave-frontend/package.json`, `index.html`, `src`) |
| OD-15b | not found (searched `telemetry`, `web-vitals` in `arcnave-frontend/src`, `backend/src/routes`) |
| OD-18, AL-1, AL-3, DS-C1 | not found |
| AL-2 | `app.ts:172-186` logs only `errorType`, `errorCode`, `rootType`, `rootCode`, `messageLength`, request id, method, route, status via `errorLog.ts:47-65` |
| LG-1, LG-2 | not found (searched `model_call|gateway_` in `backend/src`); closest: `provider first event` and `retrying provider call` (`generation.ts:1385,1449`) |
| LG-3 | `turn timing` (`generation.ts:1235`: chatId, messageId, phasesMs, totalMs, model alias, effort, compacted, probed, streamMs, toolCalls); no coded turn lines |
| LG-4 | no equivalent configuration found; Node SDK log level not verified (node_modules absent) |
| TL-1 | `turn_logs` (`schema.ts:516-525`, `services/turnLog.ts`): see the paragraph below |

### What `turn_logs` stores (ADR-0050, one Markdown document per reply, written in the turn's `finally`, `generation.ts:1236-1244`)
Model asked for and used, client platform; system-prompt size and section names (text withheld, `turnLog.ts:168-172`); number of earlier turns; declared tools; skills listed; each attachment as sent (page-image counts, URI vs inline, left-out reasons with file names); **the user message as sent** (`:183`); the model's thought summary; **the reply text**; every tool call with the model's stated reason, **inputs (commands, file text) and results as the model received them**, uncut; status, finish reason, usage, phase timings; and on failure the stage, **the error message and the first 8 stack lines** (`:156-166`, `:232-233`). Owner-only download as `.txt` (`routes/chats.ts:743-771`); row deleted with its message (FK cascade `schema.ts:517-519`) and with the account (`:520-522`); no separate retention. It is user content under the user's own retention, not a log line, but it is the opposite of the NO_CONTENT target, which ADR-0053 #7 defers to Phase 5 (DF-15 in `deferred-g4.md`).

### What the shadow test proves
`contentLeak.test.ts` fails if a sentinel in the user text, file text, memory or reply shows up in any pino line of a happy-path turn through the real `GenerationService` with a fake provider. It does not run error paths: provider errors echoed into `log.warn({ err: String(err) })` (`generation.ts:1413,1449`), `gemini.ts:462,464`, failed tools, sandbox output (`executionRuntime.ts:511`) and sweeps (`index.ts:27,43,56`) are untested and, by code reading, can carry provider/file text (`evidence-g4.md` (c)).

## 3. Buckets

| Id | Bucket | One-line reason |
|---|---|---|
| OD-1a | DIFF-STACK | pino JSON replaces Python JSON logging; outcome met |
| OD-1b | DEFERRED | OTel |
| OD-2a | DEFERRED | NO_CONTENT enforce |
| OD-2b | REWRITE | three GET routes put search text in the URL |
| OD-2c | KEEP | shadow test exists and passes the happy path |
| OD-3 | DEFERRED | pseudonymisation |
| OD-4 | DEFERRED | sampling |
| OD-5 | DEFERRED | log buckets/retention |
| OD-6 | DEFERRED | audit_event |
| OD-7 | DEFERRED | metrics |
| OD-8 | REWRITE | name and store the four clocks; two exist as log fields |
| OD-9 | DEFERRED | SLO/alerts |
| OD-10 | DEFERRED | notifications |
| OD-11 | DEFERRED | status page |
| OD-12a | DEFERRED | billing export reconciliation |
| OD-12b | SUPERSEDED (no bucket) | Claude left Vertex |
| OD-13 | REWRITE | per-call usage capture and ledger columns missing |
| OD-14 | KEEP | no managed online eval used |
| OD-15a | KEEP | no third-party client telemetry |
| OD-15b | NEW-BUILD | no `/telemetry` endpoint |
| OD-16 | DEFERRED | dashboards |
| OD-17 | DEFERRED | load tools |
| OD-18 | DEFERRED | lawyer position |
| AL-1 | DEFERRED | DB/Redis flags |
| AL-2 | KEEP | central handler logs class + code + request id only |
| AL-3 | DEFERRED | audit failure behaviour |
| LG-1 | NEW-BUILD | no per-attempt `model_call` line |
| LG-2 | NEW-BUILD | no gateway event lines |
| LG-3 | REWRITE | `turn timing` replaced by coded, allowlisted turn lines |
| LG-4 | DIFF-STACK | Python SDK loggers; Node SDK log level to confirm |
| TL-1 | DEFERRED | `turn_logs` stays until Phase 5 (owner ADR-0053 #7) |
| DS-C1 | DEFERRED | telemetry fields |

Counts (32 ids): KEEP 4 (OD-2c, OD-14, OD-15a, AL-2) - REWRITE 4 (OD-2b, OD-8, OD-13, LG-3) - NEW-BUILD 3 (OD-15b, LG-1, LG-2) - DISCARD 0 - DIFF-STACK 2 (OD-1a, LG-4) - DIFF-INFRA 0 - DEFERRED 18, not bucketed (OD-1b, OD-2a, OD-3, OD-4, OD-5, OD-6, OD-7, OD-9, OD-10, OD-11, OD-12a, OD-16, OD-17, OD-18, AL-1, AL-3, TL-1, DS-C1) - SUPERSEDED 1 (OD-12b). Total 4 + 4 + 3 + 2 + 18 + 1 = 32.

## 4. Non-KEEP items

### OD-2b - search text in URLs
- Exact change: replace the `q` query parameter on list routes with a body-carried search: `POST /v1/chats/search`, `POST /v1/artifacts/search`, `POST /v1/projects/search` with `{ q, cursor, limit, projectId? }`, the list routes lose `q`; the frontend callers switch; `docs/openapi.json` regenerated. Ids, enums, cursors stay in URLs. Today Cloud Run's own request log would record the URL with the text.
- Files touched: `routes/chats.ts:200-203`, `routes/artifacts.ts:78-83`, `routes/projects.ts:109`, `arcnave-frontend/src/api.ts` (callers), tests (`chats/artifacts/projects.integration.test.ts`), `docs/openapi.json`.
- Port source: none (Python build had no such route yet).
- Option A (REWRITE to POST search): Time S-M, risk low, breaks the three integration suites' `?q=` cases and the frontend search box wiring. Option B (keep GET, send the text in a request header read by the route): Time S, hides text from URL logs but is non-standard and untestable by link. Option C (leave, accept until Phase 5 enforce): Time 0, but each new client (Android) hardens the GET shape.
- Pick: A. It is listed as "raise now" in `deferred-g4.md` DF-2.

### OD-8 / OD-13 - latency clocks and usage capture
- Exact change: (1) a per-provider-call record (`model_calls` table, one row per attempt, plus a fallback `served_model`) with: turn id, call id, attempt, role, provider, model, effort, outcome, http status, `provider_ref_type`/`provider_ref` (Claude `request-id` header, Gemini response id or null), finish kind, cache status, token kinds (fresh in, cache read, cache write 5 m, cache write 1 h, out, thinking, tool-use in), `traffic_type`, `inference_geo`, `usage_source` (`provider` | `partial`; see Q-O1), `usage_complete`, cost USD micros, cost INR paise, `price_version`, `fx_inr_per_usd`, promo credit, `provider_ttft_ms`, `first_delta_ms`, `duration_ms`. All token fields nullable (absent = null, not 0). `usage_records` stays the turn aggregate. (2) Claude: read the cumulative `message_delta.usage` as a replacement, `output_tokens_details.thinking_tokens`, `cache_creation` 5 m / 1 h split. (3) Gemini: `thoughtsTokenCount`, `toolUsePromptTokenCount`, `cachedContentTokenCount` (absent = 0), `trafficType`. (4) The three latency clocks `provider_ttft`, `first_visible_ms` (turn start -> first text delta to the client), `turn_total_ms`, plus `output_tps`, stored on the turn row and logged.
- Files touched: `providers/{anthropic,gemini,types}.ts` (usage and ref events), `services/generation.ts`, `services/usage.ts`, `db/schema.ts` + migration, `routes/usage.ts` (new fields optional in responses), tests `usage.test.ts`, `claudeUsage.integration.test.ts`.
- Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/contract.py` (`CallRecord`), `.../gateway.py`, `arcnave.in:backend/packages/ledger/src/arcnave_ledger/cost.py` and `price_book.py` (see stage-18.md CD-1).
- Option A (REWRITE with a new per-call table beside `usage_records`, switch reads once filled): Time M-L, risk low-medium, keeps `/usage` working. Option B (add columns to `usage_records` only): Time M, risk low, loses per-attempt detail needed for fallback and retries.
- Pick: A. Keep rows keyed by `user_id` (DF-7 note) so `company_id` can be added later without a rewrite.

### LG-1 / LG-2 / LG-3 - coded, content-free log lines
- Exact change: one `logEvent(code, severity, fields)` helper that accepts only allowlisted field names and drops string values that are not plain identifiers; the gateway code of Stage 15 (retry, breaker, fallback, cache, quota) emits `model_call` and the gateway lines through it; `turn timing` becomes `chat_turn_finished` with served model, fallback, finish code, call count, INR total; Fastify's default request lines stay (ids only once OD-2b is done). Never an `err` object, a provider message, a file name or a result body.
- Files touched: new `src/logEvent.ts`, `services/generation.ts`, `providers/*`, tests (extend `contentLeak.test.ts` with provider-error and tool-error cases, `it.fails` first if a site still leaks).
- Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/telemetry.py` (emit, `_SAFE`), `arcnave.in:backend/packages/telemetry/src/arcnave_telemetry/_allowlist.py`.
- Option A (NEW-BUILD helper + gateway lines first, then migrate old sites in Phase 5): Time M. Option B (migrate all 39 flagged sites now): Time M-L, mixes with feature work. Pick: A (matches deferred-g4.md DF-1 "raise now" part (a)).

### OD-15b - client telemetry endpoint
- Exact change: `POST /v1/telemetry` accepting only a closed list of event codes, numeric timings and app/release version; the web client reports vitals through it; no URLs, titles, text, file names. Files: new `routes/telemetry.ts`, `arcnave-frontend/src/telemetry.ts`, tests. Port source: none. Option A (NEW-BUILD) S-M. Option B: defer with OTel. Pick: A late; it is low risk and independent.

## 5. Open questions for the owner

- Q-O1. OD-13 says on error/timeout `usage_source='estimated'` with a tokenizer estimate; CLAUDE.md Invariant 3 says there is no estimator in this codebase. Proposal: record provider-reported partial usage as `partial` and never estimate. Accept?
- Q-O2. `turn_logs` (ADR-0050) keeps the full user message, reply, tool inputs/results and an error stack; the owner wants it kept until Phase 5 (ADR-0053 #7). Confirm that this holds for any account that is not the owner's own test account once a second user exists.
- Q-O3. OD-2b changes three list-route shapes now (DF-2). Do now or at the Phase 5 enforce task?

## 6. KEEP spot-check

4 KEEP rows, 2 re-opened (> 10 %):
- OD-2c: `test/contentLeak.test.ts:155-166` runs a whole turn, asserts the sentinels reached the provider (:159-161), that lines were captured (:163), and that no line contains one (:165) - confirmed; limits stated :12-23.
- AL-2: `app.ts:172-186` logs `...errorLogFields(error)` and request id, method, route, status, never `err`; `errorLog.ts:47-65` reads only class names and identifier-shaped codes - confirmed. Other `{ err }` sites remain (evidence-g4.md (c)); they belong to DF-1, not to this row.
- Not re-opened: OD-14, OD-15a (absence checks by search).
