// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
  CodeBlock,
  PlainCodeBlock,
  extractLanguageFromChildren,
  extractTextFromChildren,
} from "./CodeBlock";
import * as clipboardModule from "./clipboard";
import {
  remarkPlugins,
  rehypePlugins,
  sharedMarkdownComponents,
} from "./markdownPlugins";

describe("CodeBlock component", () => {
  it("renders a fenced python block showing 'python' and a Copy button", () => {
    const markdown = "```python\ndef greet():\n    return 'hello'\n```";
    const html = renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={sharedMarkdownComponents}
      >
        {markdown}
      </ReactMarkdown>,
    );

    // Language header contains "python"
    expect(html).toContain('class="code-block-language">python</span>');
    // Header contains copy button with accessible aria-label and Copy text
    expect(html).toContain('class="code-copy-button"');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain("<span>Copy</span>");
    // Code content is preserved inside pre
    expect(html).toContain("greet");
  });

  it("renders fenced block without language with an empty language label and copy button", () => {
    const markdown = "```\nplain text code block\n```";
    const html = renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={sharedMarkdownComponents}
      >
        {markdown}
      </ReactMarkdown>,
    );

    // Empty language label for undeclared plain fences
    expect(html).toContain('<span class="code-block-language"></span>');
    expect(html).toContain('class="code-copy-button"');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain("plain");
    expect(html).toContain("block");
  });

  it("extracts language from language-* class names", () => {
    const codeWithClass = <code className="language-typescript">const x = 1;</code>;
    expect(extractLanguageFromChildren(codeWithClass)).toBe("typescript");

    const codeWithHljs = (
      <code className="hljs language-sql">SELECT * FROM users;</code>
    );
    expect(extractLanguageFromChildren(codeWithHljs)).toBe("sql");

    const codeWithoutLang = <code>plain</code>;
    expect(extractLanguageFromChildren(codeWithoutLang)).toBe("");
  });

  it("extracts plain text recursively from React nodes", () => {
    const element = (
      <code>
        <span className="keyword">def</span>{" "}
        <span className="title">solve</span>():
      </code>
    );
    expect(extractTextFromChildren(element)).toBe("def solve():");
  });

  it("displays 'Copied' on successful copy in PlainCodeBlock", async () => {
    // @ts-expect-error React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(clipboardModule, "copyTextToClipboard").mockResolvedValueOnce(true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PlainCodeBlock language="python"><code>print(123)</code></PlainCodeBlock>);
    });

    const button = container.querySelector(".code-copy-button") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Copy code");

    await act(async () => {
      button.click();
    });

    expect(button.textContent).toContain("Copied");
    expect(button.getAttribute("aria-label")).toBe("Copied");

    act(() => root.unmount());
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it("displays 'Copy failed' on clipboard rejection in PlainCodeBlock", async () => {
    // @ts-expect-error React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(clipboardModule, "copyTextToClipboard").mockResolvedValueOnce(false);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<PlainCodeBlock language="python"><code>print(123)</code></PlainCodeBlock>);
    });

    const button = container.querySelector(".code-copy-button") as HTMLButtonElement;
    expect(button).not.toBeNull();

    await act(async () => {
      button.click();
    });

    expect(button.textContent).toContain("Copy failed");
    expect(button.getAttribute("aria-label")).toBe("Copy failed");

    act(() => root.unmount());
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });
});
