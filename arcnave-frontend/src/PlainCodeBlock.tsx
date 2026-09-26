import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { copyTextToClipboard } from "./clipboard";
import { extractTextFromChildren } from "./CodeBlock";

export interface PlainCodeBlockProps
  extends React.HTMLAttributes<HTMLPreElement> {
  language: string;
  children?: React.ReactNode;
}

/**
 * PlainCodeBlock manages standard code block display, syntax styling,
 * and verified clipboard copy feedback with its own hooks.
 */
export function PlainCodeBlock({
  language,
  children,
  className,
  ...rest
}: PlainCodeBlockProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  const handleCopy = async () => {
    const rawText = preRef.current?.textContent ?? extractTextFromChildren(children);
    const cleanText = rawText.replace(/\n$/, "");
    const success = await copyTextToClipboard(cleanText);
    setCopyStatus(success ? "copied" : "failed");
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-language">{language}</span>
        <button
          type="button"
          className="code-copy-button"
          aria-label={
            copyStatus === "copied"
              ? "Copied"
              : copyStatus === "failed"
                ? "Copy failed"
                : "Copy code"
          }
          onClick={handleCopy}
        >
          {copyStatus === "copied" ? (
            <>
              <Check size={13} aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : copyStatus === "failed" ? (
            <>
              <X size={13} aria-hidden="true" />
              <span>Copy failed</span>
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
