# Evidence pack G4 (Stages 15-18) - names and shapes only

Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Paths relative to `D:\arcnave-tech`. No values of
secrets, ids or user content appear here. `.env.example` could not be read (access to it is denied to this
auditor); `compose.yaml` and `backend/src/config.ts` were used instead. `node_modules` is not installed, so
installed SDK sources could not be inspected (`@google/genai` ^2.22.0, `@anthropic-ai/sdk` ^0.126.0 per
`backend/package.json:24,32`).

## (a) ApiError codes and HTTP status

Wire shape today: `{ error: { code, title, detail, requestId, meta? } }` (`backend/src/errors.ts:9-17`, `toBody` :263-273).
Content-Type is plain JSON, not `application/problem+json`. `retryable` / `retry_after_s` do not exist.
Catalog (42 codes, `errors.ts:25-238`), code : status : line:

| Code | HTTP | Line |
|---|---|---|
| tool_protocol_in_text | 502 | :26 |
| validation_error | 422 | :32 |
| not_found | 404 | :37 |
| conflict | 409 | :42 |
| unauthorized | 401 | :47 |
| forbidden | 403 | :52 |
| email_taken | 409 | :53 |
| invalid_credentials | 401 | :58 |
| weak_password | 422 | :63 |
| google_signin_disabled | 404 | :68 |
| registration_closed | 403 | :73 |
| payload_too_large | 413 | :78 |
| unsupported_media_type | 415 | :83 |
| too_many_files | 409 | :88 |
| upload_incomplete | 409 | :93 |
| rate_limit | 429 | :98 |
| idempotency_conflict | 409 | :99 |
| model_unavailable | 400 | :106 |
| no_model_available | 503 | :111 |
| capability_unavailable | 400 | :116 |
| budget_exceeded | 402 | :122 |
| run_in_progress | 409 | :128 |
| no_active_run | 404 | :133 |
| export_unsupported | 422 | :138 |
| password_incorrect | 403 | :144 |
| export_expired | 410 | :149 |
| share_not_found | 404 | :154 |
| share_empty | 422 | :159 |
| preview_unsupported | 422 | :165 |
| empty_response | 502 | :171 |
| model_refused | 422 | :176 |
| provider_payload_limit | 400 | :181 |
| context_overflow | 400 | :186 |
| provider_error | 502 | :192 |
| provider_limit | 402 | :197 |
| provider_timeout | 504 | :203 |
| turn_deadline_exceeded | 504 | :208 |
| storage_error | 500 | :213 |
| style_not_found | 404 | :218 |
| style_too_long | 422 | :223 |
| sample_too_long | 422 | :228 |
| internal_error | 500 | :233 |

Status is derived from the code (one code = one status, `errors.ts:253-258`). No code carries `retryable`.
Locked ER-11 statuses/codes (Python build `arcnave.in:backend/packages/chat/src/arcnave_chat/http/problems.py:19-35`):
400 bad_request, 401 unauthorized, 403 forbidden, 404 not_found, 405 method_not_allowed, 409 conflict, 413 payload_too_large,
415 unsupported_media_type, 422 validation_error, 429 rate_limited, 500 internal_error, 503 unavailable, else `http_<status>`;
`retryable` true only for 429/503.

Where codes are thrown (file:line, grouped):
- auth/session: `plugins/context.ts:63,68` unauthorized; `routes/auth.ts:65` registration_closed, `:109` google_signin_disabled;
  `services/auth.ts:160,328` weak_password, `:171,250` internal_error, `:175` email_taken, `:205,208,237,336` invalid_credentials,
  `:210,272` forbidden, `:243` registration_closed; `services/googleSignIn.ts:40,43` invalid_credentials; `routes/account.ts:70` export_expired, `:100` password_incorrect.
- uploads/files: `routes/files.ts:101,209` validation_error, `:106,161` code from `check.code` (payload_too_large | unsupported_media_type, `services/attachments/processUpload.ts:61-69`),
  `:206,405` conflict, `:217,225,254` upload_incomplete, `:345` not_found, `:378,380` preview_unsupported, `:475` unauthorized, `:521` code from `err.code`;
  `routes/projects.ts:395,632` validation_error, `:403` check.code, `:692` unauthorized; `routes/chats.ts:1104` upload_incomplete, `:1115` too_many_files.
- chat/run: `routes/chats.ts:568` run_in_progress, `:686,688` no_active_run, `:874,889` unauthorized, `:1193` validation_error; `routes/helpers.ts:59` conflict, `:111` idempotency_conflict.
- artifacts/share/styles/memory/usage/preferences: `routes/artifacts.ts:375,460,533` validation_error, `:385` export_unsupported, `:391` payload_too_large, `:436,439` preview_unsupported, `:509,642` unauthorized;
  `routes/share.ts:109,365,450` share_not_found, `:144,180` share_empty; `routes/sheetPreview.ts:44` preview_unsupported; `routes/styles.ts:120,314` style_too_long, `:162` sample_too_long, `:170` no_model_available, `:174,179` model_unavailable, `:274,283,323,366` style_not_found;
  `services/styles.ts:78,92` style_not_found, `:109` validation_error, `:116` sample_too_long; `routes/memory.ts:139,175,317,320` validation_error, `:170` conflict, `:173,200` not_found; `routes/usage.ts:177,188` validation_error; `routes/preferences.ts:113` validation_error, `:164` internal_error; `services/usage.ts:239` internal_error; `BudgetExceededError` (`services/usage.ts:159-169`) = budget_exceeded 402 with meta {period, used, limit}.
- generation/provider: `services/generation.ts:378` turn_deadline_exceeded, `:490` model_unavailable, `:503,516,1291` capability_unavailable, `:1156` empty_response, `:1334` no_model_available, `:1479` internal_error, `:2260` model_refused (meta.category), `:2293,2322` context_overflow, `:2302` provider_payload_limit, `:2311` code from `ProviderError.code` (provider_error | provider_timeout | model_unavailable | context_overflow | provider_limit), `:2334` provider_error;
  `services/answerProtocolGuard.ts:25` tool_protocol_in_text; `services/attachments/modelLimits.ts:64` provider_payload_limit; `providers/anthropic.ts:46` ProviderError model_unavailable.
- framework-level (`app.ts:138-194`): ApiError passthrough; zod validation -> validation_error with `meta.issues[] {path, message}` (:148-158); statusCode 429 -> rate_limit (:162-165); 413 -> payload_too_large (:167-170); everything else -> logged and answered 500 internal_error (:172-186), including Fastify's own 400/415 parser errors (code reading only, not run); unknown route -> not_found with `detail` echoing method + URL (:189-194).
- SSE: error frame `{type:'error', code, title, detail, usage?}` (`services/generation.ts:1086-1092`; `routes/chats.ts:632-654` fallback body for non-ApiError = internal_error, "The response could not finish."). No `request_id`, `retryable`, `retry_after_s`.
- Client-only code: `network` (`arcnave-frontend/src/api.ts:72,337`, `adapter.ts:137,193,223`) - not in the server catalog.

## (b) Usage and cost fields

`usage_records` (`backend/src/db/schema.ts:592-642`) columns: id, user_id, request_id, chat_id, message_id, project_id, model_alias, provider, provider_model_id,
input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens, tokens_exact, context_tokens, started_at, completed_at, latency_ms, finish_reason, status
(complete|cancelled|error|blocked; `blocked` is never written - `grep` of `status: 'blocked'` finds only the type, `services/usage.ts:332`), error_code, cost_usd, cost_inr.
Indexes: user+started_at, user+model_alias, request_id. One row per generation attempt (a turn), not per provider call. Not present: company_id, provider_ref_type/provider_ref,
usage_source, thinking_tokens, cache_write_5m/1h split, tool_use_in_tokens, traffic_type, inference_geo, price_version, fx_inr_per_usd, promo_credit_*, provider_ttft_ms, first_delta_ms,
purpose/job_id/helper_version, refusal category, fallback_from.
`usage_counters` (`schema.ts:650-664`): id, user_id, period_kind (day|month), period_start, tokens_used, tokens_reserved, updated_at; unique (user, kind, start).
`preferences` budget columns (`schema.ts:99-106`): max_output_tokens (default 64000), daily_token_budget, monthly_token_budget, warn_threshold_pct (default 80), routing_preference, timezone.
Provider usage object (`providers/types.ts:46-58`): inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, exact, lastRequest{inputTokens,outputTokens}. Gemini maps `outputTokens = candidates + thoughts`,
`inputTokens = prompt - cached`, `cacheWriteTokens = 0` (`providers/gemini.ts:261-278`); Claude takes max per field across `message_start`/`message_delta` (`providers/anthropic.ts:182-191`),
no thinking-token field read, no request-id captured.
Done-event usage DTO (`services/generation.ts:196-211`): inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, exact, costUsd, costInr; `done` event also carries finishReason, effort, questions (`generation.ts:1219-1225`).
`GET /v1/usage` (`routes/usage.ts:65-74`): today/month/allTime totals (inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, costUsd|null, costInr|null, requests), byModel/byProject groups
(key, inputTokens, outputTokens, totalTokens, costUsd, costInr, requests), limits (maxOutputTokens, dailyTokenBudget, monthlyTokenBudget, warnThresholdPct, routingPreference, timezone, dailyUsed, monthlyUsed, dailyPct, monthlyPct, warnings[], dailyResetsAt, monthlyResetsAt), pricingConfigured.
`GET /v1/usage/messages` per-message (`usage.ts:76-95`): messageId, modelAlias, provider, providerModelId, token fields, exact, costUsd, costInr, latencyMs, status, finishReason, errorCode, startedAt, completedAt.
`GET /v1/usage/export` CSV columns (`usage.ts:308-330`): started_at, completed_at, latency_ms, model_alias, provider, provider_model_id, input/output/total/cache_read/cache_write tokens, tokens_exact, status, finish_reason, error_code, cost_usd, cost_inr, chat_id, message_id, project_id, request_id.
Price table: env `PRICING_TABLE` JSON `{ "<providerModelId>": { input, output, cacheRead, cacheWrite } }` USD per 1M tokens (`config.ts:61-69,384-398`); no dated rows, no cache-write 5m/1h split, no cache storage, no tiered rows, no promo credit rows; an absent model = cost null (never 0).
Default is empty (`compose.yaml:80`); no committed price values were found in the readable files. FX: `PRICING_INR_PER_USD` default 88 (N-37 planning) (`config.ts:378`, `config/numbers.ts:83`). cost_usd rounded to 1e-6 (`generation.ts:2204-2214`, `usage.ts:116-131`); `cost_inr = usd * rate`, rounded 1e-6 (`usage.ts:139-142`).
Turn log (`turn_logs`, `schema.ts:516-525`): message_id, user_id, markdown, created_at.

## (c) Log fields emitted today (event / fields; names only)

Logger: pino JSON in production/test, `pino-pretty` in dev (`logger.ts:69-87`); redaction paths in `logger.ts:40-67` (secrets only; no content paths). Fastify uses this logger (`app.ts:68`), so Fastify's own request/response lines (route URL incl. query string, method, status, timing; generated request id from client `x-request-id` header up to 64 chars, `app.ts:60-64`) are also emitted.
Flag legend: C = can carry user/file/model/provider text (via `err` object message/stack, `String(err)`, a result body, a file name or a model-supplied string); I = identifier rule (project number / service URL); ok = ids, codes, counts, durations.

| file:line | level | message | fields | flag |
|---|---|---|---|---|
| app.ts:144 | debug | api error | code, statusCode, requestId | ok |
| app.ts:175 | error | unhandled error | errorType, errorCode, rootType, rootCode, messageLength, requestId, method, route, statusCode | ok (errorLogFields, `errorLog.ts:47-65`) |
| container.ts:151,153,167,185,196 | error/warn/info | sandbox engine fail-closed lines | none | ok |
| container.ts:163 | info | run_python uses the warm sandbox service | url | I (service URL from config) |
| index.ts:25 | info | purged expired sessions | count | ok |
| index.ts:27,43,56,79,88,91,117 | error/fatal | session sweep / retention sweep / checkpoint sweep / shutdown / unhandled / uncaught / failed to start | err | C (pino err = message + stack; a DB error can carry query parameters) |
| index.ts:41 | info | retention sweep | chatsPurged, uploadsPurged, checkpointsPurged | ok |
| index.ts:54 | info | sandbox checkpoint sweep | saved, failed | ok |
| index.ts:65 | info | shutting down | signal | ok |
| index.ts:76 | info | shutdown complete | - | ok |
| index.ts:96 | info | arcnave backend listening | port, host, env, apiPrefix, vertexConfigured, docs | ok |
| index.ts:109 | warn | GOOGLE_CLOUD_PROJECT is not set | - | ok |
| db/migrate.ts:39,43 | info/fatal | migrations applied / migration failed | err (fatal) | C |
| services/generation.ts:701 | error | failed to release budget reservation | err, userId | C (err), user id raw |
| services/generation.ts:1055 | error | generation failed | err, chatId, requestId | C (provider message text is embedded: `providers/anthropic.ts:142`, `gemini.ts:587`) |
| services/generation.ts:1144 | warn | Forced synthesis round failed | err | C |
| services/generation.ts:1215 | info | Runtime debug trace | debugTrace{loadedSkills[], allowedTools[], toolsCalled[]} | ok (tool and skill names) |
| services/generation.ts:1235 | info | turn timing | chatId, messageId, phasesMs{...}, totalMs, probed, model, compacted, effort, requestedEffort, streamMs{model,tools,longestModelWait,modelRequests}, toolCalls | ok |
| services/generation.ts:1243 | warn | turn log not saved | err, messageId | C |
| services/generation.ts:1300 | info | Requested model is disabled or unavailable; falling back to ... Gemini via Auto | requested (alias) | ok |
| services/generation.ts:1385 | info | provider first event | ttftMs, attempt | ok |
| services/generation.ts:1413 | warn | provider context overflow detected | err (String) | C (provider error text) |
| services/generation.ts:1449 | warn | retrying provider call | attempt, delay, err (String) | C (provider error text) |
| services/generation.ts:1710 | warn | compaction failed | err, chatId | C |
| services/generation.ts:1754 | warn | failed to load attachment bytes for wire payload | err, storageKey | C (err) |
| providers/gemini.ts:462,464 | warn | streamed function-call arguments rejected / final round rejected | err (String), model | C |
| providers/gemini.ts:648 | debug | gemini probe failed | err, providerModelId | C (debug) |
| providers/anthropic.ts:676 | debug | anthropic probe failed | status, providerModelId | ok |
| routes/chats.ts:637 | error | generation failed | err | C |
| routes/chats.ts:652 | error | failed to mark run as errored | err | C |
| routes/files.ts:416,460 | warn | orphaned object after delete / cleanup | err, storageKey | C (err; key holds user id) |
| routes/files.ts:524 | error | attachment extraction failed | err | C (parser errors can quote file text) |
| routes/projects.ts:534 | warn | orphaned object after delete | err, storageKey | C |
| routes/projects.ts:798 | error | indexing failed | err, fileId | C |
| services/retention.ts:141 | warn | stored object could not be deleted | err, storageKey | C |
| services/skills.ts:163,195,211,223,234,240 | warn/info | skills registry lines | candidatePaths, key, skillFilePath, count, rejected, filePath, err, errors | ok (server paths, skill names) - `:234` err from YAML parse |
| services/skills.ts:434,459 | warn | path traversal attempt detected | skillName, resourcePath | C (model-supplied strings) |
| tools/codeExecutionExecutor.ts:429,507 | warn | failed to store presented files / place a conversation file in the sandbox | err, fileId | C |
| tools/execution/executionRuntime.ts:298 | warn | failed to collect output files | err, outputDir | C |
| tools/execution/executionRuntime.ts:320 | warn | Output file failed OOXML structural validation | filename, errors | C (user-visible file name, validator strings) |
| tools/execution/executionRuntime.ts:364 | warn | failed to clean up workspace | err, workspaceDir | C |
| tools/execution/executionRuntime.ts:511 | warn | Failed to parse CLI container execution output | err, result | C (sandbox stdout/stderr = file or model text) |
| tools/sandbox/processSandboxClient.ts:212 | error | ProcessSandboxClient execution error | err, cwd | C |
| tools/sandbox/workspaceState.ts:112 | warn | sandbox checkpoint could not be deleted | err, manifestKey | C |
| tools/sandbox/warmSandboxClient.ts:285 | warn | sandbox checkpoint failed | err, workspace | C |

Shadow test: `backend/src/test/contentLeak.test.ts` (sentinels in user message, file, memory file, reply; also a failed-query case). It captures every pino line of one happy-path turn, so none of the C rows above is exercised (header comment :10-23).
Content stored outside logs (not log lines): `turn_logs.markdown` holds user message as sent, thought summary, reply text, every tool call input and result, error message and top 8 stack lines (`services/turnLog.ts:136-233`); system prompt text itself is not stored (size + section names, `:168-172`).

## (d) Env / config keys, defaults, N-id comment

`backend/src/config.ts` (zod schema `:71-399`); N-ids resolve from `backend/src/config/numbers.ts`.
HTTP/session: NODE_ENV=development; PORT=8080; HOST=0.0.0.0; LOG_LEVEL=info; API_PREFIX=/v1; CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173; SESSION_COOKIE_NAME=arcnave_session;
SESSION_TTL_HOURS=336 (N-49 "repo value 14 d", numbers.ts:73); SESSION_COOKIE_SECURE=false; COOKIE_SECRET unset (production needs >= 32 chars, `config.ts:425`); REGISTRATION_ENABLED=true; GOOGLE_OAUTH_CLIENT_ID unset.
Database: DATABASE_URL default is a local dev URL that contains a default credential (`config.ts:97` - forbidden-literal candidate); DB_POOL_MAX=10 (N-66, numbers.ts:71); DB_SOCKET_PATH unset. No statement/lock/idle timeouts anywhere (`db/client.ts:36-52`).
Providers: GOOGLE_CLOUD_PROJECT unset; VERTEX_LOCATION=global; GEMINI_LOCATION unset; ANTHROPIC_API_KEY unset (secret); MODEL_GEMINI_FLASH unset; MODEL_SONNET=claude-sonnet-5-5; MODEL_OPUS=claude-opus-5-5;
AUTO_ROUTE_LONG_PROMPT_CHARS=2000; AUTO_ROUTE_LONG_CONTEXT_CHARS=8000; MODEL_PROBE_TTL_SECONDS=300; PROVIDER_TIMEOUT_MS=600000 (N-43 "repo differs", numbers.ts:35); PROVIDER_CONNECT_TIMEOUT_MS=10000 (no N-id);
PROVIDER_MAX_RETRIES=2, PROVIDER_RETRY_BASE_MS=1000, PROVIDER_RETRY_MAX_BACKOFF_MS=8000, PROVIDER_RETRY_AFTER_MAX_MS=10000 (all N-42, numbers.ts:23-29); TURN_DEADLINE_MS=3540000 (N-43 repo, numbers.ts:39).
Generation: DEFAULT_MAX_OUTPUT_TOKENS=64000 (N-74 repo, numbers.ts:41); MAX_OUTPUT_TOKENS_CEILING=128000; CONTEXT_EDIT_TRIGGER_TOKENS=100000; CONTEXT_EDIT_KEEP_TOOL_RESULTS=3; CONTEXT_EDIT_CLEAR_BATCH=5; REASONING_EFFORT=medium;
PROJECT_FULL_CONTEXT_MAX_CHARS=200000; HISTORY_MAX_ATTACHMENT_BYTES=12000000.
Search/tools: ENABLE_GOOGLE_SEARCH_GROUNDING=false; ENABLE_ANTHROPIC_WEB_SEARCH=false; ENABLE_WEB=false; SERPAPI_API_KEY, GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID unset (secrets); GROUNDING_REDIRECT_TIMEOUT_MS=5000;
ENABLE_GEMINI_CODE_EXECUTION=false; GEMINI_STREAM_TOOL_ARGS=true; ENABLE_TOOL_USE=false; TOOL_MAX_ROUNDS=16 (N-06 repo, numbers.ts:43); READ_PROJECT_FILE_MAX_CHARS=6000 (N-09, numbers.ts:45); TOOL_RESULT_PREVIEW_CHARS=300.
Sandbox: ENABLE_RUN_PYTHON=false; ENABLE_TRUSTED_CLI=false; ENABLE_SKILL_SCRIPTS=false; TRUSTED_WORK_ENGINE=local; TRUSTED_PYTHON_PATH=python3 (python on win32); TRUSTED_WORK_TIMEOUT_MS=120000; SANDBOX_ENGINE=auto; SANDBOX_SERVICE_URL unset;
SANDBOX_SERVICE_AUTH=id-token; RUN_PYTHON_WARM_CODE_TIMEOUT_MS=300000 (N-08 repo, numbers.ts:53); SANDBOX_LOCATION=us-central1 (not asia-south1); SANDBOX_JOB_NAME=arcnave-python-sandbox; SANDBOX_STAGE_BUCKET unset; MAX_CODE_BYTES=20480;
RUN_PYTHON_CODE_TIMEOUT_MS=10000 (N-08 repo, numbers.ts:51); RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS=45000; MAX_STDOUT_BYTES=65536; MAX_STDERR_BYTES=65536; RUN_PYTHON_MAX_OUTPUT_CHARS=30000 (N-09, numbers.ts:47); MAX_CONCURRENT_RUN_PYTHON=20; SANDBOX_CLAIM_LEASE_BUFFER_MS=30000.
Features: ENABLE_SKILLS=true; SKILLS_DIR=skills; ENABLE_PROMPT_CACHE=true; ENABLE_MEMORY=true; MEMORY_CONTEXT_MAX_CHARS=8000; ENABLE_CONTEXT_COMPACTION=true; COMPACTION_TRIGGER_TOKENS=150000; COMPACTION_TRIGGER_HEADROOM_TOKENS=10000;
COMPACTION_TRIGGER_HEADROOM_RATIO=0.15; ENABLE_GENERATIVE_UI=true; UI_MAX_RESPONSE_BYTES=100000.
Storage: STORAGE_BACKEND=local; STORAGE_LOCAL_PATH=./var/uploads; STORAGE_GCS_BUCKET unset; MODEL_INPUT_BUCKET unset; CHAT_PURGE_AFTER_DAYS=30 (N-33, numbers.ts:61); UNSENT_UPLOAD_TTL_HOURS=24; SANDBOX_CHECKPOINT_IDLE_SECONDS=300;
SANDBOX_STATE_RETENTION_DAYS=30; MAX_UPLOAD_BYTES=31457280 (N-10, numbers.ts:57); ATTACHMENT_MAX_BYTES=524288000 (N-10, numbers.ts:59); EXTRACTION_MEMORY_BUDGET_BYTES=4294967296.
Rate limits: RATE_LIMIT_GENERATE_PER_MINUTE=20 (N-01, numbers.ts:65); RATE_LIMIT_WRITE_PER_MINUTE=120 (N-01 repo, numbers.ts:67); RATE_LIMIT_AUTH_PER_MINUTE=10 (no N-id); RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE=60 (no N-id).
Pricing: PRICING_INR_PER_USD=88 (N-37, numbers.ts:83); PRICING_TABLE unset -> {}.
Literals without an N-id comment (candidates for the "no literal for a registered number" rule): SSE heartbeat 15,000 ms (`routes/chats.ts:814`, = N-24 value); web fetch timeout 10,000 ms and 1,000,000-byte cap (`services/webFetch.ts:41-42`, = N-43 fetch_url 10 s); prompt body max 100,000 chars (`routes/chats.ts:543`, N-02 says 32,000);
attachments per message 10 (`chats.ts:546`, N-10 <= 10); partial-input interval 120 ms (`anthropic.ts:58`); web search `max_uses: 5` (`anthropic.ts:38`); CORS maxAge 600 (`app.ts:90`); multipart files 10 / fields 20 (`app.ts:104`); image max 10 MB / 8000 px, PDF 1000 pages / 100 visual (`processUpload.ts:29-37`; N-10 lists image 20 MB).
Frontend: VITE_API_BASE (Dockerfile default `/v1`, `arcnave-frontend/Dockerfile:12`; code fallback to a hard-coded Cloud Run service URL that embeds a numeric project identifier, `src/api.ts:31-33` - identifier-in-code candidate); VITE_API_PROXY (default http://127.0.0.1:8080, `vite.config.ts:14`); VITE_GOOGLE_OAUTH_CLIENT_ID (unset = button hidden, `GoogleSignInButton.tsx:25-27`). SSE reconnect delays [0,1000,2000,4000,8000,15000,30000,60000] ms (`src/adapter.ts:163`).
Compose-only keys (`compose.yaml`): POSTGRES_USER=arcnave, POSTGRES_PASSWORD (required), POSTGRES_DB=arcnave, NODE_ENV=production, SESSION_COOKIE_SECURE=true, CORS_ORIGINS=http://localhost:8080, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_ADC_PATH, PORT (frontend publish port 8080).
