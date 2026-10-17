# ADR-0081: The provider gateway — error matrix, breaker, and a labelled fallback chain

- Status: accepted (task tech-p05 wave 2 = NEW-PLAN P11; owner decision OQ-02 A). Tested offline;
  not merged, not deployed.
- Date: 2026-10-17
- Task: P11 ([`docs/ops/p05-wave-plan.md`](../ops/p05-wave-plan.md) §2). Evidence:
  [`docs/ops/p11-result.md`](../ops/p11-result.md). Live checklist:
  [`docs/ops/p11-live-checklist.md`](../ops/p11-live-checklist.md). Migration `0033_fallback_and_refusal`.
- Supersedes in part: [ADR-0076](0076-auto-routes-to-gemini-by-rules.md) — "when Gemini cannot take
  the turn, Auto answers nothing (`no_model_available`)" and the silent "picked model unavailable →
  Auto" path (K-15). A note line was added to ADR-0076. ADR-0024 / ADR-0054 (no first-token cutoff)
  and ADR-0072 (the ER-2b retry gate) stand; their code moved into the gateway unchanged in behaviour.
- Models used: Opus 5.5 (one agent).

## Stage decisions applied

Stage 15 ER-1, ER-2 (matrix, N-42), ER-2f/g/h (classifiers), ER-3c/d (finish mapping), ER-4c (tool
timers, N-43), ER-4f (no retry / hop past the deadline), ER-12a/b, ER-13 (breaker, kill switch,
retry budget, N-47), ER-14a/b, AL-1/2/4/5 and the doc-syncs of 2026-10-10 … 2026-10-12 (Claude
classifier as built, blocked list, no-finish rule, breaker admissions); Stage 7 RT-6 / 7.12 (the
chain and its label), BREAKER; Stage 4 E18 (token bucket, off), E22; Stage 16 SD-9a/b; D3 A-07.

## Claude

- **Errors.** Claude's error types and statuses: `invalid_request_error` 400, `authentication_error`
  401, `billing_error` 402, `permission_error` 403, `not_found_error` 404, `request_too_large` 413,
  `rate_limit_error` 429, `api_error` 500, `overloaded_error` 529; 429 / ≥ 500 retryable
  (platform.claude.com/docs/en/api/errors, via the `claude-api` skill `shared/error-codes.md`, read
  2026-10-17). A stream can fail after HTTP 200 with an `error` event; the installed SDK
  (0.126.0, `core/streaming.js`) raises it as an `APIError` with no status and `type` = the error
  type. ArcNave classifies that type as its status (`anthropic.ts` `ERROR_TYPE_STATUS`); an unknown
  type is transient (Stage 21 doc-sync 2026-10-12).
- **Refusal.** `stop_reason: "refusal"` with `stop_details.category` (open set: `cyber`, `bio`,
  `frontier_llm`, `reasoning_extraction`, `general_harms`, null). ArcNave ends the turn
  `model_refused`, finish `blocked`, and stores the category on the usage row (AL-2). It does not
  use the API's server-side `fallbacks` (the skill recommends them for Opus 5.5 / Sonnet 5.5):
  Stage 16 SD-9 / 7.12 say a refusal never falls back until the M9 input screen exists (SD-9b), and
  Invariant 1 forbids a model switch the user does not see. **ArcNave deliberately differs.**
- **Thinking 400.** "Invalid `signature` in `thinking` block. The block is bound to a different
  conversation…" — recovery 1 is to strip every `thinking` and `redacted_thinking` block and retry
  once, "a one-time recovery, not a steady-state pattern" (`shared/model-migration.md`, preserved
  thinking, read 2026-10-17). ArcNave does exactly that, once per turn, for the round that failed
  (AL-5); recovery 2 (`drop_block` beta) is not used (LV-1 item 6 not run).
- **Retries.** The SDK's own retries (default 2) stay off (`maxRetries: 0`); the gateway is the only
  retry (ER-1).

## Decision

1. **One gateway** (`providers/gateway.ts`, one per instance in the container): `call` runs one
   model — breaker admission, optional token bucket, the Stage 15 retries (≤ 2, full jitter on
   1 s → 2 s, Retry-After honoured ≤ 10 s, only before the attempt's first visible or
   side-effecting step), the retry budget, the one history cut for a context overflow, and each
   attempt's usage as a P22 `CallUsage` row (`AttemptCall`, kept on the turn state for the
   orchestrator to wire to `ledger.recordCalls`). `stream` walks the fallback chain over `call`.
   `streamWithRetry` is gone; the forced answer goes through `call` too.
2. **Closed failure kinds** (`types.ts` `FailureKind`, table in `providers/failures.ts`):
   transient · timeout · quota · config · credentials · claude_limit · request_rejected · blocked ·
   context_overflow · cancelled, each with retry / fallback / breaker / skip-provider flags.
   `ProviderError` gains `kind`, `partialUsage`, `refusalCategory`. Claude: 401 → credentials (every
   Claude row skipped, counted by the breaker), 403 / 404 → config, spend cap / usage limits / 402 →
   claude_limit (not counted), 413 → `provider_payload_limit`. Gemini: 401 → credentials, 403 / 404
   → config, quota-0 → quota (one coded ERROR line).
3. **Finish mapping** (`providers/finish.ts`): Gemini SAFETY, PROHIBITED_CONTENT, SPII, BLOCKLIST,
   RECITATION, MODEL_ARMOR (+ the IMAGE_* variants, ours) and any prompt `blockReason` → new code
   `response_blocked`, finish `blocked`; no retry, no fallback, no forced answer. A stream that ends
   without a finish reason is transient (retried, then the chain) before text, `interrupted` after
   it. An unknown reason → `other` + WARN `finish_reason_unknown`. Known reasons keep the provider's
   spelling (stored rows already carry `STOP`, `end_turn`). `MAX_TOKENS` with no text →
   `empty_response`, no forced answer.
4. **A failure after text** keeps the partial answer: the message is stored `complete`, finish
   `interrupted`, `errorCode` the cause, `done.partial: true` (the ADR-0072 pattern); the client
   shows "cut short by an error" + Continue. The history loader adds a cut marker after the text of
   a stopped, interrupted or partial answer (ours; settles DEFERRED P07/P11 "a stopped answer goes
   back unmarked", `stopThenGreeting.integration.test.ts` flipped deliberately).
5. **Breaker** (`providers/breaker.ts`, per alias per instance, N-47): open after 5 counted failures
   in 30 s or ≥ 50 % of the last 20; half-open after 30 s with exactly one trial; every admission
   given back once; a late admission cannot change an open or half-open breaker; helper calls take
   no admission. **Kill switch** `MODELS_DISABLED` (aliases or ids) overrides it and makes the
   registry report `disabled`. **Retry budget** (`retryBudget.ts`): ≤ 10 % of the instance's calls
   in N-47's 30 s window may be retries, with a floor of `RETRY_BUDGET_MIN_RESERVE` (2, ours, owner
   item). **Token bucket** (`rateLimiter.ts`, E18) ships off.
6. **Labelled fallback** (`providers/fallback.ts`, 7.12): Gemini → Sonnet; Sonnet → Gemini; Opus →
   Sonnet → Gemini. A hop happens only when the failed model showed nothing and ran no tool, its
   kind allows one, `FALLBACK_ENABLED`, the deadline has not passed, and the next model is admitted,
   is not a helper row, is not of a provider ruled out (claude_limit / credentials), and can do what
   the turn needs (vision, grounding, code execution). The turn is **rebuilt** for the next model
   (`buildTurnContext(…, { quiet: true })`: its history window, tools, effort, request; the
   reservation is lowered to its ceiling through P08's `usage.adjust`). The client gets
   `model_switch {from, to, reason}` and `done.fallback {from, reason}`; the message stores
   `fallback_from` / `fallback_reason` (migration 0033), so a reload shows "Answered by X because Y
   was unavailable". Reasons: unavailable · timeout · quota · config · credentials · claude_limit ·
   breaker_open · disabled.
7. **K-15:** a picked model that is disabled or known unavailable starts on the next model of its
   own chain, labelled; Auto with Gemini unavailable goes to Sonnet, labelled
   (`routing.rule = auto_fallback`), instead of `no_model_available`.
8. **ER-4f:** past the deadline (`GenerateInput.deadlineAt`) no attempt, retry wait or hop starts;
   the turn ends `turn_deadline_exceeded`. A Stop during the forced answer is saved `stopped`, the
   deadline during it `turn_deadline_exceeded` (DEFERRED P11).
9. **Tool timers** (ER-4c, N-43, `DispatchingToolExecutor`): web_search 20 s, search_project_files
   2 s, memory_* 2 s → an `is_error` result the model reads; fetch_url keeps safeFetch's 10 s;
   run_code is P18's.
10. **SD-9a:** Gemini requests set `safetySettings` explicitly, BLOCK_MEDIUM_AND_ABOVE for
    harassment, hate speech, sexually explicit, dangerous content.
11. **AL-1 / AL-2:** a failed attempt's provider-reported usage (from the last cumulative counts)
    is added to the turn; a failure before any stream opened adds nothing (not billed); a stream that
    opened and reported nothing makes the turn `exact: false`. Usage from a model the turn then left
    is priced differently, so a turn that mixes models is `exact: false` with zeros (Invariant 3;
    the per-attempt rows stay exact for P22's ledger). `usage_records.refusal_category`.
12. **ER-12:** the failure card shows the request id (or the message id after a reload) small as
    the support code; `GET /v1/status` serves `INCIDENT_BANNER` (ops text only, no sign-in), shown
    as a banner above the chat.

New error code: `response_blocked` (422). New config: `MODELS_DISABLED`, `INCIDENT_BANNER`,
`FALLBACK_ENABLED`, `PROVIDER_RATE_LIMIT_PER_MINUTE`, `RETRY_BUDGET_MIN_RESERVE`, N-47 `BREAKER_*` /
`RETRY_BUDGET_RATIO`, N-43 `TOOL_TIMEOUT_*` (`config/numbers.ts` `// --- P11`).

## Where the stage text and the brief differed (the stage wins)

- Stage ER-3 / doc-sync 2026-10-12 designs one "continue" recovery attempt after text (Task 1.11,
  Turn Executor). The brief's M-17 says 0 attempts. The recovery belongs to the Turn Executor
  (checkpoints) and is not in P11's Covers list (ER-3c/d only); M-17 is built as 0 and the
  continuation is listed as not done.
- Gemini 413: the brief's M-22 says `provider_error`; built so (Claude 413 is
  `provider_payload_limit`, M-11).
- The Stage 7 7.12 Gemini → Sonnet hop needs "company Claude ON + limit left": single user, no
  company switch (Phase 5); the budget check is P08's reservation, which a hop lowers to the new
  model's ceiling.

## Ours (no Claude or stage equivalent)

The cut marker text; the IMAGE_* blocked reasons; `RETRY_BUDGET_MIN_RESERVE` 2; the retry budget
window = N-47's breaker window; the mixed-model `exact: false` rule; the `NotAdmitted` error.

## Not done (owner items or other packages)

ER-4a/b first-token and stall timers (OQ-16; `onAttempt` is the hook); ER-4d deadline value
(OQ-15; 59 min stays); ER-11 RFC 9457 body (OQ-17); E18 capacity (no register value); the ER-3
continuation (Turn Executor); run_code timer (P18); audio's own retry (DEFERRED, still immediate);
wiring `state.attempts` to P22's ledger (orchestrator at merge).

## Consequences

- An outage of one model costs up to three attempts on it and then the next model's own attempts,
  bounded by the retry budget and the breaker; the user sees which model answered and why.
- Tests share one app per file, so the harness raises the breaker thresholds and the retry reserve
  (as it raises rate limits); `breaker.test.ts` and `errorMatrix.test.ts` test the real values.
- Characterization and golden snapshots changed (safety settings in every Gemini request, refusals
  `blocked`, the hop in scenario 9, scenario 8d `stopped`); each is listed in the result file.
