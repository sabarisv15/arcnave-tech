---
name: docx
version: 1.1.0
description: Professional Word document structure, formatting, typography, callouts, and clean layout guidelines.
category: artifact
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

Use this skill when designing, structuring, or preparing content for Word documents (.docx) or formal reports.

## Core Principles

- **Structural Hierarchy**: Use clear headings (Title, Heading 1, Heading 2, Heading 3). Keep heading nesting strictly sequential.
- **Typography & Consistency**:
  - Prefer clean, readable formatting.
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

- **Creating the Document**: Call the `create_artifact` tool with `kind: 'document'` and the complete Markdown content. This creates the editable workspace artifact and displays it in the side panel.
- **Exporting to Word (.docx)**: ArcNave's document export layer converts the artifact's Markdown headings, paragraphs, bullet lists, and tables into a real `.docx` file for the user to download.
- **Never Tell Users to Copy-Paste**: When the user requests a Word document, report, or file deliverable, do NOT paste raw text into chat with "copy and paste this into Word". Always invoke `create_artifact`.
