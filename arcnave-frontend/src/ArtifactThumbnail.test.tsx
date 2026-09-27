// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Artifact } from "./types";

const read = vi.fn();
vi.mock("./api", () => ({ api: { artifacts: { read: (...args: unknown[]) => read(...args) } } }));

const { ArtifactThumbnail, excerpt } = await import("./ArtifactThumbnail");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  read.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const artifact = (over: Partial<Artifact>) =>
  ({ id: "a1", title: "T", kind: "document", currentVersion: 1, ...over }) as Artifact;

async function show(a: Artifact) {
  await act(async () => root.render(<ArtifactThumbnail artifact={a} fallback={<p>placeholder</p>} />));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe("artifact thumbnails", () => {
  it("draws a webpage in the sandbox, as a picture no one can click or tab into", async () => {
    read.mockResolvedValue({ content: "<button>Go</button>" });
    await show(artifact({ id: "w1", kind: "webpage" }));
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain('data-layout="page"');
    const thumb = host.querySelector(".artifact-thumb")!;
    expect(thumb.hasAttribute("inert")).toBe(true);
    expect(thumb.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("button")).toBeNull();
  });

  it("shows a document's opening as rendered text", async () => {
    read.mockResolvedValue({ content: "# Plan\n\nFirst **step**" });
    await show(artifact({ id: "d1", kind: "document" }));
    expect(host.querySelector("h1")?.textContent).toBe("Plan");
    expect(host.querySelector("strong")?.textContent).toBe("step");
  });

  it("keeps the placeholder when the content cannot be read", async () => {
    read.mockRejectedValue(new Error("offline"));
    await show(artifact({ id: "c1", kind: "code" }));
    expect(host.textContent).toBe("placeholder");
    expect(host.querySelector(".artifact-thumb")!.hasAttribute("inert")).toBe(false);
  });

  it("reads each version once", async () => {
    read.mockResolvedValue({ content: "x = 1" });
    await show(artifact({ id: "c2", kind: "code" }));
    await act(async () => root.render(<div />));
    await show(artifact({ id: "c2", kind: "code" }));
    expect(read).toHaveBeenCalledTimes(1);
    await show(artifact({ id: "c2", kind: "code", currentVersion: 2 }));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("cuts to whole lines", () => {
    expect(excerpt("a\nb\nc", 2)).toBe("a\nb");
  });
});
