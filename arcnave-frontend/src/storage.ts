import type { Workspace, Attachment } from "./types";
import { initialWorkspace } from "./fixtures";
export const STORAGE_KEY = "still-workspace-v1";
export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (
        Array.isArray(data.chats) &&
        Array.isArray(data.projects) &&
        Array.isArray(data.artifacts) &&
        data.preferences
      ) {
        return {
          ...data,
          preferences: {
            ...data.preferences,
            model:
              data.preferences.model === "Quick"
                ? "Gemini 3.8 Flash"
                : data.preferences.model === "Deliberate"
                  ? "Opus 5"
                  : data.preferences.model,
          },
          chats: data.chats.map((c: any) => ({
            ...c,
            messages: c.messages.map((m: any) =>
              ["generating", "submitting"].includes(m.status)
                ? { ...m, status: "stopped" }
                : m,
            ),
          })),
        };
      }
    }
  } catch {
    /* Recover to a usable fresh workspace when local storage is corrupt or unavailable. */
  }
  return initialWorkspace();
}
export function persistWorkspace(w: Workspace) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...w, chats: w.preferences.saveHistory ? w.chats : [] }),
  );
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("still-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function storeFile(id: string, file: File) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("files", "readwrite");
    tx.objectStore("files").put(file, id);
    tx.oncomplete = () => {
      d.close();
      resolve();
    };
    tx.onerror = () => {
      d.close();
      reject(tx.error);
    };
  });
}
export async function readFile(id: string): Promise<File | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("files", "readonly");
    const req = tx.objectStore("files").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => d.close();
  });
}
export const allowed =
  /\.(pdf|docx|txt|csv|xlsx|png|jpe?g|webp|gif|md|json|js|jsx|ts|tsx|py|html|css|yml|yaml|xml|sql)$/i;
export function validateFile(file: Pick<File, "name" | "size">) {
  if (!allowed.test(file.name))
    return "This file format is not supported. Try a document, image, spreadsheet, or code file.";
  if (file.size > 20 * 1024 * 1024)
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
  /\.(txt|csv|md|json|js|jsx|ts|tsx|py|html|css|yml|yaml|xml|sql)$/i.test(
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
