import { describe, expect, it, vi, beforeEach } from "vitest";
import { copyTextToClipboard } from "./clipboard";

describe("copyTextToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when navigator.clipboard.writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });

    const result = await copyTextToClipboard("sample text");
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("sample text");
  });

  it("falls back to execCommand and returns true when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const execCommand = vi.fn().mockReturnValue(true);

    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({
          style: {},
          setAttribute: () => {},
          select: () => {},
          setSelectionRange: () => {},
        }),
        body: {
          appendChild: () => {},
          removeChild: () => {},
        },
        execCommand,
      },
      configurable: true,
      writable: true,
    });

    const result = await copyTextToClipboard("sample text");
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when both clipboard API and execCommand fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const execCommand = vi.fn().mockReturnValue(false);

    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({
          style: {},
          setAttribute: () => {},
          select: () => {},
          setSelectionRange: () => {},
        }),
        body: {
          appendChild: () => {},
          removeChild: () => {},
        },
        execCommand,
      },
      configurable: true,
      writable: true,
    });

    const result = await copyTextToClipboard("sample text");
    expect(result).toBe(false);
  });
});
