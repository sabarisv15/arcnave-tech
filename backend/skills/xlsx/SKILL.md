---
name: xlsx
version: 1.1.0
description: Professional spreadsheet architecture, formula conventions, financial modeling, summary sheets, and grid formatting.
category: artifact
requires:
  tools:
    - create_artifact
  capabilities:
    - artifact.export.xlsx
autoload: false
metadata:
  source: arcnave
---

# Spreadsheet (XLSX) Design & Financial Modeling

Use this skill when designing spreadsheets, financial models, budgeting sheets, or tabular data workbooks.

## Structure & Architecture

- **Workbook Structure**:
  - For complex models, include a dedicated `Summary` or `Dashboard` table first, followed by `Data` / `Assumptions` / `Calculations` tables.
- **Formula Standards**:
  - Always write Excel formula function names in UPPERCASE (e.g. `SUM`, `AVERAGE`, `XLOOKUP`, `IF`, `INDEX`, `MATCH`).
  - Keep formulas readable; break nested logic into distinct helper columns where appropriate.
  - Never hardcode dynamic variables inside formulas; reference assumption cells.
- **Cell Formatting & Data Types**:
  - Format monetary values explicitly with currency symbols and standard decimal places (`$#,##0.00`).
  - Format percentages explicitly (`0.0%`).
  - Format dates consistently (`YYYY-MM-DD` or standard local date).
- **Grid Layout & Visual Hierarchy**:
  - Use clear header rows with bold text, distinct background shading, and borders.
  - Total and Subtotal rows must use top thin border and bottom double border.
  - Right-align numeric columns; left-align descriptions and identifiers.

## Capability & Output Guidance

- **Creating the Spreadsheet**: Call the `create_artifact` tool with `kind: 'document'` containing well-structured GFM Markdown tables with clear headings for each sheet.
- **Exporting to Excel (.xlsx)**: ArcNave's export layer parses the Markdown tables into sheets and generates a real `.xlsx` workbook via ExcelJS for the user to download.
- **Limitations**: Note that markdown-to-spreadsheet conversion captures tables and cell data; complex multi-tab VBA macros or dynamic chart objects require Python sandbox scripts.
