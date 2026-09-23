---
name: pptx
version: 2.0.0
description: 16:9 widescreen presentation design, visual storytelling, slide cards, targeted slide editing, slide reordering, and format-native PowerPoint generation.
category: artifact
scope: builtin
requires:
  tools:
    - generate_deliverable
  capabilities:
    - artifact.export.pptx
autoload: false
metadata:
  source: arcnave
---

# Presentation (PPTX) Deck Design & Deliverable Architecture

Procedural knowledge for designing, creating, editing, reordering, and inspecting PowerPoint presentations (.pptx). Enforces high-legibility visual storytelling, strict typography floors, slide reordering, targeted slide text updates, and format-native OpenXML generation.

---

## 1. When to Use This Skill

- Creating new slide decks, pitch presentations, executive briefings, or board summaries.
- Modifying text or bullet points on a specific slide in an existing presentation (`editPptxSlideText`).
- Reordering, duplicating, or reorganizing slides in an existing deck (`reorderPptxSlides`).
- Inspecting slide counts and slide titles in an uploaded presentation (`inspectPptxStructure`).
- Converting research reports or strategy documents into presentation slides.

---

## 2. When NOT to Use This Skill

- Dense narrative documents, contracts, or long-form whitepapers (use `docx`).
- Tabular financial statements or spreadsheets (use `xlsx`).
- Fixed-layout printable audit reports (use `pdf`).

---

## 3. Understand & Inspect Existing Files

### A. Provider File Adapter & Extracted Presentation Representation
Uploaded PowerPoint presentations (.pptx) are ingested via ArcNave's Provider File Adapter as extracted text/document blocks. When the user asks "What is slide 4 about?" or "Summarize this deck", answer directly using the adapter's extracted slide content without unnecessary tool calls. Do not expect providers to parse raw OpenXML presentation binaries natively for comprehension.

### B. Deterministic Structural Inspection
When programmatic workflows require exact slide counts or titles:
- Call `inspectPptxStructure(inputBuffer)` to obtain:
  - `slideCount`: Total number of slides registered in `<p:sldIdLst>`.
  - `titles`: Array of extracted slide title strings.

---

## 4. Create New File

When the user asks to create a presentation or slide deck:
1. Structure the presentation in Markdown where each slide begins with `# Slide Title`.
2. Follow slide titles with bulleted cards, metric callouts, or tables.
3. Call `generate_deliverable` with:
   - `format`: `'pptx'`
   - `title`: Short deck name (e.g. `"Q3_Executive_Briefing"`)
   - `content`: Complete slide-structured Markdown.

### Presentation Design Principles
ArcNave's format-native presentation engine (`pptxRenderer`) compiles Markdown to OpenXML slides:
- **Strict Typography Floor ($\ge$ 14pt)**: Projected slides must be legible from across a room. Never author sub-14pt text:
  - Slide Titles: 28–36pt bold.
  - Section Headers: 20–24pt bold.
  - Body & Card Points: 16–18pt.
  - Captions / Footnotes: 14pt minimum.
- **Takeaway Titles**: Slide titles must state a concrete takeaway, not a passive topic (e.g. "Revenue Grew 32% Driven by Enterprise Expansion", not "Financial Overview").
- **Cards & Columns**: Break bullet walls into 3–5 high-impact points or visual cards. If content overflows, split across continuation slides.
- **16:9 Modern Palette**: Designed for widescreen displays with high-contrast slate text on clean backgrounds.

---

## 5. Edit Existing File & Format-Preserving Operations

### A. Targeted Slide Text Editing (`editPptxSlideText`)
When modifying text on a specific slide in an existing uploaded `.pptx`:
- Use `editPptxSlideText(inputBuffer, slideIndex1Indexed, replacements)`:
  - `slideIndex1Indexed`: 1-based slide index (e.g. `2`).
  - `replacements`: Array of `{ search: string, replace: string }`.
- **Preservation Principle**: Edits only `ppt/slides/slideN.xml`. Master layouts, themes, slide transitions, embedded vector shapes, and untouched slides are preserved with zero corruption. **Never rebuild an entire presentation from scratch for a single text edit.**

### B. Slide Reordering (`reorderPptxSlides`)
When rearranging slides in an existing deck:
- Use `reorderPptxSlides(inputBuffer, newOrder1Indexed)`:
  - `newOrder1Indexed`: Array of 1-based slide indices in desired sequence (e.g. `[2, 1, 3]`).
- Rearranges `<p:sldId>` entries in `ppt/presentation.xml` without altering or re-encoding individual slide files.

---

## 6. Multi-File Operations

- When synthesizing slide highlights from multiple source decks, extract core takeaways and author a consolidated deck via `generate_deliverable`.

---

## 7. Cross-Skill Transformations

No single skill owns an entire cross-format workflow. The source skill extracts; the target skill structures and renders.

### DOCX / PDF $\to$ PPTX (Document to Deck)
1. **Source Phase (`docx` / `pdf`)**: Read document sections and extract key conclusions, statistics, and milestones.
2. **Target Phase (`pptx`)**: Structure into concise slides (1 slide per major topic, 3–5 bullets per slide, takeaway headings).
3. **Render Phase**: Call `generate_deliverable(format: 'pptx', title, content)`.
4. **NEVER** pass raw binary document IDs directly to `generate_deliverable` expecting automatic conversion without structured parsing.

---

## 8. Execution Strategy

- **MODEL decides WHAT**: Formulates visual narrative, slide topics, and key takeaways.
- **SKILL teaches HOW**: Enforces typography floors, takeaway headings, and targeted XML edits.
- **ExecutionRuntime performs deterministic work**: Executes native PowerPoint operations and format renderers.
- **Chat is the Cover Note**: In chat, summarize deck conclusions in 1–2 concise paragraphs. Direct the user to the generated `.pptx` file; do NOT dump raw bullet walls into chat.

---

## 9. Validation & Repair Loop

- Generated presentations undergo post-generation verification (valid OpenXML presentation package, presentation.xml slide count matches specification, typography floor enforced, valid slide XML markup).
- **Repair Loop**: If a validation warning occurs, review slide parameters and issue a corrective tool call.

---

## 10. Warnings & Limitations

- **No Magic Binary Conversion**: `generate_deliverable` requires structured markdown upstream; it does not transcode binary source files directly.
- **No Native OpenXML Charts**: Native PowerPoint chart series generation is not currently exposed in `generate_deliverable`. Present visual charts via `render_ui` in chat or tabular slide cards.
- **No External CLI Dependencies**: ArcNave does NOT use `pdftoppm` or `LibreOffice`. All operations rely on native `pptxgenjs` and JSZip libraries.

---

## 11. Available Resources & Scripts

- No external script or template files currently exist in this skill package (`scripts = 0`, `templates = 0`). All operations run via native runtime functions.
