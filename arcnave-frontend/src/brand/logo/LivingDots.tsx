import { useEffect, useRef } from "react";
import { createLiveLogo } from "./liveLogo";
import type { LiveLogoMode } from "./liveLogo";
import { prefersStillMotion, useDocumentTheme } from "../motion";
import type { BrandTheme } from "../motion";
import "./logo.css";

/**
 * Logo D1 made of dots: the living logo (Logo-Live.dc.html, "One engine").
 *
 * Where it lives (Logo-Live "In real places"): sign-in pages 36 px (gathers once, then twinkles),
 * new-chat greeting 40 px, website hero 96 px+ with touch effect C (`mode="papers"`), app icon as
 * a still frame (`still={26.2}`). Where it stays still: sidebar, app header, chat (the AI states have
 * their own motion), favicon, e-mails, print - use `Logo` there. Touch effects only run at 64 px and
 * up. Reduce motion draws one finished frame.
 */
export interface LivingDotsProps {
  /** Logo edge in CSS px. */
  size?: number;
  /** Defaults to the document theme (`<html data-theme>`). */
  theme?: BrandTheme;
  /** "papers" is the locked touch effect (C). */
  mode?: LiveLogoMode;
  /** Play the 1.6 s gather on mount. */
  intro?: boolean;
  /** Canvas edge as a multiple of `size` (room for glow and papers). Board uses 1.15 to 1.7. */
  pad?: number;
  /** Freeze on this second (board: 26.2 for the app icon). */
  still?: number;
  /** Accessible name; omit when the logo is decorative. */
  label?: string;
  className?: string;
}

export function LivingDots({
  size = 96,
  theme,
  mode = "none",
  intro = true,
  pad,
  still,
  label,
  className,
}: LivingDotsProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const docTheme = useDocumentTheme();
  const resolved = theme ?? docTheme;
  const canvasPad = pad ?? (mode === "none" ? 1.25 : 1.7);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const handle = createLiveLogo(cv, {
      size,
      pad: canvasPad,
      theme: resolved,
      mode,
      intro,
      ...(still !== undefined ? { still } : {}),
      ...(cv.parentElement ? { hover: cv.parentElement } : {}),
      reduceMotion: prefersStillMotion(),
    });
    return () => handle.stop();
  }, [size, canvasPad, resolved, mode, intro, still]);

  const side = size * canvasPad;
  const offset = -(side - size) / 2;
  return (
    <span
      className={["living-dots", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <canvas ref={ref} aria-hidden="true" style={{ left: offset, top: offset, width: side, height: side }} />
    </span>
  );
}
