# ADR-0032: One loop; the model reads the request; guidance as Claude's docs give it

- Status: accepted. Merged (79817d2) and deployed.
- Amended 2026-09-26: the reply-language rule moved from `<communication>` to the prompt's
  opening block, following Gemini 3's guidance to put behavioural constraints at the top.
- Date: 2026-09-26
- Supersedes: ADR-0006 decision 3 (intent detection as telemetry).
- Amends:
  - ADR-0031: `REASONING_EFFORT` default high → medium.
  - The prompt and the pdf and xlsx skills.

## Context

A request to consolidate a 25-page statement ("statement elam consolidate paniru") took more
than 10 minutes. It hit the 16-round tool limit, which is why the Continue button appeared, and
produced a 7-sheet Excel file nobody asked for.

The trace (`docs/audits/2026-09-26-intelligence-latency-audit.md`, second pass) found the
causes in how ArcNave instructs the model. The model itself was not the cause: Gemini 3.8
Flash is a strong model, within 0.3 points of Claude Opus 5 on DeepSWE v1.1.

- **Keyword routing.**
  - `generation.ts` sent a turn to the AgentLoop on words such as "compare … documents".
  - `turnRouter.ts` classified intent with regexes.
  - The AgentLoop gated `run_python` and `generate_deliverable` on wording
    (`capabilityPolicy.ts`).
- **Anti-laziness in the prompt:** "do not complete only an easy part", "time spent do not by
  themselves mean the task is done", "difficulty or slowness is not a blocked state".
- **Standing verification.** A `<verification>` section, "check completeness by comparing
  counts", and a pdf skill that required transcribing every record for any total or
  classification.
- **Thinking at HIGH** on every round of every turn.
- **No default form.** "Chat or file" was left open.

## What the references say

Claude (sources read 2026-09-26):
- **Opus 5 prompting guide, "Task scope and over-verification":** "If your prompt contains
  explicit verification instructions … remove them: instructions like these cause
  over-verification." It gives a scope sample: "Deliver what was asked, at the scope intended…"
- **Prompting best practices, migration step 6:** "If your prompts previously encouraged the
  model to be more thorough … dial back that guidance."
- **App system prompt (Opus 5.5, 2026-09-22):** "Claude matches its effort to the ask. A simple
  question gets a direct answer…" On mistakes: "accountability without self-abasement,
  excessive apology, self-critique, or surrender."
- **Help Center, "Create and edit files":** Claude creates a file when it is asked for.
- **Agent SDK, "How the agent loop works":** one loop in which the model evaluates, calls tools,
  and repeats until no tool call remains. Effort "medium" is for "routine edits, standard
  tasks".
- **Context engineering (Anthropic engineering):** hard-coded brittle logic "creates
  fragility".
- **Skill authoring best practices:**
  - "Claude is already very smart"; only add what it does not know.
  - Use low-freedom, step-by-step workflows with validation loops for fragile,
    quality-critical operations.
  - "Prefer scripts for deterministic operations."

Gemini (search results; Google's own pages are blocked by this environment's proxy):
- Gemini 3 answers best to short, direct instructions and "may over-analyze verbose or overly
  complex prompt engineering".
- `thinking_level` high "may take significantly longer to reach a first … token". Medium is
  "balanced … for most tasks".
- 3.8 Flash "executes extra reasoning steps and calls tools iteratively" on complex tasks, and
  uses about 30% more output tokens at higher effort.

## Decision

1. **One loop.**
   - The AgentLoop runs for Research mode only, which the user chooses. No wording selects it.
   - `routeTurn` no longer receives the prompt. It decides tools from flags and infrastructure
     only.
   - `capabilityPolicy.ts` is deleted, and the AgentLoop gates tools by permission, as the chat
     path does.
   - `detectedIntent` and `pythonExposed` leave the debug trace.
2. **Prompt.**
   - "Do the work" becomes "Scope and effort": Claude's scope sample, verbatim, plus the
     effort-matching line from Claude's app prompt.
   - The form defaults to a reply in chat unless the user asks for a file or a conversion.
   - Removed: the anti-laziness paragraphs, the `<verification>` section, and the
     completeness-check step.
   - The per-call progress line becomes the Opus 5 guide's cadence: one sentence before the
     first call, then updates only when something important changes.
   - A `<mistakes>` section takes the app prompt's wording.
   - The generate_deliverable report-and-repair loop stays. It is the tool's own validator, the
     pattern the skill guide recommends.
3. **Skills.**
   - pdf and xlsx are rewritten to the skill authoring guide: concise, recipes and tool shapes,
     no capitals.
   - The exact-count workflow stays, with its checks, as a conditional workflow. It applies when
     the user asks for exact figures or complete lists, not for summaries.
   - Checks run in code where a tool can do them: `analyze_table_rows` compares against an
     `expected` printed total.
4. **Effort.** The `REASONING_EFFORT` default is `medium`, the default of both Gemini 3.8 Flash
   and Claude Opus 5.5. A deployment can raise it with `--update-env-vars`.
5. **Evaluation.**
   - `backend/src/scripts/evalScope.ts` sends `docs/evals/scope-cases.json` through the real
     API and reports time, tool calls, files made and the finish reason.
   - It is run before and after a behaviour change.
   - The user's own documents are passed with `--files` and never committed.

## Consequences

- **Kept, unchanged:**
  - PDFs still reach the model as page images plus text.
  - The same tools, sandbox, memory, compaction and context editing.
  - `TOOL_MAX_ROUNDS` 16.
- **Risk.** With less instruction, the model may report an exact figure without checking it.
  The exact-count workflow and the `expected` checks cover the stated cases. `evalScope` cases
  `pdf-exact-count` and `pdf-to-excel` watch for it.
- **Not verified live.** The effect on Gemini 3.8 Flash is measured only by running
  `evalScope` against the deployed service, before and after.
- **Tests:**
  - `turnRouter.test.ts`: no prompt input, flags decide.
  - `turnRouter.locked.test.ts`.
  - `behaviorEvaluation.test.ts` Eval 11b: Claude's wording present; anti-laziness and
    `<verification>` absent.
  - `tableExtraction.integration.test.ts`: the new skill heading.
