---
name: xlsx
version: 1.2.0
description: Professional spreadsheet architecture, formula conventions, financial modeling, summary sheets, and grid formatting.
category: artifact
scope: builtin
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

Use this skill whenever generating, converting, editing, or structuring spreadsheets (.xlsx), financial models, budgets, tables, or tabular datasets.

## Core Principles (ArcNave & Excel Standards)

- **Deliverable vs Cover Note**: The spreadsheet is the deliverable; chat is the cover note. In chat, default to brevity (1-2 tight paragraphs or bullet highlights) leading with key sheets, totals, and formula logic. Never dump giant walls of CSV data or raw cells into chat. Direct the user to the generated spreadsheet.
- **Show Your Work (Formulas First)**:
  - Users speak Excel, not Python. Any calculation producing an outcome the user sees in the spreadsheet must be an explicit UPPERCASE formula (e.g. `=SUM(B2:B10)`, `=AVERAGE(C2:C20)`, `=B2*C2`, `=IF(D2>0, D2*0.1, 0)`, `=SUMIFS(...)`, `=INDEX(...)`, `=MATCH(...)`), NEVER hardcoded dead numbers typed externally.
  - The user must be able to click any cell and inspect its exact mathematical derivation.
  - Formula function names must be strictly UPPERCASE.
- **Multi-Sheet Workbook Architecture**:
  - For substantial models or conversions, organize content into logical worksheets using `# SheetName` headings in Markdown.
  - Recommended sheet structure:
    1. `# Summary` or `# Dashboard`: High-level KPIs, executive totals, and aggregated metrics.
    2. `# Data` or `# Transactions`: Detailed line items or converted statement entries.
    3. `# Assumptions` or `# Calculations`: Underlying growth rates, tax brackets, or sensitivity inputs.
  - ArcNave's exporter creates a dedicated worksheet tab for each `# SheetName` heading.
- **Cell Formatting & Data Semantics**:
  - Currency: Format monetary values with currency symbols and standard decimals (`$1,250.00`).
  - Percentages: Format percentages explicitly (`15.0%`), stored as decimal fractions (`0.15`).
  - Multiples: Format valuation multiples as `0.0x` (e.g. `8.5x`).
  - Integers / Quantities: Use comma separators (`1,500`).
  - Financial Negatives: Use parentheses `($500.00)` or standard negative sign.
  - Dates: Standard ISO `YYYY-MM-DD` or `MM/DD/YYYY`.
- **Row & Column Layout**:
  - Every table must have a distinct, bold header row.
  - Text columns must be left-aligned; numeric and monetary columns must be right-aligned.
  - ArcNave's export layer auto-fits column widths, freezes the top header row, and applies professional zebra striping.

## ArcNave Runtime Deliverable Execution

ArcNave provides a dedicated, native document and spreadsheet generation engine (`generate_deliverable`).

### Mode A: Direct Spreadsheet Generation
When the user asks to create a spreadsheet from prompt instructions or conversation context:
1. Construct complete, valid GFM Markdown tables with explicit header rows and uppercase formulas (`=SUM(...)`).
2. Call the `generate_deliverable` tool with:
   - `format`: `'xlsx'`
   - `title`: Short, clean filename (e.g. `"Financial_Projections_2026"`, `"Q3_Budget_Model"`)
   - `content`: Markdown text with `# SheetName` headings and table rows.

### Mode B: Source File Conversion (e.g. PDF → Excel)
When the user asks to convert an uploaded PDF, document, or statement into Excel:
1. Inspect the uploaded file using `read_uploaded_file` if page-level verification or column layout inspection is needed.
2. Call `generate_deliverable` with:
   - `format`: `'xlsx'`
   - `sourceAttachmentId`: The UUID of the uploaded source attachment.
   - `instructions`: Clear transformation directions (e.g. `"Extract all statement transactions into columns: Date, Description, Reference, Debit, Credit, Balance"`).
3. Do NOT route normal PDF → Excel conversion to Python; use `generate_deliverable`.

### Verification Checklist Before Responding
- Did every sheet tab receive an explicit header row?
- Are derived sums, averages, and margins implemented as uppercase Excel formulas rather than hardcoded numbers?
- Are currency values and percentages formatted with proper notation?
- Does the final chat response provide a concise cover note and direct download affordance without dumping raw cell grids?
