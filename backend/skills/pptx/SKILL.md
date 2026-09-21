---
name: pptx
version: 1.2.0
description: 16:9 presentation design, visual hierarchy, slide storytelling, cards and columns, and minimal bullet walls.
category: artifact
scope: builtin
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

Use this skill whenever preparing, designing, converting, or editing presentations, slide decks, pitch materials, or executive summaries.

## Deck Structure & Best Practices (ArcNave & PowerPoint Standards)

- **Deliverable vs Cover Note**: The slide deck is the deliverable; chat is the cover note. In chat, summarize deck highlights in 1-2 tight sentences pointing to key conclusions and slide numbers. Never dump raw bullet lists in chat.
- **Strict Typography Floor (>= 14pt)**:
  - Projected slides are read from across a room; sub-14pt text becomes illegible at distance.
  - Enforce a minimum font floor of >= 14pt across all text you author:
    - Slide titles: 28-36pt bold.
    - Section headers: 20-24pt bold.
    - Body and card text: 16-18pt.
    - Footnotes / captions: 14pt minimum.
  - Never generate sub-14pt text anywhere on a slide.
- **Visual Storytelling & Takeaway Titles**:
  - Slide titles should state a concrete takeaway or conclusion, not just a passive category name (e.g. "Revenue Grew 32% YoY Driven by Enterprise Expansion", not "Financial Overview").
  - Lead each slide with the insight the audience should remember.
- **Cards and Structured Columns**:
  - Break bullet points into structured visual cards or columns with clean line spacing.
  - Avoid unbroken walls of bullets. Limit each slide to 3-5 high-impact points.
  - If content overflows, split it across continuation slides rather than shrinking the font size.
- **Aspect Ratio & Modern Palettes**:
  - Designed for modern 16:9 widescreen presentation displays.
  - High contrast typography with dark slate headings (`#0F172A`) and readable body text (`#334155`) on light backgrounds (`#F8FAFC`).
  - Vary color archetypes to match topic tone (e.g. Midnight Executive, Forest & Moss, Clean Corporate Slate).

## ArcNave Runtime Deliverable Execution

ArcNave provides a dedicated, native presentation export engine powered by PptxGenJS (`generate_deliverable`).

### Mode A: Direct Presentation Generation
When the user asks to create a presentation or slide deck:
1. Structure the presentation in Markdown where each slide begins with a `# Slide Title` heading, followed by bulleted cards, metric callouts, or tables.
2. Call `generate_deliverable` with:
   - `format`: `'pptx'`
   - `title`: Short deck name (e.g. `"Q3_Board_Deck"`, `"Product_Launch_Presentation"`)
   - `content`: Complete slide-structured Markdown.

### Mode B: Source File Conversion (e.g. PDF → PowerPoint)
When the user asks to make slides or a presentation from an uploaded PDF or document:
1. Inspect the source PDF using `read_uploaded_file` if page-level structure or visual elements need analysis.
2. Call `generate_deliverable` with:
   - `format`: `'pptx'`
   - `sourceAttachmentId`: The UUID of the uploaded PDF or file.
   - `instructions`: Clear instructions on slide count and key themes (e.g. `"Create a 6-slide executive deck summarizing the main findings and metrics from this report"`).
3. Do NOT route standard PDF → PPTX conversion to Python; use `generate_deliverable`.

### Verification Checklist Before Responding
- Does every slide title assert a concrete conclusion or takeaway?
- Does all slide text strictly respect the >= 14pt typography floor?
- Are dense points structured into readable cards or columns (3-5 points per slide)?
- Did the generation produce a downloadable `.pptx` file with a concise chat cover note?
