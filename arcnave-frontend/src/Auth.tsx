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
import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { ApiError } from "./api";
import { useSession } from "./session";
import { BrandMark } from "./ui";

export default function Auth() {
  const { signIn, signUp, expired } = useSession();
  const [mode, setMode] = useState<"in" | "up">("in"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<{ title: string; detail: string } | null>(
      null,
    );

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
          ? { title: failure.title, detail: failure.detail }
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
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-intro">
          <BrandMark />
          <p className="eyebrow">A LITTLE ROOM TO THINK</p>
          <h1>
            {mode === "in" ? "Welcome back." : "Make yourself a workspace."}
          </h1>
          <p>
            {mode === "in"
              ? "Your conversations, projects, and artifacts are waiting."
              : "Conversations, projects, files, and artifacts, kept together."}
          </p>
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
            </div>
          </div>
        )}

        <form onSubmit={submit}>
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
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field-label">
            Password
            <input
              type="password"
              required
              value={password}
              minLength={mode === "up" ? 12 : 1}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
            />
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
          </button>
        </form>

        <p className="auth-switch">
          {mode === "in" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError(null);
            }}
          >
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
      <footer className="auth-footer">
        Responses come from configured AI providers. Your work is stored on the
        ArcNave server tied to this account.
      </footer>
    </div>
  );
}
