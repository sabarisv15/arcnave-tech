// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message, Preferences, Project } from "./types";

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
const chat: Chat = {
  id: "c1",
  familyId: "c1",
  title: "Internal marks summary",
  projectId: null,
  pinned: false,
  version: 1,
  updatedAt: now,
} as Chat;
const project: Project = {
  id: "p1",
  title: "EEE 3rd sem",
  description: "",
  instructions: "",
  pinned: true,
  position: 0,
  version: 1,
  updatedAt: now,
  counts: { files: 1, chats: 0, sources: 0, indexedChunks: 0 },
};
const history: Message[] = [
  { id: "m1", seq: 1, role: "user", text: "Summarise the marks", mode: "chat", status: "complete" },
  { id: "m2", seq: 2, role: "assistant", text: "Done. 58 students.", mode: "chat", status: "complete" },
];
const preferences: Preferences = {
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

function fakeWorkspace() {
  const fn = () => vi.fn();
  return {
    chats: [chat],
    projects: [project],
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
    setSettings: fn(),
    toast: fn(),
    openChat: fn(),
    send: fn(),
    retry: fn(),
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
    setEdit: fn(),
    insertQuote: fn(),
    consumeQuote: fn(),
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  workspace.value = fakeWorkspace();
  localStorage.clear();
  // jsdom has no layout or canvas: the conversation scrolls and the living logo draws.
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(api.styles, "list").mockRejectedValue(new Error("offline"));
  vi.spyOn(api.usage, "messages").mockResolvedValue({ items: [] } as never);
  vi.spyOn(api.projects, "read").mockResolvedValue({ files: [], sources: [] } as never);
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

async function show(route: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    );
  });
}
const toggle = () => host.querySelector<HTMLButtonElement>(".an-nav-toggle")!;

describe("app shell, M2 icon rail", () => {
  it("starts as the icon rail, and the toggle expands and collapses it", async () => {
    await show("/app");
    expect(host.querySelector("nav.an-rail")).not.toBeNull();
    expect(host.querySelector("aside.an-wide")).toBeNull();
    expect(toggle().tagName).toBe("BUTTON");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-label")).toBe("Expand sidebar");
    expect(toggle().getAttribute("aria-controls")).toBe("app-nav");

    act(() => toggle().click());
    expect(host.querySelector("aside.an-wide")).not.toBeNull();
    expect(host.querySelector("nav.an-rail")).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Collapse sidebar");
    expect(localStorage.getItem("arcnave-ui:sidebar")).toBe("expanded");
    // the full sidebar lists the pinned project and the recent chat
    expect(host.textContent).toContain("EEE 3rd sem");
    expect(host.textContent).toContain("Internal marks summary");

    act(() => toggle().click());
    expect(host.querySelector("nav.an-rail")).not.toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("arcnave-ui:sidebar")).toBe("collapsed");
  });

  it("reads the stored choice back on the next visit", async () => {
    localStorage.setItem("arcnave-ui:sidebar", "expanded");
    await show("/app");
    expect(host.querySelector("aside.an-wide")).not.toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("still renders and toggles when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => localStorage.getItem("arcnave-ui:sidebar")).toThrow("blocked");
    expect(() => localStorage.setItem("arcnave-ui:sidebar", "x")).toThrow("blocked");
    await show("/app");
    expect(host.querySelector("nav.an-rail")).not.toBeNull();
    act(() => toggle().click());
    expect(host.querySelector("aside.an-wide")).not.toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("marks the current place with the active icon and opens a section panel from the rail", async () => {
    await show("/chat/c1");
    const chats = host.querySelector<HTMLButtonElement>('nav.an-rail button[aria-label="Chats"]')!;
    expect(chats.classList.contains("on")).toBe(true);
    expect(chats.querySelector(".brand-icon--active")).not.toBeNull();
    const projects = host.querySelector<HTMLButtonElement>('nav.an-rail button[aria-label="Projects"]')!;
    expect(projects.querySelector(".brand-icon--active")).toBeNull();

    act(() => projects.click());
    expect(projects.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('aside.an-panel[aria-label="Projects"]')?.textContent).toContain("EEE 3rd sem");
    act(() => host.querySelector<HTMLButtonElement>('aside.an-panel button[aria-label="Close"]')!.click());
    expect(host.querySelector("aside.an-panel")).toBeNull();
  });
});

describe("composer K3", () => {
  it.each([
    ["/app", "composer-k3-new"],
    ["/chat/c1", "composer-k3-reply"],
    ["/project/p1", "composer-k3-new"],
  ])("is on %s", async (route, variant) => {
    await show(route);
    const composers = host.querySelectorAll(".composer.composer-k3");
    expect(composers.length).toBe(1);
    expect(composers[0]!.classList.contains(variant)).toBe(true);
    expect(composers[0]!.querySelector('textarea[aria-label^="Your message"]')).not.toBeNull();
    expect(composers[0]!.querySelector(".send-button")).not.toBeNull();
  });
});
