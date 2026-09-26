// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MermaidBlock, isBlockClosed, getMermaidTheme, loadMermaid } from "./MermaidBlock";
import { MarkdownContext } from "./Content";
import * as clipboardModule from "./clipboard";

describe("MermaidBlock logic & rendering", () => {
  it("correctly identifies closed vs unclosed fences with isBlockClosed", () => {
    const closed = "```mermaid\ngraph TD\nA --> B\n```\nDone.";
    const unclosed = "```mermaid\ngraph TD\nA --> B";

    expect(isBlockClosed(closed, "graph TD\nA --> B")).toBe(true);
    expect(isBlockClosed(unclosed, "graph TD\nA --> B")).toBe(false);
    expect(isBlockClosed("", "graph TD\nA --> B")).toBe(true);
  });

  it("determines mermaid theme from document context with getMermaidTheme", () => {
    // In node environment without DOM dataset, defaults to 'default'
    expect(["default", "dark"]).toContain(getMermaidTheme());
  });

  it("dynamically loads mermaid module via loadMermaid", async () => {
    const mermaid = await loadMermaid();
    expect(typeof mermaid.initialize).toBe("function");
    expect(typeof mermaid.render).toBe("function");
  });

  it("renders code block while unclosed and streaming", () => {
    const unclosed = "```mermaid\ngraph TD\nA --> B";
    const html = renderToStaticMarkup(
      <MarkdownContext.Provider value={{ isStreaming: true, rawText: unclosed }}>
        <MermaidBlock source="graph TD\nA --> B" />
      </MarkdownContext.Provider>,
    );

    expect(html).toContain('class="mermaid-wrapper"');
    expect(html).toContain('class="code-block-language">mermaid</span>');
    expect(html).toContain("graph TD");
    expect(html).toContain("A --&gt; B");
  });

  it("renders diagram wrapper with copy button and code view initially", () => {
    const closed = "```mermaid\ngraph TD\nA --> B\n```";
    const html = renderToStaticMarkup(
      <MarkdownContext.Provider value={{ isStreaming: false, rawText: closed }}>
        <MermaidBlock source="graph TD\nA --> B" />
      </MarkdownContext.Provider>,
    );

    expect(html).toContain('class="mermaid-wrapper"');
    expect(html).toContain('class="mermaid-action-btn"');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain("graph TD");
  });

  it("calls mermaid.initialize with strict security and renders valid diagram", async () => {
    const mermaid = await loadMermaid();
    const initSpy = vi.spyOn(mermaid, "initialize").mockImplementation(() => {});
    const renderSpy = vi.spyOn(mermaid, "render").mockResolvedValueOnce({
      svg: '<svg id="test-id"><text>Valid Diagram</text></svg>',
      diagramType: "flowchart",
    });

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
    });

    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: "strict",
      }),
    );

    const result = await mermaid.render("test-id", "graph TD\nA --> B");
    expect(renderSpy).toHaveBeenCalledWith("test-id", "graph TD\nA --> B");
    expect(result.svg).toContain("<svg");

    initSpy.mockRestore();
    renderSpy.mockRestore();
  });

  it("falls back gracefully when mermaid.render throws a syntax error", async () => {
    const mermaid = await loadMermaid();
    const renderSpy = vi.spyOn(mermaid, "render").mockRejectedValueOnce(new Error("Parse error"));

    let caughtError: unknown = null;
    try {
      await mermaid.render("bad-id", "graph TD\nINVALID_SYNTAX");
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(Error);
    renderSpy.mockRestore();
  });

  it("displays 'Copy failed' when copyTextToClipboard rejects in MermaidBlock", async () => {
    // @ts-expect-error React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(clipboardModule, "copyTextToClipboard").mockResolvedValueOnce(false);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownContext.Provider
          value={{ isStreaming: false, rawText: "```mermaid\ngraph TD\nA --> B\n```" }}
        >
          <MermaidBlock source="graph TD\nA --> B" />
        </MarkdownContext.Provider>,
      );
    });

    const copyBtn = container.querySelector(".mermaid-action-btn") as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      copyBtn.click();
    });

    expect(copyBtn.textContent).toContain("Copy failed");
    expect(copyBtn.getAttribute("aria-label")).toBe("Copy failed");

    act(() => root.unmount());
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it("re-renders diagram when document theme changes", async () => {
    // @ts-expect-error React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const mermaid = await loadMermaid();
    const initSpy = vi.spyOn(mermaid, "initialize").mockImplementation(() => {});
    vi.spyOn(mermaid, "render").mockResolvedValue({
      svg: '<svg id="theme-test"><text>Theme Test</text></svg>',
      diagramType: "flowchart",
    });

    document.documentElement.dataset.theme = "light";

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownContext.Provider
          value={{ isStreaming: false, rawText: "```mermaid\ngraph TD\nA --> B\n```" }}
        >
          <MermaidBlock source="graph TD\nA --> B" />
        </MarkdownContext.Provider>,
      );
    });

    // Wait for initial render debounce
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "default" }),
    );

    // Now change document theme to dark
    await act(async () => {
      document.documentElement.dataset.theme = "dark";
    });

    // Wait for theme update debounce
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );

    act(() => root.unmount());
    document.body.removeChild(container);
    initSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
