/**
 * What read_me returns (ADR-0048): the design rules for show_widget, as a core that always comes
 * back plus the modules asked for. The tokens and classes named here are the ones the client's
 * sandbox defines (arcnave-frontend/src/sandboxTheme.ts) and the hosts are its CSP's
 * (SandboxFrame.tsx); a change there must be made here too.
 */
import type { VISUALIZE_MODULES } from '../../tools/definitions.js';

export type VisualizeModule = (typeof VISUALIZE_MODULES)[number];

const CORE = `# Visuals with show_widget

Modules (call read_me again with more when needed): diagram, mockup, interactive, chart, data_viz, art, elicitation.

## Principles
- It sits inside the chat: flat surfaces, no gradients, shadows, glow or textures; transparent background.
- Text goes in your reply, the visual in the tool. No headings, titles or paragraphs of explanation inside it; the person's reading settings apply only to your reply.
- Compact: show the essential; explain the rest in text around it. Interleave text and visuals; never two show_widget calls in a row.
- Limits: box subtitles 5 words or fewer; at most two or three colours per visual, used for meaning; at most four boxes across at full width.

## Streaming
The code is drawn while you write it; scripts run once it is complete.
- HTML: a short <style> (about 15 lines), then the markup, then <script> last.
- SVG: <defs> first, then the shapes.
- No comments. No tabs, carousels or hidden sections while streaming: show content stacked (a script may add a stepper afterwards).

## Rules
- No DOCTYPE, <html>, <head> or <body>: content only. It fills the width; never a fixed pixel width.
- Never position: fixed (the frame sizes to the content in flow). For a modal mockup, draw it inside a normal-flow block with min-height.
- No nested scrolling; keep height near 300 to 600 px.
- Font sizes 11 px or more. Two weights only: 400 and 500. Sentence case everywhere, SVG labels included. No emoji: use shapes or SVG.
- Headings, if any, are already styled: h1 22px, h2 18px, h3 16px, weight 500.
- Text on a coloured fill uses a darker shade of the same colour, never black or grey.
- Show real numbers you have, never invented ones.

## Theme (light and dark are automatic)
Colour variables: --text, --text-muted, --text-faint, --surface, --surface-2, --border, --border-strong, --accent, --good, --bad, --warn, --info, and six series colours --c1 to --c6. Never hard-code a text or background colour: the theme can change while the visual is open. Mental test: would every text still read on a near-black background?
Fonts: --font, --mono. Radii: --radius (8px), --radius-lg (12px, for cards).
Styled for you: h1-h4, p, a, button (class "primary" for the main action), input, select, textarea, input[type=range], checkbox and radio, label, table (class "num" on numeric cells).
Layout classes: .card, .grid (responsive columns), .row, .stat with .stat-label, .chip, .muted, .up / .down.
SVG classes: .node (a box), .edge (a connector), .label and .label-muted (text), .series; .tone-1 to .tone-6 on a shape or group colours it with that series colour.

## Sandbox
It runs with no network: fetch, forms, popups and links out do not work (put links in your reply). Scripts load only from https://cdnjs.cloudflare.com and https://cdn.jsdelivr.net.
sendPrompt(text) puts a follow-up in the person's message box for them to send (a visual's script never sends in their name): use it when the next step needs you to think (explain this part, compare these). Filtering, sorting, toggling and arithmetic belong in the script.
window.arcnave.colors() returns the resolved colours ({ text, muted, border, series: [...] }); window.arcnave.onThemeChange(fn) says when to redraw.`;

const MODULES: Record<VisualizeModule, string> = {
  diagram: `## Module: diagram
Kinds: a flowchart (a process, decisions, a sequence), a structural diagram (parts and how they connect: architecture, hierarchy, entities), an illustrative diagram (how something physical works: a cycle, a mechanism, a cross-section).
- SVG with a viewBox (about 680 wide) and width="100%"; no fixed height.
- Boxes: <rect class="node" rx="4">; group a box and its text in <g class="tone-n"> to colour it. Connectors: <path class="edge" marker-end="url(#arrow)">, arrow marker in <defs>.
- Text: <text class="label"> (title) and class="label-muted" (subtitle), text-anchor="middle" in the box centre. Leave 12 px or more of padding inside a box; widen the box, never let text overflow.
- Colour by category (all steps of one kind share a colour), not in sequence; neutral grey (.node without tone) for start, end and plain steps.
- Keep it sparse: 5 to 9 boxes. More detail goes in a second diagram or in text.
- Illustrative diagrams may use simple shapes and paths freely; label parts directly rather than with a legend.`,
  mockup: `## Module: mockup
For illustrating an interface idea in the middle of an explanation (a form, a card, a settings screen, a dashboard), not for delivering a finished design (make a file for that).
- HTML with the styled elements and classes; a .card per panel; .grid or .row for layout.
- Realistic but brief content: real-looking labels and a few rows, no lorem ipsum.
- Controls work where it helps (a toggle toggles, a tab switches) using a short script.
- Status colours through --good, --bad, --warn, --info; one accent (--accent) for the primary action.`,
  interactive: `## Module: interactive
An explainer the person learns from by moving a control: a slider that changes a curve, a toggle between two states, a step-through of an algorithm.
- One idea per widget. Controls (label + input[type=range], buttons, select) above or beside the visual; the visual redraws on input.
- Show the current value next to each control, and the result as a number too when it has one.
- Start in a meaningful state, not empty. Keep the script short and plain; no framework.
- A stepper (next / previous) is built by the script after the page loads; every step is in the markup so it streams.
- Use sendPrompt for "explain this" or "what if" questions that need you, not for recalculating.`,
  chart: `## Module: chart
Plain line, bar and scatter charts of a small dataset go to chart_display_v0 instead. Use show_widget for what it cannot draw: pie or donut, stacked or area, annotations, several panels, custom interaction.
- Simple bars and lines: plain SVG with .series and .tone-n, axis labels in .label-muted.
- Richer charts: load https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js; it picks up the theme's text and grid colours. Wrap the canvas in a div with a set height (about 320px) and set maintainAspectRatio: false. Take series colours from window.arcnave.colors().series and redraw on onThemeChange.
- D3 when needed: https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js.
- Label data directly where you can; a legend only for three or more series. Units in axis titles. Numbers with their units and sensible rounding.`,
  data_viz: `## Module: data_viz
Several numbers told together: a small dashboard, key figures with a chart, a table that sorts.
- Key figures first: a .grid of .card with .stat and .stat-label, change in .up / .down.
- Then one chart (see the chart module) and, if useful, a table (class "num" on numeric cells) that sorts or filters in the script.
- Every number comes from data in the conversation; say in your reply where it came from.`,
  art: `## Module: art
Illustration and generative art in SVG or a canvas script.
- Simple, bold shapes; a limited palette from the series colours so it works in both themes.
- Generative pieces: a seeded loop in a short script drawing on a canvas that fills the width; a button to redraw.
- Never depict real people, logos, copyrighted characters or an existing artwork.`,
  elicitation: `## Module: elicitation
A small form that gathers the person's inputs so you can do the work: preferences, a budget split, a configuration.
- Label every field; sensible defaults; group related fields in a .card.
- One primary button that calls sendPrompt with a short, readable summary of the choices ("Budget: 40% rent, 20% food, …").
- For a quick choice between a few options, ask_user_input_v0 is simpler: use it instead.`,
};

export function visualizeGuide(modules: readonly VisualizeModule[] | undefined, platform: string | undefined): string {
  const picked = [...new Set(modules ?? [])].filter((m): m is VisualizeModule => m in MODULES);
  const sizing =
    platform === 'mobile'
      ? '\n\n## Platform: mobile\nThe frame is about 380 px wide: one column, SVG viewBox about 360 wide, labels short, controls full width.'
      : '';
  return [CORE + sizing, ...picked.map((m) => MODULES[m])].join('\n\n');
}
