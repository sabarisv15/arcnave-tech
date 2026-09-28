---
name: pdf
version: 6.1.0
description: "Use whenever the user wants a PDF file produced or changed: creating a PDF from content, filling a PDF form, merging PDFs, splitting or extracting pages, rotating, rewriting a PDF's content, or converting a PDF into an Excel, Word or PowerPoint file. For reading a PDF that is not in your context, use the pdf-reading skill."
category: artifact
scope: builtin
requires:
  tools:
    - bash_tool
autoload: false
metadata:
  source: arcnave
---

# PDF

This skill produces and changes PDF files. A PDF of up to 100 pages is already in your context
as page images and text; for one that is not, the pdf-reading skill says how to read it.

Work on the sandbox computer: write a script with `create_file` and run it with `bash_tool`
(`python3 build.py`), or run a short command directly. Uploaded files are in `input/`
(read-only). Save the finished file to `output/<name>` and give it with `present_files`.

## Page count and metadata

`pypdf.PdfReader(path)`: `len(reader.pages)` and `reader.metadata`. From the shell:
`pdfinfo input/file.pdf`.

## Create a PDF

Build the document as a `.docx` with `python-docx` (see the docx skill: headings, tables with a
repeated header row, page numbers in the footer), then convert it:
`soffice --headless --convert-to pdf --outdir output/ file.docx`. The sandbox fonts (DejaVu,
Noto) draw ₹, € and Tamil text.

A chart or a figure-only page can be saved straight to PDF with matplotlib
(`fig.savefig("output/chart.pdf")`).

## Change an existing PDF

PDF is fixed-layout: do not edit its bytes.
- Split or extract pages: `pypdf` (`PdfWriter`, `writer.add_page(reader.pages[i])`), then
  `writer.write("output/part.pdf")`.
- Merge: add every page of each file, in the order asked, to one `PdfWriter`.
- Rotate: `page.rotate(90)`.
- Rewrite content: extract it, edit it, and build a new PDF.
- The same filename uploaded twice: each file has its own path in `input/`.

## Fill a form

```python
from pypdf import PdfReader, PdfWriter
reader = PdfReader("input/form.pdf")
print(reader.get_fields().keys())          # field names, before filling
writer = PdfWriter(clone_from=reader)
writer.update_page_form_field_values(writer.pages[0], {"Name": "Priya"}, auto_regenerate=False)
writer.set_need_appearances_writer(True)
writer.write("output/form_filled.pdf")
```

Fill fields by their names, page by page. A scanned form has no fields: say so, and ask whether
the user wants the text written onto the page instead.

## Convert a PDF

Read the content first (the page images and text you can see, or the pdf-reading skill for a PDF that is not in your context). Then build the target file with its skill:
xlsx for Excel, docx for Word, pptx for PowerPoint.

## Checking the file

Open the saved PDF again: page count, and render the pages that matter to PNG with
`pdftoppm -r 80 -png` and `view` them. Fix and save again when something is wrong.
