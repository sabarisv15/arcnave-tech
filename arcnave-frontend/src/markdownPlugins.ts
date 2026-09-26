import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import type { Options } from "react-markdown";
import "katex/dist/katex.min.css";

import { CodeBlock } from "./CodeBlock";

// Math renders as Claude's app renders it. Only `$$…$$` is math: a single `$` is left as
// text, because answers quote prices ("$5 and $10") far more often than inline formulas.
export const remarkPlugins: NonNullable<Options["remarkPlugins"]> = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];

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
