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
 * - **Aborting must reach the server.** The signal is passed to `fetch`, which closes the
 *   socket; the backend listens for that close and aborts the provider call. The UI also
 *   posts `/stop`, because a run started on another tab has no socket here to close.
 */
import { ApiError, describeError, errorCopy, url } from "./api";
import type { SourceDto, UsageDto } from "./api";
import type { Mode, ResearchEvent } from "./types";
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

export type StreamEvent =
  | {
      type: "start";
      messageId: string;
      chatId: string;
      requestId: string;
      model: ModelInfo;
    }
  | { type: "research"; event: ResearchEvent }
  | { type: "delta"; text: string }
  | { type: "sources"; sources: SourceDto[]; searchEntryPoint?: string }
  | { type: "code"; code?: string; language?: string; output?: string }
  | { type: "tool_use"; toolCallId: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolCallId: string;
      name: string;
      ok: boolean;
      preview: string;
    }
  | {
      type: "artifact_created";
      artifactId: string;
      title: string;
      kind: string;
      version: number;
    }
  | { type: "ui_block"; block: UIBlock }
  | { type: "done"; questions: string[]; usage: UsageDto; finishReason: string }
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
  attachmentIds?: string[];
  /** Re-run an existing assistant message instead of appending a new pair. */
  retryMessageId?: string;
}

/**
 * Stream one assistant turn.
 *
 * Yields server frames verbatim. A transport failure surfaces as a thrown `ApiError`; a
 * modelling or budget failure arrives as an `error` frame, because by then the response is
 * already committed as a 200 and cannot become a status code.
 */
export async function* generate(
  chatId: string,
  req: GenerateRequest,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  let response: Response;
  try {
    response = await fetch(url(`/chats/${chatId}/generate`), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        prompt: req.prompt,
        mode: req.mode,
        model: req.model,
        attachmentIds: req.attachmentIds ?? [],
        ...(req.retryMessageId ? { retryMessageId: req.retryMessageId } : {}),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError({ code: "network", ...errorCopy["network"]! });
  }

  // A refusal happens before the stream opens: 409 for a run already in progress, 401 for a
  // dead session, 429 for rate limiting. Those are ordinary JSON envelopes.
  if (!response.ok || !response.body) {
    throw await refusalToError(response);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
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
        const event = parseFrame(frame);
        if (event) yield event;
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

/** One SSE frame to a typed event, or null for a heartbeat or anything unrecognised. */
function parseFrame(frame: string): StreamEvent | null {
  const data = frame
    .split("\n")
    // `: heartbeat` is a comment line and `event:` duplicates the `type` already in the body.
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as StreamEvent;
    return parsed.type ? parsed : null;
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
