import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Download,
  Ellipsis,
  Folder,
  FolderInput,
  GitBranch,
  Loader2,
  LogOut,
  MessageSquare,
  PanelLeft,
  Shapes,
  Pin,
  Plus,
  Search,
  Settings,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import { api } from "./api";
import { Icon, Logo, Wordmark } from "./brand";
import { useSession } from "./session";
import { useWorkspace } from "./workspace";
import { Dropdown, Modal } from "./ui";
import type { Chat } from "./types";
import { toChat } from "./types";

export function ChatMenu({
  chat,
  trigger,
  onRename,
  side,
  align = "end",
}: {
  chat: Chat;
  /** Replaces the "…" button, e.g. the chat title in the sheet's header (S6-Chat title menu). */
  trigger?: ReactNode;
  /** Renames in place (the header's inline field) instead of opening the rename dialog. */
  onRename?: () => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "end";
}) {
  const {
    projects,
    renameChat,
    pinChat,
    moveChat,
    deleteChat,
    branch,
    exportChat,
  } = useWorkspace();
  const [modal, setModal] = useState<"rename" | "delete" | "move" | null>(null),
    [name, setName] = useState(chat.title);
  return (
    <>
      <Dropdown
        label={`Actions for ${chat.title}`}
        align={align}
        {...(side ? { side } : {})}
        trigger={
          trigger ?? (
            <button
              className="icon-button chat-menu"
              aria-label={`Actions for ${chat.title}`}
            >
              <Ellipsis size={17} />
            </button>
          )
        }
        items={[
          {
            label: "Rename",
            icon: <Pencil size={15} />,
            onSelect: () => {
              if (onRename) return onRename();
              setName(chat.title);
              setModal("rename");
            },
          },
          {
            label: chat.pinned ? "Unpin conversation" : "Pin conversation",
            icon: <Pin size={15} />,
            onSelect: () => pinChat(chat.id, !chat.pinned),
          },
          {
            label: chat.projectId
              ? "Move to another project"
              : "Add to project",
            icon: <FolderInput size={15} />,
            onSelect: () => setModal("move"),
          },
          {
            label: "Branch conversation",
            icon: <GitBranch size={15} />,
            onSelect: () => branch(chat.id),
          },
          {
            label: "Export Markdown",
            icon: <Download size={15} />,
            onSelect: () => exportChat(chat),
          },
          {
            label: "Delete conversation",
            icon: <Trash2 size={15} />,
            danger: true,
            separator: true,
            onSelect: () => setModal("delete"),
          },
        ]}
      />
      <Modal
        open={modal === "rename"}
        onClose={() => setModal(null)}
        title="Rename conversation"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            renameChat(chat.id, name);
            setModal(null);
          }}
        >
          <label className="field-label">
            Conversation title
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={180}
            />
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              onClick={() => setModal(null)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={!name.trim()}>
              Save name
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={modal === "move"}
        onClose={() => setModal(null)}
        title={chat.projectId ? "Move conversation" : "Add to project"}
        description="Project instructions and indexed files apply to future messages in this conversation."
      >
        <div className="project-picker">
          {projects.map((project) => (
            <button
              key={project.id}
              className={chat.projectId === project.id ? "selected" : ""}
              onClick={() => {
                moveChat(chat.id, project.id);
                setModal(null);
              }}
            >
              <Folder size={17} />
              <span>
                <strong>{project.title}</strong>
                <small>{project.description || "Project workspace"}</small>
              </span>
              {chat.projectId === project.id && <Check size={16} />}
            </button>
          ))}
          {!projects.length && (
            <p className="field-help">
              You have no projects yet. Create one from the Projects page.
            </p>
          )}
          {chat.projectId && (
            <button
              onClick={() => {
                moveChat(chat.id, null);
                setModal(null);
              }}
            >
              <MessageSquare size={17} />
              <span>
                <strong>Remove from project</strong>
                <small>Keep it as a standalone conversation</small>
              </span>
            </button>
          )}
        </div>
      </Modal>
      <Modal
        open={modal === "delete"}
        onClose={() => setModal(null)}
        title="Delete conversation?"
        description={`“${chat.title}” will be removed from your workspace. Export it first if you want to keep a copy.`}
      >
        <div className="dialog-actions">
          <button className="button" onClick={() => setModal(null)}>
            Keep conversation
          </button>
          <button
            className="button destructive"
            onClick={() => {
              deleteChat(chat.id);
              setModal(null);
            }}
          >
            Delete conversation
          </button>
        </div>
      </Modal>
    </>
  );
}

/** Where the navigation is drawn: the icon rail, the full sidebar, or the phone drawer. */
export type NavMode = "rail" | "wide" | "drawer";
type Section = "chats" | "projects" | "library";

/** The id the rail toggle's `aria-controls` points at. */
export const APP_NAV_ID = "app-nav";

/**
 * Recent chats in the sidebar's day groups ("Today", "Yesterday", "Earlier"), newest first as the
 * server ordered them. Pinned chats are listed under "Pinned" instead, so they are left out here.
 */
export function groupRecentChats(
  chats: Chat[],
  now: Date = new Date(),
  limit = 16,
): Array<{ label: string; chats: Chat[] }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const groups: Array<{ label: string; chats: Chat[] }> = [
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Earlier", chats: [] },
  ];
  for (const chat of chats.filter((c) => !c.pinned).slice(0, limit)) {
    const at = chat.updatedAt ? Date.parse(chat.updatedAt) : NaN;
    const group = Number.isNaN(at) ? groups[2]! : at >= startOfToday ? groups[0]! : at >= startOfYesterday ? groups[1]! : groups[2]!;
    group.chats.push(chat);
  }
  return groups.filter((g) => g.chats.length > 0);
}

function sectionOf(pathname: string): Section | "new" | null {
  if (pathname === "/app") return "new";
  if (pathname.startsWith("/chat/") || pathname === "/chats") return "chats";
  if (pathname.startsWith("/project")) return "projects";
  if (pathname.startsWith("/artifacts")) return "library";
  return null;
}

const SECTIONS: Array<{ id: Section; label: string; icon: LucideIcon; to: string }> = [
  { id: "chats", label: "Chats", icon: MessageSquare, to: "/chats" },
  { id: "projects", label: "Projects", icon: Folder, to: "/projects" },
  { id: "library", label: "Library", icon: BookOpen, to: "/artifacts" },
];

/**
 * App shell navigation, "M2 icon rail" (docs/brand/Final-New, Final-Chat-Light/Dark).
 *
 * - `rail`: 76 px of icons with captions. Chats, Projects and Library open a floating panel beside
 *   the rail; Search opens the search dialog; "Expand sidebar" switches to `wide`.
 * - `wide`: the full sidebar (logo, New chat, sections, pinned, recent chats, account).
 * - `drawer`: the full sidebar inside the phone drawer; the toggle closes the drawer.
 *
 * Nothing here animates: the shell is still, motion belongs to the logo and the AI states.
 */
export default function AppNav({
  mode,
  onToggle,
  onNavigate,
}: {
  mode: NavMode;
  /** Rail <-> sidebar; in the drawer it closes the drawer. */
  onToggle: () => void;
  /** Called after any navigation, so the drawer can close. */
  onNavigate: () => void;
}) {
  const { chats, projects, artifacts, setSettings, setSearch, setPanel } = useWorkspace();
  const { user, signOut } = useSession();
  const location = useLocation(),
    navigate = useNavigate();
  const [open, setOpen] = useState<Section | null>(null);
  const current = sectionOf(location.pathname);

  // A floating panel belongs to the rail; it closes when the rail turns into the sidebar or the
  // route changes, and on Escape.
  useEffect(() => setOpen(null), [mode, location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (path: string) => {
    navigate(path);
    setPanel({ kind: "closed" });
    setOpen(null);
    onNavigate();
  };
  const openSearch = () => {
    setOpen(null);
    setSearch(true);
    onNavigate();
  };
  const name = user?.name?.trim() || user?.email || "Your workspace";
  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "A";
  const pinnedProjects = projects.filter((p) => p.pinned);
  const pinnedChats = chats.filter((c) => c.pinned);
  const recentGroups = groupRecentChats(chats);
  const chatPath = (id: string) => location.pathname === `/chat/${id}`;

  const account = (compact: boolean) => (
    <Dropdown
      label="Your account"
      side="top"
      trigger={
        <button className={compact ? "an-avatar-button" : "an-account"} aria-label="Your account">
          <span className="an-avatar" aria-hidden="true">
            {initials}
          </span>
          {!compact && (
            <>
              <span className="an-account-text">
                <span className="an-account-name">{name}</span>
                <small>{user?.email}</small>
              </span>
              <ChevronDown size={16} className="an-account-chevron" />
            </>
          )}
        </button>
      }
      items={[
        {
          label: "Settings",
          icon: <Settings size={16} />,
          onSelect: () => {
            setSettings(true);
            onNavigate();
          },
        },
        {
          label: "Sign out",
          icon: <LogOut size={16} />,
          separator: true,
          onSelect: () => void signOut(),
        },
      ]}
    />
  );

  const recentRow = (chat: Chat) => (
    <div className={`an-rec-row ${chatPath(chat.id) ? "on" : ""}`} key={chat.id}>
      <button
        className={`an-rec ${chatPath(chat.id) ? "on" : ""}`}
        aria-current={chatPath(chat.id) ? "page" : undefined}
        onClick={() => go(`/chat/${chat.id}`)}
      >
        <span>{chat.title}</span>
      </button>
      <ChatMenu chat={chat} />
    </div>
  );

  if (mode === "rail")
    return (
      <>
        <nav className="an-rail" aria-label="Main" id={APP_NAV_ID}>
          <Link
            to="/app"
            className="an-rail-logo"
            aria-label="ArcNave home"
            onClick={() => {
              setPanel({ kind: "closed" });
              setOpen(null);
            }}
          >
            <Logo size={30} variant="rich" />
          </Link>
          <button className="an-rbtn an-rbtn-new" aria-label="New chat" onClick={() => go("/app")}>
            <Icon icon={Plus} size={20} />
          </button>
          <span className="an-cap" aria-hidden="true">
            New
          </span>
          <button className="an-rbtn" aria-label="Search" onClick={openSearch}>
            <Icon icon={Search} size={20} />
          </button>
          <span className="an-cap" aria-hidden="true">
            Search
          </span>
          {SECTIONS.map((s) => {
            const on = open ? open === s.id : current === s.id;
            return (
              <Fragment key={s.id}>
                <button
                  className={`an-rbtn ${on ? "on" : ""}`}
                  aria-label={s.label}
                  aria-expanded={open === s.id}
                  aria-current={current === s.id ? "page" : undefined}
                  onClick={() => setOpen((v) => (v === s.id ? null : s.id))}
                >
                  <Icon icon={s.icon} size={20} active={on} />
                </button>
                <span className="an-cap" aria-hidden="true">
                  {s.label}
                </span>
              </Fragment>
            );
          })}
          <span className="an-rail-spacer" />
          <button
            className="an-rbtn an-nav-toggle"
            aria-label="Expand sidebar"
            aria-expanded={false}
            aria-controls={APP_NAV_ID}
            onClick={onToggle}
          >
            <Icon icon={PanelLeft} size={19} />
          </button>
          {account(true)}
        </nav>
        {open && (
          <aside className="an-panel" aria-label={SECTIONS.find((s) => s.id === open)!.label}>
            <div className="an-ptitle">
              <b>{SECTIONS.find((s) => s.id === open)!.label}</b>
              <button className="an-ibtn" aria-label="Close" onClick={() => setOpen(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="an-panel-body">
              {open === "chats" && (
                <>
                  {pinnedChats.length > 0 && <div className="an-lbl">Pinned</div>}
                  {pinnedChats.map(recentRow)}
                  {recentGroups.map((g) => (
                    <Fragment key={g.label}>
                      <div className="an-lbl">{g.label}</div>
                      {g.chats.map(recentRow)}
                    </Fragment>
                  ))}
                  {!chats.length && <p className="an-empty">No conversations yet.</p>}
                  <button className="an-pitem an-pitem-link" onClick={() => go("/chats")}>
                    <ArrowUpRight size={18} />
                    All chats
                  </button>
                </>
              )}
              {open === "projects" && (
                <>
                  {projects.map((p) => (
                    <button className="an-pitem" key={p.id} onClick={() => go(`/project/${p.id}`)}>
                      <Icon icon={Folder} size={18} />
                      <span>
                        {p.title}
                        <small>
                          {p.counts.files} file{p.counts.files === 1 ? "" : "s"} · {p.counts.chats} chat
                          {p.counts.chats === 1 ? "" : "s"}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!projects.length && <p className="an-empty">No projects yet.</p>}
                  <button className="an-pitem an-pitem-link" onClick={() => go("/projects")}>
                    <ArrowUpRight size={18} />
                    All projects
                  </button>
                </>
              )}
              {open === "library" && (
                <>
                  {artifacts.slice(0, 12).map((a) => (
                    <button
                      className="an-pitem"
                      key={a.id}
                      onClick={() => {
                        setPanel({ kind: "artifact", id: a.id });
                        setOpen(null);
                      }}
                    >
                      <Shapes size={18} aria-hidden="true" />
                      <span>
                        {a.title}
                        <small>{a.kind.charAt(0).toUpperCase() + a.kind.slice(1)}</small>
                      </span>
                    </button>
                  ))}
                  {!artifacts.length && <p className="an-empty">Nothing made yet.</p>}
                  <button className="an-pitem an-pitem-link" onClick={() => go("/artifacts")}>
                    <ArrowUpRight size={18} />
                    Open Library
                  </button>
                </>
              )}
            </div>
          </aside>
        )}
      </>
    );

  const drawer = mode === "drawer";
  return (
    <aside className={`an-wide ${drawer ? "an-wide-drawer" : ""}`} aria-label="Sidebar" id={drawer ? undefined : APP_NAV_ID}>
      <div className="an-wide-head">
        <Link
          to="/app"
          className="an-wide-brand"
          aria-label="ArcNave home"
          onClick={() => {
            setPanel({ kind: "closed" });
            onNavigate();
          }}
        >
          <Logo size={26} variant="rich" />
          <Wordmark width={65.7} color="var(--color-text)" />
        </Link>
        {drawer ? (
          <button className="an-ibtn" aria-label="Close navigation" onClick={onToggle}>
            <X size={18} />
          </button>
        ) : (
          <button
            className="an-ibtn an-nav-toggle"
            aria-label="Collapse sidebar"
            aria-expanded={true}
            aria-controls={APP_NAV_ID}
            onClick={onToggle}
          >
            <Icon icon={PanelLeft} size={18} />
          </button>
        )}
      </div>
      <button className="an-newbtn" onClick={() => go("/app")}>
        <Plus size={18} aria-hidden="true" />
        New chat
      </button>
      <nav className="an-wide-nav" aria-label="Workspace">
        <button className="an-nav" onClick={openSearch}>
          <Icon icon={Search} size={18} />
          Search
        </button>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`an-nav ${current === s.id ? "on" : ""}`}
            aria-current={current === s.id ? "page" : undefined}
            onClick={() => go(s.to)}
          >
            <Icon icon={s.icon} size={18} active={current === s.id} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="an-wide-scroll">
        {(pinnedProjects.length > 0 || pinnedChats.length > 0) && <div className="an-lbl">Pinned</div>}
        {pinnedProjects.map((p) => {
          const here = location.pathname === `/project/${p.id}`;
          return (
            <button
              key={p.id}
              className={`an-nav ${here ? "on" : ""}`}
              aria-current={here ? "page" : undefined}
              onClick={() => go(`/project/${p.id}`)}
            >
              <Icon icon={Folder} size={18} active={here} />
              <span className="an-nav-text">{p.title}</span>
            </button>
          );
        })}
        {pinnedChats.map(recentRow)}
        {recentGroups.map((g) => (
          <Fragment key={g.label}>
            <div className="an-lbl">{g.label}</div>
            {g.chats.map(recentRow)}
          </Fragment>
        ))}
        {!chats.length && <p className="an-empty">Good ideas start with a conversation.</p>}
      </div>
      <div className="an-wide-foot">{account(false)}</div>
    </aside>
  );
}

/**
 * Conversation search.
 *
 * Titles only, and the label says so. The server has no full-text index over message bodies,
 * and filtering whatever happens to be cached in this tab would silently return less than the
 * user's whole history.
 */
export function SearchDialog() {
  const { search, setSearch, setPanel } = useWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Chat[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!search) return;
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      api.chats
        .list({ limit: 30, ...(query.trim() ? { q: query.trim() } : {}) })
        .then((page) => {
          if (live) setResults(page.items.map(toChat));
        })
        .catch(() => {
          if (live) setResults([]);
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  return (
    <Modal
      open={search}
      onClose={() => setSearch(false)}
      title="Search conversations"
      className="search-modal"
    >
      <div className="search-field">
        <Search size={19} />
        <input
          autoFocus
          aria-label="Search conversation titles"
          placeholder="A title you remember…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="search-results">
        {results.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              navigate(`/chat/${c.id}`);
              setSearch(false);
              setPanel({ kind: "closed" });
              setQuery("");
            }}
          >
            <MessageSquare size={17} />
            <span>
              <strong>{c.title}</strong>
              <small>
                {c.updatedAt
                  ? new Date(c.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : ""}
              </small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {busy && !results.length && (
          <p className="loading-line">
            <Loader2 size={15} className="spin" />
            Searching…
          </p>
        )}
        {!busy && !results.length && (
          <p className="no-results">
            {query
              ? `No conversation title matches “${query}”.`
              : "You have no conversations yet."}
          </p>
        )}
      </div>
      <div className="search-hint">
        Titles only · Tab to browse results · Enter to open · Esc to close
      </div>
    </Modal>
  );
}
