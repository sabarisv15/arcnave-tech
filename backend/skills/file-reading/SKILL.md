---
name: file-reading
version: 1.0.1
description: "Use when an uploaded file's content is not in your context and you have to open it on the computer: Word, Excel, CSV, PowerPoint, JSON, archives, ebooks, code or any other file listed with a path in input/. It says how to read each type, and how much, instead of printing a binary. Not needed for a file whose content you can already see (a PDF's text and page images, an image, a plain-text file); for a PDF that is not in your context, use pdf-reading."
category: analysis
scope: builtin
requires:
  tools:
    - bash_tool
autoload: false
metadata:
  source: arcnave
---

# Reading an uploaded file

Every file of the conversation is on the computer in `input/`, read-only, at the path on its
attachment line. Look before you read: size first, then a sample, then only the part you need.
Print summaries, not whole files: long output is cut.

```bash
ls -la input/
```

## By type

| File | How to read it |
|---|---|
| PDF | Up to 100 pages it is already in your context; past that, read the pdf-reading skill. |
| .docx, .doc | `pandoc input/f.docx -t markdown \| head -200`; for tables, styles or editing, the docx skill. |
| .xlsx, .xls, .csv, .tsv | pandas: sheet names, `df.shape`, `df.head()`, column types; then compute. The xlsx skill for anything beyond a look. |
| .pptx, .ppt | `python-pptx`, slide by slide: titles, text, tables, notes. The pptx skill for more. |
| .json | Python `json`: top-level keys and lengths first, then the part you need. |
| Text, Markdown, HTML, code, logs | `view` with a `view_range`; `wc -l` and `head` for a big one. |
| Images | `view` shows the image. |
| .zip, .tar, .gz | List it first with Python `zipfile` / `tarfile`, then extract only what you need into a folder of your own (not `input/`). |
| .epub | A zip of XHTML: `pandoc input/book.epub -t plain \| head -300`. |
| Anything else | Read its first bytes with Python (`open(p, 'rb').read(64)`) to find what it is. Never `cat` a binary. |

## Encoding

A text file that does not decode as UTF-8: detect it with `chardet`, then read it with that
encoding. Tamil text in older files is often not UTF-8.

## Exact figures

A count, a total or a complete list comes from code over the whole file, not from the sample
you looked at. Say which sheet, rows or pages the answer covers.
