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

/** Extensions the backend accepts, by name. Keep in step with `ALLOWED` on the server. */
export const allowed =
  /\.(pdf|docx|xlsx|txt|md|log|csv|json|js|jsx|mjs|ts|tsx|py|html|htm|css|yml|yaml|xml|sql|sh|toml|ini|png|jpe?g|webp|gif)$/i;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function validateFile(file: Pick<File, "name" | "size">): string | null {
  if (!allowed.test(file.name))
    return "This file format is not supported. Try a document, image, spreadsheet, or code file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES)
    return "This file is larger than 20 MB. Choose a smaller file.";
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
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save a file the server owns.
 *
 * A plain link would work for a public URL, but these endpoints need the session cookie and
 * set `Content-Disposition` themselves, so the response is fetched with credentials and handed
 * to the same download path as everything else.
 */
export async function downloadFrom(href: string, name: string): Promise<void> {
  const response = await fetch(href, { credentials: "include" });
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  download(await response.blob(), name, "application/octet-stream");
}
