---
name: pptx
version: 3.0.0
description: "Use whenever a task touches a presentation: reading or answering questions about an uploaded .pptx/.ppt (read from the file with code), exact extraction, editing slides, or producing a PowerPoint deck."
category: artifact
scope: builtin
requires:
  tools:
    - bash_tool
autoload: false
metadata:
  source: arcnave
---

# Presentations (PPTX)

Work on the sandbox computer: write a script with `create_file` and run it with `bash_tool`
(`python3 build.py`), or run a short command directly. Uploaded files are in `input/`
(read-only). Save the finished file to `output/<name>` and give it with `present_files`.

## Reading an uploaded presentation

A presentation is not in the conversation as text: its attachment line says to read it from the
file. Read slide text, tables and speaker notes with `python-pptx`, slide by slide. To see a
slide, convert the deck with LibreOffice (`soffice --headless --convert-to pdf`) and render that
page to PNG with `pdftoppm`, then `view` it.

## Creating a deck

Build it with `python-pptx` (16:9: `prs.slide_width = Inches(13.333)`,
`prs.slide_height = Inches(7.5)`) and save it to `output/<name>.pptx`.
- One idea per slide, with a title that states the takeaway ("Revenue grew 32% on enterprise
  deals"), not a topic ("Financial overview").
- Text readable from across a room: titles 28–36pt, body 16–18pt, nothing under 14pt.
- Three to five points per slide; split onto a continuation slide rather than shrinking text.
- Tables with a header row; numbers right-aligned.
- Speaker notes (`slide.notes_slide.notes_text_frame`) when the user will present it.
- A chart is a native chart (`slide.shapes.add_chart`) or an image saved with matplotlib.

## Changing an existing deck

Keep the user's file as it is apart from what they asked to change. For a text change, open the
deck with `python-pptx`, change only the runs on the slide asked for, and save to `output/`. To
reorder slides, reorder the entries of `prs.slides._sldIdLst`. Never rebuild a whole deck to
change one slide: that loses its master, theme and shapes.

## From other files

Read the source first, then plan the slides from what you read: one slide per major point.

## Checking the file

Convert the saved deck to PDF with LibreOffice, render the pages to PNG, and `view` them:
text that overflows its box, overlapping shapes, empty slides. Fix and save again when
something is wrong.

In chat, give a short cover note on what the deck covers; do not paste the slides into chat.
