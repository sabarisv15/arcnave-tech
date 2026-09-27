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
  /** uploading | ready | failed | unsupported | pending | indexing */
  status: string;
  error?: string;
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

export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** False means the provider reported nothing; the counts are zeros, not measurements. */
  exact: boolean;
  costUsd: number | null;
}

/** One stretch of an answer, in the order it happened (as Claude shows it). */
export type MessageSegment =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tools"; toolCallIds: string[] };

/** Adds a streamed piece to the answer's timeline: text and thinking extend a run of their own
 *  kind, a tool call extends a run of calls. Returns a new array. */
export function appendSegment(
  segments: MessageSegment[] | undefined,
  piece: { type: "thinking" | "text"; text: string } | { type: "tool"; toolCallId: string },
): MessageSegment[] {
  const out = [...(segments ?? [])];
  const last = out.at(-1);
  if (piece.type === "tool") {
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
  providerModelId?: string;
  /** The model's thought summary, shown collapsed above the answer. */
  thinking?: string;
  /** Thinking, text and tool steps in order. Absent on answers stored before it existed. */
  segments?: MessageSegment[];
  createdAt?: string | null;
  usage?: MessageUsage;
  /** The provider's stop reason as stored, e.g. "MAX_TOKENS" when the answer hit its limit. */
  finishReason?: string;
}

/**
 * Why a completed answer stopped early, or null when it ended normally. A cut-off answer is
 * shown as such, never as a finished one (Invariant 1).
 */
export function cutOffReason(finishReason: string | undefined): "output_limit" | "tool_limit" | null {
  if (!finishReason) return null;
  const r = finishReason.toLowerCase();
  if (r === "max_tokens" || r === "length") return "output_limit";
  if (r === "tool_limit") return "tool_limit";
  return null;
}

export interface Chat {
  id: string;
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
  kind: "document" | "code" | "webpage";
  projectId: string | null;
  chatId: string | null;
  /** Which version the artifact currently points at. */
  currentVersion: number;
  version: number;
  updatedAt: string | null;
}

export interface Preferences {
  theme: "light" | "dark" | "system";
  font: "sans" | "serif";
  modelAlias: string;
  instructions: string;
  enterToSend: boolean;
  reducedMotion: boolean;
  defaultMode: Mode;
  saveHistory: boolean;
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
    ...(dto.error ? { error: dto.error } : {}),
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

  let uiBlocks: UIBlock[] | undefined;
  const renderCall = toolCalls.find((c) => c.name === "render_ui");
  if (renderCall) {
    const jsonContent = renderCall.content?.find((c) => c.type === "json");
    if (jsonContent && typeof jsonContent.data === "object" && jsonContent.data !== null) {
      const dataObj = jsonContent.data as { blocks?: UIBlock[] };
      if (Array.isArray(dataObj.blocks)) {
        uiBlocks = dataObj.blocks;
      }
    } else if (
      typeof renderCall.input === "object" &&
      renderCall.input !== null &&
      "blocks" in renderCall.input
    ) {
      uiBlocks = (renderCall.input as { blocks: UIBlock[] }).blocks;
    }
  }

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
    ...(uiBlocks && uiBlocks.length ? { uiBlocks } : {}),
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
    ...(dto.providerModelId ? { providerModelId: dto.providerModelId } : {}),
    ...(dto.thinking ? { thinking: dto.thinking } : {}),
    ...(dto.segments && dto.segments.length > 0 ? { segments: dto.segments } : {}),
    ...(dto.createdAt ? { createdAt: dto.createdAt } : {}),
    ...(dto.usage ? { usage: toUsage(dto.usage) } : {}),
    ...(dto.finishReason ? { finishReason: dto.finishReason } : {}),
  };
}

export function toChat(dto: ChatDto): Chat {
  return {
    id: dto.id,
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
    kind: (dto.kind === "code" || dto.kind === "webpage"
      ? dto.kind
      : "document") as "document" | "code" | "webpage",
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
    font: dto.font === "serif" ? "serif" : "sans",
    modelAlias: dto.modelAlias,
    instructions: dto.instructions,
    enterToSend: dto.enterToSend,
    reducedMotion: dto.reducedMotion,
    defaultMode: (["chat", "search", "research"] as const).includes(
      dto.defaultMode as Mode,
    )
      ? (dto.defaultMode as Mode)
      : "chat",
    saveHistory: dto.saveHistory,
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
