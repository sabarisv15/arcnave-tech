import { useId } from "react";
import { WORDMARK_EN, WORDMARK_TA } from "./wordmarkMarkup";

/**
 * Wordmark L4 "Sprout cut": custom lettering, never typed (Brand-Locked, R16-Wordmark). The name
 * is always lowercase. English `arcnave` and Tamil `ஆர்க்நேவ்` are drawn by hand in the same
 * strokes; `both` is the board's bilingual lockup (English over Tamil).
 *
 * Size by the English width; the Tamil mark keeps the board's proportions to it (208.9 px beside a
 * 207.6 px English mark). Drawn in `currentColor`, default logo ink (`--color-logo-ink`).
 */
export type WordmarkLang = "en" | "ta" | "both";

export interface WordmarkProps {
  lang?: WordmarkLang;
  /** Width of the English mark in CSS px; the Tamil mark scales with it. */
  width?: number;
  /** Defaults to `var(--color-logo-ink)`. */
  color?: string;
  className?: string;
}

function parseViewBox(vb: string): { w: number; h: number } {
  const [, , w, h] = vb.split(" ").map(Number);
  return { w: w ?? 1, h: h ?? 1 };
}

const EN = parseViewBox(WORDMARK_EN.viewBox);
const TA = parseViewBox(WORDMARK_TA.viewBox);
/** R16-Wordmark bilingual lockup: English 207.6 x 42.0, Tamil 208.9 x 53.6, 1.5 px apart. */
const TAMIL_TO_ENGLISH = 208.9 / 207.6;
const LOCKUP_GAP = 1.5 / 207.6;

export function Wordmark({ lang = "en", width = 120, color, className }: WordmarkProps) {
  const uid = "an" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const enW = width;
  const enH = (enW * EN.h) / EN.w;
  const taW = lang === "ta" ? width : enW * TAMIL_TO_ENGLISH;
  const taH = (taW * TA.h) / TA.w;
  const style = { color: color ?? "var(--color-logo-ink)", flex: "none", display: "block" } as const;

  const en = (
    <svg
      key="en"
      width={enW}
      height={enH}
      viewBox={WORDMARK_EN.viewBox}
      role="img"
      aria-label="arcnave"
      style={style}
      dangerouslySetInnerHTML={{ __html: WORDMARK_EN.markup.replaceAll("__U__", uid) }}
    />
  );
  const ta = (
    <svg
      key="ta"
      width={taW}
      height={taH}
      viewBox={WORDMARK_TA.viewBox}
      role="img"
      aria-label="ஆர்க்நேவ்"
      lang="ta"
      style={style}
      dangerouslySetInnerHTML={{ __html: WORDMARK_TA.markup }}
    />
  );

  if (lang === "en") return <span className={className} style={{ display: "inline-flex" }}>{en}</span>;
  if (lang === "ta") return <span className={className} style={{ display: "inline-flex" }}>{ta}</span>;
  return (
    <span className={className} style={{ display: "inline-flex", flexDirection: "column", gap: enW * LOCKUP_GAP }}>
      {en}
      {ta}
    </span>
  );
}
