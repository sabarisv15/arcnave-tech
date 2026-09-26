/**
 * Copies text to the system clipboard, trying the modern Async Clipboard API
 * first and falling back to document.execCommand('copy').
 *
 * Returns true only when the clipboard operation actually succeeded;
 * returns false on failure or rejection.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Modern API failed (e.g. lack of permissions); try fallback
    }
  }

  return fallbackExecCommandCopy(text);
}

function fallbackExecCommandCopy(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return Boolean(success);
  } catch {
    return false;
  }
}
