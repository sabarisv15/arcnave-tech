// @vitest-environment jsdom
/**
 * RG6 (ADR-0078): one AbortController per chat in the tab. Two chats can stream at once, and
 * Stop on one ends only that one.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamEvent } from "./adapter";

const signals = new Map<string, AbortSignal>();
const keys: string[] = [];

// One user object: the workspace reloads everything when `user` changes identity.
const session = { user: { id: "u1", email: "u@example.test", name: "U" } };
vi.mock("./session", () => ({
  useSession: () => session,
  applyTheme: () => {},
}));

vi.mock("./adapter", () => ({
  attach: async function* () {},
  async *generate(chatId: string, _req: unknown, signal: AbortSignal, options?: { idempotencyKey?: string }): AsyncGenerator<StreamEvent> {
    signals.set(chatId, signal);
    keys.push(options?.idempotencyKey ?? "");
    yield { type: "ack", turnId: `t-${chatId}`, messageId: `m-${chatId}`, userMessageId: `u-${chatId}` };
    // A run that goes on until it is stopped.
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new DOMException("Aborted", "AbortError");
  },
}));

const stopCalls: string[] = [];
vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  const page = { items: [], nextCursor: null };
  const chat = (id: string) => ({ id, familyId: id, title: id, projectId: null, pinned: false, version: 1, createdAt: null, updatedAt: null, messages: [] });
  return {
    ...real,
    api: {
      ...real.api,
      chats: {
        ...real.api.chats,
        list: async () => ({ items: [chat("a"), chat("b")], nextCursor: null }),
        read: async (id: string) => chat(id),
        stop: async (id: string) => {
          stopCalls.push(id);
          return { stopped: true };
        },
      },
      projects: { ...real.api.projects, list: async () => page },
      artifacts: { ...real.api.artifacts, list: async () => page },
      preferences: {
        ...real.api.preferences,
        read: async () => ({ theme: "system", font: "sans", modelAlias: "Auto", effort: null, instructions: "", enterToSend: true, reducedMotion: false, defaultMode: "chat", saveHistory: true, memoryEnabled: true, chatSearchEnabled: true, styleId: "normal", version: 1 }),
      },
    },
  };
});

import { useWorkspace, WorkspaceProvider } from "./workspace";

let ws: ReturnType<typeof useWorkspace>;
function Probe() {
  ws = useWorkspace();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no matchMedia; the workspace reads the colour scheme through it.
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  signals.clear();
  keys.length = 0;
  stopCalls.length = 0;
});
let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  vi.clearAllMocks();
});

/** Polls `check` inside act until it stops throwing (React state settles between ticks). */
async function waitFor(check: () => void, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > end) throw error;
      await act(async () => new Promise((r) => setTimeout(r, 10)));
    }
  }
}

describe("a controller per chat", () => {
  it("streams two chats at once; Stop on one does not stop the other", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <MemoryRouter initialEntries={["/chat/a"]}>
          <WorkspaceProvider>
            <Probe />
          </WorkspaceProvider>
        </MemoryRouter>,
      ),
    );
    await waitFor(() => expect(ws.ready).toBe(true));

    act(() => ws.send("first", "chat", [], "a"));
    await waitFor(() => expect(signals.has("a")).toBe(true));
    act(() => ws.send("second", "chat", [], "b"));
    await waitFor(() => expect(signals.has("b")).toBe(true));
    expect(ws.runningChats.sort()).toEqual(["a", "b"]);
    // One Idempotency-Key per send.
    expect(new Set(keys).size).toBe(2);

    act(() => ws.stop("a"));
    await waitFor(() => expect(signals.get("a")!.aborted).toBe(true));
    expect(signals.get("b")!.aborted).toBe(false);
    expect(stopCalls).toEqual(["a"]);
    await waitFor(() => expect(ws.runningChats).toEqual(["b"]));

    act(() => ws.stop("b"));
    await waitFor(() => expect(signals.get("b")!.aborted).toBe(true));
  });
});
