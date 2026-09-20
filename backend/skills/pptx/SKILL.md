---
name: pptx
version: 1.1.0
description: 16:9 presentation design, visual hierarchy, slide storytelling, cards and columns, and minimal bullet walls.
category: artifact
requires:
  tools:
    - create_artifact
  capabilities:
    - artifact.export.pptx
autoload: false
metadata:
  source: arcnave
---

# Presentation (PPTX) Deck Design & Storytelling

Use this skill when preparing presentations, slide decks, pitch materials, or executive summaries.

## Deck Structure & Layout Best Practices

- **Aspect Ratio**: Always design for modern 16:9 widescreen presentation displays.
- **Visual Storytelling (Headline + Takeaway)**:
  - Slide titles (Heading 1 or 2) should state a concise conclusion or takeaway, not just a topic name (e.g., "Revenue Grew 32% Year-over-Year" instead of "Revenue").
  - Subtitles provide 1-line context or supporting data.
- **Card and Column Layouts**:
  - Break complex content into 2, 3, or 4 visual cards or columns.
  - Avoid dense "walls of bullet points". Use concise bullet points, metric callouts, and clean spacing.
- **Key Metrics & Big Numbers**:
  - Emphasize significant figures with large, bold text paired with a concise label below.
- **Color Contrast & Readability**:
  - Maintain strong contrast between background and text.
  - Limit the palette to 1 primary accent color, 1 secondary supporting color, and clean neutral darks/lights.

## Capability & Output Guidance

- **Creating the Presentation**: Call the `create_artifact` tool with `kind: 'document'` structured with slide headings (`# Slide Title`) and bullet items.
- **Exporting to PowerPoint (.pptx)**: ArcNave's presentation export layer converts headings and bullet groups into real `.pptx` slides via PptxGenJS for the user to download.
- **Do Not Dump Plain Chat**: When the user requests a presentation, pitch deck, or slides, invoke `create_artifact` rather than outputting raw chat text.
