import React, { useContext, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Code as CodeIcon, Eye } from "lucide-react";
import { MarkdownContext } from "./Content";

interface MermaidBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  source: string;
  node?: unknown;
  children?: React.ReactNode;
}

let mermaidInstance: typeof import("mermaid").default | null = null;

export async function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidInstance) {
    const mod = await import("mermaid");
    mermaidInstance = mod.default;
  }
  return mermaidInstance;
}

/**
 * Checks if the current Mermaid code block has received its closing fence
 * in the raw markdown text during streaming.
 */
export function isBlockClosed(rawText: string, source: string): boolean {
  if (!rawText) return true;
  const trimmedSource = source.trim();
  const idx = rawText.indexOf(trimmedSource);
  if (idx !== -1) {
    const after = rawText.slice(idx + trimmedSource.length);
    return /\n\s*(```|~~~)/.test(after);
  }
  return /```mermaid[\s\S]*?```/.test(rawText);
}

/**
 * Returns the theme string ('dark' | 'default') for Mermaid based on document theme.
 */
export function getMermaidTheme(): "dark" | "default" {
  if (typeof document !== "undefined") {
    const themeAttr = document.documentElement.dataset["theme"];
    if (themeAttr === "dark") return "dark";
    if (themeAttr === "light") return "default";
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  }
  return "default";
}

export function MermaidBlock({
  source,
  children,
  className,
  ...rest
}: MermaidBlockProps) {
  const { isStreaming, rawText } = useContext(MarkdownContext);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"diagram" | "code">("diagram");
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // During streaming, show source until the closing fence has arrived
  const closed = !isStreaming || isBlockClosed(rawText, source);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    // If block has not closed and streaming is active, do not render diagram yet
    if (!closed) {
      setSvg(null);
      setError(null);
      return;
    }

    let isMounted = true;
    const debounceTimer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        const theme = getMermaidTheme();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme,
        });

        const uniqueId = "mermaid-" + Math.random().toString(36).substring(2, 9);
        const { svg: renderedSvg } = await mermaid.render(uniqueId, source);

        if (isMounted) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError("Diagram could not be drawn");
          setSvg(null);
        }
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(debounceTimer);
    };
  }, [source, closed]);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(source);
      } else {
        copyFallback(source);
      }
      setCopied(true);
    } catch {
      copyFallback(source);
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
      // Ignore fallback error
    }
  };

  const handleDownloadSvg = () => {
    if (!svg || typeof document === "undefined") return;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Render error fallback: show source with "Diagram could not be drawn"
  if (error) {
    return (
      <div className="mermaid-wrapper mermaid-error">
        <div className="mermaid-error-note">Diagram could not be drawn</div>
        <div className="code-block-wrapper">
          <div className="code-block-header">
            <span className="code-block-language">mermaid</span>
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
            {children ?? <code>{source}</code>}
          </pre>
        </div>
      </div>
    );
  }

  // If still streaming unclosed or rendering hasn't completed yet, or in code view
  if (!closed || !svg || view === "code") {
    return (
      <div className="mermaid-wrapper">
        <div className="mermaid-header">
          <span className="code-block-language">mermaid</span>
          <div className="mermaid-actions">
            {svg && (
              <div className="mermaid-toggle">
                <button
                  type="button"
                  className="mermaid-toggle-btn"
                  aria-pressed={false}
                  onClick={() => setView("diagram")}
                >
                  <Eye size={12} aria-hidden="true" />
                  <span>Diagram</span>
                </button>
                <button
                  type="button"
                  className="mermaid-toggle-btn active"
                  aria-pressed={true}
                  onClick={() => setView("code")}
                >
                  <CodeIcon size={12} aria-hidden="true" />
                  <span>Code</span>
                </button>
              </div>
            )}
            <button
              type="button"
              className="mermaid-action-btn"
              aria-label={copied ? "Copied" : "Copy code"}
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <Check size={12} aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={12} aria-hidden="true" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
        <pre ref={preRef} tabIndex={0} className={className} {...rest}>
          {children ?? <code>{source}</code>}
        </pre>
      </div>
    );
  }

  // Diagram view
  return (
    <div className="mermaid-wrapper">
      <div className="mermaid-header">
        <span className="code-block-language">mermaid</span>
        <div className="mermaid-actions">
          <div className="mermaid-toggle">
            <button
              type="button"
              className="mermaid-toggle-btn active"
              aria-pressed={true}
              onClick={() => setView("diagram")}
            >
              <Eye size={12} aria-hidden="true" />
              <span>Diagram</span>
            </button>
            <button
              type="button"
              className="mermaid-toggle-btn"
              aria-pressed={false}
              onClick={() => setView("code")}
            >
              <CodeIcon size={12} aria-hidden="true" />
              <span>Code</span>
            </button>
          </div>
          <button
            type="button"
            className="mermaid-action-btn"
            aria-label={copied ? "Copied" : "Copy source"}
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check size={12} aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="mermaid-action-btn"
            aria-label="Download SVG"
            onClick={handleDownloadSvg}
          >
            <Download size={12} aria-hidden="true" />
            <span>SVG</span>
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="mermaid-container"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
export default MermaidBlock;
