/**
 * Link-confirm: the page behind the "Sign in to arcnave" button in the sign-in e-mail
 * (boards `S3-Link`, `S3-Link-Dark`, `S3-Link-States`).
 *
 * UI only; backend flow not built yet (N-72, Phase 5). There is no sign-in-link endpoint, so no
 * route renders this and no button leads to it.
 *
 * Board rules kept: opening the link only shows this page and nothing is used up; the tap
 * confirms (POST) so a mail scanner that opens the link cannot spend it; the page never shows whose
 * link it is; used, expired and fake links all show the same "This link no longer works"; the
 * result is announced (aria-live) and focus starts on the button.
 */
import { ArrowLeft, Check, Clock, Loader2 } from "lucide-react";
import { AuthFrame, AuthHeading, Tick } from "./AuthFrame";

/** Board states 1 to 4: Ready, Signing in, Signed in, Link no longer works. */
export type LinkConfirmState = "ready" | "signing-in" | "signed-in" | "invalid";

export interface LinkConfirmProps {
  state: LinkConfirmState;
  onConfirm: () => void;
  onBackToSignIn: () => void;
}

export function LinkConfirmCard({
  state,
  onConfirm,
  onBackToSignIn,
}: LinkConfirmProps) {
  return (
    <div className="sx-card sx-result" aria-live="polite" data-state={state}>
      {(state === "ready" || state === "signing-in") && (
        <>
          <button
            type="button"
            className="sx-primary sx-primary--big"
            disabled={state === "signing-in"}
            aria-busy={state === "signing-in"}
            autoFocus
            onClick={onConfirm}
          >
            {state === "signing-in" && (
              <Loader2 size={16} className="spin" aria-hidden="true" />
            )}
            {state === "signing-in" ? "Signing in…" : "Sign in to arcnave"}
          </button>
          <p className="sx-card-foot">
            Signs you in on this device only. The link works once, for 10
            minutes.
          </p>
        </>
      )}
      {state === "signed-in" && (
        <>
          <Tick icon={Check} />
          <h2 className="sx-result-title">You’re signed in</h2>
          <p className="sx-result-text">
            Opening arcnave… Owners and admins get the 2-step code next.
          </p>
        </>
      )}
      {state === "invalid" && (
        <>
          <Tick icon={Clock} tone="warn" size={24} />
          <h2 className="sx-result-title">This link no longer works</h2>
          <p className="sx-result-text">
            Each link works once, for 10 minutes. Ask for a new one from the
            sign-in page.
          </p>
          <button
            type="button"
            className="sx-secondary sx-primary--big"
            onClick={onBackToSignIn}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            Back to sign-in
          </button>
        </>
      )}
    </div>
  );
}

export function LinkConfirm(props: LinkConfirmProps) {
  return (
    <AuthFrame>
      <AuthHeading id="link-title" title="One tap to sign in" size="page">
        You opened the sign-in link from your e-mail.
        <br />
        Tap the button to finish.
      </AuthHeading>
      <LinkConfirmCard {...props} />
      <p className="sx-note">
        Didn’t ask for this? Just close this page.
        <br />
        Nothing happens unless you tap the button.
      </p>
    </AuthFrame>
  );
}
