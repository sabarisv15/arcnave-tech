---
name: pdf
version: 1.0.0
description: Print-ready reports, multi-page layout, pagination, table of contents, and visual headers.
category: artifact
requires:
  tools:
    - artifact.pdf
autoload: false
metadata:
  source: arcnave
---

# Printable Document (PDF) Report Architecture

Use this skill when designing print-ready reports, whitepapers, academic papers, or formal deliverables intended for PDF export.

## Page Layout & Formatting Guidelines

- **Page Budget & Sections**:
  - Plan multi-page documents deliberately with distinct sections (Cover Page, Executive Summary, Table of Contents, Detailed Analysis, Appendices).
  - Prevent orphaned headings by ensuring new sections start with sufficient vertical headroom or page breaks.
- **Header & Footer Placement**:
  - Header: Document title or section name with subtle divider line.
  - Footer: Page numbering ("Page X of Y") and confidentiality / date note.
- **Table of Contents (TOC)**:
  - For documents exceeding 3 pages, include a concise Table of Contents reflecting the primary headings.
- **Visual Callout Boxes & Figures**:
  - Frame figures and charts with captions below ("Figure 1: Quarterly Performance Breakdown").
  - Use shaded callout boxes for key takeaways or methodology notes.

## Capability & Output Guidance

- **When `artifact.pdf` tool is available**: You may generate and export the `.pdf` deliverable.
- **When in `guidance_only` mode (tool not present)**: Do not claim a `.pdf` file was generated or downloaded. Render the formatted report in Markdown with explicit page break markers (`---` or `<!-- pagebreak -->`) and section headings.
