# P13 live checklist — history summary, title job, router shadow (ADR-0080)

For the owner, after the merge that carries P13 (migration `0032_history_summaries`). Nothing here
was run live; every item is new behaviour on the live service.

## Before you start

- The service has `ANTHROPIC_API_KEY` (the helper is Claude Haiku 5.5 on the first-party API).
  `MODEL_HAIKU` unset means `claude-haiku-5-5`.
- `ENABLE_HISTORY_SUMMARY` unset (default true). The live service sets
  `ENABLE_CONTEXT_COMPACTION=true` (EVIDENCE.md): it is **ignored** while the summary is on — that
  is the intended switch. To roll back: set `ENABLE_HISTORY_SUMMARY=false`; the compaction then
  runs per its own flag again.
- `ROUTER_SHADOW` unset (off) for items 1–6; item 7 turns it on.
- Logs: Cloud Logging, filter `jsonPayload.module="helpers"`. Every line has `code`, ids and
  counts; none has any message, file, title or summary text.

## 1. A new chat gets a generated title

- **Do:** start a new chat, ask "Plan a 3-day trip to Madurai for two people on ₹15,000".
- **Expect:** the sidebar first shows the first 80 characters of the question; within about 10 s
  it changes to a short title (≤ 6 words, ≤ 60 characters, same language, no quotes, no trailing
  period). Log: one `title_written` line with `inputTokens`, `outputTokens`, `durationMs`.
- **Failure looks like:** the placeholder stays (check the log: `title_skipped` with a `reason`;
  `helper_unavailable` = key or model id; `refused` / `truncated` = the model's answer), or a title
  with quotes / markup, or a title in another language than the question.

## 2. A rename always wins, and the title is set once

- **Do:** start a new chat, send a question, and rename it in the sidebar **immediately** (before
  the generated title appears). Then send two more messages, and regenerate the first answer.
- **Expect:** your name stays; it never flips to a generated one. Log: `title_skipped`,
  `reason: renamed` (or `title_set`).
- **Failure looks like:** the generated title replaces your name, or the title changes after the
  second message or the regenerate.

## 3. A long chat with a file (the 48k budget) — the main risk

- **Upload:** a text-heavy PDF or DOCX of 20–40 pages (a bank statement, a report).
- **Ask:** 10–12 questions about it in one chat, each needing the file ("what is the total on
  page 3", "list the debits over ₹5,000", …), then "what was my very first question?".
- **Expect:** every answer still uses the file (the file goes under its own budget, CXD-4); after
  the trigger a `summary_written` log line (`summaryVersion` 1, `coversUptoSeq`, `coveredTurns`),
  and later turns answer the first-question check from the summary. The assistant rows carry
  `history_turns` ≤ 6 (plus older uncovered ones), `ctx_count_source = provider`, a
  `summary_version` once a summary exists.
- **Failure looks like:** an answer that no longer knows the file ("I don't see a file"), the
  same work redone every turn, an error card mid-chat, or `over_budget = true` on short turns.
  Run `select seq, history_turns, history_dropped_turns, ctx_tokens, over_budget, summary_version
  from messages where chat_id = '<id>' and role = 'assistant' order by seq;` and send the output.

## 4. A branch keeps the summary only up to the fork

- **Do:** in the chat from item 3 (after `summary_written`), edit an **early** question (one the
  summary covers) and send it; then edit a **late** question (after the covered range).
- **Expect:** the early edit answers without the summary (no `<earlier_conversation_summary>`
  content leaks into it, e.g. it does not "remember" later questions); the late edit still knows
  the early conversation.
- **Failure looks like:** the early-edit branch knows about questions asked after the fork.

## 5. Gemini and Claude both work on the new path

- **Do:** repeat a short version of item 3 (6–8 questions) with Sonnet 5.5 picked by name.
- **Expect:** the same behaviour; the count calls go to Claude's `count_tokens`.
- **Failure looks like:** errors on every turn (count API or permissions); the turn should still
  answer with `ctx_count_source = none` if counting fails.

## 6. Nothing is substituted when the helper is missing

- **Do (staging only):** set `MODEL_HAIKU=` (empty), start a chat, send two messages.
- **Expect:** chats work; the title stays the placeholder; log `title_skipped` /
  `summary_skipped` with `reason: helper_unavailable`. No other model is billed for it.
- **Restore** `MODEL_HAIKU` afterwards.

## 7. Router shadow (optional; off by default)

- **Do:** set `ROUTER_SHADOW=true`, send 5 different messages (a greeting, a search question, a
  file question, a code question).
- **Expect:** one `router_shadow` line per turn with `status`, `intent`, `tier`, `resolvedAlias`,
  `durationMs`; the model shown on each answer is the same as with the switch off; first-token
  time unchanged. `status: timeout` is expected sometimes (N-69: about 6 % over 1.5 s).
- **Failure looks like:** a slower first token, a different model picked, or more than one line
  per turn. Set `ROUTER_SHADOW=false` afterwards (the intent list is still the placeholder).

## 8. Rollback

- `ENABLE_HISTORY_SUMMARY=false` → the old compaction path; rows in `summaries` are ignored.
- The migration only adds a table and nullable / defaulted columns; no rollback of 0032 is needed.
