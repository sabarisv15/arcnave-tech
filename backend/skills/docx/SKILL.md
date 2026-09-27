---
name: docx
version: 3.0.0
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

## Changing an existing document

Keep the user's file as it is apart from what they asked to change. A `.docx` is a ZIP of XML
parts: for a targeted text change, open it with `python-docx` (or unzip it and edit
`word/document.xml`), change only the runs asked for, and save the result to `output/`. Never
rebuild an existing document from scratch for a targeted edit: that loses its styles, headers,
footers and images.

A phrase can be split across several runs; check the paragraph text, not a single run, before
concluding it is absent.

## From other files

Read the source first, then write the document from what you read. For a slide deck made from
the document, see the pptx skill; for a PDF, save the document and convert it with LibreOffice
(`soffice --headless --convert-to pdf --outdir output/ file.docx`).

## Checking the file

Open the saved file again and check what the user will rely on: the headings, that edited text
reads correctly, tables and page count. When layout matters, render pages to PNG and `view` them. Fix and
save again when something is wrong.

In chat, give a short cover note on what the document holds or what changed; do not paste the
whole document into chat.

Tracked changes and comments need editing the XML directly (`w:ins`, `w:del`, comment parts);
say so when the user asks for them and the change is not simple.
