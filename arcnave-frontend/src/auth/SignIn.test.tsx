// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signInWithGoogle: vi.fn(),
  expired: false,
  signedOut: false,
  lastAccount: null as null | { name: string; email: string },
  forgetAccount: vi.fn(),
}));
vi.mock("../session", () => ({ useSession: () => session }));

import { ApiError } from "../api";
import Auth from "../Auth";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // jsdom has no canvas; the brand components draw nothing and say so on the console otherwise.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  session.expired = false;
  session.signedOut = false;
  session.lastAccount = null;
  session.signIn.mockReset();
  session.signUp.mockReset();
  session.signInWithGoogle.mockReset();
  session.forgetAccount.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete window.google;
});

function show(mode: "in" | "up" = "in") {
  act(() =>
    root.render(
      <MemoryRouter>
        <Auth initialMode={mode} />
      </MemoryRouter>,
    ),
  );
}
const text = () => host.textContent ?? "";

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("SI4 sign-in page", () => {
  it("is two panels: the card on the left and the brand loop on the right", () => {
    show();
    expect(host.querySelector("h1")?.textContent).toBe(
      "One place for your campus",
    );
    expect(
      host.querySelector('[data-testid="sx-panel"] canvas'),
    ).not.toBeNull();
    expect(host.querySelector('a[href="/"]')).not.toBeNull();
  });

  it("keeps the panel when the person asked for reduced motion (it draws the still frame)", () => {
    document.documentElement.dataset["motion"] = "reduced";
    try {
      show();
      expect(
        host.querySelector('[data-testid="sx-panel"] canvas'),
      ).not.toBeNull();
    } finally {
      delete document.documentElement.dataset["motion"];
    }
  });

  it("renders no Google button (and no OR rule) without VITE_GOOGLE_OAUTH_CLIENT_ID", () => {
    vi.stubEnv("VITE_GOOGLE_OAUTH_CLIENT_ID", "");
    show();
    expect(host.querySelector('[data-testid="google-signin"]')).toBeNull();
    expect(text()).not.toContain("OR");
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
  });

  it("renders the Google button above the OR rule when a client id is set", () => {
    vi.stubEnv("VITE_GOOGLE_OAUTH_CLIENT_ID", "id.apps.googleusercontent.com");
    window.google = {
      accounts: { id: { initialize: () => {}, renderButton: () => {} } },
    };
    show();
    const google = host.querySelector('[data-testid="google-signin"]');
    expect(google).not.toBeNull();
    expect(google?.textContent).toContain("Continue with Google");
    const or = [...host.querySelectorAll(".sx-or")];
    expect(or).toHaveLength(1);
    // Google first, then the OR rule, then the e-mail form.
    expect(
      google!.compareDocumentPosition(or[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      or[0]!.compareDocumentPosition(host.querySelector("form")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("signs in with the same fields as before", async () => {
    session.signIn.mockResolvedValue(undefined);
    show();
    type(host.querySelector('input[type="email"]')!, "  priya@example.com ");
    type(
      host.querySelector('input[autocomplete="current-password"]')!,
      "secret-pass",
    );
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(session.signIn).toHaveBeenCalledWith(
      "priya@example.com",
      "secret-pass",
    );
  });

  it("shows the server's words, and the early-access address for registration_closed, by code", async () => {
    session.signUp.mockRejectedValue(
      new ApiError({
        code: "registration_closed",
        title: "Registration is closed",
        detail: "No new accounts.",
      }),
    );
    show("up");
    type(host.querySelector('input[type="email"]')!, "new@example.com");
    type(
      host.querySelector('input[autocomplete="new-password"]')!,
      "a-long-enough-password",
    );
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Registration is closed");
    expect(
      alert?.querySelector('a[href="mailto:admin@arcnave.in"]'),
    ).not.toBeNull();
  });

  it("does not show registration_closed help for another code, whatever the prose says", async () => {
    session.signUp.mockRejectedValue(
      new ApiError({
        code: "email_taken",
        title: "Registration is closed",
        detail: "early access",
      }),
    );
    show("up");
    type(host.querySelector('input[type="email"]')!, "new@example.com");
    type(
      host.querySelector('input[autocomplete="new-password"]')!,
      "a-long-enough-password",
    );
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Registration is closed");
    expect(alert?.querySelector("a")).toBeNull();
  });
});

describe("session ended and signed out (S7)", () => {
  it("an expired session shows the quiet 'Please sign in again' block and the account that was signed in", () => {
    session.expired = true;
    session.lastAccount = { name: "Priya S", email: "priya@psgtech.ac.in" };
    show();
    const notice = host.querySelector('[role="status"]');
    expect(notice?.textContent).toContain("Please sign in again");
    expect(notice?.textContent).toContain(
      "Your session has ended. Sign in again.",
    );
    expect(
      host.querySelector('[data-testid="sx-account"]')?.textContent,
    ).toContain("p••••@psgtech.ac.in");
    expect(host.querySelector('input[type="email"]')).toHaveProperty(
      "value",
      "priya@psgtech.ac.in",
    );
    expect(host.querySelector("h1")?.textContent).toBe(
      "One place for your campus",
    );
    // The server cannot say why, so no specific reason is claimed.
    expect(text()).not.toContain("a day without use");
    expect(text()).not.toContain("28 days");
  });

  it("a deliberate sign-out shows the signed-out page, never the expired message", () => {
    session.signedOut = true;
    session.lastAccount = { name: "Priya S", email: "priya@psgtech.ac.in" };
    show();
    expect(host.querySelector("h1")?.textContent).toBe("You’re signed out");
    expect(text()).toContain("See you soon, Priya.");
    expect(text()).toContain("Your chats are safe in your account.");
    expect(text()).toContain(
      "On a shared computer? Close this browser window too.",
    );
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(text()).not.toContain("session has ended");
    expect(text()).not.toContain("Please sign in again");
  });

  it("'Use another account' forgets the account and clears the e-mail", () => {
    session.signedOut = true;
    session.lastAccount = { name: "Priya S", email: "priya@psgtech.ac.in" };
    show();
    const another = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Use another account",
    )!;
    act(() => another.click());
    expect(session.forgetAccount).toHaveBeenCalledTimes(1);
    expect(host.querySelector('input[type="email"]')).toHaveProperty(
      "value",
      "",
    );
  });

  it("neither notice shows on the sign-up form", () => {
    session.signedOut = true;
    session.lastAccount = { name: "Priya S", email: "priya@psgtech.ac.in" };
    show("up");
    expect(host.querySelector("h1")?.textContent).toBe(
      "One place for your campus",
    );
    expect(host.querySelector('[data-testid="sx-account"]')).toBeNull();
  });
});

describe("layout rules in auth.css", () => {
  const css = readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), "auth.css"),
    "utf8",
  );

  it("collapses to one column on phones", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 899px)"));
    expect(phone).toMatch(
      /\.sx-main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it("never scrolls the desktop auth column (mistakes.md, 2026-09-20)", () => {
    // Only the auth page's own boxes: the welcome dialog is a modal and may scroll on a tiny screen.
    for (const selector of [".sx", ".sx-main", ".sx-col", ".sx-card"]) {
      const rule = css.match(
        new RegExp(`(?:^|\\n)\\${selector}\\s*\\{([^}]*)\\}`),
      );
      expect(rule, selector).not.toBeNull();
      expect(rule![1], selector).not.toMatch(/overflow/);
    }
  });
});
