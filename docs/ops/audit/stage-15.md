# Stage 15 - Error handling and fallbacks: conformance audit

Sources read: `docs/architecture/Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md` (all doc-syncs to 2026-10-13), `15-error-handling.md` (gaps EH1-EH26, decisions ER-1..ER-15),
`00-Handoff/00-numbers-register.md` (N-42..N-48, N-24, N-73, N-74), repo `backend/src/{errors.ts,app.ts,config.ts,config/numbers.ts,providers/{anthropic,gemini,streamedCall,types,registry,routing}.ts,services/{generation,usage}.ts,routes/{chats,usage}.ts,tools/*,db/client.ts}`,
`arcnave-frontend/src/{api.ts,adapter.ts,ChatStates.tsx}`, ADR 0024, 0053, 0054, 0055, 0056, 0061, repo `CLAUDE.md`, port source `arcnave.in:backend/packages/gateway/src/arcnave_gateway/{failures,config,breaker,gateway,telemetry}.py`, `arcnave.in:backend/packages/chat/src/arcnave_chat/http/problems.py`.
Not checked: installed SDK sources (no `node_modules`), live provider behaviour. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).
Note on the brief: `providers/streamedCall.ts` is only the Gemini streamed-function-call assembler (`streamedCall.ts:1-196`); it holds no retry or timer. The retry/timeout logic is in `services/generation.ts:1367-1453` (`streamWithRetry`), `:2343-2353` (`retryDelayMs`) and the two adapters. There is no `services/retryPolicy*.ts` source file, only `services/retryPolicy.test.ts`.

## 1. Locked decisions

| Id | Decision (one line) | Status |
|---|---|---|
| ER-1a | Anthropic SDK retries off (`max_retries=0`); the ArcNave matrix is the only retry | LOCKED |
| ER-1b | google-genai retries off **explicitly** (`attempts=1`), own HTTP client, guard test proves one request per call | LOCKED (doc-sync 2026-10-04, -11; Python mechanism is DIFF-STACK, the outcome is not) |
| ER-2a | At most 2 retries, only before the first token | LOCKED |
| ER-2b | "Before first token" means before any visible or side-effecting step of the turn (text, tool call, thinking shown) - derived from ER-2 + ER-3 + ER-8 | LOCKED (derived) |
| ER-2c | Backoff 1 s -> 2 s, full jitter, cap 8 s (N-42) | LOCKED |
| ER-2d | Provider Retry-After honoured up to 10 s, longer -> straight to fallback (N-42) | LOCKED; "Vertex 429 has no Retry-After" (2026-10-04) SUPERSEDED for Claude by the first-party move (ADR-0012 doc-sync 2026-10-10) |
| ER-2e | Transient = 429 (not spend cap), 500/502/503/504, 529, connection, 408, 409 | LOCKED |
| ER-2f | Never retry 400/401/403/404/413, spend-cap 429, refusal, safety block, 499 | LOCKED |
| ER-2g | Classifier additions: Gemini quota-0 429 and persistent quota-0 = configuration error (alert, no retry loop); 401/403/404 = config; Claude spend limits (429 `enforced_spend_limit_reached`, 400 "API usage limits", 402) = `claude_limit`, skip all Claude rows; WIF/401 = `credentials` | LOCKED (2026-10-06, -10-11, -10-12); Vertex-Claude 429 classification of 2026-10-04 SUPERSEDED by 2026-10-12 |
| ER-2h | Mid-stream `error` event classified by its error type as that HTTP status; unknown type = transient | LOCKED (2026-10-12) |
| ER-3a | No silent retry after partial text | LOCKED |
| ER-3b | One stream-recovery attempt: same served model pinned, new user message with partial text + "continue", appended; counted (<= 1) | LOCKED (designed 2026-10-12, measured 2026-10-13) |
| ER-3c | Failure after text: keep partial, finish code `interrupted`, "answer was cut short" + Continue | LOCKED |
| ER-3d | Finish-code set: `blocked` (Gemini SAFETY/PROHIBITED_CONTENT/SPII/BLOCKLIST/RECITATION/MODEL_ARMOR, prompt block_reason, Claude refusal; no fallback), `max_tokens`, unknown reason with text = `other` + WARN, stream with text but no finish reason = failure after text | LOCKED (2026-10-10, -11) |
| ER-3e | Partial tool_use/thinking -> restart that step from the checkpoint | LOCKED; DEFERRED (Executor/checkpoints) |
| ER-4a | First-token timer = request sent -> first provider stream event (`provider_ttft`): Fast 20 s / Normal 45 s / Deep 90 s; expiry = no retry on same model, fallback reason `timeout` | LOCKED (N-43; measure point per Stage 17 doc-sync 2026-10-03; as built 2026-10-10) |
| ER-4b | Stall timer 30 s: no provider event for 30 s after the first text delta = failure after text (ER-3) | LOCKED (detail fixed 2026-10-10) |
| ER-4c | Tool timers: file_search 2 s, memory 2 s, web_search 20 s, fetch_url 10 s, run_code 60/120 s, load_skill 1 s | LOCKED (N-43) |
| ER-4d | Turn deadline 10 min (N-43; also N-06) | LOCKED |
| ER-4e | Executor request 15 min, API SSE >= 20 min, Executor owns its deadline, SIGTERM flush + resume, liveness = process alive | LOCKED; infra part |
| ER-4f | After a fallback the next model gets its own first-token timer; once the turn deadline has passed no retry and no fallback hop starts | LOCKED (2026-10-11) |
| ER-5 | Redis degraded mode (relay best-effort, DB polling every 2 s) | LOCKED; DEFERRED (Redis) |
| ER-6a | DB: pre_ping + recycle, whole-transaction retry <= 2, API statement timeout 5 s, lock_timeout 2 s, idle_in_transaction 30 s, 53300/55P03/statement timeout -> 503 `unavailable` + Retry-After 5 s | LOCKED (N-45; 55P03 added 2026-10-10) |
| ER-6b | Per-role timeouts retrieval 2 s / executor 30 s / shutdown 2 s, per-role pools | LOCKED; DEFERRED (roles/pools) |
| ER-7 | Cloud Tasks queue config, failed_jobs, warm queues, `maxRetryDuration` not to be shortened | LOCKED; DEFERRED (Cloud Tasks) |
| ER-8a | Tool failure -> `is_error` result with instructive text; answer continues with a notice; missing Gemini grounding metadata = not grounded, not an error | LOCKED |
| ER-8b | Read tools: one automatic retry on transient errors; write tools none | LOCKED |
| ER-8c | Sandbox timeout/OOM -> `TOOL_FAILED` + partial stdout | LOCKED |
| ER-9 | File error taxonomy: unsupported_type, too_large/too_many_pages, encrypted, corrupt, malware, ocr_failed, ocr_blocked, timeout, quota - user text + Retry/Remove | LOCKED |
| ER-10a | Client reconnect: backoff 1/2/4/8/16 s + jitter, 5 attempts (N-46) -> "Reconnecting..." -> manual Retry; foreground -> refetch | LOCKED |
| ER-10b | Seq gap -> snapshot; replay by last sequence; Stop = AbortController | LOCKED |
| ER-10c | Send retry reuses the same Idempotency-Key | LOCKED |
| ER-10d | GCS resumable 308/Range; 410/404 -> new session; expired signed URL -> fresh URL | LOCKED |
| ER-11 | Every API error and the SSE `error` event: RFC 9457 `application/problem+json` + `code`, `request_id`, `retryable`, `retry_after_s` (shape per doc-sync 2026-10-09) | LOCKED (replaces L3 shape) |
| ER-12a | Plain-English messages, support code shown small, keep typed text, Retry/Regenerate, reset time, labelled model switch | LOCKED |
| ER-12b | Ops incident banner = feature flag (suggested by Service Health poll); free public status page | LOCKED (hosting per Stage 17 OD-11) |
| ER-13 | Circuit breaker per model/tool (5 failures/30 s or >= 50 % of 20 calls, half-open 30 s), kill switch overrides, retry budget <= 10 %; admissions rule | LOCKED (N-47; as built 2026-10-11) |
| ER-14a | Model fallback chain (Stage 7 7.12) after retries/timeouts/breaker; switch is shown, never silent | LOCKED |
| ER-14b | Strip model-specific settings on fallback (between_tools, effort map, tool_choice, betas); retiring models out of lists (60-day alert) | LOCKED |
| ER-14c | Fallback credit (beta, Claude to Claude) | LOCKED as Later |
| ER-15 | Chaos tests (EH26) in LV-1 | LOCKED; DEFERRED |
| AL-1 | Bill partial streams from the last cumulative usage; Gemini 400/500 not charged | LOCKED |
| AL-2 | Refusal categories recorded in the ledger | LOCKED |
| AL-3 | App spend cap first, provider cap backstop | LOCKED |
| AL-4 | Tolerate unknown SSE events and finish reasons (-> `other` + alert) | LOCKED (folded into ER-3d bucket) |
| AL-5 | Thinking 400: "Invalid signature" -> strip + regenerate step; "bound to a different conversation" -> drop_block beta if LV-1 passes else strip | LOCKED |
| AL-6 | Research jobs retry 1 from checkpoint + partial-report notice | LOCKED; DEFERRED (Executor) |
| DS-1 | GAPIC REST client rule (never replace `transport._session`; retry-free in place) | LOCKED (Python google-cloud-* only) |
| DS-2 | Document AI request timeout 120 s, own LRO polling caps; Gemini OCR fallback 504 handling | LOCKED (Stage 9 surface) |
| DS-3 | Cache errors: a refused cached call is re-sent uncached at once; cache forgotten only when the re-send passes; cache admin call <= 10 s (N-74) | LOCKED (2026-10-11, ADR-0004) |
| DS-4 | Stop closes the provider stream (target <= 3 s; runner polls cancel every 2 s) | LOCKED |

## 2. Repo today

### 2a. Matrix row by row (provider error class / timer): locked action vs repo behaviour

| Row | Locked action | Repo behaviour (file:line) |
|---|---|---|
| Claude 429 (rate) | retry <= 2, honour Retry-After <= 10 s | retryable (`providers/anthropic.ts:31`), `retry-after` / `retry-after-ms` read (`:111-121`), `streamWithRetry` waits `max(backoff, retryAfter)` unless > 10 s (`generation.ts:2343-2353`); HTTP-date form of Retry-After not parsed |
| Claude 429 spend cap / 400 usage limit / 402 | no retry, skip all Claude rows | `isAccountLimit` -> `provider_limit` 402, not retryable (`anthropic.ts:102-133`); no skipping of other Claude rows (no fallback exists) |
| Claude 500/502/503/504/529, 408, 409 | retry | in `RETRYABLE_STATUS` (`anthropic.ts:31`) |
| Claude connection drop / SDK timeout | retry (transient) | `APIConnectionError` and aborts without a cancel -> retryable `ProviderError` (`anthropic.ts:627-638`), timeout -> `provider_timeout` |
| Claude 401/403 | config/credentials, no retry, fallback | `model_unavailable`, not retryable (`anthropic.ts:134-140`); not counted by any breaker; no credentials-vs-config split |
| Claude 404 | config, no retry | `ModelNotFoundError` (`anthropic.ts:126`, `types.ts:364-376`); registry marks the alias unavailable (`generation.ts:1043-1045`) |
| Claude 400/413/422 | request rejected, never retried, no fallback | not in retry set -> `provider_error`; context-overflow strings handled separately (`generation.ts:1407-1442`) |
| Claude refusal | no retry; blocked; fallback only per SD-9 | `final.stop_reason === 'refusal'` -> `refusal` event (`anthropic.ts:552-555`) -> `model_refused` 422 error (`generation.ts:1022-1023,2258-2264`); no `blocked` finish code, no category in ledger |
| Claude mid-stream `error` event | classify by error type; unknown = transient | not handled: the SDK throws, `statusOf` finds no status, so the error is non-retryable `provider_error` (`anthropic.ts:124-155`) |
| Gemini 429 / 500 / 503 / 504 | retry | text match on `429|resource_exhausted|unavailable|503|500|deadline` (`gemini.ts:233-238`): 502, 408, 409 are not matched; `504` is matched only via the word "deadline" |
| Gemini 429 quota-0 | configuration error, no retry, alert | treated as retryable (same text match); no quota wording check; no alert |
| Gemini 401/403/404 | config, no retry | 404 -> `ModelNotFoundError` (`gemini.ts:228-231`); 401/403 not retried by accident (text match misses them), not typed |
| Gemini SAFETY / PROHIBITED / RECITATION / MODEL_ARMOR / block_reason | finish `blocked`, no retry, no fallback | `finishReason = String(candidate.finishReason)` (`gemini.ts:520`) is passed on as `completed`; an empty answer then goes through the "forced synthesis" round and ends `empty_response` (`generation.ts:1103-1164`); no `blocked` anywhere |
| Gemini connection error / SDK timeout | retry | `isAbort` -> retryable `provider_timeout` (`gemini.ts:574-583`) |
| Gemini SDK retry | off explicitly, guard test | `new GoogleGenAI({vertexai, project, location})` with no retry option (`gemini.ts:349-353`); no test (searched `maxRetries|retryOptions` in `*.test.ts`: only `anthropic.firstParty.test.ts:21`) |
| Retry gating | only before first token | `userVisibleOutputEmitted` is set only by non-empty `delta` and `code` events (`generation.ts:1387-1392`); `thinking`, `tool_use`, `tool_result`, `sources`, `progress` do not count |
| Retry count / backoff | <= 2, 1 s -> 2 s full jitter, cap 8 s | `attempt >= PROVIDER_MAX_RETRIES` (`generation.ts:1445`), `retryDelayMs` (`:2343-2353`), values from `config/numbers.ts:23-29`; test `services/retryPolicy.test.ts:13-31` |
| Context overflow | not in the matrix (repo extra) | one bounded history reduction, never after visible output (`generation.ts:1410-1442`) |
| First-token timer 20/45/90 s | build | none by design (ADR-0024; `generation.ts:1361-1365`); only ttft is logged (`generation.ts:1385`) |
| Stall timer 30 s | build | none (ADR-0054 matrix table row "Stall timeout") |
| Per-request total | (N-43 gives none) | `PROVIDER_TIMEOUT_MS` 600,000 ms on both SDK clients (`anthropic.ts:52-54`, `gemini.ts:327,447`) |
| Turn deadline 10 min | 10 min | 3,540,000 ms (`config/numbers.ts:39`, applied `generation.ts:374-378`) |
| Fallback after retries/timeouts/breaker | chain, labelled | none; a failed retry ends the turn with a typed error (`generation.ts:1042-1094`); `resolveModel` falls to Gemini "via Auto" only when the requested alias is unavailable before the turn (`generation.ts:1287-1304`) |
| Failure after partial text | keep partial, `interrupted`, Continue | text is kept (`finalise` with `collectedText`, `:1056-1068`), but `status='error'`, `finishReason=null`, `errorCode=<mapped>`; UI Continue exists only for `max_tokens`-style cut and `tool_limit` (`ChatStates.tsx:160-181`) |
| Breaker / kill switch | per model, kill switch overrides | none (searched `breaker|kill.?switch|feature.?flag` in `backend/src`); registry only records availability per alias (`providers/registry.ts:230`) with a 300 s probe TTL (`config.ts:135`) |
| DB timeouts / retry | per ER-6 | `postgres()` options only `max` and `prepare:false` (`db/client.ts:36,52`); no statement/lock/idle timeouts, no tx retry, no 53300 mapping |
| Tool failure | `is_error`, notice | project tools return `ToolResult`, never throw (`tools/executor.ts:1-8`); the dispatcher does not catch a throwing executor (`tools/dispatchingExecutor.ts:12-22`); Claude duplicate-failed-call guard exists (`anthropic.ts:595-609`); no read-tool retry; no per-tool timers except fetch 10 s (`services/webFetch.ts:41`) and the sandbox |
| Reconnect | 5 attempts 1/2/4/8/16 s + jitter | 8 attempts at 0/1/2/4/8/15/30/60 s, no jitter, then `network` error (`arcnave-frontend/src/adapter.ts:163-206`) |
| Error body | RFC 9457 | `{error:{code,title,detail,requestId,meta?}}` JSON (`errors.ts:9-17,263-273`); SSE frame `{type:'error',code,title,detail,usage?}` (`generation.ts:1086-1092`) |
| Support code in UI | shown small | `requestId` is stored on the client error (`api.ts:41-57`) but no component renders it (searched `requestId` in `*.tsx`: none) |

### 2b. Evidence per decision id

| Id | Evidence (file:line) or "not found" |
|---|---|
| ER-1a | `providers/anthropic.ts:48-54` (`maxRetries: 0`); test `anthropic.firstParty.test.ts:19-21` |
| ER-1b | `providers/gemini.ts:349-353`; not found (searched: `retryOptions`, `HttpRetryOptions`, `attempts` in `backend/src/providers/*.ts` and tests) |
| ER-2a, ER-2c, ER-2d | `services/generation.ts:1367-1453,2343-2353`; `config/numbers.ts:22-29`; `config.ts:139-146`; `services/retryPolicy.test.ts:13-31` |
| ER-2b | `services/generation.ts:1375-1392,1444-1450` |
| ER-2e, ER-2f, ER-2g, ER-2h | `anthropic.ts:31,102-155`; `gemini.ts:228-238,574-590`; mid-stream error handling not found (searched `error` event handling in `anthropic.ts:506-546`: the `switch` has no `error` case) |
| ER-3a | `generation.ts:1445` (`userVisibleOutputEmitted ||` throws) |
| ER-3b | not found (searched `continu`, `recover` in `backend/src/services`, `providers`); `Continue` UI exists only for tool/output limit (`ChatStates.tsx:160-181`) |
| ER-3c, ER-3d | `generation.ts:1042-1094` (error path keeps text, `finishReason: null`); `usage.ts:332` `'blocked'` type never written; `interrupted|blocked|max_tokens` not found in `backend/src` outside comments |
| ER-4a..ER-4d, ER-4f | `config/numbers.ts:30-39`; `generation.ts:1361-1365`; `services/webFetch.ts:41`; `config.ts:250-266` (sandbox timers); `docs/decisions/0024-provider-timeouts-follow-claudes-sdk.md`; `0054-claude-first-party-api.md` matrix |
| ER-6a | `db/client.ts:36,52`; not found (searched `statement_timeout|lock_timeout|idle_in_transaction|53300|55P03` in `backend/src`) |
| ER-8a..ER-8c | `tools/executor.ts:1-8`, `tools/dispatchingExecutor.ts:12-22`, `anthropic.ts:595-609`, `tools/sandbox/warmSandboxClient.ts:150-160` (timeout throws `provider_timeout`) |
| ER-9 | `services/attachments/processUpload.ts:60-81` (`UploadRejected`, status `ready|unsupported`, free-text `error`); not found (searched `encrypted|corrupt|ocr_failed|ocr_blocked|malware` in `backend/src`) |
| ER-10a..ER-10d | `arcnave-frontend/src/adapter.ts:163-241`; server replay `routes/chats.ts:668-692` (`after`), frames carry `id:` (`chats.ts:828`); Idempotency-Key not sent by the client (searched `Idempotency-Key` in frontend `src`: none) though the server helper exists (`routes/helpers.ts:68-111`); foreground refetch not found (searched `visibilitychange`); "Reconnecting" banner not found; GCS resumable: `routes/files.ts:176` creates a direct upload, resume behaviour not verified |
| ER-11 | `errors.ts:9-17,263-273`; `app.ts:138-187`; test impact: 22 test files assert error shape (63 matches of `.error` / `error.code`) |
| ER-12a | `arcnave-frontend/src/api.ts:70-268` (`errorCopy`); `ChatStates.tsx:160-181` |
| ER-12b | not found (searched `banner|incident|status page|feature flag` in `backend/src`) |
| ER-13, ER-14a, ER-14b | not found; `docs/decisions/0054-claude-first-party-api.md` Decision 5 (server-side `fallbacks` off) and `CLAUDE.md` Invariant 1 |
| AL-1 | `generation.ts:1035` (usage set only on `completed`), `types.ts:82-92` (`addRequestUsage`), adapters yield usage only in `completed` (`anthropic.ts:662`, `gemini.ts:633`) |
| AL-2 | not found (searched `category` in `services/usage.ts`, `db/schema.ts`: refusal category is only in the error body `meta`, `generation.ts:2260-2263`) |
| AL-3 | `services/usage.ts:258-274` reserve before the call |
| AL-5 | not found (searched `Invalid signature`, `drop_block`, `thought_signature` handling beyond echo in `gemini.ts:497-503`) |
| DS-4 | `routes/chats.ts:696-713` (`controller.abort()`), adapters check `request.signal.aborted` (`anthropic.ts:502`, `gemini.ts:474`) |

## 3. Buckets

| Id | Bucket | One-line reason |
|---|---|---|
| ER-1a | KEEP | `maxRetries: 0` plus test |
| ER-1b | REWRITE | no explicit retry-off, own client or guard test on the Gemini client |
| ER-2a | KEEP | cap of 2 from register, tested |
| ER-2b | REWRITE | gate ignores thinking/tool events; a failure in tool round 2 re-runs round 1 tools |
| ER-2c | KEEP | formula and caps match N-42 |
| ER-2d | KEEP | honoured <= 10 s, longer fails the turn (fallback is its own row) |
| ER-2e | REWRITE | Gemini transient set by text match; misses 502/408/409 |
| ER-2f | REWRITE | no `blocked`; Gemini safety finishes not classified |
| ER-2g | REWRITE | no quota-0, credentials/config split, `claude_limit` skip semantics |
| ER-2h | REWRITE | Claude mid-stream error events unclassified |
| ER-3a | KEEP | no retry after a text delta |
| ER-3b | NEW-BUILD | no continuation attempt exists |
| ER-3c | REWRITE | partial kept but state `error`, no `interrupted`, no Continue for failures |
| ER-3d | REWRITE | no `blocked`/`max_tokens`/`other` mapping, no no-finish-reason rule |
| ER-3e | DEFERRED | needs Executor checkpoints |
| ER-4a | REWRITE | no first-token timer (ADR-0024 conflict) |
| ER-4b | REWRITE | no stall timer |
| ER-4c | REWRITE | only fetch_url and sandbox have timers; values not from config |
| ER-4d | REWRITE | 59 min vs 10 min (owner question Q3) |
| ER-4e | DIFF-INFRA | Cloud Run/Executor deadline mechanics |
| ER-4f | NEW-BUILD | needs fallback chain |
| ER-5 | DEFERRED | Redis |
| ER-6a | REWRITE | no timeouts, retry or 53300 mapping |
| ER-6b | DEFERRED | per-role pools |
| ER-7 | DEFERRED | Cloud Tasks |
| ER-8a | REWRITE | dispatcher does not convert throws into `is_error` |
| ER-8b | REWRITE | no read-tool retry |
| ER-8c | REWRITE | sandbox timeout throws instead of returning `TOOL_FAILED` + partial stdout (to verify at build) |
| ER-9 | REWRITE | free-text upload error, no taxonomy codes or Retry/Remove |
| ER-10a | REWRITE | 8 attempts, no jitter, no banner, no foreground refetch |
| ER-10b | KEEP | replay by sequence id in server and client |
| ER-10c | REWRITE | client never sends Idempotency-Key on generate |
| ER-10d | DIFF-INFRA | storage-side resumable uploads; not verified here |
| ER-11 | REWRITE | wire shape differs (options in section 4) |
| ER-12a | REWRITE | copy exists; support code, reset time, labelled switch missing |
| ER-12b | NEW-BUILD | no banner flag or status page |
| ER-13 | NEW-BUILD | no breaker, kill switch or retry budget |
| ER-14a | NEW-BUILD | no fallback chain |
| ER-14b | NEW-BUILD | capability stripping on switch does not exist |
| ER-14c | DEFERRED | Later (not built anywhere) - counted under DEFERRED |
| ER-15 | DEFERRED | chaos tests need LV-1 / infra |
| AL-1 | REWRITE | partial usage lost on failure |
| AL-2 | REWRITE | refusal category not in ledger |
| AL-3 | KEEP | reservation before the call, release after |
| AL-4 | REWRITE | covered in the ER-3d change (`other` + warn) |
| AL-5 | NEW-BUILD | no thinking-400 repair |
| AL-6 | DEFERRED | Executor |
| DS-1 | DIFF-STACK | Python GAPIC clients only; Node storage client defaults not audited |
| DS-2 | n/a | Document AI is not used in the repo; Stage 9 audit decides |
| DS-3 | NEW-BUILD | arrives with the Gemini explicit cache (Stage 18) |
| DS-4 | KEEP | Stop aborts the controller; adapters stop the stream |

Counts (51 ids): KEEP 8 (ER-1a, ER-2a, ER-2c, ER-2d, ER-3a, ER-10b, AL-3, DS-4) - REWRITE 24 (ER-1b, ER-2b, ER-2e, ER-2f, ER-2g, ER-2h, ER-3c, ER-3d, ER-4a, ER-4b, ER-4c, ER-4d, ER-6a, ER-8a, ER-8b, ER-8c, ER-9, ER-10a, ER-10c, ER-11, ER-12a, AL-1, AL-2, AL-4) - NEW-BUILD 8 (ER-3b, ER-4f, ER-12b, ER-13, ER-14a, ER-14b, AL-5, DS-3) - DISCARD 0 - DIFF-STACK 1 (DS-1) - DIFF-INFRA 2 (ER-4e, ER-10d) - DEFERRED 7, not bucketed (ER-3e, ER-5, ER-6b, ER-7, ER-14c, ER-15, AL-6) - n/a 1 (DS-2). Total 8 + 24 + 8 + 0 + 1 + 2 + 7 + 1 = 51.

## 4. Non-KEEP items

### ER-1b - google-genai retries explicitly off, own client, guard test
- Exact change: build the client with an explicit "one attempt" retry option and a project-owned HTTP transport (no automatic re-send on a connection error); add a test that counts requests at a local stub for 429 and 503 (stream and unary) and proves one request, plus a control showing a retrying client would make more. Confirm in the installed `@google/genai` source what the default is (not inspectable here).
- Files touched: `backend/src/providers/gemini.ts` (client construction :349-353), new `providers/gemini.retryGuard.test.ts`.
- Port source: `arcnave.in:backend/packages/gateway/tests/test_gateway_retry_guards.py`, `arcnave.in:backend/packages/gateway/src/arcnave_gateway/gemini.py`.
- Option A (REWRITE in place): explicit option + stub-server guard test. Time S, low risk, breaks nothing.
- Option B (NEW-BUILD): wrap both SDK clients in a project `providers/http.ts` transport used by both adapters. Time M, medium risk (touches the Anthropic path), breaks `anthropic.test.ts` fakes.
- Pick: A - the Python rule was a hidden second re-send path; one stub test proves the outcome without a new layer.

### ER-2b - "before first token" must include tool and thinking steps
- Exact change: the retry gate becomes "no event of any kind has been yielded downstream in this attempt, other than provider-level `progress`"; after a tool round has run, a failure in round N+1 is not retried from round 0 (it is the ER-3 partial case, or restarts that round only). Today a connection error in round 2 of a tool loop (no text yet) restarts the stream and re-executes round 1's tool calls, including write tools such as memory writes (`generation.ts:1387-1392,1444-1450`).
- Files touched: `services/generation.ts` (`streamWithRetry`), possibly `providers/{anthropic,gemini}.ts` (retry per round inside the adapter instead of per turn), tests `retryPolicy.test.ts`, `batch6OverflowStreamingSafety.test.ts`.
- Port source: none (Python gateway retries one provider call; its caller owns the tool loop: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/gateway.py`).
- Option A (REWRITE): widen the gate to any non-progress event. Time S, risk low (a retry becomes rarer), breaks the overflow test expectation about thinking.
- Option B (REWRITE bigger): move retry into each adapter round (retry one request, never the loop). Time M, risk medium, breaks both adapter loop tests.
- Pick: A now, B when the gateway is split out; A closes the write-tool replay hazard immediately.

### ER-2e / ER-2f / ER-2g / ER-2h - one typed failure classifier
- Exact change: one `classifyFailure(err, provider)` returning a closed kind (`transient`, `timeout`, `stall`, `quota`, `config`, `credentials`, `claude_limit`, `request_rejected`, `blocked`, `cancelled`) from HTTP status, provider status string and error type (never message text, except the one Gemini "Quota exceeded for" wording check in memory). Claude mid-stream `error` events map by error type to the status that type has. The retry loop, the breaker (ER-13) and the fallback chain (ER-14a) read only the kind. Gemini safety finish reasons become `blocked` (no retry, no fallback).
- Files touched: new `providers/failures.ts`; `providers/{anthropic,gemini}.ts` (drop `isRetryable`, `RETRYABLE_STATUS`); `services/generation.ts` (retry gate, error mapping); tests `anthropic.firstParty.test.ts`, new `failures.test.ts`.
- Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/failures.py` (kind table, spend-limit rules, stream error map).
- Option A (REWRITE/port): port `failures.py` rows to TypeScript with the SDK error classes. Time M, risk low, breaks `anthropic.firstParty.test.ts` expectations of `provider_limit` wording.
- Option B: patch the two existing predicates only. Time S, risk medium (the kind set stays implicit; no `blocked`, no breaker input).
- Pick: A - ER-13/ER-14 need the closed kinds anyway; B would be redone.

### ER-3b / ER-3c / ER-3d - mid-stream failure, continuation, finish codes
- Exact change: (1) after a failure that follows the first text, one continuation request to the same served model, pinned, no fallback, its own first-token timer, appended to the same answer; a stored counter (<= 1) per turn; the continuation text comes from a versioned prompt-kit file, sent as a new user message (never a prefill). (2) a failed turn that kept text ends with finish code `interrupted` (state failed), text kept, UI shows "answer was cut short" + Continue; (3) finish codes `blocked`, `max_tokens`, `other` (+ WARN once per unknown value), and a stream that ends after text with no finish reason = failure after text. `usage_records.finish_reason` already holds free text (`schema.ts:623`).
- Files touched: `services/generation.ts` (error path :1042-1094, `finalise`), both adapters (finish mapping), `arcnave-frontend/src/ChatStates.tsx` + `types.ts` (`cutOffReason`), `db/schema.ts` + migration (`continuations` counter on the assistant message), new prompt file under `backend/skills` or `services/`.
- Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/gateway.py` (continuation request), `arcnave.in:backend/packages/gateway/src/arcnave_gateway/prompts.py` (recovery block), `arcnave.in:backend/packages/chat/src/arcnave_chat/runner.py`, tests `test_gateway_continuation.py`.
- Option A (NEW-BUILD for 3b, REWRITE for 3c/3d): implement in-process in `GenerationService`, behind a flag until measured. Time M-L, risk medium (stream and persistence), breaks `providerTimeout.integration.test.ts` and error-path expectations.
- Option B: skip the continuation and ship only 3c/3d (partial + Continue). Time S-M, low risk, but misses the locked outcome of ER-3b.
- Pick: A in two commits (3c/3d first, 3b second); the first commit alone already gives the user the cut-short state.

### ER-4a / ER-4b / ER-4f - first-token and stall timers (conflict with ADR-0024)
- Exact change: per provider request (one tool round = one request, not per turn): arm a timer when the request is sent; the first provider stream event of any kind disarms it (Gemini now streams thought summaries, `includeThoughts: true`, `gemini.ts:440`, so an event arrives during thinking; Claude `message_start` arrives at once). Expiry aborts that request, no retry on the same model, kind `timeout`, fallback if a chain exists (ER-14a) else typed `provider_timeout`. Stall: after the first text delta, no event for 30 s -> failure after text (ER-3). Values from N-43 through `config/numbers.ts` (replace `PROVIDER_TIMEOUT_MS` comment "repo differs"). Tool rounds: the stall clock must pause while a tool runs.
- Files touched: `config/numbers.ts`, `config.ts`, `services/generation.ts`, adapters, `docs/decisions/0024-...` (superseded by a new ADR), tests `providerTimeout.integration.test.ts`.
- Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/config.py:19-21`, `gateway.py` (timers around the attempt), `failures.py` (`KIND_TIMEOUT`, `KIND_STALL`).
- Option A (REWRITE): build the timers as locked and supersede ADR-0024 with a new ADR that cites the Gemini thought-stream fact. Time M, risk medium: ADR-0024's live failure (large follow-ups aborted while still reading, mistakes.md 2026-09-24) must be re-tested with a >45 s Normal request. Breaks `providerTimeout.integration.test.ts` (no-cutoff expectation).
- Option B: keep ADR-0024 and write an owner-approved deviation ADR (no first-token cutoff, stall only). Time S, but the outcome of ER-4a stays unmet; needs owner OK (Q1).
- Pick: A, gated by Q1; if the owner keeps ADR-0024, take B and still build ER-4b (stall), which ADR-0024 does not argue against.

### ER-4c - tool timers
- Exact change: timers per N-43 (file_search 2 s, memory 2 s, web_search 20 s, fetch_url 10 s, run_code 60/120 s by profile, load_skill 1 s) read from config; an expiry returns `is_error` text (ER-8a). Today: fetch_url 10 s literal (`webFetch.ts:41`), web_search none (`webSearch.ts:52,70,107,127` pass only the caller signal), sandbox 300 s warm / 10 s Job (`numbers.ts:51-53`), project and memory tools none.
- Files touched: `config/numbers.ts`, `config.ts`, `tools/dispatchingExecutor.ts` (wrap each call in `AbortSignal.any([signal, AbortSignal.timeout(n)])`), `services/webSearch.ts`.
- Port source: none (timers are in the Executor design, Stage 15 EH4).
- Option A (REWRITE): central wrapper in the dispatcher. Time S-M, low risk. Option B: per-executor timers. Time M, duplicated logic.
- Pick: A. The run_code 60/120 s vs repo 300 s (warm service, OCR/renders take minutes, ADR-0010) is a value conflict - Q4.

### ER-4d - turn deadline 10 min
- Exact change: `TURN_DEADLINE_MS` 600,000 (N-43/N-06) instead of 3,540,000 (`numbers.ts:39`). Risk: scanned-PDF extraction turns that motivated 59 min (ADR-0054 matrix, checkpoint 2026-09-24) would end `turn_deadline_exceeded`.
- Files touched: `config/numbers.ts`. Tests: `providerTimeout.integration.test.ts` uses its own override (:26).
- Option A (REWRITE one number) - S, but may break the long-file use case until the long-task path exists (N-20 long tasks). Option B: keep 59 min under an owner-approved deviation ADR until the Executor/long-task design is built. Time S.
- Pick: owner decision Q3. Neither is chosen here.

### ER-6a - DB timeouts, pool health, transaction retry, 503 mapping
- Exact change: per connection `statement_timeout` 5 s, `lock_timeout` 2 s, `idle_in_transaction_session_timeout` 30 s (N-45 API values) via `postgres.js` `connection` options; max lifetime ~1,800 s (recycle); a whole-transaction retry helper (<= 2) for transient errors; map 53300, 55P03 and statement timeout to the ER-11 503 `unavailable` + `Retry-After: 5`.
- Files touched: `db/client.ts`, `app.ts` (error mapping), new `db/retry.ts`; long-running legitimate queries (extraction, export) need an explicit longer scope.
- Port source: `arcnave.in:backend/packages/db/src/arcnave_db/engine.py`, `.../errors.py`, `arcnave.in:backend/packages/chat/src/arcnave_chat/http/problems.py:36-40`.
- Option A (REWRITE): connection-level settings + helper. Time M, risk medium (export and retention sweeps may exceed 5 s). Option B: settings only. Time S, no retry.
- Pick: A with a named "long" transaction kind for sweeps and export.

### ER-8a / ER-8b / ER-8c - tool failure contract
- Exact change: the dispatcher catches any executor throw and returns `ok:false` with instructive text; read tools (`search_project_files`, `read_project_file`, `web_search`, `web_fetch`, memory reads) retry once on transient errors, write tools never; sandbox timeout/OOM returns `TOOL_FAILED` + partial stdout instead of throwing `provider_timeout` (`warmSandboxClient.ts:150-160`; verify at build). Missing Gemini grounding metadata stays a coverage flag (already: `gemini.ts:623-630`).
- Files touched: `tools/dispatchingExecutor.ts`, `tools/sandbox/warmSandboxClient.ts`, `tools/execution/executionRuntime.ts`. Port source: none. Option A (REWRITE) S-M. Option B (per-tool try/catch) M, duplicated. Pick: A.

### ER-9 - file error taxonomy
- Exact change: replace the free-text `error` on `attachments`/`project_files` with a code from the nine locked codes (unsupported_type, too_large/too_many_pages, encrypted, corrupt, malware, ocr_failed, ocr_blocked, timeout, quota), user text per code, Retry/Remove actions in the UI. `malware` and `ocr_blocked` depend on a scanner and Document AI that the repo does not use (Stage 9/16 audits).
- Files touched: `services/attachments/processUpload.ts`, `routes/files.ts`, `routes/projects.ts`, `db/schema.ts` + migration, `arcnave-frontend` file chips. Port source: none (Python Stage 9 not built). Option A (REWRITE) M. Option B: codes only, UI text later. S. Pick: A.

### ER-10a / ER-10c - reconnect and send retry
- Exact change: delays 1/2/4/8/16 s with full jitter, 5 attempts (read N-46 from a shared constant), then a visible "Reconnecting..." banner and a manual Retry; refetch the turn state when the tab returns to the foreground; the generate request carries an `Idempotency-Key` that a retry reuses (server helper `routes/helpers.ts:68-111` exists, not wired to `/generate`).
- Files touched: `arcnave-frontend/src/adapter.ts`, `App.tsx`/`ChatStates.tsx`, `routes/chats.ts` (generate), tests `adapter.test.ts`. Port source: none. Option A (REWRITE) S-M. Option B: banner only. S. Pick: A.

### ER-11 - API error contract: ApiError envelope vs RFC 9457
The repo plan (ADR-0053 consequences, "0056 typed `ApiError` kept over RFC 9457") rested on "repo wins", withdrawn by ADR-0061; the ADR was never written (0056 became Google sign-in). Treated as a gap. Locked outcome: `application/problem+json` with `type`, `title`, `status`, `code`, `request_id`, `retryable`, `retry_after_s`, never `detail` text of a request value, the same body on the SSE `error` event. Typed errors with a stable `code` (CLAUDE.md Invariant 5) are compatible with RFC 9457.
- Exact change: keep the `ApiError` class and the 42-code catalog as the internal throw mechanism (so Invariant 5 holds), but emit problem+json: top-level members instead of `{error:{...}}`, `request_id` for `requestId`, add `retryable`/`retry_after_s` per code (true for 429, 503; budget/limit codes false) and the `Retry-After` header; `title` = the catalog title; user copy stays in the frontend `errorCopy` keyed by `code` (already the case, `api.ts:70-268`); `meta` stays as an extension member. Fastify's own errors (400 JSON parse, 415, 404 route, 405) map through the same helper instead of falling into the 500 branch (`app.ts:172-186`). SSE error frame uses the same members.
- Files touched: `errors.ts` (`toBody`, `ErrorBody`), `app.ts` (handler, not-found handler), `routes/chats.ts:632-654`, `services/generation.ts:1086-1092`, `openapi.ts` and `docs/openapi.json` (error schema), `arcnave-frontend/src/api.ts:340-385`, `adapter.ts:296-318`, 22 backend/frontend test files that assert error shape.
- Port source: `arcnave.in:backend/packages/chat/src/arcnave_chat/http/problems.py` (`problem_body`, status->code map, `SAFE_NAME`).
- Option A (REWRITE the wire shape, keep the class): described above. Time M (mostly test updates), risk medium (frontend and tests move together), breaks ~63 assertions and the OpenAPI snapshot.
- Option B (DISCARD `ApiError`, rebuild on the Python helper with the 12 locked codes): Time L, risk high; loses 30 product codes (`budget_exceeded`, `context_overflow`, ...) unless added as per-endpoint codes - which the doc-sync 2026-10-09 explicitly allows ("later tasks may add more specific codes per endpoint but keep this helper and shape").
- Option C (owner-approved deviation ADR: keep the envelope, add `retryable`/`retry_after_s`/Content-Type problem+json inside it): Time S, risk low, but the body is not RFC 9457; needs an owner deviation.
- Pick: A. It meets the locked outcome, keeps Invariant 5 and the catalog, and the frontend already switches on `code`.

### ER-12a / ER-12b - messages, banner, status page
- Exact change: (a) show the support code (request id) small under every error; show reset time for limit errors (the data exists: `dailyResetsAt` / `monthlyResetsAt`, `usage.ts:97-98`); label a model switch in the answer header once fallback exists. (b) ops feature flag "incident banner" (DB setting or env, toggled by ops, never auto text) read by the frontend; the status page and Service Health poll are ops/infra (DF-17).
- Files touched: `arcnave-frontend/src/{api.ts,ChatStates.tsx,App.tsx}`, `routes/models.ts` or new `routes/status.ts`, `db/schema.ts` (settings table). Port source: none. Option A (REWRITE/NEW-BUILD) S-M. Option B: copy changes only. S. Pick: A.

### ER-13 / ER-14a / ER-14b - breaker, kill switch, fallback chain (Invariant 1)
- Exact change: per-model circuit breaker (5 failures in 30 s or >= 50 % of the last 20; half-open after 30 s with one trial; admissions given back exactly once), kill switch (ops setting) that overrides it, a fallback chain table (primary -> next, by profile) used after retries, first-token timeout or an open breaker, with `fallback_from`/`fallback_reason` on the turn and in the done event, the model switch shown in the UI header, and model-specific settings (effort map, tool_choice, thinking config, cache breakpoints) rebuilt for the receiving model. Retries/fallback only before the first text (ER-2); after text it is ER-3. `blocked` and `claude_limit`/`credentials` kinds follow SD-9 and skip rules. Retry budget (<= 10 %) is also unbuilt in the Python port.
- Invariant 1 ("never substitute silently") vs a fallback: a labelled switch with a machine-readable reason is not silent, and ER-12 requires the label, so the invariant holds if and only if the user sees which model answered. ADR-0054 Decision 5 turned the API's own server-side `fallbacks` off for the same reason; that stays off. ADR-0055 says Auto may route economy/balanced/quality. Owner decides the chain contents (Q2).
- Files touched: new `providers/{breaker,fallback}.ts`, `services/generation.ts`, `providers/registry.ts`, `db/schema.ts` (+ columns `fallback_from`, `fallback_reason`), `arcnave-frontend` (header label). Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/breaker.py`, `gateway.py`, `registry.py`.
- Option A (NEW-BUILD): build beside the current single-model path behind a config flag, switch once measured. Time L, risk medium, keeps the app runnable at every commit. Option B (REWRITE `streamWithRetry` into the chain): Time L, higher risk.
- Pick: A. Stage 7 7.12 chain contents and the Haiku 5.5 router conflict with ADR-0055 (three models); see Q2.

### AL-1 / AL-2 / AL-4 - partial billing, refusal category, unknown finish
- Exact change: adapters emit a cumulative `usage` event after every round (and from `message_delta`), the service keeps the last one and writes it on the error/cancel path with `usage_source='partial'` (provider-reported, incomplete) instead of zeros; refusal category stored in a ledger column; unknown finish reasons stored as `other` + WARN. Constraint: CLAUDE.md Invariant 3 forbids estimates; the locked OD-13 `usage_source='estimated'` adds a tokenizer estimate - conflict, see Q5. `partial` keeps the invariant.
- Files touched: `providers/{anthropic,gemini,types}.ts`, `services/generation.ts` (1035, 1070-1084), `services/usage.ts`, `db/schema.ts` + migration. Port source: `arcnave.in:backend/packages/ledger/src/arcnave_ledger/cost.py`, gateway `CallRecord` (`contract.py`). Option A (REWRITE) M. Option B: log only. S, leaves spend invisible. Pick: A.

### AL-5 - thinking 400 repair
- Exact change: on a 400 whose text matches the two documented thinking errors, strip thinking blocks from history and regenerate that step once (never more); drop_block beta only if LV-1 passes (not used). Files: `providers/anthropic.ts`, `providers/gemini.ts` (signature handling `:497-503`). Port source: none. Option A (NEW-BUILD) S-M. Option B: defer to a first incident. Pick: A, low priority.

### DS-3 - cache-error rules
- Arrive with the Gemini explicit cache (Stage 18 ADR-0004 row): refused cached call re-sent uncached once, cache recreated only after a clean re-send, admin calls 10 s. Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/gemini_cache.py`.

### ER-4e / ER-10d (DIFF-INFRA)
- Deadline ownership, SIGTERM flush and resumable uploads are Cloud Run / storage mechanics; the repo's in-process turn keeps its own `TURN_DEADLINE_MS` abort (`generation.ts:374-378`), which already ends with a typed error instead of a platform 504.

## 5. Open questions for the owner

- Q1. ADR-0024 / ADR-0054 keep "no first-token cutoff" and "no stall timer"; ER-4a/4b lock 20/45/90 s and 30 s. Build the timers (Option A) or approve a deviation ADR? Fact for the decision: Gemini now streams thought summaries, so the 2026-09 failure (silence while thinking) no longer applies the same way.
- Q2. Fallback chain: which model follows which (Stage 7 7.12), and does the owner accept a labelled switch under Invariant 1? B-4 / ADR-0055 ("three models only") conflicts with the Haiku 5.5 router (ADR-0013, N-69) and Haiku worker jobs (ADR-0014); not resolved here.
- Q3. Turn deadline 10 min (N-43/N-06) vs 59 min kept for scanned-PDF extraction turns (ADR-0054 matrix): which wins until a long-task path exists?
- Q4. run_code time: N-08 60 s (Deep 120 s) vs repo 300 s on the warm sandbox (ADR-0010: OCR and renders take minutes).
- Q5. CLAUDE.md Invariant 3 ("no estimator") vs OD-13 `usage_source='estimated'` with a tokenizer estimate: accept `partial` (provider-reported only) as the locked outcome, or amend the invariant?
- Q6. ADR-0056 keeps passwords beside Google sign-in; SD-1 revised (2026-10-09) removes passwords and makes sign-in invite-only. Affects ER-12 copy and `weak_password`, `invalid_credentials` codes (see stage-16.md Q-S1).

## 6. KEEP spot-check

8 KEEP rows, 2 re-opened (>= 10 %): 
- ER-1a: `providers/anthropic.ts:48-54` shows `maxRetries: 0` and the timeout from config; test `anthropic.firstParty.test.ts:19-21` asserts `client.maxRetries` is 0 - confirmed.
- ER-2c: `services/generation.ts:2343-2353` computes `ceiling = min(8000, 1000 * 2^(attempt-1))`, `backoff = random * ceiling`, and `max(backoff, retryAfter)`; a Retry-After above 10,000 ms returns null (:2349) - confirmed. Note: the locked text says Retry-After above the cap goes "straight to fallback"; with no fallback the turn fails (fallback is ER-14a).
- Not re-opened: ER-2a, ER-2d, ER-3a, ER-10b, AL-3, DS-4 (read once during the audit).
