/**
 * Local helpers that are not persistence.
 *
 * Conversations, projects, artifacts, preferences, and files all live on the server now. What
 * is left here is presentation: formatting a size, deciding whether a file can be previewed as
 * text, triggering a download, and remembering purely local interface state such as whether
 * the sidebar is collapsed.
 *
 * `validateFile` mirrors `checkUpload` in `backend/src/services/storage.ts` so an obviously
 * unusable file is refused before the bytes are sent. The server remains the authority: this
 * is a courtesy, never a guarantee, and a file that passes here can still come back
 * `unsupported_media_type`.
 */
import type { Attachment } from "./types";
import { api } from "./api";

/** Local, non-syncing interface state. Namespaced so it cannot collide with anything else. */
const UI_PREFIX = "arcnave-ui:";

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(UI_PREFIX + key);
  } catch {
    // Private browsing and blocked storage both throw. A missing preference is not an error.
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(UI_PREFIX + key, value);
  } catch {
    /* The interface still works without it; nothing user-owned is lost. */
  }
}

export function clearLocal(key: string): void {
  try {
    localStorage.removeItem(UI_PREFIX + key);
  } catch {
    /* Nothing to clean up if storage is unavailable. */
  }
}

/**
 * Extensions the backend accepts, by name. Keep in step with `LOCKED_TYPES` and `EXTRA_TYPES`
 * in the server's `storage.ts`; the server also checks the bytes, so this is only the name.
 */
export const allowed =
  /\.(pdf|docx|pptx|xlsx|xls|odt|rtf|epub|txt|md|log|csv|json|js|jsx|mjs|ts|tsx|py|html|htm|css|yml|yaml|xml|sql|sh|toml|ini|png|jpe?g|webp|gif|mp3|wav|ogg|flac|aac|mp4|webm|mov|zip)$/i;

/** Macro and legacy Office files: refused with the locked "save as" text (Stage 1 FT-2 / FT-3). */
const SAVE_AS = /\.(doc|ppt|docm|xlsm|pptm)$/i;

export function saveAsText(name: string): string {
  const ext = (/\.([a-z]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  const target = ext.startsWith("doc") ? "DOCX" : ext.startsWith("xls") ? "XLSX" : "PPTX";
  const why = ext.endsWith("m") ? "contains macros" : "is in an old Office format";
  return `This .${ext} file ${why}. Save it as ${target} and upload it again.`;
}

/** Project files go through the API in one request: 30 MB per project file. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Chat attachments upload straight to storage; the transport ceiling is 500 MB. */
export const MAX_ATTACHMENT_BYTES = 500 * 1024 * 1024;

/** N-10 per type (the server's `uploadLimitBytes`): docs 100 MB, XLSX 50 MB, images 20 MB, audio 500 MB, ZIP 100 MB. */
const MB = 1024 * 1024;
export function typeLimit(name: string): { bytes: number; noun: string } {
  if (/\.zip$/i.test(name)) return { bytes: 100 * MB, noun: "ZIP files" };
  if (/\.xlsx?$/i.test(name)) return { bytes: 50 * MB, noun: "Spreadsheets" };
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return { bytes: 20 * MB, noun: "Images" };
  if (/\.(mp3|wav|ogg|flac|aac|mp4|webm|mov)$/i.test(name)) return { bytes: 500 * MB, noun: "Audio and video files" };
  return { bytes: 100 * MB, noun: "Documents" };
}
/** The per-image limit; the server enforces the same (N-10). */
export const MAX_IMAGE_BYTES = 20 * MB;

export function validateFile(
  file: Pick<File, "name" | "size">,
  maxBytes: number = MAX_UPLOAD_BYTES,
): string | null {
  if (SAVE_AS.test(file.name)) return saveAsText(file.name);
  if (!allowed.test(file.name))
    return "This file format is not supported. Try a document, image, spreadsheet, audio, ZIP or code file.";
  if (file.size === 0) return "That file is empty.";
  const limit = typeLimit(file.name);
  if (file.size > limit.bytes)
    return `${limit.noun} can be at most ${Math.round(limit.bytes / MB)} MB. Choose a smaller file.`;
  if (file.size > maxBytes)
    return `This file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB. Choose a smaller file.`;
  return null;
}

export const sizeLabel = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const canPreviewText = (file: Attachment) =>
  /\.(txt|md|log|csv|json|js|jsx|mjs|ts|tsx|py|html|htm|css|yml|yaml|xml|sql|sh|toml|ini)$/i.test(
    file.name,
  );

export function download(
  content: string | Blob,
  name: string,
  type = "text/markdown",
) {
  const url = URL.createObjectURL(
    typeof content === "string" ? new Blob([content], { type }) : content,
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Universal authenticated file and image downloader.
 *
 * Fetches protected resources via fetch(api.url(path), { credentials: "include" }),
 * converts to a Blob, creates an Object URL, and triggers browser download.
 * Prevents direct browser navigations to Cloud Run download URLs which drop credentials.
 */
export async function downloadAuthenticated(
  pathOrUrl: string,
  filename: string,
): Promise<void> {
  const targetUrl =
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://") ||
    pathOrUrl.startsWith("blob:")
      ? pathOrUrl
      : api.url(pathOrUrl);

  const response = await fetch(targetUrl, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/**
 * Save a file the server owns.
 *
 * A plain link would work for a public URL, but these endpoints need the session cookie and
 * set `Content-Disposition` themselves, so the response is fetched with credentials and handed
 * to the same download path as everything else.
 */
export async function downloadFrom(href: string, name: string): Promise<void> {
  await downloadAuthenticated(href, name);
}
