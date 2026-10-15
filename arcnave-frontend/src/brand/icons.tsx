import { useId } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import "./icons.css";

/**
 * Icons N2 (docs/brand/R16-Icons.dc.html, locked 12 Oct): Lucide, 1.75 stroke, round ends.
 * Boxes, bubbles and folders take the logo's leaf-tile corners; the active icon gets the sky seed
 * cut into its corner, like the logo. No inner nature details.
 *
 *   <Icon icon={MessageSquare} active />            // sidebar, 18 px, seed on the current place
 *   <Icon icon={Search} size={32} />                // main-nav size
 *   <Icon icon={Trash2} label="Delete" />           // meaningful icon: role="img" + aria-label
 *
 * Without `label` the icon is decorative and gets aria-hidden. Leaf corners exist for the icons the
 * board redraws (below); every other Lucide icon renders unchanged, as on the board ("Everything
 * else stays calm"). Colour is `currentColor`; the board paints the active icon in the brand green
 * (`.brand-icon--active`).
 */

/** Leaf-tile redraws from R16-Icons, keyed by the Lucide component's displayName. */
const LEAF_GLYPHS: Record<string, ReactNode> = {
  MessageSquare: <path d="M3 21 V10 A7 7 0 0 1 10 3 H19.5 Q21 3 21 4.5 V10 A7 7 0 0 1 14 17 H7.5 Z" />,
  Folder: <path d="M2 10 A6 6 0 0 1 8 4 H9.6 L11.6 7 H20.5 Q22 7 22 8.5 V14 A6 6 0 0 1 16 20 H3.5 Q2 20 2 18.5 Z" />,
  Copy: (
    <>
      <path d="M8 13 A5 5 0 0 1 13 8 H20.5 Q22 8 22 9.5 V17 A5 5 0 0 1 17 22 H9.5 Q8 22 8 20.5 Z" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  Lock: (
    <>
      <path d="M3 15.5 A4.5 4.5 0 0 1 7.5 11 H19.5 Q21 11 21 12.5 V17.5 A4.5 4.5 0 0 1 16.5 22 H4.5 Q3 22 3 20.5 Z" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  Calendar: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 10 A6 6 0 0 1 9 4 H19.5 Q21 4 21 5.5 V16 A6 6 0 0 1 15 22 H4.5 Q3 22 3 20.5 Z" />
      <path d="M3 10h18" />
    </>
  ),
  Image: (
    <>
      <path d="M3 9 A6 6 0 0 1 9 3 H19.5 Q21 3 21 4.5 V15 A6 6 0 0 1 15 21 H4.5 Q3 21 3 19.5 Z" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
};

/** Names that have a leaf-corner redraw. */
export const LEAF_CORNER_ICONS = Object.keys(LEAF_GLYPHS);

const DROP = "M0 -24 C6 -14 11 -8 11 -1 A11 11 0 0 1 -11 -1 C-11 -8 -6 -14 0 -24Z";

export interface IconProps {
  icon: LucideIcon;
  /** The current place: the sky seed is cut into the top-right corner. */
  active?: boolean;
  /** Edge in CSS px: 18 sidebar/nav (default), 15 message actions, 32 main-nav. */
  size?: number;
  /** Accessible name. Omit for a decorative icon (aria-hidden). */
  label?: string;
  /** Defaults to 1.75 (1.6 from 28 px up, as the board's 32 px main-nav row draws it). */
  strokeWidth?: number;
  className?: string;
}

export function Icon({ icon: Glyph, active = false, size = 18, label, strokeWidth, className }: IconProps) {
  const id = "an" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const sw = strokeWidth ?? (size >= 28 ? 1.6 : 1.75);
  const leaf = Glyph.displayName ? LEAF_GLYPHS[Glyph.displayName] : undefined;
  const glyph = leaf ? (
    <g fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {leaf}
    </g>
  ) : (
    <Glyph size={24} strokeWidth={sw} />
  );
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={["brand-icon", active ? "brand-icon--active" : "", className ?? ""].filter(Boolean).join(" ")}
      focusable="false"
      {...a11y}
    >
      {active ? (
        <defs>
          <mask id={id} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
            <rect x="-2" y="-2" width="28" height="28" fill="#fff" stroke="none" />
            <path d={DROP} transform="translate(20 4.6) rotate(225) scale(0.36)" fill="#000" stroke="#000" strokeWidth="7" />
          </mask>
        </defs>
      ) : null}
      <g mask={active ? `url(#${id})` : undefined}>{glyph}</g>
      {active ? (
        <path d={DROP} transform="translate(20 4.6) rotate(225) scale(0.3)" fill="var(--color-sky, #7CC8EE)" stroke="none" />
      ) : null}
    </svg>
  );
}
