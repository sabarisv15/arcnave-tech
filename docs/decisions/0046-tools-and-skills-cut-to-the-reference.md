# ADR-0046: Tools and skills are cut to what the reference assistant has

- Status: accepted by the owner on 2026-09-27 ("claude kita evlo tools and skills iruko atha
  matum vechuklam… nama convienient ku create pana elathaum drop"). Tested locally; not deployed.
- Date: 2026-09-27
- Amends: [ADR-0006](0006-turn-router-policy-boundary.md) and
  [ADR-0022](0022-requests-carry-what-the-conversation-did.md) (the tools declared every turn),
  [ADR-0032](0032-one-loop-model-reads-the-request.md) (the AgentLoop path),
  [ADR-0043](0043-contextual-chat-follow-ups-and-safe-answer-rendering.md) (follow-up tool),
  [ADR-0044](0044-pdf-reading-and-exact-figures.md) decision 3 (scanned-page routing).
- Amended by [ADR-0047](0047-tools-and-skills-match-the-reference.md): the plan left open here is done; artifact-design is replaced by frontend-design.
- Amended by [ADR-0049](0049-prompt-and-skills-line-by-line-with-the-reference.md): pages in view are read from the view, with no standing check in code.

This is the clean-up step only. The plan (bash / view / create_file / str_replace in place of
run_python, file-reading skill, the prompt's order of seeing, then skills, then code) comes next
in its own ADR.

## Context

ArcNave had 42 tools and 13 skills. Many were added over earlier fixes and have no equivalent
in the reference assistant. The same work was described three ways: the system prompt said
load a skill before reading a file, the pdf-reading skill said call `extract_scanned_table_rows`,
and that tool said "call it first". A 12-page scanned statement took the tool path (page by page
vision calls, rechecks) and ran over 10 minutes, while the reference read the same pages it
already had in view, in about 4 minutes, with exact totals.

Reference, checked against sources on 2026-09-27 (captured app prompts for Opus 5.5, Sonnet 5
and Fable 5.1 in `tools/Anthropic/` and github.com/asgeirtj/system_prompts_leaks; the Agent
Skills docs; github.com/anthropics/skills):

- Tools: a code machine (`bash_tool`, `view`, `create_file`, `str_replace`, `present_files`),
  web search and fetch, memory, past-chat search, artifacts, visual widgets, a question card,
  tool search. No per-format file tools, no table extractor, no deliverable builder, no goal
  tools, no follow-up tool, no image generator.
- Skills: docx, pdf, pptx, xlsx, pdf-reading, file-reading, frontend-design, skill-creator
  (plus product-specific ones). Its pdf-reading and file-reading apply when the file content is
  *not* already in context.

## Decision

1. Removed tools (21): `extract_scanned_table_rows`, `analyze_table_rows`,
   `generate_deliverable`, `read_uploaded_file`, `inspectPdf`, `mergePdfFiles`, `splitPdfFile`,
   `inspectSpreadsheet`, `editSpreadsheetCells`, `combineWorkbooks`, `inspectDocxStructure`,
   `editDocxContent`, `appendDocxSection`, `inspectPptxStructure`, `reorderPptxSlides`,
   `editPptxSlideText`, `get_goal`, `update_goal`, `get_context_remaining`,
   `suggest_next_actions`, `generate_image`. Their executors, services and tests go with them.
2. Removed features, confirmed by the owner: the AgentLoop path of Research mode (goal
   bookkeeping; `ENABLE_AGENT_LOOP` was off in every deployment), image generation, and
   follow-up chips. Research mode itself (grounded search) stays. The `goals` tables stay in the
   schema; nothing writes them.
3. Removed skills (6): dashboard-design, data-analysis, data-quality, dataviz,
   python-sandbox-patterns, research-deep-dive. Kept: docx, pdf, pdf-reading, pptx, xlsx,
   skill-creator, and artifact-design (to be replaced by a frontend-design equivalent).
4. The kept file skills build and change files with `run_python` (the reference does it with
   code) and require only `run_python`. They are written in ArcNave's own words: the reference
   skills are source-available, not open source, so their text is not copied. They name only
   libraries the sandbox image has (`skillContent.test.ts` fails otherwise); `reportlab` and
   `qpdf` are not in it, so the pdf skill builds PDFs through python-docx and LibreOffice.
5. pdf-reading: scanned pages already in view (up to 100 pages) are read from the view in one
   pass, written to a file and checked in code; only the rows a check flags get a second look.
6. The system prompt says what is already in context (a PDF as text and page images, images,
   plain text) and to decide whether code is needed; other files are read with run_python.
   Files for the user, in any format, are built with run_python into `output/`.

## Consequences

- Without run_python a turn can no longer produce a downloadable file. Production runs the warm
  sandbox, so this holds there; a deployment without it must say it cannot make the file.
- Messages saved before keep rendering: the frontend still reads stored calls of the removed
  tools (file cards, tool labels, the composer hint).
- Scanned-table accuracy now rests on the model reading the page images plus the checks in
  code. With the active model (Gemini 3.8 Flash) this has not been measured live: the KVB +
  Federal statement (expected 48 / 277 / 325) must be run before deployment.
- Not done here: `bash`, `view`, `create_file`, `str_replace` tools; a file-reading skill;
  the attachment manifest's "load the skill before reading" note; trimming the trusted-CLI and
  skill-script runtime, which nothing ships a script for now.
