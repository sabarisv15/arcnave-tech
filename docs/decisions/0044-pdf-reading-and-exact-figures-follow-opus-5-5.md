# ADR-0044: PDF reading and exact figures follow Claude Opus 5.5

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

Compared with Claude:

- Opus 5.5's claude.ai prompt has no verification section, but it has one sentence: Claude
  "doesn't … estimate figures in prose; it gets the data into files and computes." ArcNave's
  prompt had neither.
- Opus 5.5 reads a building skill after gathering the material: "Opened first, the skill's
  instructions pull the work toward layouts … and the result is a polished file with thin
  content." ArcNave's prompt said load the skill first.
- Claude keeps `pdf` (create, merge, split, fill) and `pdf-reading` (inventory, text
  extraction, rasterizing, tables; "Data-Heavy: use pdfplumber for tables") as separate skills.
  ArcNave had one.

## Decision

1. The static prompt carries the Opus 5.5 sentence, scoped to exact figures from a file or
   data; summaries still need no computation. It names no tool, so it holds whatever the turn
   allows.
2. The skills section says: a skill that gathers or reads material is loaded before that work;
   a skill that builds a file is loaded once the material is in hand.
3. `pdf-reading` is a new skill with no required tools. It routes by page type: text layer →
   `pdfplumber`; scanned → `extract_scanned_table_rows` (found with `search_tools`), whether or
   not run_python is on. `pdf` keeps creating, changing and converting PDFs. The two table
   scripts stay under `skills/pdf/scripts/`, because the tools run them from there.

Not done here: sending `.xlsx`/`.docx` to the model as files to read with code instead of
inline text, as Claude does. That changes the attachment pipeline and ADR-0004/0011 and needs
its own decision.

## Consequences

- Turns asking for an exact figure do more tool work; summaries do not. The prompt stays inside
  the `behaviorEvaluation.test.ts` token budget.
- `skills.test.ts` fails if `pdf-reading` makes the scanned path depend on run_python being off.
- The live KVB + Federal check (`verifyPhase3KvbFederalLive.ts`) has not been run with this
  change. Expected: KVB 48, Federal 277 (244 + 33), combined 325.
