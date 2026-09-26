import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
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
import { downloadAuthenticated, readLocal, writeLocal } from "./storage";
import type { Message, MessageUsage, Mode, ToolCall } from "./types";
import { cutOffReason } from "./types";
import { GenerativeUIRenderer } from "./generative-ui/GenerativeUIRenderer";
import type { SafeAction } from "./generative-ui/types";
import { AuthenticatedImage } from "./Content";
import ToolActivity, { ThinkingBlock } from "./ToolActivity";

const ContextPanel = lazy(() => import("./Panels"));
const Markdown = lazy(() =>
  import("./Content").then((module) => ({ default: module.Markdown })),
);

class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; error?: Error }
> {
  state: { failed: boolean; error?: Error } = { failed: false };
  static getDerivedStateFromError(error: Error) {
    return { failed: true, error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error("ErrorBoundary caught render error:", error, info);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="fatal-error">
          <h1>This view could not load.</h1>
          <p>Your work is saved on the server and will still be here.</p>
          {this.state.error?.message && (
            <p style={{ color: "var(--danger, #e03131)", fontSize: "13px", marginTop: "8px" }}>
              {this.state.error.message}
            </p>
          )}
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
  const { models, user } = useSession();
  const [suggestion, setSuggestion] = useState(""),
    [mode, setMode] = useState<Mode>(preferences.defaultMode),
    [greeting] = useState(() => {
      const name = user?.name.trim().split(/\s+/)[0];
      const greetings = name
        ? [
            `What are we working on, ${name}?`,
            `Where should we begin, ${name}?`,
            `What is on your mind, ${name}?`,
            `Ready when you are, ${name}.`,
            `What shall we explore, ${name}?`,
          ]
        : [
            "What are we working on?",
            "Where should we begin?",
            "What is on your mind?",
            "Ready when you are.",
            "What shall we explore?",
          ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    });
  const grounded = models?.capabilities.groundedSearch ?? true;
  return (
    <>
      <div className="home">
        <div className="home-intro">
          <BrandMark />
          <p className="eyebrow">A LITTLE ROOM TO THINK</p>
          <h1>{greeting}</h1>
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
    messageList = useRef<HTMLDivElement>(null),
    activeTurn = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (!isRunning) return;
    const el = scroll.current;
    if (el)
      setNearBottom(
        el.scrollHeight - el.scrollTop - el.clientHeight < 120,
      );
  }, [last?.text, isRunning]);
  useEffect(() => {
    const list = messageList.current;
    if (!isRunning || !activeUserId) {
      list?.style.removeProperty("padding-bottom");
      return;
    }

    const scroller = scroll.current;
    const anchor = activeTurn.current;
    if (!list || !scroller || !anchor) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const roomBelow = scrollerRect.bottom - anchorRect.bottom;

    // Short turns stay in place when there is already useful reading room. Long conversations
    // get a one-shot Claude-style turn anchor without tying scroll state to token rendering.
    if (
      anchorRect.top >= scrollerRect.top &&
      anchorRect.bottom <= scrollerRect.bottom &&
      roomBelow >= 260
    )
      return;

    list.style.paddingBottom = `${Math.max(320, scroller.clientHeight - 180)}px`;
    setNearBottom(false);
    const frame = window.requestAnimationFrame(() => {
      anchor.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      list.style.removeProperty("padding-bottom");
    };
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
        <div className="messages" ref={messageList}>
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

const toolActivityLabels: Record<string, { running: string; complete: string }> = {
  run_python: { running: "Running a calculation", complete: "Calculation finished" },
  search_project_files: {
    running: "Searching project files",
    complete: "Project search finished",
  },
  read_project_file: {
    running: "Reading a project file",
    complete: "Project file read",
  },
  search_skills: { running: "Finding the right workflow", complete: "Workflow found" },
  read_skill: { running: "Loading workflow guidance", complete: "Workflow loaded" },
  create_artifact: { running: "Creating the artifact", complete: "Artifact created" },
  read_artifact: { running: "Reading the artifact", complete: "Artifact read" },
  update_artifact: { running: "Updating the artifact", complete: "Artifact updated" },
  web_search: { running: "Searching the web", complete: "Web search finished" },
  generate_image: { running: "Generating image", complete: "Image generated" },
  generate_deliverable: { running: "Compiling file deliverable", complete: "File ready" },
};

function toolActivity(name: string, running: boolean) {
  const known = toolActivityLabels[name];
  if (known) return running ? known.running : known.complete;
  const readable = name.replaceAll("_", " ");
  return running ? `Using ${readable}` : `Finished ${readable}`;
}

function ResponseActivity({ message: m }: { message: Message }) {
  const [seconds, setSeconds] = useState(1);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000))),
      500,
    );
    return () => window.clearInterval(timer);
  }, [m.id]);

  const latestResearchEvent = m.events?.at(-1);
  const activeTool = [...(m.toolCalls ?? [])]
    .reverse()
    .find((call) => call.ok === undefined && call.name !== "render_ui");
  const latestTool = [...(m.toolCalls ?? [])]
    .reverse()
    .find((call) => call.name !== "render_ui");
  const activity = activeTool
    ? { label: toolActivity(activeTool.name, true), detail: "Tool is running" }
    : latestResearchEvent && latestResearchEvent.stage !== "complete"
      ? { label: latestResearchEvent.label || "Researching", detail: latestResearchEvent.detail }
      : latestTool
        ? { label: toolActivity(latestTool.name, false), detail: "Reviewing the result" }
        : m.status === "submitting"
          ? { label: "Sending request", detail: "Connecting to the model" }
          : { label: "Thinking", detail: "The model is working on your request" };

  return (
    <div className="response-wait" role="status" aria-live="polite">
      <span className="response-wait-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span className="response-wait-copy">
        <span>{activity.label}</span>
        <small>{activity.detail}</small>
      </span>
      <time>{seconds}s</time>
    </div>
  );
}

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
      <div className="user-message" ref={turnAnchorRef}>
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

  const loading = m.status === "submitting" || m.status === "generating";
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
      {m.thinking && <ThinkingBlock text={m.thinking} working={loading} answering={!!m.text} />}
      {loading && !m.text && !m.thinking && !m.toolCalls?.some((c) => c.name !== "render_ui") && (
        <ResponseActivity message={m} />
      )}
      {m.toolCalls && m.toolCalls.length > 0 && (
        <ToolActivity calls={m.toolCalls} working={loading} answering={!!m.text} />
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
      {(() => {
        if (!m.toolCalls?.length) return null;
        const { deliverables, images } = extractToolCardData(m.toolCalls);
        if (!deliverables.length && !images.length) return null;
        return (
          <div className="message-deliverable-tray">
            {images.map((img) => (
              <ImageCard key={img.attachmentId} item={img} />
            ))}
            {deliverables.map((del) => (
              <DeliverableCard key={del.attachmentId} item={del} />
            ))}
          </div>
        );
      })()}
      <div className="generation-status" role="status" aria-live="polite">
        {m.status === "stopped" && (
          <span className="stopped-label">
            Response stopped
            <button onClick={() => retry(chatId, m.id)}>Regenerate</button>
          </span>
        )}
        {m.status === "complete" && cutOffReason(m.finishReason) && (
          <span className="stopped-label">
            {cutOffReason(m.finishReason) === "output_limit"
              ? "Answer cut off: it reached the output limit"
              : "Answer cut off: it used every tool step this turn allows"}
            <button
              disabled={!!activeRun}
              onClick={() => send("Continue exactly where you stopped.", m.mode, [], chatId)}
            >
              Continue
            </button>
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

interface DeliverableData {
  attachmentId: string;
  filename: string;
  format: string;
  mimeType: string;
  downloadUrl: string;
  sizeBytes: number;
  title?: string;
  artifactId?: string;
}

interface ImageData {
  attachmentId: string;
  filename: string;
  mimeType: string;
  downloadUrl: string;
  prompt?: string;
  aspectRatio?: string;
}

function extractToolCardData(calls: ToolCall[]): {
  deliverables: DeliverableData[];
  images: ImageData[];
} {
  const deliverables: DeliverableData[] = [];
  const images: ImageData[] = [];

  for (const c of calls) {
    if (c.ok && c.content) {
      for (const block of c.content) {
        if (block.type === "json" && block.data) {
          const data = block.data as Record<string, any>;
          if (c.name === "generate_deliverable" && data.downloadUrl && data.filename) {
            deliverables.push(data as DeliverableData);
          } else if (c.name === "generate_image" && data.downloadUrl) {
            images.push(data as ImageData);
          } else {
            // Files a tool wrote for the user (run_python's output/, a merged PDF, an edited
            // workbook) get the same card, so the answer text need not repeat their links.
            const files: unknown[] = [
              ...(Array.isArray(data.persistedFiles) ? data.persistedFiles : []),
              ...(Array.isArray(data.files) ? data.files : []),
              ...(data.file ? [data.file] : []),
            ];
            for (const f of files) {
              const file = f as Record<string, any>;
              if (typeof file?.downloadUrl !== "string" || typeof file?.filename !== "string") continue;
              const ext = file.filename.includes(".") ? file.filename.split(".").pop()! : "file";
              deliverables.push({
                attachmentId: String(file.attachmentId ?? file.id ?? file.downloadUrl),
                filename: file.filename,
                format: ext,
                mimeType: String(file.mimeType ?? ""),
                downloadUrl: file.downloadUrl,
                sizeBytes: Number(file.sizeBytes ?? 0),
              });
            }
          }
        }
      }
    }
  }

  return { deliverables, images };
}

function DeliverableCard({ item }: { item: DeliverableData }) {
  const { setPanel } = useWorkspace();
  const formatUpper = (item.format || "FILE").toUpperCase();

  return (
    <div className="deliverable-card" role="region" aria-label={`Deliverable: ${item.filename}`}>
      <div className="deliverable-card-icon">
        <FileText size={24} />
        <span className="deliverable-card-badge">{formatUpper}</span>
      </div>
      <div className="deliverable-card-info">
        <strong className="deliverable-card-title">{item.title || item.filename}</strong>
        <span className="deliverable-card-meta">
          {item.filename} • {Math.round((item.sizeBytes || 0) / 1024)} KB
        </span>
      </div>
      <div className="deliverable-card-actions">
        {item.artifactId && (
          <button
            className="button button-ghost"
            onClick={() => setPanel({ kind: "artifact", id: item.artifactId! })}
            title="Open artifact"
          >
            Artifact
          </button>
        )}
        <button
          type="button"
          className="button button-primary deliverable-download-btn"
          onClick={() => void downloadAuthenticated(item.downloadUrl, item.filename)}
          title={`Download ${item.filename}`}
        >
          <Download size={14} />
          Download
        </button>
      </div>
    </div>
  );
}

function ImageCard({ item }: { item: ImageData }) {
  const filename = item.filename || `${(item.prompt || "image").slice(0, 20).replace(/[^a-zA-Z0-9]/g, "_")}.png`;
  return (
    <div className="tool-image-card">
      <AuthenticatedImage
        src={item.downloadUrl}
        alt={item.prompt || item.filename || "Generated Image"}
      />
      <div className="tool-image-actions" style={{ padding: "8px 0" }}>
        <button
          type="button"
          className="button button-ghost image-download-btn"
          onClick={() => void downloadAuthenticated(item.downloadUrl, filename)}
          title="Download image"
        >
          <Download size={14} />
          Download Image
        </button>
      </div>
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
