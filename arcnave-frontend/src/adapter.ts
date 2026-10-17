/**
 * The generation boundary.
 *
 * `POST /v1/chats/:id/generate` answers with `text/event-stream`, so this cannot be an
 * `EventSource` — that API only does GET and cannot send a body. It is a `fetch` whose
 * response body is read as a stream and re-framed into the same typed events the UI has
 * always consumed.
 *
 * Two details that are easy to get wrong and expensive when they are:
 *
 * - **A frame can be split across reads.** Network chunks have nothing to do with SSE frame
 *   boundaries, so the buffer is only drained at a blank line. Parsing per chunk drops text.
 * - **Closing the socket does not stop the run.** The server keeps the run going and buffers
 *   its frames, so a dropped connection reconnects from the last frame id (`resumable`), sent as
 *   `Last-Event-ID`. Stop is explicit: the UI posts `/stop`.
 * - **A reconnect waits with full jitter** over 1 / 2 / 4 / 8 / 16 s, 5 attempts (N-46), so many
 *   clients dropped by one restart do not come back at the same instant. A send whose POST failed
 *   on the network is sent again with the same Idempotency-Key: the server answers with the turn
 *   the first one started, if it did, instead of starting a second (ADR-0078).
 */
import { ApiError, describeError, errorCopy, url } from "./api";
import type { MessageDto, SourceDto, UsageDto } from "./api";
import type { Mode, ReasoningEffort, ResearchEvent } from "./types";
import type { UIBlock } from "./generative-ui/types";

export interface ModelInfo {
  requested: string;
  resolved: string;
  provider: string;
  providerModelId: string;
  /** Present only when the request asked for Auto, so routing is never opaque. */
  routing?: { rule: string; considered: string[] };
  grounded: boolean;
}

export interface RuntimeDebugTrace {
  candidateSkills: string[];
  selectedSkills: string[];
  loadedSkills: string[];
  exposedTools: string[];
  toolsCalled: string[];
}

export type StreamEvent =
  /** The first frame of a run: the turn exists, with both of its messages (ADR-0078). */
  | { type: "ack"; turnId: string; messageId: string; userMessageId: string | null }
  /**
   * The stored reply, sent when the live frames are not available (the run is on another server
   * instance, ended, or its buffer moved past the gap): it replaces the row.
   */
  | { type: "snapshot"; turnId: string; state: string; seq: number; message: MessageDto | null }
  /** Not a server frame: the connection dropped and the next attempt is `attempt` of `of`. */
  | { type: "reconnecting"; attempt: number; of: number }
  /** Not a server frame: a reconnect succeeded. */
  | { type: "reconnected" }
  | {
      type: "start";
      messageId: string;
      chatId: string;
      requestId: string;
      model: ModelInfo;
    }
  | { type: "research"; event: ResearchEvent }
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "sources"; sources: SourceDto[]; searchEntryPoint?: string }
  | { type: "code"; code?: string; language?: string; output?: string }
  | { type: "tool_use"; toolCallId: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolCallId: string;
      name: string;
      ok: boolean;
      preview: string;
      /** What present_files gave the user (ADR-0048). */
      files?: Array<{ attachmentId: string; filename: string; mimeType: string; sizeBytes: number; downloadUrl: string }>;
      /** A failure named by a stable code (`sandbox_misconfigured`, ADR-0070); its copy is api.errorCopy's. */
      errorCode?: string;
    }
  | {
      type: "artifact_created";
      artifactId: string;
      title: string;
      kind: string;
      version: number;
    }
  | { type: "ui_block"; block: UIBlock }
  /** A visual while the model writes it (ADR-0037): `text` continues the draft from `from`. */
  | { type: "ui_draft"; draftId: string; title: string; from: number; text: string }
  | { type: "debug"; trace: RuntimeDebugTrace }
  | {
      type: "done";
      questions: string[];
      usage: UsageDto;
      finishReason: string;
      effort?: ReasoningEffort | null;
      /** The answer stopped early and was kept: after a tool ran (ADR-0072) or after text (ADR-0081). */
      partial?: boolean;
      errorCode?: string;
      /** P11: another model answered than the first; the label's facts. */
      fallback?: { from: string; reason: string };
    }
  /** P11 (Stage 7 7.12): the turn moved to the next model of its chain before anything was shown. */
  | { type: "model_switch"; from: string; to: string; reason: string }
  | {
      type: "error";
      code: string;
      title: string;
      detail: string;
      usage?: UsageDto;
    };

export interface GenerateRequest {
  prompt: string;
  mode: Mode;
  /** A model alias from `GET /models`, or `Auto`. */
  model: string;
  effort?: ReasoningEffort;
  attachmentIds?: string[];
  /** Re-run an existing assistant message instead of appending a new pair. */
  retryMessageId?: string;
  /** Optional response style override (preset key or custom style UUID). */
  styleId?: string;
}

/** N-46: client reconnect backoff bases, one per attempt; each wait is a full-jitter part of it. */
export const RECONNECT_BASES_MS = [1000, 2000, 4000, 8000, 16000];

/** The wait before reconnect attempt `attempt` (0-based): anywhere in [0, base) (full jitter). */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = RECONNECT_BASES_MS[Math.min(attempt, RECONNECT_BASES_MS.length - 1)]!;
  return Math.floor(random() * base);
}

export interface StreamOptions {
  /** One per send, reused when the POST is retried (Stage 15 ER-10c). Made here when absent. */
  idempotencyKey?: string;
  /** The jitter source; tests pass a fixed one. */
  random?: () => number;
  /** Resolves when the user asks to retry now: the current backoff wait ends early. */
  wake?: () => Promise<void>;
}

/** A backoff wait that a manual Retry can cut short. */
async function backoff(ms: number, signal: AbortSignal, wake?: () => Promise<void>): Promise<void> {
  await (wake ? Promise.race([delay(ms, signal), wake()]) : delay(ms, signal));
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

/** A run ends with `done`, `error`, or a snapshot of a row that is no longer generating. */
function ends(event: StreamEvent): boolean {
  if (event.type === "done" || event.type === "error") return true;
  if (event.type === "snapshot") {
    const status = event.message?.status;
    return event.state !== "running" && event.state !== "queued" && status !== "generating";
  }
  return false;
}

/**
 * Stream one assistant turn.
 *
 * Yields server frames verbatim. A transport failure surfaces as a thrown `ApiError`; a
 * modelling failure arrives as an `error` frame, because by then the response is already
 * committed as a 200 and cannot become a status code. A refusal before the run (402 budget,
 * 409 a run in progress) is a thrown `ApiError` with the server's code.
 */
export async function* generate(
  chatId: string,
  req: GenerateRequest,
  signal: AbortSignal,
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent> {
  const key = options.idempotencyKey ?? crypto.randomUUID();
  const random = options.random ?? Math.random;
  const body = JSON.stringify({
    prompt: req.prompt,
    mode: req.mode,
    model: req.model,
    attachmentIds: req.attachmentIds ?? [],
    ...(req.effort ? { effort: req.effort } : {}),
    ...(req.retryMessageId ? { retryMessageId: req.retryMessageId } : {}),
    ...(req.styleId ? { styleId: req.styleId } : {}),
  });
  let response: Response | undefined;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(url(`/chats/${chatId}/generate`), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Idempotency-Key": key,
        },
        body,
        signal,
      });
      break;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (signal.aborted) throw error;
      // The send may or may not have reached the server; the same key makes a second POST safe.
      if (attempt >= RECONNECT_BASES_MS.length) {
        throw new ApiError({ code: "network", ...errorCopy["network"]! });
      }
      yield { type: "reconnecting", attempt: attempt + 1, of: RECONNECT_BASES_MS.length };
      await backoff(reconnectDelay(attempt, random), signal, options.wake);
    }
  }

  // A refusal happens before the stream opens: 402 for a spent budget, 409 for a run already in
  // progress, 401 for a dead session, 429 for rate limiting. Those are ordinary JSON envelopes.
  if (!response.ok || !response.body) {
    throw await refusalToError(response);
  }

  yield* resumable(chatId, response, signal, random, options.wake);
}

/**
 * Reattach to the chat's running reply (after a reload, or from another tab). Throws
 * `no_active_run` when the chat has never had a turn; otherwise the server streams the run, or
 * snapshots of its stored row.
 */
export async function* attach(
  chatId: string,
  signal: AbortSignal,
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent> {
  const response = await openStream(chatId, -1, signal);
  yield* resumable(chatId, response, signal, options.random ?? Math.random, options.wake);
}

/**
 * Reads a run's frames and, when the connection drops before the run ended, reconnects from the
 * last frame seen. The run keeps going on the server meanwhile, so nothing is lost or repeated.
 * A `ping` frame keeps the connection alive and is not passed on.
 */
async function* resumable(
  chatId: string,
  first: Response,
  signal: AbortSignal,
  random: () => number,
  wake?: () => Promise<void>,
): AsyncGenerator<StreamEvent> {
  let response = first;
  let lastId = -1;
  let attempt = 0;
  for (;;) {
    let ended = false;
    try {
      for await (const frame of readFrames(response)) {
        if ((frame.event as { type: string }).type === "ping") continue;
        if (frame.id !== null) lastId = frame.id;
        if (attempt > 0) yield { type: "reconnected" };
        attempt = 0;
        yield frame.event;
        if (ends(frame.event)) ended = true;
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }
    if (ended || signal.aborted) return;
    // The stream closed without an end frame: the connection dropped, not the run.
    for (;;) {
      if (attempt >= RECONNECT_BASES_MS.length) {
        throw new ApiError({ code: "network", ...errorCopy["network"]! });
      }
      yield { type: "reconnecting", attempt: attempt + 1, of: RECONNECT_BASES_MS.length };
      await backoff(reconnectDelay(attempt, random), signal, wake);
      attempt += 1;
      try {
        response = await openStream(chatId, lastId, signal);
        break;
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof ApiError && error.code !== "network") throw error;
      }
    }
  }
}

async function openStream(
  chatId: string,
  after: number,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url(`/chats/${chatId}/stream?after=${String(after)}`), {
      credentials: "include",
      // The header is what the server reads first (Stage 14 D-26); `after` stays for proxies
      // that drop it.
      headers: { Accept: "text/event-stream", "Last-Event-ID": String(after) },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError({ code: "network", ...errorCopy["network"]! });
  }
  if (!response.ok || !response.body) throw await refusalToError(response);
  return response;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function* readFrames(
  response: Response,
): AsyncGenerator<{ id: number | null; event: StreamEvent }> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      // Only complete frames are parsed; a partial tail stays in the buffer for the next read.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
    const trailing = parseFrame(buffer);
    if (trailing) yield trailing;
  } finally {
    // Releasing the lock lets the abort tear the socket down; without it a cancelled run can
    // hold the connection open until the server gives up.
    reader.cancel().catch(() => {});
  }
}

/** One SSE frame to a typed event and its id, or null for a comment or anything unrecognised. */
export function parseFrame(frame: string): { id: number | null; event: StreamEvent } | null {
  const idLine = frame.split("\n").find((line) => line.startsWith("id:"));
  const id = idLine ? Number(idLine.slice(3).trim()) : null;
  const data = frame
    .split("\n")
    // A comment line carries nothing, and `event:` duplicates the `type` already in the body.
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as StreamEvent;
    return parsed.type ? { id: Number.isFinite(id) ? id : null, event: parsed } : null;
  } catch {
    // A malformed frame is not worth killing a running answer for. Skip it.
    return null;
  }
}

async function refusalToError(response: Response): Promise<ApiError> {
  let code = response.status === 401 ? "unauthorized" : "internal_error";
  let title: string | undefined;
  let detail: string | undefined;
  let requestId = response.headers.get("X-Request-ID") ?? "";
  try {
    const body = (await response.json()) as {
      error?: {
        code?: string;
        title?: string;
        detail?: string;
        requestId?: string;
      };
    };
    if (body.error?.code) code = body.error.code;
    title = body.error?.title;
    detail = body.error?.detail;
    if (body.error?.requestId) requestId = body.error.requestId;
  } catch {
    /* Not our envelope; the status is all we know, and the code above already says so. */
  }
  const fallback = describeError(code);
  return new ApiError({
    code,
    title: title ?? fallback.title,
    detail: detail ?? fallback.detail,
    requestId,
    status: response.status,
  });
}
