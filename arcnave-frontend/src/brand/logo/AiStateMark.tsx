import { useEffect, useId, useRef, useState } from "react";
import { AI_STATE_DEFS, AI_STATE_IDLE, AI_STATE_MARKUP } from "./aiStateMarkup";
import "./logo.css";

/**
 * The nine AI states: the seed becomes the tool (Brand-Locked "AI states (9)", States-Polish).
 *
 *   writing = quill, searching = lens, reading = reader, running = gear, creating = pencil,
 *   thinking = "Mazhai" cloud, done = seal stamp, needs-input = chat bubble, error = detour.
 *
 * Rules from the board, all implemented here:
 *  - loops while the state is active;
 *  - a state shows for at least 1.2 s before the next one replaces it (`minDwellMs`), so a 0.4 s
 *    "thinking" does not flicker;
 *  - states change with a 300 ms cross-fade, never a jump;
 *  - 32 px is the chat size and uses the board's thicker, bigger-tool "-s" cut ("Big sizes keep
 *    the original"), so sizes up to 48 px pick the small cut;
 *  - reduce motion (OS setting or Settings, see logo.css) shows the still logo only.
 *
 * The markup is generated from the board (aiStateMarkup.ts); the animation is CSS (logo.css).
 */
export const AI_STATES = [
  "writing",
  "searching",
  "reading",
  "running",
  "creating",
  "thinking",
  "done",
  "needs-input",
  "error",
] as const;

export type AiState = (typeof AI_STATES)[number];

/** Board names (States-Polish cell titles). */
export const AI_STATE_LABELS: Record<AiState, string> = {
  writing: "Writing",
  searching: "Searching",
  reading: "Reading",
  running: "Running",
  creating: "Creating",
  thinking: "Thinking",
  done: "Done",
  "needs-input": "Needs input",
  error: "Error",
};

export const AI_STATE_MIN_DWELL_MS = 1200;
export const AI_STATE_CROSSFADE_MS = 300;

export interface AiStateMarkProps {
  state: AiState;
  /** Edge in CSS px; 32 is the chat size. */
  size?: number;
  /** Force a cut; by default sizes up to 48 px use the small ("-s") cut. */
  cut?: "small" | "large";
  /** Accessible name; defaults to the board name of the state. */
  label?: string;
  /** Hide from assistive tech when a visible status line already says the same thing. */
  decorative?: boolean;
  /** Minimum time a state stays on screen before the next replaces it. */
  minDwellMs?: number;
  className?: string;
}

const VIEWBOX = { small: "-6 -14 118 118", large: "-20 -24 140 140" } as const;

function safeId(raw: string): string {
  return "an" + raw.replace(/[^a-zA-Z0-9]/g, "");
}

function layerHtml(state: AiState, cut: "small" | "large", uid: string): string {
  const entry = AI_STATE_MARKUP[state];
  const live = entry ? entry[cut] : "";
  return (
    `<defs>${AI_STATE_DEFS}</defs>` +
    `<g class="ai-mark__live">${live}</g>` +
    `<g class="ai-mark__idle">${AI_STATE_IDLE}</g>`
  ).replaceAll("__U__", uid);
}

export function AiStateMark({
  state,
  size = 32,
  cut,
  label,
  decorative = false,
  minDwellMs = AI_STATE_MIN_DWELL_MS,
  className,
}: AiStateMarkProps) {
  const base = safeId(useId());
  const [shown, setShown] = useState<AiState>(state);
  const [leaving, setLeaving] = useState<AiState | null>(null);
  const shownAt = useRef(Date.now());
  const chosenCut = cut ?? (size <= 48 ? "small" : "large");

  // Move to the requested state, but never sooner than minDwellMs after the last change.
  useEffect(() => {
    if (state === shown) return;
    const wait = Math.max(0, minDwellMs - (Date.now() - shownAt.current));
    const timer = setTimeout(() => {
      shownAt.current = Date.now();
      setLeaving(shown);
      setShown(state);
    }, wait);
    return () => clearTimeout(timer);
  }, [state, shown, minDwellMs]);

  // Drop the outgoing layer once its fade-out has played.
  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(() => setLeaving(null), AI_STATE_CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  const name = label ?? AI_STATE_LABELS[state];
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": name } as const);

  const layer = (which: AiState, role: "cur" | "out") => (
    <svg
      key={`${which}-${role}`}
      className={`ai-mark__layer${leaving !== null ? (role === "cur" ? " ai-mark__layer--in" : " ai-mark__layer--out") : ""}`}
      width={size}
      height={size}
      viewBox={VIEWBOX[chosenCut]}
      focusable={false}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: layerHtml(which, chosenCut, `${base}${role}`) }}
    />
  );

  return (
    <span
      className={["ai-mark", className].filter(Boolean).join(" ")}
      data-state={shown}
      style={{ width: size, height: size }}
      {...a11y}
    >
      {leaving !== null ? layer(leaving, "out") : null}
      {layer(shown, "cur")}
    </span>
  );
}
