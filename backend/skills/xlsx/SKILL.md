---
name: xlsx
version: 1.0.0
description: Professional spreadsheet architecture, formula conventions, financial modeling, summary sheets, and grid formatting.
category: artifact
requires:
  tools:
    - artifact.xlsx
autoload: false
metadata:
  source: arcnave
---

# Spreadsheet (XLSX) Design & Financial Modeling

Use this skill when designing spreadsheets, financial models, budgeting sheets, or tabular data workbooks.

## Structure & Architecture

- **Workbook Structure**:
  - For complex models, include a dedicated `Summary` or `Dashboard` sheet first, followed by `Data` / `Assumptions` / `Calculations` tabs.
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

- **When `artifact.xlsx` tool is available**: You may generate and export the `.xlsx` spreadsheet file.
- **When in `guidance_only` mode (tool not present)**: Do not claim that an `.xlsx` file has been saved or generated. Provide the complete spreadsheet table layout, formulas, and cell coordinates in clean Markdown tabular format.
