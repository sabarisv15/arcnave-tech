import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Globe2,
  Image,
  Loader2,
  MessageCircleMore,
  Paperclip,
  Plus,
  Square,
  Telescope,
  X,
  PanelsTopLeft,
} from "lucide-react";
import type { Attachment, Mode } from "./types";
import { modelOptions, uid } from "./types";
import { sizeLabel, storeFile, validateFile } from "./storage";
import { Dropdown, IconButton } from "./ui";
import { useWorkspace } from "./workspace";
export function AttachmentChip({
  file,
  onRemove,
}: {
  file: Attachment;
  onRemove?: () => void;
}) {
  const { setPanel } = useWorkspace();
  return (
    <div
      className={`attachment-chip ${file.status === "failed" || file.status === "unsupported" ? "failed" : ""}`}
    >
      <button
        className="attachment-main"
        onClick={() =>
          file.status === "ready" && setPanel({ kind: "file", file })
        }
        disabled={file.status !== "ready"}
      >
        {file.status === "processing" ? (
          <Loader2 className="spin" size={18} />
        ) : file.type.startsWith("image/") ? (
          <Image size={18} />
        ) : (
          <FileText size={18} />
        )}
        <span>
          <strong>{file.name}</strong>
          <small>
            {file.status === "ready"
              ? `${sizeLabel(file.size)} · On this device`
              : file.error || "Saving to this device…"}
          </small>
        </span>
      </button>
      {onRemove && (
        <IconButton label={`Remove ${file.name}`} onClick={onRemove}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
}
export default function Composer({
  chatId,
  projectId,
  initialPrompt = "",
  initialMode,
  compact = false,
}: {
  chatId?: string;
  projectId?: string;
  initialPrompt?: string;
  initialMode?: Mode;
  compact?: boolean;
}) {
  const { data, setData, send, activeRun, stop, toast, edit, setEdit } =
    useWorkspace();
  const [text, setText] = useState(initialPrompt),
    [mode, setMode] = useState<Mode>(
      initialMode || data.preferences.defaultMode,
    ),
    [files, setFiles] = useState<Attachment[]>([]),
    [dragging, setDragging] = useState(false),
    [artifact, setArtifact] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null),
    input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (initialPrompt) {
      setText(initialPrompt);
      textarea.current?.focus();
    }
  }, [initialPrompt]);
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);
  useEffect(() => {
    if (edit && edit.chatId === chatId) {
      setText(edit.text);
      textarea.current?.focus();
    }
  }, [edit, chatId]);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height =
        Math.min(
          240,
          Math.max(compact ? 46 : 70, textarea.current.scrollHeight),
        ) + "px";
    }
  }, [text, compact]);
  const busy = !!activeRun;
  const ownRun = activeRun === chatId;
  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const selected = Array.from(list).slice(0, 10 - files.length);
    if (!selected.length) {
      toast("You can attach up to 10 files.");
      return;
    }
    for (const file of selected) {
      const error = validateFile(file);
      const item: Attachment = {
        id: uid(),
        name: file.name,
        size: file.size,
        type: file.type,
        status: error ? "unsupported" : "processing",
        error: error || undefined,
      };
      setFiles((f) => [...f, item]);
      if (!error) {
        try {
          await storeFile(item.id, file);
          if (mounted.current)
            setFiles((f) =>
              f.map((x) => (x.id === item.id ? { ...x, status: "ready" } : x)),
            );
        } catch {
          if (mounted.current)
            setFiles((f) =>
              f.map((x) =>
                x.id === item.id
                  ? {
                      ...x,
                      status: "failed",
                      error: "Could not save. Remove and try again.",
                    }
                  : x,
              ),
            );
        }
      }
    }
  }
  const submit = () => {
    if (
      busy ||
      files.some((f) => f.status !== "ready") ||
      (!text.trim() && !files.length)
    )
      return;
    send(text, mode, files, chatId, projectId, artifact);
    setText("");
    setFiles([]);
    setArtifact(false);
  };
  const modeIcon =
    mode === "chat" ? (
      <MessageCircleMore size={16} />
    ) : mode === "search" ? (
      <Globe2 size={16} />
    ) : (
      <Telescope size={16} />
    );
  return (
    <div className="composer-wrap">
      {edit && edit.chatId === chatId && (
        <div className="edit-notice">
          Editing this prompt replaces the replies after it.
          <button
            onClick={() => {
              setEdit(null);
              setText("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
      <div
        className={`composer ${dragging ? "dragging" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (--dragDepth.current === 0) setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        {dragging && (
          <div className="drop-overlay">
            <Paperclip size={24} />
            Drop files here
          </div>
        )}
        {files.length > 0 && (
          <div className="attachments">
            {files.map((f) => (
              <AttachmentChip
                key={f.id}
                file={f}
                onRemove={() =>
                  setFiles((all) => all.filter((x) => x.id !== f.id))
                }
              />
            ))}
          </div>
        )}
        {artifact && (
          <div className="composer-context">
            <PanelsTopLeft size={14} />
            Create an artifact
            <button
              aria-label="Cancel artifact creation"
              onClick={() => setArtifact(false)}
            >
              <X size={12} />
            </button>
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label="Your message"
          placeholder={
            chatId
              ? "Keep the thought going…"
              : "Ask a question. Follow a thought."
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              (data.preferences.enterToSend || e.ctrlKey || e.metaKey)
            ) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <Dropdown
            label="Add files and tools"
            side="top"
            trigger={
              <button className="icon-button" aria-label="Add files and tools">
                <Plus size={21} />
              </button>
            }
            items={[
              {
                label: "Upload files",
                description: "Documents, images, spreadsheets & code",
                icon: <Paperclip size={16} />,
                onSelect: () => {
                  if (input.current)
                    input.current.accept =
                      ".pdf,.docx,.txt,.csv,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.md,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.yml,.yaml,.xml,.sql";
                  input.current?.click();
                },
              },
              {
                label: "Upload images",
                icon: <Image size={16} />,
                onSelect: () => {
                  if (input.current)
                    input.current.accept =
                      "image/png,image/jpeg,image/webp,image/gif";
                  input.current?.click();
                },
              },
              {
                label: "Create artifact",
                description: "A document, code snippet, or webpage",
                icon: <PanelsTopLeft size={16} />,
                separator: true,
                onSelect: () => {
                  setArtifact(true);
                  textarea.current?.focus();
                },
              },
            ]}
          />
          <Dropdown
            label="Conversation mode"
            side="top"
            trigger={
              <button
                className={`quiet-button mode-button ${mode !== "chat" ? "mode-active" : ""}`}
                aria-label={`Mode: ${mode === "chat" ? "Chat" : mode === "search" ? "Search" : "Research"}`}
              >
                {modeIcon}
                {mode === "chat"
                  ? "Chat"
                  : mode === "search"
                    ? "Search"
                    : "Research"}
                <ChevronDown size={13} />
              </button>
            }
            items={[
              {
                label: "Chat",
                description: "Think, write, and work through ideas",
                icon: <MessageCircleMore size={16} />,
                selected: mode === "chat",
                onSelect: () => setMode("chat"),
              },
              {
                label: "Search",
                description: "A quick answer with references",
                icon: <Globe2 size={16} />,
                selected: mode === "search",
                onSelect: () => setMode("search"),
              },
              {
                label: "Research",
                description: "Explore evidence in more depth",
                icon: <Telescope size={16} />,
                selected: mode === "research",
                onSelect: () => setMode("research"),
              },
            ]}
          />
          {mode !== "chat" && (
            <Dropdown
              label="Source scope"
              side="top"
              trigger={
                <button
                  className="quiet-button source-scope"
                  aria-label="Source scope"
                >
                  {data.preferences.sourceScope === "All sources"
                    ? "Sources"
                    : data.preferences.sourceScope}
                  <ChevronDown size={12} />
                </button>
              }
              items={(["All sources", "Government", "Academic"] as const).map(
                (scope) => ({
                  label: scope,
                  selected: data.preferences.sourceScope === scope,
                  onSelect: () =>
                    setData((w) => ({
                      ...w,
                      preferences: { ...w.preferences, sourceScope: scope },
                    })),
                }),
              )}
            />
          )}
          <div className="spacer" />
          <Dropdown
            label="Model selection"
            side="top"
            align="end"
            trigger={
              <button
                className="quiet-button model-button"
                aria-label={`Model: ${data.preferences.model}`}
              >
                {data.preferences.model}
                <ChevronDown size={13} />
              </button>
            }
            items={modelOptions.map((model, index) => ({
              label: model.name,
              description: model.description,
              selected: model.name === data.preferences.model,
              separator: index === 1,
              onSelect: () =>
                setData((w) => ({
                  ...w,
                  preferences: { ...w.preferences, model: model.name },
                })),
            }))}
          />
          {ownRun ? (
            <button
              className="send-button"
              aria-label="Stop response"
              onClick={stop}
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              aria-label={edit ? "Send edited message" : "Send message"}
              onClick={submit}
              disabled={
                busy ||
                (!text.trim() && !files.length) ||
                files.some((f) => f.status !== "ready")
              }
            >
              <ArrowUp size={19} />
            </button>
          )}
        </div>
        <input
          ref={input}
          className="sr-only"
          type="file"
          multiple
          aria-label="Attach files"
          tabIndex={-1}
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {chatId && (
        <p className="composer-disclaimer">
          Demo responses · Files stay on this device ·{" "}
          {data.preferences.enterToSend
            ? "Shift + Enter for a new line"
            : "Ctrl + Enter to send"}
        </p>
      )}
    </div>
  );
}
