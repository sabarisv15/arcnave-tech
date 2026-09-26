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
    expect(doc.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`)).toBe(true);
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("fetch("));
    for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
      expect(SANDBOX_CSP).toContain(directive);
    }
    await render(<SandboxFrame html="<p>x</p>" title="t" />);
    expect(frameOf().getAttribute("srcdoc")).toBe(buildSrcDoc("<p>x</p>"));
  });

  it("does not let the content's own head replace the policy", () => {
    const doc = buildSrcDoc('<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head></html>');
    expect(doc.indexOf(SANDBOX_CSP)).toBeLessThan(doc.indexOf("default-src *"));
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
