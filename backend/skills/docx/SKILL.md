---
name: docx
version: 3.1.0
description: "Use whenever a task touches a Word document: reading or answering questions about an uploaded .docx/.doc (read from the file with code), exact extraction, editing it, or producing a Word file."
category: artifact
scope: builtin
requires:
  tools:
    - bash_tool
autoload: false
metadata:
  source: arcnave
---

# Word documents (DOCX)

Work on the sandbox computer: write a script with `create_file` and run it with `bash_tool`
(`python3 build.py`), or run a short command directly. Uploaded files are in `input/`
(read-only). Save the finished file to `output/<name>` and give it with `present_files`.

## Reading an uploaded document

A Word document is not in the conversation as text: its attachment line says to read it from
the file. Read it with `pandoc input/file.docx -t markdown` for the text with headings, lists
and tables, or with `python-docx` for paragraphs, tables and styles. When images or layout
matter, convert it with LibreOffice (`soffice --headless --convert-to pdf`) and render pages
to PNG and look at them with `view`.

## Creating a document

Build it with `python-docx` and save it to `output/<name>.docx`.
- Keep an unbroken heading hierarchy (Heading 1, then Heading 2); never skip a level.
- Use real Word structure: styles for headings, real lists, tables with a header row,
  page numbers in the footer when the document is long.
- Right-align numeric table columns; left-align text.
- Keep list nesting to two levels.

### Table column widths

A column's width is stored in two places: the table grid (`table.columns[i].width`) and every
cell of the column (`cell.width`). Set both, to the same value, once, with the table's layout
fixed:

```python
from docx.shared import Cm
table.autofit = False
for i, width in enumerate([Cm(3), Cm(9), Cm(4)]):
    table.columns[i].width = width
    for cell in table.columns[i].cells:
        cell.width = width
```

Keep the widths' total within the page's text width (A4 with 2.5 cm margins: 16 cm); a wider
table has its columns shrunk whatever you set. Set each width in one place in the script: a
later assignment to the same column or cell replaces the first, and rebuilding the file does not
help until that second assignment is gone. A figure that must stay on one line needs a column
wide enough for it.

## Changing an existing document

Keep the user's file as it is apart from what they asked to change. A `.docx` is a ZIP of XML
parts: for a targeted text change, open it with `python-docx` (or unzip it and edit
`word/document.xml`), change only the runs asked for, and save the result to `output/`. Never
rebuild an existing document from scratch for a targeted edit: that loses its styles, headers,
footers and images.

A phrase can be split across several runs; check the paragraph text, not a single run, before
concluding it is absent.

## From other files

Take the content from the source: when the source is in your context (a PDF's page images and
text, an image), you have already read it, so write the document from what you see; read the file
with code only when its content is not in your context. For a slide deck made from the document,
see the pptx skill; for a PDF, save the document and convert it with LibreOffice
(`soffice --headless --convert-to pdf --outdir output/ file.docx`).

## Checking the file

After writing the file, look at it once: convert it with LibreOffice, render its pages to PNG
(`pdftoppm -png -r 100`) and `view` them. When that shows a defect, find its cause in the script
(for a table, the width rules above) and fix it there once. Do not rebuild again for the same
defect or for details the user did not ask about; give the file and say what is left, if anything.

In chat, give a short cover note on what the document holds or what changed; do not paste the
whole document into chat.

Tracked changes and comments need editing the XML directly (`w:ins`, `w:del`, comment parts);
say so when the user asks for them and the change is not simple.
