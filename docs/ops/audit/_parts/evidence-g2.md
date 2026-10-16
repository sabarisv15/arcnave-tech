# Evidence pack G2 (Stages 6-9): names and shapes only

Repo = `D:\arcnave-tech` (branch audit/stage-1-21). Paths relative to it. `*` = required parameter.
`.env.example` could not be read (permission denied for the auditor); defaults below come from
`backend/src/config.ts` and `backend/src/config/numbers.ts`, which `.env` overrides.

## (a) Tool registry

How a turn's tool set is built: `routeTurn()` (`backend/src/services/routing/turnRouter.ts:39-67`) returns
`allowedTools` from flags only; `ProjectToolRegistry.getAvailableTools()` (`backend/src/tools/registry.ts:50-63`)
returns definitions; `generation.ts:569-591` intersects the two. Master gate `ENABLE_TOOL_USE` default false
(`config.ts:199`); with it off `getAvailableTools` returns `[]` (`registry.ts:51`). Every allowed tool is declared on
every turn (no discovery step, `registry.ts:1-6`). The same definitions go to both providers; there is no per-provider
tool rendering except the web-search rows and the schema carrier (see "Provider differences").

| Tool (file:line) | Params (type, `*` required) | Caps / timeouts in code | Offered when |
|---|---|---|---|
| `ask_user_input_v0` (`tools/definitions.ts:521-569`) | `questions`* array 1-3 of {`question`* string, `options`* string[2-4], `type` enum single_select / multi_select / rank_priorities} | terminal tool: ends the round loop (`providers/toolLoopPolicy.ts:22-30`) | always when tool use is on (`registry.ts:52`, `turnRouter.ts:40`) |
| `memory_list` (`definitions.ts:273-287`) | `path_prefix`, `include_preview` bool, `cursor` | - | memory on = `ENABLE_MEMORY` && user `memoryEnabled` (`generation.ts:566`; `registry.ts:53`) |
| `memory_read` (`definitions.ts:289-308`) | `path`* = anyOf(string, string[1-20]) (a union) | - | same |
| `memory_write` (`definitions.ts:310-328`) | `path`*, `content`* (minLength 1), `if_version`* | file cap 16 KiB (`services/memory/memoryService.ts:25`) | same |
| `memory_append` (`definitions.ts:330-346`) | `path`*, `content`*, `if_version`* | same cap | same |
| `memory_str_replace` (`definitions.ts:348-366`) | `path`*, `old_str`*, `new_str`*, `if_version`* | same cap | same |
| `memory_delete` (`definitions.ts:368-383`) | `path`*, `if_version`* | - | same |
| `conversation_search` (`definitions.ts:396-412`) | `query`*, `max_results` int 1-10, `within_conversation_id` | max 10 | past-chat search on = `ENABLE_MEMORY` && user `chatSearchEnabled` (`generation.ts:567`; `registry.ts:54`) |
| `read_conversation` (`definitions.ts:414-428`) | `conversation_id`*, `page_token`, `max_turns` int 1-50 | max 50 turns | same |
| `recent_chats` (`definitions.ts:430-444`) | `n` int 1-20, `before`, `after` | max 20 | same |
| `read_me` (`definitions.ts:450-472`) | `modules` enum[] (diagram, mockup, interactive, data_viz, art, chart, elicitation), `platform` enum | - | `ENABLE_GENERATIVE_UI` default true (`config.ts:321`; `registry.ts:55`) |
| `show_widget` (`definitions.ts:474-515`) | `loading_messages`* string[1-4], `title`*, `widget_code`* | response cap `UI_MAX_RESPONSE_BYTES` 100,000 (`config.ts:323`) | same |
| 13 display tools (`tools/displayDefinitions.ts`): `chart_display_v0` :32 (`style`*, `series`*), `comparison_card_display_v0` :110 (`products`*, `summary`*), `featured_card_display_v0` :159 (`products`* 1, `summary`*), `product_carousel_display_v0` :181 (`products`* 1-6, `summary`*), `itinerary_display_v0` :203 (`days`*, `summary`*), `link_preview_display_v0` :253 (`links`*, `summary`*), `message_compose_v1` :289 (`kind`*, `variants`*), `options_card_display_v0` :331 (`options`*, `summary`*), `places_list_display_v0` :373 (`places`*, `summary`*), `quiz_display_v0` :413 (`questions`*, `summary`*, `title`*), `recipe_display_v0` :481 (`ingredients`*, `steps`*, `title`*), `step_card_display_v0` :536 (`steps`*, `summary`*), `translation_display_v0` :576 (`source_language`*, `source_text`*, `summary`*, `target_lang`*, `target_language`*, `translation`*); list at :600-616 | see file | - | same gate as `show_widget` |
| `web_search` (`definitions.ts:185-198`) | `query`* | - (no per-turn cap found) | `ENABLE_WEB` (default false, `config.ts:181`) && live provider (SerpAPI or Google CSE, `services/webSearch.ts:165`) && the model's own search is NOT on (`turnRouter.ts:44-50`) |
| `web_fetch` (`definitions.ts:200-216`; grounded variant :243-250) | `url`* | 10 s, 1 MB raw, 10,000 chars (`services/webFetch.ts:41-47`); URL must already appear in the conversation (`tools/webExecutor.ts:76-87`) | `ENABLE_WEB` |
| `image_search` (`definitions.ts:218-236`) | `query`*, `max_results` int 3-4 | max 4 | `ENABLE_WEB` && live provider |
| `bash_tool` (`definitions.ts:83-102`) | `command`*, `description`* | stdout 64 KiB (`config.ts:273`), read-back 30,000 chars (`config.ts:280`), warm timeout 300 s (`config.ts:251`), Job timeout 10 s (`config.ts:266`), orchestration 45 s (`config.ts:270`), global concurrency 20 (`config.ts:285`); sandbox server: 3 GiB per run, 2 concurrent runs, 15 min max, 50 output files (`backend/sandbox/server.py:66-77`) | `ENABLE_RUN_PYTHON` && sandbox client && turn allows code (`generation.ts:561,587`; `registry.ts:58-60`) |
| `view` (`definitions.ts:104-125`) | `description`*, `path`*, `view_range` int[2] | text cut at 16,000 chars, range 60,000 (`tools/codeExecutionExecutor.ts:59-61`), images <= 4 per call, <= 5 MB (:49-50) | same |
| `create_file` (`definitions.ts:127-140`) | `description`*, `path`*, `file_text`* | - | same |
| `str_replace` (`definitions.ts:142-156`) | `path`*, `description`*, `old_str`*, `new_str` | - | same |
| `present_files` (`definitions.ts:158-177`) | `filepaths`* string[>=1] | - | same |
| `search_project_files` (`definitions.ts:11-34`) | `query`*, `limit` int | limit 1-10, default 5 (`tools/executor.ts:31-34,82`) | the chat belongs to a project (`registry.ts:61`; `turnRouter.ts:59-62`) |
| `read_project_file` (`definitions.ts:36-64`) | `fileId`*, `cursor` int, `maxChars` int | hard cap 6,000 chars (`config/numbers.ts:45`; `executor.ts:123`) | same |
| Claude native search `web_search_20260209` (`providers/anthropic.ts:38`) | server tool, `max_uses: 5` fixed | 5 per request | Claude turn with `grounded` = search available && (mode != chat or `ENABLE_WEB`) (`generation.ts:498-499`) and `ENABLE_ANTHROPIC_WEB_SEARCH` (`anthropic.ts:390-392`; `config.ts:180`) |
| Gemini native search `googleSearch` (`providers/gemini.ts:425`) | server tool | - | Gemini turn, `grounded` and `ENABLE_GOOGLE_SEARCH_GROUNDING` (`gemini.ts:291`; `config.ts:179`); sent in the same `tools` array as the function declarations |
| Gemini `codeExecution` (`gemini.ts:426`) | server tool | - | `ENABLE_GEMINI_CODE_EXECUTION` (`config.ts:191`) and request flag |

Count of function tools declared at most: 1 + 6 + 3 + 2 + 13 + 3 + 5 + 2 = 35 (plus up to 3 native/server tools).
Spec TD-1c lists 12 (file_search, read_file, web_search, fetch_url, run_code, memory_write, memory_delete,
memory_read, create_artifact, update_artifact, load_skill, get_operation_status).

Loop and per-turn limits found:
- Rounds: `TOOL_MAX_ROUNDS` 16 (`config/numbers.ts:43`; `config.ts:206`); `resolveMaxRounds` / `isLastRound` (`providers/toolLoopPolicy.ts:11-18`). On the last round function calling is switched off: Claude `tool_choice: none` (`anthropic.ts:470-479`), Gemini `FunctionCallingConfigMode.NONE` (`gemini.ts:404-437`); finish reason `tool_limit` (`gemini.ts:532`).
- Time: turn deadline 3,540,000 ms (`numbers.ts:39`); one provider request 600,000 ms (`numbers.ts:35`); retries <= 2 before the first token, 1 s base, 8 s cap, Retry-After <= 10 s (`numbers.ts:23-29`; `generation.ts:1367`).
- Output: default max output 64,000 tokens (`numbers.ts:41`); ceiling 128,000 (`config.ts:157`); per-model ceiling from `providers/capabilitiesTable.ts` (Gemini 65,536; Claude 128,000).
- Tool calls of one response run in order, one after the other (ADR-0026, `docs/decisions/0026-parallel-tool-calls.md`).
- Old tool results cleared client-side past 100,000 prompt tokens, keep 3, batch 5 (`config.ts:159-161`; `providers/contextEditing.ts`); skill views are never cleared (`contextEditing.ts:33-36`).
- Per-tier caps (search 1/3/8, run_code 1/3/8, fetch 2/5/10, artifacts 3/5/10, file_search 1/3/6): **not found** (searched: `Fast|Normal|Deep|max_uses|LIMIT_REACHED|perTurn` in `backend/src`, non-test). No `profile` concept exists (only a per-user `effort` and `routingPreference`, `generation.ts:685-687`).
- Result envelope `{status, summary, data, truncated, next_cursor, full_output_file}` and the 11 error codes: **not found**; tools return text or `json` content blocks with `ok` true/false (`tools/executor.ts:43-49`; `webExecutor.ts:31-37`).

Provider differences:
- Claude: `toAnthropicTool` copies the schema as is, no `strict: true` (`anthropic.ts:60-66`); `tool_choice` auto or none (`anthropic.ts:478-479`); `thinking: {type: adaptive, display: summarized}` (`anthropic.ts:488`); `output_config.effort` (`anthropic.ts:490`); `maxRetries: 0` (`anthropic.ts:51`).
- Gemini: `functionDeclarations` with `parametersJsonSchema` (`gemini.ts:89-95,428`); no `VALIDATED` mode (only NONE on the last round, `gemini.ts:433-437`); `thinkingConfig {includeThoughts: true, thinkingLevel}` (`gemini.ts:440-443`).
- Schemas use `minimum`, `maximum`, `minItems`, `maxItems`, `minLength` and one `anyOf` (`definitions.ts:231,406,423,438`; `anyOf` at :298), which TS-2 forbids.

## (b) Prompt files and assembly order

There is no `prompts/` folder in the repo; prompt text is TypeScript. One prompt serves all three models (no per-provider
rendering, no rule ids). Files: `backend/src/services/systemPrompt.ts` (base + guidance), `services/memory/policy.ts` (memory and
past-chat policy), `services/compaction/policy.ts` (compaction policy), `services/ui/policy.ts:6` (visuals policy),
`services/ui/visualizeGuide.ts` (`read_me` content), `services/styles.ts:24-52` (4 style presets), `services/promptCache/promptAssembly.ts`
(assembler), `services/generation.ts:1918-2049` (`buildSystemInstruction`).

System prompt, in order (`promptAssembly.ts:26-132`; joined with a blank line):
1. Stable prefix (`buildStablePrefix`, :26-55): (1) `buildStaticBasePrompt(readMeDeclared)` = 16 blocks: role line, `<core_behavior>`, `<truthfulness>`, `<communication>` (language / Tanglish paragraph at `systemPrompt.ts:63-65`), `<trust_boundaries>`, `<safety>`, `<wellbeing>`, `<evenhandedness>`, `<tool_use>`, `<professional_deliverables>`, `<source_transformation>`, `<agent_behavior>`, `<mistakes>`, `<knowledge>`, `<user_preferences>` (rules for applying saved preferences), `<permissions_and_actions>`, `<final_response>` (`systemPrompt.ts:24-166`); (2) `STATIC_MEMORY_POLICY_V1` if `memory_read` allowed (`memory/policy.ts:11`); (3) `STATIC_PAST_CHATS_POLICY_V1` if `conversation_search` allowed (`policy.ts:73`); (4) `STATIC_COMPACTION_POLICY_V1` always; (5) `GENERATIVE_UI_POLICY_V1` if `show_widget` declared.
2. Dynamic suffix (:79-125), each part only when non-empty: (1) date line, date only, user time zone, no clock time (`systemPrompt.ts:277-295`) plus a mobile line (:268); (2) `<arcNave_capabilities>` listing declared tools, then `<computer_use>` (Skills, The computer, Creating files, Artifacts) if code is on, `<files>` (uploaded-files + project-files guidance), research + `<web>` guidance if web is on (`systemPrompt.ts:368-450`); (3) `<standing_preferences>` (user instructions, `prefs.instructions`); (4) `<project_instructions>`; (5) `<style_instructions>`; (6) `<memory>` = `<memory_listing>`, `<profile>`, `<preferences>` (`memoryService.ts:446-464`, each cut to `MEMORY_CONTEXT_MAX_CHARS` 8,000); (7) `<conversation_compaction>` (latest compaction summary, `compactionService.ts:66-80`); (8) project knowledge: all files whole while <= 200,000 chars (`config.ts:171`), else a pointer + file names, or keyword excerpts when no tools (`generation.ts:1954-2011`); (9) `<active_goal>` (never set); (10) mode directive for search / research (`generation.ts:2014-2021`); (11) `<skills_guidance>` = `<available_skills>` list (name, description, location) + skills re-injected after a compaction, each cut at 20,000 chars (`generation.ts:604-648`; :332).
3. Provider carrier: Claude `system` = [stable prefix with `cache_control: ephemeral`, dynamic text] (`anthropic.ts:441-464`); Gemini one `systemInstruction` string, no explicit context cache (`gemini.ts:420`; no `cachedContents` call anywhere). Order, language and the whole system text are identical for both.

Messages, in order: history = every turn after the last compaction `through_seq`, newest kept while <= (model window - 12,288) x 4 characters, no 6-turn window, no profile budget (`generation.ts:1560-1577`); each history turn = attachments first then text, earlier tool calls replayed as tool_use / tool_result pairs or functionCall / functionResponse (`anthropic.ts:313-338`; `gemini.ts:187-209`); current user turn = attachment blocks (PDF as per-page label + image + text; text files as `document` blocks), then ONE text = attachment manifest + user prompt (`generation.ts:829-832`; `anthropic.ts:340-345`; `gemini.ts:211`). Claude: cache breakpoint on the second-last message (`anthropic.ts:369-376`). Blocks named in the spec and **not found** anywhere: `<model_info>`, `<capabilities_state>`, `<profile>`, `<current_time>` (IST, per turn), `<pending_operations>`, `<retrieval_status>`, `<documents>` with ids, `<memory_docs>`, `<company_instructions>`, `<earlier_conversation_summary>`, `[file:n]` / `[web:n]` ids. Escaping: only a closing tag of the wrapper's own name is neutralised (`promptAssembly.ts:63-66`); user text, history and file text are not escaped.

Other prompt-like text: compaction summarizer prompt and system line (`services/compaction/autoCompact.ts:28-33,203-206`); chat title = first 80 characters of the first user message (`routes/chats.ts:1167-1173`); style synthesizer (`routes/styles.ts:143-216`). No title prompt, no retrieval-rewrite prompt, no memory-extraction prompt.

Model parameters sent: Claude `max_tokens`, `thinking {adaptive, summarized}`, `output_config.effort` (`anthropic.ts:484-490`); Gemini `maxOutputTokens`, `thinkingConfig` (`gemini.ts:421,440`). `temperature`, `top_p`, `top_k`: **not found** in `backend/src` outside tests (grep). Effort: user pref or default `medium` (`config.ts:166`), ladder low-max clamped per model (`capabilitiesTable.ts:151-157`); Gemini maps low/medium/high, higher = HIGH (`gemini.ts:255-258`).

Prompt kit: `backend/src/test/promptKit/cases.ts` (89 derived cases, 43 critical, 21 live-only, `KIT_TARGET = 68` at :31) and `promptKit.test.ts`; header at `cases.ts:1-14` says the original 68-case file was not available. Original kit in the owner folder: `D:\Architecture\Stage-06-Context-Prompt-Assembly\06-eval-cases-v1.json` = 68 cases (the role brief says 87; the file has 68 `"gate"` entries: 32 C, 34 S, 2 O; 87 is the count of `"id"` strings including document ids).

Project and user instruction limits in code: project instructions <= 20,000 chars (`routes/projects.ts:181,266`), user instructions <= 20,000 (`routes/preferences.ts:87`), custom style <= 4,000 (`routes/styles.ts:119`). No company instructions.

## (c) Skills (`backend/skills/`)

Each folder holds only `SKILL.md` (no `references/`, `assets/templates/`, `scripts/`, `evals/`). Frontmatter keys used: name, version, description, category, scope, requires.tools, autoload, metadata.source (schema `services/skills.ts:41-66`; no `license`, no `compatibility`).

| Skill | Version | Size | Category | Needs tool | Purpose (frontmatter) |
|---|---|---|---|---|---|
| `docx` | 3.1.0 | 89 lines | artifact | bash_tool | read, edit or produce a Word file |
| `xlsx` | 4.0.2 | 72 | artifact | bash_tool | read, analyse or produce a spreadsheet |
| `pptx` | 3.0.0 | 57 | artifact | bash_tool | read, edit or produce a deck |
| `pdf` | 6.1.0 | 72 | artifact | bash_tool | produce, fill, merge, split, rotate a PDF |
| `pdf-reading` | 4.0.0 | 81 | analysis | bash_tool | read a PDF not in context |
| `file-reading` | 1.0.1 | 48 | analysis | bash_tool | read other uploaded files not in context |
| `frontend-design` | 1.1.0 | 59 | artifact | none | html / jsx page or component |
| `skill-creator` | 1.1.0 | 55 | meta | none | write or check SKILL.md files |

Spec SF-1 list: docx, xlsx, pptx, pdf, chart, web-page. `chart` and `web-page`: **not found** (searched `backend/skills/*`).

When loaded: `SkillService.listSkills(activeTools)` keeps skills whose required tools are active (`services/skills.ts:283-305`);
`generation.ts:610-626` lists them in `<available_skills>` only when the turn declares `view`; the model reads a skill by viewing
`/skills/<name>/SKILL.md` (path pattern `generation.ts:329`; `SKILLS_ROOT` from `tools/codeExecutionExecutor.ts`); there is no
`load_skill` tool. All have `autoload: false`. After a compaction, skills viewed in the summarised turns are re-injected in full up to
20,000 chars each (`generation.ts:627-646`). Skill folders are baked into the warm sandbox image at `/skills`
(`backend/sandbox/Dockerfile.service:37-39`). HTTP: `GET /skills` (`routes/skills.ts`).

Sandbox image (what skills run on): Python 3.12-slim, poppler, pandoc, LibreOffice (nogui), tesseract (eng, tam), fonts-dejavu-core,
fonts-noto-core (`backend/sandbox/Dockerfile.service:17-21`); pip: pandas numpy scipy matplotlib openpyxl xlrd xlsxwriter pdfplumber pypdf
**pymupdf** python-docx python-pptx pillow pytesseract opencv-python-headless tabulate chardet (`Dockerfile.service:25-32`). Single-use Job image
installs only pandas numpy matplotlib openpyxl (`backend/sandbox/Dockerfile:15`).
