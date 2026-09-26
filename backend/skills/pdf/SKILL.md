---
name: pdf
version: 4.0.0
description: "Use when a task needs PDF procedure beyond reading pages already shown: exact counts, totals or complete row lists, scanned or photographed PDFs, converting a PDF to Excel or Word, splitting, merging, or creating a PDF. Not needed to answer a question from a PDF already in the conversation."
category: artifact
scope: builtin
requires:
  tools:
    - generate_deliverable
  capabilities:
    - artifact.export.pdf
autoload: false
metadata:
  source: arcnave
---

# PDF

## What you already see

A PDF of up to 100 pages reaches you as an image of every page plus that page's text; past 100
pages, text only (the attachment line says which). Summaries and questions about what you can
see need no tool call.

For a page you cannot see (text-only PDF, a figure, a hard-to-read value), open the file in
`run_python` (it is in `input/`, path on its attachment line) and render the page or a region
into `view/`:

```python
import fitz  # pymupdf
page = fitz.open("input/statement.pdf")[4]
page.get_pixmap(dpi=250, clip=fitz.Rect(40, 300, 560, 420)).save("view/p5_rows.png")
```

## Exact counts, totals and complete lists

Use this workflow when the user asks for an exact figure or a complete list, such as "count
every transaction", "total of this column" or "list every entry". Reading a page by eye can
skip or merge a row without noticing. It does not apply to summaries or to questions the
visible pages already answer.

```
Progress:
- [ ] 1. Check the PDF type: page count and whether pages have a text layer
- [ ] 2. Write every record to a file (rows.json) with named fields
- [ ] 3. Check the records against the document's own figures
- [ ] 4. Compute the answer in code from the checked file
```

**1. PDF type.** `len(page.get_text().strip())` per page with pymupdf.

**2. Records.** Choose fields from the document (date, description, debit, credit, balance; or
item, qty, rate, amount). Give each record a `kind` (`data`, `opening`, `subtotal`, `total`,
`header`) and its `page`; count only `data` records.
- Text layer: extract with `pdfplumber` (tables, or words by position).
- Scanned: read the pages yourself a few at a time and append the records with code. Tesseract
  digits are unreliable on photographed pages; crop the region at 200–300 dpi instead.
- When one PDF holds several documents, add a `source` field and report each one separately
  as well as combined.

**3. Check.** Use the checks the document offers:
- running balance: previous + credits − debits = balance;
- printed totals, counts, and opening and closing balances;
- arithmetic inside a row (qty × rate = amount).

A failed check means a record is wrong. Look at that row again, fix it, and re-run the check.
Do not change a number just to make a check pass.

**4. Answer.** Compute counts, sums and splits in code. For a classification, apply written
rules and keep anything they do not cover as `UNKNOWN`. Report which checks passed and
anything that is unreconciled (with page and row). Show at most about 50 rows in chat. When the
user asks for the full list as a file, write it with `generate_deliverable` (xlsx).

Without run_python, use `extract_scanned_table_rows` and then `analyze_table_rows`. Its `count`,
`sum` and `running_balance` operations do step 3's checks in code: pass a printed total or count
as `expected` and the result reports the difference (`scripts/analyze_table_rows.py`).

## Page count and metadata

`inspectPdf` with the `fileId` returns `pageCount`, `title` and `author`.

## Create a PDF

Write Markdown (headings, paragraphs, `> ` callouts, GFM tables). Then call
`generate_deliverable` with `format: 'pdf'`, a `title` (the filename) and `content`. The
renderer embeds Unicode fonts (₹, €, smart quotes), repeats table headers across pages, and
adds "Page X of Y" footers.

## Change an existing PDF

PDF is fixed-layout: do not edit its bytes.
- Split or extract pages: `splitPdfFile` with `fileId` and 1-indexed `pageRanges`, e.g.
  `[[1, 3], [5, 5]]`.
- Merge: `mergePdfFiles` with `fileIds` in order (at least 2).
- Rewrite content: extract it, edit it as Markdown, and build a new PDF.
- The same filename uploaded twice: each file has its own `run_python path` and `fileId`.

## Convert a PDF

- **To Excel:** read the rows (the workflow above when every row matters). Then pass a typed
  `workbook` (dates, numbers, formulas) to `generate_deliverable` with `format: 'xlsx'`. See
  the xlsx skill for workbook structure. `sourceAttachmentId` does not parse a PDF.
- **To Word or PowerPoint:** extract the content, write it as Markdown, and call
  `generate_deliverable` with `format: 'docx'` or `format: 'pptx'`.

## When a tool reports a problem

`generate_deliverable` verifies the file it builds. If a result has `status: 'warning'` with
`repairable: true`, fix what the diagnostic names and call it again.

## Scripts

`scripts/normalize_table_rows.py` and `scripts/analyze_table_rows.py` run inside
`extract_scanned_table_rows` and `analyze_table_rows`. Do not run them directly: they expect
those tools' input format.
