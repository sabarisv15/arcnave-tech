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

## Deck Structure & Layout Best Practices (Claude & PowerPoint Standards)

- **Deliverable vs Cover Note**: The slide deck is the deliverable; chat is the cover note. In chat, summarize slide highlights in 1-2 tight sentences pointing to key conclusions.
- **Strict Typography Floor (>= 14pt)**:
  - Projected slides are read from across a room; sub-14pt text becomes illegible at distance.
  - Enforce a minimum font floor of >= 14pt across all text you author (body 16pt, section header 20-24pt, titles 26-32pt). Never generate sub-14pt body text.
- **Visual Storytelling (Takeaways Over Labels)**:
  - Slide titles should state a concrete takeaway or conclusion, not just a topic name (e.g., "Revenue Grew 32% YoY Driven by Enterprise", not "Financial Overview").
- **Cards and Structured Columns**:
  - Break bullet points into structured visual cards or columns with clean line spacing.
  - Avoid unbroken walls of bullets. Limit each slide to 3-5 high-impact points.
- **Aspect Ratio & Palette**:
  - Designed for modern 16:9 widescreen presentation displays.
  - High contrast typography with modern dark slate `#0F172A` headings and `#334155` body on light background `#F8FAFC`.

## Capability & Output Guidance

- **Creating the Presentation**: Call the `create_artifact` tool with `kind: 'document'` structured with slide headings (`# Slide Title`) and bullet items.
- **Exporting to PowerPoint (.pptx)**: ArcNave's presentation export layer converts headings and bullet groups into real `.pptx` slides via PptxGenJS enforcing the >=14pt typography floor.
- **Do Not Dump Plain Chat**: When the user requests a presentation, pitch deck, or slides, invoke `create_artifact` rather than outputting raw chat text.
