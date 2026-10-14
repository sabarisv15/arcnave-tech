// Brand foundation (Task tech-p1 item G0). Tokens and fonts are imported by main.tsx; the
// components below are what screens use.
export { Logo } from "./logo/Logo";
export type { LogoProps, LogoVariant } from "./logo/Logo";
export { LivingDots } from "./logo/LivingDots";
export type { LivingDotsProps } from "./logo/LivingDots";
export {
  AiStateMark,
  AI_STATES,
  AI_STATE_LABELS,
  AI_STATE_MIN_DWELL_MS,
  AI_STATE_CROSSFADE_MS,
} from "./logo/AiStateMark";
export type { AiState, AiStateMarkProps } from "./logo/AiStateMark";
export { ScatterToPoint } from "./logo/ScatterToPoint";
export type { ScatterToPointProps } from "./logo/ScatterToPoint";
export { Icon, LEAF_CORNER_ICONS } from "./icons";
export type { IconProps } from "./icons";
export { Wordmark } from "./Wordmark";
export type { WordmarkProps, WordmarkLang } from "./Wordmark";
export { prefersStillMotion, useDocumentTheme } from "./motion";
export type { BrandTheme } from "./motion";
