# ADR-0054: Claude through the first-party Claude API

- Status: accepted
- Date: 2026-10-14
- Task: tech-p1.C (build plan P1-C, decision B-5)
- Supersedes: the Vertex path for Claude in [ADR-0003](0003-node-stack.md) and
  `docs/backend-research.md` §2 (now marked superseded). Keeps [ADR-0024](0024-provider-timeouts-follow-claudes-sdk.md).
- Relates to: [ADR-0053](0053-prototype-base-and-target-spec.md), [ADR-0055](0055-three-models.md),
  Stage 15 checkpoint (ER-1, ER-2, ER-4), numbers register N-42 / N-43, cost log FD-35.

## Context

Claude reached ArcNave through `@anthropic-ai/vertex-sdk` on Vertex `global`, and
`providers/registry.ts` switched every Claude alias off outside tests ("Only Gemini 3.8 Flash is
active"), because the Vertex project had no Claude quota. The owner chose the first-party Claude
API instead (FD-35, build plan B-5; startup credit). The Python build's gateway design
(Stage 15) is the target for retries and timeouts.

Sources read 2026-10-14:

- Models overview, docs.claude.com/en/docs/about-claude/models: `claude-sonnet-5-5`,
  `claude-opus-5-5`, 1M context, 128K output, effort `low`…`max`, adaptive thinking (a
  `disabled` thinking config is a 400 on both).
- API overview, request size limits: Messages API 32 MB per request.
- Errors: 529 `overloaded_error` is transient; 402 `billing_error` is not; `retry-after`
  header on 429.
- Web search tool: `web_search_20260209` (dynamic filtering) on Sonnet 5.5 / Opus 5.5; Vertex
  only had `web_search_20250305`. Server tools can end a response with `pause_turn`; the
  documented resume sends the paused assistant turn back with no new user message.
- Prompt caching: minimum cacheable prefix 512 tokens on the 5.5 models; default TTL 5 min.

## Decision

1. **`backend/src/providers/anthropic.ts`** replaces `anthropicVertex.ts` (deleted with its two
   test files, ported as `anthropic.test.ts`, `anthropic.adapter-loop.test.ts`, plus the new
   `anthropic.firstParty.test.ts`). `@anthropic-ai/vertex-sdk` is removed from `package.json`.
   The client is built in one place, `createAnthropicClient`:
   `new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 0, timeout: cfg.PROVIDER_TIMEOUT_MS })`.
   The whole provider contract is kept: streaming, tools and the tool loop, adaptive thinking with
   summarized display and effort via `output_config`, `cache_control` breakpoints (system prefix
   and the turn before the newest), usage including cache read/write, the refusal event, PDF and
   image blocks, partial tool input (ADR-0037).
2. **Changes that follow the first-party API:** web search tool `web_search_20260209`;
   `pause_turn` is resumed inside the loop (one round of the turn's budget; on the last round the
   turn ends `tool_limit` and the UI offers Continue); request limit 32 MB in the capability
   table; cache minimum 512 tokens for the 5.5 models.
3. **Configuration.** `ANTHROPIC_API_KEY` (secret; `backend/.env` locally, never committed).
   Claude aliases without it report `anthropic_not_configured`. In production a boot that names
   `MODEL_SONNET` / `MODEL_OPUS` explicitly without a key fails; the defaults alone do not count,
   so a Gemini-only deployment needs no key.
4. **The registry gate is deleted.** Status comes only from configuration, probes and real
   request outcomes (ADR-0028). Gemini needs `GOOGLE_CLOUD_PROJECT`; Claude needs the key; the
   two are independent.
5. **Server-side `fallbacks` stays off.** The API can re-run a declined request on another
   model inside the same call. That is a model substitution, and Invariant 1 forbids it: a
   refusal stays the typed `model_refused` error.
6. **API key, not Workload Identity Federation, for the prototype.** Stage 16 (provider identity,
   ADR-0012 of the Python build) has Claude calls authenticate with Anthropic WIF and no key
   anywhere. The build plan (P1-C, B-7) puts a key in `backend/.env` for the prototype; WIF moves
   to Phase 5 with Secret Manager / Terraform. The key is read only by `createAnthropicClient`;
   `ANTHROPIC_API_KEY` is also on the logger's redaction list in case a config object is logged.
7. **Dev scripts** (`src/scripts/*`) that built a Vertex client now call `createAnthropicClient`.

### Retry and timeout matrix (Stage 15 vs this repo)

| Item | Stage 15 (N-id) | Repo before | Now | Why |
|---|---|---|---|---|
| SDK retries | off (ER-1) | `maxRetries: 0` | same | matches |
| Retries before first token | ≤ 2 (N-42) | `PROVIDER_MAX_RETRIES` 2 | same, value from `config/numbers.ts` | matches |
| Transient statuses | 429 (not spend cap), 500/502/503/504, 529, connection/408/409 | 408/409/429/500/502/503/504 | **+529; spend-cap 429, usage-limit 400 and 402 never retried** (`provider_limit`, new `ApiError` code) | matrix stricter |
| Never retried | 400/401/403/404/413, refusal, 499 | same | same; 401/403 → `model_unavailable` | matches |
| Backoff | 1 s → 2 s, full jitter, cap 8 s (N-42) | 300 ms → 600 ms, +50 % jitter | **full jitter on 1 s·2^(k-1), cap 8 s** (`PROVIDER_RETRY_BASE_MS`, `…_MAX_BACKOFF_MS`) | matrix stricter |
| Retry-After | honoured ≤ 10 s, else no retry (N-42) | ignored | **honoured ≤ 10 s; longer → the turn fails at once** (`PROVIDER_RETRY_AFTER_MAX_MS`); no model fallback (Invariant 1) | matrix stricter |
| First-token timeout | Fast 20 / Normal 45 / Deep 90 s (N-43) | none (ADR-0024) | **none — kept** | deliberate: ADR-0024 measured a cutoff aborting large follow-ups that were still working |
| Stall timeout | 30 s after first text (N-43) | none | **none — kept** | same family as ADR-0024; one provider stream spans tool rounds (a sandbox call can run minutes), so a stall timer needs per-round state the Phase 5 executor will have |
| Per-request total | — (N-43 has none) | 600 s (ADR-0024) | same | N-43 gives no value |
| Turn deadline | 10 min (N-43) | 59 min | **59 min — kept** | deliberate: set on 2026-09-24 for scanned-PDF extraction turns (checkpoint 2026-09-24-phase3-live-failure); the 10-min value belongs to the Cloud Tasks executor design (N-44), which is Phase 5 |

### Usage

Claude's usage reaches `usage_records` through the same provider-agnostic path as Gemini's:
every request of a tool loop is summed, input, output, cache read and cache write
(ADR-0021). `routes/claudeUsage.integration.test.ts` runs the real adapter against a fake SDK
client through two requests and checks the row.

## Consequences

- The owner sets `ANTHROPIC_API_KEY` in `backend/.env` (and `./.env` for compose; Secret Manager
  when deployed). Nothing in the repo holds a key.
- Claude requests leave Google's network (FD-30 / FD-35: Cloud NAT is needed on Cloud Run for a
  deployment; local development needs nothing).
- Gemini keeps its own adapter and classification; only `streamWithRetry`'s backoff and
  Retry-After rule (provider-agnostic) changed for it.
