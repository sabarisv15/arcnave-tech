import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DisplayCard, scaledAmount } from "./generative-ui/blocks/DisplayCards";
import { visualLabel } from "./generative-ui/blocks/VisualBlock";
import type { DisplayBlock } from "./generative-ui/types";
import { DRAWN_TOOLS, DISPLAY_TOOLS, uiBlocksOf } from "./types";
import { artifactKind, importsOf, reactArtifactBody, REACT_MODULES } from "./fileArtifacts";
import { buildSrcDoc, sandboxCsp } from "./SandboxFrame";

const card = (tool: string, data: Record<string, unknown>) =>
  renderToStaticMarkup(<DisplayCard block={{ blockId: "b", sequence: 1, type: "display", tool, data } as DisplayBlock} />);

describe("display cards (ADR-0048)", () => {
  it("draws every card from its arguments", () => {
    const html = {
      comparison: card("comparison_card_display_v0", {
        products: [
          { name: "iPad Air", price: "$599", attributes: [{ label: "Chip", value: "M2" }] },
          { name: "iPad Pro", attributes: [{ label: "Chip", value: "M4" }] },
        ],
      }),
      featured: card("featured_card_display_v0", { products: [{ name: "Gaggia Classic", blurb: "Simple and sturdy." }] }),
      carousel: card("product_carousel_display_v0", { products: [{ name: "Desk A" }, { name: "Desk B" }] }),
      itinerary: card("itinerary_display_v0", { title: "2 days in Rome", days: [{ day_label: "Day 1", stops: [{ name: "Colosseum", time: "9:00" }] }, { day_label: "Day 2", stops: [{ name: "Vatican" }] }] }),
      links: card("link_preview_display_v0", { links: [{ url: "https://www.example.com/a", title: "A guide" }] }),
      message: card("message_compose_v1", { kind: "email", variants: [{ label: "Hold firm", subject: "Re: fee", body: "Hello there" }] }),
      options: card("options_card_display_v0", { options: [{ title: "Rest", description: "d", bullets: ["Ice it", "Elevate"] }] }),
      places: card("places_list_display_v0", { places: [{ name: "Cafe Uno", tips: ["Book ahead"] }] }),
      quiz: card("quiz_display_v0", { title: "Basics", questions: [{ id: "q1", prompt: "1+1?", options: [{ id: "a", text: "2" }], correct_option_id: "a", explanation: "Sum" }] }),
      steps: card("step_card_display_v0", { steps: [{ title: "Unplug it", description: "d" }, { title: "Wait", description: "d" }], view: "list" }),
      translation: card("translation_display_v0", { source_text: "Hello", source_language: "English", translation: "Hola", target_language: "Spanish", target_lang: "es" }),
      chart: card("chart_display_v0", { style: "bar", title: "Revenue", series: [{ values: [1, 2] }], x_axis: { data: ["Q1", "Q2"] } }),
    };
    expect(html.comparison).toContain("iPad Pro");
    expect(html.comparison).toContain("M4");
    expect(html.comparison).toContain("$599");
    expect(html.featured).toContain("Top pick");
    expect(html.carousel).toContain("1 / 2");
    expect(html.itinerary).toContain("Colosseum");
    expect(html.itinerary).not.toContain("Vatican");
    expect(html.links).toContain("example.com");
    expect(html.message).toContain("Open in Mail");
    expect(html.message).toContain("mailto:?subject=Re%3A%20fee&amp;body=Hello%20there");
    expect(html.options).toContain("not medical advice");
    expect(html.places).toContain("Book ahead");
    expect(html.quiz).toContain("1+1?");
    expect(html.steps).toContain("Unplug it");
    expect(html.translation).toContain("Hola");
    expect(html.chart).toContain("Revenue");
    expect(Object.keys(html)).toHaveLength(DISPLAY_TOOLS.size - 1);
  });

  it("scales a recipe and writes each {id} as the ingredient's scaled amount", () => {
    const html = card("recipe_display_v0", {
      title: "Toast",
      base_servings: 2,
      ingredients: [{ id: "0001", name: "bread slices", amount: 2 }, { id: "0002", name: "butter", amount: 10, unit: "g" }],
      steps: [{ id: "s", title: "Butter", content: "Spread {0002} on {0001}.", timer_seconds: 120 }],
    });
    expect(html).toContain("10 g butter");
    expect(html).toContain("2 min");
    expect(scaledAmount(10, 2, 3)).toBe("15");
    expect(scaledAmount(0.5, 4, 3)).toBe("0.38");
  });

  it("opens only http(s) links and images", () => {
    const html = card("link_preview_display_v0", { links: [{ url: "javascript:alert(1)", title: "Bad" }, { url: "https://ok.example", title: "Good" }] });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Bad");
    const photos = card("featured_card_display_v0", {
      products: [{ name: "X", url: "data:text/html,x" }],
      photos: [[{ thumbnailUrl: "javascript:x", imageUrl: "", sourceUrl: "" }, { thumbnailUrl: "https://t/x.jpg", imageUrl: "", sourceUrl: "https://s" }]],
    });
    expect(photos).not.toContain("data:text");
    expect(photos).not.toContain("javascript:");
    expect(photos).toContain("https://t/x.jpg");
  });

  it("shows an unknown card's summary instead of dropping it", () => {
    expect(card("weather_fetch", { summary: "Weather for Rome" })).toContain("Weather for Rome");
  });
});

describe("a stored reply's visuals and cards", () => {
  it("rebuilds cards from their calls and visuals from their code, as the server streamed them", () => {
    const blocks = uiBlocksOf([
      { toolCallId: "c1", name: "recipe_display_v0", ok: true, input: { title: "T" }, content: [{ type: "json", data: { status: "shown" } }] },
      { toolCallId: "c2", name: "places_list_display_v0", ok: true, input: { places: [] }, content: [{ type: "json", data: { status: "shown", photos: [[]] } }] },
      { toolCallId: "c3", name: "show_widget", ok: true, input: { widget_code: "<svg/>" }, content: [{ type: "json", data: { blocks: [{ blockId: "v", sequence: 1, type: "visual", title: "t", htmlBytes: 6 }] } }] },
      { toolCallId: "c4", name: "render_ui", ok: true, input: { blocks: [{ type: "visual", html: "<p/>" }] }, content: [{ type: "json", data: { blocks: [{ blockId: "r", sequence: 1, type: "visual", title: "t" }] } }] },
      { toolCallId: "c5", name: "quiz_display_v0", ok: false, input: {} },
    ]);
    expect(blocks).toEqual([
      { blockId: "display_c1", sequence: 1, type: "display", tool: "recipe_display_v0", data: { title: "T" } },
      { blockId: "display_c2", sequence: 1, type: "display", tool: "places_list_display_v0", data: { places: [], photos: [[]] } },
      { blockId: "v", sequence: 1, type: "visual", title: "t", htmlBytes: 6, html: "<svg/>" },
      { blockId: "r", sequence: 1, type: "visual", title: "t", html: "<p/>" },
    ]);
    for (const t of ["show_widget", "read_me", "ask_user_input_v0", ...DISPLAY_TOOLS]) expect(DRAWN_TOOLS.has(t)).toBe(true);
    expect(DRAWN_TOOLS.has("bash_tool")).toBe(false);
  });

  it("reads a snake_case visual name as words", () => {
    expect(visualLabel("q4_revenue_by_line")).toBe("Q4 revenue by line");
    expect(visualLabel("Revenue")).toBe("Revenue");
  });
});

describe("artifacts are files (ADR-0048)", () => {
  it("draws .md, .html, .jsx, .mermaid, .svg and .pdf, and downloads everything else", () => {
    expect(["a.md", "b.HTML", "c.jsx", "d.mermaid", "e.svg", "f.pdf"].map(artifactKind)).toEqual(["markdown", "html", "react", "mermaid", "svg", "pdf"]);
    expect(["g.docx", "h.xlsx", "md", "i.tsx"].map(artifactKind)).toEqual([null, null, null, null]);
  });

  it("loads only what a component imports, says what it cannot, and cannot be closed early by its code", () => {
    const code = 'import { useState } from "react";\nimport * as d3 from "d3";\nimport x from "left-pad";\nexport default () => "</script><p>";';
    expect(importsOf(code)).toEqual(["react", "d3", "left-pad"]);
    const body = reactArtifactBody(code);
    expect(body).toContain(REACT_MODULES.d3!.urls[0]);
    expect(body).not.toContain(REACT_MODULES.three!.urls[0]);
    expect(body).toContain('unknown=["left-pad"]');
    expect(body.match(/<\/script>/g)).toHaveLength(1);
  });

  it("allows eval in the frame only for a React artifact", () => {
    expect(sandboxCsp(false)).not.toContain("unsafe-eval");
    expect(sandboxCsp(true)).toContain("'unsafe-eval'");
    expect(buildSrcDoc("<p/>")).not.toContain("unsafe-eval");
    expect(buildSrcDoc("<p/>", "light", "page", true)).toContain("unsafe-eval");
  });
});
