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
