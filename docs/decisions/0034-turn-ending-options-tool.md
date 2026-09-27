# ADR-0034: Clickable question options via a turn-ending tool (ask_user_options)

- Status: proposed
- Date: 2026-09-26
- Work package: WP-06 (Gap 3: Clickable question options)
- Amended by [ADR-0048](0048-artifacts-questions-visuals-and-cards-as-the-reference.md): the question tool is ask_user_input_v0 (1 to 3 questions, string options, single_select, multi_select or rank_priorities).

## Context

In the Claude app, when Claude wants to ask clarifying questions or present discrete choices to the user, instead of requiring the user to type out answers, Claude can present clickable options at the bottom of the chat:
- Single-choice buttons (one-click response),
- Multi-select checkboxes with a Send button,
- Ranking options with reordering controls and a Send button.

The composer remains active so the user can still type a free-form answer instead.

In ArcNave, there is currently no such mechanism. `messages.questions` (used for research follow-ups) is a separate feature and is left untouched.

When the model calls a tool today, both provider adapters (`gemini.ts` and `anthropicVertex.ts`) execute the tool, send the result back in a subsequent round, and expect the model to synthesize a final answer in text. A tool intended to ask the user a question must not trigger another provider round; it must terminate the loop immediately so the conversation pauses and waits for the user's input.

## Decision

1. **Tool definition (`ask_user_options`):**
   - Defined in `backend/src/tools/definitions.ts`.
   - Schema:
     - `question` (string, required): The prompt or question to show above the options.
     - `kind` (string, enum: `'single' | 'multi' | 'rank'`, required): Type of selection.
     - `options` (array of objects, `minItems: 2`, `maxItems: 6`, required):
       - `label` (string, required): Display text of the option.
       - `description` (string, optional): Supporting detail or description.
   - Description: "Presents clickable options (multiple choice, multi-select, or ranking) to the user at the bottom of the chat. Use this only when the user needs to decide between a few known options, and at most once per turn. Calling this tool ends the turn so the user can make their selection."
   - No rules are added to the static prompt (per ADR-0032 and WP-06 step 2); the tool description guides usage.
   - Result payload: `{ status: 'shown' }`.
   - Exposed on every turn: Added to `DECLARED_EVERY_TURN` and `computeAllowedTools` so the model has it in hand without needing a deferred tool search.

2. **Terminal tool loop policy:**
   - Add `isTerminalTool(toolName: string): boolean` and `hasTerminalToolCall(toolCalls: Array<{ name: string }>): boolean` to `backend/src/providers/toolLoopPolicy.ts`.
   - In both provider adapters (`anthropicVertex.ts` and `gemini.ts`), after executing and yielding tool results for a round, if `hasTerminalToolCall(...)` is true:
     - The round loop breaks immediately (`break`), preventing subsequent provider requests.
     - The turn ends cleanly with finishReason `'stop'`.

3. **Frontend presentation & interaction:**
   - When the last message in the chat is an assistant message whose tool calls include `ask_user_options`, show the interactive options panel above the composer inside `.conversation-composer`.
   - Modes:
     - **Single:** Clicking an option immediately calls `send(option.label, mode, [], chatId, projectId)`.
     - **Multi:** Checkboxes allow toggling multiple options. A "Send" button sends the selected labels (comma-separated or formatted list).
     - **Rank:** Options display ordered numbers (1, 2, 3...) with accessible keyboard-usable Up and Down buttons to reorder items. A "Send" button sends the ranked list (`1. Option A\n2. Option B...`).
   - The composer textarea remains enabled and usable for free-form typing.
   - Once any reply is sent (or if the conversation history advances), the options panel automatically disappears because the assistant message with `ask_user_options` is no longer the last message.

## Verify

- `backend/src/providers/toolLoopPolicy.test.ts`: verifies `isTerminalTool` and `hasTerminalToolCall`.
- `backend/src/tools/definitions.test.ts` & executor tests: verifies schema validation (rejecting < 2 or > 6 options, invalid kind, missing label).
- `backend/src/providers/anthropicVertex.adapter-loop.test.ts` & `backend/src/providers/gemini.adapter-loop.test.ts`: verifies that calling `ask_user_options` terminates the loop in 1 round without issuing a follow-up model request.
- `arcnave-frontend/src/QuestionOptions.test.tsx`: verifies rendering for single, multi, and rank modes, option selection, keyboard reordering, submission via `send()`, and disappearance when a reply exists.
