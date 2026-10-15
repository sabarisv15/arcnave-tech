import { useEffect, useRef } from "react";
import { prefersStillMotion, useDocumentTheme } from "../motion";
import type { BrandTheme } from "../motion";
import { createLoopPainter, createSplashPainter } from "./scatter";
import "./logo.css";

/**
 * "Scattered -> one point": what is scattered, we bring to one point (Brand-Locked).
 *
 *  - `first`: first open, 3 s. College papers drift and flip, turn into dots of light, gather into
 *    the leaf, settle as the logo (Splash-v3 "beat by beat").
 *  - `quick`: every other open, 1 s. No papers; dots gather 0-0.65 s, then the wordmark beat.
 *  - `loop`: the 16 s brand loop on night green, for the sign-in panel and the website (Brand-Motion).
 *
 * Rules from the boards: the quick splash never adds waiting, so when the app is ready early
 * (`ready`) the animation jumps to its end frame in 200 ms (`--motion-splash-skip`). Reduce motion
 * draws the finished frame and calls `onDone` at once. Drawing pauses while the tab is hidden.
 *
 * Fills its parent; give the parent a size. The dots are the logo: no SVG logo is laid over them.
 */
export interface ScatterToPointProps {
  variant?: "first" | "quick" | "loop";
  /** Splash only. Defaults to the document theme. */
  theme?: BrandTheme;
  /** Splash: edge of the logo the dots gather into, px (board: 96). */
  logoSize?: number;
  /** Splash: logo centre as a fraction of the height (board: 0.44). */
  logoY?: number;
  /** Splash: the app finished loading; fast-forward to the end frame. */
  ready?: boolean;
  /** Splash: called once when the motion has reached its end frame. */
  onDone?: () => void;
  /** Splash: wordmark opacity 0..1 as it animates, to drive a Wordmark fade. */
  onWordmark?: (opacity: number) => void;
  /** Loop: logo size as a fraction of the shorter side (board data-s). */
  scale?: number;
  /** Loop: centre as fractions of the canvas (board data-x / data-y). */
  x?: number;
  y?: number;
  /** Loop: freeze on this second instead of playing (board data-t). */
  still?: number;
  className?: string;
}

/** Board `window.__fx` offset: the loop starts 1.5 s in so the first frame already has papers. */
const LOOP_START_OFFSET_S = 1.5;
/** Board reduced-motion frame for the loop: logo formed, seed pulsing. */
const LOOP_REDUCED_FRAME_S = 11;
const SKIP_MS = 200;

export function ScatterToPoint({
  variant = "first",
  theme,
  logoSize = 96,
  logoY = 0.44,
  ready = false,
  onDone,
  onWordmark,
  scale,
  x,
  y,
  still,
  className,
}: ScatterToPointProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docTheme = useDocumentTheme();
  const resolved: BrandTheme = theme ?? docTheme;
  const readyRef = useRef(ready);
  const doneRef = useRef(onDone);
  const wordRef = useRef(onWordmark);
  readyRef.current = ready;
  doneRef.current = onDone;
  wordRef.current = onWordmark;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = prefersStillMotion();
    let raf = 0;
    let dead = false;

    if (variant === "loop") {
      const painter = createLoopPainter({
        canvas,
        ...(scale !== undefined ? { scale } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
      });
      if (!painter) return;
      if (still !== undefined) {
        raf = requestAnimationFrame(() => painter.draw(still));
      } else if (reduce) {
        raf = requestAnimationFrame(() => painter.draw(LOOP_REDUCED_FRAME_S));
      } else {
        const t0 = performance.now() - LOOP_START_OFFSET_S * 1000;
        const loop = (now: number): void => {
          if (dead) return;
          if (!document.hidden) painter.draw((now - t0) / 1000);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      }
      return () => {
        dead = true;
        cancelAnimationFrame(raf);
      };
    }

    const painter = createSplashPainter({ canvas, variant, theme: resolved, logoSize, logoY });
    if (!painter) return;
    const finish = (): void => {
      wordRef.current?.(1);
      doneRef.current?.();
    };
    if (reduce) {
      raf = requestAnimationFrame(() => {
        painter.draw(painter.duration);
        finish();
      });
    } else {
      const t0 = performance.now();
      let readyAt: number | null = null;
      let eAtReady = 0;
      let finished = false;
      const loop = (now: number): void => {
        if (dead) return;
        let e = (now - t0) / 1000;
        if (readyRef.current && e < painter.duration) {
          if (readyAt === null) {
            readyAt = now;
            eAtReady = e;
          }
          e = eAtReady + (painter.duration - eAtReady) * Math.min(1, (now - readyAt) / SKIP_MS);
        }
        e = Math.min(e, painter.duration);
        if (!document.hidden) wordRef.current?.(painter.draw(e));
        if (e >= painter.duration && !finished) {
          finished = true;
          finish();
          return;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [variant, resolved, logoSize, logoY, scale, x, y, still]);

  return (
    <div className={["scatter-point", className].filter(Boolean).join(" ")}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
