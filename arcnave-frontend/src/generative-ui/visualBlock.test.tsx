// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isSvgRoot } from "./blocks/VisualBlock";
import { GenerativeUIRenderer } from "./GenerativeUIRenderer";
import { withVisualHtml } from "../types";
import type { UIBlock } from "./types";

vi.mock("../workspace", () => ({
  useWorkspace: () => ({ saveVisualAsArtifact: vi.fn(), toast: vi.fn() }),
}));

describe("visual blocks", () => {
  it("recognises an SVG root after a declaration or comment, and nothing else", () => {
    expect(isSvgRoot('<svg viewBox="0 0 1 1"></svg>')).toBe(true);
    expect(isSvgRoot('<?xml version="1.0"?>\n<!-- chart --><svg></svg>')).toBe(true);
    expect(isSvgRoot("<div><svg></svg></div>")).toBe(false);
    expect(isSvgRoot("<svgx></svgx>")).toBe(false);
  });

  it("renders a visual only inside a sandboxed frame, never as page markup", () => {
    const html = '<button onclick="alert(1)">Go</button>';
    const markup = renderToStaticMarkup(
      <GenerativeUIRenderer blocks={[{ type: "visual", blockId: "v", sequence: 1, title: "Demo", html }]} />,
    );
    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).not.toContain("<button onclick");
  });

  it("restores a visual's HTML from the call input on reload, by sequence", () => {
    const stored: UIBlock[] = [
      { type: "text", blockId: "a", sequence: 1, text: "hi" },
      { type: "visual", blockId: "b", sequence: 2, title: "V", htmlBytes: 9 },
    ];
    const input = { blocks: [{ type: "text", text: "hi" }, { type: "visual", title: "V", html: "<p>v</p>" }] };
    expect(withVisualHtml(stored, input)[1]).toMatchObject({ type: "visual", html: "<p>v</p>" });
    expect(withVisualHtml(stored, {})[1]).not.toHaveProperty("html");
  });
});
