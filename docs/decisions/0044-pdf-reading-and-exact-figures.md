# ADR-0044: PDF reading is its own skill, and exact figures are computed

- Status: accepted. Tested locally (typecheck, full suite); not deployed.
- Date: 2026-09-27
- Amends: [ADR-0018](0018-skills-follow-claude.md) (one pdf skill for reading and building)
- See also: `mistakes.md` 2026-09-26 "Scaffolding built for a weaker model made a strong one
  over-work"

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
4. Model-facing text (prompt, skills, tool descriptions) names no other assistant or model
   family as what ArcNave is or follows. The skill-creator skill's "same as …" line was removed.

Not done here: sending `.xlsx`/`.docx` to the model as files to read with code instead of
inline text. That changes the attachment pipeline and ADR-0004/0011 and needs its own decision.

## Consequences

- Turns asking for an exact figure do more tool work; summaries do not. The prompt stays inside
  the `behaviorEvaluation.test.ts` token budget.
- `skills.test.ts` fails if `pdf-reading` makes the scanned path depend on run_python being off.
- The live KVB + Federal check (`verifyPhase3KvbFederalLive.ts`) has not been run with this
  change. Expected: KVB 48, Federal 277 (244 + 33), combined 325.
