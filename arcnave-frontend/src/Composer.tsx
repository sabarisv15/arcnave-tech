import { useEffect, useMemo, useRef, useState } from "react";
import { COMPOSE_EVENT } from "./generative-ui/blocks/VisualBlock";
import {
  ArrowUp,
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
  TriangleAlert,
  X,
  PanelsTopLeft,
} from "lucide-react";
import { ApiError, api } from "./api";
import type { ModelsDto } from "./api";
import type { Attachment, Message, Mode, ReasoningEffort } from "./types";
import {
  REASONING_EFFORT_LADDER,
  resolveEffortForModel,
  toAttachment,
} from "./types";
import { MAX_ATTACHMENT_BYTES, sizeLabel, validateFile } from "./storage";
import { Dropdown, IconButton } from "./ui";
import { useSession } from "./session";
import { useWorkspace } from "./workspace";

export const EFFORT_COPY: Record<
  ReasoningEffort,
  { label: string; description: string }
> = {
  low: { label: "Low", description: "Faster responses" },
  medium: { label: "Medium", description: "Balanced speed and depth" },
  high: { label: "High", description: "Deeper reasoning" },
  xhigh: { label: "X-High", description: "Extended deep reasoning" },
  max: { label: "Max", description: "Maximum reasoning depth" },
};

/**
 * Supported effort levels for the active composer model.
 *
 * For Auto: when this chat already resolved to a sticky model on an earlier turn, returns that
 * model's levels. When not known yet, returns only the levels that every Auto candidate
 * supports, so no level shown in the menu will ever be silently stepped down (Invariant 1).
 */
export function getSupportedEfforts(
  models: ModelsDto | null,
  selectedModelAlias: string,
  chatMessages: Message[] = [],
): ReasoningEffort[] {
  if (!models) return [];
  const filterValid = (list: readonly string[] | undefined): ReasoningEffort[] =>
    (list ?? []).filter((lvl): lvl is ReasoningEffort =>
      REASONING_EFFORT_LADDER.includes(lvl as ReasoningEffort),
    );

  if (selectedModelAlias === models.auto.alias || selectedModelAlias === "Auto") {
    const stickyModelAlias = [...chatMessages]
      .reverse()
      .find((m) => m.role === "assistant" && m.modelAlias)?.modelAlias;
    if (stickyModelAlias) {
      const stickyModel = models.models.find((m) => m.alias === stickyModelAlias);
      if (stickyModel) return filterValid(stickyModel.reasoningEfforts);
    }
    if (models.auto.reasoningEfforts) {
      return filterValid(models.auto.reasoningEfforts);
    }
    const candidates = models.models.filter(
      (m) => m.available && (m.reasoningEfforts?.length ?? 0) > 0,
    );
    if (!candidates.length) return [];
    return REASONING_EFFORT_LADDER.filter((lvl) =>
      candidates.every((c) => c.reasoningEfforts?.includes(lvl)),
    );
  }

  const chosen = models.models.find((m) => m.alias === selectedModelAlias);
  return filterValid(chosen?.reasoningEfforts);
}

export interface EffortControlState {
  supported: ReasoningEffort[];
  requested: ReasoningEffort;
  applied: ReasoningEffort;
  steppedDown: boolean;
  buttonLabel: string;
  ariaLabel: string;
  items: Array<{
    level: ReasoningEffort;
    label: string;
    description: string;
    selected: boolean;
  }>;
}

/**
 * Computes the effort menu state for the composer, or null when the active model exposes
 * fewer than 2 effort levels. If the saved preference is not supported by the selected model,
 * surfaces the stepped-down level that will actually apply ("X-High → High on this model").
 */
export function describeEffortControl(
  models: ModelsDto | null,
  selectedModelAlias: string,
  savedEffort: ReasoningEffort | null,
  chatMessages: Message[] = [],
): EffortControlState | null {
  const supported = getSupportedEfforts(models, selectedModelAlias, chatMessages);
  if (supported.length < 2) return null;

  const requested: ReasoningEffort = savedEffort ?? "medium";
  const applied = resolveEffortForModel(supported, requested) ?? supported[0]!;
  const steppedDown = savedEffort !== null && savedEffort !== applied;

  const requestedLabel = EFFORT_COPY[requested].label;
  const appliedLabel = EFFORT_COPY[applied].label;
  const buttonLabel = steppedDown
    ? `${requestedLabel} → ${appliedLabel} on this model`
    : appliedLabel;
  const ariaLabel = `Effort: ${buttonLabel}`;

  const items = supported.map((level) => ({
    level,
    label: EFFORT_COPY[level].label,
    description:
      steppedDown && level === applied
        ? `${requestedLabel} → ${appliedLabel} on this model`
        : EFFORT_COPY[level].description,
    selected: level === applied,
  }));

  return {
    supported,
    requested,
    applied,
    steppedDown,
    buttonLabel,
    ariaLabel,
    items,
  };
}

/**
 * Pastes longer than this become an attached text file. claude.ai does the same past "a few
 * thousand characters"; Anthropic does not document the number, so this one is ours.
 */
export const PASTE_AS_FILE_CHARS = 4000;

/** The file a long paste becomes, or null when it stays message text. */
export function pastedTextFile(text: string): File | null {
  if (text.length <= PASTE_AS_FILE_CHARS) return null;
  return new File([text], "pasted-text.txt", { type: "text/plain" });
}

export function deriveFollowUpSuggestion(
  history: import("./types").Message[],
): string {
  const latestAssistant = [...history]
    .reverse()
    .find((message) => message.role === "assistant" && message.status === "complete");
  const supplied = latestAssistant?.questions?.find((question) => question.trim());
  if (supplied) return supplied.trim();

  const answer = latestAssistant?.text.trim() ?? "";
  const answerQuestions = answer.match(/[^.!?\n]{8,150}\?/g);
  if (answerQuestions?.length) {
    return answerQuestions.at(-1)!.replace(/^[-*#\s]+/, "").trim();
  }

  const lines = answer.split("\n").map((line) => line.trim());
  const nextStepHeading = lines.findIndex((line) =>
    /^(?:#{1,4}\s*)?(?:recommended )?next step(?:s)?\s*:?$/i.test(line),
  );
  if (nextStepHeading >= 0) {
    const action = lines
      .slice(nextStepHeading + 1)
      .find((line) => line && !/^#{1,4}\s/.test(line));
    if (action) return action.replace(/^[-*\d.)\s]+/, "").trim();
  }

  const latestUser = [...history]
    .reverse()
    .find((message) => message.role === "user")
    ?.text.toLowerCase();
  if (!latestUser) return "";
  if (/\b(your name|who are you|what can you do)\b/.test(latestUser))
    return "What can you help me accomplish?";
  if (/\b(error|failed?|bug|issue|broken|not working|fix)\b/.test(latestUser))
    return "Show me the safest fix to try next.";
  if (/\b(compare|comparison|versus|\bvs\b)\b/.test(latestUser))
    return "Which option would you recommend for my situation?";
  if (/\b(build|create|implement|deploy|set up|setup|plan)\b/.test(latestUser))
    return "Turn this into the next concrete action.";
  if (answer.length >= 220) return "What is the most practical next step from this?";
  return "Show me a useful example.";
}

export function AttachmentChip({
  file,
  onRemove,
}: {
  file: Attachment;
  onRemove?: () => void;
}) {
  const { setPanel } = useWorkspace();
  const broken = file.status === "failed" || file.status === "unsupported";
  const openable = file.status === "ready" && !!file.downloadUrl;
  return (
    <div className={`attachment-chip ${broken ? "failed" : ""}`}>
      <button
        className="attachment-main"
        onClick={() => openable && setPanel({ kind: "file", file })}
        disabled={!openable}
      >
        {file.status === "uploading" || file.status === "indexing" ? (
          <Loader2 className="spin" size={18} />
        ) : broken ? (
          <TriangleAlert size={18} />
        ) : file.type.startsWith("image/") ? (
          <Image size={18} />
        ) : (
          <FileText size={18} />
        )}
        <span>
          <strong>{file.name}</strong>
          <small>
            {file.status === "uploading"
              ? file.progress !== undefined
                ? `Uploading… ${Math.round(file.progress * 100)}%`
                : "Uploading…"
              : file.status === "indexing"
                ? "Indexing…"
                : file.error
                  ? file.error
                  : file.status === "unsupported"
                    ? "Stored, but no text could be read from it"
                    : `${sizeLabel(file.size)}${
                        file.chunkCount !== undefined
                          ? ` · ${file.chunkCount} indexed chunk${file.chunkCount === 1 ? "" : "s"}`
                          : file.pageCount
                            ? ` · ${file.pageCount} page${file.pageCount === 1 ? "" : "s"}`
                            : file.reading === "none" ||
                                (file.reading === undefined && file.hasText === false)
                              ? " · no text"
                              : ""
                      }`}
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
  artifactIntent = false,
}: {
  chatId?: string;
  projectId?: string;
  initialPrompt?: string;
  initialMode?: Mode;
  compact?: boolean;
  artifactIntent?: boolean;
}) {
  const {
    preferences,
    updatePreferences,
    send,
    activeRun,
    stop,
    toast,
    edit,
    setEdit,
    messages,
  } = useWorkspace();
  const { models } = useSession();
  const [text, setText] = useState(initialPrompt),
    [mode, setMode] = useState<Mode>(initialMode || preferences.defaultMode),
    [files, setFiles] = useState<Attachment[]>([]),
    [dragging, setDragging] = useState(false),
    [artifact, setArtifact] = useState(artifactIntent);
  const textarea = useRef<HTMLTextAreaElement>(null),
    input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const mounted = useRef(true);
  // Only a live conversation is an inline reply surface. Project and artifact composers keep
  // their room for longer prompts even though they also use the compact prop for placement.
  const inlineReply = compact && Boolean(chatId);

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
  // A visual's suggested follow-up lands here for the user to send (ADR-0035). Only the live
  // conversation's composer takes it.
  useEffect(() => {
    if (!chatId) return;
    const onCompose = (event: Event) => {
      const suggested = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof suggested !== "string" || !suggested) return;
      setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${suggested}` : suggested));
      textarea.current?.focus();
    };
    window.addEventListener(COMPOSE_EVENT, onCompose);
    return () => window.removeEventListener(COMPOSE_EVENT, onCompose);
  }, [chatId]);
  useEffect(() => {
    if (artifactIntent) setArtifact(true);
  }, [artifactIntent]);
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
          inlineReply
            ? Math.min(480, Math.round(window.innerHeight * 0.42))
            : 240,
          Math.max(inlineReply ? 34 : compact ? 46 : 70, textarea.current.scrollHeight),
        ) + "px";
    }
  }, [text, compact, inlineReply]);

  const busy = !!activeRun;
  const ownRun = activeRun === chatId;
  const grounded = models?.capabilities.groundedSearch ?? true;
  const followUpSuggestion = useMemo(() => {
    if (!chatId) return "";
    return deriveFollowUpSuggestion(messages[chatId] ?? []);
  }, [chatId, messages]);
  const showFollowUp = inlineReply && !text && !files.length && !artifact && !edit;

  /**
   * Upload each file as it is chosen.
   *
   * The id the server returns is what `generate` needs in `attachmentIds`, so a file that is
   * still uploading blocks send — a message that referenced an id the server had not issued
   * would simply drop the attachment.
   */
  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const selected = Array.from(list).slice(0, 10 - files.length);
    if (!selected.length) {
      toast("You can attach up to 10 files.");
      return;
    }
    for (const file of selected) {
      const problem = validateFile(file, MAX_ATTACHMENT_BYTES);
      const localId = `upload-${crypto.randomUUID()}`;
      setFiles((f) => [
        ...f,
        {
          id: localId,
          name: file.name,
          size: file.size,
          type: file.type,
          status: problem ? "unsupported" : "uploading",
          ...(problem ? { error: problem } : {}),
        },
      ]);
      if (problem) continue;
      try {
        const uploaded = await api.files.upload(file, (progress) => {
          if (mounted.current)
            setFiles((f) => f.map((x) => (x.id === localId ? { ...x, progress } : x)));
        });
        if (mounted.current)
          setFiles((f) =>
            f.map((x) => (x.id === localId ? toAttachment(uploaded) : x)),
          );
      } catch (error) {
        if (mounted.current)
          setFiles((f) =>
            f.map((x) =>
              x.id === localId
                ? {
                    ...x,
                    status: "failed",
                    error:
                      error instanceof ApiError
                        ? error.detail
                        : "The upload failed. Remove the file and try again.",
                  }
                : x,
            ),
          );
      }
    }
  }

  const removeFile = (file: Attachment) => {
    setFiles((all) => all.filter((x) => x.id !== file.id));
    // Only server-side rows need deleting; a rejected file was never sent.
    if (file.downloadUrl) void api.files.remove(file.id).catch(() => {});
  };

  const pending = files.some((f) => f.status === "uploading");
  const unusable = files.some(
    (f) => f.status === "failed" || f.status === "unsupported",
  );

  const submit = () => {
    if (busy || pending || (!text.trim() && !files.length)) return;
    const ready = files.filter(
      (f) => f.status === "ready" || f.status === "unsupported",
    );
    send(text, mode, ready, chatId, projectId, artifact || artifactIntent);
    setText("");
    setFiles([]);
    setArtifact(artifactIntent);
  };

  const modeIcon =
    mode === "chat" ? (
      <MessageCircleMore size={16} />
    ) : mode === "search" ? (
      <Globe2 size={16} />
    ) : (
      <Telescope size={16} />
    );

  const modelItems = [
    ...(models
      ? [
          {
            label: models.auto.alias,
            description: models.auto.available
              ? models.auto.description
              : models.auto.detail,
            selected: preferences.modelAlias === models.auto.alias,
            disabled: !models.auto.available,
            onSelect: () =>
              updatePreferences({ modelAlias: models.auto.alias }),
          },
          ...models.models.map((model, index) => ({
            label: model.alias,
            // An unavailable model says why, in the server's words, instead of vanishing.
            description: model.available ? model.description : model.detail,
            selected: model.alias === preferences.modelAlias,
            disabled: !model.available,
            separator: index === 0,
            onSelect: () => updatePreferences({ modelAlias: model.alias }),
          })),
        ]
      : [{ label: "Loading models…", disabled: true }]),
  ];

  const effortControl = useMemo(
    () =>
      describeEffortControl(
        models,
        preferences.modelAlias,
        preferences.effort,
        chatId ? (messages[chatId] ?? []) : [],
      ),
    [models, preferences.modelAlias, preferences.effort, chatId, messages],
  );

  return (
    <div className="composer-wrap">
      {edit && edit.chatId === chatId && (
        <div className="edit-notice">
          Sending this continues in a new branch; the original conversation
          stays as it is.
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
        className={`composer ${inlineReply ? "composer-inline" : ""} ${dragging ? "dragging" : ""}`}
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
                onRemove={() => removeFile(f)}
              />
            ))}
          </div>
        )}
        {artifact && (
          <div className="composer-context">
            <PanelsTopLeft size={14} />
            {artifactIntent
              ? "Create an artifact with AI"
              : "Save the response as an artifact"}
            {!artifactIntent && (
              <button
                aria-label="Cancel artifact creation"
                onClick={() => setArtifact(false)}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
        <div className="composer-input">
          {showFollowUp && followUpSuggestion && (
            <div className="composer-suggestion" aria-hidden="true">
              <span>{followUpSuggestion}</span>
              <kbd>Tab</kbd>
            </div>
          )}
          <textarea
            ref={textarea}
            aria-label={
              showFollowUp && followUpSuggestion
                ? `Your message. Suggested follow-up: ${followUpSuggestion}. Press Tab to use it.`
                : "Your message"
            }
            placeholder={
              artifactIntent
                ? "Describe the artifact you want to create…"
                : chatId
                ? ""
                : "Ask a question. Follow a thought."
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // A pasted file (a screenshot) attaches, and a long paste becomes a text file,
              // as claude.ai turns it into a "pasted text" attachment instead of message text.
              const pastedFiles = Array.from(e.clipboardData.files);
              const asFile = pastedFiles.length ? null : pastedTextFile(e.clipboardData.getData("text/plain"));
              if (!pastedFiles.length && !asFile) return;
              e.preventDefault();
              void addFiles(pastedFiles.length ? pastedFiles : [asFile!]);
            }}
            onKeyDown={(e) => {
              if (
                (e.key === "Tab" || e.key === "ArrowRight") &&
                showFollowUp &&
                followUpSuggestion
              ) {
                e.preventDefault();
                setText(followUpSuggestion);
                window.requestAnimationFrame(() => {
                  const end = followUpSuggestion.length;
                  textarea.current?.setSelectionRange(end, end);
                });
                return;
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                (preferences.enterToSend || e.ctrlKey || e.metaKey)
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
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
                      ".pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.yml,.yaml,.xml,.sql,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.ogg,.flac,.aac,.mp4,.webm,.mov";
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
                label: "Save response as artifact",
                description: "Keep this reply as an editable document",
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
                description: grounded
                  ? "A quick answer with references"
                  : models?.capabilities.detail,
                icon: <Globe2 size={16} />,
                selected: mode === "search",
                disabled: !grounded,
                onSelect: () => setMode("search"),
              },
              {
                label: "Research",
                description: grounded
                  ? "Explore evidence in more depth"
                  : models?.capabilities.detail,
                icon: <Telescope size={16} />,
                selected: mode === "research",
                disabled: !grounded,
                onSelect: () => setMode("research"),
              },
            ]}
          />
          <div className="spacer" />
          <Dropdown
            label="Model selection"
            side="top"
            align="end"
            trigger={
              <button
                className="quiet-button model-button"
                aria-label={`Model: ${preferences.modelAlias}`}
              >
                {preferences.modelAlias}
                <ChevronDown size={13} />
              </button>
            }
            items={modelItems}
          />
          {effortControl && (
            <Dropdown
              label="Reasoning effort"
              side="top"
              align="end"
              trigger={
                <button
                  className="quiet-button effort-button"
                  aria-label={effortControl.ariaLabel}
                >
                  {effortControl.buttonLabel}
                  <ChevronDown size={13} />
                </button>
              }
              items={effortControl.items.map((item) => ({
                label: item.label,
                description: item.description,
                selected: item.selected,
                onSelect: () => updatePreferences({ effort: item.level }),
              }))}
            />
          )}
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
              disabled={busy || pending || (!text.trim() && !files.length)}
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
      {(pending || unusable) && (
        <p className="composer-disclaimer">
          {pending
            ? "Waiting for uploads to finish…"
            : "Files marked with a warning are sent without their text."}
        </p>
      )}
    </div>
  );
}
