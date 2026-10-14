/**
 * Splash v3 (board `Splash-v3`): "scattered -> one point" as the app opens.
 *
 * NOT MOUNTED ON WEB. The board is explicit: "Web (arcnave.in app): No splash. Sign-in already
 * carries the brand motion. If the app shell takes over 400 ms, the 1 s quick version is the
 * loader." So nothing renders this today (the Gate's boot screen is untouched); it is exported
 * for the future app shell (Android first open 3 s, other opens 1 s; iPhone gets a plain launch
 * screen and the 3 s intro only on first open, never the 1 s one).
 *
 *  - `first`: 3 s, papers drift, turn into dots, gather into the leaf, wordmark rises in.
 *  - `quick`: 1 s, dots gather 0-0.65 s, wordmark 0.6-0.9 s.
 *  - Never adds waiting: `ready` jumps to the end frame in 200 ms (`--motion-splash-skip`).
 *  - Reduce motion: still logo and wordmark, no dots, same timing, no movement.
 */
import { useEffect, useRef } from "react";
import { ScatterToPoint, Wordmark, prefersStillMotion } from "../brand";

export type SplashVariant = "first" | "quick";

/** Board durations, in ms (tokens.css --motion-splash-first / --motion-splash-quick). */
export const SPLASH_MS: Record<SplashVariant, number> = {
  first: 3000,
  quick: 1000,
};
const SKIP_MS = 200;

export interface SplashProps {
  variant: SplashVariant;
  /** The app finished loading: fast-forward to the end frame in 200 ms. */
  ready?: boolean;
  /** Called once, when the end frame has been reached. */
  onDone?: () => void;
}

export function Splash({ variant, ready = false, onDone }: SplashProps) {
  const word = useRef<HTMLDivElement>(null);
  const still = useRef(prefersStillMotion());
  const done = useRef(false);
  const callback = useRef(onDone);
  callback.current = onDone;

  const setWord = (opacity: number) => {
    if (word.current) word.current.style.opacity = String(opacity);
  };
  const finish = () => {
    if (done.current) return;
    done.current = true;
    setWord(1);
    callback.current?.();
  };

  // Reduced motion: ScatterToPoint draws the end frame at once and reports done at once. The board
  // wants the same timing without movement, so the report is held back to the real duration, or to
  // the 200 ms skip once the app is ready.
  useEffect(() => {
    if (!still.current) return;
    const timer = window.setTimeout(
      finish,
      ready ? SKIP_MS : SPLASH_MS[variant],
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, variant]);

  return (
    <div
      className="sx-splash"
      role="status"
      aria-label="Opening arcnave"
      data-variant={variant}
    >
      <ScatterToPoint
        variant={variant}
        ready={ready}
        logoSize={96}
        logoY={0.44}
        onWordmark={setWord}
        onDone={() => {
          if (!still.current) finish();
        }}
      />
      <div className="sx-splash-word" ref={word} style={{ opacity: 0 }}>
        <Wordmark width={90} />
      </div>
    </div>
  );
}
