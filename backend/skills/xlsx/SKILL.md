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

## Structure & Architecture (Claude & Excel Standards)

- **Deliverable vs Cover Note**: The spreadsheet is the deliverable; chat is the cover note. Never paste giant walls of cells or formulas into chat. Direct the user to the key sheets, summary totals, and formula logic.
- **Show Your Work (Formulas First)**:
  - Users speak Excel, not Python. Any calculation producing an outcome the user sees in the spreadsheet must be an explicit formula (e.g. `=SUM(B2:B10)`, `=AVERAGE(...)`, `=C2*D2`), NEVER dead numbers typed externally.
  - The user must be able to click any cell and inspect how it was derived.
  - Function names must be UPPERCASE (`SUM`, `AVERAGE`, `IF`, `XLOOKUP`, `INDEX`, `MATCH`).
- **Workbook Structure**:
  - For complex models, include a dedicated `Summary` or `Dashboard` table first, followed by `Data` / `Assumptions` / `Calculations` tables.
  - Each table heading (`# SheetName`) maps to its own worksheet tab.
- **Cell Formatting & Data Types**:
  - Format monetary values with currency symbols and standard decimals (`$1,250.00`).
  - Format percentages explicitly (`94.2%` or `15.0%`).
  - ArcNave's exporter automatically parses numbers, percentages, currencies, and formulas, auto-fits column widths, freezes the top header row, and styles rows with zebra striping.
- **Large Datasets (>1,000 rows)**:
  - When analyzing massive raw datasets, use `run_python` to process, aggregate, and summarize the data in the Cloud Run sandbox, then output clean, formula-backed tables into the spreadsheet artifact.

## Capability & Output Guidance

- **Creating the Spreadsheet**: Call the `create_artifact` tool with `kind: 'document'` containing well-structured GFM Markdown tables with clear headings for each sheet and explicit formulas (`=SUM(...)`).
- **Exporting to Excel (.xlsx)**: ArcNave's export layer parses the Markdown tables into sheets and generates a real `.xlsx` workbook via ExcelJS with formulas, auto-fitted columns, and styled headers.
