# ADR-0050: A turn log under every reply

- Status: accepted by the owner on 2026-09-28 ("ovoru reply ku keela athu enenea panuthunu oru md
  file log kudukra mari panu"). Tested locally; not deployed.
- Date: 2026-09-28
- Ours: the reference has no such log. Its steps show tool calls; they do not show what a
  request carried.
- Amended by [ADR-0051](0051-tool-limit-shown-and-in-view-pdfs-read-by-eye.md): the `provider completed` stage records the final round (function calling off, calls not run, text length, provider finish reason).

## Context

After ADR-0049 a scanned statement still drew seven commands, and the owner asked whether the
model read the page images or made its own. The code says the images go (ADR-0013, ADR-0016),
but nothing a person could open showed what a given request carried, so each answer was an
inference from code. The existing debug event names the tools allowed and called, nothing more.

## Decision

1. Every reply that reaches a model writes one Markdown log (`services/turnLog.ts`), stored in
   `turn_logs` keyed by the message (migration 0023), written in the turn's `finally` so a
   failed or stopped turn is logged too.
2. The log holds: the model asked for and used, the client platform; the system prompt's size
   and section names (not its text); how many earlier turns went; the declared tools; the skills
   listed; each attachment as it was sent (for a PDF: pages, page images and whether by Cloud
   Storage URI or inline, pages with a text layer; or the reason it was left out); the user
   message as sent, with the attachment manifest; then, in order, the model's thought summary
   (providers return a summary, not the thinking itself), the reply text, and every tool call
   with why it was made (its `description`), what it ran (a command as a shell block, a file's
   text as the file) and its result as the model received it. Nothing is cut: the owner asked
   for no limit. Then status, finish reason, usage and phase timings.
3. A **Pipeline** table traces the backend stage by stage, each with when it finished, how long it
   took and what it decided: workspace, history, model (requested, resolved, the Auto rule),
   capabilities (built-in search, code execution), compaction, routing (the flags and the tools
   declared), skills, system prompt (size of each part), budget (output ceiling, effort), tool
   executors, attachments (page images, what was left out), request built (files read with
   code), provider first event, provider completed or failed, an empty-reply retry, saved. A
   turn that throws gets a **Where it failed** section: the stage it came after, the error and
   the top of its stack. Each tool call shows when it started and how long it took.
4. `GET /v1/chats/:id/messages/:messageId/log` returns it as a `.txt` download (`text/plain`,
   Markdown inside) to the chat's owner only: the same bytes as `.md`, but a phone opens a
   `.txt` in its own viewer. Every reply shows a "Download turn log" button beside copy and
   regenerate; a reply that failed or stopped with no text shows it on its own.

## Consequences

- "Did the model get the images?" is read in the log's "What was sent" section, and "where
  did it go wrong?" in its Pipeline table and "Where it failed".
- The prompt text stays out of the log, so the log can be shown to every user.
- Each reply stores a few kilobytes more; the log goes with its message when the chat is
  deleted.
