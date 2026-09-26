---
name: pdf
version: 3.1.0
description: "Use when a task needs PDF procedure beyond reading pages already shown: exact text or table extraction, counting or totalling rows, classifying entries, scanned or photographed PDFs, converting a PDF to Excel/Word, splitting, merging, or creating a PDF. Not needed to answer a question from a PDF already in the conversation."
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

### A. What You Already See
When the user asks questions or requests a summary of an uploaded PDF ("What is the total revenue in this invoice?", "Summarize page 2"):
- A PDF of up to 100 pages reaches you as an image of every page plus that page's text. Past 100
  pages you get its text only: images, charts and scanned pages in it are not shown to you. The
  attachment says which.
- **No tool call is necessary** to read or summarize what you can see. Answer directly.
- For a text-only PDF, a scanned page, or a figure you need, open the file in `run_python`
  (it is in `input/`) and render the page into `view/` to look at it.

### B. Exact and Exhaustive Work — Counting, Totals, "Every Row"
Native reading is fine for a summary. It is **not** enough when the answer must be exact or
complete: "count every transaction", "total of this column", "list every entry", "classify all
of them". Reading a page can skip, merge or misread a row without noticing. Exact work is done
the way a careful person does it: write every record down, check the records against the
document's own figures, and compute answers from the checked records. This applies to any
document: statements, invoices, registers, mark sheets, bills of quantities.

The file is already in run_python's working directory (its `run_python path` is on its
attachment line). On this chat's sandbox, files you write there stay for the rest of the
conversation; the `run_python` description says so when they do.

1. **Find out what kind of PDF it is**, in one call: page count and whether each page has a
   text layer (`pymupdf`: `len(page.get_text().strip())`).
2. **Transcribe every record into a file**, with named fields, never column positions.
   - Decide the fields from the document (e.g. date, description, debit, credit, balance; or
     item, qty, rate, amount) and give every record a `kind`: `data`, `opening`, `subtotal`,
     `total` or `header`, plus its `page`. Only `data` records are counted.
   - **Text layer present:** extract with `pdfplumber` (tables or words by position) in code.
   - **Scanned (no text layer):** you can see the pages. Read them yourself, a few pages per
     call, and write the records into the file with code (e.g. append to `rows.json`). Do not
     rely on tesseract for figures on photographed or scanned pages: its digits are unreliable,
     and each unusable OCR attempt costs a tool round. When a value is hard to read, render
     just that region at 200–300 dpi into `view/` (`page.get_pixmap(dpi=250, clip=rect)`) and
     look at it.
   - If a layout changes between pages (a column missing or merged), the field names stay the
     same; only where you read them from changes.
3. **Check the records against the document itself**, in code, before answering. Use every
   check the document offers:
   - a running balance: previous balance + credits − debits = balance, on every row;
   - printed totals, counts, opening/closing balances;
   - arithmetic inside a row (qty × rate = amount) and column sums;
   - records per page against what the page shows.
   A failed check means a record is wrong, not the document. Look at those rows again (crop
   into `view/`), fix the record, and re-run the checks. Never adjust a number to make a
   check pass without looking.
4. **Compute every answer in code from the checked file**: counts, sums, per-group splits,
   classifications. For a classification, write the rules down (label, condition, reason), apply
   them in code, keep anything no rule covers as `UNKNOWN`, and report the rules with the counts.
   When one PDF holds several documents (two bank statements), keep a `source` field and report
   each separately as well as combined.
5. **Answer with the evidence**: the figures, which checks passed, and anything unreconciled
   (page and row). If something could not be verified, say so; do not present it as exact.
6. **Budget.** A turn has a limited number of tool rounds. If one approach fails twice (e.g.
   OCR output is unreadable), switch approach instead of retrying it. Batch several pages per
   call.
7. Do not print more than about 50 rows in chat. Give counts, totals and a few examples; when
   the user needs the full list, write it to `output/` as a spreadsheet (or use
   `generate_deliverable` with format `xlsx`) and point to the file.

`extract_scanned_table_rows` / `analyze_table_rows` are an older path. Use them only when
run_python is not available, and verify their result the same way (step 3).

### C. Deterministic Structural Inspection
When programmatic workflows require exact page counts or metadata:
- Call the `inspectPdf` tool with the file's `fileId` to obtain:
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
- **Split / Extract Pages**: Call `splitPdfFile` with `fileId` and `pageRanges`, an array of 1-indexed `[startPage, endPage]` pairs (e.g. `[[1, 3], [5, 5]]`). Vector graphics, embedded fonts, and page elements are preserved with zero re-encoding loss.
- **Merge Documents**: Call `mergePdfFiles` with `fileIds` in the order wanted (at least 2). Pages are concatenated without re-rasterization.
- **Extensive Revision**: If the textual content must be significantly rewritten, extract the text/data to Markdown and compile a new version via `generate_deliverable`.

---

## 6. Multi-File Operations

- **Combining Multiple PDFs**: Call `mergePdfFiles` with the `fileIds` in the desired sequence.
- **Same filename twice**: each file has its own `run_python path` on its attachment line (a
  duplicate name gets part of its fileId added). Use that path, or the `fileId` for tools.

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
- **`extract_scanned_table_rows`** renders pages with `pdftoppm` and has a vision model read them, so its rows are probabilistic until reconciled (section 3B, step 3).

---

## 11. Available Resources & Scripts

- `scripts/normalize_table_rows.py`: deterministic post-processing behind `extract_scanned_table_rows` (normalise cells, drop repeated header rows across pages, index rows, flag low-confidence, ragged and possibly duplicated rows).
- `scripts/analyze_table_rows.py`: deterministic `count`, `sum` and `running_balance` behind `analyze_table_rows`.
- Both are run for you by those two tools. Do not run or read them directly: they expect the
  tools' input format, not command-line arguments.
