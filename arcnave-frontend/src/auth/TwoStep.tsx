/**
 * 2-step sign-in: set-up once and the code at every sign-in (boards `S3-2Step`, `S3-2Step-Dark`,
 * `S3-2Step-States`).
 *
 * UI only; backend flow not built yet (N-72, Phase 5). There is no TOTP, recovery-code or lock
 * endpoint, so no route renders these and no button leads to them. The QR image is a slot: this
 * codebase has no QR encoder and a fake one would be a lie, so the caller passes the real picture.
 *
 * Board rules kept: no SMS (app codes only, 30 s, 6 digits); recovery codes are shown once and
 * Finish stays off until the "I saved these codes" box is ticked; the QR always has the same key as
 * text; steps are announced; every button is at least 40 px.
 */
import { useId } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  Download,
  KeyRound,
  Mail,
  Printer,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { AuthFrame, AuthHeading, Tick } from "./AuthFrame";
import { CODE_LENGTH, CodeBoxes } from "./CodeBoxes";

/* ------------------------------------------------------------------------ set-up (once) */

/** Board set-up steps: 1 Scan, 2 Confirm, 3 Save codes, then 4 "On". */
export type TwoStepSetupStep = "scan" | "confirm" | "save-codes" | "on";

const SETUP_STEPS: { id: Exclude<TwoStepSetupStep, "on">; label: string }[] = [
  { id: "scan", label: "Scan" },
  { id: "confirm", label: "Confirm" },
  { id: "save-codes", label: "Save codes" },
];

export interface TwoStepSetupProps {
  step: TwoStepSetupStep;
  /** The account shown inside the authenticator app: "arcnave (priya@psgtech.ac.in)". */
  accountLabel: string;
  /** The QR picture for the otpauth link. A slot, see the file comment. */
  qr: ReactNode;
  /** The same secret as text, grouped for reading ("K7QM 2XRT V5PL AW4N"). */
  secretKey: string;
  onCopyKey: () => void;
  onNext: () => void;
  onBack: () => void;
  /** Confirm step. */
  code: string;
  onCodeChange: (digits: string) => void;
  /** The typed code did not match. */
  codeWrong?: boolean;
  onConfirm: () => void;
  /** Save-codes step: the ten codes, shown once. */
  recoveryCodes: string[];
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  onDownload: () => void;
  onCopyCodes: () => void;
  onPrint: () => void;
  onFinish: () => void;
  /** "On" step: Go to arcnave. */
  onDone: () => void;
}

function Progress({ step }: { step: TwoStepSetupStep }) {
  const index =
    step === "on"
      ? SETUP_STEPS.length
      : SETUP_STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="sx-steps" aria-label="Set-up steps">
      {SETUP_STEPS.map((s, i) => (
        <li
          key={s.id}
          className="sx-step"
          aria-current={i === index ? "step" : undefined}
        >
          <span
            className={`sx-dot ${i < index ? "sx-dot--done" : i === index ? "sx-dot--on" : ""}`}
            aria-hidden="true"
          >
            {i < index ? <Check size={13} strokeWidth={2.4} /> : i + 1}
          </span>
          <span className={i === index ? "sx-step-on" : ""}>{s.label}</span>
          {i < SETUP_STEPS.length - 1 && (
            <span className="sx-bar" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

export function TwoStepSetupCard(props: TwoStepSetupProps) {
  const { step } = props;
  const msgId = useId();
  if (step === "on")
    return (
      <div className="sx-card sx-result" aria-live="polite" data-step={step}>
        <Tick icon={ShieldCheck} />
        <h2 className="sx-result-title">2-step sign-in is on</h2>
        <p className="sx-result-text">
          From now on, after your e-mail code or Google, arcnave asks for the
          app code. Admin tools are unlocked.
        </p>
        <button type="button" className="sx-primary" onClick={props.onDone}>
          Go to arcnave
        </button>
      </div>
    );
  return (
    <div className="sx-card sx-setup" aria-live="polite" data-step={step}>
      <Progress step={step} />
      {step === "scan" && (
        <>
          <div className="sx-scan">
            <div className="sx-qr">{props.qr}</div>
            <div className="sx-scan-text">
              <h2 className="sx-card-heading">
                Scan with your authenticator app
              </h2>
              <p className="sx-apps">
                Use Google Authenticator, Microsoft Authenticator or any app
                that makes 6-digit codes. Open it, tap <b>+</b>, scan this code.
              </p>
              <p className="sx-hint">
                It will show as <b>{props.accountLabel}</b>
              </p>
            </div>
          </div>
          <div className="sx-keyblock">
            <span className="sx-key-label">
              Can’t scan? Type this key instead
            </span>
            <div className="sx-key">
              <span>{props.secretKey}</span>
              <button
                type="button"
                className="sx-iconbtn"
                aria-label="Copy key"
                onClick={props.onCopyKey}
              >
                <Copy size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
          <button type="button" className="sx-primary" onClick={props.onNext}>
            Next
          </button>
        </>
      )}
      {step === "confirm" && (
        <>
          <div>
            <h2 className="sx-card-heading">Type the code from the app</h2>
            <p className="sx-apps">
              The app shows a new 6-digit code every 30 seconds. Type the one
              you see now.
            </p>
          </div>
          <CodeBoxes
            id={`${msgId}-code`}
            value={props.code}
            onChange={props.onCodeChange}
            tone={props.codeWrong ? "err" : "idle"}
            describedBy={msgId}
            label="6-digit code from your authenticator app"
          />
          <div
            id={msgId}
            className={`sx-msg ${props.codeWrong ? "sx-msg--err" : "sx-msg--info"}`}
            role="alert"
          >
            {props.codeWrong && (
              <>
                <CircleAlert size={16} aria-hidden="true" />
                That code didn’t match. Is your phone’s time set to automatic?
              </>
            )}
          </div>
          <div className="sx-row">
            <button
              type="button"
              className="sx-secondary sx-secondary--back"
              onClick={props.onBack}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              className="sx-primary"
              disabled={props.code.length !== CODE_LENGTH}
              onClick={props.onConfirm}
            >
              Confirm
            </button>
          </div>
        </>
      )}
      {step === "save-codes" && (
        <>
          <div>
            <h2 className="sx-card-heading">Save your 10 recovery codes</h2>
            <p className="sx-apps">
              Lost your phone? Each code signs you in once instead of the app
              code. We show them only now.
            </p>
          </div>
          <ol className="sx-rc" aria-label="Recovery codes">
            {props.recoveryCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ol>
          <div className="sx-row sx-row--tools">
            <button
              type="button"
              className="sx-secondary sx-secondary--sm"
              onClick={props.onDownload}
            >
              <Download size={15} aria-hidden="true" />
              Download
            </button>
            <button
              type="button"
              className="sx-secondary sx-secondary--sm"
              onClick={props.onCopyCodes}
            >
              <Copy size={15} aria-hidden="true" />
              Copy
            </button>
            <button
              type="button"
              className="sx-secondary sx-secondary--sm"
              onClick={props.onPrint}
            >
              <Printer size={15} aria-hidden="true" />
              Print
            </button>
          </div>
          <label className="sx-check">
            <input
              type="checkbox"
              checked={props.saved}
              onChange={(e) => props.onSavedChange(e.target.checked)}
            />
            <span>I saved these codes somewhere safe, away from my phone.</span>
          </label>
          <button
            type="button"
            className="sx-primary"
            disabled={!props.saved}
            onClick={props.onFinish}
          >
            Finish
          </button>
        </>
      )}
    </div>
  );
}

export function TwoStepSetup(props: TwoStepSetupProps) {
  return (
    <AuthFrame>
      <AuthHeading id="twostep-title" title="Protect your account" size="page">
        Owners and admins need a 2-step code from a phone app.
        <br />
        Takes about 2 minutes.
      </AuthHeading>
      <TwoStepSetupCard {...props} />
    </AuthFrame>
  );
}

/* ------------------------------------------------------------------ sign-in (every time) */

/** Board A (app code), B (recovery code), C (locked for the day). */
export type TwoStepSignInView = "app-code" | "recovery-code" | "locked";

export interface TwoStepSignInProps {
  view: TwoStepSignInView;
  code: string;
  onCodeChange: (digits: string) => void;
  onSubmit: () => void;
  /** The last code did not match. */
  wrong?: boolean;
  /** Recovery view: one typed code, dash optional. */
  recoveryCode: string;
  onRecoveryCodeChange: (value: string) => void;
  onUseRecovery: () => void;
  onUseAppCode: () => void;
  /** Locked view: when it opens again, already formatted ("10:42 am tomorrow"). */
  opensAt?: string;
  onContactSupport: () => void;
}

export function TwoStepSignInCard(props: TwoStepSignInProps) {
  const msgId = useId();
  if (props.view === "locked")
    return (
      <div
        className="sx-card sx-result"
        aria-live="polite"
        data-view={props.view}
      >
        <Tick icon={Lock} tone="warn" size={24} />
        <h2 className="sx-result-title">2-step sign-in is locked</h2>
        <p className="sx-result-text">
          Too many wrong codes today. It opens again at{" "}
          <b>{props.opensAt ?? "a later time"}</b>.
          <br />
          Need it sooner? Contact arcnave support.
        </p>
        <button
          type="button"
          className="sx-secondary"
          onClick={props.onContactSupport}
        >
          <Mail size={16} aria-hidden="true" />
          Contact support
        </button>
      </div>
    );
  if (props.view === "recovery-code")
    return (
      <div className="sx-card" data-view={props.view}>
        <div>
          <h2 className="sx-card-heading">Use a recovery code</h2>
          <p className="sx-apps">
            Type one of the 10 codes you saved. Each code works once.
          </p>
        </div>
        <label className="sx-label">
          <span className="sx-sr">Recovery code</span>
          <input
            className="sx-mono"
            value={props.recoveryCode}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="4KQ7-M2XD"
            onChange={(e) => props.onRecoveryCodeChange(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="sx-primary"
          disabled={!props.recoveryCode.trim()}
          onClick={props.onSubmit}
        >
          Sign in
        </button>
        <button
          type="button"
          className="sx-link sx-link--icon sx-link--center"
          onClick={props.onUseAppCode}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Use the app code
        </button>
      </div>
    );
  return (
    <div className="sx-card" data-view={props.view}>
      <div>
        <h2 className="sx-card-heading">Enter the code from your app</h2>
        <p className="sx-apps">
          Open your authenticator app and type the 6-digit arcnave code.
        </p>
      </div>
      <CodeBoxes
        id={`${msgId}-code`}
        value={props.code}
        onChange={props.onCodeChange}
        tone={props.wrong ? "err" : "idle"}
        describedBy={msgId}
        label="6-digit code from your authenticator app"
      />
      <div
        id={msgId}
        className={`sx-msg ${props.wrong ? "sx-msg--err" : "sx-msg--info"}`}
        role="alert"
      >
        {props.wrong && (
          <>
            <CircleAlert size={16} aria-hidden="true" />
            That code didn’t match.
          </>
        )}
      </div>
      <button
        type="button"
        className="sx-primary"
        disabled={props.code.length !== CODE_LENGTH}
        onClick={props.onSubmit}
      >
        Continue
      </button>
      <button
        type="button"
        className="sx-link sx-link--icon sx-link--center"
        onClick={props.onUseRecovery}
      >
        <KeyRound size={14} aria-hidden="true" />
        Lost your phone? Use a recovery code
      </button>
    </div>
  );
}

/*
 * The board shows the sign-in states (A, B, C) as cards only and gives the page around them no
 * title of its own, so there is no `TwoStepSignIn` page here: Phase 5 puts the card in an
 * `AuthFrame` under whatever heading that flow needs, rather than this file inventing one.
 */
