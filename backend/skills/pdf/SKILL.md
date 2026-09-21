---
name: pdf
version: 1.2.0
description: Print-ready reports, multi-page layout, pagination, table of contents, and visual headers.
category: artifact
scope: builtin
requires:
  tools:
    - create_artifact
  capabilities:
    - artifact.export.pdf
autoload: false
metadata:
  source: arcnave
---

# Printable Document (PDF) Report Architecture

Use this skill whenever designing print-ready reports, whitepapers, compliance documents, research papers, or formal deliverables intended for fixed-page document layout.

## Page Layout & Formatting Guidelines (ArcNave & PDF Standards)

- **Deliverable vs Cover Note**: The PDF document is the deliverable; chat is the cover note. In chat, summarize the document's core findings and direct the user to the generated PDF.
- **Page Budget & Structural Sections**:
  - Plan multi-page documents deliberately with distinct sections:
    1. Cover Page / Title Block.
    2. Executive Summary / Abstract.
    3. Table of Contents (for documents exceeding 3 pages).
    4. Detailed Analysis & Core Content.
    5. Findings, Recommendations, and Appendices.
  - Prevent orphaned headings by ensuring new sections start with sufficient vertical headroom.
- **Header & Footer Placement**:
  - Header: Document title or active section name with a subtle divider rule.
  - Footer: Clean page numbering ("Page X of Y"), generation date, and confidentiality status.
- **Data Tables & Visual Elements**:
  - Format data tables with clear borders and bold headers.
  - For long tables spanning multiple pages, maintain column alignment and repeated header structure.
  - Frame figures, charts, and diagrams with concise captions underneath.
- **Visual Callout Blocks**:
  - Use shaded callout boxes (`> ` blockquotes in Markdown) with left accent borders for executive takeaways, methodological assumptions, or critical notices.

## ArcNave Runtime Deliverable Execution

ArcNave provides a dedicated, native `.pdf` binary generation engine powered by `pdf-lib` (`generate_deliverable`).

### Mode A: Direct PDF Generation
When the user asks to generate or print a PDF deliverable:
1. Construct structured Markdown with headings (`#`, `##`, `###`), body paragraphs, callout quotes (`> `), and data tables.
2. Call `generate_deliverable` with:
   - `format`: `'pdf'`
   - `title`: Document filename (e.g. `"Quarterly_Audit_Report"`, `"System_Architecture_Overview"`)
   - `content`: Complete Markdown content.

### Mode B: Source File Conversion (e.g. Markdown / Document → PDF)
When the user asks to convert an uploaded document or file into a PDF:
1. Inspect the uploaded file using `read_uploaded_file` if needed.
2. Call `generate_deliverable` with:
   - `format`: `'pdf'`
   - `sourceAttachmentId`: The UUID of the uploaded file.
   - `instructions`: Clear formatting directions for the PDF output.
3. Do NOT route standard PDF generation to Python; use `generate_deliverable`.

### Verification Checklist Before Responding
- Does the document structure follow standard page budgeting (Title, Executive Summary, Analysis)?
- Are headers, footers, and page numbers properly planned?
- Are tables and callouts formatted cleanly with no syntax artifacts?
- Does the final chat response offer a concise summary and download link?
