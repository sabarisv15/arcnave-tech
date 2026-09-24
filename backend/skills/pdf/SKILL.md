---
name: pdf
version: 2.1.0
description: PDF document understanding, page inspection, splitting, merging, and format-native print deliverable generation.
category: artifact
scope: builtin
requires:
  tools:
    - generate_deliverable
  capabilities:
    - artifact.export.pdf
autoload: false
metadata:
  source: arcnave
---

# PDF Document Intelligence & Deliverable Architecture

Procedural knowledge for handling PDF documents in ArcNave: native document understanding, metadata inspection, deterministic page extraction (splitting), document combination (merging), and format-native PDF deliverable generation.

---

## 1. When to Use This Skill

- Reading, analyzing, or summarizing uploaded PDF documents, invoices, or bank statements.
- Exact counts, totals or complete row lists from PDF tables, scanned or digital (section 3B).
- Inspecting PDF page count and document metadata (`inspectPdf`).
- Merging multiple PDF files into a single unified document (`mergePdfFiles`).
- Extracting specific page ranges or splitting pages (`splitPdfFile`).
- Generating print-ready, multi-page PDF reports or compliance briefs via `generate_deliverable(format: 'pdf', title, content)`.
- Extracting structured tabular data from PDF statements before handing off to `xlsx` or other downstream skills.

---

## 2. When NOT to Use This Skill

- The user asks for an editable Word document (`docx`), spreadsheet (`xlsx`), or presentation (`pptx`).
- General chat Q&A where no PDF input or output is involved.
- In-place text editing inside a compiled, fixed-layout PDF. (PDF text runs are raw vector/glyph coordinates; use DOCX for editable prose or regenerate the PDF from source markdown).

---

## 3. Understand & Inspect Existing Files

### A. Provider-Native Direct Understanding
When the user asks questions or requests a summary of an uploaded PDF ("What is the total revenue in this invoice?", "Summarize page 2"):
- The AI model receives the document directly via the Provider File Adapter (provider-native multimodal/document representation where supported).
- **No tool call is necessary.** Answer directly from native vision/understanding.
- Do NOT invoke execution tools or Python simply to read or summarize a PDF.

### B. Exact and Exhaustive Work — Counting, Totals, "Every Row"
Native reading is fine for a summary. It is **not** enough when the answer is a number that must
be exact or a list that must be complete: "count every transaction", "how many rows", "total of
the debit column", "list every entry", "classify all of them". A model reading a page image can
skip or merge a row without noticing. For these tasks:

1. Find the extraction tool with `search_tools` (e.g. "extract table rows") and call
   `extract_scanned_table_rows(fileId)`. It works on scanned PDFs with no text layer, reads every
   page, and returns rows `{page, rowIndex, cells, confidence}` plus an `extractionId`.
2. Check the result before using it:
   - `complete` must be true. If `failedPages` or `missingPages` is non-empty, call the tool
     again for those pages with the same `extractionId`. Never answer as if they were read.
   - `lowConfidenceRows` and `possibleDuplicates` must be looked at and mentioned to the user.
3. Decide what each column means from `header` and the rows (date, description, debit,
   credit, balance, name…). That understanding is yours; the counting is not.
4. Compute every count and total with `analyze_table_rows(extractionId, operations)`. Never
   count rows by reading them yourself. For a classification ("with a party name / without"),
   use one `classify` operation: write each category as a rule (label, reason, `where`
   filters), leave anything no rule covers as `UNKNOWN`, and use `capture` to pull the name
   only where the text states it (an IFSC or account number alone is not a name). Report the
   per-label counts it returns, which always add up to its total, and the rules you used.
   When one PDF holds several statements, select each with a `pageFrom`/`pageTo` filter and
   report each separately as well as combined.
5. Reconcile against the document's own figures whenever it prints any:
   - a printed count or total → pass it as `expected` on the matching `count` / `sum`;
   - a running balance column → run `running_balance` (previous balance + credits − debits =
     balance).
6. If a check fails, the extraction is suspect, not the document. Re-extract the
   `suspiciousPages` with `pages` and the same `extractionId` (they are re-read at higher
   resolution), then analyze again. Repeat at most twice.
7. In the answer, give the computed figures, which checks passed, and anything that stayed
   unreconciled or low-confidence, with page numbers. If a figure could not be verified, say so;
   do not present it as exact.

### C. Deterministic Structural Inspection
When programmatic workflows require exact page counts or metadata:
- Use the Skill operation `inspectPdf(inputBuffer)` to obtain:
  - `pageCount`: Total page count.
  - `title`: Embedded document title (if present).
  - `author`: Embedded document author (if present).

---

## 4. Create New File

When the user asks to generate, export, or print a PDF deliverable:
1. Construct structured Markdown with headings (`#`, `##`, `###`), body paragraphs, callouts (`> `), and GFM tables.
2. Call `generate_deliverable` with:
   - `format`: `'pdf'`
   - `title`: Document filename (e.g. `"Quarterly_Audit_Report"`, `"System_Architecture_Overview"`)
   - `content`: Complete Markdown content.

### Native PDF Engine Standards
ArcNave's format-native renderer (`pdfRenderer`) handles:
- **Embedded Unicode TrueType Fonts**: Supports native currency symbols (₹, $, €, £), smart quotes, and accented characters.
- **Multi-Page Table Layout**: Automatically calculates column widths and repeats bold header rows across page breaks.
- **Page Budgeting & Footers**: Automatically balances vertical spacing and applies running "Page X of Y" footers.
- **Executive Callouts**: Renders `> ` blockquotes with distinct left accent bars and shaded fills.

---

## 5. Edit Existing File & Format-Preserving Operations

### A. Fixed-Layout Reality
PDF is a compiled, fixed-layout vector format. It lacks reflowable paragraphs or XML DOM trees. Do NOT attempt arbitrary regex search-and-replace on raw PDF bytes.

### B. Format-Preserving Page Operations
When modifying existing PDF files, preserve unaffected pages and vector structures intact:
- **Split / Extract Pages**: Use `splitPdfFile(inputBuffer, pageRanges)` where `pageRanges` is an array of 1-indexed `[startPage, endPage]` tuples (e.g. `[[1, 3], [5, 5]]`). Vector graphics, embedded fonts, and page elements are preserved with zero re-encoding loss.
- **Merge Documents**: Use `mergePdfFiles(inputBuffers)` to concatenate native PDF buffers sequentially without re-rasterization.
- **Extensive Revision**: If the textual content must be significantly rewritten, extract the text/data to Markdown and compile a new version via `generate_deliverable`.

---

## 6. Multi-File Operations

- **Combining Multiple PDFs**: Collect buffers in the desired sequence and execute `mergePdfFiles`.
- **Workspace Isolation**: When working with multiple uploaded files with identical filenames, rely on `ExecutionRuntime` workspace materialization (`materializeInputFiles`) to maintain scoped, distinct filesystem paths.

---

## 7. Cross-Skill Transformations

No single skill owns an entire cross-format workflow. The source skill handles understanding/extraction; the target skill handles structuring and rendering.

### PDF $\to$ XLSX (e.g. Bank Statement to Spreadsheet)
1. **Source Phase (`pdf`)**: Inspect the PDF and extract tabular transactions, column definitions, and dates via native model understanding.
2. **Target Phase (`xlsx`)**: Structure extracted records into a typed `StructuredWorkbook` with explicit cell types (`date`, `number`, `formula`), formatting (`$#,##0.00`), and source references (`provenance`).
3. **Render Phase**: Call `generate_deliverable(format: 'xlsx', workbook: ...)`.
4. **NEVER** pass raw PDF `sourceAttachmentId` directly into `generate_deliverable` expecting automatic conversion without upstream structured parsing.

### PDF $\to$ DOCX / PPTX
1. Extract executive themes, narrative paragraphs, or data points from the PDF.
2. Format the extracted content as clean Markdown adhering to DOCX heading rules or PPTX slide card rules ($\ge$14pt font floor).
3. Call `generate_deliverable(format: 'docx' | 'pptx', title, content)`.

---

## 8. Execution Strategy

- **MODEL decides WHAT**: Evaluates user intent, plans workflow, and extracts semantic structures.
- **SKILL teaches HOW**: Provides domain rules, format constraints, and operation choices.
- **ExecutionRuntime performs deterministic work**: Executes isolated operations, sandboxes, and file generation.
- **Chat is the Cover Note**: In chat, summarize key findings in 1–2 concise paragraphs and direct the user to the generated deliverable. Do NOT dump massive walls of text or raw data grids into chat.

---

## 9. Validation & Repair Loop

- Generated deliverables undergo post-generation verification (valid PDF-1.4 header, uncorrupted cross-reference tables, non-empty pages, valid fonts).
- **Repair Loop**: If a tool returns `status: 'warning'` and `repairable: true`, evaluate the diagnostic and issue a corrective tool call (e.g. adjust page ranges, fix table columns) rather than simply apologizing or outputting a text explanation.

---

## 10. Warnings & Limitations

- **No Magic Binary Conversion**: `generate_deliverable` is a renderer, not an arbitrary binary converter. Source attachments without extracted text must be parsed into structured markdown or `StructuredWorkbook` upstream.
- **No In-Place PDF Text Editing**: Compiled PDF text runs cannot be edited like Word documents; use `splitPdfFile`/`mergePdfFiles` for page-level modifications.
- **Page rendering for extraction** uses `pdftoppm` as a trusted CLI in the execution sandbox (no network). Page reading is done by a vision model called from the backend, so extracted rows are probabilistic until reconciled.

---

## 11. Available Resources & Scripts

- `scripts/normalize_table_rows.py`: deterministic post-processing behind `extract_scanned_table_rows` (normalise cells, drop repeated header rows across pages, index rows, flag low-confidence, ragged and possibly duplicated rows).
- `scripts/analyze_table_rows.py`: deterministic `count`, `sum` and `running_balance` behind `analyze_table_rows`.
- Both run as trusted skill scripts in the sandbox; you call them through the tools, not directly.
