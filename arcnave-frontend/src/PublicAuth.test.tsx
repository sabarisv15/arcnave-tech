// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ loading: false, user: null as null | { id: string }, expired: false, signIn: vi.fn(), signUp: vi.fn() }));
vi.mock("./session", () => ({ SessionProvider: ({ children }: { children: unknown }) => children, useSession: () => session }));
vi.mock("./workspace", () => ({ WorkspaceProvider: () => <div>Existing authenticated workspace</div>, useWorkspace: vi.fn() }));
import App from "./App";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  session.user = null; session.loading = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function show(route: string) { act(() => root.render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)); }

it("opens direct signup links in signup mode", () => {
  show("/signup");
  expect(host.querySelector('input[autocomplete="new-password"]')).not.toBeNull();
  expect(host.querySelector('input[autocomplete="name"]')).not.toBeNull();
  expect(host.querySelector('a[href="/"]')).not.toBeNull();
});
it("opens direct login links in login mode", () => {
  show("/login");
  expect(host.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
  expect(host.querySelector('input[autocomplete="name"]')).toBeNull();
});
it("lets authenticated users enter the existing workspace from an auth link", () => {
  session.user = { id: "existing-user" };
  show("/login");
  expect(host.textContent).toContain("Existing authenticated workspace");
  expect(host.querySelector("form")).toBeNull();
});
