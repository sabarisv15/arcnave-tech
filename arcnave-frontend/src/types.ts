/**
 * The shapes the interface renders, and the mapping from the API's shapes to them.
 *
 * These are deliberately thin: field renames and a couple of derived flags, nothing more. Any
 * value the server does not send is absent here rather than defaulted, so a screen cannot show
 * a number the backend never measured. The DTOs themselves live in `api.ts`.
 */
import { api } from "./api";
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
}

export interface ResearchEvent {
  stage: ResearchStage;
  label: string;
  detail: string;
  /** ISO 8601 from the server. */
  at: string | null;
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

export interface Message {
  id: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  mode: Mode;
  status: RunStatus;
  sources?: Source[];
  events?: ResearchEvent[];
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
  createdAt?: string | null;
  usage?: MessageUsage;
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
  return {
    id: dto.id,
    seq: dto.seq,
    role: dto.role === "user" ? "user" : "assistant",
    text: dto.text,
    mode: (dto.mode as Mode) ?? "chat",
    status: dto.status as RunStatus,
    ...(dto.sources.length ? { sources: dto.sources.map(toSource) } : {}),
    ...(dto.events.length ? { events: dto.events.map(toResearchEvent) } : {}),
    ...(dto.researchStage ? { researchStage: dto.researchStage } : {}),
    ...(dto.questions.length ? { questions: dto.questions } : {}),
    ...(dto.artifactId ? { artifactId: dto.artifactId } : {}),
    ...(dto.attachments.length
      ? { attachments: dto.attachments.map(toMessageAttachment) }
      : {}),
    ...(dto.feedback === "up" || dto.feedback === "down"
      ? { feedback: dto.feedback }
      : {}),
    ...(dto.errorCode ? { error: dto.errorCode } : {}),
    ...(dto.modelAlias ? { modelAlias: dto.modelAlias } : {}),
    ...(dto.providerModelId ? { providerModelId: dto.providerModelId } : {}),
    ...(dto.createdAt ? { createdAt: dto.createdAt } : {}),
    ...(dto.usage ? { usage: toUsage(dto.usage) } : {}),
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
    version: dto.version,
  };
}
