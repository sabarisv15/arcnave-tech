# ADR-0030: The model's thought summary is shown, and Gemini's thinking is billed as output

- Status: accepted. Tested locally; not live.
- Date: 2026-09-26

## Context

Gemini thinks before answering, and the user saw only "Thinking" (audit B8). Its
`usageMetadata.candidatesTokenCount` leaves thinking out, and ArcNave billed only that (carried
over as E).

- Google Cloud, Agent Platform pricing (read 2026-09-26): Gemini output is priced as "Text
  output (response and reasoning)", one rate.
- `@google/genai` types: `ThinkingConfig.includeThoughts`, `Part.thought` ("whether the part
  represents the model's thought process"), `thoughtsTokenCount`. Google's thinking page is
  blocked from this session; search results quote it: "You can enable thought summaries by
  setting includeThoughts to true".

## Decision

1. Gemini requests set `thinkingConfig.includeThoughts`. Parts marked `thought` stream as a
   `thinking` event, are stored on the message (`messages.thinking`, migration 0013) and show
   as a collapsible "Thought process" block. They are never part of the answer and never sent
   back.
2. Output tokens are `candidatesTokenCount + thoughtsTokenCount`. The context compaction reads
   stays prompt plus answer, since thoughts are not resent.
3. Claude models are unchanged: extended thinking is a user choice in Claude's app, and ArcNave
   has no such switch yet.

## Amendment (2026-09-26, after the first live look)

Live, the answer showed one block of all thinking, then one block of all tools, and a second
"Thinking" label from the tool group. Claude shows the answer in the order it happened: a line
per stretch of thinking, then text, then the tool steps, then text again. So:

- Each answer keeps `segments` (migration 0014): runs of thinking, text and tool calls, in order.
  The client builds the same list while streaming and renders it as a timeline. Answers stored
  before it keep the grouped layout.
- A stretch of thinking shows one line, its latest `**Heading**`, and opens to the summary with
  headings shown as headings, not as `**` marks.
- A tool group with nothing running shows what it did ("Ran 4 commands"), not "Thinking".

## Verify

`providers/gemini.adapter-loop.test.ts`, `providers/gemini.test.ts` (usageFrom),
`routes/chats.integration.test.ts` ("thinking"). Live: confirm Vertex accepts
`includeThoughts` for the deployed model.
