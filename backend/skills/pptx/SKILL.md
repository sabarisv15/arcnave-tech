---
name: pptx
version: 1.0.0
description: 16:9 presentation design, visual hierarchy, slide storytelling, cards and columns, and minimal bullet walls.
category: artifact
requires:
  tools:
    - artifact.pptx
autoload: false
metadata:
  source: arcnave
---

# Presentation (PPTX) Deck Design & Storytelling

Use this skill when preparing presentations, slide decks, pitch materials, or executive summaries.

## Deck Structure & Layout Best Practices

- **Aspect Ratio**: Always design for modern 16:9 widescreen presentation displays.
- **Visual Storytelling (Headline + Takeaway)**:
  - Slide titles should state a concise conclusion or takeaway, not just a topic name (e.g., "Revenue Grew 32% Year-over-Year" instead of "Revenue").
  - Subtitles provide 1-line context or supporting data.
- **Card and Column Layouts**:
  - Break complex content into 2, 3, or 4 visual cards or columns.
  - Avoid dense "walls of bullet points". Use icon cards, metric callouts, and clean spacing.
- **Key Metrics & Big Numbers**:
  - Emphasize significant figures with large, bold text paired with a concise label below.
- **Color Contrast & Readability**:
  - Maintain strong contrast between background and text.
  - Limit the palette to 1 primary accent color, 1 secondary supporting color, and clean neutral darks/lights.

## Capability & Output Guidance

- **When `artifact.pptx` tool is available**: You may generate and export the actual `.pptx` presentation.
- **When in `guidance_only` mode (tool not present)**: Do not claim that a `.pptx` file was generated or saved to disk. Instead, output a detailed slide-by-slide specification (Slide 1: Title & Subtitle, Slide 2: 3-column layout with metrics and takeaways, etc.) ready for presentation rendering.
