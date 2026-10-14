/**
 * Code entry: the e-mail sign-in code (boards `S3-Code`, `S3-Code-Dark`, `S3-Code-States`).
 *
 * UI only; backend flow not built yet (N-72, Phase 5). There is no e-mail-code endpoint, so no
 * route renders this and no button leads to it. It is a controlled component with typed props so
 * Phase 5 only has to feed it a status.
 *
 * The board's nine states are `status` + `value`:
 *   1 Ready          status "idle", value ""
 *   2 Typing         status "idle", 1 to 5 digits
 *   3 Checking       "checking"      (starts by itself at digit 6; boxes dim, button spins)
 *   4 Wrong code     "wrong"         (red boxes and the tries left; `triesLeft`)
 *   5 Code stopped   "stopped"       (5 wrong tries or 10 minutes; "Send a new code")
 *   6 New code sent  "resent"        (green line, boxes empty)
 *   7 Too many codes "too-many-codes" (over 5 codes in an hour; `waitMinutes`)
 *   8 Sign-in paused "paused"        (10 wrong tries in an hour; `pausedMinutes`)
 *   9 Accepted       "accepted"
 * Board rules kept: one real input under six aria-hidden boxes (inputmode numeric, autocomplete
 * one-time-code, label "6-digit code"); the message line is role="alert"; colour is never alone
 * (icon plus words); the code is grouped 3 + 3.
 */
import { useId } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clock,
  Loader2,
  Lock,
} from "lucide-react";
import { AuthFrame, AuthHeading } from "./AuthFrame";
import { CODE_LENGTH, CodeBoxes } from "./CodeBoxes";
import type { CodeBoxTone } from "./CodeBoxes";

export { CODE_LENGTH };

export type CodeEntryStatus =
  | "idle"
  | "checking"
  | "wrong"
  | "stopped"
  | "resent"
  | "too-many-codes"
  | "paused"
  | "accepted";

/** Board state names, in board order, for tests and for any future state gallery. */
export const CODE_ENTRY_STATES = [
  "ready",
  "typing",
  "checking",
  "wrong",
  "stopped",
  "resent",
  "too-many-codes",
  "paused",
  "accepted",
] as const;
export type CodeEntryStateName = (typeof CODE_ENTRY_STATES)[number];

/** Which of the nine board states a status and value make. */
export function codeEntryState(
  status: CodeEntryStatus,
  value: string,
): CodeEntryStateName {
  if (status !== "idle") return status;
  return value.length === 0 ? "ready" : "typing";
}

export interface CodeEntryCardProps {
  status: CodeEntryStatus;
  /** Digits typed so far (0 to 6). */
  value: string;
  onChange: (digits: string) => void;
  /** Continue was pressed (the page also checks by itself at digit 6). */
  onSubmit: () => void;
  onResend: () => void;
  /** Wrong code: "4 tries left". */
  triesLeft?: number;
  /** Seconds until a new code can be asked for (board: 60 s between codes). 0 or undefined: now. */
  resendInSeconds?: number;
  /** Too many codes: minutes to wait. */
  waitMinutes?: number;
  /** Paused: minutes of pause. */
  pausedMinutes?: number;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function minutes(n: number): string {
  return `${n} min`;
}

export function CodeEntryCard({
  status,
  value,
  onChange,
  onSubmit,
  onResend,
  triesLeft,
  resendInSeconds = 0,
  waitMinutes,
  pausedMinutes,
}: CodeEntryCardProps) {
  const messageId = useId();
  const name = codeEntryState(status, value);
  const locked = status === "stopped" || status === "paused";
  const dimmed = status === "checking";
  const full = value.length === CODE_LENGTH;
  const tone: CodeBoxTone = locked
    ? "dis"
    : status === "wrong"
      ? "err"
      : status === "accepted"
        ? "ok"
        : dimmed
          ? "dim"
          : status === "too-many-codes"
            ? "plain"
            : "idle";

  let message: {
    tone: "info" | "err" | "ok";
    icon?: typeof Check;
    text: string;
  } = { tone: "info", text: "" };
  if (status === "wrong") {
    const left = triesLeft ?? 0;
    message = {
      tone: "err",
      icon: CircleAlert,
      text: `That code didn’t match. ${left} ${left === 1 ? "try" : "tries"} left.`,
    };
  } else if (status === "stopped")
    message = {
      tone: "err",
      icon: CircleAlert,
      text: "This code has stopped working.",
    };
  else if (status === "resent")
    message = {
      tone: "ok",
      icon: Check,
      text: "New code sent. Check your inbox.",
    };
  else if (status === "too-many-codes")
    message = {
      tone: "err",
      icon: Clock,
      text: `Too many codes asked. Try again in ${minutes(waitMinutes ?? 0)}.`,
    };
  else if (status === "paused")
    message = {
      tone: "err",
      icon: Lock,
      text: `Sign-in paused for ${minutes(pausedMinutes ?? 0)} to keep you safe.`,
    };
  else if (status === "accepted")
    message = {
      tone: "ok",
      icon: Check,
      text: "Code accepted. Opening arcnave…",
    };

  // Primary button: label and whether it can be pressed.
  let label = "Continue";
  let busy = false;
  let disabled = !full;
  if (status === "checking") {
    label = "Checking…";
    busy = true;
    disabled = true;
  } else if (status === "accepted") {
    label = "Signing in…";
    busy = true;
    disabled = true;
  } else if (status === "stopped") {
    label = "Send a new code";
    disabled = resendInSeconds > 0;
  } else if (status === "wrong") {
    disabled = !full;
  } else if (status === "too-many-codes" || status === "paused") {
    disabled = true;
  }
  const primary = () => (status === "stopped" ? onResend() : onSubmit());

  // The line under the message: a countdown, a link, or "later".
  let resend: React.ReactNode = null;
  if (status === "too-many-codes" || status === "paused") {
    resend = <span className="sx-link sx-link--off">Resend code later</span>;
  } else if (status !== "stopped") {
    const waiting = status === "checking" || status === "accepted";
    if (resendInSeconds > 0)
      resend = (
        <span className="sx-link sx-link--off">
          Resend code in {clock(resendInSeconds)}
        </span>
      );
    else if (!waiting)
      resend = (
        <button type="button" className="sx-link" onClick={onResend}>
          Resend code
        </button>
      );
  }

  return (
    <div className="sx-card sx-code" data-state={name}>
      <label className="sx-code-label" htmlFor={`${messageId}-in`}>
        6-digit code
      </label>
      <CodeBoxes
        id={`${messageId}-in`}
        value={value}
        onChange={onChange}
        tone={tone}
        disabled={
          locked ||
          status === "checking" ||
          status === "accepted" ||
          status === "too-many-codes"
        }
        describedBy={messageId}
      />
      <div
        id={messageId}
        className={`sx-msg sx-msg--${message.tone}`}
        role="alert"
      >
        {message.icon ? <message.icon size={16} aria-hidden="true" /> : null}
        {message.text}
      </div>
      <button
        type="button"
        className="sx-primary"
        disabled={disabled}
        onClick={primary}
        aria-busy={busy}
      >
        {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
        {label}
      </button>
      <p className="sx-card-foot">
        Or tap <b>Sign in</b> in the same e-mail.
      </p>
      <div className="sx-resend">{resend}</div>
    </div>
  );
}

export interface CodeEntryProps extends CodeEntryCardProps {
  /** The address the code was sent to, shown in the sub line. */
  email: string;
  onUseDifferentEmail: () => void;
}

/** The whole page: title, sub line, the card and the two notes. */
export function CodeEntry({
  email,
  onUseDifferentEmail,
  ...card
}: CodeEntryProps) {
  return (
    <AuthFrame>
      <AuthHeading id="code-title" title="Check your e-mail" size="page">
        If <b>{email}</b> has an arcnave invite, we sent a 6-digit code.
        <br />
        We check it as soon as all 6 digits are in.
      </AuthHeading>
      <button
        type="button"
        className="sx-link sx-link--icon"
        onClick={onUseDifferentEmail}
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Use a different e-mail
      </button>
      <CodeEntryCard {...card} />
      <p className="sx-note">
        The code works for 10 minutes. It comes from no-reply@arcnave.in, so
        check Spam too.
      </p>
    </AuthFrame>
  );
}
