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

## Core Principles (Claude & Word Standards)

- **Deliverable vs Cover Note**: The document is the deliverable; chat is the cover note. In chat, default to brevity (1-2 concise paragraphs or a short bullet summary) leading with what changed and where to look. Never dump full document text into chat.
- **Structural Hierarchy**: Use clear headings (Title `#`, Heading 1 `##`, Heading 2 `###`). Keep heading nesting strictly sequential.
- **Typography & Consistency**:
  - Prefer clean, readable formatting (Segoe UI, Aptos, Calibri).
  - Body text should maintain comfortable line spacing and paragraph margins.
  - Standard 1-inch margins (1440 twips) on all sides.
- **Tables & Data Layout**:
  - Every table must have an explicit header row.
  - Numeric columns must be right-aligned; text columns must be left-aligned.
  - Tables automatically receive styled headers, cell padding, and alternating row fills.
- **Visual Callouts & Quotes**:
  - Format callouts with `> ` blockquotes. They render with a distinctive left accent bar and light background.
  - Highlight key takeaways, executive summaries, or warning notices cleanly.
- **Lists**:
  - Use structured bulleted or numbered lists for sequential steps or enumerations.
  - Keep list items concise and parallel in grammatical form.

## Capability & Output Guidance

- **Creating the Document**: Call the `create_artifact` tool with `kind: 'document'` and the complete Markdown content. This creates the editable workspace artifact and displays it in the side panel.
- **Exporting to Word (.docx)**: ArcNave's document export layer converts the artifact's Markdown headings, paragraphs, bullet lists, callouts, and tables into a real, styled `.docx` file for the user to download.
- **Never Tell Users to Copy-Paste**: When the user requests a Word document, report, or file deliverable, do NOT paste raw text into chat with "copy and paste this into Word". Always invoke `create_artifact`.
