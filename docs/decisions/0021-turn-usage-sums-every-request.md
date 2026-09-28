# ADR-0021: A turn's usage is the sum of its provider requests; compaction reads the last one

- Status: accepted. Tested locally; not live.
- Date: 2026-09-25
- Amends: [ADR-0019](0019-long-chats-follow-claude.md) (the compaction trigger)
- Amended by [ADR-0051](0051-tool-limit-shown-and-in-view-pdfs-read-by-eye.md): the forced-synthesis request is removed; a turn that ends with no text is not answered by a second request.

## Context

Live, 2026-09-25: a PDF question ran `load_skill`, `search_tools` and 13 `run_python` calls,
so at least 16 model requests. The answer's footer said "19,725 in · $0.0158", which is the size
of one request.

The code:

- `providers/gemini.ts` kept `usage = chunkUsage` across rounds. Each round overwrote the last,
  so the turn reported only its final request.
- `providers/anthropicVertex.ts` merged every round with `Math.max`, so it reported the largest
  request, not the sum.
- `services/agentLoop.ts` summed its steps but started from `EMPTY_USAGE` (`exact: false`), so
  every agent-mode turn came out `exact: false`.
- `services/generation.ts` replaced the first request's usage with the forced-synthesis
  request's usage.

Every one of these rows was stored as `exact: true` and priced. That breaks Invariant 3.

Claude docs, "How tool use works": each round of the loop is "a new request containing the
original messages, the assistant's response, and ... the `tool_result` blocks". Each request
is billed on its own. "Prompt caching": "total_input_tokens = cache_read_input_tokens +
cache_creation_input_tokens + input_tokens". Gemini's `promptTokenCount` already includes cached
content (the `@google/genai` type docs).

## Decision

1. **A turn's tokens are the sum of its requests** (`addRequestUsage`). The sum is exact only
   when every request reported a count. If one did not, the turn is `exact: false` with zeros:
   a part is never shown as the whole.
2. **`ProviderUsage.lastRequest`** holds the last request's whole prompt (cached part included)
   and its answer. That is what the next turn resends.
3. **`usage_records.context_tokens`** (migration 0011) stores `lastRequest` input plus output,
   or null when the usage is not exact.
4. **Compaction reads `context_tokens`, not the total.** A 14-request turn totals about 14 times
   the conversation; triggering on that would compact far too early. Rows from before this
   change have no `context_tokens`. Those chats compact from their next turn on; nothing is
   guessed for them.

## Consequences

- The footer, the budget counters and `costUsd` now show the whole spend of a tool loop. For
  heavy tool use they will be many times larger than before. That is the real cost.
- A turn whose Gemini round ends with no usage metadata (for example, Stop landing before the
  first chunk) is now `exact: false` for the whole turn.
- Not changed here: Gemini's `thoughtsTokenCount` is not counted in `outputTokens`. Whether
  Vertex bills thinking at the output rate could not be checked from this session (the pricing
  page did not load). It is recorded as an open question in CURRENT.md.
