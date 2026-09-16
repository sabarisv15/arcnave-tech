import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Workspace,
  Panel,
  Mode,
  Attachment,
  ErrorCode,
  Chat,
  Message,
} from "./types";
import { uid } from "./types";
import { generate } from "./adapter";
import { report } from "./fixtures";
import { loadWorkspace, persistWorkspace, download } from "./storage";
interface Context {
  data: Workspace;
  setData: Dispatch<SetStateAction<Workspace>>;
  panel: Panel;
  setPanel: Dispatch<SetStateAction<Panel>>;
  toast: (text: string) => void;
  toastText: string;
  settings: boolean;
  setSettings: (value: boolean) => void;
  search: boolean;
  setSearch: (value: boolean) => void;
  activeRun: string | null;
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
  fault: ErrorCode | "partial" | undefined;
  setFault: (fault: ErrorCode | "partial" | undefined) => void;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  branch: (chatId: string, through?: number) => void;
  exportChat: (chat: Chat) => void;
  edit: { chatId: string; index: number; text: string } | null;
  setEdit: Dispatch<
    SetStateAction<{ chatId: string; index: number; text: string } | null>
  >;
}
const C = createContext<Context>(null!);
export const useWorkspace = () => useContext(C);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(loadWorkspace),
    [panel, setPanel] = useState<Panel>({ kind: "closed" }),
    [toastText, setToast] = useState(""),
    [settings, setSettings] = useState(false),
    [search, setSearch] = useState(false),
    [activeRun, setActiveRun] = useState<string | null>(null),
    [fault, setFault] = useState<Context["fault"]>(),
    [edit, setEdit] = useState<Context["edit"]>(null);
  const navigate = useNavigate();
  const controller = useRef<AbortController | null>(null);
  const state = useRef(data);
  state.current = data;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const toast = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        persistWorkspace(data);
      } catch {
        toast(
          "Your browser could not save changes. Export your work before closing.",
        );
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [data]);
  useEffect(() => {
    const save = () => {
      try {
        persistWorkspace(state.current);
      } catch {
        /* UI warns on debounce */
      }
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
  useEffect(() => {
    const q = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        data.preferences.theme === "system"
          ? q.matches
            ? "dark"
            : "light"
          : data.preferences.theme;
      document.documentElement.dataset.font = data.preferences.font;
      document.documentElement.dataset.motion = data.preferences.reducedMotion
        ? "reduced"
        : "system";
    };
    apply();
    q.addEventListener("change", apply);
    return () => q.removeEventListener("change", apply);
  }, [data.preferences]);
  useEffect(
    () => () => {
      controller.current?.abort();
      clearTimeout(toastTimer.current);
    },
    [],
  );
  const updateMessage = (
    chatId: string,
    messageId: string,
    fn: (m: Message) => Message,
  ) =>
    setData((w) => ({
      ...w,
      chats: w.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)),
            }
          : c,
      ),
    }));
  async function run(
    chatId: string,
    messageId: string,
    text: string,
    mode: Mode,
    projectId?: string,
    makeArtifact = false,
  ) {
    const ac = new AbortController();
    controller.current = ac;
    setActiveRun(chatId);
    const useFault = fault;
    setFault(undefined);
    const project = state.current.projects.find((p) => p.id === projectId);
    try {
      if (!navigator.onLine) {
        updateMessage(chatId, messageId, (m) => ({
          ...m,
          status: "error",
          error: "network",
        }));
        return;
      }
      for await (const event of generate(
        {
          prompt: text,
          mode,
          scope: state.current.preferences.sourceScope,
          model: state.current.preferences.model,
          context: project?.instructions,
          fault: useFault,
        },
        ac.signal,
      )) {
        if (event.type === "delta")
          updateMessage(chatId, messageId, (m) => ({
            ...m,
            text: m.text + event.text,
            status: "generating",
          }));
        if (event.type === "sources")
          updateMessage(chatId, messageId, (m) => ({
            ...m,
            sources: event.sources,
          }));
        if (event.type === "research")
          updateMessage(chatId, messageId, (m) => ({
            ...m,
            status: "generating",
            events: [...(m.events || []), event.event],
            researchStage: event.event.stage,
          }));
        if (event.type === "error")
          updateMessage(chatId, messageId, (m) => ({
            ...m,
            status: "error",
            error: event.code,
            researchStage: mode === "research" ? "error" : m.researchStage,
          }));
        if (event.type === "done") {
          let artifactId: string | undefined;
          if (makeArtifact) {
            artifactId = uid();
            const kind = /webpage|html|website/i.test(text)
              ? "webpage"
              : /code|function/i.test(text)
                ? "code"
                : "document";
            const content =
              kind === "webpage"
                ? state.current.artifacts.find((a) => a.kind === "webpage")
                    ?.versions[0] || "<h1>Your new page</h1>"
                : kind === "code"
                  ? "export function greet(name) {\n  return `Hello, ${name}`;\n}\n"
                  : /cool|heat|cities|brief/i.test(text)
                    ? report
                    : `# ${text.slice(0, 80)}\n\n## Purpose\n\n${text}\n\n## Working notes\n\nCapture the important context, evidence, and open questions here.\n\n## Next step\n\nChoose one concrete action.\n\n*Editable demonstration document.*`;
            setData((w) => ({
              ...w,
              artifacts: [
                {
                  id: artifactId!,
                  title: text.slice(0, 60),
                  kind,
                  versions: [content],
                  version: 0,
                  updatedAt: Date.now(),
                  projectId,
                  chatId,
                  demo: true,
                },
                ...w.artifacts,
              ],
            }));
            setPanel({ kind: "artifact", id: artifactId });
          }
          updateMessage(chatId, messageId, (m) => ({
            ...m,
            status: "complete",
            questions: event.questions,
            artifactId,
          }));
        }
      }
    } catch (error) {
      if (ac.signal.aborted)
        updateMessage(chatId, messageId, (m) => ({ ...m, status: "stopped" }));
      else
        updateMessage(chatId, messageId, (m) => ({
          ...m,
          status: "error",
          error: "generation",
        }));
    } finally {
      if (controller.current === ac) {
        controller.current = null;
        setActiveRun(null);
      }
    }
  }
  const send: Context["send"] = (
    text,
    mode,
    files,
    chatId,
    projectId,
    artifact = false,
  ) => {
    if (controller.current) {
      toast("Stop the current response before starting another.");
      return;
    }
    if (!text.trim() && !files.length) return;
    const id = chatId || uid(),
      userId = uid(),
      assistantId = uid(),
      prompt =
        text.trim() ||
        `Help me understand ${files.map((f) => f.name).join(", ")}.`;
    const messages: Message[] = [
      {
        id: userId,
        role: "user",
        text: prompt,
        mode,
        status: "complete",
        attachments: files,
      },
      {
        id: assistantId,
        role: "assistant",
        text: "",
        mode,
        status: "submitting",
        demo: true,
      },
    ];
    setData((w) => {
      const existing = w.chats.find((c) => c.id === id);
      return {
        ...w,
        chats: existing
          ? w.chats.map((c) =>
              c.id === id
                ? {
                    ...c,
                    messages:
                      edit && edit.chatId === id
                        ? [...c.messages.slice(0, edit.index), ...messages]
                        : [...c.messages, ...messages],
                    updatedAt: Date.now(),
                  }
                : c,
            )
          : [
              {
                id,
                title: prompt.slice(0, 80),
                messages,
                updatedAt: Date.now(),
                projectId,
              },
              ...w.chats,
            ],
      };
    });
    setEdit(null);
    navigate(`/chat/${id}`);
    setPanel({ kind: "closed" });
    void run(
      id,
      assistantId,
      prompt,
      mode,
      projectId,
      artifact ||
        /turn .*into.*(brief|report)|create.*(artifact|webpage)/i.test(prompt),
    );
  };
  const retry = (chatId: string, messageId: string) => {
    if (controller.current) {
      toast("Stop the current response first.");
      return;
    }
    const chat = state.current.chats.find((c) => c.id === chatId);
    if (!chat) return;
    const index = chat.messages.findIndex((m) => m.id === messageId);
    const user = chat.messages[index - 1];
    if (!user) return;
    setData((w) => ({
      ...w,
      chats: w.chats.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: [
                ...c.messages.slice(0, index),
                {
                  id: messageId,
                  role: "assistant",
                  mode: user.mode,
                  text: "",
                  status: "submitting",
                  demo: true,
                },
              ],
            }
          : c,
      ),
    }));
    void run(chatId, messageId, user.text, user.mode, chat.projectId);
  };
  const renameChat = (id: string, title: string) => {
    if (!title.trim()) return;
    setData((w) => ({
      ...w,
      chats: w.chats.map((c) =>
        c.id === id ? { ...c, title: title.trim() } : c,
      ),
    }));
    toast("Conversation renamed");
  };
  const deleteChat = (id: string) => {
    if (activeRun === id) controller.current?.abort();
    setData((w) => ({ ...w, chats: w.chats.filter((c) => c.id !== id) }));
    setPanel({ kind: "closed" });
    navigate("/");
    toast("Conversation deleted");
  };
  const branch = (id: string, through?: number) => {
    const chat = state.current.chats.find((c) => c.id === id);
    if (!chat) return;
    const newId = uid();
    setData((w) => ({
      ...w,
      chats: [
        {
          ...chat,
          id: newId,
          title: `${chat.title} · branch`,
          messages: chat.messages
            .slice(0, through === undefined ? undefined : through + 1)
            .map((m) => ({
              ...m,
              id: uid(),
              status: m.status === "generating" ? "stopped" : m.status,
            })),
          updatedAt: Date.now(),
        },
        ...w.chats,
      ],
    }));
    setPanel({ kind: "closed" });
    navigate(`/chat/${newId}`);
    toast("New branch created");
  };
  const exportChat = (chat: Chat) => {
    download(
      `# ${chat.title}\n\n${chat.messages.map((m) => `## ${m.role === "user" ? "You" : "ArcNave"}\n\n${m.text}${m.sources?.length ? "\n\n" + m.sources.map((s) => `${s.id}. [${s.title}](${s.url})`).join("\n") : ""}`).join("\n\n")}\n\nExported from ArcNave. Demonstration responses are not live AI research.`,
      `${chat.title.replace(/[^a-z0-9 -]/gi, "") || "conversation"}.md`,
    );
    toast("Conversation exported");
  };
  return (
    <C.Provider
      value={{
        data,
        setData,
        panel,
        setPanel,
        toast,
        toastText,
        settings,
        setSettings,
        search,
        setSearch,
        activeRun,
        send,
        retry,
        stop: () => controller.current?.abort(),
        fault,
        setFault,
        renameChat,
        deleteChat,
        branch,
        exportChat,
        edit,
        setEdit,
      }}
    >
      {children}
    </C.Provider>
  );
}
