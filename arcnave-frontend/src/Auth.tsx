/**
 * Sign in and sign up.
 *
 * One form with two modes rather than two routes: the fields are almost identical, and a
 * person who mistypes their email on the wrong screen should not lose what they typed.
 *
 * Errors are shown exactly as the server described them. `invalid_credentials` deliberately
 * does not say which of the two was wrong — that is the server's choice, and repeating its
 * wording here keeps it that way.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";
import { ApiError } from "./api";
import { useSession } from "./session";
import { BrandMark } from "./ui";

export default function Auth({ initialMode = "in" }: { initialMode?: "in" | "up" }) {
  const { signIn, signUp, expired } = useSession();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"in" | "up">(initialMode),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<{ title: string; detail: string; code?: string } | null>(
      null,
    );
  useEffect(() => { setMode(initialMode); setError(null); setShowPassword(false); }, [initialMode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "in") await signIn(email.trim(), password);
      else await signUp(email.trim(), password, name.trim());
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? { title: failure.title, detail: failure.detail, code: failure.code }
          : {
              title: "Could not reach ArcNave",
              detail: "Check your connection and try again.",
            },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`auth-screen auth-landing ${mode === "up" ? "auth-signup" : ""}`}>
      <header className="auth-brand"><Link to="/" className="auth-brand-link" aria-label="Back to ArcNave website"><BrandMark /><span>ArcNave<span className="auth-brand-dot">.</span></span></Link></header>
      <main className="auth-layout">
      <section className="auth-welcome" aria-labelledby="auth-title">
        <div className="auth-headline" key={mode}>
          <p className="auth-kicker">ACADEMIC CAMPUS AI</p>
          <h1 id="auth-title">{mode === "in" ? <>Your campus work,<br /> connected.</> : <>Bring your work<br /> together.</>}</h1>
          <p>{mode === "in" ? "Continue with your projects, documents, and drafts." : "Create a workspace for academic questions and evidence-led work."}</p>
        </div>
      <div className="auth-card">
        <div className="auth-intro">
          <h2>{mode === "in" ? "Welcome back" : "Start with ArcNave"}</h2>
          <p>{mode === "in" ? "Sign in to continue your workspace." : "Create your ArcNave account. Access may be limited during development."}</p>
        </div>

        {expired && mode === "in" && !error && (
          <div className="auth-notice" role="status">
            Your session ended. Sign in to pick up where you left off.
          </div>
        )}

        {error && (
          <div className="error-card" role="alert">
            <TriangleAlert size={19} />
            <div>
              <strong>{error.title}</strong>
              <p>{error.detail}</p>
              {error.code === "registration_closed" && <p><a href="mailto:admin@arcnave.in">Contact admin@arcnave.in about early access.</a></p>}
            </div>
          </div>
        )}

        <form onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy} className="auth-fields">
          {mode === "up" && (
            <label className="field-label">
              Your name <span className="optional">Optional</span>
              <input
                value={name}
                maxLength={120}
                autoComplete="name"
                placeholder="What should ArcNave call you?"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label className="field-label">
            Email
            <input
              type="email"
              required
              autoFocus
              value={email}
              maxLength={320}
              autoComplete="email"
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field-label">
            Password
            <span className="auth-password">
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              minLength={mode === "up" ? 12 : 1}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              placeholder={mode === "in" ? "Enter your password" : "Choose a strong password"}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </span>
            {mode === "up" && (
              <span className="field-help">At least 12 characters.</span>
            )}
          </label>
          <button
            className="button primary auth-submit"
            disabled={busy || !email.trim() || !password}
          >
            {busy && <Loader2 size={15} className="spin" />}
            {mode === "in" ? "Sign in" : "Create account"}
            {!busy && <ArrowUpRight size={18} />}
          </button>
          </fieldset>
        </form>

        <p className="auth-switch">
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
      <p className="auth-understated">Source documents, working drafts, and your next step in one place.</p>
      </section>
      <aside className="auth-art auth-study" aria-label="An illustrative workspace with a laptop and project notes">
        <div className="auth-art-top"><span>YOUR WORK, CONNECTED</span><span>↗</span></div>
        <div className="study-scene" aria-hidden="true">
          <div className="study-note"><span>THE NEXT STEP</span><p>Bring the records.<br />Review the gaps.<br />Prepare a draft.</p><span className="study-note-star">✳</span></div>
          <div className="study-laptop"><div className="study-screen"><div className="study-screen-brand">ArcNave<span>✦</span></div><span className="study-screen-label">WORK WITH YOUR SOURCES</span><h3>One question.<br />A reviewable draft.</h3><div className="study-answer"><i /><i /><i /></div><div className="study-input">Review these files…<span>↑</span></div></div><div className="study-keyboard" /></div>
          <div className="study-books"><div>PROJECT RECORDS</div><div>WORKING DRAFTS</div></div>
          <div className="study-pencil" />
        </div>
        <div className="auth-art-copy"><span>FROM SOURCE RECORDS TO A USEFUL DRAFT</span><h2>Your work.<br />Room to move.</h2><p>Questions, documents, and projects.<br />One workspace to keep going.</p></div>
        <div className="auth-art-bottom"><span>ArcNave</span><span>REVIEW · DRAFT · VERIFY</span></div>
      </aside>
      </main>
      <footer className="auth-footer">
        Responses come from configured AI providers. Your work is stored on the
        ArcNave server tied to this account.
      </footer>
    </div>
  );
}
