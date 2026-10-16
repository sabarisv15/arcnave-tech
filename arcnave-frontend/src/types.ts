/**
 * The shapes the interface renders, and the mapping from the API's shapes to them.
 *
 * These are deliberately thin: field renames and a couple of derived flags, nothing more. Any
 * value the server does not send is absent here rather than defaulted, so a screen cannot show
 * a number the backend never measured. The DTOs themselves live in `api.ts`.
 */
import { api } from "./api";
import type { UIBlock } from "./generative-ui/types";
import type {
  ArtifactDto,
  AttachmentDto,
  ChatDto,
  MessageAttachmentDto,
  MessageDto,
  PreferencesDto,
  ProjectDto,
  ProjectFileDto,
  ResearchEventDto,
  SavedSourceDto,
  SourceDto,
  ToolCallDto,
  ToolContentDto,
  UsageDto,
} from "./api";

export type Mode = "chat" | "search" | "research";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const REASONING_EFFORT_LADDER: readonly ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * The effort level that will actually apply on a model: the requested level, or the highest
 * level below it that the model accepts. Undefined when the model exposes no effort levels.
 */
export function resolveEffortForModel(
  supported: readonly string[],
  requested: ReasoningEffort,
): ReasoningEffort | undefined {
  for (let i = REASONING_EFFORT_LADDER.indexOf(requested); i >= 0; i -= 1) {
    const candidate = REASONING_EFFORT_LADDER[i]!;
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] as ReasoningEffort | undefined;
}

export type RunStatus =
  "idle" | "submitting" | "generating" | "stopped" | "complete" | "error";

/** Stage names come from the server; this lists the ones the UI styles, not a closed set. */
export type ResearchStage =
  | "idle"
  | "planning"
  | "searching"
  | "reading"
  | "synthesizing"
  | "complete"
  | "partial"
  | "error"
  | (string & {});

export interface Source {
  /** The citation ordinal within one answer — what `[1]` in the text refers to. */
  id: number;
  title: string;
  domain: string;
  url: string;
  type: string;
  snippet: string;
  passage?: string;
  /** When the source was retrieved, ISO 8601. Absent when the provider did not say. */
  retrievedAt?: string;
  /**
   * The provider gave a citation whose URL could not be resolved to a real address. The link
   * is shown as unavailable rather than quietly dropped or quietly followed.
   */
  unresolved?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  /**
   * uploading | queued | scanning | extracting | ocr | transcribing | indexing | ready |
   * failed (| unsupported, rows from before the file pipeline; pending for project files)
   */
  status: string;
  error?: string;
  /** Stage 15 ER-9 code of a failed file. */
  errorCode?: string;
  /** Members of a ZIP, each its own attachment. */
  memberIds?: string[];
  /** Absent while the upload is still in flight and the server has no id for it yet. */
  downloadUrl?: string;
  /** Whether this file contributes text to the prompt. Undefined means not yet known. */
  hasText?: boolean;
  /** Project files only: how many indexed chunks retrieval can see. */
  chunkCount?: number;
  /** While uploading: how much has been sent, 0 to 1. */
  progress?: number;
  /** Pages in a PDF. */
  pageCount?: number | null;
  /** How a model is shown this file: text+visual | text | visual | media | none. */
  reading?: string;
}

export interface ResearchEvent {
  stage: ResearchStage;
  label: string;
  detail: string;
  /** ISO 8601 from the server. */
  at: string | null;
}

export interface ToolCall {
  toolCallId: string;
  name: string;
  input: unknown;
  /** Absent while the call is still in flight — the live SSE stream shows a `tool_use` frame
   *  before the matching `tool_result` arrives; a reloaded transcript never sees this state. */
  ok?: boolean;
  /** The full result, only present once a reload re-fetches the persisted transcript. */
  content?: ToolContentDto[];
  /** The short wire preview from the live SSE `tool_result` frame — present as soon as the
   *  call finishes, before any reload; superseded by `content` once one happens. */
  preview?: string;
  at?: string | null;
}

/** One question of ask_user_input_v0 (ADR-0048). */
export interface AskUserQuestion {
  question: string;
  type: "single_select" | "multi_select" | "rank_priorities";
  options: string[];
}

export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** False means the provider reported nothing; the counts are zeros, not measurements. */
  exact: boolean;
  costUsd: number | null;
  costInr: number | null;
}

/** One stretch of an answer, in the order it happened. */
export type MessageSegment =
  | { type: "ui"; blockIds: string[] }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tools"; toolCallIds: string[] };

/** Adds a streamed piece to the answer's timeline: text and thinking extend a run of their own
 *  kind, a tool call extends a run of calls. Returns a new array. */
export function appendSegment(
  segments: MessageSegment[] | undefined,
  piece: { type: "thinking" | "text"; text: string } | { type: "tool"; toolCallId: string } | { type: "ui"; blockId: string },
): MessageSegment[] {
  const out = [...(segments ?? [])];
  const last = out.at(-1);
  if (piece.type === "ui") {
    if (last?.type === "ui") out[out.length - 1] = { type: "ui", blockIds: [...last.blockIds, piece.blockId] };
    else out.push({ type: "ui", blockIds: [piece.blockId] });
  } else if (piece.type === "tool") {
    if (last?.type === "tools") out[out.length - 1] = { type: "tools", toolCallIds: [...last.toolCallIds, piece.toolCallId] };
    else out.push({ type: "tools", toolCallIds: [piece.toolCallId] });
  } else if (last && last.type === piece.type) {
    out[out.length - 1] = { type: piece.type, text: last.text + piece.text };
  } else {
    out.push({ type: piece.type, text: piece.text });
  }
  return out;
}

export interface Message {
  id: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  mode: Mode;
  status: RunStatus;
  sources?: Source[];
  events?: ResearchEvent[];
  toolCalls?: ToolCall[];
  uiBlocks?: UIBlock[];
  /** Visuals the model is still writing (ADR-0037); shown while streaming, never stored. */
  visualDrafts?: VisualDraft[];
  codeBlocks?: { code?: string; language?: string; output?: string }[];
  researchStage?: ResearchStage;
  questions?: string[];
  artifactId?: string;
  attachments?: Attachment[];
  feedback?: "up" | "down";
  /** A machine-readable error code from the server, never prose. */
  error?: string;
  /** Live-stream copy for the error above, when the frame carried it. */
  errorTitle?: string;
  errorDetail?: string;
  modelAlias?: string;
  effort?: ReasoningEffort;
  providerModelId?: string;
  /** The model's thought summary, shown collapsed above the answer. */
  thinking?: string;
  /** Thinking, text and tool steps in order. Absent on answers stored before it existed. */
  segments?: MessageSegment[];
  createdAt?: string | null;
  usage?: MessageUsage;
  /** The provider's stop reason as stored, e.g. "MAX_TOKENS" when the answer hit its limit. */
  finishReason?: string;
  /** Other versions of an edited prompt (ADR-0038): `chatId` opens each one. */
  versions?: { index: number; chatIds: string[] };
}

/**
 * Why a completed answer stopped early, or null when it ended normally. A cut-off answer is
 * shown as such, never as a finished one (Invariant 1). `partial`: the model failed after a tool
 * had already run, and the tool was not run again (ADR-0064).
 */
export function cutOffReason(finishReason: string | undefined): "output_limit" | "tool_limit" | "partial" | null {
  if (!finishReason) return null;
  const r = finishReason.toLowerCase();
  if (r === "max_tokens" || r === "length") return "output_limit";
  if (r === "tool_limit") return "tool_limit";
  if (r === "partial") return "partial";
  return null;
}

export interface Chat {
  id: string;
  /** The conversation this chat is a version of (ADR-0038); its own id when never edited. */
  familyId: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  /** Optimistic-concurrency counter. Send it back on a write to detect a clobber. */
  version: number;
  updatedAt: string | null;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  instructions: string;
  pinned: boolean;
  position: number;
  version: number;
  updatedAt: string | null;
  counts: {
    files: number;
    chats: number;
    sources: number;
    indexedChunks: number;
  };
}

export interface SavedSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  type: string;
  snippet: string;
  retrievedAt: string | null;
}

export interface Artifact {
  id: string;
  title: string;
  kind: "document" | "code" | "webpage" | "svg" | "slides";
  projectId: string | null;
  chatId: string | null;
  /** Which version the artifact currently points at. */
  currentVersion: number;
  version: number;
  updatedAt: string | null;
}

export interface Preferences {
  theme: "light" | "dark" | "system";
  font: "sans" | "system" | "dyslexic";
  modelAlias: string;
  effort: ReasoningEffort | null;
  instructions: string;
  enterToSend: boolean;
  reducedMotion: boolean;
  defaultMode: Mode;
  saveHistory: boolean;
  /** Memory files are read and saved in chats (Settings > Personalization). */
  memoryEnabled: boolean;
  /** Past chats can be searched and opened in chats (Settings > Personalization). */
  chatSearchEnabled: boolean;
  styleId: string;
  version: number;
}

export type Panel =
  | { kind: "closed" }
  | { kind: "sources"; chatId: string; messageId: string; selected?: number }
  | { kind: "research"; chatId: string; messageId: string }
  | { kind: "artifact"; id: string }
  | { kind: "file"; file: Attachment };

/* -------------------------------------------------------------------------- mapping */

export function toSource(dto: SourceDto): Source {
  return {
    id: dto.id,
    title: dto.title,
    domain: dto.domain,
    url: dto.url,
    type: dto.type,
    snippet: dto.snippet,
    ...(dto.passage ? { passage: dto.passage } : {}),
    ...(dto.retrievedAt ? { retrievedAt: dto.retrievedAt } : {}),
    ...(dto.urlResolved ? {} : { unresolved: true }),
  };
}

export function toResearchEvent(dto: ResearchEventDto): ResearchEvent {
  return { stage: dto.stage, label: dto.label, detail: dto.detail, at: dto.at };
}

export function toToolCall(dto: ToolCallDto): ToolCall {
  return {
    toolCallId: dto.toolCallId,
    name: dto.name,
    input: dto.input,
    ok: dto.ok,
    content: dto.content,
    at: dto.at,
  };
}

export function toUsage(dto: UsageDto): MessageUsage {
  return {
    inputTokens: dto.inputTokens,
    outputTokens: dto.outputTokens,
    totalTokens: dto.totalTokens,
    cacheReadTokens: dto.cacheReadTokens,
    cacheWriteTokens: dto.cacheWriteTokens,
    exact: dto.exact,
    costUsd: dto.costUsd,
    costInr: dto.costInr,
  };
}

export function toMessageAttachment(dto: MessageAttachmentDto): Attachment {
  return {
    id: dto.id,
    name: dto.filename,
    size: dto.sizeBytes,
    type: dto.mimeType,
    status: dto.status,
    ...(dto.error ? { error: dto.error } : {}),
    downloadUrl: api.files.downloadUrl(dto.id),
  };
}

export function toAttachment(dto: AttachmentDto): Attachment {
  return {
    id: dto.id,
    name: dto.filename,
    size: dto.sizeBytes,
    type: dto.mimeType,
    status: dto.status,
    ...(dto.error ? { error: dto.error } : {}),
    ...(dto.errorCode ? { errorCode: dto.errorCode } : {}),
    ...(dto.memberIds?.length ? { memberIds: dto.memberIds } : {}),
    hasText: dto.hasText,
    ...(dto.pageCount != null ? { pageCount: dto.pageCount } : {}),
    ...(dto.reading ? { reading: dto.reading } : {}),
    downloadUrl: api.files.downloadUrl(dto.id),
  };
}

export function toProjectFile(dto: ProjectFileDto): Attachment {
  return {
    id: dto.id,
    name: dto.filename,
    size: dto.sizeBytes,
    type: dto.mimeType,
    status: dto.status,
    // A ready file's warnings (E4 `chunk_cap`) are shown where an error would be: never silent.
    ...(dto.error
      ? { error: dto.error }
      : dto.warnings?.length
        ? { error: dto.warnings.map((w) => w.detail).join(" ") }
        : {}),
    ...(dto.errorCode ? { errorCode: dto.errorCode } : {}),
    chunkCount: dto.chunkCount,
    hasText: dto.status === "ready" && dto.chunkCount > 0,
    downloadUrl: api.projects.fileDownloadUrl(dto.projectId, dto.id),
  };
}

export function toMessage(dto: MessageDto): Message {
  // A transcript can contain messages written before a field was introduced, or be read while
  // the frontend and API revisions are rolling out independently. Evidence collections are
  // optional at the wire boundary, so an absent collection means "not supplied", not a reason
  // to take down the entire workspace.
  const sources = Array.isArray(dto.sources) ? dto.sources : [];
  const events = Array.isArray(dto.events) ? dto.events : [];
  const toolCalls = Array.isArray(dto.toolCalls) ? dto.toolCalls : [];
  const attachments = Array.isArray(dto.attachments) ? dto.attachments : [];
  const questions = Array.isArray(dto.questions) ? dto.questions : [];

  const uiBlocks = uiBlocksOf(toolCalls);

  return {
    id: dto.id,
    seq: dto.seq,
    role: dto.role === "user" ? "user" : "assistant",
    text: dto.text,
    mode: (dto.mode as Mode) ?? "chat",
    status: dto.status as RunStatus,
    ...(sources.length ? { sources: sources.map(toSource) } : {}),
    ...(events.length ? { events: events.map(toResearchEvent) } : {}),
    ...(toolCalls.length ? { toolCalls: toolCalls.map(toToolCall) } : {}),
    ...(uiBlocks.length ? { uiBlocks } : {}),
    ...(dto.researchStage ? { researchStage: dto.researchStage } : {}),
    ...(questions.length ? { questions } : {}),
    ...(dto.artifactId ? { artifactId: dto.artifactId } : {}),
    ...(attachments.length
      ? { attachments: attachments.map(toMessageAttachment) }
      : {}),
    ...(dto.feedback === "up" || dto.feedback === "down"
      ? { feedback: dto.feedback }
      : {}),
    ...(dto.errorCode ? { error: dto.errorCode } : {}),
    ...(dto.modelAlias ? { modelAlias: dto.modelAlias } : {}),
    ...(dto.effort && REASONING_EFFORT_LADDER.includes(dto.effort as ReasoningEffort)
      ? { effort: dto.effort as ReasoningEffort }
      : {}),
    ...(dto.providerModelId ? { providerModelId: dto.providerModelId } : {}),
    ...(dto.thinking ? { thinking: dto.thinking } : {}),
    ...(dto.segments && dto.segments.length > 0 ? { segments: dto.segments } : {}),
    ...(dto.createdAt ? { createdAt: dto.createdAt } : {}),
    ...(dto.usage ? { usage: toUsage(dto.usage) } : {}),
    ...(dto.finishReason ? { finishReason: dto.finishReason } : {}),
    ...(dto.versions && dto.versions.versions.length > 1
      ? { versions: { index: dto.versions.index, chatIds: dto.versions.versions.map((v) => v.chatId) } }
      : {}),
  };
}

export function toChat(dto: ChatDto): Chat {
  return {
    id: dto.id,
    familyId: dto.familyId ?? dto.id,
    title: dto.title,
    projectId: dto.projectId,
    pinned: dto.pinned,
    version: dto.version,
    updatedAt: dto.updatedAt,
  };
}

export function toProject(dto: ProjectDto): Project {
  return {
    id: dto.id,
    title: dto.title,
    description: dto.description,
    instructions: dto.instructions,
    pinned: dto.pinned,
    position: dto.position,
    version: dto.version,
    updatedAt: dto.updatedAt,
    counts: dto.counts,
  };
}

export function toSavedSource(dto: SavedSourceDto): SavedSource {
  return {
    id: dto.id,
    title: dto.title,
    url: dto.url,
    domain: dto.domain,
    type: dto.type,
    snippet: dto.snippet,
    retrievedAt: dto.retrievedAt,
  };
}

export function toArtifact(dto: ArtifactDto): Artifact {
  return {
    id: dto.id,
    title: dto.title,
    kind: (dto.kind === "code" || dto.kind === "webpage" || dto.kind === "svg" || dto.kind === "slides"
      ? dto.kind
      : "document") as Artifact["kind"],
    projectId: dto.projectId,
    chatId: dto.chatId,
    currentVersion: dto.currentVersion,
    version: dto.version,
    updatedAt: dto.updatedAt,
  };
}

export function toPreferences(dto: PreferencesDto): Preferences {
  return {
    theme: dto.theme === "light" || dto.theme === "dark" ? dto.theme : "system",
    // "serif" was an older option; chat text already showed it as the default font.
    font: dto.font === "system" || dto.font === "dyslexic" ? dto.font : "sans",
    modelAlias: dto.modelAlias,
    effort:
      dto.effort && REASONING_EFFORT_LADDER.includes(dto.effort as ReasoningEffort)
        ? (dto.effort as ReasoningEffort)
        : null,
    instructions: dto.instructions,
    enterToSend: dto.enterToSend,
    reducedMotion: dto.reducedMotion,
    defaultMode: (["chat", "search", "research"] as const).includes(
      dto.defaultMode as Mode,
    )
      ? (dto.defaultMode as Mode)
      : "chat",
    saveHistory: dto.saveHistory,
    memoryEnabled: dto.memoryEnabled ?? true,
    chatSearchEnabled: dto.chatSearchEnabled ?? true,
    styleId: dto.styleId ?? "normal",
    version: dto.version,
  };
}

/**
 * A state updater that gives the placeholder row its server id. The ids are fixed when the
 * updater is made: React may run it later, after the caller has moved on to the real id, and an
 * updater that read a changing variable then matched nothing and left the row on "Sending
 * request" for the whole turn.
 */
export function adoptServerId(
  placeholderId: string,
  realId: string,
  patch: Partial<Message>,
): (messages: Message[]) => Message[] {
  return (messages) =>
    messages.map((m) => (m.id === placeholderId ? { ...m, ...patch, id: realId } : m));
}

/** The display cards (ADR-0048). */
export const DISPLAY_TOOLS = new Set([
  "chart_display_v0",
  "comparison_card_display_v0",
  "featured_card_display_v0",
  "itinerary_display_v0",
  "link_preview_display_v0",
  "message_compose_v1",
  "options_card_display_v0",
  "places_list_display_v0",
  "product_carousel_display_v0",
  "quiz_display_v0",
  "recipe_display_v0",
  "step_card_display_v0",
  "translation_display_v0",
]);

/** Tools drawn in the reply (a visual, a card, the question card) rather than listed as a step. */
export const DRAWN_TOOLS = new Set(["render_ui", "show_widget", "read_me", "ask_user_input_v0", "ask_user_options", ...DISPLAY_TOOLS]);

/**
 * A stored reply's visuals and cards, rebuilt from its tool calls the way the server streamed
 * them. A card's block is `display_<toolCallId>` with the call's arguments (and the photos its
 * result holds); a visual's markup is in the call, since its stored result has only the size.
 */
export function uiBlocksOf(
  calls: Array<{ toolCallId: string; name: string; ok?: boolean; input?: unknown; content?: Array<{ type: string; data?: unknown }> }>,
): UIBlock[] {
  const out: UIBlock[] = [];
  for (const call of calls) {
    if (call.ok !== true) continue;
    const json = call.content?.find((c) => c.type === "json")?.data as Record<string, unknown> | undefined;
    if (DISPLAY_TOOLS.has(call.name)) {
      const data = { ...((call.input ?? {}) as Record<string, unknown>) };
      if (Array.isArray(json?.photos)) data.photos = json.photos;
      out.push({ blockId: `display_${call.toolCallId}`, sequence: 1, type: "display", tool: call.name, data });
    } else if ((call.name === "render_ui" || call.name === "show_widget") && Array.isArray(json?.blocks)) {
      out.push(...withVisualHtml(json.blocks as UIBlock[], call.input));
    }
  }
  return out;
}

/**
 * The stored result carries a visual's size, not its HTML (ADR-0035): the HTML is in the call's
 * input, as show_widget's `widget_code` or at the block's position in an older render_ui call
 * (`sequence` is 1-based over the input's blocks).
 */
export function withVisualHtml(blocks: UIBlock[], input: unknown): UIBlock[] {
  const raw = (input && typeof input === "object" ? input : {}) as { blocks?: unknown; widget_code?: unknown };
  const inputBlocks = Array.isArray(raw.blocks) ? (raw.blocks as unknown[]) : [];
  return blocks.map((b) => {
    if (b.type !== "visual" || typeof b.html === "string") return b;
    if (typeof raw.widget_code === "string") return { ...b, html: raw.widget_code };
    const source = inputBlocks[b.sequence - 1] as { type?: unknown; html?: unknown } | undefined;
    return source?.type === "visual" && typeof source.html === "string" ? { ...b, html: source.html } : b;
  });
}

export interface VisualDraft {
  id: string;
  title: string;
  html: string;
}

/**
 * Adds one `ui_draft` piece. A piece that starts at 0 begins the draft again (a retried
 * request); one that does not continue exactly where the draft ends is dropped rather than
 * spliced in the wrong place.
 */
export function applyVisualDraft(
  drafts: VisualDraft[] | undefined,
  piece: { draftId: string; title: string; from: number; text: string },
): VisualDraft[] {
  const all = drafts ?? [];
  const existing = all.find((d) => d.id === piece.draftId);
  if (piece.from === 0) {
    const fresh = { id: piece.draftId, title: piece.title, html: piece.text };
    return existing ? all.map((d) => (d.id === piece.draftId ? fresh : d)) : [...all, fresh];
  }
  if (!existing || existing.html.length !== piece.from) return all;
  return all.map((d) => (d.id === piece.draftId ? { ...d, title: piece.title || d.title, html: d.html + piece.text } : d));
}
