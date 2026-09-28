# ADR-0047: Tools and skills match the reference, one for one

- Status: accepted by the owner on 2026-09-27 ("rule onne onu than claude la irukrathu nama kita
  iruntha pothum… vera mari irukratha claude mari maathu… missing ah claude mari build paniru").
  Tested locally; not deployed.
- Date: 2026-09-27
- Amends: [ADR-0006](0006-turn-router-policy-boundary.md) and
  [ADR-0022](0022-requests-carry-what-the-conversation-did.md) (no discovery step: every allowed
  tool is declared), [ADR-0010](0010-warm-sandbox-service.md) (run_python becomes the computer's
  five tools), [ADR-0025](0025-memory-by-topic-as-claude.md) (memory is files), [ADR-0027](0027-compaction-as-the-window-fills.md)
  (a skill read with view comes back after compaction), [ADR-0044](0044-pdf-reading-and-exact-figures.md)
  (skill order), [ADR-0046](0046-tools-and-skills-cut-to-the-reference.md) (the plan it left open).
- Amended by [ADR-0048](0048-artifacts-questions-visuals-and-cards-as-the-reference.md): artifacts are files, the question card is ask_user_input_v0, render_ui is show_widget and read_me, and 13 display cards are added.
- Amended by [ADR-0049](0049-prompt-and-skills-line-by-line-with-the-reference.md): the skill mapping is the reference's, naming no reading skill.

## Reference

Checked on 2026-09-27 against the claude.ai app prompts for Opus 5.5, Sonnet 5 and Fable 5.1
(`tools/Anthropic/claude-fable-5.1.md`; github.com/asgeirtj/system_prompts_leaks, Anthropic/),
the Agent Skills overview (platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
and the chat search and memory help article (support.claude.com/en/articles/11817273).

- **The computer:** `bash_tool`, `view`, `create_file`, `str_replace`, `present_files`. Uploads
  are on disk read-only; scratch work is in the working directory; final files go to an outputs
  directory and reach the user only through `present_files`.
- **Skills:** listed in `<available_skills>` with name, description and location. There is no
  skill tool: the model `view`s SKILL.md. "Before creating any file, writing any code, or running
  any bash command, first view the relevant SKILL.md files." Files already in context (PDF text
  and pages, images, text) are seen directly: "decide whether computer access is actually needed".
- **Web:** `web_search` {query}, `web_fetch` {url} (only URLs already in the conversation),
  `image_search` {query, max_results 3–5}.
- **Memory (Opus 5.5, Fable 5.1):** `memory_list`, `memory_read`, `memory_write`, `memory_append`,
  `memory_str_replace`, `memory_delete`, over Markdown files with frontmatter; every change
  passes the version last read. A `<memory_listing>` and `<profile>` start each conversation.
  Projects have their own memory.
- **Past chats:** `conversation_search`, `read_conversation`, `recent_chats`.
- **Tool search:** only for connector tools, which are deferred. Core tools are declared up front.

## Decision

1. `run_python` is replaced by `bash_tool`, `view`, `create_file`, `str_replace` and
   `present_files`. Each is a short Python program run on the configured sandbox engine (warm
   service, Cloud Run Job, local process), so `sandbox/server.py` is unchanged. `bash_tool`
   says whether files persist, per engine. `view` numbers lines and cuts past 16,000 characters
   inside the sandbox (the engine caps stdout at 256 KB), lists directories two levels deep, and
   shows images. `input/` and `/skills` are read-only to `create_file` and `str_replace`.
2. A file reaches the user only through `present_files`: it is copied into `output/`, touched so
   the engine returns it, structurally checked (a broken DOCX/XLSX/PPTX/PDF is refused with the
   reason), and stored. Nothing in `output/` is stored otherwise.
3. Skills are read with `view /skills/<name>/SKILL.md`, served by the skill service on every
   engine (the warm image also has them at /skills). `load_skill`, `read_skill`, `list_skills`,
   `search_skills` and `search_tools` are removed; every allowed tool is declared on every turn.
   The reference's `search_skills` searches an organisation's catalogue of skills to add;
   ArcNave has no such catalogue, so it has no equivalent.
4. The prompt follows the reference's order: what is in context is seen first; before any file,
   code or command, view every plausibly relevant SKILL.md; build in the working directory; put
   final files in `output/` and call `present_files`. The attachment manifest prints each file's
   path and names no skill (its "call load_skill before reading" note contradicted seeing first).
5. Skills now: docx, pdf, pptx, xlsx, pdf-reading, file-reading (new), frontend-design (new,
   replacing artifact-design), skill-creator. All in ArcNave's own words.
6. Memory is files: the six memory tools over `memory_items`, keyed by path, with a 12-character
   version token (sha256 of id and version). Migration 0022 moves topic names saved before to
   `/topics/<slug>.md`; a topic added in settings is stored the same way. Inside a project the
   store is the project's. The prompt carries `<memory_listing>`, `<profile>` and
   `<preferences>`.
7. `conversation_search`, `read_conversation` and `recent_chats` replace `search_chats`, in the
   same scope rule (a project's chats inside a project, the rest outside one).
8. `image_search` runs on the configured search provider (SerpAPI Google Images, or Google
   Custom Search with searchType=image); without one it says image search is not available
   (Invariant 1). Results render as a strip of thumbnails linked to their pages.
9. `web_fetch` refuses a URL that has not appeared in the conversation (the user's message, the
   history, or a result of this turn).

## Where ArcNave differs, and why

- **Tool names kept:** `create_artifact`/`read_artifact`/`update_artifact` (the reference's
  Artifact tool publishes hosted pages, which ArcNave's artifact panel is not), `render_ui`
  (the reference's `visualize:show_widget`), `ask_user_options` (`ask_user_input_v0`),
  `search_project_files`/`read_project_file` (project knowledge). Same job, ArcNave's product.
- **No background memory pass.** The reference files durable facts after each turn with a
  separate model pass; ArcNave asks the model to save durable facts during the turn. The old
  regex "distiller" (off everywhere) is removed.
- **Not built:** connector tools and their search, plugin and skill catalogues, consumer display
  widgets (weather, places, recipes), `end_conversation`, `product-self-knowledge` (it describes
  the reference's own products).
- **Removed as ours:** the visual QA pass (a vision model call on every output file) and the
  data-analytics policy block.

## Consequences

- Old messages keep rendering: the frontend still labels the removed tools.
- A skill that was read survives Gemini context editing (the call's `path` is under /skills).
- Scanned-PDF accuracy still rests on the model reading the page images; the KVB + Federal check
  (48 / 277 / 325) is still to be run live before deployment.
