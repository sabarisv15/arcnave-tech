---
name: docx
version: 2.0.0
description: Professional Word document structure, heading hierarchy, callouts, targeted OOXML editing, and format-native Word deliverable generation.
category: artifact
scope: builtin
requires:
  tools:
    - generate_deliverable
  capabilities:
    - artifact.export.docx
autoload: false
metadata:
  source: arcnave
---

# Professional Document (DOCX) Authoring & Deliverable Architecture

Procedural knowledge for creating, formatting, inspecting, and editing professional Word documents (.docx). Covers OpenXML package preservation, heading hierarchies, styled tables, executive callouts, and targeted text replacements.

---

## 1. When to Use This Skill

- Generating formal Word documents, executive summaries, whitepapers, legal agreements, memos, or consulting reports.
- Modifying or replacing specific text runs in an existing `.docx` document (`editDocxContent`).
- Appending new sections or paragraphs to an existing Word document (`appendDocxSection`).
- Inspecting structural properties (paragraph counts, table counts, headings) of an uploaded `.docx` (`inspectDocxStructure`).
- Converting extracted document notes or research findings into a formatted `.docx` deliverable.

---

## 2. When NOT to Use This Skill

- Tabular accounting models or spreadsheets (use `xlsx`).
- Slide presentations or visual pitch decks (use `pptx`).
- Fixed-layout printable audit reports where exact page budgeting must be rigid (use `pdf`).

---

## 3. Understand & Inspect Existing Files

### A. Provider File Adapter & Extracted Document Representation
Uploaded Word documents (.docx) are ingested via ArcNave's Provider File Adapter as extracted text/document blocks. For reading, analyzing, or summarizing the content of an uploaded Word document, the adapter's extracted document representation is sufficient. Answer directly from the provided document context without unnecessary tool calls. Do not expect providers to consume raw OOXML binary packages natively for comprehension.

### B. Deterministic Structural Inspection
When programmatic workflows require exact paragraph counts, table counts, or section headings:
- Call `inspectDocxStructure(inputBuffer)` to obtain:
  - `paragraphsCount`: Total `<w:p>` paragraph elements.
  - `tablesCount`: Total `<w:tbl>` table structures.
  - `headings`: Extracted document headings from Heading styles or lead paragraphs.

---

## 4. Create New File

When the user asks to write, draft, or export a Word document:
1. Construct structured Markdown with headings (`#`, `##`, `###`), formatted body text, callouts (`> `), and tables.
2. Call `generate_deliverable` with:
   - `format`: `'docx'`
   - `title`: Clean document title (e.g. `"Market_Expansion_Strategy"`, `"Executive_Brief"`)
   - `content`: Complete, structured Markdown content.

### Formatting & Layout Standards
ArcNave's format-native Word engine (`docxRenderer`) compiles Markdown to OpenXML structures:
- **Heading Hierarchy**: Maintain strict, unbroken heading levels (`# Title`, `## Heading 1`, `### Heading 2`). Never jump directly from `#` to `###`.
- **Typography & Clean Layout**: Compiles with clean typography (Aptos / Calibri / Segoe UI) and standard 1-inch margins (1440 twips).
- **Executive Callouts**: Format takeaways with blockquotes (`> `). Rendered with distinctive accent bars and shaded background fills.
- **Data Tables**: Every table must have a distinct header row. Right-align numeric columns; left-align text. Alternating row shading and cell padding are automatically applied.
- **Lists**: Use structured bulleted (`- `) or numbered (`1. `) lists. Keep nesting $\le 2$ levels.

---

## 5. Edit Existing File & Format-Preserving Operations

### A. Targeted Content Replacement (`editDocxContent`)
When editing an existing uploaded `.docx` (e.g. replacing company names, updating terms, fixing dates, updating clauses):
- Use `editDocxContent(inputBuffer, replacements)`:
  - `replacements`: Array of `{ search: string, replace: string }`.
- **Preservation Principle**: Edits `word/document.xml` in place while preserving the entire existing OOXML package, including styles, fonts, margins, header/footer relationships, and embedded media. **Never rebuild an existing document from scratch if a targeted edit is requested.**

### B. Appending Content (`appendDocxSection`)
- Use `appendDocxSection(inputBuffer, heading, paragraphs)` to append new sections and paragraphs before `</w:body>` without disturbing prior document sections.

---

## 6. Multi-File Operations

- When synthesizing findings from multiple source files, extract core takeaways and compile into the target document via `generate_deliverable`.
- For appending multiple sections sequentially, chain `appendDocxSection`.

---

## 7. Cross-Skill Transformations

No single skill owns an entire cross-format workflow. The source skill extracts; the target skill structures and renders.

### DOCX $\to$ PPTX (Document to Presentation)
1. **Source Phase (`docx`)**: Inspect headings and paragraphs to extract executive themes, metrics, and takeaways.
2. **Target Phase (`pptx`)**: Map sections onto slide cards adhering to the $\ge$14pt typography floor.
3. **Render Phase**: Call `generate_deliverable(format: 'pptx', title, content)`.

### DOCX $\to$ PDF
Extract or verify Markdown content, then invoke `generate_deliverable(format: 'pdf', title, content)`.

---

## 8. Execution Strategy

- **MODEL decides WHAT**: Authors narrative content, legal terms, and analytical sections.
- **SKILL teaches HOW**: Enforces unbroken heading hierarchies, callout styling, and targeted XML edits.
- **ExecutionRuntime performs deterministic work**: Executes native Word operations and format renderers.
- **Chat is the Cover Note**: In chat, summarize what changed or highlight key findings in 1–2 concise paragraphs. Direct the user to the generated `.docx` deliverable; do NOT dump the entire document text into chat.

---

## 9. Validation & Repair Loop

- Generated documents undergo post-generation verification (valid ZIP archive containing `[Content_Types].xml` and `word/document.xml`, clean OpenXML tag closure, non-empty body).
- **Repair Loop**: If a validation warning occurs, adjust the input structure and issue a corrective tool call.

---

## 10. Warnings & Limitations

- **No Magic Binary Conversion**: `generate_deliverable` requires structured markdown upstream; it does not transcode binary source files directly.
- **No Tracked Changes or Comments**: Tracked changes and comment authoring are not currently supported by native operations.
- **No External CLI Dependencies**: ArcNave does NOT use `Pandoc` or `LibreOffice`. All operations rely on native `docx` and JSZip libraries.

---

## 11. Available Resources & Scripts

- No external script or template files currently exist in this skill package (`scripts = 0`, `templates = 0`). All operations run via native runtime functions.
