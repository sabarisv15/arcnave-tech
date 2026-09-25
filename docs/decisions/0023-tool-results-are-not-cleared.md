# ADR-0023: Tool results stay in the history; only compaction shortens it

- Status: accepted.
- Date: 2026-09-25
- Supersedes: [ADR-0022](0022-requests-carry-what-the-conversation-did.md) decision 2 (context
  editing) and its "cost of history" consequence. The rest of ADR-0022 stands.

## Context

ADR-0022 cleared every tool result but the last 3 once the previous request reached 100,000
tokens, taking the defaults of the API's `clear_tool_uses_20250919`.

Live, a chat with two bank-statement PDFs spent 1,116,985 input tokens over about 13 rounds in
one turn, so its last request passed 100,000. The follow-up "federal la evlo entries and kvb la
evlo entries?" found its counts replaced by the placeholder, which told the model to call the
tool again. It re-ran OCR on page 12 to find the statement's grand total.

Claude, from its docs (read 2026-09-25):

- **Claude app** (Help Center, "How do usage and length limits work?"): "When your conversation
  approaches the context window limit, Claude summarizes earlier messages to continue the
  conversation seamlessly." "Your full chat history is preserved so Claude can reference it."
  Nothing there clears tool results by rule.
- **Context editing** (platform docs): "Context editing is opt-in" (through the
  `context_management` parameter). "For most use cases, server-side compaction is the primary
  strategy for managing context in long-running conversations. The strategies on this page are
  useful for specific scenarios where you need more fine-grained control."

ADR-0022 took an opt-in API tool with its default trigger and made it ArcNave's default.

## Decision

1. **No context editing.** Every earlier tool call is replayed with its full stored result
   until compaction ([ADR-0019](0019-long-chats-follow-claude.md)) summarizes the conversation
   near the model's window. The compaction summary already includes the tool calls (ADR-0022
   decision 3).
2. **Cleared results come back.** `tool_calls.result_cleared` is no longer written or read, so
   a result cleared while ADR-0022 was live is replayed in full again. The rows always kept the
   full result.
3. **The column stays for now.** Dropping it would break the previous revision while a
   rollout still serves it. A later migration can drop it.

## Consequences

- Follow-ups can answer from earlier results however large the turn was.
- Requests carry more tokens between 100,000 and the compaction trigger. On repeated requests
  most of that is cached (916,244 of the 1,116,985 input tokens above).
- `CONTEXT_EDIT_TRIGGER_TOKENS` and `CONTEXT_EDIT_KEEP_TOOL_USES` are removed from config.
