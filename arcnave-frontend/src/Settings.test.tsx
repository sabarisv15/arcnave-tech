// @vitest-environment jsdom
// The Settings page (board S5): the locked sections are there, every control works today, and a
// row whose backend does not exist yet is read-only text, never a button.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Preferences } from "./types";

const session = vi.hoisted(() => ({
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
import Settings, { SETTINGS_SECTIONS } from "./Settings";
import { api } from "./api";

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

let host: HTMLDivElement;
let root: Root;
const updatePreferences = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  updatePreferences.mockReset();
  workspace.value = {
    preferences,
    updatePreferences,
    toast: vi.fn(),
    refreshPreferences: vi.fn(() => Promise.resolve()),
  };
  vi.spyOn(api.memory, "list").mockResolvedValue({ items: [], total: 0 } as never);
  vi.spyOn(api.share, "list").mockResolvedValue({ items: [] } as never);
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

const open = async (section?: string) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[section ? `/settings?section=${section}` : "/settings"]}>
        <Settings />
      </MemoryRouter>,
    );
  });
};
const texts = (selector: string) =>
  [...host.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? "");
const content = () => host.querySelector(".st-content")!;

describe("Settings page", () => {
  it("lists the board's five sections in the board's order", async () => {
    await open();
    const board: string[] = SETTINGS_SECTIONS.filter((s) => s.board).map((s) => s.label);
    expect(board).toEqual(["Profile", "Appearance", "Memory", "Sign-in & devices", "Data & privacy"]);
    const shown = texts(".st-nav button");
    expect(shown.filter((label) => board.includes(label))).toEqual(board);
    // What the app already had and the board does not draw is added after, never instead.
    expect(shown).toEqual(expect.arrayContaining(["Models", "Usage & limits", "Keyboard shortcuts"]));
  });

  it("marks the open section and opens another on a click", async () => {
    await open();
    expect(host.querySelector('.st-nav [aria-current="page"]')!.textContent).toBe("Profile");
    expect(host.querySelector("h2")!.textContent).toBe("Profile");
    const memory = [...host.querySelectorAll<HTMLButtonElement>(".st-nav button")].find(
      (b) => b.textContent === "Memory",
    )!;
    await act(async () => memory.click());
    expect(host.querySelector("h2")!.textContent).toBe("Memory");
    expect(host.querySelector('.st-nav [aria-current="page"]')!.textContent).toBe("Memory");
  });

  it("opens the section named in the address", async () => {
    await open("data");
    expect(host.querySelector("h2")!.textContent).toBe("Data & privacy");
  });

  it("profile shows the name and e-mail read-only, with the settings that work", async () => {
    await open();
    expect(content().textContent).toContain("Priya S");
    expect(content().textContent).toContain("priya@example.com");
    expect(content().textContent).toContain("Changing your name is not available yet");
    expect(host.querySelector('input[aria-label="Full name"]')).toBeNull();
    const enter = host.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Enter to send"]')!;
    expect(enter.getAttribute("aria-checked")).toBe("true");
    act(() => enter.click());
    expect(updatePreferences).toHaveBeenCalledWith({ enterToSend: false });
  });

  it("appearance changes the theme and the font", async () => {
    await open("appearance");
    const dark = [...host.querySelectorAll<HTMLButtonElement>(".st-thc")].find((b) =>
      b.textContent?.includes("Dark"),
    )!;
    act(() => dark.click());
    expect(updatePreferences).toHaveBeenCalledWith({ theme: "dark" });
    expect(texts(".st-thc")).toEqual(["Light", "Dark", "Same as device"]);
    expect(host.querySelector('select[aria-label="Conversation font"]')).not.toBeNull();
  });

  it("memory has its two switches under the names the assistant uses", async () => {
    await open("memory");
    expect(host.querySelector('button[role="switch"][aria-label="Use and update memory"]')).not.toBeNull();
    expect(host.querySelector('button[role="switch"][aria-label="Search and reference past chats"]')).not.toBeNull();
    expect(content().textContent).toContain("Nothing remembered yet.");
  });

  it("memory says it is paused when it is off", async () => {
    workspace.value = { ...(workspace.value as object), preferences: { ...preferences, memoryEnabled: false } };
    await open("memory");
    expect(content().textContent).toContain("Memory is paused.");
  });

  it("sign-in & devices has only the controls the server can honour", async () => {
    await open("signin");
    // Sign out and the password form are real; 2-step and the device list are named, not drawn.
    expect(texts(".st-content button")).toEqual(["Sign out", "Change password"]);
    expect(content().textContent).toContain("2-step verification");
    expect(content().textContent).toContain("Signed-in devices");
    expect(texts(".st-notyet")).toEqual(["Not available yet", "Not available yet"]);
  });

  it("no section draws a control for a feature with no backend", async () => {
    const unbuilt = [
      /log out everywhere/i,
      /turn on/i,
      /ask admin/i,
      /delete all chats/i,
    ];
    for (const { id } of SETTINGS_SECTIONS) {
      await open(id);
      const labels = [...content().querySelectorAll("button, a, [role=switch]")].map(
        (el) => `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`.trim(),
      );
      for (const pattern of unbuilt)
        expect(labels.filter((l) => pattern.test(l)), `${id}: ${pattern}`).toEqual([]);
    }
  });

  it("data & privacy keeps export, shared links and account deletion", async () => {
    await open("data");
    const labels = texts(".st-content button, .st-content a");
    expect(labels).toEqual(expect.arrayContaining(["Export data", "Export CSV", "Delete account"]));
    expect(content().textContent).toContain("Shared links");
  });

  it("usage shows rupees first and says 'not priced' rather than zero", async () => {
    const totals = (costUsd: number | null, costInr: number | null) => ({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd,
      costInr,
      requests: 1,
    });
    const limits = {
      maxOutputTokens: 4096,
      dailyTokenBudget: null,
      monthlyTokenBudget: null,
      warnThresholdPct: 80,
      timezone: "Asia/Kolkata",
      dailyUsed: 15,
      monthlyUsed: 15,
      dailyPct: null,
      monthlyPct: null,
      warnings: [],
      dailyResetsAt: new Date().toISOString(),
      monthlyResetsAt: new Date().toISOString(),
      version: 1,
    };
    vi.spyOn(api.usage, "summary").mockResolvedValue({
      today: totals(0.14, 12.32),
      month: totals(0.14, 12.32),
      allTime: totals(null, null),
      byModel: [],
      byProject: [],
      limits,
      pricingConfigured: true,
    } as never);
    vi.spyOn(api.usage, "limits").mockResolvedValue(limits as never);
    await open("usage");
    const text = content().textContent ?? "";
    expect(text).toContain("₹12.32 · $0.1400");
    expect(text.indexOf("₹12.32")).toBeLessThan(text.indexOf("$0.1400"));
    // All time has no verified price: it is "—", never ₹0.00.
    expect(text).toContain("—");
    expect(text).not.toContain("₹0.00");
    // Auto is rules only (Stage 7 RT-1, ADR-0076): there is no routing preference to set.
    expect(text).not.toContain("Routing preference");
    expect(content().querySelector("select option[value='economy']")).toBeNull();
  });
});
