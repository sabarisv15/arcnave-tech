# ADR-0027: Compaction runs as the window fills, and skills come back after it

- Status: accepted. Tested locally; not live.
- Date: 2026-09-26
- Supersedes: the trigger of [ADR-0019](0019-long-chats-follow-claude.md) (150,000 tokens,
  three quarters of the window).

## Context

ADR-0019 took 150,000 from the API's opt-in compaction beta (`compact_20260112`, "default
trigger is 150,000 input tokens"). That is an API default a developer chooses, not what Claude's
app does, and on Gemini's 1M window it summarised chats at 15% full, with an extra model call
while the user waited (audit B1).

- Help Center, usage and length limits: Claude "summarizes earlier messages" "when your
  conversation approaches the context window limit"; "Your full chat history is preserved".
- Claude Code, model-config, "Default auto-compact thresholds": "Models running with a native
  1M window ... compact before the window fills, at about 967K tokens by default."
- Claude Code, context-window: after compaction what is left includes "the body of each skill
  you invoked"; "Claude Code re-injects the body of each skill you invoked, capped at 5,000
  tokens per skill."

## Decision

1. Trigger: the window less `COMPACTION_WINDOW_RESERVE` (33,000, Claude Code's 1M → 967K),
   never below 50,000. `COMPACTION_TRIGGER_TOKENS` applies only when the window is unknown.
2. The summarizer gets each earlier tool result whole. It fitted in the last request, so it fits
   in this one.
3. After a compaction, skills loaded (`load_skill`, `read_skill`) in the summarised turns come
   back in full under "Loaded Skill", each within 20,000 characters (ArcNave counts no tokens,
   Invariant 3). The prompt says so.

## Verify

`services/compaction/compaction.test.ts` (967,000 on 1M), `routes/longChat.integration.test.ts`,
`routes/toolHistory.integration.test.ts` (skill given back after compaction).
