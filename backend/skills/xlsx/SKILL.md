---
name: xlsx
version: 3.0.0
description: "Use when a task works on spreadsheet data: analysing or computing over an uploaded .xlsx/.xls/.csv, cleaning or restructuring tabular data, formulas, charts, or producing an Excel file. Not needed to answer a question from a sheet's text already in the conversation."
category: artifact
scope: builtin
requires:
  tools:
    - generate_deliverable
  capabilities:
    - artifact.export.xlsx
autoload: false
metadata:
  source: arcnave
---

# Spreadsheets (XLSX)

## Reading an uploaded workbook

An uploaded workbook reaches you as extracted text and tables. Answer questions about what is
shown directly from that.

For exact structure, call `inspectSpreadsheet` with the `fileId`. It returns `sheetNames`,
`totalRows` and `cellTypes` (address → `number`, `string`, `formula`, `date`, `boolean`).

For analysis beyond the tools, `run_python` has pandas, openpyxl, xlrd and xlsxwriter; the file
is in `input/`.

## Creating a workbook

Pass a typed `workbook` to `generate_deliverable` with `format: 'xlsx'`:

```json
{
  "sheets": [{
    "name": "Summary",
    "columns": [
      { "key": "date", "label": "Date", "type": "date", "format": "DD-MM-YYYY" },
      { "key": "amount", "label": "Amount", "type": "number", "format": "#,##0.00" }
    ],
    "rows": [
      { "cells": { "date": { "value": { "type": "date", "value": "2026-03-31" } },
                   "amount": { "value": { "type": "number", "value": 12500 } } } },
      { "cells": { "amount": { "value": { "type": "formula", "value": "=SUM(B2:B2)" } } } }
    ]
  }]
}
```

- Each cell is `{ "value": { "type", "value", "format"? }, "source"? }`. Types: `number`,
  `integer`, `date`, `datetime`, `formula`, `boolean`, `string`, `null`. Keep numbers and
  dates typed, not as text.
- Values the user reads as results (totals, rates, differences) are formulas such as
  `=SUM(B2:B10)` or `=B2*C2`, so any cell can be inspected. Write function names in uppercase.
- A cell or row can carry `source` (`attachmentId`, `page`, `row`, ...) when its value came from
  a file.

For a simple sheet, Markdown also works: a `# SheetName` heading followed by a GFM table, passed
as `content` with a `title`.

## Changing an existing workbook

Call `editSpreadsheetCells` with the `fileId` and a list of `edits`:

```json
[{ "sheet": "Q1", "cell": "B8", "value": 15000, "type": "number", "format": "#,##0" },
 { "sheet": "Q1", "cell": "B9", "value": "=B8*1.1", "type": "formula" }]
```

Untouched sheets, formulas and styles are kept. Do not rebuild an existing workbook from
Markdown to change a few cells.

## Combining workbooks

`combineWorkbooks` with `fileIds` merges the sheets into one workbook and renames clashing
sheet names (`Data`, `Data_2`).

When you merge rows from several chunks or pages, identical rows can be real (two ₹50 deposits
on the same day). Remove a duplicate only when it has the same source provenance
(`attachmentId:page:sheet:table:row`), never because its values match.

## From a PDF or document

Read the source first (for every row of a PDF table, see the pdf-reading skill's exact workflow). Then
build the typed workbook above. `sourceAttachmentId` copies a text or CSV file only; it does not
parse a PDF.

## Charts

`generate_deliverable` does not draw charts. For a chart inside the file, build the workbook in
`run_python` with `openpyxl.chart` and save it to `output/`. For a chart shown in chat, use
`render_ui` when it is available.

## When a tool reports a problem

`generate_deliverable` verifies the workbook it builds: the package opens, formulas parse, and
dates and numbers are typed. If a result has `status: 'warning'` with `repairable: true`, fix
what it names and call it again.

Formulas that link to other workbooks (`='[other.xlsx]Sheet1'!A1`) are not supported.
