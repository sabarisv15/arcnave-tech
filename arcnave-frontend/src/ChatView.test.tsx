// @vitest-environment jsdom
// The conversation page with the chat states of board S6 wired in: what a reply that ended badly
// shows, what the model label says, edit in place, the row under the composer, and Settings as a page.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message, Preferences } from "./types";

const session = vi.hoisted(() => ({
  loading: false,
  expired: false,
  user: { id: "u1", name: "Priya S", email: "priya@example.com" },
  models: null,
  signOut: () => Promise.resolve(),
  refreshModels: () => Promise.resolve(),
}));
const workspace = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("./session", () => ({
  SessionProvider: ({ children }: { children: unknown }) => children,
  useSession: () => session,
  applyTheme: () => undefined,
}));
vi.mock("./workspace", () => ({
  WorkspaceProvider: ({ children }: { children: unknown }) => children,
  useWorkspace: () => workspace.value,
}));
import App from "./App";
import { api } from "./api";

const now = new Date().toISOString();
const chat = {
  id: "c1",
  familyId: "c1",
  title: "Internal marks summary",
  projectId: null,
  pinned: false,
  version: 1,
  updatedAt: now,
} as Chat;
const preferences = {
  theme: "light",
  font: "sans",
  modelAlias: "Auto",
  effort: null,
  instructions: "",
  enterToSend: true,
  reducedMotion: false,
  defaultMode: "chat",
  saveHistory: true,
  memoryEnabled: true,
  chatSearchEnabled: true,
  styleId: "normal",
  version: 0,
} as Preferences;
const user: Message = { id: "m1", seq: 1, role: "user", text: "Write the letter", mode: "chat", status: "complete" };
const reply = (extra: Partial<Message>): Message => ({
  id: "m2",
  seq: 2,
  role: "assistant",
  text: "",
  mode: "chat",
  status: "complete",
  ...extra,
});

let host: HTMLDivElement;
let root: Root;
let send: ReturnType<typeof vi.fn>;
let retry: ReturnType<typeof vi.fn>;
let setEdit: ReturnType<typeof vi.fn>;
let setSettings: ReturnType<typeof vi.fn>;

function setWorkspace(history: Message[], extra: Record<string, unknown> = {}) {
  const fn = () => vi.fn();
  send = vi.fn();
  retry = vi.fn();
  setEdit = vi.fn();
  setSettings = vi.fn();
  workspace.value = {
    chats: [chat],
    projects: [],
    artifacts: [],
    preferences,
    messages: { c1: history },
    transcript: { c1: "ready" },
    ready: true,
    loadError: null,
    panel: { kind: "closed" },
    toastText: "",
    settings: false,
    search: false,
    activeRun: null,
    versionAnchor: null,
    edit: null,
    quote: null,
    artifactUpdateEvent: null,
    setPanel: fn(),
    setSearch: fn(),
    setSettings,
    toast: fn(),
    openChat: fn(),
    send,
    retry,
    stop: fn(),
    feedback: fn(),
    renameChat: fn(),
    pinChat: fn(),
    moveChat: fn(),
    deleteChat: fn(),
    branch: fn(),
    switchVersion: fn(),
    exportChat: fn(),
    saveResponseAsArtifact: fn(),
    saveVisualAsArtifact: fn(),
    updatePreferences: fn(),
    refreshPreferences: vi.fn(() => Promise.resolve()),
    refreshChats: vi.fn(() => Promise.resolve()),
    refreshProjects: vi.fn(() => Promise.resolve()),
    refreshArtifacts: vi.fn(() => Promise.resolve()),
    setEdit,
    insertQuote: fn(),
    consumeQuote: fn(),
    ...extra,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(api.styles, "list").mockRejectedValue(new Error("offline"));
  vi.spyOn(api.usage, "messages").mockResolvedValue({ items: [] } as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(route = "/chat/c1") {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    );
  });
}
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

describe("a reply that ended badly", () => {
  it.each([
    ["provider_limit", "warn"],
    ["budget_exceeded", "warn"],
    ["model_refused", "info"],
    ["provider_timeout", "err"],
  ])("%s shows a %s card with Retry", async (code, tone) => {
    setWorkspace([user, reply({ status: "error", error: code })]);
    await show();
    const card = host.querySelector(".cs-failure")!;
    expect(card.getAttribute("data-code")).toBe(code);
    expect(card.classList.contains(`cs-${tone}`)).toBe(true);
    act(() => button("Retry")!.click());
    expect(retry).toHaveBeenCalledWith("c1", "m2");
  });

  it("a stored refusal reads the same after a reload as it did live", async () => {
    setWorkspace([user, reply({ status: "error", error: "model_refused" })]);
    await show();
    const stored = host.querySelector(".cs-failure")!.textContent;
    setWorkspace([
      user,
      reply({ status: "error", error: "model_refused", errorTitle: "other words", errorDetail: "" }),
    ]);
    await show();
    expect(host.querySelector(".cs-failure")!.textContent).toBe(stored);
  });

  it.each(["tool_limit", "max_tokens"])("cut short by %s offers Continue, which asks again in this chat", async (finishReason) => {
    setWorkspace([user, reply({ text: "Partial answer", finishReason })]);
    await show();
    expect(host.querySelector(".cs-cut")).not.toBeNull();
    act(() => button("Continue")!.click());
    expect(send).toHaveBeenCalledWith("Continue exactly where you stopped.", "chat", [], "c1");
  });

  it("a stopped answer keeps its text and offers Continue and Regenerate", async () => {
    setWorkspace([user, reply({ text: "Half a letter", status: "stopped" })]);
    await show();
    expect(host.textContent).toContain("Half a letter");
    expect(host.querySelector(".cs-stopped")).not.toBeNull();
    act(() => button("Regenerate")!.click());
    expect(retry).toHaveBeenCalledWith("c1", "m2");
    act(() => button("Continue")!.click());
    expect(send).toHaveBeenCalled();
  });

  it("a connection that dropped mid-answer offers Continue instead of a retry", async () => {
    setWorkspace([user, reply({ text: "Dear parents,", status: "error", error: "network" })]);
    await show();
    expect(host.querySelector(".cs-dropped")).not.toBeNull();
    expect(host.querySelector(".cs-failure")).toBeNull();
  });
});

describe("a reply that was being written", () => {
  it("is stamped Done when it finishes, and not when it was already finished", async () => {
    setWorkspace([user, reply({ text: "Draft", status: "generating" })]);
    await show();
    expect(host.querySelector('.ai-status-row[data-state="writing"]')).not.toBeNull();
    setWorkspace([user, reply({ text: "Draft. Final.", status: "complete" })]);
    await show();
    const done = host.querySelector('.ai-status-row[data-state="done"]');
    expect(done).not.toBeNull();
    expect(done!.textContent).toContain("Done");

    setWorkspace([user, reply({ text: "Old answer", status: "complete" })]);
    await act(async () => root.unmount());
    root = createRoot(host);
    await show();
    expect(host.querySelector(".ai-status-row")).toBeNull();
  });
});

describe("under every answer", () => {
  it("names the model and the effort that wrote it", async () => {
    setWorkspace([user, reply({ text: "Done.", modelAlias: "Gemini 3.8 Flash", effort: "medium" })]);
    await show();
    expect(host.querySelector(".cs-mlab")!.textContent).toBe("Gemini 3.8 Flash · Medium");
  });
});

describe("the row under the composer", () => {
  it("puts the model and effort chip there, with the reminder in a conversation", async () => {
    setWorkspace([user, reply({ text: "Done." })]);
    await show();
    const row = host.querySelector(".composer-under")!;
    expect(row.textContent).toContain("arcnave can make mistakes.");
    expect(row.querySelector(".cs-model-chip")!.getAttribute("aria-label")).toContain("Model: Auto");
    // The chip left the toolbar inside the composer.
    expect(host.querySelector(".composer-toolbar .cs-model-chip")).toBeNull();
  });

  it("has no reminder on a new chat, only the chip", async () => {
    setWorkspace([]);
    await show("/app");
    const row = host.querySelector(".composer-under")!;
    expect(row.textContent).not.toContain("can make mistakes");
    expect(row.querySelector(".cs-model-chip")).not.toBeNull();
  });
});

describe("edit in place", () => {
  it("takes the bubble's place and sends the edit", async () => {
    setWorkspace([user, reply({ text: "Done." })], {
      edit: { chatId: "c1", messageId: "m1", text: "Write the letter" },
    });
    await show();
    expect(host.querySelector(".user-bubble")).toBeNull();
    const field = host.querySelector<HTMLTextAreaElement>(".cs-edit textarea")!;
    expect(field.value).toBe("Write the letter");
    act(() => button("Send")!.click());
    expect(send).toHaveBeenCalledWith("Write the letter", "chat", [], "c1");
    act(() => button("Cancel")!.click());
    expect(setEdit).toHaveBeenCalledWith(null);
  });

  it("the composer waits while a message is being edited", async () => {
    setWorkspace([user, reply({ text: "Done." })], {
      edit: { chatId: "c1", messageId: "m1", text: "Write the letter" },
    });
    await show();
    expect(host.querySelector<HTMLButtonElement>(".composer .send-button")!.disabled).toBe(true);
  });
});

describe("chat title menu", () => {
  it("is a button that opens the chat menu", async () => {
    setWorkspace([user, reply({ text: "Done." })]);
    await show();
    const title = host.querySelector<HTMLButtonElement>("button.cs-title")!;
    expect(title.textContent).toBe("Internal marks summary");
    expect(title.getAttribute("aria-label")).toBe("Actions for Internal marks summary");
  });
});

describe("settings is a page", () => {
  it("the old flag takes you to /settings", async () => {
    setWorkspace([user, reply({ text: "Done." })], { settings: true });
    vi.spyOn(api.memory, "list").mockResolvedValue({ items: [], total: 0 } as never);
    await show("/app");
    expect(setSettings).toHaveBeenCalledWith(false);
    expect(host.querySelector(".st-page")).not.toBeNull();
    expect(host.querySelector(".st-title")!.textContent).toBe("Settings");
  });
});
