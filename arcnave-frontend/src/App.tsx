import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  Link,
  Navigate,
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Feather,
  FileText,
  Folder,
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
import {
  CutShortNote,
  DroppedNote,
  FailureCard,
  IncidentBanner,
  InlineEdit,
  ModelLabel,
  StoppedNote,
} from "./ChatStates";
import { SessionProvider, useSession } from "./session";
import { handleAppKeyDown } from "./shortcuts";
import Auth from "./Auth";
import { WelcomeGate } from "./auth/WelcomeGate";
import AppNav, { ChatMenu, SearchDialog } from "./Navigation";
import { AiStateMark, Icon, LivingDots } from "./brand";
import { aiStateForMessage, aiStatusLabel } from "./aiState";
import { answerLang } from "./answerLang";
import { relevantFollowUps } from "./followUps";
import { BrandMark, Dropdown, EmptyState, IconButton, Modal } from "./ui";
import Composer, { AttachmentChip } from "./Composer";
import Settings from "./Settings";
import { PublicLink } from "./ShareLink";
import { ArtifactsPage, ChatsPage, ProjectPage, ProjectsPage } from "./Pages";
import { api } from "./api";
import { downloadAuthenticated, readLocal, writeLocal } from "./storage";
import type { Chat, Message, MessageUsage, Mode, ReasoningEffort, ToolCall } from "./types";
import { extractToolCardData, type DeliverableData, type ImageData } from "./toolCards";
import { DRAWN_TOOLS, cutOffReason } from "./types";
import { GenerativeUIRenderer } from "./generative-ui/GenerativeUIRenderer";
import { VisualDraft } from "./generative-ui/blocks/VisualDraft";
import type { SafeAction } from "./generative-ui/types";
import { AuthenticatedImage, MarkdownErrorBoundary } from "./Content";
import ToolActivity, { ThinkingBlock } from "./ToolActivity";
import QuestionOptions, { extractAskUserInput } from "./QuestionOptions";
import SelectionFloatingButton from "./SelectionFloatingButton";
import { formatCost } from "./formatCost";

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

const SharedPage = lazy(() => import("./SharedPage"));

export default function App() {
  const location = useLocation();
  // A shared link opens without an account (ADR-0039), so it is served before the session gate.
  if (location.pathname.startsWith("/s/"))
    return (
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/s/:token" element={<SharedPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    );
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
  const { pathname } = useLocation();
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
  if (!user) return <Auth initialMode={pathname === "/signup" ? "up" : "in"} />;
  if (pathname === "/login" || pathname === "/signup") return <Navigate to="/app" replace />;
  return (
    <WorkspaceProvider>
      <Shell />
      <WelcomeGate />
    </WorkspaceProvider>
  );
}

/** localStorage key (through storage.ts) for the rail / sidebar choice. */
const NAV_STORAGE_KEY = "sidebar";

/**
 * The app shell, "M2 icon rail" (docs/brand/Final-New, Final-Chat-Light/Dark): a light green
 * canvas holding the rail (or the full sidebar) and one white sheet with the page in it. The
 * rail is the default; "Expand sidebar" opens the full sidebar and the choice is remembered.
 * On a phone the rail is hidden and the sidebar opens as a drawer from the sheet's menu button.
 */
function Shell() {
  const {
    chats,
    projects,
    ready,
    loadError,
    panel,
    setPanel,
    toastText,
    setSearch,
    settings,
    setSettings,
    activeRun,
    messages,
    toast,
  } = useWorkspace();
  const [wide, setWide] = useState(() => readLocal(NAV_STORAGE_KEY) === "expanded"),
    [drawer, setDrawer] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine);
  const navigate = useNavigate(),
    location = useLocation();
  const activeChat = location.pathname.startsWith("/chat/")
    ? chats.find((c) => c.id === location.pathname.split("/")[2])
    : undefined;
  const activeProject = activeChat?.projectId
    ? projects.find((p) => p.id === activeChat.projectId)
    : undefined;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      handleAppKeyDown(e, {
        navigate,
        setPanel,
        setSearch,
        setSettings,
        toast,
        activeChatId: activeChat?.id,
        messages,
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, setPanel, setSearch, setSettings, toast, activeChat?.id, messages]);

  // Settings is a page (S5). The account menu and Ctrl/Cmd + , still ask for it by flag.
  useEffect(() => {
    if (!settings) return;
    setSettings(false);
    navigate("/settings");
  }, [settings, setSettings, navigate]);

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

  const toggleNav = () => {
    const next = !wide;
    writeLocal(NAV_STORAGE_KEY, next ? "expanded" : "collapsed");
    setWide(next);
  };

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
      className={`an-shell ${panel.kind !== "closed" ? "has-panel" : ""}`}
      data-nav={wide ? "wide" : "rail"}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="an-nav-desktop">
        <AppNav
          mode={wide ? "wide" : "rail"}
          onToggle={toggleNav}
          onNavigate={() => setDrawer(false)}
        />
      </div>
      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="drawer-overlay" />
          <Dialog.Content className="an-drawer" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <AppNav
              mode="drawer"
              onToggle={() => setDrawer(false)}
              onNavigate={() => setDrawer(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <main className="an-sheet" id="main-content">
        <IncidentBanner />
        <header
          className={`an-topbar ${activeChat ? "an-topbar-chat" : "an-topbar-idle"}`}
        >
          <IconButton
            className="an-mobile-menu"
            label="Open navigation"
            onClick={() => setDrawer(true)}
          >
            <Menu size={20} />
          </IconButton>
          {activeChat ? (
            <>
              <ChatTitle chat={activeChat} />
              {activeChat.projectId && (
                <Link className="an-pchip" to={`/project/${activeChat.projectId}`}>
                  <Icon icon={Folder} size={14} />
                  <span>{activeProject?.title ?? "Project"}</span>
                </Link>
              )}
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
          <Route path="/app" element={<Home />} />
          <Route path="/chat/:id" element={<Conversation />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="*"
            element={
              <EmptyState
                icon={<MessageCircle />}
                title="A fresh start?"
                description="That page is not in this workspace."
                action={
                  <Link className="button" to="/app">
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
      <SearchDialog />
      <SelectionFloatingButton />
      {toastText && (
        <div className="toast" role="status">
          <Check size={16} />
          {toastText}
        </div>
      )}
    </div>
  );
}

/**
 * The chat's title in the sheet's header (S6-Chat): a button that opens the chat menu, and
 * Rename turns it into a field in place. Enter saves, Esc cancels. The title ArcNave wrote stays
 * until the person changes it.
 */
function ChatTitle({ chat }: { chat: Chat }) {
  const { renameChat } = useWorkspace();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(chat.title);
  if (renaming)
    return (
      <form
        className="cs-rename"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== chat.title) renameChat(chat.id, name);
          setRenaming(false);
        }}
      >
        <input
          autoFocus
          aria-label="Conversation title"
          value={name}
          maxLength={180}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setRenaming(false);
            }
          }}
        />
        <button type="submit" className="cs-btn cs-primary" disabled={!name.trim()}>
          Save
        </button>
      </form>
    );
  return (
    <ChatMenu
      chat={chat}
      align="start"
      onRename={() => {
        setName(chat.title);
        setRenaming(true);
      }}
      trigger={
        <button className="an-ttl conversation-title cs-title" aria-label={`Actions for ${chat.title}`}>
          <span>{chat.title}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      }
    />
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
      {/* New chat, Final-New: living logo 44 px, greeting, one quiet line, composer K3, chips. */}
      <div className="home">
        <div className="home-intro">
          <span className="home-logo">
            <LivingDots size={44} pad={1.6} mode="none" intro />
          </span>
          <h1>{greeting}</h1>
          <p className="home-sub">What should we finish today?</p>
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
            costInr: row.costInr,
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
  const { chats, messages, transcript, openChat, activeRun, runningChats, reconnecting, reconnect, send, versionAnchor } =
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
  const isRunning = !!id && (runningChats ?? (activeRun ? [activeRun] : [])).includes(id);
  const activeUserId = isRunning
    ? [...history].reverse().find((message) => message.role === "user")?.id
    : undefined;

  useEffect(() => {
    if (id) openChat(id);
  }, [id, openChat]);
  useLayoutEffect(() => {
    // After a version switch the prompt stays where it was on screen (ADR-0038).
    if (versionAnchor && versionAnchor.chatId === id) {
      const row = scroll.current?.querySelector(`.user-message[data-seq="${versionAnchor.seq}"]`);
      if (row && scroll.current) {
        scroll.current.scrollTop += row.getBoundingClientRect().top - versionAnchor.offset;
        const el = scroll.current;
        setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
        return;
      }
    }
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
    // get a one-shot turn anchor without tying scroll state to token rendering.
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
          <Link className="button" to="/app">
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
        {/* Messages M1 (Final-Chat-Light/Dark): one 760 px column, 26 px between turns. The
            project this chat belongs to is the chip in the sheet's header. */}
        <div className="messages" ref={messageList}>
          {history.map((m) => (
            <MessageView
              key={m.id}
              message={m}
              chatId={chat?.id ?? id!}
              usage={m.usage ?? usage[m.id]}
              turnAnchorRef={m.id === activeUserId ? activeTurn : undefined}
              latest={m.id === last?.id}
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
      {id && reconnecting?.[id] && (
        <div className="reconnect-banner" role="status">
          <Loader2 size={14} className="spin" />
          Reconnecting…
          <button type="button" onClick={() => reconnect(id)}>
            Retry
          </button>
        </div>
      )}
      <div className="conversation-composer">
        {!isRunning && extractAskUserInput(last) && (
          <QuestionOptions
            data={extractAskUserInput(last)!}
            disabled={isRunning}
            onSubmit={(replyText) =>
              void send(
                replyText,
                last?.mode ?? "chat",
                [],
                chat?.id ?? id!,
                chat?.projectId ?? undefined,
              )
            }
          />
        )}
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
  bash_tool: { running: "Running a command", complete: "Command finished" },
  present_files: { running: "Preparing files", complete: "Files ready" },
  image_search: { running: "Finding images", complete: "Images found" },
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
  create_file: { running: "Writing a file", complete: "File written" },
  str_replace: { running: "Editing a file", complete: "File edited" },
  view: { running: "Reading", complete: "Read" },
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

/**
 * The status row of a reply (Final-Chat-Light, R14-Chat): the 32 px logo in the AI state the
 * turn is in, then what it is doing. The state comes from the turn's existing events (the
 * mapping is in aiState.ts); the words are the running step when one is named (a tool call or
 * a research stage, with the labels this row has always used), else the state's own name.
 * It shows while the reply works, and on the latest reply when it is waiting for the user.
 */
function AiStatusRow({ message: m }: { message: Message }) {
  const state = aiStateForMessage(m);
  if (!state) return null;
  const working = m.status === "submitting" || m.status === "generating";
  const tool = working
    ? [...(m.toolCalls ?? [])]
        .reverse()
        .find((call) => call.ok === undefined && !DRAWN_TOOLS.has(call.name))
    : undefined;
  const event = working ? m.events?.at(-1) : undefined;
  const step = tool
    ? toolActivity(tool.name, true)
    : event && event.stage !== "complete" && event.label
      ? event.label
      : undefined;
  return (
    <div className="ai-status-row" data-state={state}>
      <AiStateMark state={state} size={32} decorative />
      <span className="ai-status" role="status" aria-live="polite">
        {aiStatusLabel(state, step)}
      </span>
    </div>
  );
}

function UsageRow({
  usage,
  createdAt,
  effort,
}: {
  usage: MessageUsage;
  createdAt?: string | null;
  effort?: ReasoningEffort | null;
}) {
  const formattedDate = createdAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(createdAt))
    : null;
  return (
    <p className="message-usage">
      {formattedDate && <span className="message-date">{formattedDate}</span>}
      {effort && <span>{effort} effort</span>}
      {usage.exact ? (
        <>
          <span>{tokens(usage.inputTokens)} in</span>
          <span>{tokens(usage.outputTokens)} out</span>
          <span>{tokens(usage.totalTokens)} total</span>
          {usage.cacheReadTokens > 0 && (
            <span>{tokens(usage.cacheReadTokens)} cached</span>
          )}
          <span>
            {formatCost(usage.costUsd, usage.costInr) ?? "cost not priced"}
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
  latest = false,
}: {
  message: Message;
  chatId: string;
  usage?: MessageUsage;
  turnAnchorRef?: RefObject<HTMLDivElement | null>;
  /** The newest message of the conversation: only it can be waiting for the user. */
  latest?: boolean;
}) {
  const {
    artifacts,
    setPanel,
    toast,
    retry,
    activeRun,
    runningChats,
    branch,
    switchVersion,
    setEdit,
    feedback,
    saveResponseAsArtifact,
    send,
    edit,
  } = useWorkspace();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const pending = m.id.startsWith("pending-");
  // Only a run in this chat holds its actions back (one controller per chat, ADR-0078).
  const chatRunning = (runningChats ?? (activeRun ? [activeRun] : [])).includes(chatId);
  const loading = m.status === "submitting" || m.status === "generating";
  // R14: the seal stamps "Done" when a reply this tab was watching finishes, then steps aside.
  const wasLoading = useRef(loading);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    const finished = wasLoading.current && !loading && m.status === "complete";
    wasLoading.current = loading;
    if (!finished) return;
    setJustDone(true);
    const timer = setTimeout(() => setJustDone(false), 4000);
    return () => clearTimeout(timer);
  }, [loading, m.status]);
  const continueAnswer = () => send("Continue exactly where you stopped.", m.mode, [], chatId);

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

  const showVersion = (index: number) => {
    const target = m.versions?.chatIds[index];
    if (!target) return;
    // Hold the prompt where it is on screen, so the switch reads as the text changing in place.
    const row = document.querySelector(`.user-message[data-seq="${m.seq}"]`);
    switchVersion(chatId, target, m.seq, row ? row.getBoundingClientRect().top : 0);
  };

  if (m.role === "user")
    return (
      <div className="user-message" ref={turnAnchorRef} data-seq={m.seq}>
        {edit && edit.chatId === chatId && edit.messageId === m.id ? (
          // S6-Chat-States 3: the editor takes the bubble's place; sending makes a new version.
          <InlineEdit
            initial={edit.text}
            onCancel={() => setEdit(null)}
            onSend={(text) => send(text, m.mode, [], chatId)}
          />
        ) : (
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
        )}
        <div className="message-actions user-actions">
          <IconButton label="Copy prompt" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
          <IconButton
            label="Edit prompt"
            disabled={chatRunning || pending}
            onClick={() => setEdit({ chatId, messageId: m.id, text: m.text })}
          >
            <Pencil size={14} />
          </IconButton>
          {m.versions && (
            <div className="version-switcher cs-vers" role="group" aria-label="Versions of this prompt">
              <IconButton
                label="Previous version"
                disabled={chatRunning || m.versions.index === 0}
                onClick={() => showVersion(m.versions!.index - 1)}
              >
                <ChevronLeft size={14} />
              </IconButton>
              <span className="version-count" aria-live="polite">
                {m.versions.index + 1} / {m.versions.chatIds.length}
              </span>
              <IconButton
                label="Next version"
                disabled={chatRunning || m.versions.index === m.versions.chatIds.length - 1}
                onClick={() => showVersion(m.versions!.index + 1)}
              >
                <ChevronRight size={14} />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    );

  const failure = m.status === "error" ? m.error ?? "unknown" : null;
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
      {m.segments && m.segments.length > 0 ? (
        // In order: each stretch of thinking, text and tool steps where it happened.
        m.segments.map((seg, i) => {
          const last = i === m.segments!.length - 1;
          if (seg.type === "ui")
            return <GenerativeUIRenderer key={i} blocks={(m.uiBlocks ?? []).filter((block) => seg.blockIds.includes(block.blockId))} onAction={handleAction} chatId={chatId} />;
          if (seg.type === "thinking")
            return <ThinkingBlock key={i} text={seg.text} live={loading && last} />;
          if (seg.type === "tools") {
            const ids = new Set(seg.toolCallIds);
            const calls = (m.toolCalls ?? []).filter((c) => ids.has(c.toolCallId));
            return <ToolActivity key={i} calls={calls} working={loading && last} answering={false} />;
          }
          return (
            <MarkdownErrorBoundary key={i} fallbackText={seg.text}>
              <Suspense fallback={<p className="markdown">{seg.text}</p>}>
                <Markdown
                  text={seg.text}
                  lang={answerLang(seg.text)}
                  sources={m.sources}
                  isStreaming={loading && last}
                  onCitation={(selected) =>
                    setPanel({ kind: "sources", chatId, messageId: m.id, selected })
                  }
                />
              </Suspense>
            </MarkdownErrorBoundary>
          );
        })
      ) : (
        <>
          {m.thinking && <ThinkingBlock text={m.thinking} live={loading && !m.text} />}
          {m.toolCalls && m.toolCalls.length > 0 && (
            <ToolActivity calls={m.toolCalls} working={loading} answering={!!m.text} />
          )}
          {m.text && (
            <MarkdownErrorBoundary fallbackText={m.text}>
              <Suspense fallback={<p className="markdown">{m.text}</p>}>
                <Markdown
                  text={m.text}
                  lang={answerLang(m.text)}
                  sources={m.sources}
                  isStreaming={loading}
                  onCitation={(selected) =>
                    setPanel({ kind: "sources", chatId, messageId: m.id, selected })
                  }
                />
              </Suspense>
            </MarkdownErrorBoundary>
          )}
        </>
      )}
      {m.uiBlocks && m.uiBlocks.length > 0 && (
        <GenerativeUIRenderer blocks={m.uiBlocks.filter((block) => !m.segments?.some((segment) => segment.type === "ui" && segment.blockIds.includes(block.blockId)))} onAction={handleAction} chatId={chatId} />
      )}
      {m.status === "generating" && m.visualDrafts?.map((d) => <VisualDraft key={d.id} draft={d} />)}
      {(() => {
        if (!m.toolCalls?.length) return null;
        const { deliverables, images, webImages } = extractToolCardData(m.toolCalls);
        if (!deliverables.length && !images.length && !webImages.length) return null;
        return (
          <div className="message-deliverable-tray">
            {webImages.length > 0 && (
              <div className="web-image-strip">
                {webImages.map((img) => (
                  <a key={img.imageUrl} href={img.sourceUrl} target="_blank" rel="noopener noreferrer" title={img.title}>
                    <img src={img.thumbnailUrl} alt={img.title} loading="lazy" referrerPolicy="no-referrer" />
                  </a>
                ))}
              </div>
            )}
            {images.map((img) => (
              <ImageCard key={img.attachmentId} item={img} />
            ))}
            {deliverables.map((del) => (
              <DeliverableCard key={del.attachmentId} item={del} />
            ))}
          </div>
        );
      })()}
      {(loading || justDone || (latest && !pending && aiStateForMessage(m) === "needs-input")) && (
        <AiStatusRow message={m} />
      )}
      <div className="generation-status" role="status" aria-live="polite">
        {m.status === "stopped" && (
          <StoppedNote
            onContinue={continueAnswer}
            onRegenerate={() => retry(chatId, m.id)}
            disabled={chatRunning || pending}
          />
        )}
        {m.status === "complete" && (
          <CutShortNote
            finishReason={m.finishReason}
            onContinue={continueAnswer}
            disabled={chatRunning}
          />
        )}
      </div>
      {failure && m.error === "network" && m.text.trim() ? (
        <DroppedNote onContinue={continueAnswer} disabled={chatRunning || pending} />
      ) : failure ? (
        <FailureCard
          code={m.error}
          title={m.errorTitle}
          detail={m.errorDetail}
          onRetry={() => retry(chatId, m.id)}
          retryDisabled={chatRunning || pending}
          onOpenLimits={() => navigate("/settings?section=usage")}
          supportCode={m.requestId ?? m.id.slice(0, 8)}
        />
      ) : null}
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
                <MarkdownErrorBoundary fallbackText={block.code}>
                  <Suspense fallback={<pre>{block.code}</pre>}>
                    <Markdown text={"```" + (block.language ?? "") + "\n" + block.code + "\n```"} />
                  </Suspense>
                </MarkdownErrorBoundary>
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
            disabled={chatRunning}
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
          <TurnLogButton chatId={chatId} messageId={m.id} />
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
          <ModelLabel modelAlias={m.modelAlias} effort={m.effort} fallbackFrom={m.fallbackFrom} fallbackReason={m.fallbackReason} />
        </div>
      )}
      {!loading && !m.text && !pending && (m.status === "error" || m.status === "stopped") && (
        <div className="message-actions assistant-actions">
          <TurnLogButton chatId={chatId} messageId={m.id} />
        </div>
      )}
      {usage && !loading && (
        <UsageRow usage={usage} createdAt={m.createdAt} effort={m.effort} />
      )}
      {m.status === "complete" && relevantFollowUps(m.questions).length > 0 && (
        <div className="related-questions">
          <p className="eyebrow">KEEP EXPLORING</p>
          {relevantFollowUps(m.questions).map((q) => (
            <RelatedQuestion key={q} text={q} chatId={chatId} mode={m.mode} />
          ))}
        </div>
      )}
    </article>
  );
}

function DeliverableCard({ item }: { item: DeliverableData }) {
  const { setPanel } = useWorkspace();
  const formatUpper = (item.format || "FILE").toUpperCase();

  return (
    <div className="deliverable-card" role="region" aria-label={`Deliverable: ${item.filename}`}>
      {/* Opening a created file shows it before it is downloaded (WP-11). */}
      <button
        type="button"
        className="deliverable-card-open"
        title={`Preview ${item.filename}`}
        onClick={() =>
          setPanel({
            kind: "file",
            file: {
              id: item.attachmentId,
              name: item.filename,
              size: item.sizeBytes,
              type: item.mimeType,
              status: "ready",
              downloadUrl: api.files.downloadUrl(item.attachmentId),
            },
          })
        }
      >
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
      </button>
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

/** Downloads what this reply sent and did (ADR-0050), so it is read rather than guessed. */
function TurnLogButton({ chatId, messageId }: { chatId: string; messageId: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <IconButton
      label={failed ? "No turn log for this reply" : "Download turn log"}
      onClick={() => {
        setFailed(false);
        void downloadAuthenticated(api.chats.logUrl(chatId, messageId), `turn-log-${messageId}.txt`).catch(() => setFailed(true));
      }}
    >
      {failed ? <TriangleAlert size={15} /> : <FileText size={15} />}
    </IconButton>
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
        title="Share this conversation"
        description="A link shows a snapshot of the chat as it is now. Messages you send later stay private until you update it."
      >
        {open && <PublicLink target={{ type: "chat", id: chatId }} />}
        <p className="share-divider">Or keep a copy</p>
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
          <button className="button" onClick={() => exportChat(chat)}>
            <Download size={17} />
            Download Markdown
          </button>
        </div>
      </Modal>
    </>
  );
}
