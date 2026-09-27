---
name: pdf
version: 5.0.0
description: "Use whenever the user wants a PDF file produced or changed: creating a PDF from content, merging PDFs, splitting or extracting pages, rewriting a PDF's content, or converting a PDF into an Excel, Word or PowerPoint file. For reading, counting or extracting what is inside a PDF, use the pdf-reading skill; a conversion needs both."
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

Reading what is inside a PDF (counts, totals, tables, scanned pages) is the pdf-reading
skill. This one produces and changes PDF files.

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

- **To Excel:** read the rows first with the pdf-reading skill's workflow. Then pass a typed
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
