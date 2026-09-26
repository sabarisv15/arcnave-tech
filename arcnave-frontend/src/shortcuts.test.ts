import { describe, expect, it, vi } from "vitest";
import { handleAppKeyDown } from "./shortcuts";
import type { Message } from "./types";

describe("handleAppKeyDown", () => {
  const makeHandlers = (overrides = {}) => ({
    navigate: vi.fn(),
    setPanel: vi.fn(),
    setSearch: vi.fn(),
    setSettings: vi.fn(),
    toast: vi.fn(),
    activeChatId: "chat-1",
    messages: {
      "chat-1": [
        { id: "m1", seq: 1, role: "user", text: "hi", mode: "chat", status: "complete" } as Message,
        { id: "m2", seq: 2, role: "assistant", text: "Hello there!", mode: "chat", status: "complete" } as Message,
      ],
    },
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const createEvent = (init: {
    key: string;
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  }) => ({
    key: init.key,
    code: init.code,
    ctrlKey: init.ctrlKey,
    metaKey: init.metaKey,
    shiftKey: init.shiftKey,
    preventDefault: vi.fn(),
  });

  it("ignores key events without Ctrl or Cmd modifier", () => {
    const handlers = makeHandlers();
    const event = createEvent({ key: "k" });
    const handled = handleAppKeyDown(event, handlers);

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(handlers.navigate).not.toHaveBeenCalled();
  });

  it("navigates to new conversation on Ctrl+Shift+O (with uppercase O from Shift)", () => {
    const handlers = makeHandlers();
    const event = createEvent({ key: "O", code: "KeyO", ctrlKey: true, shiftKey: true });
    const handled = handleAppKeyDown(event, handlers);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlers.navigate).toHaveBeenCalledWith("/");
    expect(handlers.setPanel).toHaveBeenCalledWith({ kind: "closed" });
  });

  it("navigates to new conversation on Cmd+Shift+O", () => {
    const handlers = makeHandlers();
    const event = createEvent({ key: "o", code: "KeyO", metaKey: true, shiftKey: true });
    const handled = handleAppKeyDown(event, handlers);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlers.navigate).toHaveBeenCalledWith("/");
    expect(handlers.setPanel).toHaveBeenCalledWith({ kind: "closed" });
  });

  it("keeps Ctrl+K and Cmd+K for new conversation", () => {
    const handlers = makeHandlers();
    const eventCtrl = createEvent({ key: "k", code: "KeyK", ctrlKey: true });
    expect(handleAppKeyDown(eventCtrl, handlers)).toBe(true);
    expect(handlers.navigate).toHaveBeenCalledWith("/");

    const eventCmd = createEvent({ key: "K", code: "KeyK", metaKey: true });
    expect(handleAppKeyDown(eventCmd, handlers)).toBe(true);
  });

  it("opens search on Ctrl+P and Cmd+P", () => {
    const handlers = makeHandlers();
    const event = createEvent({ key: "p", code: "KeyP", ctrlKey: true });
    const handled = handleAppKeyDown(event, handlers);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlers.setSearch).toHaveBeenCalledWith(true);
  });

  it("opens settings on Ctrl+, and Cmd+,", () => {
    const handlers = makeHandlers();
    const event = createEvent({ key: ",", ctrlKey: true });
    const handled = handleAppKeyDown(event, handlers);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlers.setSettings).toHaveBeenCalledWith(true);
  });

  it("copies last complete assistant response on Ctrl+Shift+C", async () => {
    const handlers = makeHandlers();
    const event = createEvent({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true });
    const handled = handleAppKeyDown(event, handlers);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlers.writeClipboard).toHaveBeenCalledWith("Hello there!");

    await Promise.resolve();
    expect(handlers.toast).toHaveBeenCalledWith("Response copied to clipboard");
  });

  it("copies last complete assistant response on Cmd+Shift+C", async () => {
    const handlers = makeHandlers();
    const event = createEvent({ key: "c", code: "KeyC", metaKey: true, shiftKey: true });
    const handled = handleAppKeyDown(event, handlers);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(handlers.writeClipboard).toHaveBeenCalledWith("Hello there!");

    await Promise.resolve();
    expect(handlers.toast).toHaveBeenCalledWith("Response copied to clipboard");
  });

  it("notifies when no completed assistant response is available", () => {
    const handlers = makeHandlers({
      messages: {
        "chat-1": [
          { id: "m1", seq: 1, role: "user", text: "hi", mode: "chat", status: "complete" } as Message,
          { id: "m2", seq: 2, role: "assistant", text: "Generating...", mode: "chat", status: "generating" } as Message,
        ],
      },
    });
    const event = createEvent({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true });
    const handled = handleAppKeyDown(event, handlers);

    expect(handled).toBe(true);
    expect(handlers.writeClipboard).not.toHaveBeenCalled();
    expect(handlers.toast).toHaveBeenCalledWith("No response to copy.");
  });

  it("shows fallback toast when clipboard write fails", async () => {
    const handlers = makeHandlers({
      writeClipboard: vi.fn().mockRejectedValue(new Error("Permission denied")),
    });
    const event = createEvent({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true });
    handleAppKeyDown(event, handlers);

    await Promise.resolve();
    await Promise.resolve();
    expect(handlers.toast).toHaveBeenCalledWith(
      "Clipboard access is unavailable. Export the conversation instead.",
    );
  });
});
