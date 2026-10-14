// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  unauthorized: null as null | (() => void),
  user: { id: "u1", email: "priya@psgtech.ac.in", name: "Priya S" },
  created: false,
}));
vi.mock("../api", () => ({
  onUnauthorized: (handler: (() => void) | null) => {
    hoisted.unauthorized = handler;
  },
  api: {
    auth: {
      probe: vi.fn(async () => ({ user: null })),
      login: vi.fn(async () => ({ user: hoisted.user })),
      register: vi.fn(async () => ({ user: hoisted.user })),
      google: vi.fn(async () => ({
        user: hoisted.user,
        created: hoisted.created,
      })),
      logout: vi.fn(async () => undefined),
    },
    models: { list: vi.fn(async () => ({})) },
  },
}));

import { SessionProvider, useSession } from "../session";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useSession>;
function Probe() {
  current = useSession();
  return null;
}
beforeEach(async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  hoisted.created = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("how the session explains why someone is signed out", () => {
  it("a 401 under a signed-in person is 'expired', and remembers who it was", async () => {
    await act(async () => current.signIn("priya@psgtech.ac.in", "pw"));
    expect(current.user?.id).toBe("u1");
    act(() => hoisted.unauthorized?.());
    expect(current.user).toBeNull();
    expect(current.expired).toBe(true);
    expect(current.signedOut).toBe(false);
    expect(current.lastAccount).toEqual({
      name: "Priya S",
      email: "priya@psgtech.ac.in",
    });
  });

  it("a deliberate sign-out is 'signed out', and the 401s it causes do not turn it into 'expired'", async () => {
    await act(async () => current.signIn("priya@psgtech.ac.in", "pw"));
    await act(async () => current.signOut());
    // Requests already in flight come back 401 after the cookie is cleared (mistakes.md, 2026-09-17).
    act(() => hoisted.unauthorized?.());
    act(() => hoisted.unauthorized?.());
    expect(current.user).toBeNull();
    expect(current.signedOut).toBe(true);
    expect(current.expired).toBe(false);
    expect(current.lastAccount?.email).toBe("priya@psgtech.ac.in");
  });

  it("signing in again clears both notices; 'use another account' forgets the account", async () => {
    await act(async () => current.signIn("priya@psgtech.ac.in", "pw"));
    await act(async () => current.signOut());
    act(() => current.forgetAccount());
    expect(current.signedOut).toBe(false);
    expect(current.lastAccount).toBeNull();
    await act(async () => current.signIn("priya@psgtech.ac.in", "pw"));
    expect(current.expired).toBe(false);
    expect(current.signedOut).toBe(false);
  });
});

describe("which sign-ins count as a new account (the welcome)", () => {
  it("sign-up creates an account", async () => {
    await act(async () =>
      current.signUp("priya@psgtech.ac.in", "a-long-enough-pw", "Priya S"),
    );
    expect(current.freshAccountId).toBe("u1");
    act(() => current.dismissWelcome());
    expect(current.freshAccountId).toBeNull();
  });

  it("a Google sign-in counts only when the server says it created the account", async () => {
    hoisted.created = false;
    await act(async () => current.signInWithGoogle("token"));
    expect(current.freshAccountId).toBeNull();
    await act(async () => current.signOut());
    hoisted.created = true;
    await act(async () => current.signInWithGoogle("token"));
    expect(current.freshAccountId).toBe("u1");
  });

  it("a plain sign-in is never a new account", async () => {
    await act(async () => current.signIn("priya@psgtech.ac.in", "pw"));
    expect(current.freshAccountId).toBeNull();
  });
});
