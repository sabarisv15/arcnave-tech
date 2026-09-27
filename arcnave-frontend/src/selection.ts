/**
 * Selection helpers for WP-07: text selection and contextual actions ('Ask about this' and 'Change this').
 */

const ELEMENT_NODE = typeof Node !== "undefined" ? Node.ELEMENT_NODE : 1;

/**
 * Formats selected text as a markdown blockquote followed by an empty line.
 * Each non-empty line starts with `> `, while empty lines become `>`.
 */
export function formatQuote(text: string): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  const quoted = lines
    .map((line) => {
      const lineTrimmed = line.trim();
      return lineTrimmed ? `> ${lineTrimmed}` : ">";
    })
    .join("\n");
  return `${quoted}\n\n`;
}

/**
 * Checks whether the current text selection is contained inside an assistant message.
 * Excludes user messages, buttons, action menus, and code outputs.
 */
export function isSelectionInsideAssistant(selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  const text = selection.toString().trim();
  if (!text) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const commonEl =
    common.nodeType === ELEMENT_NODE
      ? (common as Element)
      : common.parentElement;

  if (!commonEl || typeof commonEl.closest !== "function") {
    return false;
  }

  const assistantMsg = commonEl.closest("article.assistant-message, .assistant-message");
  if (!assistantMsg) {
    return false;
  }

  if (
    commonEl.closest(
      ".user-message, .user-bubble, .message-actions, .response-meta, .response-wait, .ran-code-output, .jump-bottom, .related-questions, button, .icon-button",
    )
  ) {
    return false;
  }

  const anchorEl =
    selection.anchorNode?.nodeType === ELEMENT_NODE
      ? (selection.anchorNode as Element)
      : selection.anchorNode?.parentElement;
  const focusEl =
    selection.focusNode?.nodeType === ELEMENT_NODE
      ? (selection.focusNode as Element)
      : selection.focusNode?.parentElement;

  if (!anchorEl || !focusEl || typeof anchorEl.closest !== "function" || typeof focusEl.closest !== "function") {
    return false;
  }

  const anchorAssistant = anchorEl.closest("article.assistant-message, .assistant-message");
  const focusAssistant = focusEl.closest("article.assistant-message, .assistant-message");

  if (!anchorAssistant || !focusAssistant || anchorAssistant !== focusAssistant) {
    return false;
  }

  if (
    anchorEl.closest(".message-actions, .response-meta, .related-questions, button") ||
    focusEl.closest(".message-actions, .response-meta, .related-questions, button")
  ) {
    return false;
  }

  return true;
}

/**
 * Checks whether the current selection is contained inside a document artifact preview area.
 * Excludes editor textareas, artifact toolbars, and action buttons.
 */
export function isSelectionInsideArtifactPreview(selection: Selection | null): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  const text = selection.toString().trim();
  if (!text) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const commonEl =
    common.nodeType === ELEMENT_NODE
      ? (common as Element)
      : common.parentElement;

  if (!commonEl || typeof commonEl.closest !== "function") {
    return false;
  }

  const preview = commonEl.closest(".artifact-content");
  if (!preview) {
    return false;
  }

  if (
    commonEl.closest(
      ".artifact-editor, .artifact-save, .artifact-toolbar, .artifact-footer, .edit-notice, button",
    )
  ) {
    return false;
  }

  const anchorEl =
    selection.anchorNode?.nodeType === ELEMENT_NODE
      ? (selection.anchorNode as Element)
      : selection.anchorNode?.parentElement;
  const focusEl =
    selection.focusNode?.nodeType === ELEMENT_NODE
      ? (selection.focusNode as Element)
      : selection.focusNode?.parentElement;

  if (!anchorEl || !focusEl || typeof anchorEl.closest !== "function" || typeof focusEl.closest !== "function") {
    return false;
  }

  const anchorPreview = anchorEl.closest(".artifact-content");
  const focusPreview = focusEl.closest(".artifact-content");

  if (!anchorPreview || !focusPreview || anchorPreview !== focusPreview) {
    return false;
  }

  if (
    anchorEl.closest(".artifact-editor, button") ||
    focusEl.closest(".artifact-editor, button")
  ) {
    return false;
  }

  return true;
}

/**
 * Calculates viewport coordinates for positioning the floating button above (or below) selection.
 */
export function getSelectionCoordinates(
  selection: Selection,
  buttonHeight = 32,
): { top: number; left: number } | null {
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;

  const gap = 8;
  let top = rect.top - buttonHeight - gap;
  if (top < 10) {
    top = rect.bottom + gap;
  }

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const left = rect.left + rect.width / 2;
  const clampedLeft = Math.max(70, Math.min(viewportWidth - 70, left));

  return { top, left: clampedLeft };
}

/**
 * Extracts a line of context before and after a specific occurrence of target text within a document string.
 */
export function extractSurroundingContext(
  fullText: string,
  selectedText: string,
  occurrenceIndex = 0,
): { before: string; after: string } {
  if (!fullText || !selectedText) return { before: "", after: "" };

  const trimmedTarget = selectedText.trim();
  if (!trimmedTarget) return { before: "", after: "" };

  let fromIndex = 0;
  let matchIndex = -1;

  for (let i = 0; i <= occurrenceIndex; i++) {
    matchIndex = fullText.indexOf(trimmedTarget, fromIndex);
    if (matchIndex === -1) break;
    if (i < occurrenceIndex) {
      fromIndex = matchIndex + trimmedTarget.length;
    }
  }

  if (matchIndex === -1) return { before: "", after: "" };

  const preText = fullText.slice(0, matchIndex);
  const postText = fullText.slice(matchIndex + trimmedTarget.length);

  const preLines = preText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const before = preLines.length > 0 ? preLines[preLines.length - 1].trim() : "";

  const postLines = postText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const after = postLines.length > 0 ? postLines[0].trim() : "";

  return { before, after };
}

/**
 * Extracts surrounding text context from DOM selection ranges.
 */
export function getSurroundingContextFromSelection(
  selection: Selection,
): { before: string; after: string } {
  if (!selection.rangeCount) return { before: "", after: "" };
  const range = selection.getRangeAt(0);

  let before = "";
  let after = "";

  const startNode = range.startContainer;
  const endNode = range.endContainer;

  const startEl =
    startNode.nodeType === ELEMENT_NODE
      ? (startNode as Element)
      : startNode.parentElement;
  const blockEl =
    startEl?.closest("p, h1, h2, h3, h4, h5, h6, li, pre, blockquote") || startEl;

  if (blockEl && typeof document !== "undefined") {
    try {
      const preRange = document.createRange();
      preRange.setStart(blockEl, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const preText = preRange.toString().trim();
      if (preText) {
        const lines = preText.split(/\r?\n/).filter(Boolean);
        before = lines[lines.length - 1] || "";
      } else if (blockEl.previousElementSibling) {
        before = blockEl.previousElementSibling.textContent?.trim().slice(-120) || "";
      }
    } catch {
      // Fallback
    }

    try {
      const postRange = document.createRange();
      postRange.setStart(range.endContainer, range.endOffset);
      postRange.setEnd(blockEl, blockEl.childNodes.length);
      const postText = postRange.toString().trim();
      if (postText) {
        const lines = postText.split(/\r?\n/).filter(Boolean);
        after = lines[0] || "";
      } else if (blockEl.nextElementSibling) {
        after = blockEl.nextElementSibling.textContent?.trim().slice(0, 120) || "";
      }
    } catch {
      // Fallback
    }
  }

  return { before, after };
}

export interface ArtifactChangePromptOptions {
  artifactId: string;
  artifactTitle?: string;
  currentVersion: number;
  selectedText: string;
  instruction: string;
  contextBefore?: string;
  contextAfter?: string;
}

/**
 * Builds the user prompt sent when "Change this" is submitted inside a document artifact.
 * Includes artifact ID, current version, quoted passage with surrounding context, and user instruction.
 */
export function buildArtifactChangePrompt({
  artifactId,
  artifactTitle,
  currentVersion,
  selectedText,
  instruction,
  contextBefore,
  contextAfter,
}: ArtifactChangePromptOptions): string {
  const titlePart = artifactTitle ? ` "${artifactTitle}"` : "";
  let prompt = `In the document artifact${titlePart} (ID: ${artifactId}, current version: ${currentVersion}), update the following passage:\n\n`;

  if (contextBefore && contextBefore.trim()) {
    prompt += `Context before:\n${formatQuote(contextBefore.trim())}\n`;
  }

  prompt += `Passage to change:\n${formatQuote(selectedText.trim())}\n`;

  if (contextAfter && contextAfter.trim()) {
    prompt += `Context after:\n${formatQuote(contextAfter.trim())}\n`;
  }

  prompt += `Instruction:\n${instruction.trim()}\n\n`;
  prompt += `Please change only this target passage in artifact ${artifactId} (expectedVersion: ${currentVersion}) according to the instruction, keeping the rest of the document unchanged. Apply the update using update_artifact.`;

  return prompt;
}

/**
 * Determines whether an artifact panel should immediately refresh on an artifact update event.
 * If the Edit tab is active and has unsaved changes (draft !== content), returns false so the
 * user's unsaved work is not overwritten; instead a "New version available" notice is shown.
 */
export function shouldRefreshArtifactOnUpdate(
  tab: "preview" | "edit",
  draft: string,
  content: string,
): boolean {
  if (tab === "edit" && draft !== content) {
    return false;
  }
  return true;
}

