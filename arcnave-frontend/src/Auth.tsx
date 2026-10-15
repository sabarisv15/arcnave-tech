/**
 * Sign in and sign up: the SI4 page (board `S3-SignIn-4`, light and dark).
 *
 * Two-panel page: the card on the left, the "scattered -> one point" loop on the right, the
 * Google button G1 above an OR rule when Google sign-in is configured. Everything the
 * form did before is unchanged: one form with two modes (so a mistyped e-mail is not lost by
 * switching), the same fields and validation, errors shown as the server described them and
 * chosen by `code`, never by wording.
 *
 * The board's own sign-in is an e-mail code ("No password. We send a 6-digit code"). That flow
 * has no backend yet (N-72, Phase 5), so this page keeps the password form and does not show
 * the board's code line or its "invite only" note: neither would be true today.
 *
 * Two quiet variants share the card, both from S7:
 *  - `expired`: the session ended under the person (a 401). A short "Please sign in again" block
 *    and the account that was signed in. It says nothing about why, because the server does not.
 *  - `signedOut`: they pressed Sign out. The "You're signed out" page. Never the expired wording.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";
import { ApiError } from "./api";
import { useSession } from "./session";
import { GoogleSignInButton, googleClientId } from "./GoogleSignInButton";
import { AuthFrame, AuthHeading, SUPPORT_EMAIL } from "./auth/AuthFrame";
import {
  AccountRow,
  SessionEndedNotice,
  signedOutSub,
} from "./auth/SessionEnded";

type Mode = "in" | "up";
interface Problem {
  title: string;
  detail: string;
  code?: string;
}

function problemFrom(failure: unknown): Problem {
  return failure instanceof ApiError
    ? { title: failure.title, detail: failure.detail, code: failure.code }
    : {
        title: "Could not reach ArcNave",
        detail: "Check your connection and try again.",
      };
}

export default function Auth({ initialMode = "in" }: { initialMode?: Mode }) {
  const {
    signIn,
    signUp,
    signInWithGoogle,
    expired,
    signedOut,
    lastAccount,
    forgetAccount,
  } = useSession();
  const navigate = useNavigate();
  const clientId = googleClientId();
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode),
    [email, setEmail] = useState(() => lastAccount?.email ?? ""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Problem | null>(null);
  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setShowPassword(false);
  }, [initialMode]);

  const returning =
    mode === "in" && lastAccount != null && (expired || signedOut);
  const showSignedOut = mode === "in" && signedOut && !expired;
  const showExpired = mode === "in" && expired && !signedOut;

  const attempt = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(problemFrom(failure));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void attempt(() =>
      mode === "in"
        ? signIn(email.trim(), password)
        : signUp(email.trim(), password, name.trim()),
    );
  };

  const useAnotherAccount = () => {
    forgetAccount();
    setEmail("");
    setPassword("");
    setError(null);
  };

  return (
    <AuthFrame>
      {showSignedOut ? (
        <AuthHeading id="auth-title" title="You’re signed out">
          {signedOutSub(lastAccount?.name ?? "")}
        </AuthHeading>
      ) : (
        <AuthHeading id="auth-title" title="One place for your campus">
          Your AI partner for every college job
        </AuthHeading>
      )}

      <div className="sx-card" role="group" aria-labelledby="auth-title">
        {showExpired && <SessionEndedNotice reason="unknown" />}
        {returning && lastAccount ? (
          <AccountRow name={lastAccount.name} email={lastAccount.email} />
        ) : (
          <h2 className="sx-card-title">
            {mode === "in" ? "Sign in" : "Create your account"}
          </h2>
        )}
        {mode === "up" && (
          <p className="sx-card-note">
            Access may be limited during development.
          </p>
        )}

        {error && (
          <div className="sx-error" role="alert">
            <TriangleAlert size={19} aria-hidden="true" />
            <div>
              <strong>{error.title}</strong>
              <p>{error.detail}</p>
              {error.code === "registration_closed" && (
                <p>
                  <a href={`mailto:${SUPPORT_EMAIL}`}>
                    Contact {SUPPORT_EMAIL} about early access.
                  </a>
                </p>
              )}
            </div>
          </div>
        )}

        {clientId && (
          <>
            <GoogleSignInButton
              clientId={clientId}
              disabled={busy}
              onCredential={(credential) =>
                void attempt(() => signInWithGoogle(credential))
              }
            />
            <div className="sx-or" aria-hidden="true">
              OR
            </div>
          </>
        )}

        <form onSubmit={submit} aria-busy={busy} className="sx-form">
          <fieldset disabled={busy} className="sx-fields">
            {mode === "up" && (
              <label className="sx-label">
                <span>
                  Your name <span className="sx-optional">Optional</span>
                </span>
                <input
                  value={name}
                  maxLength={120}
                  autoComplete="name"
                  placeholder="What should ArcNave call you?"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label className="sx-label">
              <span>Email</span>
              <input
                type="email"
                required
                autoFocus={!returning}
                value={email}
                maxLength={320}
                autoComplete="email"
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="sx-label">
              <span>Password</span>
              <span className="sx-password">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoFocus={returning}
                  value={password}
                  minLength={mode === "up" ? 12 : 1}
                  autoComplete={
                    mode === "in" ? "current-password" : "new-password"
                  }
                  placeholder={
                    mode === "in"
                      ? "Enter your password"
                      : "Choose a strong password"
                  }
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
              {mode === "up" && (
                <span className="sx-help">At least 12 characters.</span>
              )}
            </label>
            <button
              className="sx-primary"
              disabled={busy || !email.trim() || !password}
            >
              {busy && (
                <Loader2 size={16} className="spin" aria-hidden="true" />
              )}
              {mode === "in" ? "Sign in" : "Create account"}
            </button>
          </fieldset>
        </form>

        <p className="sx-switch">
          {mode === "in" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              navigate(mode === "in" ? "/signup" : "/login");
              setError(null);
              setShowPassword(false);
            }}
          >
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>

      {returning && (
        <div className="sx-aside">
          <button type="button" className="sx-link" onClick={useAnotherAccount}>
            Use another account
          </button>
          {showSignedOut && (
            <p>On a shared computer? Close this browser window too.</p>
          )}
        </div>
      )}
    </AuthFrame>
  );
}
