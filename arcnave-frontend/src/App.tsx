import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  Feather,
  FileText,
  GitBranch,
  Loader2,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RotateCcw,
  Share2,
  Telescope,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import Sidebar, { ChatMenu, SearchDialog } from "./Navigation";
import { BrandMark, Dropdown, EmptyState, IconButton, Modal } from "./ui";
import Composer, { AttachmentChip } from "./Composer";
import Settings from "./Settings";
import { ArtifactsPage, ChatsPage, ProjectPage, ProjectsPage } from "./Pages";
import { errors } from "./adapter";
import type { Message, Mode } from "./types";
const ContextPanel = lazy(() => import("./Panels"));
const Markdown = lazy(() =>
  import("./Content").then((module) => ({ default: module.Markdown })),
);
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="fatal-error">
          <h1>This view could not load.</h1>
          <p>Your saved work is still in this browser.</p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Reload workspace
          </button>
        </div>
      );
    return this.props.children;
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <Tooltip.Provider>
        <WorkspaceProvider>
          <Shell />
        </WorkspaceProvider>
      </Tooltip.Provider>
    </ErrorBoundary>
  );
}
function Shell() {
  const {
    data,
    panel,
    setPanel,
    toastText,
    setSearch,
    setSettings,
    activeRun,
  } = useWorkspace();
  const [collapsed, setCollapsed] = useState(() => {
      try {
        return localStorage.getItem("still-sidebar") === "collapsed";
      } catch {
        return false;
      }
    }),
    [drawer, setDrawer] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine);
  const navigate = useNavigate(),
    location = useLocation();
  const activeChat = location.pathname.startsWith("/chat/")
    ? data.chats.find((c) => c.id === location.pathname.split("/")[2])
    : undefined;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate("/");
        setPanel({ kind: "closed" });
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setSearch(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettings(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, setPanel, setSearch, setSettings]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    document.title = activeChat
      ? `${activeChat.title} — ArcNave`
      : "ArcNave — A little room to think";
  }, [activeChat?.title]);
  const collapse = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("still-sidebar", c ? "expanded" : "collapsed");
      } catch {}
      return !c;
    });
  };
  return (
    <div
      className={`app-shell ${collapsed ? "collapsed" : ""} ${panel.kind !== "closed" ? "has-panel" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        collapsed={collapsed}
        onCollapse={collapse}
        onNavigate={() => setDrawer(false)}
      />
      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="drawer-overlay" />
          <Dialog.Content
            className="drawer-content"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Sidebar
              mobile
              collapsed={false}
              onCollapse={() => setDrawer(false)}
              onNavigate={() => setDrawer(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <main className="main-area" id="main-content">
        <header
          className={`topbar ${activeChat ? "topbar-chat" : "topbar-idle"}`}
        >
          <IconButton
            className="mobile-menu"
            label="Open navigation"
            onClick={() => setDrawer(true)}
          >
            <Menu size={20} />
          </IconButton>
          {activeChat ? (
            <>
              <span className="conversation-title">{activeChat.title}</span>
              <ChatMenu chat={activeChat} />
              <div className="spacer" />
              <ShareButton chatId={activeChat.id} />
            </>
          ) : null}
        </header>
        {offline && (
          <div className="offline-banner" role="status">
            <TriangleAlert size={15} />
            You’re offline. Saved conversations and files are available.
          </div>
        )}
        {activeRun && activeRun !== activeChat?.id && (
          <button
            className="background-run"
            onClick={() => navigate(`/chat/${activeRun}`)}
          >
            <Loader2 size={14} className="spin" />A response is in progress
            <ArrowUpRight size={14} />
          </button>
        )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat/:id" element={<Conversation />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route
            path="*"
            element={
              <EmptyState
                icon={<MessageCircle />}
                title="A fresh start?"
                description="That page is not in this workspace."
                action={
                  <Link className="button" to="/">
                    New conversation
                  </Link>
                }
              />
            }
          />
        </Routes>
      </main>
      {panel.kind !== "closed" && (
        <Suspense
          fallback={
            <aside className="context-panel">
              <div className="panel-header">Opening panel…</div>
            </aside>
          }
        >
          <ContextPanel />
        </Suspense>
      )}
      <Settings />
      <SearchDialog />
      {toastText && (
        <div className="toast" role="status">
          <Check size={16} />
          {toastText}
        </div>
      )}
    </div>
  );
}
function Home() {
  const { data } = useWorkspace();
  const [suggestion, setSuggestion] = useState(""),
    [mode, setMode] = useState<Mode>(data.preferences.defaultMode);
  return (
    <>
      <div className="home">
        <div className="home-intro">
          <BrandMark />
          <p className="eyebrow">A LITTLE ROOM TO THINK</p>
          <h1>Where shall we begin?</h1>
        </div>
        <Composer initialPrompt={suggestion} initialMode={mode} />
        <div className="suggestions">
          <button
            onClick={() => {
              setMode("research");
              setSuggestion(
                "How can cities stay cooler? Compare the practical approaches and show your sources.",
              );
            }}
          >
            <Telescope size={16} />
            Explore a topic
          </button>
          <button
            onClick={() => {
              setMode("chat");
              setSuggestion(
                "Help me understand a file. I’ll attach it with the plus menu.",
              );
            }}
          >
            <Paperclip size={16} />
            Understand a file
          </button>
          <button
            onClick={() => {
              setMode("chat");
              setSuggestion(
                "Help me write a short essay about noticing everyday things.",
              );
            }}
          >
            <Feather size={16} />
            Make something
          </button>
        </div>
        <p className="home-note">
          From a passing thought to a clearer picture.
        </p>
      </div>
      <footer className="app-footer">
        Demo responses. Your work stays on this device.
      </footer>
    </>
  );
}
function Conversation() {
  const { id } = useParams();
  const { data } = useWorkspace();
  const chat = data.chats.find((c) => c.id === id);
  const scroll = useRef<HTMLDivElement>(null),
    bottom = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  useEffect(() => {
    setNearBottom(true);
    bottom.current?.scrollIntoView();
  }, [id]);
  const last = chat?.messages.at(-1);
  useEffect(() => {
    if (nearBottom) bottom.current?.scrollIntoView({ block: "end" });
  }, [last?.text, last?.status, nearBottom]);
  if (!chat)
    return (
      <EmptyState
        icon={<MessageCircle />}
        title="Conversation not found"
        description="It may have been removed from this device."
        action={
          <Link className="button" to="/">
            Start a new conversation
          </Link>
        }
      />
    );
  return (
    <div className="conversation-view">
      <div
        className="conversation-scroll"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el)
            setNearBottom(
              el.scrollHeight - el.scrollTop - el.clientHeight < 120,
            );
        }}
      >
        <div className="messages">
          {chat.projectId && (
            <Link
              className="conversation-project"
              to={`/project/${chat.projectId}`}
            >
              {data.projects.find((p) => p.id === chat.projectId)?.title}
              <ChevronRight size={13} />
            </Link>
          )}
          {chat.demo && (
            <p className="example-note">
              SAVED EXAMPLE · EXPLORE THE INTERACTIONS
            </p>
          )}
          {chat.messages.map((m, index) => (
            <MessageView
              key={m.id}
              message={m}
              chatId={chat.id}
              index={index}
            />
          ))}
          <div ref={bottom} />
        </div>
      </div>
      {!nearBottom && (
        <button
          className="jump-bottom"
          aria-label="Jump to latest message"
          onClick={() => {
            bottom.current?.scrollIntoView({ behavior: "smooth" });
            setNearBottom(true);
          }}
        >
          <ArrowDown size={17} />
        </button>
      )}
      <div className="conversation-composer">
        <Composer
          key={chat.id}
          chatId={chat.id}
          projectId={chat.projectId}
          initialMode={chat.messages.at(-1)?.mode}
          compact
        />
      </div>
    </div>
  );
}
function MessageView({
  message: m,
  chatId,
  index,
}: {
  message: Message;
  chatId: string;
  index: number;
}) {
  const { data, setData, setPanel, toast, retry, activeRun, branch, setEdit } =
    useWorkspace();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(
        "Clipboard access is unavailable. Export the conversation instead.",
      );
    }
  };
  const feedback = (value: "up" | "down") => {
    setData((w) => ({
      ...w,
      chats: w.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: c.messages.map((x) =>
                x.id === m.id
                  ? { ...x, feedback: x.feedback === value ? undefined : value }
                  : x,
              ),
            }
          : c,
      ),
    }));
    toast(
      m.feedback === value
        ? "Feedback removed"
        : "Feedback saved on this device",
    );
  };
  if (m.role === "user")
    return (
      <div className="user-message">
        <div className="user-bubble">
          {m.attachments?.length ? (
            <div className="attachments">
              {m.attachments.map((f) => (
                <AttachmentChip key={f.id} file={f} />
              ))}
            </div>
          ) : null}
          <p>{m.text}</p>
        </div>
        <div className="message-actions user-actions">
          <IconButton label="Copy prompt" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
          <IconButton
            label="Edit prompt"
            disabled={!!activeRun}
            onClick={() => setEdit({ chatId, index, text: m.text })}
          >
            <Pencil size={14} />
          </IconButton>
        </div>
      </div>
    );
  const loading = m.status === "submitting" || m.status === "generating";
  return (
    <article
      className={`assistant-message ${loading ? "is-generating" : ""}`}
      aria-label="ArcNave response"
    >
      <div className="answer-byline">
        <BrandMark />
        <span>ArcNave</span>
        {m.mode !== "chat" && (
          <button
            className="research-summary"
            onClick={() =>
              setPanel({ kind: "research", chatId, messageId: m.id })
            }
          >
            {loading ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <Check size={13} />
            )}{" "}
            {m.status === "stopped"
              ? "Stopped"
              : m.status === "error"
                ? "Interrupted"
                : loading
                  ? "Loading example"
                  : m.mode === "research"
                    ? "Research example"
                    : "Search example"}
            <ChevronRight size={12} />
          </button>
        )}
        {m.mode === "chat" && m.demo && (
          <span className="sample-label">Sample response</span>
        )}
      </div>
      {m.text && (
        <Suspense fallback={<p className="markdown">{m.text}</p>}>
          <Markdown
            text={m.text}
            sources={m.sources}
            onCitation={(selected) =>
              setPanel({ kind: "sources", chatId, messageId: m.id, selected })
            }
          />
        </Suspense>
      )}
      <div className="generation-status" role="status" aria-live="polite">
        {loading && (
          <span className="loading-line">
            <span className="thinking-dots">
              <i />
              <i />
              <i />
            </span>
            {m.text ? "" : "Preparing a demonstration response…"}
          </span>
        )}
        {m.status === "stopped" && (
          <span className="stopped-label">
            Response stopped
            <button onClick={() => retry(chatId, m.id)}>Regenerate</button>
          </span>
        )}
      </div>
      {m.status === "error" && (
        <div className="error-card" role="alert">
          <TriangleAlert size={19} />
          <div>
            <strong>{errors[m.error || "generation"].title}</strong>
            <p>{errors[m.error || "generation"].detail}</p>
            <button
              className="button"
              onClick={() => retry(chatId, m.id)}
              disabled={!!activeRun}
            >
              <RotateCcw size={14} />
              Retry response
            </button>
          </div>
        </div>
      )}
      {m.sources && m.sources.length > 0 && (
        <button
          className="source-summary"
          onClick={() => setPanel({ kind: "sources", chatId, messageId: m.id })}
        >
          <span className="source-stack">
            {[...new Set(m.sources.map((s) => s.domain))]
              .slice(0, 3)
              .map((domain) => (
                <i key={domain}>{domain.charAt(0).toUpperCase()}</i>
              ))}
          </span>
          <span>
            <strong>{m.sources.length} sources</strong>
            <small>
              {[...new Set(m.sources.map((s) => s.domain))].join(" · ")}
            </small>
          </span>
          <ChevronRight size={15} />
        </button>
      )}
      {m.artifactId && (
        <button
          className="artifact-message"
          onClick={() => setPanel({ kind: "artifact", id: m.artifactId! })}
        >
          <FileText size={23} />
          <span>
            <strong>
              {data.artifacts.find((a) => a.id === m.artifactId)?.title ||
                "Open artifact"}
            </strong>
            <small>Open and edit this artifact</small>
          </span>
          <ArrowUpRight size={17} />
        </button>
      )}
      {!loading && m.text && (
        <div className="message-actions assistant-actions">
          <IconButton label="Copy response" onClick={() => void copy()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </IconButton>
          <IconButton
            label="Regenerate response"
            disabled={!!activeRun}
            onClick={() => retry(chatId, m.id)}
          >
            <RotateCcw size={15} />
          </IconButton>
          <IconButton
            label="Helpful response"
            className={m.feedback === "up" ? "feedback-selected" : ""}
            onClick={() => feedback("up")}
          >
            <ThumbsUp size={15} />
          </IconButton>
          <IconButton
            label="Unhelpful response"
            className={m.feedback === "down" ? "feedback-selected" : ""}
            onClick={() => feedback("down")}
          >
            <ThumbsDown size={15} />
          </IconButton>
          <Dropdown
            label="Response actions"
            trigger={
              <button
                className="icon-button"
                aria-label="More response actions"
              >
                <MoreHorizontal size={17} />
              </button>
            }
            items={[
              {
                label: "Branch from here",
                icon: <GitBranch size={15} />,
                onSelect: () => branch(chatId, index),
              },
              {
                label: "View research details",
                icon: <Telescope size={15} />,
                disabled: m.mode === "chat",
                onSelect: () =>
                  setPanel({ kind: "research", chatId, messageId: m.id }),
              },
            ]}
          />
          {copied && <span className="copy-label">Copied</span>}
        </div>
      )}
      {m.questions && m.status === "complete" && m.questions.length > 0 && (
        <div className="related-questions">
          <p className="eyebrow">KEEP EXPLORING</p>
          {m.questions.map((q) => (
            <RelatedQuestion key={q} text={q} chatId={chatId} mode={m.mode} />
          ))}
        </div>
      )}
    </article>
  );
}
function RelatedQuestion({
  text,
  chatId,
  mode,
}: {
  text: string;
  chatId: string;
  mode: Mode;
}) {
  const { send, data, activeRun } = useWorkspace();
  return (
    <button
      disabled={!!activeRun}
      onClick={() =>
        send(
          text,
          mode,
          [],
          chatId,
          data.chats.find((c) => c.id === chatId)?.projectId,
        )
      }
    >
      {text}
      <span aria-hidden="true">+</span>
    </button>
  );
}
function ShareButton({ chatId }: { chatId: string }) {
  const { data, exportChat, toast } = useWorkspace();
  const [open, setOpen] = useState(false);
  const chat = data.chats.find((c) => c.id === chatId);
  if (!chat) return null;
  return (
    <>
      <button
        className="quiet-button share-button"
        onClick={() => setOpen(true)}
      >
        <Share2 size={15} />
        Share
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Take this conversation with you"
        description="This workspace is local. Export a copy to share; private browser links won’t work for someone else."
      >
        <div className="share-options">
          <button
            className="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  chat.messages
                    .map(
                      (m) =>
                        `${m.role === "user" ? "You" : "ArcNave"}\n${m.text}`,
                    )
                    .join("\n\n"),
                );
                toast("Conversation copied");
              } catch {
                toast("Clipboard unavailable. Download Markdown instead.");
              }
            }}
          >
            <Copy size={17} />
            Copy conversation
          </button>
          <button className="button primary" onClick={() => exportChat(chat)}>
            <Download size={17} />
            Download Markdown
          </button>
        </div>
      </Modal>
    </>
  );
}
