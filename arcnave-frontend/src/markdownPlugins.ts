import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import type { Options } from "react-markdown";
import "katex/dist/katex.min.css";

// Math renders as Claude's app renders it. Only `$$…$$` is math: a single `$` is left as
// text, because answers quote prices ("$5 and $10") far more often than inline formulas.
export const remarkPlugins: NonNullable<Options["remarkPlugins"]> = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];

// rehypeKatex runs before rehypeHighlight so formulas are typeset, not treated as code.
// throwOnError false keeps a malformed formula visible as source instead of breaking the reply.
export const rehypePlugins: NonNullable<Options["rehypePlugins"]> = [[rehypeKatex, { throwOnError: false }], rehypeHighlight];
