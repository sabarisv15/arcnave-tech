# ADR-0024: The first-token budget counts history PDFs and scales with the request's size

- Status: accepted.
- Date: 2026-09-26
- Amends: the first-token budget in `streamWithRetry` (see mistakes.md, 2026-09-24).

## Context

On the live site, the 3rd to 5th reply in a chat that held two bank-statement PDFs failed with
"The model took too long". The logs showed `First token wait exceeded 12000ms` on every
attempt.

- A follow-up has no new attachment. Its PDFs are in the history as rendered `pages`, but the
  media check only looked for `base64`, so the follow-up got the 12 s text budget instead of
  36 s.
- As the chat grows, so does each request: page images, and now every earlier tool result
  (ADR-0023). Gemini sends nothing until its thinking ends, and that takes longer the more it
  has to read. A retry repeats the same slow request.

The Claude API has no first-token cutoff; the SDK's default request timeout is 10 minutes.
ArcNave's budget is its own hang detector, and a request's size must not trip it.

## Decision

1. Media means a file carried as bytes **or as rendered pages**, in the current turn or in the
   history.
2. The budget grows by `PROVIDER_TTFT_MS_PER_10K_CONTEXT` (1,000 ms) for every 10,000 tokens
   of the chat's last request, as the provider reported it exactly (`usage_records.context_tokens`).
   A two-PDF chat at 300,000 tokens gets 36 s + 30 s.
3. Every first event logs `ttftMs`, the budget and the prior context (`provider first event`).
   1,000 ms per 10,000 tokens is a starting value, not a measurement; these logs are how it
   gets set from data.

## Consequences

- A request that really hangs is detected later on large chats: 66 s at 300,000 tokens, where
  it used to be 12 s.
- `firstTokenBudgetMs` is a pure function, tested in `src/services/firstTokenBudget.test.ts`.
