# ArcNave – Stage 15 · Error handling and fallbacks – DRAFT (needs user OK)
_2026-10-03 · Source: Astra results 15-astra-results.md (official docs, 3 Oct 2026) + locked inputs (Stage 7 fallback matrix, Stage 4 L4 G38/G39/G43, L6 AS-D3, R5/R13, Stage 13 finish-code map + VD-3, Stage 5 F3) · Labels: ✅ Vendor · ⚠️ Partial · 📄 Official blog · 🔧 ArcNave design · Numbers marked (N) are provisional → 00-numbers-register (Stage 18 confirms)._

## 0. Scope
Every failure path: provider errors, mid-stream failures, tool failures, file-processing failures, infrastructure (Redis, DB, Cloud Tasks, Cloud Run, GCS), client disconnects, and what the user sees. Fallback *matrix* (Stage 7), finish-code *map* (Stage 13), checkpoint *design* (Stage 4) stay; this stage sets the behaviour and numbers around them.

## 1. Real-product evidence (official help docs)
| | Claude.ai | ChatGPT | Gemini app | Perplexity |
|---|---|---|---|---|
| A1 Capacity error | ✅ "Due to unexpected capacity constraints… try again soon" | ✅ "There was an error generating a response" + Regenerate | not documented | not documented |
| A2 Answer stops midway | not documented | Stop → Regenerate advice | not documented | not documented |
| A3 Usage limit | ✅ "5-hour limit reached – resets [time]"; credits option | ✅ "may continue with another available model" | ✅ "continue with Flash-Lite"; refresh time shown | not documented |
| A4 File failure | ✅ "Uploaded file is too large"; limits explained | ✅ "upload limit reached"; failed attempts count to rate cap | ✅ "Delete data to upload file"; re-upload advice | not documented |
| A5 Tool failure notice | not documented (all four) | | | |
| A6 Research interrupted | not documented | interrupt to refine; no failure contract | ✅ completion notification | not documented |
| A7 Offline / mobile | not documented | ✅ "A network error occurred" | not documented | not documented |
| A8 Status page | ✅ status.claude.com (webhooks) | ✅ status.openai.com | ✅ Workspace status dashboard | ✅ status.perplexity.ai |
**Pattern:** products show a short plain message + Regenerate, a reset time on limits, and continue-with-cheaper-model on limits (ChatGPT, Gemini). Nobody documents partial-answer retention, tool-failure notices or offline queues. All four have a public status page. → ArcNave: plain message + Retry/Regenerate + reset time + labelled model switch (already RT-5/RT-6), keep partial text (D4), and a public status page.

## 2. Key facts (official)
| ID | Fact | Status |
|---|---|---|
| F1 | **Anthropic errors:** 400 invalid_request · 401 · 402 billing · 403 · 404 · 409 conflict · 413 request_too_large · 429 rate_limit (throttle vs spend cap) · 500 api_error · 504 timeout_error ("consider streaming") · 529 overloaded | ✅ |
| F2 | Stream `error` event after HTTP 200 (e.g. overloaded); `ping` any time; `message_delta.usage` cumulative; recovery (4.6+) = new user message with the partial text + "continue"; partial tool_use/thinking **cannot be recovered**; new event types may be added → tolerate unknown events | ✅ |
| F3 | **Anthropic Python SDK:** default 2 retries (connection, 408, 409, 429, ≥500), backoff `min(0.5·2ⁿ, 8)s` × jitter 0.75–1.0, honours retry-after(-ms); timeouts connect 5 s / read-write-pool 600 s; `max_retries=0` to disable; `_request_id` on responses | ✅ |
| F4 | Vertex: capacity/quota = **429** "Resource exhausted, please try again later"; Anthropic 529 = its own API; Claude-on-Vertex 429/529 mapping + Retry-After **not documented**; GLOBAL = dynamic capacity routing, no failover SLA | ⚠️ |
| F5 | **Fallback credit** (beta on Google Cloud, header `fallback-credit-2026-07-01`): reprices cache *creation* as cache *read* on the fallback call; 5-min token window; only permitted Claude→Claude targets; redemption can be "temporarily unavailable" → retry same token | ⚠️ |
| F6 | `pause_turn` → append response + call again (server loop default 10 iterations); `max_tokens` → truncated, add incompleteness notice; `model_context_window_exceeded` → valid but truncated | ✅ |
| F7 | **Vertex errors:** 400 INVALID_ARGUMENT/FAILED_PRECONDITION · 401 · 403 · 404 · 429 RESOURCE_EXHAUSTED · 499 CANCELLED · 500 INTERNAL ("retry after a few seconds") · 503 UNAVAILABLE · 504 DEADLINE_EXCEEDED; Google rec **≤2 retries, ≥1 s initial**; Retry-After not guaranteed | ✅ |
| F8 | **google-genai SDK:** guide says "retries up to four times"; source defaults 5 attempts, initial 1 s, base 2, max 60 s, jitter 1, codes 408/429/500/502/503/504 – **but with no retry options the SDK performs one attempt**; per-request `HttpOptions(timeout=ms)` | ⚠️ (conflict) |
| F9 | Gemini stream: `promptFeedback` (whole prompt blocked) arrives in the **first chunk**; safety-blocked candidate = empty content; no guarantee of final usage after an interrupted stream | ⚠️ |
| F10 | Standard PayGo = shared capacity, 429 = contention; mitigations backoff + smoothing + GLOBAL + PT; **Priority PayGo: no ramp-up, 50M TPM Flash/Flash-Lite org-level**, premium price | ✅ |
| F11 | **Document AI** (single region): online **6 req/min/project/processor type** default, 5 concurrent batch; online timeout **2 min**; batch LRO creation 2 min – **polling timeout ≠ job failure**; status per document; errors UNSUPPORTED_MIME_TYPE, DOCUMENT_SIZE_LIMIT_EXCEEDED, PAGE_LIMIT_EXCEEDED, NO_PAGES, RESOURCE_EXHAUSTED; **safety-filter failure is non-retryable** | ✅ |
| F12 | Embedding 2 batch: GLOBAL/US/EU, ≤1M rows/1 GB, no concurrency quota; `partialFailures` ≤20 entries → not a full ledger; use a unique `key` per row | ⚠️ |
| F13 | **Google Cloud Service Health API** (`projects/{p}/locations/global/events`) + Personalized Service Health → input for an incident banner | ✅ |
| F14 | **Cloud Run:** request timeout default 300 s / max 3600 s → **504 but the code keeps running**; SIGTERM → 10 s → SIGKILL; **OOM → instance killed, active requests 500**; failed liveness probe → **SIGKILL + 503** (no SIGTERM cleanup); startup probe default 240 s | ✅ |
| F15 | **Cloud Tasks:** `maxAttempts` includes first try; `maxRetryDuration`; min/maxBackoff; `maxDoublings`; stop needs **both** limits satisfied when both set; exhausted → task deleted (retention 31 d); dispatch deadline 10 min default (15 s–30 min), worker keeps running after deadline; 2xx = done; 429/503 from worker → stronger throttle; **idle queue 30 d → NOT_FOUND for a few minutes**; `RunTask` can dispatch an already-running task | ✅ |
| F16 | Scheduler retryCount 0–5 (default 0), backoff 5 s–1 h; Cloud Run jobs task timeout 10 min default / 168 h max, retries default 3 (0–10); Eventarc Standard at-least-once backoff 10–600 s | ✅ |
| F17 | **Memorystore Redis Standard:** failover drops connections (~30 s repair / 15 s maintenance), **acknowledged writes can be lost**; redis-py `Retry` + backoff, `health_check_interval` pings idle connections before use | ✅ |
| F18 | **Cloud SQL HA** failover ≈ **60 s**, same connection string; SQLAlchemy `pool_pre_ping` + `pool_recycle`, interrupted transaction → **retry the whole transaction**; asyncpg connect timeout 60 s, command timeout None; PG statement/lock/idle-in-transaction timeouts **default 0 = off**; connection exhaustion = SQLSTATE 53300 | ✅ |
| F19 | **GCS:** retry initial 1 s ×2 max 60 s, deadline 120 s, codes 408/429/5xx; resumable upload resume via session + **308 Resume Incomplete**/Range; session 1 week; 410/404 = restart; V4 signed URL ≤ 7 d | ✅ |
| F20 | Tenacity: stop_after_attempt / stop_after_delay combinable, bare `@retry` = forever; `asyncio.timeout()` cancels the task (TimeoutError caught outside); cancelling the coroutine **does not prove the provider stopped/billing stopped** | ✅ |
| F21 | **Client:** EventSource auto-reconnects (Last-Event-ID, `retry` ms); fetch streaming needs app-owned reconnect; `AbortController` → AbortError; expo/fetch streams on Android; RN AppState for background; no guarantee the stream survives backgrounding | ✅ |
| F22 | ALB serverless NEG timeout **60 min fixed**; client keepalive 610 s (5–1200); SSE comment ~every 15 s recommended | ✅ |
| F23 | Resume cursors: OpenAI `starting_after=N`; Perplexity `GET …?stream=true&starting_after=N`, 400 → fetch final snapshot; no gap/exactly-once guarantees | ✅ |
| F24 | Tool errors: Claude `tool_result` `is_error:true` + instructive text, model retries invalid params 2–3×; Gemini `FunctionResponse.response.error`; Claude web_search errors inside 200: too_many_requests, invalid_input, max_uses_exceeded, query_too_long, request_too_large, **unavailable**; **missing grounding metadata = "not grounded", not a failure** | ✅ |
| F25 | Agent Engine code exec: 300 s timeout, stderr, 100 MB; Cloud Run OOM → 500 (our sandbox runner follows E2) | ✅ |
| F26 | Graceful degradation (Google): throttle independently, reject early, partial errors, overload tests; circuit breaker + simpler-model/cached fallback for AI; **pybreaker / aiobreaker BSD-3** | ✅ |
| F27 | Idempotency: Cloud Tasks task names dedupe **creation** (ALREADY_EXISTS, ~24 h) but execution stays at-least-once; outbox pattern; Pub/Sub DLQ 5–100 attempts (Cloud Tasks has none) | ✅ |
| F28 | **Billing on failure:** Claude mid-stream refusal bills streamed tokens; pre-output refusals billed only for bio / frontier_llm / reasoning_extraction; Gemini 400/500 **not charged**; interrupted streams, failed OCR, failed Check Grounding billing **not documented** | ⚠️ |
| F29 | **Spend caps:** Google spend-cap budgets Preview, gross cost, delayed, in-flight requests complete, **manual lift**; Anthropic Console caps → 429 `enforced_spend_limit_reached` no retry-after / 400 for org limits (Console only, not Vertex) | ✅ |
| F30 | Retry storms: Anthropic acceleration-limit 429s (token bucket, grow gradually); Google "avoid second-level spikes"; SRE **≤3 attempts + per-client retry budget <10 %** | ✅ |
| F31 | Claude retirement ≥60 d notice (Google sets own dates); beta header invalid → 400 "Unexpected value(s)…"; `anthropic_version: vertex-2023-10-16` required; cache miss is silent, 400 only on invalid cache config; thinking 400s: **tampered signature ≠ prefix mismatch**; `drop_block` fixes only prefix mismatch (beta `thinking-binding-controls-2026-08-01`); between_tools is Sonnet-only → strip on fallback | ✅ |
| F32 | RFC 9457 problem+json: type (machine id), title, status, detail (never parsed by clients), instance, extensions | ✅ |
| F33 | GOV.UK error guidance: say what happened + how to fix, plain words, no codes/jargon/"oops", keep entered input | ✅ |
| F34 | Status pages: Statuspage Free/Hobby $29; Instatus free starter; Better Stack free 1 page (+$15); none promise India hosting | ⚠️ |

## 3. Gaps (EH = error handling)
| # | Gap | Label | MVP / Later |
|---|---|---|---|
| EH1 | **SDK retries OFF, ArcNave retries ON**: `max_retries=0` (Anthropic) and no retry options / explicit `retry_options` disabled (google-genai) so our matrix is the only retry; provider `Retry-After` honoured up to a cap (N) | ✅ F3/F8 | MVP |
| EH2 | **Retry matrix (before first token only)**: transient = 429 (not spend cap), 500/502/503/504, 529, connection/408/409 → **≤2 retries**, backoff 1 s → 2 s (+ full jitter), cap 8 s; Retry-After > cap → skip to fallback; **never retry** 400/401/403/404/413, spend-cap 429, refusal, safety block, cancelled 499 | ✅ Vertex ≤2, Anthropic SDK schedule, SRE ≤3 | MVP (N) |
| EH3 | **After first token** (partial text shown): no silent retry (G39). Provider stream error → **one stream-recovery attempt** = new user message with the partial text + "continue from where you stopped" (Claude documented; Gemini same pattern, LV-1) → appended as continuation; recovery fails → keep partial, finish code `interrupted`, "answer was cut short" + Continue (S13 VD-3). Partial tool_use/thinking → restart that step from the last checkpoint, not the text | ✅ F2 | MVP |
| EH4 | **Timeout hierarchy numbers (N)**: first-token Fast 20 s / Normal 45 s / Deep 90 s (thinking always on) · stall (no token) 30 s · tools: file_search 2 s, memory 2 s, web_search 20 s, fetch_url 10 s (TD-3), run_code 60/120 s (TD-5c), load_skill 1 s · turn deadline 10 min (O-2) · Executor request timeout 15 min (AS-D3) · API SSE ≥ 20 min (SD-5). First-token/stall timeout → treat as transient (EH2) | 🔧 (vendors publish none) | MVP (N) |
| EH5 | **Cloud Run 504 ≠ stop**: Executor must own its deadline (asyncio.timeout) and cooperative cancel; never rely on the platform timeout; after SIGTERM: flush checkpoint, abort model stream, mark turn `interrupted` → Cloud Tasks retry resumes from checkpoint (AS-D3) | ✅ F14 | MVP |
| EH6 | **OOM / liveness SIGKILL path**: no cleanup runs → checkpoint after **every** step (R14) + fencing token; liveness probe conservative (N) so a slow model stream never looks dead (probe = process alive, not request progress) | ✅ F14 | MVP |
| EH7 | **Redis failover rules**: acknowledged write may vanish → stream relay is best-effort; client detects seq gap → snapshot refetch from DB (R5); lock = lease + heartbeat + **DB fencing decides commits** (R13); Redis unreachable > 5 s (N) → degraded mode: relay off, client polls `GET /turns/{id}/events` from DB every 2 s (N), rate limits local, policy from DB; redis-py `Retry` + `health_check_interval` | ✅ F17 | MVP |
| EH8 | **DB failover rules**: pool `pre_ping` + `pool_recycle` (N); transient DB error → retry the **whole transaction** ≤2 (idempotent by design); per-role timeouts (N): API statement 5 s, retrieval pool 2 s, executor 30 s, lock_timeout 2 s, idle_in_transaction 30 s; 53300 too_many_connections → 503 + Retry-After 5 s + alert; connection budget D25 | ✅ F18 | MVP (N) |
| EH9 | **Cloud Tasks queue config (N)**: turns: maxAttempts 2, maxRetryDuration 20 min, minBackoff 5 s, dispatch deadline 15 min · file-blocking: maxAttempts 3, backoff 10 s–5 min, deadline 30 min · background-low: maxAttempts 5, maxBackoff 1 h; handled outcomes return 2xx (GD-1); own `failed_jobs` table (AS9); **keep queues warm** (daily no-op task avoids 30-day NOT_FOUND); never manual `RunTask` on running tasks; worker returns 429/503 when overloaded (stronger throttle) | ✅ F15 | MVP |
| EH10 | **GCS upload failures**: resumable session resume (308/Range) by the client; 410/404 → new session (UD-3/UD-4); signed URL expired → client asks a fresh URL (short TTL); server-side GCS calls use library retry defaults (deadline 120 s) | ✅ F19 | MVP |
| EH11 | **Tool failure contract**: tool error → `tool_result is_error:true` with instructive text ("Web search unavailable right now – answer from what you know and say so"); **read-only tools get one automatic retry** on transient errors, write tools none (TO-4); model's own corrective retries capped by TS-12 per-turn caps; Claude web_search `unavailable` → same path; missing Gemini grounding metadata = answer not grounded → coverage flag, **not** an error; sandbox timeout/OOM → envelope `TOOL_FAILED` + partial stdout (TD-6); tool status label shows the failure (TD-10) | ✅ F24/F25 | MVP |
| EH12 | **File-processing error taxonomy** (user text + action): `unsupported_type` (save as…) · `too_large` / `too_many_pages` (limits) · `encrypted` (remove password) · `corrupt` · `malware` (removed, admin notified) · `ocr_failed` · `timeout` · `quota` (try later) – all with Retry + Remove (AS-D6); Document AI: polling timeout → check LRO before resubmitting (never duplicate), safety-filter error = non-retryable → `ocr_blocked`; quota 6 req/min default → increase before launch (LV-1) + batch route for big files | ✅ F11 | MVP |
| EH13 | **Embedding failures**: per-row `key`; failed rows re-queued individually (≤3) while FTS keeps working (E7); never re-embed successful rows | ✅ F12 | MVP |
| EH14 | **Client reconnect**: shared SSE client: on drop → reconnect with last seq, backoff 1/2/4/8/16 s + jitter, 5 attempts (N) → "Reconnecting…" banner → then manual Retry; after reconnect, if seq gap → snapshot refetch; `AppState` foreground → refetch turn state; AbortController on Stop; send retry reuses the same Idempotency-Key; offline send queue stays Later (FD-3) | ✅ F21/F23 | MVP |
| EH15 | **Error contract (API)**: RFC 9457 `application/problem+json` + extensions `code` (our enum), `request_id` (support code shown to user), `retryable`, `retry_after_s`; one format incl. LB/Cloud Armor errors (L2-G2); SSE `error` event carries the same body | ✅ F32 | MVP |
| EH16 | **User-facing messages**: plain English, what happened + what to do, no jargon/codes in the sentence (support code shown small), keep the typed message, Retry/Regenerate button; limit messages show reset time; model switch labelled (RT-5) – GOV.UK + product patterns | ✅ F33, A1–A4 | MVP |
| EH17 | **Incident banner + status page**: ops poll Service Health API (project events) → suggested banner; banner itself is a feature flag set by ops (manual, never automatic text); public status page = free tier (Better Stack / Statuspage) in MVP, provider pick Stage 19; in-app banner on Vertex/Cloud SQL incidents | ✅ F13/F34 | MVP |
| EH18 | **Fallback compatibility**: on model switch strip model-specific settings (between_tools, effort mapping, tool_choice, betas) via capability matrix (G30); retiring models removed from fallback lists (registry dates, alert 60 d before) | ✅ F31 | MVP |
| EH19 | **Circuit breaker + kill switch**: per model and per tool: open after 5 failures in 30 s or ≥50 % errors over 20 calls (N), half-open after 30 s; open → fallback matrix immediately (no retries); ops kill switch overrides; lib pybreaker (BSD) or own 50-line impl | ✅ F26 | MVP (N) |
| EH20 | **Retry budget**: per Executor instance ≤10 % of calls may be retries (SRE); exceeded → stop retrying, fallback/503; smooth bursts via provider rate limiter (G43) | ✅ F30 | MVP |
| EH21 | **Cost on failure**: bill partial streams from last cumulative usage (GG9); Gemini 400/500 not charged; refusal categories billed → track; fallback credit **Later** (beta; only Claude→Claude; redemption retry rule) | ✅ F28/F5 | MVP rule · credit Later |
| EH22 | **Spend caps**: our app cap (R2/PL-6) acts first; Google spend cap = backstop (delayed, manual lift) → runbook; Anthropic Console caps not applicable on Vertex | ✅ F29 | MVP |
| EH23 | **Unknown events / schema drift**: tolerate unknown SSE event types and new finish reasons (map to `other` + alert) | ✅ F2 | MVP |
| EH24 | **Thinking 400s**: detect "Invalid signature" (tampered → strip + regenerate step) vs "bound to a different conversation" (prefix mismatch → drop_block beta if LV-1 passes, else strip per R1) | ✅ F31 | MVP |
| EH25 | **Research / long jobs**: Cloud Run job retries default 3 → set 1 from checkpoint; partial report saved on failure; in-app notice "research stopped – partial report available" (AO-5/RS-5) | ✅ F16 | MVP |
| EH26 | **Chaos tests** before build: Redis failover mid-stream, Cloud SQL failover, Executor SIGTERM/SIGKILL mid-turn, duplicate Cloud Tasks dispatch, provider 429 storm, Doc AI quota exhaustion | 🔧 | LV-1 |

## 4. Claude-only (CEH)
| # | Fact | Rule |
|---|---|---|
| CEH1 | SDK retries 2× by default, backoff 0.5·2ⁿ ≤ 8 s | `max_retries=0`; our matrix only |
| CEH2 | Stream error after 200; recovery = partial + "continue" (4.6+); tool_use/thinking not recoverable | EH3 |
| CEH3 | 529 is Anthropic API; Vertex capacity = 429; mapping undocumented | Treat 429/503/529 all as transient (EH2) |
| CEH4 | Refusal billing by category; mid-stream refusal bills streamed tokens | Ledger records refusal category (A6) |
| CEH5 | Fallback credit beta: Claude→Claude only, 5-min token, cache-write repriced, redemption retry | Later; never drop a token mid-retry |
| CEH6 | `pause_turn` default 10 server iterations | Continue loop ≤ profile steps |
| CEH7 | Beta header 400; `anthropic_version` body field; between_tools Sonnet-only | Capability matrix + per-provider beta allow-list (A15) |
| CEH8 | Thinking 400: signature vs prefix mismatch | EH24 |
| CEH9 | Retirement ≥60 d (Anthropic); Google own dates | Registry + alert; exclude from fallback |

## 5. Decisions (recommendations – need OK)
| ID | Question | Options | Recommendation |
|---|---|---|---|
| **ER-1** | Who retries | SDK defaults · **ArcNave only** | ArcNave only (SDK retries off) – EH1 |
| **ER-2** | Retry matrix | – | ≤2 retries before first token, 1 s→2 s + jitter, cap 8 s, Retry-After cap 10 s (N); never-retry list – EH2 |
| **ER-3** | Mid-stream failure | silent retry · **one recovery attempt + Continue** | One "continue" recovery, else keep partial + Continue button – EH3 |
| **ER-4** | Timeout numbers | – | Provisional values EH4 → numbers register; Stage 18 confirms |
| **ER-5** | Redis degraded mode | block chat · **DB polling fallback** | DB polling every 2 s + local limits – EH7 |
| **ER-6** | DB timeouts/pool | – | Per-role statement timeouts, whole-transaction retry ≤2, 53300 → 503 – EH8 |
| **ER-7** | Cloud Tasks config | defaults · **explicit per queue** | Explicit per queue (EH9), 2xx for handled outcomes, warm queues |
| **ER-8** | Tool failure | fail turn · **continue without tool** | Instructive is_error + one auto retry for read tools; answer continues with notice – EH11 |
| **ER-9** | File error taxonomy | – | 9 codes with user text + Retry/Remove; Doc AI LRO check before resubmit – EH12 |
| **ER-10** | Client reconnect | – | 5 attempts backoff → banner → manual; snapshot on gap – EH14 |
| **ER-11** | API error format | custom · **RFC 9457 + extensions** | RFC 9457 with code/request_id/retryable – EH15 |
| **ER-12** | Status page + incident banner | none · **free status page + manual ops banner fed by Service Health API** | Yes – EH17; provider pick Stage 19 |
| **ER-13** | Circuit breaker | none · **per model/tool, simple thresholds** | Yes, thresholds (N) – EH19 |
| **ER-14** | Fallback credit (beta) | now · **Later** | Later (Claude→Claude only; LV-1) |
| **ER-15** | Chaos tests | – | Add EH26 to LV-1 |

## 6. LV-1 additions
1. Gemini stream-recovery "continue" pattern quality (not documented) and Claude 4.6+ pattern on Vertex.
2. Verify `max_retries=0` / google-genai no-retry path actually yields one attempt (SDK version pinned).
3. Chaos set EH26 (Redis failover, SQL failover, SIGTERM/SIGKILL mid-turn, duplicate dispatch, 429 storm, Doc AI quota).
4. Document AI quota increase for Mumbai + batch path timing.
5. GLOBAL endpoint behaviour during a regional incident (observe, no SLA).
6. Thinking `drop_block` beta on Vertex (prefix mismatch repair).
7. Client reconnect on Android network switch (Wi-Fi ↔ 4G) with seq resume.

## 7. Doc-sync debt
- L4-G38/G39: numbers → EH4/EH2 (provisional); G43 + EH20 retry budget; component 8 deadline = asyncio.timeout + cooperative cancel (EH5).
- L6: queue configs EH9; AS9 failed_jobs; warm-queue task; AS-D3 unchanged.
- L7: DB timeouts per role (EH8), pool settings.
- L3: RFC 9457 error body (replaces `{type:"error",…}` shape) + `retryable`/`retry_after_s`; SSE error event same body.
- L1: reconnect banner, Retry/Regenerate, reset-time display, support code, incident banner.
- Stage 9: file error taxonomy EH12.
- Stage 5 F3: client reconnect numbers; F2 GG9 billing rule kept.
- 00-numbers-register: N-42 (retries/backoff/caps), N-43 (timeouts), N-44 (Cloud Tasks queues), N-45 (DB timeouts/pool), N-46 (reconnect), N-47 (breaker thresholds), N-48 (Redis degraded thresholds).
- Lawyer/ops: none new. LV-1: 7 items.

## 8. Sources
15-astra-results.md (URLs + quotes): support.claude.com 12466728, 8241126, 11088861, 12111783 · help.openai.com 7996703, 20001354, 8555545, 10500283 · support.google.com/gemini 16275805, 14903178, 15719111 · status.claude.com, status.openai.com, google.com/appsstatus, status.perplexity.ai · platform.claude.com api/errors, streaming, sdks/python, handling-stop-reasons, fine-grained-tool-streaming, fallback-credit, refusals-and-fallback, rate-limits, model-deprecations, beta-headers, claude-on-vertex-ai, prompt-caching, preserved-thinking, thinking, web-search-tool, handle-tool-calls · github anthropics/anthropic-sdk-python (_constants, _base_client), googleapis/python-genai (_api_client) · docs.cloud.google.com vertex-ai api-errors, retry-strategy, error-code-429, locations, standard-paygo, consumption-options, priority-paygo, GenerateContentResponse, deprecations/partner-models, document-ai quotas/error-messages/limits/rpc, embeddings batch-prediction, batchPredictionJobs, service-health (incident-communication, REST, how-to-integrate), run request-timeout/container-contract/healthchecks/quotas/create-jobs, tasks RetryConfig/rpc/common-pitfalls/comp-pub-sub, scheduler retry-jobs, eventarc retry-events (standard/advanced), memorystore HA, sql HA, storage retry-strategy/resumable-uploads/signed-urls, architecture graceful-degradation + AI reliability, spanner queues-at-most-once, pubsub dead-letter-topics, billing spend-caps, vertex pricing, agent-platform code-execution troubleshooting, grounding-with-google-search · developers.openai.com error-codes, rate-limits, background, agents-api sessions · openai.github.io exceptions, running_agents, run_state · docs.perplexity.ai model-fallback, sdk error-handling, background-mode · redis.io redis-py produsage · docs.sqlalchemy.org pooling · magicstack asyncpg api · postgresql.org runtime-config-client, errcodes · tenacity · docs.python.org asyncio-task · html.spec.whatwg.org SSE · MDN Using_Fetch · docs.expo.dev sdk/expo · reactnative.dev appstate · load-balancing serverless-neg-concepts, request-distribution · github danielfm/pybreaker, arlyon/aiobreaker · anthropic.com/engineering multi-agent-research-system (📄) · sre.google handling-overload · design-system.service.gov.uk error-message · rfc-editor RFC 9457 · atlassian statuspage pricing, instatus pricing, betterstack pricing.
