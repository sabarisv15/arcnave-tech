/**
 * The HTTP boundary.
 *
 * Every call the app makes to the ArcNave backend goes through here. Three rules this file
 * exists to keep:
 *
 * - **Errors are typed, never guessed.** The server returns `{ error: { code, title, detail,
 *   requestId } }` for every failure. `ApiError` carries all four, so the UI can switch on
 *   `code` and show the server's own prose rather than inventing copy for a situation it did
 *   not diagnose.
 * - **The session is a cookie, not a token.** Nothing here reads or writes credentials;
 *   `credentials: "include"` is the whole of it. A 401 means the cookie is gone or expired,
 *   and that is reported once, centrally, through `onUnauthorized`.
 * - **Shapes mirror the server.** These types are transcribed from the Zod schemas in
 *   `backend/src/routes/`. When a route changes, this file changes with it — the generated
 *   `docs/openapi.json` is the reference.
 */

/**
 * Cross-origin, deliberately: this points straight at Cloud Run rather than through a
 * same-origin proxy. `vite.config.ts` still proxies `/v1` in development (VITE_API_PROXY), but
 * production talks to the API directly. That is only safe because the session cookie is
 * `SameSite=None` (see `backend/src/routes/auth.ts`) — a same-origin proxy was tried first and
 * reverted; it added ~1.2s per request with no reliable fix at low traffic. See mistakes.md.
 *
 * `SameSite=None` does not work in Safari or strict Firefox tracking-protection modes by
 * default — this is a deliberate, temporary trade-off for single-user testing, not a
 * production-ready posture. Revisit before this has real multi-browser traffic.
 */
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ??
  // The dev server proxies `/v1` to the local API; a local session must never reach production.
  (import.meta.env.DEV ? "/v1" : "https://arcnave-sandbox-service-756927892291.asia-south1.run.app/v1");

/* -------------------------------------------------------------------------- errors */

export class ApiError extends Error {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly requestId: string;
  readonly status: number;
  readonly meta?: Record<string, unknown>;
  constructor(init: {
    code: string;
    title: string;
    detail: string;
    requestId?: string;
    status?: number;
    meta?: Record<string, unknown>;
  }) {
    super(`${init.code}: ${init.detail}`);
    this.name = "ApiError";
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.requestId = init.requestId ?? "";
    this.status = init.status ?? 0;
    if (init.meta) this.meta = init.meta;
  }
}

/**
 * Copy for a failure we only know by code.
 *
 * A live response carries its own title and detail, so this is the fallback for a code read
 * back out of a stored transcript, where only `errorCode` survived. Anything missing here
 * falls through to `unknownError`, which says so rather than pretending to be specific.
 */
export const errorCopy: Record<string, { title: string; detail: string }> = {
  network: {
    title: "Connection interrupted",
    detail: "Your message is saved. Check your connection, then retry.",
  },
  unauthorized: {
    title: "Sign in to continue",
    detail: "Your session has ended. Sign in again.",
  },
  invalid_credentials: {
    title: "That email or password is incorrect",
    detail: "Check both and try again.",
  },
  email_taken: {
    title: "That email is already registered",
    detail: "Sign in instead, or use a different address.",
  },
  weak_password: {
    title: "Choose a longer password",
    detail: "Passwords must be at least 12 characters.",
  },
  not_found: {
    title: "Not found",
    detail: "That item does not exist, or you do not have access to it.",
  },
  conflict: {
    title: "This changed somewhere else",
    detail: "Reload to get the latest version, then reapply your edit.",
  },
  validation_error: {
    title: "That request could not be processed",
    detail: "Check the highlighted fields and try again.",
  },
  payload_too_large: {
    title: "That file is too large",
    detail: "Choose a smaller file.",
  },
  unsupported_media_type: {
    title: "That file type is not supported",
    detail: "Try a document, image, spreadsheet, or code file.",
  },
  too_many_files: {
    title: "Too many files in this chat",
    detail: "A chat can hold at most 20 files. Start a new chat to add more.",
  },
  upload_incomplete: {
    title: "The upload did not finish",
    detail: "Not all of the file arrived. Remove it and upload it again.",
  },
  rate_limit: {
    title: "Too many requests",
    detail: "Wait a moment, then try again.",
  },
  model_unavailable: {
    title: "This model is unavailable",
    detail: "It is not configured for this workspace. Choose another model.",
  },
  no_model_available: {
    title: "No model is available",
    detail: "No model in the registry is currently configured and reachable.",
  },
  capability_unavailable: {
    title: "That capability is not configured",
    detail:
      "Search and research need a grounding provider. Ordinary chat still works.",
  },
  budget_exceeded: {
    title: "Token budget reached",
    detail:
      "You have reached your configured limit. Raise or clear it in Settings under Usage & limits.",
  },
  run_in_progress: {
    title: "A response is already running",
    detail: "Stop the current response before starting another.",
  },
  no_active_run: {
    title: "No response is running here",
    detail: "The reply has finished or is running elsewhere. Reload the chat to see it.",
  },
  model_refused: {
    title: "The model declined this request",
    detail: "It stopped without answering. Rephrase the request or choose another model.",
  },
  provider_payload_limit: {
    title: "An attachment is too large for this model",
    detail:
      "It exceeds the selected model's limit. Send a smaller file or fewer pages, or choose another model.",
  },
  provider_error: {
    title: "The response could not finish",
    detail: "The model provider returned an error. You can retry.",
  },
  provider_timeout: {
    title: "The model took too long",
    detail: "The provider did not respond in time. You can retry.",
  },
  empty_response: {
    title: "No response generated",
    detail: "The model completed its operations but produced no written answer. You can retry.",
  },
  context_overflow: {
    title: "Conversation exceeded context limit",
    detail:
      "The conversation and its files are too large for this model, even after trimming. Ask about a smaller part of a large file, or start a new chat.",
  },
  export_unsupported: {
    title: "This version cannot be exported to that format",
    detail: "Its content has none of the structure that format needs.",
  },
  preview_unsupported: {
    title: "No preview for this file",
    detail: "Download it to open it in its own application.",
  },
  forbidden: {
    title: "Not permitted",
    detail: "You do not have access to that.",
  },
  idempotency_conflict: {
    title: "Duplicate request",
    detail: "This request was already sent with different content.",
  },
  registration_closed: {
    title: "Registration is closed",
    detail: "New accounts are not being accepted right now.",
  },
  turn_deadline_exceeded: {
    title: "This request ran out of time",
    detail:
      "The work took longer than one turn allows and was stopped. Try a smaller part of the document, or retry.",
  },
  storage_error: {
    title: "That file could not be stored",
    detail:
      "Try again. If it keeps failing, the storage backend may be unavailable.",
  },
  style_not_found: {
    title: "Style not found",
    detail: "That style does not exist, or you do not have access to it.",
  },
  style_too_long: {
    title: "Style instructions too long",
    detail: "Style instructions cannot exceed 4000 characters.",
  },
  sample_too_long: {
    title: "Writing sample too long",
    detail: "Each writing sample cannot exceed 10000 characters.",
  },
  internal_error: {
    title: "Something went wrong",
    detail: "An unexpected error occurred. The request ID helps trace it.",
  },
};

/**
 * Copy for a code with no entry above.
 *
 * Worded so it cannot be mistaken for a diagnosis: a code this build does not recognise is a
 * code it cannot explain, and saying so beats borrowing another failure's wording.
 */
const unknownError = {
  title: "That did not work",
  detail:
    "ArcNave received an error it does not recognise. Retrying may help; the request ID helps trace it.",
};

export function describeError(code: string | null | undefined): {
  title: string;
  detail: string;
} {
  return (code && errorCopy[code]) || unknownError;
}

/** Notified once whenever any call comes back 401, so the shell can show the sign-in screen. */
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function url(path: string, query?: Query): string {
  // If already absolute HTTP/HTTPS or data URI, return as-is
  if (/^(?:https?:|\/\/|data:)/i.test(path)) {
    return path;
  }

  // Strip leading '/api' or '/v1' so callers can pass '/files/...', '/api/files/...', or '/v1/files/...' uniformly
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith('/api/')) {
    normalizedPath = normalizedPath.slice(4); // leaves '/...'
  }
  if (normalizedPath.startsWith('/v1/')) {
    normalizedPath = normalizedPath.slice(3); // leaves '/...'
  }

  // Ensure base has no trailing slash and normalizedPath has leading slash
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const cleanPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined && value !== null) search.set(key, String(value));
  const suffix = search.toString();
  return `${base}${cleanPath}${suffix ? `?${suffix}` : ""}`;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  /** Suppress the global unauthorized handler — used by the session probe itself. */
  quiet?: boolean;
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url(path, options.query), {
      method,
      credentials: "include",
      headers: options.form
        ? undefined
        : options.body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body:
        options.form ??
        (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: options.signal ?? null,
    });
  } catch (error) {
    // An abort is the caller's own doing and must stay distinguishable from a dead network.
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError({ code: "network", ...errorCopy["network"]! });
  }

  if (!response.ok) throw await toApiError(response, options.quiet);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function toApiError(
  response: Response,
  quiet?: boolean,
): Promise<ApiError> {
  let code = "internal_error";
  let title: string | undefined;
  let detail: string | undefined;
  let requestId = response.headers.get("X-Request-ID") ?? "";
  let meta: Record<string, unknown> | undefined;
  try {
    const body = (await response.json()) as {
      error?: {
        code?: string;
        title?: string;
        detail?: string;
        requestId?: string;
        meta?: Record<string, unknown>;
      };
    };
    if (body.error?.code) code = body.error.code;
    title = body.error?.title;
    detail = body.error?.detail;
    if (body.error?.requestId) requestId = body.error.requestId;
    meta = body.error?.meta;
  } catch {
    // A response that is not our error envelope (a proxy 502, an HTML error page) still has a
    // status, which is more honest than claiming to know the code.
    code = response.status === 401 ? "unauthorized" : "internal_error";
  }
  const fallback = describeError(code);
  if (response.status === 401 && !quiet) unauthorizedHandler?.();
  return new ApiError({
    code,
    title: title ?? fallback.title,
    detail: detail ?? fallback.detail,
    requestId,
    status: response.status,
    ...(meta ? { meta } : {}),
  });
}

const get = <T>(path: string, query?: Query, signal?: AbortSignal) =>
  request<T>("GET", path, { query, ...(signal ? { signal } : {}) });
const post = <T>(path: string, body?: unknown) =>
  request<T>("POST", path, { body });
const patch = <T>(path: string, body: unknown) =>
  request<T>("PATCH", path, { body });
const del = (path: string) => request<void>("DELETE", path);

/* -------------------------------------------------------------------------- shapes */

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface ModelDto {
  alias: string;
  description: string;
  provider: string;
  tier: string;
  available: boolean;
  /** ok | not_configured | vertex_not_configured | probe_failed | unknown */
  reason: string;
  detail: string;
  supportsGrounding: boolean;
  contextWindow: number | null;
  providerModelId: string | null;
  reasoningEfforts?: string[];
}

export interface ModelsDto {
  auto: {
    alias: string;
    description: string;
    available: boolean;
    detail: string;
    reasoningEfforts?: string[];
  };
  models: ModelDto[];
  /** The effort a turn uses when none is chosen; the menu marks it (stepped down) as Default. */
  defaultEffort?: ReasoningEffortDto;
  capabilities: { groundedSearch: boolean; detail: string };
}

export type ReasoningEffortDto = "low" | "medium" | "high" | "xhigh" | "max";

export interface SourceDto {
  id: number;
  title: string;
  url: string;
  urlResolved: boolean;
  domain: string;
  type: string;
  snippet: string;
  passage: string;
  retrievedAt: string | null;
}

export interface ResearchEventDto {
  stage: string;
  label: string;
  detail: string;
  at: string | null;
}

export type ToolContentDto =
  | { type: "text"; text: string }
  | { type: "json"; data: unknown };

export interface ToolCallDto {
  toolCallId: string;
  name: string;
  input: unknown;
  ok: boolean;
  content: ToolContentDto[];
  at: string | null;
}

export interface MessageAttachmentDto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  error: string;
}

export interface UsageDto {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** False means the provider reported nothing. Zeros must not be shown as measured. */
  exact: boolean;
  costUsd: number | null;
}

export interface MessageDto {
  id: string;
  seq: number;
  role: string;
  text: string;
  mode: string;
  status: string;
  errorCode: string | null;
  researchStage: string | null;
  questions: string[];
  feedback: string | null;
  modelAlias: string | null;
  effort?: string | null;
  providerModelId: string | null;
  finishReason: string | null;
  artifactId: string | null;
  searchEntryPoint: string | null;
  thinking?: string | null;
  segments?: import("./types").MessageSegment[] | null;
  createdAt: string | null;
  completedAt: string | null;
  sources: SourceDto[];
  events: ResearchEventDto[];
  toolCalls: ToolCallDto[];
  attachments: MessageAttachmentDto[];
  usage: UsageDto | null;
  versions?: { index: number; versions: { chatId: string; createdAt: string }[] } | null;
}

export interface SheetPreviewCellDto {
  value: string | number | boolean | null;
  type: "number" | "string" | "boolean" | "date" | "error" | null;
  numFmt?: string;
  formula?: string;
}

export interface SheetPreviewDto {
  sheets: {
    name: string;
    rows: SheetPreviewCellDto[][];
    rowCount: number;
    columnCount: number;
    truncatedRows: boolean;
    truncatedColumns: boolean;
  }[];
}

export interface ChatDto {
  id: string;
  familyId?: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ChatDetailDto = ChatDto & { messages: MessageDto[] };

export interface ProjectDto {
  id: string;
  title: string;
  description: string;
  instructions: string;
  pinned: boolean;
  position: number;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  counts: {
    files: number;
    chats: number;
    sources: number;
    indexedChunks: number;
  };
}

export interface ProjectFileDto {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** pending | indexing | ready | failed | unsupported */
  status: string;
  error: string;
  chunkCount: number;
  checksumSha256: string;
  indexedAt: string | null;
  createdAt: string | null;
}

export interface SavedSourceDto {
  id: string;
  projectId: string;
  title: string;
  url: string;
  domain: string;
  type: string;
  snippet: string;
  retrievedAt: string | null;
  createdAt: string | null;
}

export type ProjectDetailDto = ProjectDto & {
  files: ProjectFileDto[];
  sources: SavedSourceDto[];
};

export interface ArtifactDto {
  id: string;
  title: string;
  kind: string;
  projectId: string | null;
  chatId: string | null;
  /** The version currently pointed at. */
  currentVersion: number;
  /** Optimistic-concurrency counter — a different number from `currentVersion`, on purpose. */
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ArtifactContentDto = ArtifactDto & {
  content: string;
  readVersion?: number;
};

export interface ArtifactVersionDto {
  version: number;
  createdAt: string | null;
  charCount: number;
}

export interface AttachmentDto {
  id: string;
  messageId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** ready | unsupported — `unsupported` still stores the file, it just has no text. */
  status: string;
  error: string;
  hasText: boolean;
  /** Pages in a PDF; null for every other type. */
  pageCount?: number | null;
  /** How a model is shown this file: text+visual | text | visual | media | none. */
  reading?: string;
  createdAt: string | null;
}

/** `POST /files/uploads`: the new attachment, and where to send its bytes. */
export interface DirectUploadDto {
  file: AttachmentDto;
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    /** True when `url` is this API; false for the storage bucket (no cookie goes there). */
    withCredentials: boolean;
  };
}

/**
 * Sends the file's bytes where `POST /files/uploads` said to. XHR rather than fetch because
 * only XHR reports upload progress, and a file can be hundreds of megabytes.
 */
function sendBytes(
  upload: DirectUploadDto["upload"],
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.withCredentials ? url(upload.url) : upload.url);
    xhr.withCredentials = upload.withCredentials;
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let code = "upload_incomplete";
      try {
        const body = JSON.parse(xhr.responseText) as { code?: string };
        if (upload.withCredentials && body.code && errorCopy[body.code]) code = body.code;
      } catch {
        /* The bucket answers in XML; the status is all that matters. */
      }
      reject(new ApiError({ code, ...errorCopy[code]! }));
    };
    xhr.onerror = () => reject(new ApiError({ code: "network", ...errorCopy["network"]! }));
    xhr.send(file);
  });
}

export interface PreferencesDto {
  theme: string;
  font: string;
  modelAlias: string;
  effort?: string | null;
  instructions: string;
  enterToSend: boolean;
  reducedMotion: boolean;
  defaultMode: string;
  sourceScope: string;
  saveHistory: boolean;
  styleId?: string;
  maxOutputTokens: number;
  dailyTokenBudget: number | null;
  monthlyTokenBudget: number | null;
  warnThresholdPct: number;
  routingPreference: string;
  timezone: string;
  version: number;
  updatedAt: string | null;
}

export interface TotalsDto {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  requests: number;
}

export interface UsageGroupDto {
  key: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  requests: number;
}

export interface LimitsDto {
  maxOutputTokens: number;
  dailyTokenBudget: number | null;
  monthlyTokenBudget: number | null;
  warnThresholdPct: number;
  routingPreference: string;
  timezone: string;
  dailyUsed: number;
  monthlyUsed: number;
  dailyPct: number | null;
  monthlyPct: number | null;
  warnings: string[];
  dailyResetsAt: string;
  monthlyResetsAt: string;
}

export interface UsageSummaryDto {
  today: TotalsDto;
  month: TotalsDto;
  allTime: TotalsDto;
  byModel: UsageGroupDto[];
  byProject: UsageGroupDto[];
  limits: LimitsDto;
  /** False means every `costUsd` here is null because no pricing table is configured. */
  pricingConfigured: boolean;
}

export interface MessageUsageDto {
  messageId: string;
  modelAlias: string;
  provider: string;
  providerModelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  exact: boolean;
  costUsd: number | null;
  latencyMs: number | null;
  status: string;
  finishReason: string | null;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MemoryItemDto {
  id: string;
  userId: string;
  scope: string;
  projectId: string | null;
  kind: string;
  key: string;
  content: string;
  summary: string;
  isStanding: boolean;
  sourceType: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryListDto {
  items: MemoryItemDto[];
  total: number;
}

export interface StylePresetDto {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

export interface StyleDto {
  id: string;
  userId: string | null;
  name: string;
  instructions: string;
  isPreset: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StylesListDto {
  presets: StylePresetDto[];
  items: StyleDto[];
}

/* -------------------------------------------------------------------------- endpoints */

export const api = {
  auth: {
    me: () => get<{ user: User | null }>("/auth/me", undefined, undefined),
    /** Quiet: a signed-out visitor is the expected case, not a session that just ended. */
    probe: () =>
      request<{ user: User | null }>("GET", "/auth/me", { quiet: true }),
    register: (email: string, password: string, name: string) =>
      post<{ user: User }>("/auth/register", { email, password, name }),
    login: (email: string, password: string) =>
      post<{ user: User }>("/auth/login", { email, password }),
    logout: () => post<void>("/auth/logout"),
    changePassword: (currentPassword: string, newPassword: string) =>
      post<void>("/auth/password", { currentPassword, newPassword }),
  },

  models: {
    list: (probe = false, chatId?: string) =>
      get<ModelsDto>("/models", { probe, ...(chatId ? { chatId } : {}) }),
    refresh: () => post<void>("/models/refresh"),
  },

  chats: {
    list: (
      query: {
        limit?: number;
        cursor?: string;
        projectId?: string;
        q?: string;
      } = {},
    ) => get<Page<ChatDto>>("/chats", query),
    create: (body: { title?: string; projectId?: string | null }) =>
      post<ChatDto>("/chats", body),
    read: (id: string, signal?: AbortSignal) =>
      get<ChatDetailDto>(`/chats/${id}`, undefined, signal),
    patch: (
      id: string,
      body: {
        title?: string;
        pinned?: boolean;
        projectId?: string | null;
        version?: number;
      },
    ) => patch<ChatDto>(`/chats/${id}`, body),
    remove: (id: string) => del(`/chats/${id}`),
    edit: (id: string, editSeq: number) =>
      post<ChatDto>(`/chats/${id}/branch`, { editSeq }),
    branch: (id: string, throughMessageId?: string) =>
      post<ChatDto>(
        `/chats/${id}/branch`,
        throughMessageId ? { throughMessageId } : {},
      ),
    stop: (id: string) => post<{ stopped: boolean }>(`/chats/${id}/stop`),
    feedback: (id: string, messageId: string, feedback: "up" | "down" | null) =>
      post<void>(`/chats/${id}/messages/${messageId}/feedback`, { feedback }),
  },

  projects: {
    list: (query: { limit?: number; cursor?: string; q?: string } = {}) =>
      get<Page<ProjectDto>>("/projects", query),
    create: (body: {
      title: string;
      description?: string;
      instructions?: string;
    }) => post<ProjectDto>("/projects", body),
    read: (id: string) => get<ProjectDetailDto>(`/projects/${id}`),
    patch: (
      id: string,
      body: {
        title?: string;
        description?: string;
        instructions?: string;
        pinned?: boolean;
        version?: number;
      },
    ) => patch<ProjectDto>(`/projects/${id}`, body),
    remove: (id: string) => del(`/projects/${id}`),
    reorder: (ids: string[]) => post<void>("/projects/reorder", { ids }),
    files: (id: string) =>
      get<{ items: ProjectFileDto[] }>(`/projects/${id}/files`),
    upload: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<ProjectFileDto>("POST", `/projects/${id}/files`, { form });
    },
    reindex: (id: string, fileId: string) =>
      post<ProjectFileDto>(`/projects/${id}/files/${fileId}/reindex`),
    removeFile: (id: string, fileId: string) =>
      del(`/projects/${id}/files/${fileId}`),
    fileDownloadUrl: (id: string, fileId: string) =>
      url(`/projects/${id}/files/${fileId}/download`),
    sources: (id: string) =>
      get<{ items: SavedSourceDto[] }>(`/projects/${id}/sources`),
    saveSource: (
      id: string,
      body: {
        title: string;
        url: string;
        type?: string;
        snippet?: string;
        retrievedAt?: string;
      },
    ) => post<SavedSourceDto>(`/projects/${id}/sources`, body),
    removeSource: (id: string, sourceId: string) =>
      del(`/projects/${id}/sources/${sourceId}`),
  },

  artifacts: {
    list: (
      query: {
        limit?: number;
        cursor?: string;
        projectId?: string;
        chatId?: string;
        kind?: string;
        q?: string;
      } = {},
    ) => get<Page<ArtifactDto>>("/artifacts", query),
    create: (body: {
      title: string;
      kind?: string;
      content?: string;
      projectId?: string | null;
      chatId?: string | null;
    }) => post<ArtifactContentDto>("/artifacts", body),
    read: (id: string, version?: number) =>
      get<ArtifactContentDto>(
        `/artifacts/${id}`,
        version ? { version } : undefined,
      ),
    patch: (
      id: string,
      body: {
        title?: string;
        kind?: string;
        projectId?: string | null;
        chatId?: string | null;
        version?: number;
      },
    ) => patch<ArtifactDto>(`/artifacts/${id}`, body),
    remove: (id: string) => del(`/artifacts/${id}`),
    addVersion: (id: string, content: string, version?: number) =>
      post<ArtifactContentDto>(`/artifacts/${id}/versions`, {
        content,
        version,
      }),
    versions: (id: string) =>
      get<{ currentVersion: number; items: ArtifactVersionDto[] }>(
        `/artifacts/${id}/versions`,
      ),
    restore: (id: string, restoreVersion: number, version?: number) =>
      post<ArtifactContentDto>(`/artifacts/${id}/restore`, {
        restoreVersion,
        version,
      }),
    export: (id: string, format: "xlsx" | "docx" | "pptx") =>
      post<{ version: number; format: string; sizeBytes: number; filename: string }>(
        `/artifacts/${id}/export`,
        { format },
      ),
  },

  files: {
    /** Start the upload, send the bytes (straight to storage when it allows), then finish. */
    upload: async (file: File, onProgress?: (fraction: number) => void) => {
      const started = await post<DirectUploadDto>("/files/uploads", {
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      try {
        await sendBytes(started.upload, file, onProgress);
        return await post<AttachmentDto>(`/files/${started.file.id}/complete`);
      } catch (error) {
        void del(`/files/${started.file.id}`).catch(() => {});
        throw error;
      }
    },
    read: (id: string) => get<AttachmentDto>(`/files/${id}`),
    remove: (id: string) => del(`/files/${id}`),
    downloadUrl: (id: string) => url(`/files/${id}/download`),
    /** A spreadsheet's sheets as typed cells (WP-11). */
    preview: (id: string, signal?: AbortSignal) =>
      get<SheetPreviewDto>(`/files/${id}/preview`, undefined, signal),
    cleanup: () => post<{ deleted: number }>("/files/cleanup", {}),
  },

  preferences: {
    read: () => get<PreferencesDto>("/preferences"),
    patch: (body: Partial<PreferencesDto> & { version?: number }) =>
      patch<PreferencesDto>("/preferences", body),
  },

  usage: {
    summary: () => get<UsageSummaryDto>("/usage"),
    limits: () => get<LimitsDto & { version: number }>("/usage/limits"),
    setLimits: (body: {
      maxOutputTokens?: number;
      dailyTokenBudget?: number | null;
      monthlyTokenBudget?: number | null;
      warnThresholdPct?: number;
      routingPreference?: string;
      timezone?: string;
      version?: number;
    }) => patch<LimitsDto & { version: number }>("/usage/limits", body),
    messages: (chatId: string) =>
      get<{ items: MessageUsageDto[] }>("/usage/messages", { chatId }),
    exportUrl: (since?: string) =>
      url("/usage/export", since ? { since } : undefined),
  },

  memory: {
    list: (params?: { projectId?: string; scope?: string; limit?: number; offset?: number }) =>
      get<MemoryListDto>("/memory", params),
    create: (body: { key: string; content: string; projectId?: string | null }) =>
      post<MemoryItemDto>("/memory", body),
    update: (id: string, body: { expectedVersion: number; key?: string; content?: string }) =>
      patch<MemoryItemDto>(`/memory/${id}`, body),
    delete: (id: string) => del(`/memory/${id}`),
    clearProject: (projectId: string) => del(`/memory/project/${projectId}`),
    clearAll: () => del("/memory/all"),
  },

  styles: {
    list: () => get<StylesListDto>("/styles"),
    get: (id: string) => get<StyleDto>(`/styles/${id}`),
    create: (body: { name: string; instructions: string }) =>
      post<StyleDto>("/styles", body),
    update: (
      id: string,
      body: { name?: string; instructions?: string; version?: number },
    ) => patch<StyleDto>(`/styles/${id}`, body),
    delete: (id: string) => del(`/styles/${id}`),
    summarize: (samples: string[]) =>
      post<{ instructions: string }>("/styles/summarize", { samples }),
  },

  url,
};
