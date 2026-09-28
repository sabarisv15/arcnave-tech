# prompt-compare

Line-by-line comparison of ArcNave's prompt with the Fable 5.1 app-prompt capture in
`tools/Anthropic/claude-fable-5.1.md`. Output: `docs/audits/2026-09-28-fable-5.1-prompt-line-by-line.md`.

```bash
cd backend && npx tsx ../tools/prompt-compare/render.mts   # ArcNave prompt + tools, as sent
cd .. && python3 tools/prompt-compare/split.py              # units and tool schema facts
python3 tools/prompt-compare/build_report.py                # the report (Markdown)
python3 tools/prompt-compare/to_pdf.py out.pdf               # the same, as a PDF (pip install markdown)
```

The judgements live in three files, one line per unit, keyed by line number:

- `verdicts-fable.psv`: `L<fable line>|verdict|ArcNave location|note`
- `verdicts-arcnave.psv`: `L<rendered ArcNave line>|verdict|note|risk`
- `verdicts-tools.psv`: `tool|verdict|note`

`build_report.py` refuses to build if a unit has no verdict, so a prompt change that adds or
moves a unit shows up as a failed build: re-render, re-split, and judge the new lines.
Nothing is shortened: every unit, tool description and verdict appears whole in both the
Markdown and the PDF (rows never split across PDF pages). `work/` is scratch and not committed.
