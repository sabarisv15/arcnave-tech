import React, { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

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
 * CodeBlock renders markdown code blocks with an accessible header:
 * - Shows the detected or declared language name.
 * - Provides a per-block Copy button that copies plain text to clipboard.
 * - Shows "Copied" feedback for 2 seconds.
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
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
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

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const rawText = preRef.current?.textContent ?? extractTextFromChildren(children);
    // Remove the single trailing newline react-markdown adds to code blocks
    const cleanText = rawText.replace(/\n$/, "");

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(cleanText);
      } else {
        copyFallback(cleanText);
      }
      setCopied(true);
    } catch {
      copyFallback(cleanText);
      setCopied(true);
    }
  };

  const copyFallback = (text: string) => {
    try {
      if (typeof document === "undefined") return;
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } catch {
      // Ignore if clipboard fallback fails
    }
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-language">{language}</span>
        <button
          type="button"
          className="code-copy-button"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check size={13} aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre ref={preRef} tabIndex={0} className={className} {...rest}>
        {children}
      </pre>
    </div>
  );
}
