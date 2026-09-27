import { describe, expect, it } from "vitest";
import {
  buildArtifactChangePrompt,
  extractSurroundingContext,
  formatQuote,
  getSelectionCoordinates,
  isSelectionInsideArtifactPreview,
  isSelectionInsideAssistant,
  shouldRefreshArtifactOnUpdate,
} from "./selection";

interface MockElement {
  nodeType: number;
  className?: string;
  closest?: (selector: string) => MockElement | null;
  parentElement?: MockElement | null;
}

function createMockElement(
  className: string,
  parent: MockElement | null = null,
): MockElement {
  const el: MockElement = {
    nodeType: 1,
    className,
    parentElement: parent,
  };
  el.closest = (selector: string): MockElement | null => {
    const selectors = selector.split(",").map((s) => s.trim());
    let current: MockElement | null = el;
    while (current) {
      for (const sel of selectors) {
        const cls = sel.replace(/^\./, "").replace(/^article\./, "");
        if (current.className?.split(/\s+/).includes(cls)) {
          return current;
        }
      }
      current = current.parentElement ?? null;
    }
    return null;
  };
  return el;
}

describe("formatQuote", () => {
  it("returns an empty string for empty or whitespace-only inputs", () => {
    expect(formatQuote("")).toBe("");
    expect(formatQuote("   \n\t  ")).toBe("");
  });

  it("formats a single-line string as a blockquote followed by an empty line", () => {
    expect(formatQuote("This is a single sentence.")).toBe(
      "> This is a single sentence.\n\n",
    );
  });

  it("formats multi-line strings with blockquote prefix on each line", () => {
    const input = "Line 1\nLine 2\nLine 3";
    const expected = "> Line 1\n> Line 2\n> Line 3\n\n";
    expect(formatQuote(input)).toBe(expected);
  });

  it("preserves empty lines inside multi-line selections as empty blockquote lines", () => {
    const input = "First paragraph\n\nSecond paragraph";
    const expected = "> First paragraph\n>\n> Second paragraph\n\n";
    expect(formatQuote(input)).toBe(expected);
  });

  it("trims external whitespace but cleans internal lines properly", () => {
    const input = "   Leading line   \n   Trailing line   ";
    const expected = "> Leading line\n> Trailing line\n\n";
    expect(formatQuote(input)).toBe(expected);
  });
});

describe("extractSurroundingContext & buildArtifactChangePrompt", () => {
  it("formats a change prompt naming artifact id, version, context, and instruction", () => {
    const prompt = buildArtifactChangePrompt({
      artifactId: "art-123",
      artifactTitle: "Project Roadmap",
      currentVersion: 2,
      selectedText: "Phase 1 will take 3 weeks.",
      instruction: "Extend Phase 1 to 4 weeks.",
      contextBefore: "Project Timeline Overview",
      contextAfter: "Phase 2 will begin immediately.",
    });

    expect(prompt).toContain('artifact "Project Roadmap" (ID: art-123, current version: 2)');
    expect(prompt).toContain("Context before:\n> Project Timeline Overview\n");
    expect(prompt).toContain("Passage to change:\n> Phase 1 will take 3 weeks.\n");
    expect(prompt).toContain("Context after:\n> Phase 2 will begin immediately.\n");
    expect(prompt).toContain("Instruction:\nExtend Phase 1 to 4 weeks.");
    expect(prompt).toContain("update_artifact");
    expect(prompt).toContain("expectedVersion: 2");
  });

  it("correctly identifies context for a passage that appears twice in the document", () => {
    const documentBody = `
# Executive Report

Annual budget allocation: $50,000 for team training.
Department: Marketing.

## Operations
Annual budget allocation: $50,000 for team training.
Department: Engineering.
    `.trim();

    const target = "Annual budget allocation: $50,000 for team training.";

    // First occurrence
    const firstContext = extractSurroundingContext(documentBody, target, 0);
    expect(firstContext.before).toBe("# Executive Report");
    expect(firstContext.after).toBe("Department: Marketing.");

    const firstPrompt = buildArtifactChangePrompt({
      artifactId: "report-uuid",
      artifactTitle: "Budget Report",
      currentVersion: 1,
      selectedText: target,
      instruction: "Increase marketing budget to $75,000.",
      contextBefore: firstContext.before,
      contextAfter: firstContext.after,
    });

    expect(firstPrompt).toContain("Context before:\n> # Executive Report\n");
    expect(firstPrompt).toContain("Passage to change:\n> Annual budget allocation: $50,000 for team training.\n");
    expect(firstPrompt).toContain("Context after:\n> Department: Marketing.\n");
    expect(firstPrompt).toContain("Increase marketing budget to $75,000.");

    // Second occurrence
    const secondContext = extractSurroundingContext(documentBody, target, 1);
    expect(secondContext.before).toBe("## Operations");
    expect(secondContext.after).toBe("Department: Engineering.");

    const secondPrompt = buildArtifactChangePrompt({
      artifactId: "report-uuid",
      artifactTitle: "Budget Report",
      currentVersion: 1,
      selectedText: target,
      instruction: "Increase engineering budget to $120,000.",
      contextBefore: secondContext.before,
      contextAfter: secondContext.after,
    });

    expect(secondPrompt).toContain("Context before:\n> ## Operations\n");
    expect(secondPrompt).toContain("Passage to change:\n> Annual budget allocation: $50,000 for team training.\n");
    expect(secondPrompt).toContain("Context after:\n> Department: Engineering.\n");
    expect(secondPrompt).toContain("Increase engineering budget to $120,000.");

    // Both prompts target the exact same sentence text, but their surrounding context distinctly isolates the occurrence!
    expect(firstPrompt).not.toEqual(secondPrompt);
  });
});

describe("isSelectionInsideAssistant", () => {
  it("returns false for null, collapsed, or empty selections", () => {
    expect(isSelectionInsideAssistant(null)).toBe(false);

    const collapsedSelection = {
      isCollapsed: true,
      rangeCount: 1,
      toString: () => "",
    } as unknown as Selection;
    expect(isSelectionInsideAssistant(collapsedSelection)).toBe(false);

    const emptySelection = {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "   ",
    } as unknown as Selection;
    expect(isSelectionInsideAssistant(emptySelection)).toBe(false);
  });

  it("returns true when selection is strictly within an assistant message", () => {
    const article = createMockElement("assistant-message");
    const p = createMockElement("paragraph", article);

    const range = {
      commonAncestorContainer: p,
    } as unknown as Range;

    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      anchorNode: p,
      focusNode: p,
      toString: () => "The quick brown fox jumps over the lazy dog.",
    } as unknown as Selection;

    expect(isSelectionInsideAssistant(selection)).toBe(true);
  });

  it("returns false when selection is within a user message", () => {
    const div = createMockElement("user-message");
    const p = createMockElement("paragraph", div);

    const range = {
      commonAncestorContainer: p,
    } as unknown as Range;

    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      anchorNode: p,
      focusNode: p,
      toString: () => "Hello ArcNave, what is the plan?",
    } as unknown as Selection;

    expect(isSelectionInsideAssistant(selection)).toBe(false);
  });

  it("returns false when selection is inside assistant actions or metadata buttons", () => {
    const article = createMockElement("assistant-message");
    const actions = createMockElement("message-actions", article);
    const button = createMockElement("icon-button", actions);

    const range = {
      commonAncestorContainer: button,
    } as unknown as Range;

    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      anchorNode: button,
      focusNode: button,
      toString: () => "Copy response",
    } as unknown as Selection;

    expect(isSelectionInsideAssistant(selection)).toBe(false);
  });

  it("returns false when selection spans across different messages", () => {
    const root = createMockElement("messages");
    const msg1 = createMockElement("assistant-message", root);
    const p1 = createMockElement("paragraph", msg1);
    const msg2 = createMockElement("assistant-message", root);
    const p2 = createMockElement("paragraph", msg2);

    const range = {
      commonAncestorContainer: root,
    } as unknown as Range;

    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      anchorNode: p1,
      focusNode: p2,
      toString: () => "Message 1 Message 2",
    } as unknown as Selection;

    expect(isSelectionInsideAssistant(selection)).toBe(false);
  });
});

describe("isSelectionInsideArtifactPreview", () => {
  it("returns true when selection is in artifact preview content", () => {
    const container = createMockElement("artifact-content");
    const p = createMockElement("markdown-paragraph", container);

    const range = {
      commonAncestorContainer: p,
    } as unknown as Range;

    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      anchorNode: p,
      focusNode: p,
      toString: () => "Introduction paragraph in draft document.",
    } as unknown as Selection;

    expect(isSelectionInsideArtifactPreview(selection)).toBe(true);
  });

  it("returns false when selection is in artifact editor textarea or toolbar", () => {
    const container = createMockElement("artifact-content");
    const textarea = createMockElement("artifact-editor", container);

    const range = {
      commonAncestorContainer: textarea,
    } as unknown as Range;

    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      anchorNode: textarea,
      focusNode: textarea,
      toString: () => "Drafting raw content",
    } as unknown as Selection;

    expect(isSelectionInsideArtifactPreview(selection)).toBe(false);
  });
});

describe("getSelectionCoordinates", () => {
  it("returns null when there are no ranges or 0-dimension rect", () => {
    const emptySelection = {
      rangeCount: 0,
    } as unknown as Selection;
    expect(getSelectionCoordinates(emptySelection)).toBeNull();

    const zeroRectSelection = {
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
        }),
      }),
    } as unknown as Selection;
    expect(getSelectionCoordinates(zeroRectSelection)).toBeNull();
  });

  it("positions button above the selection when there is sufficient room", () => {
    const selection = {
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({
          top: 150,
          bottom: 170,
          left: 200,
          right: 300,
          width: 100,
          height: 20,
        }),
      }),
    } as unknown as Selection;

    const coords = getSelectionCoordinates(selection, 32);
    expect(coords).not.toBeNull();
    // top should be rect.top - buttonHeight - gap: 150 - 32 - 8 = 110
    expect(coords!.top).toBe(110);
    // left centered over rect: 200 + 100 / 2 = 250
    expect(coords!.left).toBe(250);
  });

  it("flips button below the selection when room is constrained at top", () => {
    const selection = {
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({
          top: 20,
          bottom: 40,
          left: 200,
          right: 300,
          width: 100,
          height: 20,
        }),
      }),
    } as unknown as Selection;

    const coords = getSelectionCoordinates(selection, 32);
    expect(coords).not.toBeNull();
    // rect.top - 32 - 8 = -20 (< 10), so flips to rect.bottom + 8 = 40 + 8 = 48
    expect(coords!.top).toBe(48);
  });
});

describe("shouldRefreshArtifactOnUpdate", () => {
  it("returns true when the artifact is in the preview tab", () => {
    expect(shouldRefreshArtifactOnUpdate("preview", "unsaved edits", "original content")).toBe(true);
    expect(shouldRefreshArtifactOnUpdate("preview", "original content", "original content")).toBe(true);
  });

  it("returns true when in the edit tab but no changes have been made", () => {
    expect(shouldRefreshArtifactOnUpdate("edit", "same content", "same content")).toBe(true);
  });

  it("returns false when in the edit tab with unsaved changes so work is not overwritten", () => {
    expect(shouldRefreshArtifactOnUpdate("edit", "user modified draft", "original content")).toBe(false);
  });
});

