---
name: pdf-reading
version: 4.0.0
description: "Use when you need to read, inspect or extract content from a PDF, especially when its content is not in your context and has to be read from the file in input/. Covers a content inventory, text and table extraction, rendering pages to look at them, embedded images, attachments and form fields, and choosing a reading strategy by document type (text-heavy, scanned, slide decks, forms, data-heavy). Not for creating, filling, merging, splitting or rotating PDFs: use the pdf skill for those."
category: analysis
scope: builtin
autoload: false
requires:
  tools:
    - bash_tool
metadata:
  source: arcnave
---

# Reading a PDF

## First: is it already in your context?

A PDF of up to 100 pages is already in front of you: an image of every page, that page's text,
and a note on any page that has no text layer. Read what you can see. Looking at those pages
again through tool calls, or checking them for a text layer with code, adds steps and nothing
else. This skill is for what you cannot see: a PDF past 100 pages (text only), a region too small
or faint to read, or content the page images do not show (attachments, form fields, embedded
files).

The file itself is in `input/`, at the path on its attachment line. Work on it with a script run
by `bash_tool`.

## Content inventory

```python
import pymupdf
doc = pymupdf.open("input/file.pdf")
print(doc.page_count, doc.metadata)
for i, page in enumerate(doc):
    print(i + 1, len(page.get_text().strip()), len(page.get_images()))
```

Characters per page tell text-layer pages from scanned ones; `pdfinfo input/file.pdf` gives the
page count and size from the shell.

## Text and tables

- Text: `page.get_text()` (pymupdf), or `pdftotext -layout input/file.pdf -` for columns kept
  in place.
- Tables: `pdfplumber`, `page.extract_tables()`; when columns are not ruled, words by position
  (`page.extract_words()`), grouped by their `top` and `x0`.

Print summaries, not whole documents: long output is cut.

## Looking at pages

Render a page, or a crop of one, to PNG and look at it with `view`:

```python
page = pymupdf.open("input/file.pdf")[4]
page.get_pixmap(dpi=200, clip=pymupdf.Rect(40, 300, 560, 420)).save("p5_rows.png")
```

For scanned pages you cannot see (past 100 pages), render them a few at a time and `view` them.
`pytesseract` is only a cross-check: its digits are unreliable on photographed pages.

## Images, attachments and form fields

- Embedded images: `page.get_images()`, then `pymupdf.Pixmap(doc, xref).save(...)`.
- Attached files: `doc.embfile_names()` and `doc.embfile_get(name)`.
- Form fields: `pypdf.PdfReader(path).get_fields()`, or `page.widgets()` in pymupdf.

## Strategy by document type

- **Text-heavy** (reports, papers): the text layer, section by section.
- **Scanned or photographed:** the page images; render a crop for anything unclear.
- **Slide decks exported to PDF:** one page per slide; read each page's text and look at the
  image for charts and diagrams.
- **Forms:** the form fields first, then the page for labels.
- **Data-heavy** (statements, ledgers, invoices): tables by position; where the document prints
  totals, counts or balances, compare with them.
- **Mixed:** each page by its own type.

A later question about the same file is answered from what you already read, not by reading the
pages again.
