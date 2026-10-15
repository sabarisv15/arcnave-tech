// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Copy, MessageSquare, Search } from "lucide-react";
import { AI_STATES, AI_STATE_LABELS, AiStateMark, Icon, LEAF_CORNER_ICONS, LivingDots, Logo, ScatterToPoint, Wordmark } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string): string => readFileSync(path.join(here, rel), "utf8");

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

describe("AiStateMark", () => {
  it("has the nine locked states", () => {
    expect([...AI_STATES]).toEqual([
      "writing",
      "searching",
      "reading",
      "running",
      "creating",
      "thinking",
      "done",
      "needs-input",
      "error",
    ]);
  });

  it.each(AI_STATES)("renders %s with an accessible label and its own animated group", (state) => {
    const doc = parse(renderToStaticMarkup(<AiStateMark state={state} />));
    const mark = doc.querySelector(".ai-mark");
    expect(mark?.getAttribute("role")).toBe("img");
    expect(mark?.getAttribute("aria-label")).toBe(AI_STATE_LABELS[state]);
    expect(mark?.getAttribute("data-state")).toBe(state);
    // every state carries its moving parts and the still mark that reduce-motion shows
    expect(doc.querySelector(".ai-mark__live")?.children.length).toBeGreaterThan(0);
    expect(doc.querySelector(".ai-mark__idle")?.children.length).toBeGreaterThan(0);
  });

  it("uses the 32 px chat cut by default and the original cut when large", () => {
    const small = parse(renderToStaticMarkup(<AiStateMark state="writing" />));
    expect(small.querySelector("svg")?.getAttribute("viewBox")).toBe("-6 -14 118 118");
    const large = parse(renderToStaticMarkup(<AiStateMark state="writing" size={96} />));
    expect(large.querySelector("svg")?.getAttribute("viewBox")).toBe("-20 -24 140 140");
  });

  it("accepts a custom label and can be decorative", () => {
    const named = parse(renderToStaticMarkup(<AiStateMark state="done" label="Finished" />));
    expect(named.querySelector(".ai-mark")?.getAttribute("aria-label")).toBe("Finished");
    const deco = parse(renderToStaticMarkup(<AiStateMark state="done" decorative />));
    expect(deco.querySelector(".ai-mark")?.getAttribute("aria-hidden")).toBe("true");
    expect(deco.querySelector(".ai-mark")?.hasAttribute("role")).toBe(false);
  });

  it("keeps ids unique per instance so two marks do not share defs", () => {
    const html = renderToStaticMarkup(
      <>
        <AiStateMark state="thinking" />
        <AiStateMark state="thinking" />
      </>,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).not.toContain("__U__");
  });
});

describe("Logo and Wordmark", () => {
  it("labels the logo only when asked", () => {
    const deco = parse(renderToStaticMarkup(<Logo />)).querySelector("svg");
    expect(deco?.getAttribute("aria-hidden")).toBe("true");
    const named = parse(renderToStaticMarkup(<Logo label="arcnave" variant="flat" />)).querySelector("svg");
    expect(named?.getAttribute("role")).toBe("img");
    expect(named?.getAttribute("aria-label")).toBe("arcnave");
  });

  it("draws English, Tamil and the bilingual lockup", () => {
    expect(parse(renderToStaticMarkup(<Wordmark lang="en" />)).querySelectorAll("svg")).toHaveLength(1);
    expect(parse(renderToStaticMarkup(<Wordmark lang="ta" />)).querySelectorAll("svg")).toHaveLength(1);
    const both = parse(renderToStaticMarkup(<Wordmark lang="both" />));
    expect([...both.querySelectorAll("svg")].map((s) => s.getAttribute("aria-label"))).toEqual(["arcnave", "ஆர்க்நேவ்"]);
  });

  it("ships the static svg files", () => {
    expect(read("wordmark.svg")).toContain('aria-label="arcnave"');
    expect(read("wordmark-ta.svg")).toContain("ஆர்க்நேவ்");
    expect(read("logo/logo.svg")).toContain("#2E8B63");
  });
});

describe("Icon", () => {
  it("is aria-hidden without a label", () => {
    const svg = parse(renderToStaticMarkup(<Icon icon={Search} />)).querySelector("svg.brand-icon");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.hasAttribute("role")).toBe(false);
  });

  it("is a labelled image when given a label", () => {
    const svg = parse(renderToStaticMarkup(<Icon icon={Search} label="Search" />)).querySelector("svg.brand-icon");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Search");
    expect(svg?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("cuts the sky seed into the active icon only", () => {
    const idle = parse(renderToStaticMarkup(<Icon icon={MessageSquare} />));
    expect(idle.querySelector("mask")).toBeNull();
    const active = parse(renderToStaticMarkup(<Icon icon={MessageSquare} active />));
    expect(active.querySelector("mask")).not.toBeNull();
    expect(active.querySelector("svg.brand-icon--active")).not.toBeNull();
  });

  it("redraws the board's leaf-corner icons and leaves the rest as Lucide", () => {
    expect(LEAF_CORNER_ICONS).toEqual(expect.arrayContaining(["MessageSquare", "Folder", "Copy", "Lock", "Calendar", "Image"]));
    const leaf = renderToStaticMarkup(<Icon icon={Copy} />);
    expect(leaf).toContain("M8 13 A5 5 0 0 1 13 8 H20.5");
    const plain = renderToStaticMarkup(<Icon icon={Search} />);
    expect(plain).toContain("lucide");
  });
});

describe("tokens.css", () => {
  const css = read("tokens.css");
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));

  it("defines the core light tokens on :root from the locked boards", () => {
    for (const [name, value] of [
      ["--color-bg", "#ffffff"],
      ["--color-sidebar", "#f6f9f8"],
      ["--color-brand", "#2e8b63"],
      ["--color-primary", "#134e45"],
      ["--color-sky", "#7cc8ee"],
      ["--color-text", "#142320"],
    ] as const) {
      expect(css).toMatch(new RegExp(`${name}:\\s*${value};`));
    }
  });

  it("defines dark overrides under the selector the app already writes", () => {
    expect(css).toContain(':root[data-theme="dark"]');
    for (const [name, value] of [
      ["--color-bg", "#151c1a"],
      ["--color-sidebar", "#19221f"],
      ["--color-brand", "#4fb585"],
    ] as const) {
      expect(dark).toMatch(new RegExp(`${name}:\\s*${value};`));
    }
  });

  it("names the font stacks, weights and motion timings", () => {
    expect(css).toMatch(/--font-ui:\s*"Onest Variable"/);
    expect(css).toMatch(/--font-answer:\s*"Source Serif 4 Variable",\s*"Noto Serif Tamil Variable"/);
    expect(css).toMatch(/--weight-heading:\s*700;/);
    expect(css).toMatch(/--weight-button:\s*600;/);
    expect(css).toMatch(/--weight-body:\s*500;/);
    expect(css).toMatch(/--motion-ai-crossfade:\s*300ms;/);
    expect(css).toMatch(/--motion-ai-min-dwell:\s*1200ms;/);
  });

  it("cites a board for every token group", () => {
    expect(css).toContain("V2-Tokens.dc.html");
    expect(css).toContain("BS-Base.dc.html");
    expect(css).toContain("Brand-Locked");
  });

  it("is imported before styles.css", () => {
    const main = readFileSync(path.join(here, "../main.tsx"), "utf8");
    expect(main.indexOf("./brand/tokens.css")).toBeGreaterThan(-1);
    expect(main.indexOf("./brand/tokens.css")).toBeLessThan(main.indexOf("./styles.css"));
  });
});

describe("logo.css", () => {
  const css = read("logo/logo.css");
  it("falls back to the static mark for both reduce-motion switches", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(':root[data-motion="reduced"]');
  });
  it("prefixes every state keyframe", () => {
    const names = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(40);
    expect(names.every((n) => n?.startsWith("am-"))).toBe(true);
  });
});

describe("state changes and canvas logos", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("holds a state for at least 1.2 s before the next replaces it, then cross-fades", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<AiStateMark state="thinking" />));
    await act(async () => {
      vi.advanceTimersByTime(400);
      root.render(<AiStateMark state="searching" />);
    });
    expect(host.querySelector(".ai-mark")?.getAttribute("data-state")).toBe("thinking");
    await act(async () => vi.advanceTimersByTime(700));
    expect(host.querySelector(".ai-mark")?.getAttribute("data-state")).toBe("thinking");
    await act(async () => vi.advanceTimersByTime(200));
    expect(host.querySelector(".ai-mark")?.getAttribute("data-state")).toBe("searching");
    expect(host.querySelectorAll("svg.ai-mark__layer")).toHaveLength(2);
    await act(async () => vi.advanceTimersByTime(300));
    expect(host.querySelectorAll("svg.ai-mark__layer")).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it("mounts LivingDots and ScatterToPoint without a canvas context (jsdom)", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <>
          <LivingDots size={36} theme="light" label="arcnave" />
          <ScatterToPoint variant="quick" theme="dark" />
          <ScatterToPoint variant="loop" />
        </>,
      ),
    );
    expect(host.querySelectorAll("canvas")).toHaveLength(3);
    expect(host.querySelector(".living-dots")?.getAttribute("aria-label")).toBe("arcnave");
    await act(async () => root.unmount());
  });
});
