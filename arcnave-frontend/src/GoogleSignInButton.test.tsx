// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleSignInButton, googleClientId } from "./GoogleSignInButton";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete window.google;
});

describe("the Google button visibility rule (ADR-0056)", () => {
  it("is off when VITE_GOOGLE_OAUTH_CLIENT_ID is unset or blank", () => {
    expect(googleClientId({})).toBeNull();
    expect(googleClientId({ VITE_GOOGLE_OAUTH_CLIENT_ID: "  " })).toBeNull();
    expect(googleClientId({ VITE_GOOGLE_OAUTH_CLIENT_ID: "id.apps.googleusercontent.com" })).toBe("id.apps.googleusercontent.com");
  });

  it("renders nothing without a client id", () => {
    act(() => root.render(<GoogleSignInButton clientId={null} onCredential={() => {}} />));
    expect(host.querySelector('[data-testid="google-signin"]')).toBeNull();
  });

  it("renders Google's own button over the G1 face and hands its credential on", async () => {
    let callback: ((r: { credential?: string }) => void) | undefined;
    const renderButton = vi.fn();
    window.google = {
      accounts: {
        id: {
          initialize: (options) => {
            callback = options.callback;
          },
          renderButton,
        },
      },
    };
    const onCredential = vi.fn();
    await act(async () => {
      root.render(<GoogleSignInButton clientId="id.apps.googleusercontent.com" onCredential={onCredential} />);
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Continue with Google");
    expect(renderButton).toHaveBeenCalledTimes(1);
    callback?.({ credential: "a.google.jwt" });
    expect(onCredential).toHaveBeenCalledWith("a.google.jwt");
  });
});
