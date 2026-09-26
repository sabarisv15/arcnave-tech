import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
  CodeBlock,
  extractLanguageFromChildren,
  extractTextFromChildren,
} from "./CodeBlock";
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

  it("renders fenced block without language with a copy button", () => {
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
});
