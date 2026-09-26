# ADR-0019: Long chats keep the whole conversation, and compact as Claude does

- Status: accepted; deployed 2026-09-25, compaction not yet seen live. Trigger amended by [ADR-0021](0021-turn-usage-sums-every-request.md): it reads the last request's size (`context_tokens`), not the turn's total. Trigger superseded by [ADR-0027](0027-compaction-as-the-window-fills.md): as the window fills, not at 150,000.
- Date: 2026-09-25
- See also: [ADR-0013](0013-pdfs-sent-as-page-images-and-text.md),
  [ADR-0016](0016-gemini-reads-page-images-by-uri.md)

## Context

Audit of 2026-09-25, Claude from its docs, ArcNave from the code:

- **History.** `loadHistory` sent at most the last 20 messages (`Math.min(HISTORY_MAX_TURNS,
  20)`). A file attached 11 questions earlier left the model's view, the file list and the
  sandbox. Claude sends the whole conversation, up to the context window.
- **Compaction.** The code existed but was off, and nothing in the product created a
  compaction. Claude: "Compaction replaces the older turns of a conversation with a summary
  that Claude writes" (Compaction overview). Threshold compaction runs inside the request that
  reaches the trigger (default 150,000 input tokens, minimum 50,000). Recent turns can be kept
  word for word, with the cut before a user message.
- **Earlier images.** "Claude has access to every image from earlier turns" (Vision). ArcNave
  dropped earlier images and PDF pages past a 12 MB history budget, whatever the model.

## Decision

1. **No turn cap.** Every message after the last compaction is loaded. The existing character
   budget stays as a backstop. `HISTORY_MAX_TURNS` is removed.
2. **Compaction is on by default.** It is Claude's "your own summarizer" option, because Gemini
   has no server-side compaction:
   - **Trigger:** the previous request's input plus output tokens, as the provider reported
     them. That is what the next request resends, and it is what Claude's own example loop
     counts. The trigger is `COMPACTION_TRIGGER_TOKENS` (150,000), capped at three quarters of
     the model's window and never below 50,000. When usage is not exact, compaction never
     triggers (Invariant 3).
   - **What is kept:** the last 2 turns word for word, with the cut before a user message.
     Everything before goes into the summary, together with the previous summary.
   - **Who writes it:** the model the turn runs on, with Claude's default summarization prompt
     (`<summary>` tags). The summary goes into the system prompt as `<conversation_compaction>`.
   - **The user sees it,** as on claude.ai: progress events "Compacting our conversation", then
     "Conversation compacted". The tokens are recorded as a usage row
     (`requestId …:compaction`, no message).
   - **If no summary comes back, or the call fails,** the full history is sent and the turn goes
     on. An abort ends the turn. Messages are never deleted.
3. **Every file of the chat is always listed**, and is in `run_python`'s `input/`, even when its
   turn is compacted or past the backstop. The list is built from the database in upload order,
   so each file's sandbox name stays stable.
4. **The 12 MB history budget applies only where no limit is verified.** Claude's request limit
   is verified and already enforced newest-first by `enforceModelLimits`. A Gemini PDF sent by
   `gs://` URI adds nothing inline. The budget now covers only Gemini's inline bytes: images,
   and PDFs when no model-input bucket is set. Google's own pages could not be reached from here
   to verify Gemini's inline limit.

## Consequences

- The first turn past the trigger takes longer, because the summary is written first. Later
  turns are smaller.
- Existing chats longer than 20 messages send more history from the first deploy on, up to the
  trigger.
- Compaction events use the existing `research` stream event, so the frontend needs no change.
