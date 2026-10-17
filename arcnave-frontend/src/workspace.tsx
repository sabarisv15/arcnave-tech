/**
 * Workspace state, backed by the API.
 *
 * Everything on screen is server state with a short-lived optimistic layer over it. Three
 * conventions hold throughout:
 *
 * - **Lists are summaries; transcripts are fetched.** `GET /chats` does not carry messages, so
 *   a conversation's transcript is loaded when it is opened and cached in `messages`.
 * - **A streaming turn is optimistic, then reconciled.** Local placeholder rows make the reply
 *   appear immediately; when the stream ends the chat is re-read so ids, sequence numbers, and
 *   persisted status come from the server rather than from what the client guessed.
 * - **Editing a prompt makes a version.** There is no truncate operation, and inventing one by
 *   deleting messages would throw away work. An edit copies the conversation before the edited
 *   turn into another version of the same chat (ADR-0038); the sidebar keeps one row for the
 *   conversation, and `< i/n >` on the prompt switches between versions.
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
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "./api";
import { attach, generate } from "./adapter";
import { useSession } from "./session";
import { applyTheme } from "./session";
import { download, writeLocal } from "./storage";
import type {
  Artifact,
  Attachment,
  Chat,
  Message,
  Mode,
  Preferences,
  Project,
} from "./types";
import {
  toArtifact,
  toChat,
  toMessage,
  toPreferences,
  toProject,
  toResearchEvent,
  toSource,
  toUsage,
} from "./types";
import type { Panel } from "./types";
import { adoptServerId, appendSegment, applyVisualDraft } from "./types";
import { artifactKind } from "./fileArtifacts";

type TranscriptState = "loading" | "ready" | "missing" | "failed";

/**
 * What a run in this tab already knows about a message the server may not have written yet.
 *
 * Stopping closes the socket, so the client resumes the instant the connection drops, while
 * the server is still in its own cleanup writing the final row. A reconcile that lands in that
 * window reads `generating` and would put the spinner back on a response the user has already
 * stopped — the exact stuck-status failure this project has hit before.
 */
interface Settled {
  messageId: string;
  status: Message["status"];
  text: string;
}

interface Context {
  chats: Chat[];
  projects: Project[];
  artifacts: Artifact[];
  preferences: Preferences;
  messages: Record<string, Message[]>;
  transcript: Record<string, TranscriptState>;
  /** False until the first load of chats, projects, artifacts, and preferences settles. */
  ready: boolean;
  loadError: string | null;
  panel: Panel;
  setPanel: Dispatch<SetStateAction<Panel>>;
  toast: (text: string) => void;
  toastText: string;
  settings: boolean;
  setSettings: (value: boolean) => void;
  search: boolean;
  setSearch: (value: boolean) => void;
  /** The chat id of the run this tab started last and is still streaming, or null. */
  activeRun: string | null;
  /** Every chat this tab is streaming a reply for: one controller each (RG6, ADR-0078). */
  runningChats: string[];
  /** Chats whose stream dropped and is reconnecting (N-46 backoff). */
  reconnecting: Record<string, boolean>;
  /** Reattach to a chat's reply now, without waiting for the next backoff step. */
  reconnect: (chatId: string) => void;
  openChat: (id: string) => void;
  send: (
    text: string,
    mode: Mode,
    files: Attachment[],
    chatId?: string,
    projectId?: string,
    artifact?: boolean,
  ) => void;
  retry: (chatId: string, messageId: string) => void;
  /** Stops the reply in `chatId`; without one, the open chat's (else the last started). */
  stop: (chatId?: unknown) => void;
  feedback: (
    chatId: string,
    messageId: string,
    value: "up" | "down" | null,
  ) => void;
  renameChat: (id: string, title: string) => void;
  pinChat: (id: string, pinned: boolean) => void;
  moveChat: (id: string, projectId: string | null) => void;
  deleteChat: (id: string) => void;
  branch: (chatId: string, throughMessageId?: string) => void;
  /** Shows another version of a conversation, keeping the prompt at `seq` where it was. */
  switchVersion: (fromChatId: string, toChatId: string, seq: number, offset: number) => void;
  /** Where to hold the prompt after a version switch; the conversation view consumes it. */
  versionAnchor: { chatId: string; seq: number; offset: number } | null;
  exportChat: (chat: Chat) => void;
  saveResponseAsArtifact: (chatId: string, messageId: string) => void;
  /** Keeps a visual from a reply as an artifact (ADR-0035): `svg` for an SVG root, else `webpage`. */
  saveVisualAsArtifact: (visual: { title: string; html: string; kind: "svg" | "webpage"; chatId?: string }) => void;
  updatePreferences: (patch: Partial<Preferences>) => void;
  /**
   * Re-read preferences.
   *
   * `PATCH /usage/limits` writes the same row and bumps the same optimistic-concurrency
   * counter, so anything that changes limits has to refresh here or the next preference save
   * will be refused as a conflict.
   */
  refreshPreferences: () => Promise<void>;
  refreshChats: () => Promise<unknown>;
  refreshProjects: () => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  edit: { chatId: string; messageId: string; text: string } | null;
  setEdit: Dispatch<SetStateAction<Context["edit"]>>;
  /** Text for a composer; with `chatId`, only that chat's composer takes it. */
  quote: { text: string; timestamp: number; chatId?: string } | null;
  insertQuote: (text: string, chatId?: string) => void;
  /** Marks the quote with this timestamp as used, so no later composer pastes it again. */
  consumeQuote: (timestamp: number) => void;
  artifactUpdateEvent: { artifactId?: string; timestamp: number } | null;
  /** Set only on a shared snapshot's page, where nothing belongs to the viewer. */
  readOnly?: boolean;
}

const C = createContext<Context>(null!);

/** When the chat list is read again for a generated title (ours: the job takes about a second). */
export const TITLE_REFRESH_DELAYS_MS = [3_000, 10_000] as const;

/**
 * True while the chat still carries the placeholder title the first message gave it (the server
 * writes the prompt's first 80 characters, then the title job replaces it; ADR-0080).
 */
export function needsGeneratedTitle(list: readonly Chat[] | undefined, chatId: string, prompt: string | undefined): boolean {
  if (!list || !prompt) return false;
  return list.find((c) => c.id === chatId)?.title === prompt.slice(0, 80);
}
export const useWorkspace = () => useContext(C);

/**
 * The workspace a shared snapshot's page gives what it renders (ADR-0039): there is no account
 * behind it, so nothing can be saved or sent, and components that offer to hide the offer.
 */
export function ReadOnlyWorkspace({ children, toast }: { children: ReactNode; toast: (text: string) => void }) {
  const value = useMemo(
    () => ({ readOnly: true, toast, saveVisualAsArtifact: () => undefined }) as unknown as Context,
    [toast],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

const defaultPreferences: Preferences = {
  theme: "system",
  font: "sans",
  modelAlias: "Auto",
  effort: null,
  instructions: "",
  enterToSend: true,
  reducedMotion: false,
  defaultMode: "chat",
  saveHistory: true,
  memoryEnabled: true,
  chatSearchEnabled: true,
  styleId: "normal",
  version: 0,
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [chats, setChats] = useState<Chat[]>([]),
    [projects, setProjects] = useState<Project[]>([]),
    [artifacts, setArtifacts] = useState<Artifact[]>([]),
    [preferences, setPreferences] = useState<Preferences>(defaultPreferences),
    [messages, setMessages] = useState<Record<string, Message[]>>({}),
    [transcript, setTranscript] = useState<Record<string, TranscriptState>>({}),
    [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState<string | null>(null),
    [panel, setPanel] = useState<Panel>({ kind: "closed" }),
    [toastText, setToast] = useState(""),
    [settings, setSettings] = useState(false),
    [search, setSearch] = useState(false),
    [activeRun, setActiveRun] = useState<string | null>(null),
    [runningChats, setRunningChats] = useState<string[]>([]),
    [reconnecting, setReconnecting] = useState<Record<string, boolean>>({}),
    [edit, setEdit] = useState<Context["edit"]>(null),
    [quote, setQuote] = useState<Context["quote"]>(null),
    [artifactUpdateEvent, setArtifactUpdateEvent] = useState<Context["artifactUpdateEvent"]>(null);

  const insertQuote: Context["insertQuote"] = useCallback((text: string, chatId?: string) => {
    setQuote({ text, timestamp: Date.now(), ...(chatId ? { chatId } : {}) });
  }, []);
  const consumeQuote: Context["consumeQuote"] = useCallback((timestamp: number) => {
    setQuote((q) => (q?.timestamp === timestamp ? null : q));
  }, []);
  // A quote for a chat is dropped once the user is somewhere else, so it never reappears later.
  useEffect(() => {
    setQuote((q) => (q?.chatId && !location.pathname.startsWith(`/chat/${q.chatId}`) ? null : q));
  }, [location.pathname]);

  /** One controller per chat (RG6): Stop on one chat never touches another chat's run. */
  const controllers = useRef(new Map<string, AbortController>());
  /** Per running chat: ends its current reconnect wait now (the banner's Retry). */
  const wakers = useRef(new Map<string, () => void>());
  /** Set once `run` exists, so a transcript load can reattach to a reply still running. */
  const attachRef = useRef<((chatId: string, messageId: string) => void) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const toast = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);

  /** Turn any thrown value into a line worth showing, without inventing a diagnosis. */
  const report = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast(error instanceof ApiError ? error.detail : fallback);
    },
    [toast],
  );

  /* ------------------------------------------------------------------ loading */

  const refreshChats = useCallback(async () => {
    const page = await api.chats.list({ limit: 100 });
    const list = page.items.map(toChat);
    setChats(list);
    return list;
  }, []);

  const refreshProjects = useCallback(async () => {
    const page = await api.projects.list({ limit: 100 });
    setProjects(page.items.map(toProject));
  }, []);

  const refreshArtifacts = useCallback(async () => {
    const page = await api.artifacts.list({ limit: 100 });
    setArtifacts(page.items.map(toArtifact));
  }, []);

  const refreshPreferences = useCallback(async () => {
    const p = toPreferences(await api.preferences.read());
    setPreferences({ ...p, modelAlias: "Auto" });
  }, []);

  useEffect(() => {
    if (!user) return;
    let live = true;
    setReady(false);
    setLoadError(null);
    void (async () => {
      try {
        const [chatPage, projectPage, artifactPage, prefs] = await Promise.all([
          api.chats.list({ limit: 100 }),
          api.projects.list({ limit: 100 }),
          api.artifacts.list({ limit: 100 }),
          api.preferences.read(),
        ]);
        if (!live) return;
        setChats(chatPage.items.map(toChat));
        setProjects(projectPage.items.map(toProject));
        setArtifacts(artifactPage.items.map(toArtifact));
        const p = toPreferences(prefs);
        setPreferences({ ...p, modelAlias: "Auto" });
      } catch (error) {
        if (!live) return;
        setLoadError(
          error instanceof ApiError
            ? error.detail
            : "ArcNave could not be reached. Check that the server is running.",
        );
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [user]);

  /* ------------------------------------------------------------------ appearance */

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      applyTheme(
        preferences.theme,
        preferences.font,
        preferences.reducedMotion,
      );
    apply();
    // Remembered locally only so the sign-in screen and the next cold start match; the stored
    // preference itself lives on the server.
    writeLocal("theme", preferences.theme);
    writeLocal("font", preferences.font);
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preferences.theme, preferences.font, preferences.reducedMotion]);

  useEffect(
    () => () => {
      for (const ac of controllers.current.values()) ac.abort();
      clearTimeout(toastTimer.current);
    },
    [],
  );

  /* ------------------------------------------------------------------ transcripts */

  const loadTranscript = useCallback(
    async (id: string, settled?: Settled, attempt = 0): Promise<void> => {
      setTranscript((t) => ({
        ...t,
        [id]: t[id] === "ready" ? "ready" : "loading",
      }));
      try {
        const detail = await api.chats.read(id);
        let mapped = detail.messages.map(toMessage);
        let stale = false;

        if (settled) {
          const row = mapped.find((m) => m.id === settled.messageId);
          if (
            row &&
            (row.status === "generating" || row.status === "submitting")
          ) {
            stale = true;
            mapped = mapped.map((m) =>
              m.id === settled.messageId
                ? { ...m, status: settled.status, text: m.text || settled.text }
                : m,
            );
          }
        }

        setMessages((m) => ({ ...m, [id]: mapped }));
        // A version stands in for its conversation's row (ADR-0038), never beside it.
        const shown = toChat(detail);
        setChats((list) =>
          list.some((c) => c.id === id || c.familyId === shown.familyId)
            ? list.map((c) => (c.id === id || c.familyId === shown.familyId ? shown : c))
            : [shown, ...list],
        );
        setTranscript((t) => ({ ...t, [id]: "ready" }));

        // A reply still generating with no stream in this tab (a reload, another tab, a
        // dropped connection) is reattached, so it keeps filling in instead of spinning.
        const running = settled
          ? undefined
          : mapped.find((m) => m.role === "assistant" && m.status === "generating");
        if (running && !controllers.current.has(id)) attachRef.current?.(id, running.id);

        // Read again shortly so the persisted text and usage replace what this tab inferred.
        // Bounded: if the server never settles the row, the local terminal status stands
        // rather than the screen spinning forever.
        if (stale && attempt < 3) {
          setTimeout(
            () => void loadTranscript(id, settled, attempt + 1),
            500 * (attempt + 1),
          );
        }
      } catch (error) {
        setTranscript((t) => ({
          ...t,
          [id]:
            error instanceof ApiError && error.code === "not_found"
              ? "missing"
              : "failed",
        }));
      }
    },
    [],
  );

  const openChat = useCallback(
    (id: string) => {
      // A chat already streaming in this tab holds newer state than the server has written.
      if (controllers.current.has(id)) return;
      if (transcript[id] === "ready" || transcript[id] === "loading") return;
      void loadTranscript(id);
    },
    [loadTranscript, transcript],
  );

  const patchMessage = useCallback(
    (chatId: string, messageId: string, fn: (m: Message) => Message) =>
      setMessages((all) => ({
        ...all,
        [chatId]: (all[chatId] ?? []).map((m) =>
          m.id === messageId ? fn(m) : m,
        ),
      })),
    [],
  );

  /* ------------------------------------------------------------------ generation */

  /**
   * Follows a reply this tab cannot stream (its run is on another server instance, or ended
   * while the tab was away) by re-reading the chat until the row stops saying generating.
   * Bounded by the server's own turn deadline.
   */
  const pollGenerating = useCallback((chatId: string, messageId: string) => {
    const startedAt = Date.now();
    const tick = async (): Promise<void> => {
      try {
        const detail = await api.chats.read(chatId);
        const mapped = detail.messages.map(toMessage);
        setMessages((m) => ({ ...m, [chatId]: mapped }));
        const row = mapped.find((m) => m.id === messageId);
        if (row?.status !== "generating" || Date.now() - startedAt > 60 * 60_000) return;
      } catch {
        // A failed read is retried on the next tick; the row on screen stays as it was.
      }
      setTimeout(() => void tick(), 3000);
    };
    void tick();
  }, []);

  const run = useCallback(
    async (
      chatId: string,
      options: {
        prompt: string;
        mode: Mode;
        attachmentIds: string[];
        placeholderId: string;
        retryMessageId?: string;
        makeArtifact?: boolean;
        title: string;
        /** Reattach to a run already going on the server instead of starting one. */
        attachTo?: string;
      },
    ) => {
      const ac = new AbortController();
      // The chat this run writes to: the one asked for, until the server says the turn runs in a
      // new version (a regenerate that keeps the old answer, ADR-0079).
      let runChat = chatId;
      controllers.current.set(chatId, ac);
      setActiveRun(chatId);
      setRunningChats((list) => (list.includes(chatId) ? list : [...list, chatId]));
      let wakeNow: (() => void) | undefined;
      const wake = (): Promise<void> => new Promise<void>((resolve) => (wakeNow = resolve));
      wakers.current.set(chatId, () => wakeNow?.());
      /** Ends this run's hold on the chat, once, and only if no newer run replaced it. */
      const release = (): void => {
        const held = runChat;
        if (controllers.current.get(held) !== ac) return;
        controllers.current.delete(held);
        wakers.current.delete(held);
        setRunningChats((list) => list.filter((c) => c !== held));
        setReconnecting((r) => ({ ...r, [held]: false }));
        setActiveRun((current) => (current === held ? ([...controllers.current.keys()].at(-1) ?? null) : current));
      };
      /** The turn runs in a new version: this run, its row and the open page move there. */
      const follow = (to: string, messageId: string): void => {
        const from = runChat;
        const placeholder = assistantId;
        setMessages((all) => {
          const list = all[from] ?? [];
          const at = list.findIndex((m) => m.id === placeholder);
          const before = at >= 0 ? list.slice(0, at) : list;
          const row = at >= 0 ? list[at]! : undefined;
          const { [from]: _old, ...rest } = all;
          return {
            ...rest,
            [to]: [...before, ...(row ? [{ ...row, id: messageId, text: "", status: "generating" as const }] : [])],
          };
        });
        // The old version keeps its answer on the server; it is read again when opened.
        setTranscript((t) => {
          const { [from]: _old, ...rest } = t;
          return { ...rest, [to]: "ready" };
        });
        controllers.current.delete(from);
        controllers.current.set(to, ac);
        const waker = wakers.current.get(from);
        wakers.current.delete(from);
        if (waker) wakers.current.set(to, waker);
        setRunningChats((list) => [...list.filter((c) => c !== from && c !== to), to]);
        setActiveRun((current) => (current === from ? to : current));
        setChats((list) => list.map((c) => (c.id === from ? { ...c, id: to } : c)));
        if (new RegExp(`^/chat/${from}(/|$)`).test(window.location.pathname)) navigate(`/chat/${to}`, { replace: true });
        runChat = to;
        assistantId = messageId;
      };
      let assistantId = options.placeholderId;
      let text = "";
      let completed = false;
      let openedArtifact = false;
      // What this tab will assert about the row if the server has not caught up yet.
      let outcome: Message["status"] = "stopped";
      let pollInstead = false;

      if (options.attachTo) {
        // Frames are replayed from the start, so what the row showed is rebuilt, not appended to.
        patchMessage(runChat, assistantId, (m) => ({
          ...m,
          text: "",
          status: "generating",
          toolCalls: [],
          codeBlocks: [],
          events: [],
          uiBlocks: [],
        }));
      }
      const source = options.attachTo
        ? attach(chatId, ac.signal, { wake })
        : generate(
            chatId,
            {
              prompt: options.prompt,
              mode: options.mode,
              model: preferences.modelAlias,
              ...(preferences.effort ? { effort: preferences.effort } : {}),
              attachmentIds: options.attachmentIds,
              styleId: preferences.styleId,
              ...(options.retryMessageId
                ? { retryMessageId: options.retryMessageId }
                : {}),
            },
            ac.signal,
            // One key per send, reused by the adapter if the POST fails on the network (ER-10c).
            { idempotencyKey: crypto.randomUUID(), wake },
          );

      try {
        for await (const event of source) {
          if (event.type === "reconnecting") {
            const held = runChat;
            setReconnecting((r) => ({ ...r, [held]: true }));
            continue;
          }
          if (event.type === "reconnected") {
            const held = runChat;
            setReconnecting((r) => ({ ...r, [held]: false }));
            continue;
          }
          if ((event.type === "ack" || event.type === "start") && event.chatId && event.chatId !== runChat) {
            follow(event.chatId, event.messageId);
          }
          if (event.type === "ack" && event.messageId !== assistantId) {
            // The turn exists: adopt the server's id now, before the model answers (ADR-0078).
            const adopt = adoptServerId(assistantId, event.messageId, { status: "generating" });
            const held = runChat;
            setMessages((all) => ({ ...all, [held]: adopt(all[held] ?? []) }));
            assistantId = event.messageId;
          }
          if (event.type === "snapshot" && event.message) {
            // The stored reply stands in for frames this tab cannot get (another server, or a gap
            // past the server's buffer): it replaces the row as a whole.
            const stored = toMessage(event.message);
            const from = assistantId;
            const held = runChat;
            setMessages((all) => ({
              ...all,
              [held]: (all[held] ?? []).map((m) => (m.id === from || m.id === stored.id ? stored : m)),
            }));
            assistantId = stored.id;
            text = stored.text;
            if (stored.status === "complete") {
              completed = true;
              outcome = "complete";
            } else if (stored.status === "error" || stored.status === "stopped") {
              outcome = stored.status;
            }
          }
          if (event.type === "start") {
            // The server owns the message id. Adopt it now so feedback and retry address the
            // real row rather than a placeholder that only exists in this tab.
            const realId = event.messageId;
            // adoptServerId fixes both ids now; the updater may run after assistantId moves on.
            const adopt = adoptServerId(assistantId, realId, {
              status: "generating",
              modelAlias: event.model.resolved,
              providerModelId: event.model.providerModelId,
            });
            const held = runChat;
            setMessages((all) => ({ ...all, [held]: adopt(all[held] ?? []) }));
            assistantId = realId;
          }
          if (event.type === "delta") {
            text += event.text;
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              text: m.text + event.text,
              segments: appendSegment(m.segments, { type: "text", text: event.text }),
              status: "generating",
            }));
          }
          if (event.type === "thinking")
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              thinking: (m.thinking ?? "") + event.text,
              segments: appendSegment(m.segments, { type: "thinking", text: event.text }),
              status: "generating",
            }));
          if (event.type === "sources")
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              sources: event.sources.map(toSource),
            }));
          if (event.type === "research")
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              status: "generating",
              events: [
                ...(m.events ?? []),
                toResearchEvent({ ...event.event }),
              ],
              researchStage: event.event.stage,
            }));
          if (event.type === "tool_use")
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              status: "generating",
              segments: appendSegment(m.segments, { type: "tool", toolCallId: event.toolCallId }),
              toolCalls: [
                ...(m.toolCalls ?? []),
                {
                  toolCallId: event.toolCallId,
                  name: event.name,
                  input: event.input,
                },
              ],
            }));
          if (event.type === "ui_draft")
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              status: "generating",
              visualDrafts: applyVisualDraft(m.visualDrafts, event),
            }));
          if (event.type === "tool_result") {
            const files = event.files;
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              // The finished visual follows as a checked ui_block; the draft goes now either way.
              ...(event.name === "render_ui" || event.name === "show_widget" ? { visualDrafts: undefined } : {}),
              toolCalls: (m.toolCalls ?? []).map((t) =>
                t.toolCallId === event.toolCallId
                  ? {
                      ...t,
                      ok: event.ok,
                      preview: event.preview,
                      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
                      // Presented files show as cards now, not after a reload.
                      ...(files?.length ? { content: [{ type: "json", data: { persistedFiles: files } }] } : {}),
                    }
                  : t,
              ),
            }));
            // An artifact opens beside the chat as soon as it is presented (ADR-0048).
            const artifact = files?.find((f) => artifactKind(f.filename));
            if (artifact && !openedArtifact) {
              openedArtifact = true;
              setPanel({
                kind: "file",
                file: {
                  id: artifact.attachmentId,
                  name: artifact.filename,
                  size: artifact.sizeBytes,
                  type: artifact.mimeType,
                  status: "ready",
                  downloadUrl: api.files.downloadUrl(artifact.attachmentId),
                },
              });
            }
            if (event.name === "update_artifact" && event.ok) {
              setArtifactUpdateEvent({ timestamp: Date.now() });
            }
          }
          if (event.type === "artifact_created") {
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              artifactId: event.artifactId,
            }));
            void refreshArtifacts();
            if (!openedArtifact) {
              openedArtifact = true;
              setPanel({ kind: "artifact", id: event.artifactId });
            }
          }
          if (event.type === "code")
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              status: "generating",
              codeBlocks: [
                ...(m.codeBlocks ?? []),
                { code: event.code, language: event.language, output: event.output },
              ],
            }));
          if (event.type === "ui_block") {
            patchMessage(runChat, assistantId, (m) => {
              const existing = m.uiBlocks ?? [];
              const exists = existing.some((b) => b.blockId === event.block.blockId);
              const updated = exists
                ? existing.map((b) => (b.blockId === event.block.blockId ? event.block : b))
                : [...existing, event.block];
              return {
                ...m,
                status: "generating",
                uiBlocks: updated,
                segments: exists ? m.segments : appendSegment(m.segments, { type: "ui", blockId: event.block.blockId }),
              };
            });
          }
          if (event.type === "debug") {
            try {
              (window as unknown as { __LAST_DEBUG_TRACE?: unknown }).__LAST_DEBUG_TRACE = event.trace;
            } catch {
              // Ignore in non-browser context
            }
          }
          if (event.type === "done") {
            completed = true;
            outcome = "complete";
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              visualDrafts: undefined,
              status: "complete",
              questions: event.questions,
              usage: toUsage(event.usage),
              finishReason: event.finishReason,
              ...(event.effort ? { effort: event.effort } : {}),
            }));
          }
          if (event.type === "error") {
            outcome = "error";
            patchMessage(runChat, assistantId, (m) => ({
              ...m,
              visualDrafts: undefined,
              status: "error",
              error: event.code,
              errorTitle: event.title,
              errorDetail: event.detail,
              ...(event.usage ? { usage: toUsage(event.usage) } : {}),
              researchStage:
                options.mode === "chat" ? m.researchStage : "error",
            }));
          }
        }
      } catch (error) {
        if (error instanceof ApiError && error.code === "no_active_run") {
          // The chat has no turn the server knows of. The persisted row is the truth; poll it
          // while it still says generating.
          release();
          pollInstead = true;
        } else if (ac.signal.aborted) {
          outcome = "stopped";
          patchMessage(runChat, assistantId, (m) => ({
            ...m,
            status: "stopped",
          }));
        } else if (error instanceof ApiError) {
          outcome = "error";
          patchMessage(runChat, assistantId, (m) => ({
            ...m,
            status: "error",
            error: error.code,
            errorTitle: error.title,
            errorDetail: error.detail,
          }));
        } else {
          outcome = "error";
          patchMessage(runChat, assistantId, (m) => ({
            ...m,
            status: "error",
            error: "network",
          }));
        }
      } finally {
        release();
      }
      if (pollInstead) {
        pollGenerating(runChat, assistantId);
        return;
      }
      if (completed && options.makeArtifact && text.trim()) {
        try {
          const created = await api.artifacts.create({
            title: options.title.slice(0, 80) || "Untitled artifact",
            kind: /webpage|html|website|landing page/i.test(options.title)
              ? "webpage"
              : /\bcode\b|function|script|snippet/i.test(options.title)
                ? "code"
                : "document",
            content: text,
            chatId: runChat,
          });
          setArtifacts((list) => [toArtifact(created), ...list]);
          // The backend has no message→artifact column writer, so this link lives only for
          // the current session. The artifact itself stays findable by chat in Artifacts.
          patchMessage(runChat, assistantId, (m) => ({
            ...m,
            artifactId: created.id,
          }));
          setPanel({ kind: "artifact", id: created.id });
        } catch (error) {
          report(error, "The artifact could not be created.");
        }
      }
      // Reconcile against what was actually persisted: ids, sequence, final status. The
      // outcome this tab observed is passed along so a read that beats the server's own
      // write cannot resurrect the spinner.
      await loadTranscript(runChat, {
        messageId: assistantId,
        status: outcome,
        text,
      });
      const listed = await refreshChats().catch(() => undefined);
      // P13 (ADR-0080): a new chat is named by a background job a moment after its first answer;
      // while it still shows the placeholder (the prompt's first 80 characters), read the list again.
      if (outcome === "complete" && needsGeneratedTitle(listed, chatId, options.prompt)) {
        for (const ms of TITLE_REFRESH_DELAYS_MS) setTimeout(() => void refreshChats().catch(() => {}), ms);
      }
    },
    [
      preferences.modelAlias,
      preferences.effort,
      preferences.styleId,
      patchMessage,
      pollGenerating,
      loadTranscript,
      refreshChats,
      report,
      navigate,
    ],
  );

  attachRef.current = (chatId, messageId) =>
    void run(chatId, {
      prompt: "",
      mode: "chat",
      attachmentIds: [],
      placeholderId: messageId,
      title: "",
      attachTo: messageId,
    });

  const startTurn = useCallback(
    (
      chatId: string,
      prompt: string,
      mode: Mode,
      files: Attachment[],
      makeArtifact: boolean,
    ) => {
      const placeholderId = `pending-${crypto.randomUUID()}`;
      const userPlaceholder: Message = {
        id: `pending-user-${crypto.randomUUID()}`,
        seq: -2,
        role: "user",
        text: prompt,
        mode,
        status: "complete",
        ...(files.length ? { attachments: files } : {}),
      };
      const assistantPlaceholder: Message = {
        id: placeholderId,
        seq: -1,
        role: "assistant",
        text: "",
        mode,
        status: "submitting",
      };
      setMessages((all) => ({
        ...all,
        [chatId]: [
          ...(all[chatId] ?? []),
          userPlaceholder,
          assistantPlaceholder,
        ],
      }));
      setTranscript((t) => ({ ...t, [chatId]: "ready" }));
      void run(chatId, {
        prompt,
        mode,
        attachmentIds: files.map((f) => f.id),
        placeholderId,
        makeArtifact,
        title: prompt,
      });
    },
    [run],
  );

  const send: Context["send"] = useCallback(
    (text, mode, files, chatId, projectId, artifact = false) => {
      if (chatId && controllers.current.has(chatId)) {
        toast("Stop the current response before starting another.");
        return;
      }
      const prompt =
        text.trim() ||
        `Help me understand ${files.map((f) => f.name).join(", ")}.`;
      if (!prompt.trim()) return;

      void (async () => {
        try {
          let targetId = chatId;
          const pendingEdit = edit;

          if (pendingEdit && pendingEdit.chatId === chatId) {
            // An edit continues from before the turn being replaced, in a copy. Nothing in the
            // original conversation is removed.
            const history = messages[pendingEdit.chatId] ?? [];
            const edited = history.find((m) => m.id === pendingEdit.messageId);
            if (!edited) throw new Error("edited message not loaded");
            const version = toChat(await api.chats.edit(pendingEdit.chatId, edited.seq));
            targetId = version.id;
            // The new version takes the conversation's one row in the list.
            setChats((list) => [version, ...list.filter((c) => c.familyId !== version.familyId)]);
            const detail = await api.chats.read(version.id);
            setMessages((all) => ({
              ...all,
              [version.id]: detail.messages.map(toMessage),
            }));
            setTranscript((t) => ({ ...t, [version.id]: "ready" }));
            setEdit(null);
          } else if (!targetId) {
            const created = await api.chats.create({
              title: prompt.slice(0, 80),
              projectId: projectId ?? null,
            });
            targetId = created.id;
            setChats((list) => [toChat(created), ...list]);
            setMessages((all) => ({ ...all, [created.id]: [] }));
          }

          navigate(`/chat/${targetId}`);
          setPanel((current) =>
            current.kind === "artifact" && chatId ? current : { kind: "closed" },
          );
          startTurn(targetId!, prompt, mode, files, artifact);
        } catch (error) {
          report(error, "The conversation could not be started.");
        }
      })();
    },
    [edit, messages, navigate, startTurn, toast, report],
  );

  const retry: Context["retry"] = useCallback(
    (chatId, messageId) => {
      if (controllers.current.has(chatId)) {
        toast("Stop the current response first.");
        return;
      }
      const history = messages[chatId] ?? [];
      const index = history.findIndex((m) => m.id === messageId);
      const user = index > 0 ? history[index - 1] : undefined;
      if (!user || user.role !== "user") {
        toast("There is no prompt to retry.");
        return;
      }
      patchMessage(chatId, messageId, (m) => ({
        ...m,
        text: "",
        status: "submitting",
        sources: undefined as unknown as Message["sources"],
        events: undefined as unknown as Message["events"],
        questions: undefined as unknown as Message["questions"],
        error: undefined as unknown as Message["error"],
        errorTitle: undefined as unknown as Message["errorTitle"],
        errorDetail: undefined as unknown as Message["errorDetail"],
        researchStage: undefined as unknown as Message["researchStage"],
      }));
      void run(chatId, {
        prompt: user.text,
        mode: user.mode,
        attachmentIds: (user.attachments ?? []).map((f) => f.id),
        placeholderId: messageId,
        retryMessageId: messageId,
        title: user.text,
      });
    },
    [messages, patchMessage, run, toast],
  );

  const stop = useCallback(
    (target?: unknown) => {
      // Called with a chat id, or bare (an onClick passes its event): then the open chat's run.
      const open = /^\/chat\/([^/]+)/.exec(location.pathname)?.[1];
      const chatId = typeof target === "string" ? target : open ?? activeRun;
      if (!chatId) return;
      controllers.current.get(chatId)?.abort();
      // The server stops the run on whichever instance holds it (a run started in another tab
      // has no socket here to close at all).
      void api.chats.stop(chatId).catch(() => {});
    },
    [activeRun, location.pathname],
  );

  /** Reattach now: the Retry on the "Reconnecting…" banner, and a tab back in the foreground. */
  const reconnect = useCallback(
    (chatId: string) => {
      const wakeRun = wakers.current.get(chatId);
      if (wakeRun) wakeRun();
      else void loadTranscript(chatId);
    },
    [loadTranscript],
  );

  // A tab back in the foreground re-reads every chat it shows as generating with no stream of
  // its own, and reattaches to the ones still running (Stage 5 F3b).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      for (const [chatId, list] of Object.entries(messagesRef.current)) {
        const generating = list.some((m) => m.role === "assistant" && m.status === "generating");
        if (generating && !controllers.current.has(chatId)) void loadTranscript(chatId);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadTranscript]);

  /* ------------------------------------------------------------------ chat actions */

  const feedback: Context["feedback"] = useCallback(
    (chatId, messageId, value) => {
      patchMessage(chatId, messageId, (m) => ({
        ...m,
        ...(value
          ? { feedback: value }
          : { feedback: undefined as unknown as "up" }),
      }));
      void api.chats.feedback(chatId, messageId, value).catch((error) => {
        report(error, "Feedback could not be saved.");
        void loadTranscript(chatId);
      });
    },
    [patchMessage, report, loadTranscript],
  );

  const applyChat = useCallback(
    (updated: Chat) =>
      setChats((list) => list.map((c) => (c.id === updated.id ? updated : c))),
    [],
  );

  const renameChat: Context["renameChat"] = useCallback(
    (id, title) => {
      if (!title.trim()) return;
      void api.chats
        .patch(id, { title: title.trim() })
        .then((updated) => {
          applyChat(toChat(updated));
          toast("Conversation renamed");
        })
        .catch((error) =>
          report(error, "The conversation could not be renamed."),
        );
    },
    [applyChat, toast, report],
  );

  const pinChat: Context["pinChat"] = useCallback(
    (id, pinned) => {
      void api.chats
        .patch(id, { pinned })
        .then((updated) => applyChat(toChat(updated)))
        .catch((error) => report(error, "That change could not be saved."));
    },
    [applyChat, report],
  );

  const moveChat: Context["moveChat"] = useCallback(
    (id, projectId) => {
      void api.chats
        .patch(id, { projectId })
        .then((updated) => {
          applyChat(toChat(updated));
          void refreshProjects().catch(() => {});
          toast(
            projectId
              ? "Conversation moved"
              : "Conversation removed from project",
          );
        })
        .catch((error) =>
          report(error, "The conversation could not be moved."),
        );
    },
    [applyChat, refreshProjects, toast, report],
  );

  const deleteChat: Context["deleteChat"] = useCallback(
    (id) => {
      controllers.current.get(id)?.abort();
      void api.chats
        .remove(id)
        .then(() => {
          // The server deletes every version of the conversation (ADR-0038).
          setChats((list) => {
            const familyId = list.find((c) => c.id === id)?.familyId ?? id;
            return list.filter((c) => c.id !== id && c.familyId !== familyId);
          });
          setMessages((all) => {
            const next = { ...all };
            delete next[id];
            return next;
          });
          setPanel({ kind: "closed" });
          navigate("/app");
          toast("Conversation deleted");
        })
        .catch((error) =>
          report(error, "The conversation could not be deleted."),
        );
    },
    [navigate, toast, report],
  );

  const branch: Context["branch"] = useCallback(
    (chatId, throughMessageId) => {
      void api.chats
        .branch(chatId, throughMessageId)
        .then((created) => {
          setChats((list) => [toChat(created), ...list]);
          setPanel({ kind: "closed" });
          navigate(`/chat/${created.id}`);
          toast("New branch created");
        })
        .catch((error) =>
          report(error, "The conversation could not be branched."),
        );
    },
    [navigate, toast, report],
  );

  const [versionAnchor, setVersionAnchor] = useState<Context["versionAnchor"]>(null);
  const switchVersion: Context["switchVersion"] = useCallback(
    (fromChatId, toChatId, seq, offset) => {
      if (controllers.current.has(fromChatId)) {
        toast("Stop the current response first.");
        return;
      }
      void (async () => {
        try {
          // Read every time: the versions shown on each prompt change as others are added.
          const detail = await api.chats.read(toChatId);
          const shown = toChat(detail);
          setMessages((all) => ({ ...all, [toChatId]: detail.messages.map(toMessage) }));
          setTranscript((t) => ({ ...t, [toChatId]: "ready" }));
          setChats((list) =>
            list.map((c) => (c.id === fromChatId || c.familyId === shown.familyId ? shown : c)),
          );
          setVersionAnchor({ chatId: toChatId, seq, offset });
          navigate(`/chat/${toChatId}`, { replace: true });
          // The choice is the conversation's, on the server: the list opens this version next
          // time, on any device (ADR-0079). A failed save leaves only this tab on it.
          void api.chats.activateVersion(toChatId).catch(() => {});
        } catch (error) {
          report(error, "That version could not be opened.");
        }
      })();
    },
    [navigate, toast, report],
  );

  const exportChat: Context["exportChat"] = useCallback(
    (chat) => {
      void (async () => {
        try {
          const history =
            messages[chat.id] ??
            (await api.chats.read(chat.id)).messages.map(toMessage);
          const body = history
            .map(
              (m) =>
                `## ${m.role === "user" ? "You" : "ArcNave"}${
                  m.modelAlias ? ` · ${m.modelAlias}` : ""
                }\n\n${m.text}${
                  m.sources?.length
                    ? "\n\n" +
                      m.sources
                        .map((s) => `${s.id}. [${s.title}](${s.url})`)
                        .join("\n")
                    : ""
                }`,
            )
            .join("\n\n");
          download(
            `# ${chat.title}\n\n${body}\n`,
            `${chat.title.replace(/[^a-z0-9 -]/gi, "") || "conversation"}.md`,
          );
          toast("Conversation exported");
        } catch (error) {
          report(error, "The conversation could not be exported.");
        }
      })();
    },
    [messages, toast, report],
  );

  const saveResponseAsArtifact: Context["saveResponseAsArtifact"] = useCallback(
    (chatId, messageId) => {
      const message = (messages[chatId] ?? []).find((m) => m.id === messageId);
      if (!message?.text.trim()) {
        toast("There is nothing in this response to save.");
        return;
      }
      const chat = chats.find((c) => c.id === chatId);
      void api.artifacts
        .create({
          title: (chat?.title ?? message.text).slice(0, 80),
          kind: "document",
          content: message.text,
          chatId,
        })
        .then((created) => {
          setArtifacts((list) => [toArtifact(created), ...list]);
          patchMessage(chatId, messageId, (m) => ({
            ...m,
            artifactId: created.id,
          }));
          setPanel({ kind: "artifact", id: created.id });
          toast("Saved as an artifact");
        })
        .catch((error) => report(error, "The artifact could not be created."));
    },
    [messages, chats, patchMessage, toast, report],
  );

  const saveVisualAsArtifact: Context["saveVisualAsArtifact"] = useCallback(
    ({ title, html, kind, chatId }) => {
      void api.artifacts
        .create({ title: title.slice(0, 80) || "Visual", kind, content: html, chatId: chatId ?? null })
        .then((created) => {
          setArtifacts((list) => [toArtifact(created), ...list]);
          setPanel({ kind: "artifact", id: created.id });
          toast("Saved as an artifact");
        })
        .catch((error) => report(error, "The artifact could not be created."));
    },
    [toast, report],
  );

  /* ------------------------------------------------------------------ preferences */

  const updatePreferences: Context["updatePreferences"] = useCallback(
    (patch) => {
      const previous = preferences;
      setPreferences((p) => ({ ...p, ...patch }));
      void api.preferences
        .patch({ ...patch, version: previous.version })
        .then((saved) =>
          setPreferences((curr) => ({
            ...toPreferences(saved),
            modelAlias: patch.modelAlias ?? curr.modelAlias,
          })),
        )
        .catch((error) => {
          setPreferences(previous);
          report(error, "That preference could not be saved.");
        });
    },
    [preferences, report],
  );

  const value = useMemo<Context>(
    () => ({
      chats,
      projects,
      artifacts,
      preferences,
      messages,
      transcript,
      ready,
      loadError,
      panel,
      setPanel,
      toast,
      toastText,
      settings,
      setSettings,
      search,
      setSearch,
      activeRun,
      runningChats,
      reconnecting,
      reconnect,
      openChat,
      send,
      retry,
      stop,
      feedback,
      renameChat,
      pinChat,
      moveChat,
      deleteChat,
      branch,
      switchVersion,
      versionAnchor,
      exportChat,
      saveResponseAsArtifact,
      saveVisualAsArtifact,
      updatePreferences,
      refreshPreferences,
      refreshChats,
      refreshProjects,
      refreshArtifacts,
      edit,
      setEdit,
      quote,
      insertQuote,
      consumeQuote,
      artifactUpdateEvent,
    }),
    [
      chats,
      projects,
      artifacts,
      preferences,
      messages,
      transcript,
      ready,
      loadError,
      panel,
      toast,
      toastText,
      settings,
      search,
      activeRun,
      runningChats,
      reconnecting,
      reconnect,
      openChat,
      send,
      retry,
      stop,
      feedback,
      renameChat,
      pinChat,
      moveChat,
      deleteChat,
      branch,
      switchVersion,
      versionAnchor,
      exportChat,
      saveResponseAsArtifact,
      saveVisualAsArtifact,
      updatePreferences,
      refreshPreferences,
      refreshChats,
      refreshProjects,
      refreshArtifacts,
      edit,
      quote,
      insertQuote,
      consumeQuote,
      artifactUpdateEvent,
    ],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}
