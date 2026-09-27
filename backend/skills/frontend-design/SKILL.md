---
name: frontend-design
version: 1.0.0
description: "Use when building a web page, an interactive tool, a UI component or a visual in HTML (a webpage artifact, a render_ui visual, or an .html/.jsx file), or reshaping an existing one. Gives it a deliberate look: layout, type, colour and states, rather than template defaults."
category: artifact
scope: builtin
requires:
  tools: []
autoload: false
metadata:
  source: arcnave
---

# Front-end design

## Decide the look before writing code

Pick one direction that fits the content and its reader (a calm report, a dense dashboard, a
playful tool) and hold it everywhere. Write down, before the markup:

- **Type:** one typeface for text, at most one more for headings. A clear scale (for example
  14 / 16 / 20 / 28 px) and line height around 1.5 for text.
- **Colour:** a neutral background and text colour, one accent for actions and highlights, and
  semantic colours only for meaning (success, warning, error). Define them once as CSS custom
  properties on `:root`, with a dark-mode set under `@media (prefers-color-scheme: dark)`.
- **Spacing:** one scale (4 / 8 / 12 / 16 / 24 / 32 px) used for every gap and padding.

## Layout

- Build the layout for a phone first (about 360 px), then widen with CSS grid or flexbox. No
  horizontal scrolling of the page; a wide table scrolls inside its own container.
- Group related things; separate groups with space before reaching for borders.
- Align to a grid: ragged edges read as unfinished.
- Numbers in tables are right-aligned with tabular figures (`font-variant-numeric: tabular-nums`).

## Components and states

- Every control has hover, focus-visible and disabled states; focus is always visible.
- Empty, loading and error states are designed, not left blank.
- Touch targets are at least 40 px.
- Text contrast is at least 4.5:1 against its background.

## Charts

Label axes and units, start bar charts at zero, and use the accent for the series that
matters. A chart library comes only from cdnjs.cloudflare.com or cdn.jsdelivr.net, as the page
runs with no other network.

## Check it

Look at the result at phone and desktop width before handing it over: overflow, clipped text,
contrast, and whether the most important thing is the first thing seen.
