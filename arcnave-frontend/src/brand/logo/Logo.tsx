import { useId } from "react";
import { AI_STATE_DEFS, AI_STATE_IDLE } from "./aiStateMarkup";

/**
 * Logo D1: a leaf tile with one sky seed (docs/brand/Brand-Locked.dc.html "Logo").
 *
 * - `rich`: the board's `#rich` symbol (leaf matte tile, soft grain, sky glow around the seed, the
 *   seed cut out of the tile). App icon, splash end frame, sign-in, website.
 * - `flat`: the board's `#flatL` symbol, one colour (`currentColor`, default Kulam green). 32 px and
 *   below, sidebar, favicon, print. Brand-Locked: "Flat green: 32 px and below, sidebar, favicon".
 * - `idle`: leaf plus the white seed with its glow, the exact resting mark of the AI states
 *   (States-Polish `#st-idle`). It does not depend on what is behind it, so it is the chat-size
 *   logo (32 px is the chat size, `--size-logo-working`).
 *
 * The geometry (tile path, drop path, seed placement `translate(67 33) rotate(225) scale(.62)`)
 * is copied from the board.
 */
export type LogoVariant = "rich" | "flat" | "idle";

export interface LogoProps {
  /** Edge in CSS px. */
  size?: number;
  variant?: LogoVariant;
  /** Accessible name. Omit for a decorative logo (aria-hidden). */
  label?: string;
  className?: string;
  /** Flat variant colour; defaults to `currentColor` via `--color-logo-flat`. */
  color?: string;
}

const TILE = "M50 12 H84 Q88 12 88 16 V50 A38 38 0 0 1 50 88 H16 Q12 88 12 84 V50 A38 38 0 0 1 50 12 Z";
const DROP = "M0 -24 C6 -14 11 -8 11 -1 A11 11 0 0 1 -11 -1 C-11 -8 -6 -14 0 -24Z";
const SEED_AT = "translate(67 33) rotate(225) scale(0.62)";

/** `useId()` returns ":r1:"; colons are legal in ids but awkward inside `url(#...)`. */
function safeId(raw: string): string {
  return "an" + raw.replace(/[^a-zA-Z0-9]/g, "");
}

export function Logo({ size = 32, variant = "rich", label, className, color }: LogoProps) {
  const u = safeId(useId());
  const a11y = label
    ? ({ role: "img", "aria-label": label } as const)
    : ({ "aria-hidden": true } as const);
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 100 100",
    className: ["brand-logo", className].filter(Boolean).join(" "),
    focusable: false,
    style: { flex: "none" as const, ...(variant === "flat" ? { color: color ?? "var(--color-logo-flat)" } : null) },
    ...a11y,
  };

  if (variant === "idle") {
    return (
      <svg
        {...common}
        viewBox="-6 -14 118 118"
        style={{ ...common.style, overflow: "visible" }}
        dangerouslySetInnerHTML={{
          __html: `<defs>${AI_STATE_DEFS.replaceAll("__U__", u)}</defs>${AI_STATE_IDLE.replaceAll("__U__", u)}`,
        }}
      />
    );
  }

  return (
    <svg {...common}>
      <defs>
        <path id={`${u}t`} d={TILE} />
        <path id={`${u}d`} d={DROP} />
        <mask id={`${u}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#FFFFFF" />
          <use href={`#${u}d`} transform={SEED_AT} fill="#000000" />
        </mask>
        {variant === "rich" ? (
          <>
            <radialGradient id={`${u}g`} cx="0.67" cy="0.33" r="0.24">
              <stop offset="0" stopColor="#9BDAF6" stopOpacity="0.95" />
              <stop offset="1" stopColor="#9BDAF6" stopOpacity="0" />
            </radialGradient>
            <filter id={`${u}f`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="7" result="n" />
              <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.16 0" />
              <feComposite in2="SourceGraphic" operator="in" />
            </filter>
          </>
        ) : null}
      </defs>
      {variant === "rich" ? (
        <g mask={`url(#${u}m)`}>
          <use href={`#${u}t`} fill="#2E8B63" />
          <use href={`#${u}t`} fill="#FFFFFF" filter={`url(#${u}f)`} />
          <use href={`#${u}t`} fill={`url(#${u}g)`} />
        </g>
      ) : (
        <g mask={`url(#${u}m)`}>
          <use href={`#${u}t`} fill="currentColor" />
        </g>
      )}
    </svg>
  );
}
