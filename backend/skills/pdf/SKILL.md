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

- **Current ArcNave Capability**: ArcNave does not currently have a native `.pdf` binary export engine (only `.docx`, `.xlsx`, and `.pptx` are directly exportable).
- **Recommended Workflow**: Call `create_artifact` to create a `document` artifact. The user can export it as a Word `.docx` file and convert/print to PDF from Word or their browser, or read the formatted document in the ArcNave workspace.
- **Do Not Claim PDF File Creation**: Do not claim that a `.pdf` file was downloaded or created on disk.
