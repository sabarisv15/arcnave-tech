# ADR-0036: Sandboxed visuals inherit ArcNave's theme and come with a design guide

- Status: accepted. Tested locally; not live.
- Date: 2026-09-27
- Builds on: [ADR-0035](0035-sandboxed-visuals-and-interactive-artifacts.md). Nothing in it is
  reversed; the security model (script-only sandbox, CSP first, two message types) is unchanged.

## Context

After WP-10 the user compared ArcNave's visuals with Claude's and found them thin. Two causes:

1. The frame gave the model nothing to build on: a white box, `system-ui`, 12px padding. Every
   visual had to invent its own colours, and hard-coded colours break in dark mode.
2. The model had one sentence of guidance, so it wrote minimal markup.

How Claude does it (official sources, read 2026-09-27):
- claude.com/docs, MCP Apps "Design guidelines" and "Blend your MCP App with Claude's theme": the
  host hands every embedded app its theme (light or dark) and a set of CSS variables for
  background, text, border, typography and radius; the app keeps its own background
  transparent and declares `color-scheme: light dark`, so it blends into the conversation and
  follows theme changes. Guidance: host tokens for structure, never hard-coded colours; a small
  type scale with two weights; visible controls rather than menus; inline height fits content
  with no nested scrolling.
- Claude Help Center, "Custom visuals in chat and Cowork", and claude.com/blog "Claude builds
  interactive visuals": visuals are inline, ephemeral, built from HTML and SVG, and chosen by
  the model when a picture helps understanding.
- A third-party reverse-engineering (github.com/Michaelliv/pi-generative-ui) shows that Claude
  loads a long design guide before drawing (charts, diagrams, interactive controls). We used it
  only to confirm the mechanism; none of its text, token names or fonts is copied.

## Decision

1. **The frame document carries ArcNave's tokens** (`sandboxTheme.ts`): text, surface, border,
   accent, status colours and six series colours, each defined for light and dark. Names are
   ArcNave's own (`--text`, `--surface`, `--c1`…), not Claude's.
2. **Base styles for bare elements and a few layout and SVG classes** (`.card`, `.grid`,
   `.stat`, `.node`, `.edge`, `.label`, `.tone-1`…`.tone-6`). Every rule is inside `:where()`,
   which has zero specificity, so the model's own CSS always wins. A test enforces this.
3. **Theme travels by message, not by rebuild.** The document is built in the theme of the
   moment; later changes are posted to the frame as `arcnave:theme`. The bridge accepts it only
   from `window.parent`. A new srcdoc would reload the frame and lose what the user had done in
   it. The message carries only the theme name.
4. **Inline visuals are transparent and borderless**, like the text around them; the toolbar
   fades in on hover (always visible on touch). Artifacts use `layout="page"`, which pads the
   body and keeps the panel's surface behind it.
5. **Chart.js gets the theme's colours.** The bridge sets `Chart.defaults` colour, grid colour
   and font when the page loads Chart.js, and exposes `window.arcnave.colors()` and
   `window.arcnave.onThemeChange(fn)` so a chart can redraw in the new theme.
6. **A compact design guide in `GENERATIVE_UI_POLICY_V1`**, in our own words: when to reach for
   a visual, the tokens and classes, pinned chart library URLs on jsdelivr (versions checked
   against the npm packages), flat style, two weights, colour for meaning, no repeated title,
   fluid width, style → markup → script order. It sits in the cached static prefix and is sent
   only when `render_ui` is declared. We do not add Claude's "read the guide first" tool call:
   our guide is short enough to send every time, and an extra round costs more than it saves.

## Consequences

- A visual written with no CSS of its own already matches ArcNave in both themes.
- The guide adds roughly 600 tokens to turns that declare `render_ui`; they are cached.
- The inline frame bug found on the way (the iframe stuck at 150px because `flex: 1` beat its
  `height`) is fixed and recorded in `mistakes.md`.
- Not done here: thumbnails of artifacts in the library (Claude's gallery shows a preview);
  that is separate work.

## Verification (local, real Chromium)

- A visual written to the guide (sliders, stat cards, Chart.js area chart, SVG flow diagram)
  renders in full: frame `offsetHeight` 571 equals the document's 571.
- Switching ArcNave to dark changes the frame's theme, text colour and Chart.js colours without
  a reload; the slider keeps its value.
- `window.arcnave.prompt` still only fills the composer. No CSP or page errors.
- Tests: frontend 106 (theme, `:where()` only, tokens in both themes, theme message without
  rebuild, page layout); backend 976.
