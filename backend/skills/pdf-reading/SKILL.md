---
name: pdf-reading
version: 2.0.0
description: "Use whenever an answer depends on reading what is inside a PDF exactly: counting, totalling or listing every row or entry (bank statements, ledgers, invoices, registers, attendance sheets), extracting tables or text, reading scanned or photographed pages, or checking figures against the document. Also use it before converting a PDF's content into Excel, Word or PowerPoint. Not for creating, merging, splitting or rotating PDFs: use the pdf skill for those."
category: analysis
scope: builtin
autoload: false
metadata:
  source: arcnave
---

# Reading a PDF

## What you already see

A PDF of up to 100 pages reaches you as an image of every page plus that page's text; past 100
pages, text only (the attachment line says which). A summary, or a question one visible
passage answers, needs no tool call.

A count, a total or a complete list is different: dense rows read from a page image can be
skipped or merged without any sign of it. Get those rows into a file, check them against the
document's own figures, and compute the answer; do not estimate it in prose.

For a page or region you cannot read clearly (a figure, a small or faint value), open the file
in `run_python` (it is in `input/`, path on its attachment line) and render a crop into `view/`:

```python
import fitz  # pymupdf
page = fitz.open("input/statement.pdf")[4]
page.get_pixmap(dpi=250, clip=fitz.Rect(40, 300, 560, 420)).save("view/p5_rows.png")
```

## Choose the reading strategy by page type

Check each page for a text layer first: `len(page.get_text().strip())` with pymupdf.

- **Text layer (a statement downloaded from net banking, an exported report):** extract with
  `pdfplumber` in `run_python`: `page.extract_tables()`, or words by position when columns are
  not ruled. This is exact; do not read these pages from the image.
- **Scanned or photographed pages you can see (no text layer, 100 pages or fewer):** the page
  images are already in front of you. Read every row from them in one pass, with no tool call
  to look, and write the records into a file in `run_python`. Then run the checks below in
  code. Only the rows a check flags need a second look: render those rows as a crop into
  `view/` (above).
- **Scanned pages you cannot see (past 100 pages, text only):** render the pages into `view/`
  with `run_python`, at most 4 per call, and read them; use `pytesseract` only as a cross-check,
  because its digits are unreliable on photographed pages.
- **Mixed PDFs:** use each page's own strategy.

Do not look at pages you can already see through tool calls a few at a time: each look costs a
tool step, and a turn has a limited number.

## Exact counts, totals and complete lists

```
Progress:
- [ ] 1. Page type for every page (above)
- [ ] 2. Every record in a file, with named fields
- [ ] 3. Records checked against the document's own figures
- [ ] 4. Answer computed from the checked records
```

**2. Records.** Choose fields from the document (date, description, debit, credit, balance; or
item, qty, rate, amount). Give each record a `kind` (`data`, `opening`, `subtotal`, `total`,
`header`) and its `page`; count only `data` records. A narration that wraps onto a second line
is part of the row above it, not a new row. When one PDF holds several documents, add a
`source` field and report each one separately as well as combined.

**3. Check.** Use the checks the document offers:
- running balance: previous + credits − debits = balance;
- printed totals, counts, and opening and closing balances;
- arithmetic inside a row (qty × rate = amount).

Run these checks in code over the records file, and compare with the document's printed
figures. A failed check means a record is wrong: read that row again from a crop, correct the
record, and re-run the check. Do not change a number just to make a check pass.

**4. Answer.** Compute counts, sums and splits in code, never in prose. For a classification,
apply written rules and keep anything they do not cover as `UNKNOWN`. Report which checks
passed and anything that is unreconciled (with page and row), and any row you could not read
clearly. Show at most about 50 rows in chat. When the user asks
for the full list as a file, build it with the xlsx skill.

## Follow-up questions

A later question about the same file ("total Federal entries?") is answered from the records
already extracted in this conversation, not by reading the pages again. If a new figure differs
from one you gave earlier, say so and say which one is right and why.
