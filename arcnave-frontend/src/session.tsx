/**
 * Who is signed in, and what the workspace can do.
 *
 * Session state is deliberately separate from workspace state: the sign-in screen has to
 * render before any chat, project, or preference exists, and signing out has to be able to
 * throw all of that away at once by unmounting the provider below.
 *
 * The session itself is an HttpOnly cookie the browser holds and this code never sees. All
 * that lives here is the answer to "is there one, and whose".
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api, onUnauthorized } from "./api";
import type { ModelsDto, User } from "./api";
import { readLocal, writeLocal } from "./storage";

/** Who was signed in when the session ended, kept in memory only so the way back can name them. */
export interface EndedAccount {
  name: string;
  email: string;
}

interface SessionValue {
  user: User | null;
  /** True until the first `/auth/me` answers, so nothing flashes the wrong screen. */
  loading: boolean;
  /** Set when the session ended under us rather than by signing out. */
  expired: boolean;
  /** Set only by a deliberate sign-out (board S7-SignedOut). Never true together with `expired`. */
  signedOut: boolean;
  /** The account that just signed out or lost its session; null on a fresh page load. */
  lastAccount: EndedAccount | null;
  /** "Use another account": forgets `lastAccount` and both notices. */
  forgetAccount: () => void;
  /** Id of an account created in this tab (sign-up or first Google sign-in), until the welcome closes. */
  freshAccountId: string | null;
  dismissWelcome: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  /** Signs in (or creates the account) from a Google ID token; resolves true for a new account. */
  signInWithGoogle: (credential: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  models: ModelsDto | null;
  refreshModels: (probe?: boolean) => Promise<void>;
}

const C = createContext<SessionValue>(null!);
export const useSession = () => useContext(C);

/**
 * Apply a theme before the user's stored preferences have loaded.
 *
 * Their real preference is server-side and arrives with the workspace. Until then the last
 * theme this browser saw is used, so signing in does not flash white on a dark screen.
 */
export function applyTheme(
  theme: string,
  font = "sans",
  reducedMotion = false,
): void {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset["theme"] = dark ? "dark" : "light";
  document.documentElement.dataset["font"] = font;
  document.documentElement.dataset["motion"] = reducedMotion
    ? "reduced"
    : "system";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [expired, setExpired] = useState(false),
    [signedOut, setSignedOut] = useState(false),
    [lastAccount, setLastAccount] = useState<EndedAccount | null>(null),
    [freshAccountId, setFreshAccountId] = useState<string | null>(null),
    [models, setModels] = useState<ModelsDto | null>(null);
  // The handlers below outlive renders, so they read who is signed in from a ref.
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  useEffect(() => {
    applyTheme(readLocal("theme") ?? "system", readLocal("font") ?? "sans");
    const query = matchMedia("(prefers-color-scheme: dark)");
    const reapply = () =>
      applyTheme(readLocal("theme") ?? "system", readLocal("font") ?? "sans");
    query.addEventListener("change", reapply);
    return () => query.removeEventListener("change", reapply);
  }, []);

  /**
   * True from the moment the user asks to sign out.
   *
   * Signing out clears the cookie, so requests already in flight come back 401 immediately
   * afterwards. Without this the app would tell someone who just pressed "Sign out" that their
   * session had expired — an alarming thing to say about something they did on purpose.
   */
  const deliberate = useRef(false);

  // Any 401 anywhere means the cookie is gone. Reported once, here, rather than every call
  // site inventing its own recovery.
  useEffect(() => {
    onUnauthorized(() => {
      if (!deliberate.current) {
        const who = userRef.current;
        if (who) setLastAccount({ name: who.name, email: who.email });
        setExpired(true);
      }
      setUser(null);
    });
    return () => onUnauthorized(null);
  }, []);

  useEffect(() => {
    let live = true;
    api.auth
      .probe()
      .then((result) => {
        if (live) setUser(result.user);
      })
      .catch(() => {
        // A backend that is down is not a signed-out user, but the only screen we can show
        // either way is sign-in, which will report the real error when it is used.
        if (live) setUser(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const refreshModels = useCallback(async (probe = false) => {
    setModels(await api.models.list(probe));
  }, []);

  useEffect(() => {
    if (!user) {
      setModels(null);
      return;
    }
    // Cached availability on load: probing spends a token per alias, and the composer only
    // needs to know what is configured.
    void refreshModels(false).catch(() => setModels(null));
  }, [user, refreshModels]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      expired,
      models,
      refreshModels,
      signedOut,
      lastAccount,
      freshAccountId,
      dismissWelcome: () => setFreshAccountId(null),
      forgetAccount: () => {
        setExpired(false);
        setSignedOut(false);
        setLastAccount(null);
      },
      signIn: async (email, password) => {
        const result = await api.auth.login(email, password);
        deliberate.current = false;
        setExpired(false);
        setSignedOut(false);
        setLastAccount(null);
        setUser(result.user);
      },
      signUp: async (email, password, name) => {
        const result = await api.auth.register(email, password, name);
        deliberate.current = false;
        setExpired(false);
        setSignedOut(false);
        setLastAccount(null);
        setFreshAccountId(result.user.id);
        setUser(result.user);
      },
      signInWithGoogle: async (credential) => {
        const result = await api.auth.google(credential);
        deliberate.current = false;
        setExpired(false);
        setSignedOut(false);
        setLastAccount(null);
        if (result.created) setFreshAccountId(result.user.id);
        setUser(result.user);
        return result.created;
      },
      signOut: async () => {
        // The local session ends the instant this is called, not when the server answers.
        // asia-south1 is a real cross-region round trip (see mistakes.md), and awaiting it
        // before clearing state left the screen looking frozen for however long that took —
        // indistinguishable from Sign out doing nothing. The server call still happens, so the
        // cookie is actually revoked; the UI just no longer waits on it.
        deliberate.current = true;
        const who = userRef.current;
        setExpired(false);
        setSignedOut(true);
        setLastAccount(who ? { name: who.name, email: who.email } : null);
        setFreshAccountId(null);
        setUser(null);
        writeLocal("theme", "system");
        try {
          await api.auth.logout();
        } catch {
          // Local session already ended above; a failed revoke here changes nothing the user
          // can act on, and the cookie expires on its own regardless.
        }
      },
    }),
    [user, loading, expired, signedOut, lastAccount, freshAccountId, models, refreshModels],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}
