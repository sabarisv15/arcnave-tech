---
name: pdf
version: 1.1.0
description: Print-ready reports, multi-page layout, pagination, table of contents, and visual headers.
category: artifact
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

Use this skill when designing print-ready reports, whitepapers, academic papers, or formal deliverables intended for printable document layout.

## Page Layout & Formatting Guidelines

- **Page Budget & Sections**:
  - Plan multi-page documents deliberately with distinct sections (Cover Page, Executive Summary, Table of Contents, Detailed Analysis, Appendices).
  - Prevent orphaned headings by ensuring new sections start with sufficient vertical headroom or section dividers.
- **Header & Footer Placement**:
  - Header: Document title or section name with subtle divider line.
  - Footer: Page numbering ("Page X of Y") and confidentiality / date note.
- **Table of Contents (TOC)**:
  - For documents exceeding 3 pages, include a concise Table of Contents reflecting the primary headings.
- **Visual Callout Boxes & Figures**:
  - Frame figures and tables with captions below.
  - Use shaded callout boxes for key takeaways or methodology notes.

## Capability & Output Guidance

- **Native ArcNave PDF Export**: ArcNave provides a dedicated, native `.pdf` binary export engine powered by `pdf-lib`.
- **Workflow**:
  - Call `create_artifact` with `kind: 'document'` structured with Markdown headings, paragraphs, bullet points, callout blockquotes (`> `), and data tables.
  - The document can be exported directly to a print-ready `.pdf` file with standard margins, wrapped paragraphs, callout accent lines, and data tables.
- **Deliverable vs Cover Note**: The PDF document is the deliverable; chat is the cover note. In chat, summarize the document's core findings and direct the user to the artifact.
