// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact, Chat, Project } from "./types";

// Phase 1 item G4: the project page, projects list, library, share dialog and artifact panel keep
// the structure of the locked boards (BS-Project, BS-PartsA, BS-Artifact): headings, landmarks and
// the controls that exist. Data is mocked; nothing reaches a server.

const session = vi.hoisted(() => ({
  loading: false,
  expired: false,
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
// The composer is G1's and has its own tests; here it only has to be on the project page.
vi.mock("./Composer", () => ({
  default: ({ projectId }: { projectId?: string }) => <div data-testid="composer" data-project={projectId} />,
  AttachmentChip: () => null,
}));
import { ArtifactsPage, ProjectPage, ProjectsPage } from "./Pages";
import ContextPanel, { drawnHere, PREVIEW_FETCH_MAX_BYTES } from "./Panels";
import { PublicLink } from "./ShareLink";
import { api } from "./api";

const now = new Date().toISOString();
const project: Project = {
  id: "p1",
  title: "EEE 3rd sem",
  description: "Internal marks, timetable and circulars.",
  instructions: "Marks are out of 50. Pass mark 20.",
  pinned: false,
  position: 0,
  version: 3,
  updatedAt: now,
  counts: { files: 2, chats: 1, sources: 1, indexedChunks: 14 },
};
const chat = {
  id: "c1",
  familyId: "c1",
  title: "Internal marks summary",
  projectId: "p1",
  pinned: false,
  version: 1,
  updatedAt: now,
} as Chat;
const artifact: Artifact = {
  id: "a1",
  title: "UT2 marks report",
  kind: "document",
  projectId: "p1",
  chatId: "c1",
  currentVersion: 3,
  version: 5,
  updatedAt: now,
};
const slides: Artifact = { ...artifact, id: "a2", title: "Pongal programme", kind: "slides", projectId: null, chatId: null };

function fakeWorkspace(extra: Record<string, unknown> = {}) {
  const fn = () => vi.fn();
  return {
    chats: [chat],
    projects: [project],
    artifacts: [artifact, slides],
    panel: { kind: "closed" },
    toast: fn(),
    setPanel: fn(),
    pinChat: fn(),
    renameChat: fn(),
    moveChat: fn(),
    deleteChat: fn(),
    branch: fn(),
    exportChat: fn(),
    refreshProjects: vi.fn(() => Promise.resolve()),
    refreshChats: vi.fn(() => Promise.resolve()),
    refreshArtifacts: vi.fn(() => Promise.resolve()),
    artifactUpdateEvent: null,
    ...extra,
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  );
  workspace.value = fakeWorkspace();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(api.projects, "read").mockResolvedValue({
    files: [
      {
        id: "f1",
        projectId: "p1",
        filename: "UT2_marks.xlsx",
        mimeType: "application/vnd.ms-excel",
        sizeBytes: 49152,
        status: "ready",
        chunkCount: 9,
      },
      {
        id: "f2",
        projectId: "p1",
        filename: "Syllabus R2021 EEE.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2202009,
        status: "ready",
        chunkCount: 5,
      },
    ],
    sources: [{ id: "s1", title: "AICTE circular", url: "https://example.com/c", domain: "example.com", type: "Web" }],
  } as never);
  vi.spyOn(api.artifacts, "read").mockRejectedValue(new Error("offline"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(route: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="*" element={<ContextPanel />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("projects list (BS-PartsA)", () => {
  it("has the title, a search field, a card per project and the dotted new-project card", async () => {
    await show("/projects");
    expect(text(host.querySelector("h1"))).toBe("Projects");
    expect(host.querySelector('input[aria-label="Find a project"]')).not.toBeNull();
    const card = host.querySelector<HTMLAnchorElement>('a.sf-pcard[href="/project/p1"]')!;
    expect(text(card.querySelector("h2"))).toBe("EEE 3rd sem");
    expect(text(card)).toContain("2 files");
    expect(text(card)).toContain("1 chat");
    expect(card.querySelector(".sf-tile")).not.toBeNull();
    expect(host.querySelector("button.sf-pnew")).not.toBeNull();
    // the header action and the dotted card both start a project
    expect([...host.querySelectorAll("button.sf-pbtn")].map(text)).toContain("New project");
  });

  it("opens the new-project dialog with its fields, and Create stays off until there is a name", async () => {
    await show("/projects");
    await act(async () => host.querySelector<HTMLButtonElement>("button.sf-pbtn")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.classList.contains("sf-dialog")).toBe(true);
    expect(text(dialog.querySelector("h2"))).toBe("New project");
    const labels = [...dialog.querySelectorAll("label")].map(text);
    expect(labels.some((l) => l.startsWith("Name"))).toBe(true);
    expect(labels.some((l) => l.startsWith("What is it for?"))).toBe(true);
    const create = [...dialog.querySelectorAll("button")].find((b) => text(b) === "Create project")!;
    expect(create.disabled).toBe(true);
  });

  it("shows the empty project box with the living logo and a way to start", async () => {
    workspace.value = fakeWorkspace({ projects: [], chats: [] });
    await show("/projects");
    const empty = host.querySelector(".sf-empty")!;
    expect(text(empty.querySelector("h2"))).toBe("Give an idea its own space");
    expect(empty.querySelector(".living-dots")).not.toBeNull();
    expect(text(empty.querySelector("button"))).toBe("Create a project");
    expect(host.querySelector(".sf-pnew")).toBeNull();
  });
});

describe("project page (BS-Project)", () => {
  it("has the breadcrumb, header, composer, chats list and the four side cards", async () => {
    await show("/project/p1");
    expect(text(host.querySelector('nav[aria-label="Breadcrumb"] a'))).toBe("All projects");
    expect(host.querySelector('nav[aria-label="Breadcrumb"] a')!.getAttribute("href")).toBe("/projects");
    expect(text(host.querySelector("h1"))).toBe("EEE 3rd sem");
    expect(host.querySelector('[data-testid="composer"]')!.getAttribute("data-project")).toBe("p1");
    expect(text(host.querySelector("#sf-chats-title"))).toBe("Chats in this project");
    expect(text(host.querySelector(".sf-chats-head .sf-count"))).toBe("1");
    expect(host.querySelector('a[href="/chat/c1"]')).not.toBeNull();
    expect(host.querySelector('[role="group"][aria-label="Sort chats"]')).not.toBeNull();

    const side = host.querySelector('aside[aria-label="Project context"]')!;
    const heads = [...side.querySelectorAll("section > .sf-sidecard-head h2")].map(text);
    expect(heads).toEqual(["Instructions", "Files", "Made here", "Saved sources"]);
    expect(text(side)).toContain("Marks are out of 50. Pass mark 20.");
    // the artifact made in this project is listed under "Made here"
    expect(text(side.querySelector('section[aria-labelledby="sf-made-title"]'))).toContain("UT2 marks report");
  });

  it("lists the project's files with their tiles, and offers add, re-index and remove", async () => {
    await show("/project/p1");
    const files = host.querySelector('section[aria-labelledby="sf-files-title"]')!;
    const rows = files.querySelectorAll(".sf-frow");
    expect(rows.length).toBe(2);
    expect(text(rows[0]!)).toContain("UT2_marks.xlsx");
    expect(text(rows[0]!.querySelector(".sf-tile"))).toBe("XLSX");
    expect(rows[0]!.querySelector(".sf-tile")!.classList.contains("sf-tile-g")).toBe(true);
    expect(rows[1]!.querySelector(".sf-tile")!.classList.contains("sf-tile-t")).toBe(true);
    expect(files.querySelector('button[aria-label="Re-index UT2_marks.xlsx"]')).not.toBeNull();
    expect(files.querySelector('button[aria-label="Remove UT2_marks.xlsx from project"]')).not.toBeNull();
    expect(files.querySelector('input[type="file"][aria-label="Project file upload"]')).not.toBeNull();
    expect([...files.querySelectorAll("button")].map(text)).toContain("Add");
  });

  it("uploads a project file and follows it through its stages until it is ready (ADR-0063)", async () => {
    const base = { projectId: "p1", filename: "scan.pdf", mimeType: "application/pdf", sizeBytes: 9, error: "", chunkCount: 0, checksumSha256: "", indexedAt: null, createdAt: now };
    vi.spyOn(api.projects, "upload").mockResolvedValue({ ...base, id: "f9", status: "queued" });
    const reads = [
      { ...base, id: "f9", status: "ocr" },
      { ...base, id: "f9", status: "ready", chunkCount: 3 },
    ];
    const readFile = vi.spyOn(api.projects, "readFile").mockImplementation(async () => reads.shift() ?? { ...base, id: "f9", status: "ready", chunkCount: 3 });
    await show("/project/p1");
    const input = host.querySelector<HTMLInputElement>('input[type="file"][aria-label="Project file upload"]')!;
    const file = new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1500));
    });
    expect(readFile).toHaveBeenCalledWith("p1", "f9");
    const row = [...host.querySelectorAll(".sf-frow")].find((r) => text(r).includes("scan.pdf"))!;
    expect(text(row)).toContain("3 indexed chunks");
  });

  it("downloads a file for its preview only when it is drawn here and not too large (D1 #33)", () => {
    const f = (name: string, type: string) => ({ id: "x", name, type, size: 1, status: "ready" });
    expect(drawnHere(f("a.pdf", "application/pdf"), false, null)).toBe(true);
    expect(drawnHere(f("a.png", "image/png"), false, null)).toBe(true);
    expect(drawnHere(f("deck.pptx", ""), false, "pptx")).toBe(true);
    expect(drawnHere(f("talk.mp3", "audio/mpeg"), false, null)).toBe(false);
    expect(drawnHere(f("bundle.zip", "application/zip"), false, null)).toBe(false);
    expect(drawnHere(f("sheet.xlsx", ""), false, "xlsx")).toBe(false);
    expect(PREVIEW_FETCH_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it("pins and unpins the project with the star, and leaves out what has no backend", async () => {
    const patch = vi.spyOn(api.projects, "patch").mockResolvedValue({} as never);
    await show("/project/p1");
    const star = host.querySelector<HTMLButtonElement>('button[aria-label="Pin project"]')!;
    expect(star.getAttribute("aria-pressed")).toBe("false");
    await act(async () => star.click());
    expect(patch).toHaveBeenCalledWith("p1", { pinned: true, version: 3 });
    // BS-Project also draws Share, a member list and a storage meter; none exists in the backend
    expect([...host.querySelectorAll("button")].map(text)).not.toContain("Share");
    expect(host.querySelector('[aria-label="18%"]')).toBeNull();
  });

  it("shows the empty-project box when there are no chats", async () => {
    workspace.value = fakeWorkspace({ chats: [] });
    await show("/project/p1");
    const empty = host.querySelector(".sf-empty")!;
    expect(text(empty.querySelector("h3"))).toBe("Nothing here yet");
    expect([...empty.querySelectorAll("button")].map(text)).toEqual(["Add files", "Write instructions"]);
  });
});

describe("library (BS-PartsA)", () => {
  it("has the title, search, the kind filter and a card per artifact", async () => {
    await show("/artifacts");
    expect(text(host.querySelector("h1"))).toBe("Library");
    expect(host.querySelector('input[aria-label="Find an artifact"]')).not.toBeNull();
    const kinds = [...host.querySelectorAll('[role="group"][aria-label="Kind"] button')].map(text);
    expect(kinds).toEqual(["All", "Documents", "Slides", "Code", "Webpages", "SVG"]);
    const cards = host.querySelectorAll("ul.sf-lgrid > li.sf-lcard");
    expect(cards.length).toBe(2);
    expect(text(cards[0]!.querySelector(".sf-lmeta b"))).toBe("UT2 marks report");
    expect(text(cards[0]!.querySelector(".sf-lmeta"))).toContain("Document · version 3");
    expect(text(cards[0]!.querySelector(".sf-lmeta"))).toContain("Project: EEE 3rd sem");
    expect(cards[0]!.querySelector('button[aria-label="Delete artifact UT2 marks report"]')).not.toBeNull();
  });

  it("filters by kind and says so when nothing matches", async () => {
    await show("/artifacts");
    const slidesButton = [...host.querySelectorAll('[role="group"][aria-label="Kind"] button')].find(
      (b) => text(b) === "Slides",
    ) as HTMLButtonElement;
    await act(async () => slidesButton.click());
    expect(slidesButton.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll(".sf-lcard").length).toBe(1);
    const code = [...host.querySelectorAll('[role="group"][aria-label="Kind"] button')].find(
      (b) => text(b) === "Code",
    ) as HTMLButtonElement;
    await act(async () => code.click());
    expect(host.querySelectorAll(".sf-lcard").length).toBe(0);
    expect(host.querySelector(".sf-empty")).not.toBeNull();
  });
});

describe("artifact panel beside the chat (BS-Artifact)", () => {
  beforeEach(() => {
    workspace.value = fakeWorkspace({ panel: { kind: "artifact", id: "a1" } });
    vi.spyOn(api.artifacts, "read").mockResolvedValue({
      id: "a1",
      title: "UT2 marks report",
      kind: "document",
      content: "# UT2 marks report\n\nThe class average rose from 35.2 to 36.4.",
      currentVersion: 3,
      readVersion: 2,
      version: 5,
    } as never);
    vi.spyOn(api.artifacts, "versions").mockResolvedValue({
      currentVersion: 3,
      items: [
        { version: 3, createdAt: now, charCount: 70 },
        { version: 2, createdAt: now, charCount: 60 },
        { version: 1, createdAt: now, charCount: 50 },
      ],
    } as never);
    vi.spyOn(api.share, "list").mockResolvedValue({ items: [] } as never);
  });

  it("has the header, version switch, view switch, download and share, and the page card", async () => {
    await show("/chat/c1");
    const panel = host.querySelector("aside.context-panel")!;
    expect(panel.classList.contains("is-artifact")).toBe(true);
    expect(panel.getAttribute("aria-label")).toBe("UT2 marks report");
    // header: tile, title, kind and when it was saved
    const header = panel.querySelector("header.sf-atool")!;
    expect(header.querySelector(".sf-tile")).not.toBeNull();
    expect(text(header.querySelector("h2"))).toBe("UT2 marks report");
    expect(text(header.querySelector(".sf-atool-title span"))).toMatch(/^Document · saved /);
    expect(header.querySelector('button[aria-label="Close context panel"]')).not.toBeNull();
    // actions row
    const bar = panel.querySelector(".sf-atoolbar")!;
    const versions = bar.querySelector('[role="group"][aria-label="Versions"]')!;
    expect(text(versions)).toBe("2 / 3");
    expect(versions.querySelector('[aria-label="Version 2 of 3"]')).not.toBeNull();
    expect((versions.querySelector('[aria-label="Older version"]') as HTMLButtonElement).disabled).toBe(false);
    expect((versions.querySelector('[aria-label="Newer version"]') as HTMLButtonElement).disabled).toBe(false);
    const view = bar.querySelector('[role="group"][aria-label="Artifact view"]')!;
    expect([...view.querySelectorAll("button")].map(text)).toEqual(["Preview", "Edit"]);
    expect(view.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");
    expect(bar.querySelector('button[aria-label="Download or copy"]')).not.toBeNull();
    expect(text(bar.querySelector("button.sf-pbtn"))).toBe("Share");
    // the page on the soft ground
    expect(panel.querySelector(".sf-apage.doc h1")?.textContent).toBe("UT2 marks report");
    expect(viewingOldNotice(panel)).toContain("Viewing version 2 of 3");
  });

  it("opens the share dialog with the two options the backend supports", async () => {
    await show("/chat/c1");
    await act(async () => host.querySelector<HTMLButtonElement>(".sf-atoolbar .sf-pbtn")!.click());
    const dialog = document.querySelector('[role="dialog"].sf-dialog')!;
    expect(text(dialog.querySelector("h2"))).toBe("Share “UT2 marks report”");
    const radios = [...dialog.querySelectorAll('[role="radiogroup"] [role="radio"]')];
    expect(radios.map((r) => text(r.querySelector("b")))).toEqual(["Anyone with the link", "Only me"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    // no company-only option: the backend has no company links
    expect(text(dialog)).not.toContain("People in");
  });
});

const viewingOldNotice = (panel: Element) => text(panel.querySelector(".edit-notice"));

describe("share link surface", () => {
  it("shows the link, Copy link and Update to now once a link exists, and turns it off from Only me", async () => {
    workspace.value = fakeWorkspace();
    vi.spyOn(api.share, "list").mockResolvedValue({
      items: [{ id: "l1", path: "/s/abc", snapshotAt: now }],
    } as never);
    const revoke = vi.spyOn(api.share, "revoke").mockResolvedValue(undefined as never);
    await act(async () => {
      root.render(<PublicLink target={{ type: "artifact", id: "a1" }} />);
    });
    const radios = [...host.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Public link"]')!.value).toContain("/s/abc");
    expect([...host.querySelectorAll("button")].map(text)).toEqual(
      expect.arrayContaining(["Copy link", "Update to now"]),
    );
    await act(async () => (radios[1] as HTMLButtonElement).click());
    expect(revoke).toHaveBeenCalledWith("l1");
    expect(host.querySelector('input[aria-label="Public link"]')).toBeNull();
  });
});
