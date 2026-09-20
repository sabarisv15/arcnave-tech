---
name: artifact-design
description: Design principles, typography, tabular alignment, and visual standards for creating high-fidelity ArcNave artifacts.
version: 1.0.0
category: presentation
scope: project
autoload: false
requires:
  tools:
    - create_artifact
  capabilities:
    - artifact.create
---

# Artifact Design Standards

When authoring standalone documents, forms, reports, or visual deliverables with `create_artifact`, adhere strictly to these visual and layout standards.

## 1. Document Structure & Typography

- **Hierarchy**: Use clear, consistent Markdown headers (`#` for document title, `##` for major sections, `###` for sub-sections).
- **Executive Summary / Header Block**: Begin formal documents with metadata or an executive summary before diving into details.
- **Lists & Declarations**: Separate distinct clauses, terms, or applicant declarations with clear numbering. Avoid concatenating multiple clauses into single run-on paragraphs.
- **Divider Spacing**: Use thematic breaks (`---`) sparingly to separate major chapters. Do not spam horizontal dividers between individual bullet items.

## 2. Tabular Fidelity & Alignments

- **GFM Pipe Tables**: Always render structured data in standard GitHub Flavored Markdown (GFM) pipe table syntax.
- **Headers & Alignments**:
  - Always include a header row and separator line (`|---|---|`).
  - Align numeric data to the right (`|---:|`), status/date to the center (`|:---:|`), and text to the left (`|:---|`).
- **No Lost Content**: When converting government forms, tabular applications, or spreadsheets into an artifact, ensure every single column and row is preserved.

## 3. Theming & Code Blocks

- Use standard code block fences (```` ```ts ````, ```` ```python ````, ```` ```html ````) with explicit language specifiers for syntax highlighting.
- Avoid raw HTML unless authoring an artifact of `kind: "webpage"`.
