---
name: xlsx
version: 2.1.0
description: Use whenever a spreadsheet or CSV/TSV is involved — reading or analysing an uploaded .xlsx/.xls/.csv, cleaning or restructuring tabular data, formulas, charts, or producing an Excel file. Load it before working on an uploaded spreadsheet's contents.
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

# Spreadsheet (XLSX) Architecture & Financial Modeling

Procedural knowledge for authoring, editing, inspecting, and consolidating Excel spreadsheets (.xlsx). Teaches typed `StructuredWorkbook` modeling, formula conventions, targeted cell updates, multi-sheet consolidation, and provenance-based deduplication.

---

## 1. When to Use This Skill

- Creating new financial models, operating budgets, ledgers, or data sheets.
- Modifying specific cells or formulas in an existing `.xlsx` workbook (`editSpreadsheetCells`).
- Combining multiple workbooks into a unified multi-sheet workbook (`combineWorkbooks`).
- Inspecting sheets, row counts, and cell types in an existing spreadsheet (`inspectSpreadsheet`).
- Formatting tabular data extracted from PDFs or documents into format-native spreadsheets.

---

## 2. When NOT to Use This Skill

- Non-tabular prose reports, legal agreements, or narrative memos (use `docx` or `pdf`).
- Slide presentations or pitch materials (use `pptx`).
- General conversational Q&A where no tabular spreadsheet output is desired.

---

## 3. Understand & Inspect Existing Files

### A. Provider File Adapter & Extracted Representation
Uploaded spreadsheets (.xlsx) are ingested via ArcNave's Provider File Adapter as extracted text/tabular document representation. When extracted sheet data is present in context, answer factual questions ("What was the total operating expense in 2025?") directly from this extracted representation without unnecessary tool calls. Do not imply or expect that providers consume raw binary OpenXML spreadsheet files natively.

### B. Deterministic Structural Inspection
When programmatic workflows require exact sheet names, row counts, or cell type profiles:
- Call the `inspectSpreadsheet` tool with the file's `fileId` to obtain:
  - `sheetNames`: Array of active worksheet names.
  - `totalRows`: Total row count across sheets.
  - `cellTypes`: Dictionary mapping cell addresses (`Sheet!A1`) to value types (`number`, `string`, `formula`, `date`, `boolean`).

---

## 4. Create New File

### Approach A: Format-Native `StructuredWorkbook` (Recommended)
For structured data, accounting sheets, and financial models, construct a `StructuredWorkbook` object passed to `generate_deliverable(format: 'xlsx', workbook: ...)`:
- `sheets`: Array of worksheet objects, each containing:
  - `name`: Clean sheet name (e.g. `'Summary'`, `'Transactions'`).
  - `columns`: Array of `{ key: string, label: string, type: string, format?: string, width?: number }`.
  - `rows`: Array of `{ cells: { [colKey]: { value: TypedValue, source?: SourceReference } } }`.
- **Explicit Typed Values**:
  - `number`: `{ type: 'number', value: 12500, format: '$#,##0.00' }`
  - `date`: `{ type: 'date', value: '2026-03-31', format: 'YYYY-MM-DD' }`
  - `formula`: `{ type: 'formula', value: '=SUM(C2:C10)' }`
  - `integer`, `boolean`, `string`, `null`.
  - **NEVER** stringify numbers or dates into dead text.

### Approach B: Markdown Tables with `# SheetName` Headings
For simple spreadsheets:
- Use `# SheetName` headings in Markdown, followed by GFM tables.
- Call `generate_deliverable(format: 'xlsx', title, content)`.

### Formula Conventions (Mandatory)
- **Formulas First**: Calculations producing an outcome the user sees in the sheet must be explicit UPPERCASE formulas (e.g. `=SUM(B2:B10)`, `=AVERAGE(C2:C20)`, `=B2*C2`, `=IF(D2>0, D2*0.1, 0)`), NEVER hardcoded dead numbers.
- Users must be able to click any cell and inspect its mathematical derivation.
- Formula names must be strictly UPPERCASE.

---

## 5. Edit Existing File & Format-Preserving Operations

### Targeted Cell Editing (`editSpreadsheetCells`)
When modifying an existing workbook (e.g. updating an assumption, changing a cell value, inserting a formula):
- Call the `editSpreadsheetCells` tool with `fileId` and `edits`:
  - `edits`: Array of `{ sheet: string, cell: string, value: unknown, type?: string, format?: string }`.
  - Example: `[{ sheet: 'Q1', cell: 'B8', value: 15000, type: 'number', format: '$#,##0' }, { sheet: 'Q1', cell: 'B9', value: '=B8*1.1', type: 'formula' }]`.
- **Preservation Principle**: Preserves all untouched sheets, formulas, cell styles, fonts, and grid dimensions intact. **Do NOT convert an existing workbook to Markdown and rebuild it from scratch.**

---

## 6. Multi-File Operations & Deduplication

### Combining Workbooks (`combineWorkbooks`)
- Call the `combineWorkbooks` tool with `fileIds` to merge sheets from multiple workbooks into a single consolidated workbook.
- Name collisions are automatically disambiguated (e.g. `Data` and `Data_2`).

### Chunk Deduplication Rule
- **Preserve Legitimate Duplicates**: Legitimate identical data rows (e.g. multiple distinct $50 deposits on the same day) must **ALWAYS** be preserved.
- **Provenance Deduplication Only**: Deduplicate rows **ONLY** when proven by identical source provenance (`attachmentId:page:sheet:table:row`) across chunk boundaries. Never deduplicate solely by matching cell values.

---

## 7. Cross-Skill Transformations

No single skill owns an entire cross-format workflow. The source skill extracts; the target skill structures and renders.

### PDF / Document $\to$ XLSX
1. **Source Phase (`pdf` / `docx`)**: Understand the source document and extract table headers, row values, and dates.
2. **Target Phase (`xlsx`)**: Map extracted data into a `StructuredWorkbook` with typed numbers, dates, and uppercase formulas.
3. **Render Phase**: Call `generate_deliverable(format: 'xlsx', workbook: ...)`.
4. **NEVER** pass raw PDF `sourceAttachmentId` directly into `generate_deliverable` expecting automatic binary conversion without structured parsing.

---

## 8. Execution Strategy

- **MODEL decides WHAT**: Selects rows, columns, and financial calculations.
- **SKILL teaches HOW**: Enforces typed values, uppercase formulas, and targeted edits.
- **ExecutionRuntime performs deterministic work**: Executes native Excel operations and format renderers.
- **Chat is the Cover Note**: In chat, summarize key metrics, sheet names, and formula totals in 1–2 concise paragraphs. Direct the user to the generated spreadsheet; do NOT dump raw cell grids into chat.

---

## 9. Validation & Repair Loop

- Generated workbooks undergo post-generation verification (valid OpenXML zip package, worksheets load cleanly in ExcelJS, formulas parse without syntax errors, date types are native Date instances, numbers are numeric).
- **Repair Loop**: If a tool reports a schema or column warning (`status: 'warning'`, `repairable: true`), evaluate the missing column or type mismatch and make a corrective tool call with the updated schema.

---

## 10. Warnings & Limitations

- **No Magic Binary Conversion**: `generate_deliverable` requires structured markdown or `StructuredWorkbook` upstream; it does not transcode binary source files directly.
- **Charts**: `generate_deliverable` does not make Excel charts. For a native chart in the file, build
  it in `run_python` with `openpyxl` (`openpyxl.chart`) and save the workbook to `output/`. For a
  chart shown in the chat, use `render_ui`.
- **No External Links**: Formulas referencing external workbooks (`='[other.xlsx]Sheet1'!A1`) are unsupported.

---

## 11. Available Resources & Scripts

- This skill has no scripts or templates. For analysis beyond the tools, `run_python` has
  pandas, openpyxl, xlrd and xlsxwriter; the file is in `input/`.
