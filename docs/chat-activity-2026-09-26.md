# Chat activity presentation

The supplied Claude screenshots show collapsed activity groups between assistant paragraphs,
with short summaries on expansion. Public [Claude thinking documentation](https://platform.claude.com/docs/en/build-with-claude/thinking)
distinguishes progress updates and summarized thinking; it does not disclose the app's internal UI implementation.
ArcNave adapts the observable presentation using its existing tool events and user-facing text.

- Record each tool start's UTF-16 position in the accumulated response, stream it as `textOffset`,
  and persist it on `tool_calls`. Render text slices and adjacent activity groups in that order.
- Collapsed headers use action descriptions; expanded groups contain concise operation summaries.
  Python accepts an optional short `description`, displayed as text rather than Markdown or HTML.
- Confirmed output metadata supplies created-file labels and filenames. Requested outputs alone
  never establish creation. Failure and interruption remain visible.
- The shared prompt requests short progress paragraphs around meaningful stages. These are
  model-generated public updates, not simulated thinking or a reconstruction of private reasoning.
- Old records with no offset retain their activity after the answer; their original ordering cannot
  be recovered. New chat turns preserve grouping across transcript reloads. This change targets the
  ordinary chat generation path, not a redesign of the separate research agent event pipeline.

Migration `0013_chat_activity_offsets.sql` adds one nullable column; apply it before deploying the
updated backend. No production deployment was performed.

Validation: frontend build and unit tests; backend typecheck, fake-provider SSE/transcript integration,
confirmed-file metadata tests, prompt budget tests; browser inspection of collapsed and expanded
actual React activity groups using a temporary illustrative fixture. The fixture was removed.
No real-provider attachment acceptance or production visual verification was performed.
