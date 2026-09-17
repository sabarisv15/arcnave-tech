import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Ellipsis,
  FolderClosed,
  FolderInput,
  GitBranch,
  Loader2,
  LogOut,
  MessageCircleMore,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  Pin,
  Plus,
  Search,
  Settings,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import { api } from "./api";
import { useSession } from "./session";
import { useWorkspace } from "./workspace";
import { Dropdown, IconButton, Modal, Tip } from "./ui";
import type { Chat } from "./types";
import { toChat } from "./types";

export function ChatMenu({ chat }: { chat: Chat }) {
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
        align="end"
        trigger={
          <button
            className="icon-button chat-menu"
            aria-label={`Actions for ${chat.title}`}
          >
            <Ellipsis size={17} />
          </button>
        }
        items={[
          {
            label: "Rename",
            icon: <Pencil size={15} />,
            onSelect: () => {
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
              <FolderClosed size={17} />
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
              <MessageCircleMore size={17} />
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

export default function Sidebar({
  collapsed,
  onCollapse,
  onNavigate,
  mobile = false,
}: {
  collapsed: boolean;
  onCollapse: () => void;
  onNavigate: () => void;
  mobile?: boolean;
}) {
  const { chats, projects, setSettings, setSearch, setPanel } = useWorkspace();
  const { user, signOut } = useSession();
  const [openProjects, setOpenProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const location = useLocation(),
    navigate = useNavigate();
  const nav = [
    { label: "Projects", icon: FolderClosed, to: "/projects" },
    { label: "Artifacts", icon: PanelsTopLeft, to: "/artifacts" },
  ];
  // The server already orders by pinned then recency; this keeps that order stable if the
  // list is refreshed mid-render.
  const standaloneChats = chats
    .filter((chat) => !chat.projectId)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .slice(0, 16);
  const go = (path: string) => {
    navigate(path);
    setPanel({ kind: "closed" });
    onNavigate();
  };
  const label = user?.name?.trim() || user?.email || "Your workspace";
  return (
    <aside
      className={`sidebar ${mobile ? "mobile-sidebar" : ""}`}
      aria-label="Main navigation"
    >
      <div className="brand-row">
        <Link
          to="/"
          className="brand"
          onClick={() => {
            setPanel({ kind: "closed" });
            onNavigate();
          }}
        >
          arcnave<span className="brand-dot">.</span>
        </Link>
        <IconButton
          label={
            mobile
              ? "Close navigation"
              : collapsed
                ? "Expand sidebar"
                : "Collapse sidebar"
          }
          onClick={onCollapse}
        >
          {mobile ? (
            <X size={18} />
          ) : collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </IconButton>
      </div>
      <nav aria-label="Workspace">
        <Tip label="New chat">
          <button
            className="nav-item new-chat"
            aria-label="New chat"
            onClick={() => go("/")}
          >
            <Plus size={18} />
            <span>New chat</span>
          </button>
        </Tip>
        {nav.map(({ label: item, icon: Icon, to }) => (
          <Tip key={to} label={item}>
            <button
              className={`nav-item ${location.pathname.startsWith(to) ? "active" : ""}`}
              aria-label={item}
              aria-current={
                location.pathname.startsWith(to) ? "page" : undefined
              }
              onClick={() => go(to)}
            >
              <Icon size={18} />
              <span>{item}</span>
            </button>
          </Tip>
        ))}
      </nav>
      <div className="sidebar-recents">
        {projects.length > 0 && (
          <div className="sidebar-projects">
            <div className="eyebrow sidebar-section-heading">
              <span>Projects</span>
              <IconButton
                label="View all projects"
                onClick={() => go("/projects")}
              >
                <ArrowUpRight size={14} />
              </IconButton>
            </div>
            {projects.map((project) => {
              const projectChats = chats.filter(
                (chat) => chat.projectId === project.id,
              );
              const open = openProjects.has(project.id);
              return (
                <div className="sidebar-project" key={project.id}>
                  <button
                    className={`sidebar-project-row ${location.pathname === `/project/${project.id}` ? "active" : ""}`}
                    aria-expanded={open}
                    onClick={() =>
                      setOpenProjects((current) => {
                        const next = new Set(current);
                        if (next.has(project.id)) next.delete(project.id);
                        else next.add(project.id);
                        return next;
                      })
                    }
                    title={project.title}
                  >
                    <FolderClosed size={16} />
                    <span>{project.title}</span>
                    {open ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                  {open && (
                    <div className="sidebar-project-chats">
                      {projectChats.map((chat) => (
                        <button
                          className={`sidebar-child-chat ${location.pathname === `/chat/${chat.id}` ? "active" : ""}`}
                          key={chat.id}
                          onClick={() => go(`/chat/${chat.id}`)}
                          title={chat.title}
                        >
                          <MessageCircleMore
                            size={14}
                            className={chat.pinned ? "pinned" : ""}
                          />
                          <span>{chat.title}</span>
                        </button>
                      ))}
                      {!projectChats.length && (
                        <p className="sidebar-section-empty">
                          No conversations yet.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="sidebar-chats-section">
          <div className="eyebrow sidebar-section-heading">
            <span>Chats</span>
            <span className="sidebar-group-actions">
              <Tip label="View all chats">
                <IconButton label="View all chats" onClick={() => go("/chats")}>
                  <ArrowUpRight size={14} />
                </IconButton>
              </Tip>
              <Tip label="Search chats · Ctrl+P">
                <IconButton
                  label="Search chats"
                  onClick={() => {
                    setSearch(true);
                    onNavigate();
                  }}
                >
                  <Search size={15} />
                </IconButton>
              </Tip>
            </span>
          </div>
          {standaloneChats.map((chat) => (
            <button
              className={`sidebar-standalone-chat ${location.pathname === `/chat/${chat.id}` ? "active" : ""}`}
              key={chat.id}
              onClick={() => go(`/chat/${chat.id}`)}
              title={chat.title}
            >
              <MessageCircleMore
                size={14}
                className={chat.pinned ? "pinned" : ""}
              />
              <span>{chat.title}</span>
            </button>
          ))}
          {!standaloneChats.length && (
            <p className="sidebar-section-empty">
              Project conversations appear above.
            </p>
          )}
        </div>
        {!chats.length && (
          <>
            <p className="eyebrow">Your space</p>
            <div className="sidebar-empty">
              Good ideas start with
              <br />a conversation.
            </div>
          </>
        )}
      </div>
      <Dropdown
        label="Your account"
        side="top"
        trigger={
          <button className="profile" aria-label="Your account">
            <span className="avatar">{label.slice(0, 1).toUpperCase()}</span>
            <span>
              {label}
              <small>{user?.email}</small>
            </span>
            <Ellipsis size={18} />
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
            <MessageCircleMore size={17} />
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
