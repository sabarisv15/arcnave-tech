// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PublicSite from "./Landing";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("scrollTo", vi.fn());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function show(route = "/") { act(() => root.render(<MemoryRouter initialEntries={[route]}><PublicSite /></MemoryRouter>)); }

it("exposes product content and real authentication entries without a session", () => {
  show();
  expect(host.querySelector("main h1")?.textContent).toContain("Campus work,");
  expect(host.querySelector('a[href="/signup"]')).not.toBeNull();
  expect(host.querySelector('a[href="/login"]')).not.toBeNull();
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("Illustrative example · sample content");
  expect(host.textContent).toContain("recurring college or institution subscription");
  expect(host.textContent).toContain("Pricing has not been set");
  expect(host.textContent).toContain("planned areas, not features available today");
});

it("switches the example workflow and its output together", () => {
  show();
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  act(() => tabs[1].click());
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(tabs[0].getAttribute("aria-selected")).toBe("false");
  expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain("Program evidence summary");
  expect(host.querySelector('[role="tabpanel"]')?.textContent).not.toContain("Institutional evidence register");
});

it("uses confirmed company facts on the public about page", () => {
  show("/about/");
  expect(host.textContent).toContain("Bootstrapped");
  expect(host.textContent).toContain("Coimbatore, Tamil Nadu, India");
  expect(host.textContent).toContain("end of 2026");
  expect(host.textContent).toContain("15 September 2025");
  expect(host.textContent).toContain("venture funding within the next 12 months");
  expect(host.querySelector('a[href="mailto:admin@arcnave.tech"]')).not.toBeNull();
});

it("opens mobile navigation with an accessible expanded state", () => {
  show();
  const button = host.querySelector<HTMLButtonElement>('.site-menu-toggle')!;
  act(() => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector("nav")?.classList.contains("is-open")).toBe(true);
});
