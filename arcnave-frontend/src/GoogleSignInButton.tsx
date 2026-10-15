/**
 * "Continue with Google" (ADR-0056), drawn as the locked G1 button: Google's Neutral theme,
 * 48 px tall, 12 px corners (brand board `S3-SignIn-4`).
 *
 * The sign-in itself is Google's: the official Identity Services script renders its own button,
 * laid exactly over ours and transparent, so the click, the popup and the ID token are Google's
 * and never imitated. The token goes to the server, which verifies it. With no
 * `VITE_GOOGLE_OAUTH_CLIENT_ID` the button is not shown at all.
 */
import { useEffect, useRef, useState } from "react";

const GIS_SRC = "https://accounts.google.com/gsi/client";

interface GisId {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void; ux_mode?: "popup" }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GisId } };
  }
}

/** The configured client id, or null when Google sign-in is off for this build. */
export function googleClientId(env: { VITE_GOOGLE_OAUTH_CLIENT_ID?: string } = import.meta.env): string | null {
  const id = env.VITE_GOOGLE_OAUTH_CLIENT_ID?.trim();
  return id ? id : null;
}

let loading: Promise<GisId> | null = null;

/** Loads Google's script once per page; a failed load can be retried on the next mount. */
function loadGis(): Promise<GisId> {
  const ready = window.google?.accounts?.id;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<GisId>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id);
      else reject(new Error("Google sign-in did not load"));
    };
    script.onerror = () => reject(new Error("Google sign-in did not load"));
    document.head.append(script);
  }).catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

export function GoogleSignInButton({
  onCredential,
  disabled = false,
  clientId = googleClientId(),
}: {
  onCredential: (credential: string) => void;
  disabled?: boolean;
  clientId?: string | null;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGis()
      .then((gis) => {
        if (cancelled || !overlay.current) return;
        gis.initialize({
          client_id: clientId,
          ux_mode: "popup",
          callback: (response) => {
            if (response.credential) callback.current(response.credential);
          },
        });
        gis.renderButton(overlay.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          width: Math.min(400, Math.max(200, overlay.current.offsetWidth || 320)),
        });
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className={`google-button${disabled || unavailable ? " is-disabled" : ""}`} data-testid="google-signin">
      <span className="google-button-face" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span>{unavailable ? "Google sign-in could not load" : "Continue with Google"}</span>
      </span>
      {/* Google's own button, transparent, on top: it takes the click. */}
      <div ref={overlay} className="google-button-overlay" />
    </div>
  );
}
