// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Markdown, MarkdownErrorBoundary } from "./Content";

// Mock loadMermaid to avoid rendering external canvas/svg during hook transition test
vi.mock("./MermaidBlock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./MermaidBlock")>();
  return {
    ...actual,
    loadMermaid: vi.fn().mockResolvedValue({
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: "<svg>test</svg>" }),
    }),
  };
});

describe("Markdown streaming and error handling", () => {
  beforeEach(() => {
    // @ts-expect-error React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    // @ts-expect-error React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("streams progressively from '```m' to '```mer' to '```mermaid' without throwing hook count mismatch", async () => {

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;

    expect(() => {
      act(() => {
        root = createRoot(container);
      });

      // 1. Initial partial fence: "```m\nx"
      act(() => {
        root!.render(<Markdown text="```m\nx" isStreaming={true} />);
      });

      // 2. Extending fence: "```mer\nx"
      act(() => {
        root!.render(<Markdown text="```mer\nx" isStreaming={true} />);
      });

      // 3. Complete mermaid fence switch: "```mermaid\ngraph TD;A-->B"
      act(() => {
        root!.render(
          <Markdown text={"```mermaid\ngraph TD;A-->B"} isStreaming={true} />,
        );
      });
    }).not.toThrow();

    // Verify container contains text from the streaming render
    expect(container.innerHTML).toContain("graph TD");

    act(() => {
      root?.unmount();
    });
    document.body.removeChild(container);
  });

  it("safely catches markdown rendering errors in MarkdownErrorBoundary and displays raw source", async () => {
    const BadComponent = () => {
      throw new Error("Simulated rendering crash inside markdown block");
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // Suppress console.error during expected boundary catch
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const fallbackSource = "```broken\nsource code here\n```";

    act(() => {
      root.render(
        <MarkdownErrorBoundary fallbackText={fallbackSource}>
          <BadComponent />
        </MarkdownErrorBoundary>,
      );
    });

    // Check that error fallback rendered source rather than crashing
    const fallback = container.querySelector(".markdown-error-fallback");
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain("source code here");

    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
    consoleSpy.mockRestore();
  });
});
