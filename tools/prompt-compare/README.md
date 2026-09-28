# prompt-compare

Line-by-line comparison of ArcNave's prompt with the Fable 5.1 app-prompt capture in
`tools/Anthropic/claude-fable-5.1.md`. Output: `docs/audits/2026-09-28-fable-5.1-prompt-line-by-line.md`.

```bash
cd backend && npx tsx ../tools/prompt-compare/render.mts   # ArcNave prompt + tools, as sent
cd .. && python3 tools/prompt-compare/split.py              # units and tool schema facts
python3 tools/prompt-compare/build_report.py                # developer edition (Markdown) + plain edition (work/report.html)
python3 tools/prompt-compare/to_pdf.py out.pdf               # the plain edition as a PDF (Chromium)
```

The judgements live in three files, one line per unit, keyed by line number:

- `verdicts-fable.psv`: `L<fable line>|verdict|ArcNave location|note`
- `verdicts-arcnave.psv`: `L<rendered ArcNave line>|verdict|note|risk`
- `verdicts-tools.psv`: `tool|verdict|note`

`build_report.py` refuses to build if a unit has no verdict, so a prompt change that adds or
moves a unit shows up as a failed build: re-render, re-split, and judge the new lines.
The report is laid out for a non-engineer: a line above every table says what it shows,
statuses are words (Missing, Opposite…), problems come before matches, and rules about
features ArcNave lacks sit in an appendix. Nothing is shortened: every unit, tool description and verdict appears whole in both the
Markdown and the PDF (rows never split across PDF pages). `work/` is scratch and not committed.

Two editions. The Markdown in `docs/audits/` is for developers: tool names, settings and
file names as they are. The PDF is for the owner (`plain.py`): the same findings with nothing
that reads like code; tool names, section tags and decision numbers are put into words, example
markup becomes "User:" / "Answer:" lines, and the tool-settings appendix is left out.
