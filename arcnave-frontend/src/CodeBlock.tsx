import React from "react";
import { PlainCodeBlock } from "./PlainCodeBlock";
export { PlainCodeBlock } from "./PlainCodeBlock";

/**
 * Extracts plain text recursively from React child nodes.
 * Used for clipboard copy when the DOM node is not yet attached or in test environments.
 */
export function extractTextFromChildren(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromChildren).join("");
  if (React.isValidElement(node)) {
    return extractTextFromChildren(
      (node.props as { children?: React.ReactNode }).children,
    );
  }
  return "";
}

/**
 * Extracts language identifier from react-markdown code block child element class.
 * react-markdown outputs <code className="language-xxx"> inside <pre>.
 */
export function extractLanguageFromChildren(children: React.ReactNode): string {
  let language = "";
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      const className = (child.props as { className?: string }).className || "";
      const match = className.match(/language-([a-zA-Z0-9_+-]+)/);
      if (match) {
        language = match[1];
      }
    }
  });
  return language;
}

export interface CodeBlockProps
  extends React.HTMLAttributes<HTMLPreElement> {
  node?: unknown;
  children?: React.ReactNode;
}

/**
 * CodeBlock is a thin, hook-free dispatcher for markdown `<pre>` elements.
 * By keeping CodeBlock free of hooks, React never encounters mismatched hook counts
 * when streaming code fences switch between standard languages and "mermaid".
 */
const LazyMermaidBlock = React.lazy(() =>
  import("./MermaidBlock").then((m) => ({ default: m.MermaidBlock })),
);

export function CodeBlock({
  children,
  node: _node,
  className,
  ...rest
}: CodeBlockProps) {
  const language = extractLanguageFromChildren(children);

  if (language === "mermaid") {
    const rawSource = extractTextFromChildren(children).replace(/\n$/, "");
    return (
      <React.Suspense
        fallback={
          <div className="code-block-wrapper">
            <pre tabIndex={0} className={className} {...rest}>
              {children}
            </pre>
          </div>
        }
      >
        <LazyMermaidBlock
          source={rawSource}
          className={className}
          {...rest}
        >
          {children}
        </LazyMermaidBlock>
      </React.Suspense>
    );
  }

  return (
    <PlainCodeBlock language={language} className={className} {...rest}>
      {children}
    </PlainCodeBlock>
  );
}
