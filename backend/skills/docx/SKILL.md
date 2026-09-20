---
name: docx
version: 1.0.0
description: Professional Word document structure, formatting, typography, callouts, and clean layout guidelines.
category: artifact
requires:
  tools:
    - artifact.docx
autoload: false
metadata:
  source: arcnave
---

# Professional Document (DOCX) Authoring

Use this skill when designing, structuring, or preparing content for Word documents (.docx) or formal reports.

## Core Principles

- **Structural Hierarchy**: Use clear headings (Title, Heading 1, Heading 2, Heading 3). Keep heading nesting strictly sequential.
- **Typography & Consistency**:
  - Prefer clean, readable typefaces.
  - Body text should maintain comfortable line spacing and paragraph margins.
  - Avoid excessive decorative font variations.
- **Tables & Data Layout**:
  - Every table must have an explicit header row.
  - Set distinct column widths to avoid awkward line breaks in narrow cells.
  - Numeric columns must be right-aligned; text columns must be left-aligned.
  - Use subtle borders and light shading for alternating or header rows.
- **Visual Callouts & Quotes**:
  - Format callouts with a subtle left accent bar and light background.
  - Highlight key takeaways, executive summaries, or warning notices cleanly.
- **Lists**:
  - Use structured bulleted or numbered lists for sequential steps or enumerations.
  - Keep list items concise and parallel in grammatical form.

## Capability & Output Guidance

- **When `artifact.docx` tool is available**: You may generate and export the formatted `.docx` binary artifact.
- **When in `guidance_only` mode (tool not present)**: Do not claim that a `.docx` file has been downloaded or created on disk. Instead, produce the complete, professionally formatted document content in Markdown with structural annotations so the user or document exporter can render it into Word.
