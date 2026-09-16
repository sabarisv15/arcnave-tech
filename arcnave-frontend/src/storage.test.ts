import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { initialWorkspace } from "./fixtures";
import {
  loadWorkspace,
  persistWorkspace,
  readFile,
  storeFile,
  STORAGE_KEY,
} from "./storage";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

describe("workspace recovery", () => {
  it("retains artifact drafts and recovers interrupted responses after reload", () => {
    const workspace = initialWorkspace();
    workspace.artifacts[0].draft = "An unfinished thought";
    workspace.chats[0].messages[0].status = "generating";
    persistWorkspace(workspace);
    const restored = loadWorkspace();
    expect(restored.artifacts[0].draft).toBe("An unfinished thought");
    expect(restored.chats[0].messages[0].status).toBe("stopped");
  });
  it("does not persist conversations when history is disabled", () => {
    const workspace = initialWorkspace();
    workspace.preferences.saveHistory = false;
    persistWorkspace(workspace);
    expect(loadWorkspace().chats).toEqual([]);
  });
  it("recovers from malformed saved data", () => {
    localStorage.setItem(STORAGE_KEY, "{broken");
    expect(loadWorkspace().projects.length).toBeGreaterThan(0);
  });
});

describe("local file storage", () => {
  it("round trips attachment contents and handles missing files", async () => {
    await storeFile(
      "qa-roundtrip",
      new File(["Only local test content"], "notes.txt", {
        type: "text/plain",
      }),
    );
    const restored = await readFile("qa-roundtrip");
    expect(await restored?.text()).toBe("Only local test content");
    expect(await readFile("qa-missing")).toBeUndefined();
  });
});
