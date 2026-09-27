import type { Message } from "./types";

export interface ShortcutHandlers {
  navigate: (to: string) => void;
  setPanel: (panel: { kind: "closed" }) => void;
  setSearch: (open: boolean) => void;
  setSettings: (open: boolean) => void;
  toast: (text: string) => void;
  activeChatId?: string;
  messages?: Record<string, Message[]>;
  writeClipboard?: (text: string) => Promise<void>;
}

/**
 * Global keyboard shortcuts for the workspace shell.
 *
 * Matches:
 * - Ctrl/Cmd + Shift + O: New conversation
 * - Ctrl/Cmd + K: New conversation (kept for muscle memory)
 * - Ctrl/Cmd + P: Search conversations
 * - Ctrl/Cmd + ,: Open settings
 * - Ctrl/Cmd + Shift + C: Copy the last complete assistant answer
 *
 * Uses e.key.toLowerCase() and e.code ("KeyO", "KeyC", etc.) because Shift makes e.key uppercase.
 */
export function handleAppKeyDown(
  e: KeyboardEvent | { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; preventDefault: () => void },
  handlers: ShortcutHandlers,
): boolean {
  const isModifier = Boolean(e.ctrlKey || e.metaKey);
  if (!isModifier) return false;

  const keyLower = e.key.toLowerCase();
  const code = e.code ?? "";
  const isShift = Boolean(e.shiftKey);

  // New conversation: Ctrl/Cmd + Shift + O or Ctrl/Cmd + K
  if ((isShift && (keyLower === "o" || code === "KeyO")) || (!isShift && (keyLower === "k" || code === "KeyK"))) {
    e.preventDefault();
    handlers.navigate("/");
    handlers.setPanel({ kind: "closed" });
    return true;
  }

  // Search conversations: Ctrl/Cmd + P
  if (!isShift && (keyLower === "p" || code === "KeyP")) {
    e.preventDefault();
    handlers.setSearch(true);
    return true;
  }

  // Settings: Ctrl/Cmd + ,
  if (!isShift && e.key === ",") {
    e.preventDefault();
    handlers.setSettings(true);
    return true;
  }

  // Copy last assistant answer: Ctrl/Cmd + Shift + C
  if (isShift && (keyLower === "c" || code === "KeyC")) {
    e.preventDefault();
    const chatMessages = (handlers.activeChatId && handlers.messages?.[handlers.activeChatId]) || [];
    const lastAssistant = [...chatMessages].reverse().find(
      (m) => m.role === "assistant" && m.status === "complete" && m.text.trim().length > 0,
    );

    if (lastAssistant) {
      const copyFn =
        handlers.writeClipboard ??
        (typeof navigator !== "undefined" && navigator.clipboard?.writeText
          ? navigator.clipboard.writeText.bind(navigator.clipboard)
          : undefined);

      if (copyFn) {
        copyFn(lastAssistant.text).then(
          () => handlers.toast("Response copied to clipboard"),
          () => handlers.toast("Clipboard access is unavailable. Export the conversation instead."),
        );
      } else {
        handlers.toast("Clipboard access is unavailable. Export the conversation instead.");
      }
    } else {
      handlers.toast("No response to copy.");
    }
    return true;
  }

  return false;
}
