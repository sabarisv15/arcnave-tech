# ADR-0041: Slides artifacts; Docs stay single-author; Design deferred

- Status: accepted. Tested locally; not live.
- Date: 2026-09-27
- Builds on: [ADR-0035](0035-sandboxed-visuals-and-interactive-artifacts.md).

## Context

Claude's artifacts now come in typed templates (Claude Help Center, "What are artifacts and how
do I use them?", read 2026-09-27):
- **Docs** are living documents written with Claude and "the people you work with", exported to
  Word, PDF, Markdown and Google Docs.
- **Slides** are presentations built from notes or the chat. Each slide can be edited, the deck
  presented without leaving the app, and exported to PowerPoint or PDF.
- **Design** covers visuals, mockups and prototypes built with a design system.

ArcNave had `document`, `code`, `webpage` and `svg` artifacts, and a `.pptx` export that made
one slide per `#`/`##` heading of a Markdown version.

## Decision

1. **A `slides` kind** (migration 0021 widens `ck_artifact_kind`). The content is Markdown in
   the export's own rule (`markdownToSlidesSpec`):
   - a `#` or `##` heading starts a slide, and text before the first heading is on no slide;
   - under the heading go a few bullets, one table or one image;
   - a line starting `Notes:` is speaker notes.

   `arcnave-frontend/src/slides.ts` cuts slides by the same rule, and both sides have a test,
   so the deck on screen and the downloaded `.pptx` hold the same slides.
2. **The deck.** The panel shows one slide at a time on a 960 × 540 canvas scaled to fit, with a
   filmstrip of every slide, ←/→ keys, speaker notes, and "Present", which shows the deck full
   screen, where a click or the space bar moves on. "PDF" prints one slide per landscape page.
   "PowerPoint" uses the existing export route. The Edit tab edits the Markdown.
   An opening slide with a line or two under its title is laid out as a cover.
3. **The model.** `create_artifact` lists `slides` and its format. The system prompt says a
   request for a deck, slides or a presentation with no file format named is a `slides`
   artifact, and a request that names `.pptx` gets the file; this is the choice Claude makes
   between its Slides type and a `.pptx` file.
4. **Docs** are the existing `document` kind. Real-time co-editing with other people needs
   accounts shared across users, which ArcNave does not have, so a document stays
   single-author. Sharing it is by public link (ADR-0039).
5. **Design** (canvas and design systems) is out of scope until the rest ships.

## Consequences

- The export splits a slide with more than five bullets into continuation slides; the deck on
  screen shows it as one slide.
- The deck's styling is ArcNave's own and is not themable per deck yet.
