/**
 * The page every sign-in board shares (SI4, S3-Code, S3-Link, S3-2Step, S4-Invite, S7-SignedOut):
 * brand top-left, the card column on the left, the "scattered -> one point" panel on the right,
 * Terms / Privacy / Help along the bottom. Sign-in pages use Source Serif for all text (locked
 * 2026-10-12), which `auth.css` applies through `--font-signin`.
 *
 * The panel is decorative: `ScatterToPoint variant="loop"` still draws one finished frame under
 * reduced motion (`prefersStillMotion`), so it is rendered either way.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Logo, ScatterToPoint, Wordmark } from "../brand";
import "./auth.css";

/** The same address the public site and the registration_closed message give. */
export const SUPPORT_EMAIL = "admin@arcnave.in";

/** Board layout is two panels; below this width it is one column and the panel is not drawn. */
const WIDE_QUERY = "(min-width: 900px)";

function useWideLayout(): boolean {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(WIDE_QUERY).matches
      : true;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return wide;
}

export function AuthFrame({ children }: { children: ReactNode }) {
  const wide = useWideLayout();
  return (
    <div className="sx">
      <header className="sx-top">
        <a
          className="sx-brand"
          href="/"
          aria-label="Back to the arcnave website"
        >
          <Logo size={36} variant="rich" />
          <Wordmark width={90} />
        </a>
      </header>
      <main className="sx-main">
        <section className="sx-col">{children}</section>
        {wide && (
          <aside className="sx-panel" aria-hidden="true" data-testid="sx-panel">
            <ScatterToPoint variant="loop" />
          </aside>
        )}
      </main>
      <footer className="sx-foot">
        <nav aria-label="Legal and help">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>Help</a>
        </nav>
        <p>
          Responses come from configured AI providers. Your work is stored on
          the ArcNave server tied to this account.
        </p>
      </footer>
    </div>
  );
}

/** Title block above the card: board `.hero` / `.hero2` and `.sub` / `.sub2`. */
export function AuthHeading({
  id,
  title,
  children,
  size = "hero",
}: {
  id: string;
  title: string;
  /** Sub line; use `<br />` for the board's two-line subs. */
  children?: ReactNode;
  size?: "hero" | "page";
}) {
  return (
    <div className={`sx-head sx-head--${size}`}>
      <h1 id={id}>{title}</h1>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

/** The 52 px round icon on the result cards (board `.tick`, `.tick.warnc`, info tick on Invite). */
export function Tick({
  icon: Icon,
  tone = "ok",
  size = 26,
}: {
  icon: LucideIcon;
  tone?: "ok" | "warn" | "info";
  size?: number;
}) {
  return (
    <div className={`sx-tick sx-tick--${tone}`} aria-hidden="true">
      <Icon size={size} strokeWidth={2} />
    </div>
  );
}
