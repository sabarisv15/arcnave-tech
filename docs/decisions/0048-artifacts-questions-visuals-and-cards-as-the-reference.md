# ADR-0048: Artifacts, questions, visuals and display cards work as the reference's do

- Status: accepted by the owner on 2026-09-27 ("artifact ask user input show widget ellam claude
  mariye paniru extra work vendam, display cards paniru… mathathu vendam"). Tested locally; not
  deployed.
- Date: 2026-09-27
- Amends: [ADR-0034](0034-turn-ending-options-tool.md) (the question card),
  [ADR-0035](0035-sandboxed-visuals-and-interactive-artifacts.md) and
  [ADR-0036](0036-sandboxed-visuals-inherit-arcnave-theme.md) (render_ui becomes show_widget and
  read_me), [ADR-0037](0037-visuals-drawn-while-written.md) (drafts come from show_widget),
  [ADR-0047](0047-tools-and-skills-match-the-reference.md) (the tool list).

## Reference

Checked on 2026-09-27 against the claude.ai app prompts for Fable 5.1, Opus 5.5 and Sonnet 5
(`tools/Anthropic/claude-fable-5.1.md`; github.com/asgeirtj/system_prompts_leaks, Anthropic/,
including `visualize.md`, the read_me text) and the Claude help centre.

- **Artifacts** have no tool of their own: "An artifact is a file written with create_file". A file
  in the outputs folder with extension .md, .html, .jsx, .mermaid, .svg or .pdf renders in the
  interface; it reaches the person through present_files. React: default export, Tailwind core
  utilities, a fixed list of libraries. No browser storage. The separate `Artifact` tool publishes
  hosted pages, which ArcNave does not have.
- **ask_user_input_v0**: `questions`, 1 to 3, each `question`, 2 to 4 string `options`, `type`
  single_select, multi_select or rank_priorities. The turn ends; the choice is the next message.
- **Visualizer**: `show_widget` {`loading_messages`, `title` (snake_case), `widget_code` (SVG or
  HTML)} and `read_me` {`modules`: diagram, mockup, interactive, data_viz, art, chart,
  elicitation; `platform`}. read_me is called first and silently. A routing checklist decides
  between no visual, a connected tool, a file and the Visualizer.
- **Display cards**, one tool each: chart_display_v0, comparison_card_display_v0,
  featured_card_display_v0, itinerary_display_v0, link_preview_display_v0, message_compose_v1,
  options_card_display_v0, places_list_display_v0, product_carousel_display_v0, quiz_display_v0,
  recipe_display_v0, step_card_display_v0, translation_display_v0. Product and place cards get
  their photos added by the app.

## Decision

1. `create_artifact`, `read_artifact` and `update_artifact` are removed. The system prompt's
   computer section says what an artifact is, when to make one (the reference's criteria) and the
   rules per type. A presented file of those six types opens in the side panel as soon as the
   `tool_result` event carries it (the event now lists the presented files, without storage
   keys); the panel has Preview and Code. HTML and SVG run in the script-only sandbox; React is
   compiled in the sandbox (Babel, the libraries as UMD builds from cdn.jsdelivr.net, Tailwind's
   browser build), which needs `'unsafe-eval'` in that frame's CSP and only there. Artifacts saved
   before keep rendering and can still be edited and shared; "Save as artifact" on a visual stays.
2. `ask_user_options` is replaced by `ask_user_input_v0` with the reference's schema. The card
   asks the questions one at a time and sends the answers as one message (each under its
   question when there are several). An older reply's ask_user_options still shows.
3. `render_ui` is replaced by `show_widget` and `read_me`. show_widget's code becomes one visual
   block through the same validator, sandbox and stored result (size only) as before. read_me
   returns ArcNave's own design rules (`services/ui/visualizeGuide.ts`), written against the
   sandbox's tokens and CSP. The visuals policy is the reference's checklist in ArcNave's words.
   The other render_ui block types are no longer offered to the model; the client still draws
   them in old replies.
4. The 13 display cards are declared whenever generative UI is on. Each is checked on the server
   (the schema, plus what the schema cannot say: a quiz's answer is one of its options, a
   recipe's `{id}` is an ingredient, links are http(s)) and streamed as a `display` block keyed
   `display_<toolCallId>`, so a reload and a public share rebuild it from the stored call.
   Product and place photos come from the configured image search, by name; without one the
   card has no photos.

## Where ArcNave differs, and why

- **sendPrompt fills the message box instead of sending.** A visual's script is untrusted and
  never sends in the person's name (ADR-0035, decision 4). The descriptions say so.
- **`places_map_display_v0` is not built.** It takes place ids from `places_search` (Google
  Places) and draws a map with routes; ArcNave has neither, and the owner said not to add
  weather, places or sports data.
- **React libraries:** shadcn/ui is not offered (it is not a UMD library); the rest are.
- **Not built, as before:** `end_conversation`, `web_search_fast`, `weather_fetch`,
  `places_search`, `fetch_sports_data`, `suggest_research`, and the connector, plugin and skill
  catalogue tools.

## Consequences

- The tool names are the reference's; tests that named the old ones were changed, and live
  scripts that only exercised removed tools (`runLiveGenerativeUIEvaluation`,
  `runLiveAnalyticsEvaluation`, `runExportE2E`) were deleted. `services/analytics/profiler.ts`
  and `quality.ts` now have no caller but their own tests.
- `ARTIFACT_MAX_CONTENT_BYTES` is gone with the tool that read it.
- A React artifact needs cdn.jsdelivr.net reachable from the person's browser.

## Audit of prompt, tools and skills (same day)

The whole prompt a turn gets with every flag on was read against every declared tool and skill.
Fixed:

- **Two web searches, one of them fake.** With the model's own search on, `web_search` was
  declared too: beside Anthropic's server tool of the same name that is a 400 ("Tool names must
  be unique"), and on Gemini it was a second search. Without a live provider it answered with a
  placeholder link to a Google results page. Now the router declares one search: the built-in
  one when it is on, `web_search` only with a live provider otherwise; `image_search` only with
  a live provider. The web guidance names only what is declared, and says that the built-in
  search's results are not links web_fetch can open.
- **Narration.** "Before your first tool call, say what you are about to do" (Opus 5 prompting
  guide) now excepts memory reads, read_me and the choice of a card or visual, as the app prompt
  does; after the last call the reply states the answer (the app prompt's
  `reply_after_tool_calls`).
- **Memory.** Saves are not announced (the chat shows the step) and what is known is not
  attributed to memory, as the app prompt says; a failed save the user asked for is still said.
- **Files.** A presented Markdown, HTML, React, Mermaid, SVG or PDF file opens beside the chat:
  the prompt and `present_files` say so. Code goes in a file past about 20 lines, the artifact
  threshold (the reference says 10 in one place and 20 in another). An artifact from an earlier
  turn is in read-only input/, so it is copied to output/ before it is edited.
- **Skills.** frontend-design no longer names render_ui and says read_me's rules come first for
  an inline visual; xlsx names chart_display_v0 and show_widget for a chart in chat.
  `skillContent.test.ts` fails if a skill names any removed tool.

Left as is: on the local process engine the computer says each call starts empty, though files
do last through a turn there; production runs the warm engine, whose wording is right.
