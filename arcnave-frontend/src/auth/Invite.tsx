/**
 * Invite page: where "Accept invite" in the invitation e-mail lands (boards `S4-Invite`,
 * `S4-Invite-Dark`, `S4-Invite-States`).
 *
 * UI only; backend flow not built yet (N-72, Phase 5). There are no invitation endpoints and no
 * organisations or roles in the data model, so no route renders this and no button leads to it.
 * The two invitation e-mails on the states board are server-side mail templates, not pages.
 *
 * Board states: 1 Ready, 2 Code first (a college address Google cannot vouch for), 3 Different
 * e-mail (the Google account does not match the invite), 4 Expired (after 7 days), 5 Already
 * joined. The e-mail is masked on the page so a forwarded link shows little; opening the link
 * only shows the page, joining happens at sign-in.
 */
import type { ReactNode } from "react";
import { Check, Clock, Mail, User as UserIcon } from "lucide-react";
import { AuthFrame, AuthHeading, Tick } from "./AuthFrame";

export type InviteState =
  "ready" | "code-first" | "different-email" | "expired" | "already-joined";

export interface InviteProps {
  state: InviteState;
  college: string;
  invitedBy: string;
  /** "Staff", "Admin", "Owner": the label on the chip. */
  role: string;
  /** Already masked, e.g. "p••••@psgtech.ac.in" (see maskEmail). */
  maskedEmail: string;
  /** Last day the invite works, already formatted, e.g. "19 Oct 2026". */
  lastDay: string;
  /** Slot for the Google button (the caller passes `<GoogleSignInButton />`), shown in state "ready". */
  google?: ReactNode;
  onSendCode: () => void;
  onGoToSignIn: () => void;
}

/** Two letters on the college badge: "GPT Coimbatore" -> "GC". */
function collegeInitials(college: string): string {
  const words = college.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? "")[0] ?? "";
  const last =
    words.length > 1
      ? (Array.from(words[words.length - 1] ?? "")[0] ?? "")
      : "";
  return (first + last).toUpperCase() || "?";
}

export function InviteCard(props: InviteProps) {
  const {
    state,
    college,
    invitedBy,
    role,
    maskedEmail,
    lastDay,
    google,
    onSendCode,
    onGoToSignIn,
  } = props;
  const sendCode = (
    <button type="button" className="sx-primary" onClick={onSendCode}>
      <Mail size={17} aria-hidden="true" />
      Send a code to {maskedEmail}
    </button>
  );
  return (
    <div className="sx-card sx-result" data-state={state}>
      {state === "ready" && (
        <>
          <div className="sx-org">
            <span className="sx-org-av" aria-hidden="true">
              {collegeInitials(college)}
            </span>
            <div>
              <div className="sx-org-name">{college}</div>
              <div className="sx-org-by">invited by {invitedBy}</div>
            </div>
            <span className="sx-role">{role}</span>
          </div>
          <p className="sx-card-text">
            This invite is for <b>{maskedEmail}</b> and works until {lastDay}.
          </p>
          {google}
          {google ? (
            <div className="sx-or" aria-hidden="true">
              OR
            </div>
          ) : null}
          {sendCode}
        </>
      )}
      {state === "code-first" && (
        <>
          <Tick icon={Mail} tone="info" size={24} />
          <h2 className="sx-result-title">Use the code this first time</h2>
          <p className="sx-result-text">
            Your college e-mail is not a Gmail or Google Workspace address, so
            Google can’t confirm it. Join with the code now; you can add Google
            sign-in later in Settings.
          </p>
          {sendCode}
        </>
      )}
      {state === "different-email" && (
        <>
          <Tick icon={UserIcon} tone="warn" size={24} />
          <h2 className="sx-result-title">Different e-mail</h2>
          <p className="sx-result-text">
            This invite is for <b>{maskedEmail}</b>, but you chose another
            Google account. Pick the invited one, or use the code.
          </p>
          {sendCode}
        </>
      )}
      {state === "expired" && (
        <>
          <Tick icon={Clock} tone="warn" size={24} />
          <h2 className="sx-result-title">This invite has expired</h2>
          <p className="sx-result-text">
            Invites work for 7 days. Ask {invitedBy} or your college admin to
            send a new one.
          </p>
        </>
      )}
      {state === "already-joined" && (
        <>
          <Tick icon={Check} size={24} />
          <h2 className="sx-result-title">You’ve already joined</h2>
          <p className="sx-result-text">
            This invite was accepted. Just sign in.
          </p>
          <button type="button" className="sx-primary" onClick={onGoToSignIn}>
            Go to sign-in
          </button>
        </>
      )}
    </div>
  );
}

export function Invite(props: InviteProps) {
  return (
    <AuthFrame>
      <AuthHeading id="invite-title" title="You’re invited" size="page">
        Join your college on arcnave.
        <br />
        No password, just this e-mail.
      </AuthHeading>
      <InviteCard {...props} />
      <p className="sx-note">
        Didn’t expect this? Close this page. Nothing happens until you sign in.
      </p>
    </AuthFrame>
  );
}
