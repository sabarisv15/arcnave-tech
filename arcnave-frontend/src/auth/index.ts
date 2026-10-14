// Sign-in flow screens (Task tech-p1 item G2). `Auth.tsx` (the SI4 page) is the only one routed
// today. Everything else below is UI only; backend flow not built yet (N-72, Phase 5), and
// `Splash` is for the future app shell: the web app shows none.
export { AuthFrame, AuthHeading, Tick, SUPPORT_EMAIL } from "./AuthFrame";
export {
  AccountRow,
  SessionEndedNotice,
  sessionEndedCopy,
  signedOutSub,
  REACHABLE_SESSION_ENDED_REASONS,
} from "./SessionEnded";
export type { SessionEndedReason } from "./SessionEnded";
export {
  CodeEntry,
  CodeEntryCard,
  CODE_ENTRY_STATES,
  codeEntryState,
} from "./CodeEntry";
export type {
  CodeEntryProps,
  CodeEntryCardProps,
  CodeEntryStatus,
  CodeEntryStateName,
} from "./CodeEntry";
export { LinkConfirm, LinkConfirmCard } from "./LinkConfirm";
export type { LinkConfirmProps, LinkConfirmState } from "./LinkConfirm";
export { TwoStepSetup, TwoStepSetupCard, TwoStepSignInCard } from "./TwoStep";
export type {
  TwoStepSetupProps,
  TwoStepSetupStep,
  TwoStepSignInProps,
  TwoStepSignInView,
} from "./TwoStep";
export { Invite, InviteCard } from "./Invite";
export type { InviteProps, InviteState } from "./Invite";
export { Welcome } from "./Welcome";
export type { WelcomeProps } from "./Welcome";
export { WelcomeGate } from "./WelcomeGate";
export { Splash, SPLASH_MS } from "./Splash";
export type { SplashProps, SplashVariant } from "./Splash";
export { maskEmail, initials, firstName } from "./account";
