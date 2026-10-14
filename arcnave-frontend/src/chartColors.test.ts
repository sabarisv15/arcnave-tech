import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHART_SERIES, seriesColor } from "./chartColors";
import { SANDBOX_BASE_CSS } from "./sandboxTheme";

// Item G4: charts and sandboxed visuals use the brand's six chart colours (BS-Base, BS-PartsB),
// in the board's fixed order, in both themes.

const tokens = readFileSync(fileURLToPath(new URL("./brand/tokens.css", import.meta.url)), "utf8");
const darkAt = tokens.indexOf('\n:root[data-theme="dark"] {');
const seriesIn = (css: string, name: string) =>
  [1, 2, 3, 4, 5, 6].map((n) => css.match(new RegExp(`--${name}${n}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase());

describe("chart colours", () => {
  it("are the six brand tokens in the board's fixed order, wrapping only past six", () => {
    expect(CHART_SERIES).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"]);
    expect(seriesColor(0)).toBe("var(--chart-1)");
    expect(seriesColor(5)).toBe("var(--chart-6)");
    expect(seriesColor(6)).toBe("var(--chart-1)");
  });

  it("match BS-PartsB: Kulam green, Marigold, Sky, Terracotta, Jamun, Neem (light / dark)", () => {
    const light = seriesIn(tokens.slice(0, darkAt), "chart-");
    const dark = seriesIn(tokens.slice(darkAt), "chart-");
    expect(light).toEqual(["#2e8b63", "#c98512", "#2f7fb8", "#c2553a", "#7a5bb0", "#8e9a2c"]);
    expect(dark).toEqual(["#3fa676", "#c2841f", "#4a93cc", "#d66a4c", "#9478cb", "#8f9b35"]);
  });

  it("are what a sandboxed visual gets as --c1 to --c6, in both themes", () => {
    const sandboxDark = SANDBOX_BASE_CSS.indexOf(':root[data-theme="dark"]');
    const lightBlock = SANDBOX_BASE_CSS.slice(0, sandboxDark);
    const darkBlock = SANDBOX_BASE_CSS.slice(sandboxDark);
    expect(seriesIn(lightBlock, "c")).toEqual(seriesIn(tokens.slice(0, darkAt), "chart-"));
    expect(seriesIn(darkBlock, "c")).toEqual(seriesIn(tokens.slice(darkAt), "chart-"));
  });

  it("give a sandboxed visual the brand ink, surface and status colours, not the old blue-grey set", () => {
    const sandboxDark = SANDBOX_BASE_CSS.indexOf(':root[data-theme="dark"]');
    const lightBlock = SANDBOX_BASE_CSS.slice(0, sandboxDark);
    const darkBlock = SANDBOX_BASE_CSS.slice(sandboxDark);
    expect(lightBlock).toContain("--text:#142320");
    expect(lightBlock).toContain("--accent:#134e45");
    expect(lightBlock).toContain("--good:#1e6e47");
    expect(lightBlock).toContain("--bad:#b3261e");
    expect(darkBlock).toContain("--text:#e8eeeb");
    expect(darkBlock).toContain("--accent:#4fb585");
    expect(darkBlock).toContain("--surface:#1c2522");
    expect(SANDBOX_BASE_CSS).not.toContain("#4b6378");
    expect(SANDBOX_BASE_CSS).toContain("--grid:");
    expect(SANDBOX_BASE_CSS).toContain("--axis:");
  });
});
