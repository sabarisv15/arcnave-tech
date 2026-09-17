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

interface SessionValue {
  user: User | null;
  /** True until the first `/auth/me` answers, so nothing flashes the wrong screen. */
  loading: boolean;
  /** Set when the session ended under us rather than by signing out. */
  expired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
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
    [models, setModels] = useState<ModelsDto | null>(null);

  useEffect(() => {
    applyTheme(readLocal("theme") ?? "system");
    const query = matchMedia("(prefers-color-scheme: dark)");
    const reapply = () => applyTheme(readLocal("theme") ?? "system");
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
      setUser(null);
      if (!deliberate.current) setExpired(true);
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
      signIn: async (email, password) => {
        const result = await api.auth.login(email, password);
        deliberate.current = false;
        setExpired(false);
        setUser(result.user);
      },
      signUp: async (email, password, name) => {
        const result = await api.auth.register(email, password, name);
        deliberate.current = false;
        setExpired(false);
        setUser(result.user);
      },
      signOut: async () => {
        deliberate.current = true;
        try {
          await api.auth.logout();
        } finally {
          // Even if the call fails the local session is over; leaving the user apparently
          // signed in after they asked to leave is the worse failure.
          setExpired(false);
          setUser(null);
          writeLocal("theme", "system");
        }
      },
    }),
    [user, loading, expired, models, refreshModels],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}
