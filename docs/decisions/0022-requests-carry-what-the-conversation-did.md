# ADR-0022: The model sees what earlier turns did, starts with the tools file work needs, and settles the request first

- Status: accepted; deployed. Decision 2 (context editing) superseded by
  [ADR-0023](0023-tool-results-are-not-cleared.md). The every-turn list grew: memory tools
  ([ADR-0025](0025-memory-by-topic-as-claude.md)) and project search
  ([ADR-0029](0029-project-knowledge-searched-past-the-limit.md)).
- Date: 2026-09-25
- Amends: [ADR-0006](0006-turn-router-policy-boundary.md) (decision 2: what is declared on every
  turn)
- Amended by [ADR-0046](0046-tools-and-skills-cut-to-the-reference.md): read_uploaded_file, generate_deliverable and suggest_next_actions are removed from the tools declared every turn.
- Amended by [ADR-0047](0047-tools-and-skills-match-the-reference.md): every allowed tool is declared every turn; DECLARED_EVERY_TURN and search_tools are gone.

## Context

Live, 2026-09-25, on one KVB statement chat:

- **Follow-up redid the work.** "federal bank la evalo entries?" came after a turn that had
  already counted everything. The model called `load_skill`, `search_tools` and 10
  `run_python` calls and read the PDF again.
- **File request answered in chat.** "json file ah master and transaction ah kudu" got the JSON
  pasted as a code block, not a file.
- **Wrong script.** Replies came in Tamil script to messages written in Tanglish.

The code, and the system prompt as captured from a real request (27,635 characters):

- **History.** A history `Turn` was `{ role, text, attachments }`. Tool calls and results were
  stored in `tool_calls` but never sent again, so the next turn could not see the loaded skill
  or the counted rows.
- **Declared tools.** Only `search_tools` and `load_skill` were declared. `run_python`'s
  description, the only place saying "files in output/ are returned as downloads", was invisible
  until a search.
- **File formats.** The prompt listed "Professional deliverable capabilities: DOCX, XLSX, PPTX,
  PDF" and said nothing about other formats.
- **No understanding step.** "Understand the user's intended outcome" was followed directly by
  "When the task is clear, proceed". Nothing asked the model to settle the form of the answer
  (chat or file, and which format), or to reuse what the conversation already held.
- **Language.** "Use clear, simple, direct English unless the user requests another language."
- **Stale policies.** The memory policy was sent with memory off. The analytics policy named
  "dataset tools" and "derived dataset versions", both removed (ADR-0018 era).

Claude, from its docs:

- **How tool use works.** Each request carries "the original messages, the assistant's
  response, and ... the tool_result blocks".
- **Tool search.**
  - "Keep your 3–5 most frequently used tools non-deferred so Claude can call them without
    searching first."
  - A later turn "can reuse discovered tools in later turns without re-searching".
- **Context editing (`clear_tool_uses_20250919`).**
  - Trigger: 100,000 input tokens. Keep: 3 tool uses.
  - Older results are replaced with a placeholder.
  - Tool calls stay, because `clear_tool_inputs` defaults to false.
- **Published claude.ai system prompt (Fable 5.1).**
  - "when it does [ask], it tries to address even an ambiguous query before asking for
    clarification."
  - "Claude takes a moment to summarize its own thoughts, assesses the most important thing to
    say ..."

## Decision

1. **Earlier tool calls are part of the history.**
   - Each assistant `Turn` carries its `toolCalls`: name, input, and the stored result the
     model received.
   - Gemini replays a call as its signed `functionCall` followed by the `functionResponse`.
     Claude replays it as `tool_use` then `tool_result`.
   - A turn is replayed as text (`[Tool call] name(input)` / `[Result] ...`) when any of its
     calls is missing Gemini's signature, or names a tool this request does not declare. Google's
     rules for replaying unsigned or undeclared calls could not be read from here (egress
     blocked), so nothing is sent that could be rejected. A turn is never half native, half text.
   - Gemini's signature is now stored (`tool_calls.thought_signature`, migration 0012).
2. **Context editing, Claude's defaults.**
   - When the previous request's exact prompt plus answer reached `CONTEXT_EDIT_TRIGGER_TOKENS`
     (100,000), every tool result but the last `CONTEXT_EDIT_KEEP_TOOL_USES` (3) is marked
     cleared (`tool_calls.result_cleared`).
   - A cleared result is replayed as a placeholder; its call stays. The row keeps the full
     result.
   - Clearing is kept, not recomputed. Claude's API measures the full prompt, which only grows.
     Measuring our already-cleared prompt would bring results back on the next turn and clear
     them again.
3. **The compaction summarizer sees what older turns ran and found.** Each call goes in as
   text, cut to 2,000 characters (ArcNave's number).
4. **Declared on every turn (amends ADR-0006 decision 2).**
   - `search_tools` and `load_skill`, as before.
   - Plus whichever of `run_python`, `read_uploaded_file` and `generate_deliverable` this turn
     allows (`DECLARED_EVERY_TURN`). That is five at most, within Claude's 3–5.
   - Permission still decides what is allowed; wording still never does.
5. **System prompt.**
   - **Understand first.** A step comes before any tool call: settle the outcome, its form
     (chat or file, which format), and what the conversation already holds.
   - **Ambiguity.** Address the likeliest reading first, then ask.
   - **Files.** A file request is answered with a file: `generate_deliverable` for
     DOCX/XLSX/PPTX/PDF, and `run_python` to `output/` for any other format. When no tool
     produces a format, say so. A short cover note goes in chat.
   - **Language.** Reply in the user's language and script. This is ArcNave's rule; Claude's
     published prompt has none.
   - **Skills.** A skill loaded earlier in the conversation is still in context.
   - **Policies.** The memory, generative UI and analytics policies are sent only when their
     tool is allowed. The analytics policy no longer names dataset tools.
   - **Anthropic cache split.** It is used only when the prompt really starts with the cached
     prefix.

## Consequences

- **Follow-ups.** They can answer from what earlier turns found, without reloading or
  recounting.
- **Cost of history.** Requests grow by the replayed tool results until context editing
  clears them.
- **Round 0.** It carries up to three more tool schemas, and the extra `search_tools` round
  before file work is gone.
- **Undeclared tools.** Calls to tools discovered mid-turn (e.g. `extract_scanned_table_rows`)
  replay as text on later turns, since they are not declared then.
- **Live check.** Whether Gemini accepts replayed signed calls from earlier turns is to be
  confirmed after deploy; the in-turn loop already sends the same shape successfully.
