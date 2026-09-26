# ADR-0024: Provider timeouts follow Claude's SDK: no first-token cutoff, retry only failures

- Status: accepted.
- Date: 2026-09-26
- Replaces: the first-token budget in `streamWithRetry` (`PROVIDER_TTFT_BUDGET_MS`, 12 s; 3× for
  media; see mistakes.md, 2026-09-24).

## Context

On the live site, the 3rd to 5th reply in a chat that held two bank-statement PDFs failed with
"The model took too long". Every attempt logged `First token wait exceeded 12000ms`.

- The follow-up had no new file, and its history PDFs travel as rendered `pages`. The media
  check only read `base64`, so the follow-up got 12 s instead of 36 s.
- Each turn's request is bigger than the last one: page images, plus every earlier tool result
  since ADR-0023.
- Gemini sends nothing until it has finished thinking. The cutoff aborted a request that was
  still working, and each retry sent the same slow request again.

A first draft of this ADR kept the cutoff and scaled it by context size (1 s per 10,000
tokens). That number was a guess, so it was dropped before merge.

Claude, from its docs (read 2026-09-26):

- **TypeScript SDK, Timeouts.** "By default requests time out after 10 minutes." "On timeout,
  an `APIConnectionTimeoutError` is thrown." "Requests that time out are retried twice by
  default."
- **TypeScript SDK, Retries.** "Connection errors ..., 408 Request Timeout, 409 Conflict, 429
  Rate Limit, and >=500 Internal errors are all retried by default."
- **TypeScript SDK, Long requests.** "Consider using the streaming Messages API for longer
  running requests."
- **Streaming.** Streams start with `message_start` and "may also include any number of
  `ping` events". Thinking streams as `thinking_delta` events.
- None of these pages describes a time-to-first-token cutoff.

## Decision

1. **No first-token cutoff.** `PROVIDER_TTFT_BUDGET_MS` is removed, and a slow request is
   waited for.
2. **One provider request is bounded by `PROVIDER_TIMEOUT_MS`, now 600,000 ms**, the Claude
   SDK's default. Before, it was 120,000 ms.
   - `@google/genai`'s `httpOptions.timeout` covers a single attempt, streamed body included.
   - The Anthropic SDK's `timeout` does the same.
3. **Retry failures, not slowness.**
   - When the SDK's own timeout aborts a request, each adapter turns it into
     `provider_timeout`, which is retryable. The caller's Stop stays an abort.
   - The Anthropic adapter also retries `APIConnectionError`, as Claude's SDK does. Our retry
     policy (`PROVIDER_MAX_RETRIES`) still does the retrying; the SDKs' own retries stay off.
   - An abort that the caller did not request is `provider_timeout`, never Stop.
4. **Measured, not guessed.** Each first event logs `ttftMs` (`provider first event`).
5. **UI.** While the model works with no tool running, the status reads "Thinking", not
   "Waiting for the model".

## Not done: streaming Gemini's thoughts

Claude streams `thinking_delta`, so a working request is visibly alive. `@google/genai` has
`thinkingConfig.includeThoughts`, and a part can be marked `thought: true` (SDK types). What is
still unverified:

- whether thought summaries arrive incrementally before the answer;
- how they are billed.

Google's docs are blocked from this environment. This is left undone until it can be checked.

## Consequences

- A request that truly hangs takes up to 10 minutes per attempt to fail, instead of 12 s. The
  turn deadline (`TURN_DEADLINE_MS`) still bounds the whole turn.
- Large follow-ups are no longer aborted while the model is still working.
