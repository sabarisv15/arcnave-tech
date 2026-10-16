import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import type { Options } from "react-markdown";
import "katex/dist/katex.min.css";

import { CodeBlock } from "./CodeBlock";

type MarkdownNode = {
  type: string;
  value?: string;
  data?: unknown;
  children?: MarkdownNode[];
};

// Currency amounts can look like a delimiter pair; restore text without reparsing code.
export function preserveCurrency() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (
        node.type === "inlineMath" &&
        /^\d[\d,.]*(?:\s+(?:and|or|to|each|per|for|a|at|is|was|versus)\b[\s\S]*|\s+)$/.test(
          node.value ?? "",
        )
      ) {
        node.type = "text";
        node.value = `$${node.value}$`;
        delete node.data;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
/** The next unescaped `\\<c>` at or after `from` (a backslash pair is an escaped backslash), or -1. */
function nextCloser(text: string, c: string, from: number): number {
  let at = text.indexOf(`\\${c}`, from);
  while (at > 0 && text[at - 1] === "\\") at = text.indexOf(`\\${c}`, at + 1);
  return at;
}

/**
 * A bracket written as text holds words in any script, numbers, prose punctuation, a hyphen inside
 * a word, or nothing (`\\[1\\]`, `- \\[ \\] todo`, `\\[Recipient's Name\\]`); anything else (a
 * command, an operator, a group) is display math. One character at a time, so linear.
 */
const PLAIN_BRACKET = /^(?:[\s\p{L}\p{M}\p{N}.,#'\u2019:;!?"()]|(?<=\p{L})-(?=\p{L}))*$/u;

/**
 * One pass, left to right. Each closer search starts where the last one for that delimiter ended
 * and only moves forward, so a reply full of unmatched openers stays linear.
 *
 * `\[ … \]` is math only inside one paragraph (no blank line between) and when it holds a math
 * signal: Markdown also writes a literal bracket as `\[` (`note \[1\]`, `- \[ \] todo`). It is a
 * display block when it has its own lines; inside a line (a list item, a table cell, prose) it
 * stays on that line as `$$…$$`, which remark-math renders inline and which breaks no structure.
 */
function convertDelimiters(text: string, atLineStart: boolean): string {
  let out = "";
  let i = 0;
  let inlineClose = -2;
  let displayClose = -2;
  let newline = -2;
  let blank = -2;
  /** A display pair whose body is plain text: later openers before the same closer hold plain text too. */
  let plainUntil = -1;
  /** Only spaces since the start of the current line. */
  let lineStart = atLineStart;
  const blankLine = /\r?\n[ \t]*\r?\n/g;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "\\" || i + 1 >= text.length) {
      out += ch;
      if (ch === "\n") lineStart = true;
      else if (ch !== " " && ch !== "\t") lineStart = false;
      i += 1;
      continue;
    }
    const next = text[i + 1]!;
    if (next === "\\") {
      out += "\\\\";
      lineStart = false;
      i += 2;
      continue;
    }
    if (next === "(") {
      if (inlineClose !== -1 && inlineClose < i + 2) inlineClose = nextCloser(text, ")", i + 2);
      if (newline !== -1 && newline < i + 2) newline = text.indexOf("\n", i + 2);
      if (inlineClose !== -1 && (newline === -1 || inlineClose < newline)) {
        out += `$${text.slice(i + 2, inlineClose).trim()}$`;
        lineStart = false;
        i = inlineClose + 2;
        continue;
      }
    } else if (next === "[") {
      if (displayClose !== -1 && displayClose < i + 2) displayClose = nextCloser(text, "]", i + 2);
      if (blank !== -1 && blank < i + 2) {
        blankLine.lastIndex = i + 2;
        blank = blankLine.exec(text)?.index ?? -1;
      }
      const inParagraph = displayClose !== -1 && (blank === -1 || displayClose < blank);
      if (inParagraph && displayClose > plainUntil) {
        const body = text.slice(i + 2, displayClose);
        if (!PLAIN_BRACKET.test(body)) {
          let end = displayClose + 2;
          while (end < text.length && (text[end] === " " || text[end] === "\t")) end += 1;
          const ownLines = lineStart && (end >= text.length || text[end] === "\n" || text[end] === "\r");
          // Split and trim, not a whitespace-around-newline regex: that backtracks quadratically on long runs of spaces.
          out += ownLines
            ? `\n$$\n${body.trim()}\n$$\n`
            : `$$${body.trim().split("\n").map((l) => l.trim()).join(" ")}$$`;
          lineStart = false;
          i = displayClose + 2;
          continue;
        }
        plainUntil = displayClose;
      }
    }
    out += ch + next;
    // Even after a hard line break (`\` + newline): a block there would leave the `\` shown as text.
    lineStart = false;
    i += 2;
  }
  return out;
}

/**
 * The reply's math delimiters as remark-math reads them. The system prompt asks for LaTeX in
 * \( … \) inline and \[ … \] display (Stage 6 ST-4); remark-math reads only $ and $$, and
 * Markdown would otherwise turn "\(" into a plain "(" (a character escape). Code spans and fenced
 * code are left as written, and so is an escaped backslash ("\\(").
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) return markdown;
  // Line by line: lines inside a fence (``` or ~~~, closed by the same run or longer), and every
  // line after a fence still open mid-stream, stay as written; so do code spans.
  const lines = markdown.split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (prose.length === 0) return;
    out.push(
      prose
        .join("\n")
        .split(/(`+[^`\n]*`+)/)
        .map((seg, j) => (j % 2 === 1 ? seg : convertDelimiters(seg, j === 0)))
        .join(""),
    );
    prose = [];
  };
  for (const line of lines) {
    const marker = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && marker) {
      flush();
      fence = marker;
      out.push(line);
    } else if (fence !== null) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
    } else {
      prose.push(line);
    }
  }
  flush();
  return out.join("\n");
}

export const remarkPlugins: NonNullable<Options["remarkPlugins"]> = [remarkGfm, remarkMath, preserveCurrency];

// rehypeKatex runs before rehypeHighlight so formulas are typeset, not treated as code.
// throwOnError false keeps a malformed formula visible as source instead of breaking the reply.
// In chat markdown, detect: false ensures plain fences are not misdetected (e.g. bank statements as makefile).
export const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [
  [rehypeKatex, { throwOnError: false }],
  [rehypeHighlight, { detect: false }],
];

// rehypePluginsWithDetection is used specifically for code artifacts without a known extension.
export const rehypePluginsWithDetection: NonNullable<Options["rehypePlugins"]> = [
  [rehypeKatex, { throwOnError: false }],
  [rehypeHighlight, { detect: true }],
];

// Shared components map used across chat markdown and generative-ui blocks for consistent
// code block styling, copy actions, and language badges.
export const sharedMarkdownComponents: NonNullable<Options["components"]> = {
  pre: CodeBlock,
};
