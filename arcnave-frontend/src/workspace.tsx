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
 * - **Editing a prompt branches.** There is no truncate operation, and inventing one by
 *   deleting messages would throw away work. An edit copies the conversation up to the point
 *   before the edited turn and continues there, leaving the original intact.
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
import { useNavigate } from "react-router-dom";
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
  /** The chat id of the run this tab is streaming, or null. */
  activeRun: string | null;
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
  stop: () => void;
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
  exportChat: (chat: Chat) => void;
  saveResponseAsArtifact: (chatId: string, messageId: string) => void;
  updatePreferences: (patch: Partial<Preferences>) => void;
  /**
   * Re-read preferences.
   *
   * `PATCH /usage/limits` writes the same row and bumps the same optimistic-concurrency
   * counter, so anything that changes limits has to refresh here or the next preference save
   * will be refused as a conflict.
   */
  refreshPreferences: () => Promise<void>;
  refreshChats: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  edit: { chatId: string; messageId: string; text: string } | null;
  setEdit: Dispatch<SetStateAction<Context["edit"]>>;
}

const C = createContext<Context>(null!);
export const useWorkspace = () => useContext(C);

const defaultPreferences: Preferences = {
  theme: "system",
  font: "sans",
  modelAlias: "Auto",
  instructions: "",
  enterToSend: true,
  reducedMotion: false,
  defaultMode: "chat",
  saveHistory: true,
  version: 0,
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const navigate = useNavigate();

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
    [edit, setEdit] = useState<Context["edit"]>(null);

  const controller = useRef<AbortController | null>(null);
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
    setChats(page.items.map(toChat));
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
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preferences.theme, preferences.font, preferences.reducedMotion]);

  useEffect(
    () => () => {
      controller.current?.abort();
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
        setChats((list) =>
          list.some((c) => c.id === id)
            ? list.map((c) => (c.id === id ? toChat(detail) : c))
            : [toChat(detail), ...list],
        );
        setTranscript((t) => ({ ...t, [id]: "ready" }));

        // A reply still generating with no stream in this tab (a reload, another tab, a
        // dropped connection) is reattached, so it keeps filling in instead of spinning.
        const running = settled
          ? undefined
          : mapped.find((m) => m.role === "assistant" && m.status === "generating");
        if (running && !controller.current) attachRef.current?.(id, running.id);

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
      if (controller.current && activeRun === id) return;
      if (transcript[id] === "ready" || transcript[id] === "loading") return;
      void loadTranscript(id);
    },
    [loadTranscript, transcript, activeRun],
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
      controller.current = ac;
      setActiveRun(chatId);
      let assistantId = options.placeholderId;
      let text = "";
      let completed = false;
      let openedArtifact = false;
      // What this tab will assert about the row if the server has not caught up yet.
      let outcome: Message["status"] = "stopped";
      let pollInstead = false;

      if (options.attachTo) {
        // Frames are replayed from the start, so what the row showed is rebuilt, not appended to.
        patchMessage(chatId, assistantId, (m) => ({
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
        ? attach(chatId, ac.signal)
        : generate(
            chatId,
            {
              prompt: options.prompt,
              mode: options.mode,
              model: preferences.modelAlias,
              attachmentIds: options.attachmentIds,
              ...(options.retryMessageId
                ? { retryMessageId: options.retryMessageId }
                : {}),
            },
            ac.signal,
          );

      try {
        for await (const event of source) {
          if (event.type === "start") {
            // The server owns the message id. Adopt it now so feedback and retry address the
            // real row rather than a placeholder that only exists in this tab.
            const realId = event.messageId;
            setMessages((all) => ({
              ...all,
              [chatId]: (all[chatId] ?? []).map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      id: realId,
                      status: "generating",
                      modelAlias: event.model.resolved,
                      providerModelId: event.model.providerModelId,
                    }
                  : m,
              ),
            }));
            assistantId = realId;
          }
          if (event.type === "delta") {
            text += event.text;
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
              text: m.text + event.text,
              status: "generating",
            }));
          }
          if (event.type === "sources")
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
              sources: event.sources.map(toSource),
            }));
          if (event.type === "research")
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
              status: "generating",
              events: [
                ...(m.events ?? []),
                toResearchEvent({ ...event.event }),
              ],
              researchStage: event.event.stage,
            }));
          if (event.type === "tool_use")
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
              status: "generating",
              toolCalls: [
                ...(m.toolCalls ?? []),
                {
                  toolCallId: event.toolCallId,
                  name: event.name,
                  input: event.input,
                },
              ],
            }));
          if (event.type === "tool_result")
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
              toolCalls: (m.toolCalls ?? []).map((t) =>
                t.toolCallId === event.toolCallId
                  ? { ...t, ok: event.ok, preview: event.preview }
                  : t,
              ),
            }));
          if (event.type === "artifact_created") {
            patchMessage(chatId, assistantId, (m) => ({
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
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
              status: "generating",
              codeBlocks: [
                ...(m.codeBlocks ?? []),
                { code: event.code, language: event.language, output: event.output },
              ],
            }));
          if (event.type === "ui_block") {
            patchMessage(chatId, assistantId, (m) => {
              const existing = m.uiBlocks ?? [];
              const exists = existing.some((b) => b.blockId === event.block.blockId);
              const updated = exists
                ? existing.map((b) => (b.blockId === event.block.blockId ? event.block : b))
                : [...existing, event.block];
              return {
                ...m,
                status: "generating",
                uiBlocks: updated,
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
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
              status: "complete",
              questions: event.questions,
              usage: toUsage(event.usage),
              finishReason: event.finishReason,
            }));
          }
          if (event.type === "error") {
            outcome = "error";
            patchMessage(chatId, assistantId, (m) => ({
              ...m,
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
          // The run is not on this server (finished, or on another instance). The persisted
          // row is the truth; poll it while it still says generating.
          if (controller.current === ac) {
            controller.current = null;
            setActiveRun(null);
          }
          pollInstead = true;
        } else if (ac.signal.aborted) {
          outcome = "stopped";
          patchMessage(chatId, assistantId, (m) => ({
            ...m,
            status: "stopped",
          }));
        } else if (error instanceof ApiError) {
          outcome = "error";
          patchMessage(chatId, assistantId, (m) => ({
            ...m,
            status: "error",
            error: error.code,
            errorTitle: error.title,
            errorDetail: error.detail,
          }));
        } else {
          outcome = "error";
          patchMessage(chatId, assistantId, (m) => ({
            ...m,
            status: "error",
            error: "network",
          }));
        }
      } finally {
        if (controller.current === ac) {
          controller.current = null;
          setActiveRun(null);
        }
      }
      if (pollInstead) {
        pollGenerating(chatId, assistantId);
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
            chatId,
          });
          setArtifacts((list) => [toArtifact(created), ...list]);
          // The backend has no message→artifact column writer, so this link lives only for
          // the current session. The artifact itself stays findable by chat in Artifacts.
          patchMessage(chatId, assistantId, (m) => ({
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
      await loadTranscript(chatId, {
        messageId: assistantId,
        status: outcome,
        text,
      });
      await refreshChats().catch(() => {});
    },
    [
      preferences.modelAlias,
      patchMessage,
      pollGenerating,
      loadTranscript,
      refreshChats,
      report,
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
      if (controller.current) {
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
            const index = history.findIndex(
              (m) => m.id === pendingEdit.messageId,
            );
            const previous = index > 0 ? history[index - 1] : undefined;
            const branched = previous
              ? await api.chats.branch(pendingEdit.chatId, previous.id)
              : await api.chats.create({
                  title: prompt.slice(0, 80),
                  projectId: projectId ?? null,
                });
            targetId = branched.id;
            setChats((list) => [toChat(branched), ...list]);
            const detail = await api.chats.read(branched.id);
            setMessages((all) => ({
              ...all,
              [branched.id]: detail.messages.map(toMessage),
            }));
            setEdit(null);
            toast("Continuing in a new branch");
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
          setPanel({ kind: "closed" });
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
      if (controller.current) {
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

  const stop = useCallback(() => {
    const chatId = activeRun;
    controller.current?.abort();
    // A run started in another tab has no socket here to close, so ask the server directly.
    if (chatId) void api.chats.stop(chatId).catch(() => {});
  }, [activeRun]);

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
      if (activeRun === id) controller.current?.abort();
      void api.chats
        .remove(id)
        .then(() => {
          setChats((list) => list.filter((c) => c.id !== id));
          setMessages((all) => {
            const next = { ...all };
            delete next[id];
            return next;
          });
          setPanel({ kind: "closed" });
          navigate("/");
          toast("Conversation deleted");
        })
        .catch((error) =>
          report(error, "The conversation could not be deleted."),
        );
    },
    [activeRun, navigate, toast, report],
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

  /* ------------------------------------------------------------------ preferences */

  const updatePreferences: Context["updatePreferences"] = useCallback(
    (patch) => {
      const previous = preferences;
      setPreferences((p) => ({ ...p, ...patch }));
      void api.preferences
        .patch({ ...patch, version: previous.version })
        .then((saved) => setPreferences(toPreferences(saved)))
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
      exportChat,
      saveResponseAsArtifact,
      updatePreferences,
      refreshPreferences,
      refreshChats,
      refreshProjects,
      refreshArtifacts,
      edit,
      setEdit,
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
      exportChat,
      saveResponseAsArtifact,
      updatePreferences,
      refreshPreferences,
      refreshChats,
      refreshProjects,
      refreshArtifacts,
      edit,
    ],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}
