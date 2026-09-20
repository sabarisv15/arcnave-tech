import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
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
  PanelsTopLeft,
  Pencil,
  RotateCcw,
  Share2,
  Telescope,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  X,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import { SessionProvider, useSession } from "./session";
import Auth from "./Auth";
import Sidebar, { ChatMenu, SearchDialog } from "./Navigation";
import { BrandMark, Dropdown, EmptyState, IconButton, Modal } from "./ui";
import Composer, { AttachmentChip } from "./Composer";
import Settings from "./Settings";
import { ArtifactsPage, ChatsPage, ProjectPage, ProjectsPage } from "./Pages";
import { api, describeError } from "./api";
import { readLocal, writeLocal } from "./storage";
import type { Message, MessageUsage, Mode, ToolCall } from "./types";
import { GenerativeUIRenderer } from "./generative-ui/GenerativeUIRenderer";
import type { SafeAction } from "./generative-ui/types";

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
          <p>Your work is saved on the server and will still be here.</p>
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
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </ErrorBoundary>
  );
}

/** Nothing below this point renders without a session, so nothing below it has to check. */
function Gate() {
  const { user, loading } = useSession();
  if (loading)
    return (
      <div className="boot-screen">
        <BrandMark />
        <p className="loading-line">
          <Loader2 size={16} className="spin" />
          Opening your workspace…
        </p>
      </div>
    );
  if (!user) return <Auth />;
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}

function Shell() {
  const {
    chats,
    ready,
    loadError,
    panel,
    setPanel,
    toastText,
    setSearch,
    setSettings,
    activeRun,
  } = useWorkspace();
  const [collapsed, setCollapsed] = useState(
      () => readLocal("sidebar") === "collapsed",
    ),
    [drawer, setDrawer] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine);
  const navigate = useNavigate(),
    location = useLocation();
  const activeChat = location.pathname.startsWith("/chat/")
    ? chats.find((c) => c.id === location.pathname.split("/")[2])
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

  const collapse = () =>
    setCollapsed((c) => {
      writeLocal("sidebar", c ? "expanded" : "collapsed");
      return !c;
    });

  if (!ready)
    return (
      <div className="boot-screen">
        <BrandMark />
        <p className="loading-line">
          <Loader2 size={16} className="spin" />
          Loading your conversations…
        </p>
      </div>
    );

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
        {loadError && (
          <div className="offline-banner" role="alert">
            <TriangleAlert size={15} />
            {loadError}
          </div>
        )}
        {offline && (
          <div className="offline-banner" role="status">
            <TriangleAlert size={15} />
            You’re offline. ArcNave needs a connection to answer.
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
  const { preferences } = useWorkspace();
  const { models } = useSession();
  const [suggestion, setSuggestion] = useState(""),
    [mode, setMode] = useState<Mode>(preferences.defaultMode);
  const grounded = models?.capabilities.groundedSearch ?? true;
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
            disabled={!grounded}
            aria-label={
              grounded
                ? "Explore a topic"
                : `Explore a topic unavailable: ${models?.capabilities.detail ?? "Search is unavailable"}`
            }
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
        {models && !models.auto.available
          ? models.auto.detail
          : "ArcNave can make mistakes. Check anything that matters."}
      </footer>
    </>
  );
}

/**
 * Per-message token accounting.
 *
 * The transcript deliberately returns `usage: null` to stay small, so it is fetched here and
 * only while a conversation is actually on screen. It refreshes when a run finishes, because
 * that is the only thing that adds a row.
 */
function useMessageUsage(chatId: string | undefined, activeRun: string | null) {
  const [usage, setUsage] = useState<Record<string, MessageUsage>>({});
  useEffect(() => {
    if (!chatId || activeRun === chatId) return;
    let live = true;
    api.usage
      .messages(chatId)
      .then((result) => {
        if (!live) return;
        const map: Record<string, MessageUsage> = {};
        for (const row of result.items)
          map[row.messageId] = {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            totalTokens: row.totalTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheWriteTokens: row.cacheWriteTokens,
            exact: row.exact,
            costUsd: row.costUsd,
          };
        setUsage(map);
      })
      .catch(() => {
        // Usage is supplementary; failing to read it must not disturb the transcript.
      });
    return () => {
      live = false;
    };
  }, [chatId, activeRun]);
  return usage;
}

function Conversation() {
  const { id } = useParams();
  const { chats, projects, messages, transcript, openChat, activeRun } =
    useWorkspace();
  const chat = chats.find((c) => c.id === id);
  const state = id ? transcript[id] : undefined;
  const history = (id && messages[id]) || [];
  const usage = useMessageUsage(id, activeRun);
  const scroll = useRef<HTMLDivElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    activeTurn = useRef<HTMLDivElement>(null),
    anchoredTurn = useRef<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const isRunning = activeRun === id;
  const activeUserId = isRunning
    ? [...history].reverse().find((message) => message.role === "user")?.id
    : undefined;

  useEffect(() => {
    if (id) openChat(id);
  }, [id, openChat]);
  useEffect(() => {
    if (!isRunning) {
      setNearBottom(true);
      bottom.current?.scrollIntoView();
    }
  }, [id]);
  const last = history.at(-1);
  useEffect(() => {
    if (!isRunning && nearBottom)
      bottom.current?.scrollIntoView({ block: "end" });
  }, [last?.text, last?.status, nearBottom, isRunning]);
  useLayoutEffect(() => {
    if (!isRunning) {
      anchoredTurn.current = null;
      return;
    }
    if (!activeUserId || anchoredTurn.current === activeUserId) return;

    anchoredTurn.current = activeUserId;
    setNearBottom(false);
    const frame = window.requestAnimationFrame(() => {
      activeTurn.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeUserId, isRunning]);

  if (state === "loading" && !history.length)
    return (
      <div className="panel-scroll loading-line">
        <Loader2 className="spin" size={16} />
        Loading this conversation…
      </div>
    );
  if (state === "missing" || (!chat && state === "failed"))
    return (
      <EmptyState
        icon={<MessageCircle />}
        title="Conversation not found"
        description="It may have been deleted, or it belongs to another account."
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
        <div className={`messages ${isRunning ? "has-active-turn" : ""}`}>
          {chat?.projectId && (
            <Link
              className="conversation-project"
              to={`/project/${chat.projectId}`}
            >
              {projects.find((p) => p.id === chat.projectId)?.title ??
                "Project"}
              <ChevronRight size={13} />
            </Link>
          )}
          {history.map((m) => (
            <MessageView
              key={m.id}
              message={m}
              chatId={chat?.id ?? id!}
              usage={m.usage ?? usage[m.id]}
              turnAnchorRef={m.id === activeUserId ? activeTurn : undefined}
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
          key={id}
          chatId={id!}
          projectId={chat?.projectId ?? undefined}
          initialMode={history.at(-1)?.mode}
          compact
        />
      </div>
    </div>
  );
}

const tokens = (value: number) => value.toLocaleString();

function UsageRow({ usage, createdAt }: { usage: MessageUsage; createdAt?: string | null }) {
  const formattedDate = createdAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(createdAt))
    : null;
  return (
    <p className="message-usage">
      {formattedDate && <span className="message-date">{formattedDate}</span>}
      {usage.exact ? (
        <>
          <span>{tokens(usage.inputTokens)} in</span>
          <span>{tokens(usage.outputTokens)} out</span>
          <span>{tokens(usage.totalTokens)} total</span>
          {usage.cacheReadTokens > 0 && (
            <span>{tokens(usage.cacheReadTokens)} cached</span>
          )}
          <span>
            {usage.costUsd === null
              ? "cost not priced"
              : `$${usage.costUsd.toFixed(4)}`}
          </span>
        </>
      ) : (
        <span>The provider reported no token counts for this response.</span>
      )}
    </p>
  );
}

function MessageView({
  message: m,
  chatId,
  usage,
  turnAnchorRef,
}: {
  message: Message;
  chatId: string;
  usage?: MessageUsage;
  turnAnchorRef?: RefObject<HTMLDivElement | null>;
}) {
  const {
    artifacts,
    setPanel,
    toast,
    retry,
    activeRun,
    branch,
    setEdit,
    feedback,
    saveResponseAsArtifact,
    send,
  } = useWorkspace();
  const [copied, setCopied] = useState(false);
  const pending = m.id.startsWith("pending-");
  const loading = m.status === "submitting" || m.status === "generating";
  const [thinkingSeconds, setThinkingSeconds] = useState(1);

  useEffect(() => {
    if (!loading) {
      setThinkingSeconds(1);
      return;
    }
    const startedAt = Date.now();
    const updateTimer = () =>
      setThinkingSeconds(
        Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
      );
    const timer = window.setInterval(updateTimer, 500);
    return () => window.clearInterval(timer);
  }, [loading, m.id]);

  const handleAction = (action: SafeAction) => {
    switch (action.actionType) {
      case "open_artifact":
        setPanel({ kind: "artifact", id: action.artifactId });
        break;
      case "view_source": {
        const idx = parseInt(action.sourceRef, 10);
        setPanel({
          kind: "sources",
          chatId,
          messageId: m.id,
          selected: Number.isFinite(idx) ? idx : 0,
        });
        break;
      }
      case "filter_view":
        send(`Filter: ${action.filterKey} = ${String(action.filterValue)}`, m.mode, [], chatId);
        break;
    }
  };

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

  if (m.role === "user")
    return (
      <div
        className={`user-message ${turnAnchorRef ? "turn-anchor" : ""}`}
        ref={turnAnchorRef}
      >
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
            disabled={!!activeRun || pending}
            onClick={() => setEdit({ chatId, messageId: m.id, text: m.text })}
          >
            <Pencil size={14} />
          </IconButton>
        </div>
      </div>
    );

  const failure = m.status === "error" ? describeError(m.error) : null;
  return (
    <article
      className={`assistant-message ${loading ? "is-generating" : ""}`}
      aria-label="ArcNave response"
    >
      {m.mode !== "chat" && (
        <div className="response-meta">
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
                  ? "Working"
                  : m.mode === "research"
                    ? "Research details"
                    : "Search details"}
            <ChevronRight size={12} />
          </button>
        </div>
      )}
      {loading && !m.text && (
        <div className="response-wait" role="status" aria-live="polite">
          <span className="response-wait-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>Thinking</span>
          <time>{thinkingSeconds}s</time>
        </div>
      )}
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
      {m.uiBlocks && m.uiBlocks.length > 0 && (
        <GenerativeUIRenderer blocks={m.uiBlocks} onAction={handleAction} />
      )}
      {m.toolCalls && m.toolCalls.length > 0 && (
        <ToolCallList calls={m.toolCalls} />
      )}
      <div className="generation-status" role="status" aria-live="polite">
        {m.status === "stopped" && (
          <span className="stopped-label">
            Response stopped
            <button onClick={() => retry(chatId, m.id)}>Regenerate</button>
          </span>
        )}
      </div>
      {failure && (
        <div className="error-card" role="alert">
          <TriangleAlert size={19} />
          <div>
            <strong>{m.errorTitle || failure.title}</strong>
            <p>{m.errorDetail || failure.detail}</p>
            <button
              className="button"
              onClick={() => retry(chatId, m.id)}
              disabled={!!activeRun || pending}
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
            <strong>
              {m.sources.length} source{m.sources.length === 1 ? "" : "s"}
            </strong>
            <small>
              {[...new Set(m.sources.map((s) => s.domain))].join(" · ")}
            </small>
          </span>
          <ChevronRight size={15} />
        </button>
      )}
      {m.codeBlocks && m.codeBlocks.length > 0 && (
        <div className="ran-code">
          {m.codeBlocks.map((block, i) => (
            <details key={i} className="ran-code-block">
              <summary>Ran code{block.language ? ` (${block.language})` : ""}</summary>
              {block.code && (
                <Suspense fallback={<pre>{block.code}</pre>}>
                  <Markdown text={"```" + (block.language ?? "") + "\n" + block.code + "\n```"} />
                </Suspense>
              )}
              {block.output && (
                <pre className="ran-code-output">{block.output}</pre>
              )}
            </details>
          ))}
        </div>
      )}
      {m.artifactId && (
        <button
          className="artifact-message"
          onClick={() => setPanel({ kind: "artifact", id: m.artifactId! })}
        >
          <FileText size={23} />
          <span>
            <strong>
              {artifacts.find((a) => a.id === m.artifactId)?.title ||
                "Open artifact"}
            </strong>
            <small>Open and edit this artifact</small>
          </span>
          <ArrowUpRight size={17} />
        </button>
      )}
      {!loading && m.text && !pending && (
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
            onClick={() =>
              feedback(chatId, m.id, m.feedback === "up" ? null : "up")
            }
          >
            <ThumbsUp size={15} />
          </IconButton>
          <IconButton
            label="Unhelpful response"
            className={m.feedback === "down" ? "feedback-selected" : ""}
            onClick={() =>
              feedback(chatId, m.id, m.feedback === "down" ? null : "down")
            }
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
                onSelect: () => branch(chatId, m.id),
              },
              {
                label: "Save as artifact",
                icon: <PanelsTopLeft size={15} />,
                onSelect: () => saveResponseAsArtifact(chatId, m.id),
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
      {usage && !loading && <UsageRow usage={usage} createdAt={m.createdAt} />}
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

/**
 * The `tool_use`/`tool_result` frames the backend streams for item 9's tool-calling loop —
 * previously invisible in the UI even though the backend ran them end to end. A call is
 * "running" once its `tool_use` frame arrives and has no `ok` yet; the matching `tool_result`
 * fills in `ok` and either a live wire `preview` or, after a reload, the full persisted
 * `content`.
 */
function ToolCallList({ calls }: { calls: ToolCall[] }) {
  const visibleCalls = calls.filter((c) => c.name !== "render_ui");
  if (visibleCalls.length === 0) return null;
  return (
    <div className="tool-call-list">
      {visibleCalls.map((call, i) => (
        <ToolCallRow key={`${call.toolCallId}-${i}`} call={call} />
      ))}
    </div>
  );
}

function ToolCallRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const running = call.ok === undefined;
  const detail =
    call.content
      ?.map((c) => (c.type === "text" ? c.text : JSON.stringify(c.data)))
      .join("\n") ??
    call.preview ??
    "";

  return (
    <div className={`tool-call-row ${call.ok === false ? "tool-call-failed" : ""}`}>
      <button
        className="tool-call-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {running ? (
          <Loader2 size={14} className="spin" />
        ) : call.ok ? (
          <Terminal size={14} />
        ) : (
          <X size={14} />
        )}
        <code>{call.name}</code>
        <span className="tool-call-status">
          {running ? "Running…" : call.ok ? "Done" : "Failed"}
        </span>
        <ChevronRight
          size={13}
          className={open ? "tool-call-chevron open" : "tool-call-chevron"}
        />
      </button>
      {open && (
        <div className="tool-call-detail">
          {call.input !== undefined && (
            <pre>{JSON.stringify(call.input, null, 2)}</pre>
          )}
          {detail && <pre>{detail}</pre>}
        </div>
      )}
    </div>
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
  const { send, chats, activeRun } = useWorkspace();
  return (
    <button
      disabled={!!activeRun}
      onClick={() =>
        send(
          text,
          mode,
          [],
          chatId,
          chats.find((c) => c.id === chatId)?.projectId ?? undefined,
        )
      }
    >
      {text}
      <span aria-hidden="true">+</span>
    </button>
  );
}

function ShareButton({ chatId }: { chatId: string }) {
  const { chats, messages, exportChat, toast } = useWorkspace();
  const [open, setOpen] = useState(false);
  const chat = chats.find((c) => c.id === chatId);
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
        description="Conversations are private to your account. Export a copy to share one."
      >
        <div className="share-options">
          <button
            className="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  (messages[chatId] ?? [])
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
