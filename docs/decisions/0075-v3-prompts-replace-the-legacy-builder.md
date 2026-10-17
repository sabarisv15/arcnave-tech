# ADR-0075: The Stage 6 v3 prompts replace the legacy prompt builder

- Status: accepted (task tech-p07 = P07, owner decisions 2026-10-16). Tested offline; not run live
  (owner-run), not merged, not deployed.
- Date: 2026-10-16
- Task: tech-p07, Part A. Evidence: [`docs/ops/p07-result.md`](../ops/p07-result.md).
- Supersedes in part (none of these files is edited; each keeps its other decisions):
  - [ADR-0022](0022-requests-carry-what-the-conversation-did.md) decision 3 ("settle the request
    first" as prompt text).
  - [ADR-0025](0025-memory-by-topic-as-claude.md): the memory *policy text*. Memory storage, the
    tools and the listing are unchanged; the rules are now the v3 `<memory>` section, and the
    file-format and edit-tool paragraphs ride in the appendix.
  - [ADR-0032](0032-one-loop-model-reads-the-request.md), [ADR-0043](0043-contextual-chat-follow-ups-and-safe-answer-rendering.md)
    (reply style), [ADR-0049](0049-prompt-and-skills-line-by-line-with-the-reference.md) and
    [ADR-0052](0052-prompt-gaps-closed-from-the-audit-and-turn-logs.md): every sentence of base
    prompt text they wrote. Skills, tools and the turn code they decided stay.
  - [ADR-0048](0048-artifacts-questions-visuals-and-cards-as-the-reference.md): the "when to make
    a file" lists (v3 `<artifacts>` decides now); the artifact mechanics are kept in the appendix.
- Relates to: [ADR-0071](0071-stage-decisions-win-over-claude-reference.md) (stage decisions win),
  [ADR-0074](0074-measure-first-quality-harness.md) (the harness this change is measured with).
- Models used: Opus 5.5 (main session and reviewer).

## Stage decision applied

Stage 6, locked 2026-10-02: `06-policy-spec-v3.md` and its two renderings
`06-system-prompt-v3-claude.md`, `06-system-prompt-v3-gemini.md`, with the doc-syncs of
2026-10-05 (Gemini layout: per-turn and session blocks in the turn), 2026-10-10 (runtime files =
the code block; version = first 12 hex of the SHA-256), 2026-10-11 (`<current_time>` format) and
2026-10-14 (`<earlier_conversation_summary>`). Owner decisions 2026-10-16: the v3 prompts win and
the old builder's prompt is discarded; no language paragraph (CXD-1); math delimiters and the
knowledge-cutoff line as the stage writes them.

## Claude

What Claude does here: Claude's published system prompts are one long static text with XML
sections, followed by runtime blocks; tools are declared as tool definitions, not described in
the prompt. That is what Stage 6 designed v3 from (`06-opus55-prompt-decode.md`). Where the stage
and Claude differ, the stage wins (ADR-0071): v3 is ArcNave's own text, with India-specific rules
(Tele-MANAS, SEBI, ECI), typed citations and a capability-state block Claude does not have.

## Decision

1. **Runtime files.** `backend/prompts/system/v3/claude.md` and `gemini.md` hold the code block of
   each rendering, byte for byte, with one change: the tool-name map. A drift test compares each
   file with the docs mirror plus the map and fails on any byte. The image copies `backend/prompts`
   (Dockerfile, runtime stage); a test loads the module from a compiled copy at `dist` depth.
2. **Tool-name map (transitional, ours).** `backend/src/services/prompt/toolNameMap.ts` lists the
   12 Stage 8 tool names with today's equivalent or none. Four names the renderings use are
   replaced as whole tokens: `file_search` → `search_project_files`, `fetch_url` → `web_fetch`,
   `run_code` → `bash_tool`, `create_artifact` → `create_file`. `load_skill` and
   `get_operation_status` have no exact equivalent: their text stays, and `<capabilities_state>`
   says `skill_loader="off"` (Stage 6 CP-1). Prompt 6 renames the tools; the map then becomes the
   identity and the files equal the code blocks.
3. **Appendix (transitional, ours).** `backend/prompts/system/v3/appendix-product-tools.md` carries,
   from the old builder, the usage paragraphs of tools that have no stage equivalent: uploaded
   files, project files, the sandbox computer (skills, locations, presenting files, artifacts
   mechanics), visuals and display cards, memory file format and edit tools, past-chat tools.
   Each section is sent only when its tools are declared. Where a paragraph contradicted v3, v3
   won and the text was cut (five cuts, listed in the result doc). It has its own size budget
   and is deleted by Prompt 6. Also carried (review round 1): the legacy compaction policy, which
   is what explains `<earlier_conversation_summary>` (its "make reasonable assumptions" clause cut
   in round 2: v3 honesty); and two lines of our own for the transition — that a SKILL.md read
   with `view` is the skill body (there is no `load_skill`), and that ArcNave's `memory_write` /
   `memory_delete` replace / delete a whole file (forget one fact = remove its line with
   `memory_str_replace`). A third line (which flag covers which declared tool) was removed in
   round 2: it was sent on every turn and named tools the turn had not declared.
4. **Layout.** Stable text = v3 base + `<available_skills>` + appendix; identical per provider,
   tool set and skill list. Session state = `<model_info>`, `<capabilities_state>`, `<profile>`,
   `<memory_snapshot>` (memory on), `<project_instructions>`, then ours: `<user_instructions>`,
   `<style_instructions>`, `<project_knowledge>`, `<skills_read_earlier>`. Per turn =
   `<current_time>` (IST) and `<earlier_conversation_summary>`, then the legacy mode line and the
   phone line (ours). **Claude:** system = stable text (one cache breakpoint, as before) + session
   state; the per-turn state starts the user turn (no `clear_at` beta). **Gemini:** system
   instruction = stable text only (no user, memory or date text, so an explicit cache can hold it);
   session and per-turn state are the leading part of the user turn. The breakpoint count is
   unchanged (OQ-27). The Gemini explicit cache itself is not built in this repo.
5. **Escaping.** Every `<` in user, file, project, memory and summary text placed in a tag becomes
   `&lt;`; attribute values also escape `"` and `&`; file names keep `nameForModel`. The base
   prompt is not escaped. The user's message, the history, file text (extracted text, decoded
   text files, PDF page text) and the tool output a forced answer carries in
   `<this_turn_tool_steps>` keep their text except the request's own block names, which are
   neutralised (`backend/src/services/prompt/reservedTags.ts`: `<capabilities_state`,
   `<current_time`, `<project_instructions` …, plus fullwidth / small-form / angle-quote `<` and
   spaces or invisible characters around an optional `/`; linear), so pasted, uploaded or fetched
   text cannot forge a block that sits in the same turn (Gemini). File text inside Gemini's own
   `<document>` wrapper also has `<document` / `</document` neutralised, in any case, so it cannot
   close the wrapper and speak as the user. The list holds only distinctive names and matches case-sensitively, as the
   blocks are rendered, so code (`Promise<Document>`, a Maven `<profile>`) is never changed; the
   stage's generic `<profile>` is therefore not on it.
   **Deviation (ours):** the spec says "all user text escaped"; escaping every `<` of a message
   would also change the code users paste and the code the model writes back.
6. **Knowledge cutoff.** Claude Sonnet 5.5 and Opus 5.5: `2026-06`, from
   https://platform.claude.com/docs/en/about-claude/models/overview ("Reliable knowledge cutoff:
   Jun 2026", read 2026-10-16). Gemini 3.8 Flash: the Google model pages could not be reached from
   the build environment; the attribute is left out rather than guessed (DEFERRED).
7. **Version.** `promptVersion` = first 12 hex of SHA-256 of the provider's base file and the
   appendix file; stamped on every turn (`turn timing` log line and the turn log), as a hash only
   (Stage 17 NO_CONTENT).
8. **The legacy builder is deleted**: `services/systemPrompt.ts`, `memory/policy.ts`,
   `compaction/policy.ts`, `ui/policy.ts`, and two owner scripts that were already marked stale.
   Rollback is the previous Cloud Run revision.
9. **Math (ST-4).** The frontend renders `\( … \)` and `\[ … \]` (a linear-time normaliser before
   remark-math; code spans and fences untouched).

## Recorded differences

- `<current_time>` is IST for every user (Stage 6 TI-1, "the current date and time in India"); the
  legacy date line used the user's Settings time zone. Deliberate (stage decision); a non-IST user
  sees IST.
- `promptVersion` hashes the prompt files, not the assembly code: a change to the escaping or the
  block order in `sessionState.ts` / `promptAssembly.ts` does not change it (the stage defines the
  version on the file).

## Gap

- Dormant rules (in the prompt, feature not built): typed citations `[file:n]`/`[web:n]` (P15/P16),
  `<pending_operations>` and the status tool (P08/P13), `<retrieval_status>` and typed
  `<documents>` (P20), `<company_instructions>` (Phase 5), sensitive memory opt-in.
- v3 LM-1 says the model cannot see other chats, while the past-chat tools exist when the user
  turned them on: owner decision (result doc).
- The Gemini rendering names "Google Search grounding": text sent only to Gemini, a provider name
  where the code talks to that provider (Invariant 7 allows it); flagged for the owner.
- `<memory_snapshot>` is capped in characters (`MEMORY_CONTEXT_MAX_CHARS`), not at N-17's 1.5k
  tokens: no estimator (Invariant 3).

## Fix

Prompt 6 renames the tools (map → identity, appendix deleted); P08/P13/P15/P16/P20 bring the
dormant features; the owner-run `eval:prompt` measures the change against the P03 baseline.
