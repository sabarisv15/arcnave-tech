/**
 * "Why you were signed out" (board S7-States) and the signed-out page (S7-SignedOut).
 *
 * Reachable today: `unknown` (a 401 the client cannot explain: `expired` in session.tsx) and the
 * deliberate sign-out page. The server answers a dead session with a bare 401 and the code
 * "unauthorized", so it cannot tell idle-for-a-day from the 28-day limit, a remote log-out, an
 * admin's daily limit, removed access or a different account. The other five reasons are written
 * out from the board as typed copy so the day the server says why (N-49, provisional numbers), the
 * client only has to pass the reason. Nothing picks them today, and the copy for them is not shown
 * to anyone: showing "after a day without use" for a session that may have ended for another
 * reason would state something the client does not know.
 *
 * A deliberate sign-out never uses this notice (mistakes.md: "A deliberate sign-out announced
 * itself as an expired session"): the page shows `SignedOutHeading` instead.
 */
import type { ReactNode } from "react";
import {
  CalendarDays,
  Clock,
  Lock,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { errorCopy } from "../api";
import { Tick } from "./AuthFrame";
import { firstName, initials, maskEmail } from "./account";

export type SessionEndedReason =
  | "unknown"
  | "idle"
  | "limit"
  | "elsewhere"
  | "admin-daily"
  | "access-ended"
  | "different-account";

/** Reasons the client can actually tell apart today. */
export const REACHABLE_SESSION_ENDED_REASONS: readonly SessionEndedReason[] = [
  "unknown",
];

export interface SessionEndedCopy {
  title: string;
  why: ReactNode;
  icon: LucideIcon;
  tone: "ok" | "warn";
  /** Only "Access ended" has no way back in; every other reason offers sign-in again. */
  canSignInAgain: boolean;
}

export function sessionEndedCopy(
  reason: SessionEndedReason,
  context: { college?: string; email?: string } = {},
): SessionEndedCopy {
  switch (reason) {
    case "idle":
      return {
        title: "Please sign in again",
        why: "For your safety, arcnave signs you out after a day without use.",
        icon: Clock,
        tone: "ok",
        canSignInAgain: true,
      };
    case "limit":
      return {
        title: "Time to sign in again",
        why: "You’ve been signed in for 28 days. Sign in again to keep going.",
        icon: CalendarDays,
        tone: "ok",
        canSignInAgain: true,
      };
    case "elsewhere":
      return {
        title: "You were logged out",
        why: "Someone used “Log out everywhere” or logged out this device from Settings.",
        icon: Lock,
        tone: "ok",
        canSignInAgain: true,
      };
    case "admin-daily":
      return {
        title: "Admins sign in every day",
        why: "Admin accounts can change your college’s settings, so they sign in again every 24 hours.",
        icon: ShieldCheck,
        tone: "ok",
        canSignInAgain: true,
      };
    case "access-ended":
      return {
        title: `Your access to ${context.college ?? "your college"} has ended`,
        why: "Your college admin removed or paused your account. If this is a mistake, ask your admin.",
        icon: UserIcon,
        tone: "warn",
        canSignInAgain: false,
      };
    case "different-account":
      return {
        title: "That’s a different account",
        why: (
          <>
            This chat belongs to{" "}
            <b>
              {context.email ? maskEmail(context.email) : "another account"}
            </b>
            . Sign in with it to come back here.
          </>
        ),
        icon: UserIcon,
        tone: "ok",
        canSignInAgain: true,
      };
    case "unknown":
      // The existing, deliberately non-specific wording for a 401 (api.ts errorCopy).
      return {
        title: "Please sign in again",
        why: errorCopy["unauthorized"]!.detail,
        icon: Clock,
        tone: "ok",
        canSignInAgain: true,
      };
  }
}

/** Board `.acct`: avatar, name, masked e-mail. */
export function AccountRow({
  name,
  email,
  college,
}: {
  name: string;
  email: string;
  college?: string;
}) {
  return (
    <div className="sx-acct" data-testid="sx-account">
      <span className="sx-acct-av" aria-hidden="true">
        {initials(name, email)}
      </span>
      <div>
        <div className="sx-acct-name">{name.trim() || maskEmail(email)}</div>
        <div className="sx-acct-mail">
          {maskEmail(email)}
          {college ? ` · ${college}` : ""}
        </div>
      </div>
    </div>
  );
}

/** The "session ended" block at the top of the sign-in card: quiet, not an error. */
export function SessionEndedNotice({
  reason = "unknown",
  college,
  email,
}: {
  reason?: SessionEndedReason;
  college?: string;
  email?: string;
}) {
  const copy = sessionEndedCopy(reason, {
    ...(college ? { college } : {}),
    ...(email ? { email } : {}),
  });
  return (
    <div className="sx-ended" role="status" data-reason={reason}>
      <Tick icon={copy.icon} tone={copy.tone} size={22} />
      <div>
        <h2>{copy.title}</h2>
        <p>{copy.why}</p>
      </div>
    </div>
  );
}

/** Heading text of the signed-out page: board S7-SignedOut, "See you soon, Priya." */
export function signedOutSub(name: string): ReactNode {
  const first = firstName(name);
  return (
    <>
      {first ? `See you soon, ${first}.` : "See you soon."}
      <br />
      Your chats are safe in your account.
    </>
  );
}
