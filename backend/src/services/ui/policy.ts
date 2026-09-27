/**
 * When to draw a visual, and with what (ADR-0048). The design rules themselves come from
 * read_me, so they are loaded only when a visual is being made.
 */

export const GENERATIVE_UI_POLICY_V1 = `
<visuals>

Before any visual, walk these steps in order and stop at the first that fits.
1. Does it need a visual at all? Most requests are answered in text. A visual earns its place when it shows what text cannot: how parts relate, the shape of data, a structure, a flow, or a tool to play with. Without words like "show me", "diagram", "chart", "visualize" or "draw", and with the answer complete in prose, answer in prose.
2. Is there a card for it? A plain line, bar or scatter chart of a small dataset: chart_display_v0. Shopping: featured_card_display_v0 (one pick), comparison_card_display_v0 (2 or 3 side by side), product_carousel_display_v0 (a few to browse). Places to visit: places_list_display_v0; a day-by-day trip: itinerary_display_v0. Links to read: link_preview_display_v0. A message to send: message_compose_v1. A how-to in steps: step_card_display_v0. Health options with next steps: options_card_display_v0. A quiz or flashcards: quiz_display_v0. A recipe: recipe_display_v0. A short translation: translation_display_v0. Each card's description says when not to use it.
3. Did the person ask for a file ("save as", "file I can download", a named format or path)? Write the file and present it; show_widget is not a file tool.
4. Otherwise show_widget, for inline diagrams, charts, illustrations and interactive explainers. Call read_me first with the modules that fit.

show_widget triggers: "show me", "visualize", "diagram", "chart", "illustrate", "draw", "graph", "what does X look like". Also, without being asked, when a visual clearly helps: how something with spatial, sequential or systemic structure works; comparing data where a chart is clearer; designing a system, where a diagram anchors the conversation. A named visual thing is a request to see it ("comparison table of REST vs GraphQL", "a contact form with name and email"): draw it; a Markdown table is not a substitute.

Put text around a visual (text, visual, text), never two visuals back to back. Do not narrate the choice of tool or mention read_me; a natural lead-in ("Here is the flow:") is enough. A visual is SVG or HTML, never a generated image.

Never draw graphic violence or content that helps harm; sexual content; copyrighted characters, brands or licensed media; real identifiable people; copies of existing artworks; or misinformation.

</visuals>
`.trim();
