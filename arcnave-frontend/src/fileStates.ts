/**
 * A chat file's life after its bytes are sent (Stage 9 PIPE, Stage 14 upload states, AS-D6).
 *
 * The server reads a file in a job and answers `complete` with 202; the chip polls
 * `GET /files/:id` and shows each stage. Only a `ready` file can be sent: one still being read
 * blocks Send, and so does one that failed, until it is retried or removed. The server holds
 * the same rule (409 `file_not_ready`), so this is the courtesy, the server the guarantee.
 */
import type { AttachmentDto } from "./api";
import type { Attachment } from "./types";

/** Statuses after which a file never changes on its own. */
export function isSettled(status: string): boolean {
  return status === "ready" || status === "failed" || status === "unsupported";
}

/** A file the user has to act on (retry or remove) before Send works. */
export function isBroken(status: string): boolean {
  return status === "failed" || status === "unsupported";
}

/** What the chip says while a file is in flight. */
export function stageLabel(file: Pick<Attachment, "status" | "progress">): string | null {
  switch (file.status) {
    case "uploading":
      return file.progress !== undefined ? `Uploading… ${Math.round(file.progress * 100)}%` : "Uploading…";
    case "queued":
      return "Waiting to be read…";
    case "scanning":
      return "Checking…";
    case "extracting":
      return "Reading…";
    case "ocr":
      return "Reading scanned pages…";
    case "transcribing":
      return "Transcribing…";
    case "indexing":
    case "pending":
      return "Indexing…";
    default:
      return null;
  }
}

/** Send is allowed only when every file is ready. */
export function filesBlockSend(files: Pick<Attachment, "status">[]): "reading" | "failed" | null {
  if (files.some((f) => isBroken(f.status))) return "failed";
  if (files.some((f) => f.status !== "ready")) return "reading";
  return null;
}

export interface PollOptions {
  signal?: AbortSignal;
  /** Waits between reads, in ms; the last one repeats. */
  delays?: number[];
  /** Give up after this long; the chip then shows the last status it saw. */
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_DELAYS = [400, 700, 1000, 1500, 2000];

/**
 * Reads the file until it settles, reporting each new status. Returns the last DTO seen.
 * A failed read (network) is retried on the next tick rather than ending the poll.
 */
export async function pollFile<T extends Pick<AttachmentDto, "status" | "error"> = AttachmentDto>(
  id: string,
  read: (id: string) => Promise<T>,
  onUpdate: (dto: T) => void,
  options: PollOptions = {},
): Promise<T | null> {
  const delays = options.delays ?? DEFAULT_DELAYS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (options.maxMs ?? 30 * 60 * 1000);
  let last: T | null = null;
  for (let i = 0; Date.now() < deadline; i++) {
    if (options.signal?.aborted) return last;
    await sleep(delays[Math.min(i, delays.length - 1)]!);
    if (options.signal?.aborted) return last;
    try {
      const dto = await read(id);
      if (!last || dto.status !== last.status || dto.error !== last.error) onUpdate(dto);
      last = dto;
      if (isSettled(dto.status)) return dto;
    } catch {
      /* A dropped read is not the file failing; try again on the next tick. */
    }
  }
  return last;
}
