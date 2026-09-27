---
name: xlsx
version: 4.0.1
description: "Use whenever a task touches spreadsheet data: any question about an uploaded .xlsx/.xls (read from the file with code), analysing or computing over a .xlsx/.xls/.csv, cleaning or restructuring tabular data, formulas, charts, or producing an Excel file."
category: artifact
scope: builtin
requires:
  tools:
    - bash_tool
autoload: false
metadata:
  source: arcnave
---

# Spreadsheets (XLSX)

Work on the sandbox computer: write a script with `create_file` and run it with `bash_tool`
(`python3 build.py`), or run a short command directly. Uploaded files are in `input/`
(read-only). Save the finished file to `output/<name>` and give it with `present_files`.

## Reading an uploaded workbook

A workbook is not in the conversation as text: its attachment line says to read it from the
file. Flattened text would lose cell addresses, formulas and hidden sheets.
- A quick look: `pandas.read_excel(path, sheet_name=None)`, one DataFrame per sheet.
- Formulas and values: openpyxl twice, `load_workbook(path)` for the formulas and
  `load_workbook(path, data_only=True)` for the values last saved with them.
- Hidden sheets and rows: `ws.sheet_state` and `ws.row_dimensions[r].hidden`; say when a
  figure includes or leaves them out.
- Counts and totals are computed in code, never read off by eye.

## Creating a workbook

Build it with openpyxl and save it to `output/<name>.xlsx`.
- Keep numbers and dates typed (`float`, `int`, `datetime`), never as text, and set
  `cell.number_format` (`"#,##0.00"`, `"DD-MM-YYYY"`).
- Values the user reads as results (totals, rates, differences) are formulas such as
  `=SUM(B2:B10)` or `=B2*C2`, so any cell can be inspected. Write function names in uppercase.
- Freeze the header row (`ws.freeze_panes = "A2"`) and set useful column widths.

## Changing an existing workbook

Open the file from `input/` with `load_workbook(path)`, change only the cells asked for, and
save the result to `output/`. Untouched sheets, formulas and styles are kept. Do not rebuild an
existing workbook from scratch to change a few cells.

## Combining workbooks

Copy each source sheet into one workbook and rename clashing sheet names (`Data`, `Data_2`).

When you merge rows from several files or pages, identical rows can be real (two ₹50 deposits
on the same day). Remove a duplicate only when it comes from the same place in the same source,
never because its values match.

## From a PDF or document

Read the source first (for every row of a PDF table, see the pdf-reading skill). Then build the
workbook from the rows you read.

## Charts

For a chart inside the file, use `openpyxl.chart` and save the workbook to `output/`. For a
chart shown in chat instead of a file, use `chart_display_v0` for a plain line, bar or scatter chart
and `show_widget` for anything more, when they are available.

## Checking the file

Open the saved file again (`load_workbook`) and check what the user will rely on: sheet names,
row counts, totals, and that formulas reference the right ranges. Fix and save again when
something is wrong.

Formulas that link to other workbooks (`='[other.xlsx]Sheet1'!A1`) are not supported.
