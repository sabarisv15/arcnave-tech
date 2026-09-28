# ADR-0044: PDF reading is its own skill, and exact figures are computed

- Status: accepted. Tested locally (typecheck, full suite); not deployed.
- Date: 2026-09-27
- Amends: [ADR-0018](0018-skills-follow-claude.md) (one pdf skill for reading and building)
- See also: `mistakes.md` 2026-09-26 "Scaffolding built for a weaker model made a strong one
  over-work"
- Decision 3's scanned-page routing superseded by [ADR-0046](0046-tools-and-skills-cut-to-the-reference.md): pages in view are read from the view and checked in code; `extract_scanned_table_rows` is removed.
- Amended by [ADR-0047](0047-tools-and-skills-match-the-reference.md): the order "reading skill first, building skill once the material is in hand" is replaced by the reference's: see what is in context, then view every relevant SKILL.md before any code or file. The manifest no longer names a skill per file.
- Amended by [ADR-0049](0049-prompt-and-skills-line-by-line-with-the-reference.md): the exact-figure rule is removed, and pdf-reading takes the reference's scope (a PDF not in context); its records-file checklist is gone.

## Context

A live chat asked for total entries and credits with and without party names on the scanned
KVB + Federal statement. With run_python on, the pdf skill told the model to read scanned pages
"a few at a time", while `extract_scanned_table_rows`'s description told it to call that tool
first. The model followed the skill, used all 16 tool rounds, then stated 172 Federal entries
(the document has 277) and credit subtotals its own rows did not add up to.

ArcNave is its own product; the reference assistant it is compared against is a design input,
not something it names or imitates to users. Three gaps against that reference:

- The reference prompt has no verification section, but it has one sentence against
  estimating figures in prose: the data goes into files and is computed. ArcNave's prompt had
  neither.
- The reference reads a building skill after gathering the material, because a skill opened
  first pulls the work toward layout while there is nothing to put in it. ArcNave's prompt said
  load the skill first.
- The reference keeps building PDFs and reading PDFs as separate skills, with tables read by
  `pdfplumber` when there is a text layer. ArcNave had one skill.

## Decision

1. The static prompt carries one sentence against estimating figures in prose, scoped to exact
   figures from a file or data; summaries still need no computation. It names no tool, so it
   holds whatever the turn allows.
2. The skills section says: a skill that gathers or reads material is loaded before that work;
   a skill that builds a file is loaded once the material is in hand.
3. `pdf-reading` is a new skill with no required tools. It routes by page type: text layer →
   `pdfplumber`; scanned → `extract_scanned_table_rows` (found with `search_tools`), whether or
   not run_python is on. `pdf` keeps creating, changing and converting PDFs. The two table
   scripts stay under `skills/pdf/scripts/`, because the tools run them from there.
4. Files that ship at launch (`backend/src` outside tests and dev scripts, `backend/skills`,
   `backend/sandbox`, `arcnave-frontend/src`) never describe ArcNave as following or imitating
   another assistant ("as Claude does", "Claude-style", claude.ai limits). Provider names stay
   only where the code talks to that provider: the Anthropic adapter, its model ids and aliases,
   env vars, SDK packages and API facts. Skills and the static prompt name no model vendor at
   all. Reference material (`docs/`, `tools/`, tests, `backend/src/scripts/`) may. Guarded by
   `src/test/brandNeutral.test.ts`, `skillContent.test.ts` and `behaviorEvaluation.test.ts`.

Not done here: sending `.xlsx`/`.docx` to the model as files to read with code instead of
inline text. That changes the attachment pipeline and ADR-0004/0011 and needs its own decision.

## Consequences

- Turns asking for an exact figure do more tool work; summaries do not. The prompt stays inside
  the `behaviorEvaluation.test.ts` token budget.
- `skills.test.ts` fails if `pdf-reading` makes the scanned path depend on run_python being off.
- The live KVB + Federal check (`verifyPhase3KvbFederalLive.ts`) has not been run with this
  change. Expected: KVB 48, Federal 277 (244 + 33), combined 325.
