---
name: docx
version: 1.2.0
description: Professional Word document structure, formatting, typography, callouts, and clean layout guidelines.
category: artifact
scope: builtin
requires:
  tools:
    - create_artifact
  capabilities:
    - artifact.export.docx
autoload: false
metadata:
  source: arcnave
---

# Professional Document (DOCX) Authoring

Use this skill whenever authoring, converting, editing, or formatting formal Word documents (.docx), executive briefs, whitepapers, legal summaries, or structured reports.

## Core Principles (ArcNave & Word Standards)

- **Deliverable vs Cover Note**: The Word document is the deliverable; chat is the cover note. In chat, default to brevity (1-2 concise paragraphs or bullet highlights) leading with what changed, key findings, and document sections. Never dump the entire text of the document into chat.
- **Structural Hierarchy & Heading Order**:
  - Always maintain strict, sequential heading levels: Title `#`, Heading 1 `##`, Heading 2 `###`, Heading 3 `####`.
  - Never skip heading levels (e.g. do not jump directly from `#` to `###`).
  - Use sentence case for section titles unless corporate branding requires title case.
- **Typography & Clean Layout**:
  - ArcNave's DOCX export engine compiles Markdown elements to clean, standards-compliant OpenXML structures using standard typography (Segoe UI, Aptos, Calibri).
  - Standard 1-inch margins (1440 twips) on all sides.
  - Body paragraphs maintain comfortable line spacing and distinct paragraph spacing without redundant blank lines.
- **Data Tables & Alignment**:
  - Every table must have an explicit header row.
  - Right-align numeric columns (totals, amounts, metrics); left-align text and description columns.
  - Tables automatically receive styled headers, cell padding, and alternating row fills.
  - Avoid ragged or unclosed table rows.
- **Visual Callouts & Quotes**:
  - Format callouts with `> ` blockquotes in Markdown.
  - Callout blocks render with a distinctive accent bar and shaded background fill.
  - Use callouts for Executive Summaries, Key Takeaways, Action Items, or Important Notices.
- **Lists & Enumerations**:
  - Use structured bulleted or numbered lists for sequential steps or enumerations.
  - Keep list items concise and parallel in grammatical form.
  - Avoid nested lists exceeding 2 levels of indentation.

## ArcNave Runtime Deliverable Execution

ArcNave provides a dedicated, native document generation engine (`generate_deliverable`).

### Mode A: Direct Document Generation
When the user asks to write or draft a Word document or report:
1. Construct well-structured Markdown containing clear headings (`#`, `##`, `###`), formatted paragraphs, callout quotes (`> `), and tables.
2. Call `generate_deliverable` with:
   - `format`: `'docx'`
   - `title`: Clean document title (e.g. `"Market_Expansion_Strategy"`, `"Executive_Brief"`)
   - `content`: Complete, structured Markdown content.
   - `saveAsArtifact`: Set to `true` if the user explicitly requested an editable workspace artifact alongside the file.

### Mode B: Source File Conversion (e.g. PDF → Word)
When the user asks to convert an uploaded PDF or document into Word:
1. Inspect the source attachment using `read_uploaded_file` if layout clarification or section extraction is required.
2. Call `generate_deliverable` with:
   - `format`: `'docx'`
   - `sourceAttachmentId`: The UUID of the uploaded PDF or file.
   - `instructions`: Specific guidance if restructuring or styling is needed.
3. Do NOT route standard PDF → Word conversion to Python; use `generate_deliverable`.

### Verification Checklist Before Responding
- Does the document follow a clean, unbroken heading hierarchy?
- Are tables formatted with explicit headers and proper column alignments?
- Are key takeaways highlighted in callout blocks (`> `)?
- Is the chat response a tight cover note rather than a raw text dump?
