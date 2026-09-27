// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MAX_HEIGHT,
  MIN_HEIGHT,
  PROMPT_MAX_CHARS,
  SANDBOX_CSP,
  SandboxFrame,
  buildSrcDoc,
  readFrameMessage,
} from "./SandboxFrame";
import { SANDBOX_BASE_CSS } from "./sandboxTheme";

vi.mock("./workspace", () => ({
  useWorkspace: () => ({ saveVisualAsArtifact: vi.fn(), toast: vi.fn() }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const frameOf = () => host.querySelector("iframe")!;

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}

async function post(source: MessageEventSource | null, data: unknown) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

describe("SandboxFrame isolation (ADR-0035)", () => {
  it("allows scripts and nothing else: never same-origin, popups, forms or top navigation", async () => {
    await render(<SandboxFrame html="<p>x</p>" title="t" />);
    const tokens = frameOf().getAttribute("sandbox")!.split(/\s+/);
    expect(tokens).toEqual(["allow-scripts"]);
    expect(tokens).not.toContain("allow-same-origin");
  });

  it("puts ArcNave's CSP first, before the bridge and the content", async () => {
    const doc = buildSrcDoc('<script>fetch("https://example.com")</script>');
    expect(doc.startsWith(`<!doctype html><html data-theme="light"><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`)).toBe(true);
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("fetch("));
    for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
      expect(SANDBOX_CSP).toContain(directive);
    }
    await render(<SandboxFrame html="<p>x</p>" title="t" />);
    expect(frameOf().getAttribute("srcdoc")).toBe(buildSrcDoc("<p>x</p>"));
  });

  it("gives show_widget code sendPrompt, the same message as window.arcnave.prompt (ADR-0048)", () => {
    const doc = buildSrcDoc("<p>x</p>");
    expect(doc).toContain("window.sendPrompt=window.arcnave.prompt;");
    expect(doc.indexOf("window.sendPrompt")).toBeLessThan(doc.indexOf("<p>x</p>"));
  });

  it("does not let the content's own head replace the policy", () => {
    const doc = buildSrcDoc('<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head></html>');
    expect(doc.indexOf(SANDBOX_CSP)).toBeLessThan(doc.indexOf("default-src *"));
  });
});

describe("theme (ADR-0036)", () => {
  afterEach(() => {
    delete document.documentElement.dataset["theme"];
  });

  it("builds the document with the base styles after the policy, in the theme asked for", () => {
    const doc = buildSrcDoc("<p>x</p>", "dark");
    expect(doc.startsWith('<!doctype html><html data-theme="dark">')).toBe(true);
    expect(doc.indexOf(SANDBOX_BASE_CSS)).toBeGreaterThan(doc.indexOf(SANDBOX_CSP));
    expect(doc.indexOf(SANDBOX_BASE_CSS)).toBeLessThan(doc.indexOf("<p>x</p>"));
    expect(doc).toContain('<meta name="color-scheme" content="light dark">');
  });

  it("pads a page (artifact panel) but not an inline visual", () => {
    expect(buildSrcDoc("x", "light", "page")).toContain('<html data-theme="light" data-layout="page">');
    expect(buildSrcDoc("x", "light").startsWith('<!doctype html><html data-theme="light"><head>')).toBe(true);
    expect(SANDBOX_BASE_CSS).toContain(':where([data-layout="page"]) :where(body){padding:16px 20px}');
  });

  it("styles elements only through :where(), so the content's own CSS always wins", () => {
    const rules = SANDBOX_BASE_CSS.split("}")
      .map((r) => r.trim())
      .filter((r) => r.includes("{") && !r.startsWith(":root"))
      .map((r) => r.slice(0, r.indexOf("{")).trim())
      .filter(Boolean);
    expect(rules.length).toBeGreaterThan(10);
    for (const selector of rules) expect(selector.startsWith(":where(")).toBe(true);
  });

  it("defines every token in both themes", () => {
    const block = (start: string) => {
      const from = SANDBOX_BASE_CSS.indexOf(start);
      return SANDBOX_BASE_CSS.slice(from, SANDBOX_BASE_CSS.indexOf("}", from));
    };
    const light = block(":root{");
    const dark = block(':root[data-theme="dark"]{');
    const names = (s: string) => new Set([...s.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
    for (const name of names(dark)) expect(names(light)).toContain(name);
    for (const name of ["--text", "--surface", "--border", "--c1", "--c6"]) expect(names(dark)).toContain(name);
  });

  it("opens in ArcNave's theme and sends later changes to its own frame", async () => {
    document.documentElement.dataset["theme"] = "dark";
    await render(<SandboxFrame html="<p>x</p>" title="t" />);
    expect(frameOf().getAttribute("srcdoc")!.startsWith('<!doctype html><html data-theme="dark">')).toBe(true);

    const post = vi.spyOn(frameOf().contentWindow!, "postMessage");
    await act(async () => {
      document.documentElement.dataset["theme"] = "light";
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(post).toHaveBeenCalledWith({ type: "arcnave:theme", theme: "light" }, "*");
    // A theme change must not rebuild the document: that would reload the frame and lose its state.
    expect(frameOf().getAttribute("srcdoc")!.startsWith('<!doctype html><html data-theme="dark">')).toBe(true);
  });
});

describe("drafts (ADR-0037)", () => {
  it("keeps one empty document and sends the growing markup to it, at most every 100ms", async () => {
    vi.useFakeTimers();
    try {
      await render(<SandboxFrame html="<svg>" title="t" draft />);
      const frame = frameOf();
      expect(frame.getAttribute("srcdoc")).toBe(buildSrcDoc(""));
      const post = vi.spyOn(frame.contentWindow!, "postMessage");
      await render(<SandboxFrame html="<svg><path/>" title="t" draft />);
      await render(<SandboxFrame html="<svg><path/><path/>" title="t" draft />);
      expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "arcnave:draft" }), "*");
      await act(async () => vi.advanceTimersByTime(100));
      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith({ type: "arcnave:draft", html: "<svg><path/><path/>" }, "*");
      // Still the same document: a growing draft never reloads the frame.
      expect(frameOf()).toBe(frame);
      expect(frame.getAttribute("srcdoc")).toBe(buildSrcDoc(""));
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the frame take a draft only from its parent, and draw it as markup", () => {
    const bridge = buildSrcDoc("");
    expect(bridge).toContain('if(e.source!==p||!e.data)return;if(e.data.type==="arcnave:draft"){if(document.body)document.body.innerHTML=');
  });
});

describe("frame messages", () => {
  it("accepts only resize and prompt, within their limits", () => {
    expect(readFrameMessage({ type: "arcnave:resize", height: 5 })).toEqual({ type: "arcnave:resize", height: MIN_HEIGHT });
    expect(readFrameMessage({ type: "arcnave:resize", height: 99999 })).toEqual({ type: "arcnave:resize", height: MAX_HEIGHT });
    expect(readFrameMessage({ type: "arcnave:resize", height: Number.NaN })).toBeNull();
    expect(readFrameMessage({ type: "arcnave:prompt", text: "Show 8%" })).toEqual({ type: "arcnave:prompt", text: "Show 8%" });
    expect(readFrameMessage({ type: "arcnave:prompt", text: "x".repeat(PROMPT_MAX_CHARS + 1) })).toBeNull();
    expect(readFrameMessage({ type: "arcnave:prompt", text: "   " })).toBeNull();
    expect(readFrameMessage({ type: "arcnave:navigate", url: "https://example.com" })).toBeNull();
    expect(readFrameMessage("arcnave:prompt")).toBeNull();
  });

  it("takes a prompt only from its own frame", async () => {
    const onPrompt = vi.fn();
    await render(<SandboxFrame html="<p>x</p>" title="t" onPrompt={onPrompt} />);

    await post(window, { type: "arcnave:prompt", text: "from the page" });
    const other = document.createElement("iframe");
    document.body.appendChild(other);
    await post(other.contentWindow, { type: "arcnave:prompt", text: "from another frame" });
    other.remove();
    expect(onPrompt).not.toHaveBeenCalled();

    await post(frameOf().contentWindow, { type: "arcnave:prompt", text: "from the visual" });
    expect(onPrompt).toHaveBeenCalledWith("from the visual");
  });

  it("resizes an inline frame from its own messages only", async () => {
    await render(<SandboxFrame html="<p>x</p>" title="t" autoHeight />);
    await post(window, { type: "arcnave:resize", height: 900 });
    expect(frameOf().style.height).toBe("240px");
    await post(frameOf().contentWindow, { type: "arcnave:resize", height: 900 });
    expect(frameOf().style.height).toBe("900px");
  });
});

describe("navigation", () => {
  it("restores the document when the frame navigates itself", async () => {
    await render(<SandboxFrame html="<p>x</p>" title="t" />);
    const first = frameOf();
    // jsdom loads the srcdoc document itself, as a browser does: that first load is allowed.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(host.textContent).not.toContain("Navigation blocked");

    // A further load is the frame navigating away.
    await act(async () => first.dispatchEvent(new Event("load")));
    expect(host.textContent).toContain("Navigation blocked");
    expect(frameOf()).not.toBe(first);
    expect(frameOf().getAttribute("srcdoc")).toBe(buildSrcDoc("<p>x</p>"));
  });
});
