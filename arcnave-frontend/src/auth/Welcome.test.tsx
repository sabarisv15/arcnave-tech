// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; email: string },
  freshAccountId: null as string | null,
  dismissWelcome: vi.fn(),
  setSettings: vi.fn(),
}));
vi.mock("../session", () => ({ useSession: () => state }));
vi.mock("../workspace", () => ({
  useWorkspace: () => ({ setSettings: state.setSettings }),
}));

import { Welcome } from "./Welcome";
import { WelcomeGate } from "./WelcomeGate";
import { hasSeenWelcome } from "./welcomeSeen";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  localStorage.clear();
  state.user = null;
  state.freshAccountId = null;
  state.dismissWelcome.mockReset();
  state.setSettings.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const dialog = () => document.body.querySelector('[role="dialog"]');
const mountGate = () => act(() => root.render(<WelcomeGate />));
const remountGate = () => {
  act(() => root.unmount());
  root = createRoot(host);
  mountGate();
};

describe("Welcome (S4-Welcome)", () => {
  it("greets by first name with the three board tips and two actions", () => {
    act(() =>
      root.render(
        <Welcome name="Priya S" onStart={() => {}} onOpenSettings={() => {}} />,
      ),
    );
    const d = dialog()!;
    expect(d.textContent).toContain("Vanakkam, Priya!");
    for (const tip of [
      "Ask the way you talk",
      "Keep work together",
      "Check what matters",
    ])
      expect(d.textContent).toContain(tip);
    const buttons = [...d.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Settings", "Start chatting"]);
    // No college or role is known yet, so the board's "You've joined ..." line is not drawn.
    expect(d.textContent).not.toContain("You’ve joined");
  });

  it("draws the joined line only when a college and role are given", () => {
    act(() =>
      root.render(
        <Welcome
          name="Priya S"
          joinedAs={{ college: "GPT Coimbatore", role: "Staff" }}
          onStart={() => {}}
          onOpenSettings={() => {}}
        />,
      ),
    );
    expect(dialog()!.textContent).toContain(
      "You’ve joined GPT Coimbatore as Staff.",
    );
  });

  it("drops the name when the account has none", () => {
    act(() =>
      root.render(
        <Welcome name="  " onStart={() => {}} onOpenSettings={() => {}} />,
      ),
    );
    expect(dialog()!.textContent).toContain("Vanakkam!");
  });
});

describe("the welcome is shown once per user", () => {
  it("opens for an account created in this tab, and Start chatting closes it", () => {
    state.user = { id: "u1", name: "Priya S", email: "p@x.in" };
    state.freshAccountId = "u1";
    mountGate();
    expect(dialog()).not.toBeNull();
    expect(hasSeenWelcome("u1")).toBe(true);
    const start = [...dialog()!.querySelectorAll("button")].find(
      (b) => b.textContent === "Start chatting",
    )!;
    act(() => start.click());
    expect(dialog()).toBeNull();
    expect(state.dismissWelcome).toHaveBeenCalledTimes(1);
  });

  it("does not open again for the same user, even if the account is flagged new again", () => {
    state.user = { id: "u1", name: "Priya S", email: "p@x.in" };
    state.freshAccountId = "u1";
    mountGate();
    expect(dialog()).not.toBeNull();
    // e.g. a reload: the in-memory flag is gone from the new page, but even if it came back...
    remountGate();
    expect(dialog()).toBeNull();
  });

  it("opens again for a different user on the same browser", () => {
    state.user = { id: "u1", name: "Priya S", email: "p@x.in" };
    state.freshAccountId = "u1";
    mountGate();
    state.user = { id: "u2", name: "Ravi", email: "r@x.in" };
    state.freshAccountId = "u2";
    remountGate();
    expect(dialog()?.textContent).toContain("Vanakkam, Ravi!");
    expect(hasSeenWelcome("u2")).toBe(true);
  });

  it("does not open for an ordinary sign-in", () => {
    state.user = { id: "u1", name: "Priya S", email: "p@x.in" };
    state.freshAccountId = null;
    mountGate();
    expect(dialog()).toBeNull();
    expect(hasSeenWelcome("u1")).toBe(false);
  });

  it("Settings closes the welcome and opens settings", () => {
    state.user = { id: "u1", name: "Priya S", email: "p@x.in" };
    state.freshAccountId = "u1";
    mountGate();
    const settings = [...dialog()!.querySelectorAll("button")].find(
      (b) => b.textContent === "Settings",
    )!;
    act(() => settings.click());
    expect(state.setSettings).toHaveBeenCalledWith(true);
    expect(dialog()).toBeNull();
  });

  it("still shows once when storage is blocked", () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    state.user = { id: "u1", name: "Priya S", email: "p@x.in" };
    state.freshAccountId = "u1";
    mountGate();
    expect(dialog()).not.toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});
