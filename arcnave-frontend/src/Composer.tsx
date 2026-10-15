import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PenLine,
  Plus,
  Square,
  Telescope,
  TriangleAlert,
  X,
  PanelsTopLeft,
  RotateCcw,
} from "lucide-react";
import { ApiError, api } from "./api";
import type { AttachmentDto, ModelsDto, StyleDto, StylePresetDto } from "./api";
import type { Attachment, Message, Mode, ReasoningEffort } from "./types";
import { DictationButton } from "./Dictation";
import {
  REASONING_EFFORT_LADDER,
  resolveEffortForModel,
  toAttachment,
} from "./types";
import { MAX_ATTACHMENT_BYTES, sizeLabel, validateFile } from "./storage";
import { filesBlockSend, isBroken, isSettled, pollFile, stageLabel } from "./fileStates";
import { Dropdown, IconButton } from "./ui";
import { useSession } from "./session";
import { useWorkspace } from "./workspace";
import StylesModal, { BUILTIN_STYLE_PRESETS } from "./StylesModal";

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
  defaultLevel: ReasoningEffort;
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

  // The same default the server uses when no effort is chosen, stepped down the same way.
  const defaultLevel = resolveEffortForModel(supported, models?.defaultEffort ?? "medium") ?? supported[0]!;
  const requested: ReasoningEffort = savedEffort ?? defaultLevel;
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
    // Each model's recommended level is marked "Default".
    label: level === defaultLevel ? `${EFFORT_COPY[level].label} · Default` : EFFORT_COPY[level].label,
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
    defaultLevel,
    steppedDown,
    buttonLabel,
    ariaLabel,
    items,
  };
}

/**
 * Pastes longer than this become an attached text file, past a few
 * thousand characters; this number is ArcNave's.
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
  const latestAssistant = history.at(-1);
  if (latestAssistant?.role !== "assistant" || latestAssistant.status !== "complete") return "";
  // suggest_next_actions was removed (ADR-0046); only messages saved before carry it.
  const proposal = [...(latestAssistant?.toolCalls ?? [])].reverse().find((call) => call.name === "suggest_next_actions" && call.ok === true);
  if (proposal && proposal.input && typeof proposal.input === "object") {
    const composer = (proposal.input as Record<string, unknown>).composer;
    if (typeof composer === "string" && composer.length <= 180) return composer.trim();
  }
  return "";
}

export function AttachmentChip({
  file,
  onRemove,
  onRetry,
}: {
  file: Attachment;
  onRemove?: () => void;
  /** Shown on a failed file (AS-D6: every failure offers Retry and Remove). */
  onRetry?: () => void;
}) {
  const { setPanel } = useWorkspace();
  const broken = isBroken(file.status);
  const openable = file.status === "ready" && !!file.downloadUrl;
  const stage = stageLabel(file);
  return (
    <div className={`attachment-chip ${broken ? "failed" : ""}`}>
      <button
        className="attachment-main"
        onClick={() => openable && setPanel({ kind: "file", file })}
        disabled={!openable}
      >
        {stage ? (
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
            {stage
              ? stage
              : file.error
                ? file.error
                : broken
                  ? "This file could not be read."
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
      {broken && onRetry && (
        <IconButton label={`Retry ${file.name}`} onClick={onRetry}>
          <RotateCcw size={14} />
        </IconButton>
      )}
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
    messages,
    quote,
    consumeQuote,
  } = useWorkspace();
  const { models } = useSession();
  const [text, setText] = useState(initialPrompt),
    [mode, setMode] = useState<Mode>(initialMode || preferences.defaultMode),
    [files, setFiles] = useState<Attachment[]>([]),
    [dragging, setDragging] = useState(false),
    [artifact, setArtifact] = useState(artifactIntent),
    [stylePresets, setStylePresets] = useState<StylePresetDto[]>(
      BUILTIN_STYLE_PRESETS,
    ),
    [customStyles, setCustomStyles] = useState<StyleDto[]>([]),
    [stylesModalOpen, setStylesModalOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null),
    input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const mounted = useRef(true);
  // Only a live conversation is an inline reply surface. Project and artifact composers keep
  // their room for longer prompts even though they also use the compact prop for placement.
  const inlineReply = compact && Boolean(chatId);

  const refreshStyles = useCallback(async () => {
    try {
      const list = await api.styles?.list?.();
      if (!mounted.current || !list) return;
      if (Array.isArray(list.presets) && list.presets.length > 0) {
        setStylePresets(list.presets);
      }
      if (Array.isArray(list.items)) {
        setCustomStyles(list.items);
      }
    } catch {
      /* Built-in presets remain available if the request fails. */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshStyles();
    return () => {
      mounted.current = false;
    };
  }, [refreshStyles]);
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
  // Each composer instance pastes a quote once. A quote for one chat stays until it is sent or
  // the user leaves that chat, because the conversation's composer can remount while the chat
  // loads and a fresh instance must paste it again. The composer of the page being left does
  // not take a quote meant for another chat. A quote with no chat is used up when pasted.
  const takenQuote = useRef<number | null>(null);
  useEffect(() => {
    if (quote?.text && takenQuote.current !== quote.timestamp && (!quote.chatId || quote.chatId === chatId)) {
      takenQuote.current = quote.timestamp;
      if (!quote.chatId) consumeQuote(quote.timestamp);
      setText((prev) => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed}\n\n${quote.text}` : quote.text;
      });
      setTimeout(() => {
        if (textarea.current) {
          textarea.current.focus();
          const len = textarea.current.value.length;
          textarea.current.setSelectionRange(len, len);
        }
      }, 0);
    }
  }, [quote, consumeQuote, chatId]);
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
  // A message is being edited in its own bubble (ChatStates InlineEdit). Sending from here would
  // be taken as that edit, so the composer waits until the edit is sent or cancelled.
  const editing = !!edit && edit.chatId === chatId;
  const showFollowUp = inlineReply && !busy && !text && !files.length && !artifact && !editing;

  /** The picked File behind each chip, so a failed upload can be sent again by Retry. */
  const picked = useRef(new Map<string, File>());
  /** Polls in flight, stopped when the composer goes away. */
  const polls = useRef(new AbortController());
  useEffect(() => () => polls.current.abort(), []);

  const replaceChip = useCallback((id: string, next: Attachment | Attachment[]) => {
    if (!mounted.current) return;
    setFiles((all) => all.flatMap((x) => (x.id === id ? next : [x])));
  }, []);

  /**
   * Follows a file the server is reading until it settles. A ZIP that settles `ready` is
   * replaced by its members, each followed the same way (Stage 9 ZIP: members are files).
   */
  const follow = useCallback(
    async (dto: AttachmentDto) => {
      let last: AttachmentDto | null = dto;
      if (!isSettled(dto.status)) {
        last = await pollFile(dto.id, api.files.read, (update) => replaceChip(update.id, toAttachment(update)), {
          signal: polls.current.signal,
        });
      }
      if (!last || last.status !== "ready" || !last.memberIds?.length) return;
      const members = await Promise.all(last.memberIds.map((id) => api.files.read(id).catch(() => null)));
      const found = members.filter((m): m is AttachmentDto => m !== null);
      replaceChip(last.id, found.map(toAttachment));
      await Promise.all(found.map((m) => (isSettled(m.status) ? undefined : follow(m))));
    },
    [replaceChip],
  );

  /**
   * Upload one file into the chip `localId`, then follow the server's reading of it.
   *
   * The id the server returns is what `generate` needs in `attachmentIds`, so a file that is
   * still uploading or being read blocks send — the server would refuse it (`file_not_ready`).
   */
  async function uploadInto(localId: string, file: File) {
    try {
      const uploaded = await api.files.upload(file, (progress) => {
        if (mounted.current)
          setFiles((f) => f.map((x) => (x.id === localId ? { ...x, progress } : x)));
      });
      replaceChip(localId, toAttachment(uploaded));
      await follow(uploaded);
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
                      : "The upload failed. Retry, or remove the file.",
                }
              : x,
          ),
        );
    }
  }

  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const selected = Array.from(list).slice(0, 10 - files.length);
    if (!selected.length) {
      toast("You can attach up to 10 files.");
      return;
    }
    // Uploads run side by side: the server no longer reads one file at a time.
    await Promise.all(
      selected.map(async (file) => {
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
        if (problem) return;
        picked.current.set(localId, file);
        await uploadInto(localId, file);
      }),
    );
  }

  /** Retry: read a server-side failure again, or send a failed upload's bytes again. */
  const retryFile = async (file: Attachment) => {
    if (file.downloadUrl) {
      try {
        const queued = await api.files.retry(file.id);
        replaceChip(file.id, toAttachment(queued));
        await follow(queued);
      } catch (error) {
        toast(error instanceof ApiError ? error.detail : "The file could not be retried.");
      }
      return;
    }
    const original = picked.current.get(file.id);
    if (!original) return;
    setFiles((all) => all.map((x) => (x.id === file.id ? { ...x, status: "uploading", error: undefined } : x)));
    await uploadInto(file.id, original);
  };

  const removeFile = (file: Attachment) => {
    setFiles((all) => all.filter((x) => x.id !== file.id));
    picked.current.delete(file.id);
    // Only server-side rows need deleting; a rejected file was never sent.
    if (file.downloadUrl) void api.files.remove(file.id).catch(() => {});
  };

  const blocked = filesBlockSend(files);

  const submit = () => {
    if (editing || busy || blocked || (!text.trim() && !files.length)) return;
    send(text, mode, files, chatId, projectId, artifact || artifactIntent);
    if (quote) consumeQuote(quote.timestamp);
    setText("");
    setFiles([]);
    picked.current.clear();
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
  const modelMenu = (
    <Dropdown
      label="Model selection"
      side="top"
      align="end"
      trigger={
        <button
          type="button"
          className="cs-model-chip"
          aria-label={`Model: ${preferences.modelAlias}${effortControl ? `, ${effortControl.ariaLabel}` : ""}`}
        >
          <span className="cs-model-name">{preferences.modelAlias}</span>
          {effortControl && <span className="cs-model-effort">{effortControl.buttonLabel}</span>}
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      }
      items={[
        { label: "Model", heading: true },
        ...modelItems,
        // Effort lives in the model menu: the levels offered are the ones this model accepts.
        ...(effortControl
          ? [
              { label: "Effort", heading: true, separator: true },
              ...effortControl.items.map((item) => ({
                label: item.label,
                description: item.description,
                selected: item.selected,
                onSelect: () => updatePreferences({ effort: item.level }),
              })),
            ]
          : []),
      ]}
    />
  );
  const activeStyleId = preferences.styleId || "normal";
  const activeStyleName =
    stylePresets.find((p) => p.id === activeStyleId)?.name ??
    customStyles.find((s) => s.id === activeStyleId)?.name ??
    "Normal";

  const styleItems = [
    ...stylePresets.map((preset) => ({
      label: preset.name,
      description: preset.description,
      selected: activeStyleId === preset.id,
      onSelect: () => updatePreferences({ styleId: preset.id }),
    })),
    ...customStyles.map((style, index) => ({
      label: style.name,
      description:
        style.instructions.length > 72
          ? `${style.instructions.slice(0, 72)}…`
          : style.instructions,
      selected: activeStyleId === style.id,
      separator: index === 0,
      onSelect: () => updatePreferences({ styleId: style.id }),
    })),
    {
      label: "Create & edit styles",
      icon: <PenLine size={15} />,
      separator: true,
      onSelect: () => setStylesModalOpen(true),
    },
  ];

  return (
    <div className="composer-wrap">
      {/* Composer K3 on every screen that has one (docs/brand-extra/Fix-Composer.dc.html):
          lifted, green edge, leaf corners. A live conversation uses the reply corners. */}
      <div
        className={`composer composer-k3 ${inlineReply ? "composer-inline composer-k3-reply" : "composer-k3-new"} ${dragging ? "dragging" : ""}`}
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
                onRetry={() => void retryFile(f)}
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
                ? showFollowUp && followUpSuggestion
                  ? ""
                  : "Reply…"
                : "How can I help today? English, தமிழ், Tanglish…"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // A pasted file (a screenshot) attaches, and a long paste becomes a text file,
              // a "pasted text" attachment instead of message text.
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
                <span className="composer-control-label">{mode === "chat"
                  ? "Chat"
                  : mode === "search"
                    ? "Search"
                    : "Research"}</span>
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
          <Dropdown
            label="Use style"
            side="top"
            trigger={
              <button
                className={`quiet-button style-button ${activeStyleId !== "normal" ? "style-active" : ""}`}
                aria-label={`Use style: ${activeStyleName}`}
              >
                <PenLine size={15} />
                <span className="composer-control-label">{activeStyleName}</span>
                <ChevronDown size={13} />
              </button>
            }
            items={styleItems}
          />
          <div className="spacer" />
          <DictationButton text={text} setText={setText} onError={toast} disabled={!!ownRun} />
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
              aria-label="Send message"
              onClick={submit}
              disabled={editing || busy || !!blocked || (!text.trim() && !files.length)}
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
      {/* Under the composer (docs/brand-extra/Fix-Composer.dc.html): the model and effort on the
          right; in a conversation the reminder in the middle. */}
      <div className="composer-under">
        {inlineReply && <span className="composer-under-note">arcnave can make mistakes.</span>}
        {modelMenu}
      </div>
      {blocked && (
        <p className="composer-disclaimer">
          {blocked === "reading"
            ? "Waiting for files to finish reading…"
            : "Retry or remove the files marked with a warning to send."}
        </p>
      )}
      <StylesModal
        open={stylesModalOpen}
        onClose={() => setStylesModalOpen(false)}
        presets={stylePresets}
        customStyles={customStyles}
        activeStyleId={activeStyleId}
        onSelectStyle={(styleId) => updatePreferences({ styleId })}
        onStylesChanged={refreshStyles}
      />
    </div>
  );
}
