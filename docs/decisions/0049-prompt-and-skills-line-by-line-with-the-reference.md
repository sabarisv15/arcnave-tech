# ADR-0049: The prompt and skills, line by line with the reference

- Status: accepted by the owner on 2026-09-28 ("A + B fix pannu, rule-a Claude maadhiri
  eduthudu"). Tested locally; not deployed.
- Date: 2026-09-28
- Amends: [ADR-0044](0044-pdf-reading-and-exact-figures.md) (the exact-figure rule and the
  pdf-reading skill), [ADR-0046](0046-tools-and-skills-cut-to-the-reference.md) (pages in view
  checked in code), [ADR-0047](0047-tools-and-skills-match-the-reference.md) (the skill
  mapping), [ADR-0048](0048-artifacts-questions-visuals-and-cards-as-the-reference.md) (the
  preamble sentence its audit kept).
- Amended by [ADR-0051](0051-tool-limit-shown-and-in-view-pdfs-read-by-eye.md): pdf covers anything with a PDF, reading included, as the reference's does; the skill rule is repeated after `<files>` with examples; bash_tool names no library.

## Context

A live chat asked for the entry counts of a 12-page scanned KVB + Federal statement. The answer
was right (48, 277, 325), but the turn ran seven commands: a pypdf text-layer check, the
pdf-reading skill, pages re-rendered to PNG, tesseract counting dates, OpenCV counting table
lines, then sums. Every page was already in the request as an image, with a note that it had no
text layer (`providers/gemini.ts`, ADR-0013). The reply also came in Tamil script to a Tanglish
question.

The cause was ours, not the provider's. The prompt mapped "reading a PDF's content exactly" to
the pdf-reading skill and said an exact figure is computed with a tool; the skill's description
fired on any count or total, and its body said to check each page for a text layer in code
first.

The whole assembled prompt (every flag on), the 31 declared tools and the 8 skills were then
read against the reference: the claude.ai prompt for Opus 5.5 of 2026-09-22
(github.com/asgeirtj/system_prompts_leaks, `Anthropic/claude-opus-5.5.md`) and
github.com/anthropics/skills. The earlier audit (ADR-0048) had checked the prompt against the
tools, and not our own skills against the reference's.

## Reference

- **pdf-reading** (available_skills): "Use this skill when you need to read, inspect, or extract
  content from PDF files — especially when file content is NOT in your context and you need to
  read it from disk." The skill mapping in additional_skills_reminder names no reading skill.
- **notes_on_user_uploaded_files**: in-context files are seen natively; "Summarize this attached
  file → in-conversation → use provided content, do NOT use view". There is no rule that an exact
  figure is computed with a tool.
- **thinking_behavior**: "At the end of its thinking, Claude restates which language it should
  respond in"; an earlier answer is treated as done.
- **search_usage_guidelines**: "Don't explain or justify searching out loud; just search
  directly." No sentence asks for a preamble before the first tool call (that came from the
  Opus 5 API prompting guide).
- **lists_and_bullets**: minimum formatting; prose in conversation, reports and explanations.
- **file_creation_advice**: the reply is the default; four numbered cases for a file; an article
  or blog post is written in the reply with a one-line offer; a bare "report" is asked about.
- **read_me** `platform`: "Pass 'mobile' when your system prompt indicates a mobile client".
- **additional_skills_reminder**: "creating or filling PDFs → pdf".

## Decision

1. The exact-figure sentence is removed from `<tool_use>`. What is in context is read from
   context: "Reading, counting, transcribing or summarising what you can see needs no tool".
2. The skill mapping is the reference's: no reading skill is named; pdf-reading and
   file-reading are chosen by their descriptions, which apply to a file not in context.
3. pdf-reading (4.0.0) takes the reference's description and is rewritten as ours around it:
   inventory, text and tables, rendering pages and crops, images, attachments and form fields,
   strategy by document type. The text-layer check and the mandatory records-file checklist are
   gone. Snippets use `import pymupdf` (the `fitz` name now prints a deprecation warning) and
   were run against pypdf 6.19 and PyMuPDF 1.28.
4. pdf (6.1.0) gains form filling with pypdf, since the mapping sends "filling" there.
5. `<communication>` gains the reference's thinking_behavior and lists_and_bullets.
6. The preamble sentence is replaced by the reference's "do not explain or justify a search or a
   tool call out loud"; the rule against a bare "Done." after the last call stays.
7. "Creating files" is the reference's file_creation_advice, with its precedence over the
   artifact lists.
8. On a built-in-search turn, web_fetch is declared as `WEB_FETCH_WITH_BUILT_IN_SEARCH`, whose
   description says search results are not URLs it can open, as the prompt already did.
9. A request from a phone (`sec-ch-ua-mobile: ?1`, else a mobile user agent) adds "The user is on
   a mobile device…" to the date line, and "Pass platform "mobile" to read_me" when read_me is
   declared.

## Where ArcNave still differs

- **Code to a file:** the reference says more than 10 lines in file_creation_advice and 20 in
  artifact_usage_criteria, with the former winning; both are carried with that precedence.
- **Found and left for later** (the owner decides): xlsx has no LibreOffice recalculation or
  formula-choice rules; pptx has no design or QA section; frontend-design is a generic checklist
  where the reference's asks for a distinctive, planned design; docx has no tracked-change or
  comment helpers and the sandbox has no Node; memory is saved in the turn (ADR-0025) where the
  reference files after it in a background pass; the reference's safety sections (refusals,
  wellbeing, evenhandedness, copyright limits) and its one-question-per-reply and search-scaling
  rules are not in the prompt.

## Consequences

- A scanned PDF in view is answered from the page images, without a text-layer check in code.
  The model's reading of dense rows is no longer backed by a standing rule to extract them;
  a follow-up that doubts a figure can still ask for it.
- `behaviorEvaluation.test.ts` pins the absence of the exact-figure rule and the presence of the
  new sections; `skills.test.ts` pins the pdf-reading scope and form filling;
  `promptToolParity.integration.test.ts` pins the web_fetch variant and the mobile line.
