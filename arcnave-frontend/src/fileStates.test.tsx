// @vitest-environment jsdom
// A chat file after its bytes are sent (Stage 9 PIPE, AS-D6): the chip polls the server's
// reading of it, Send waits for every file to be ready, a failed file offers Retry and Remove,
// and nothing is ever "sent without its text".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AttachmentDto } from "./api";
import { filesBlockSend, pollFile, stageLabel } from "./fileStates";

const send = vi.fn();
vi.mock("./workspace", () => ({
  useWorkspace: () => ({
    preferences: { defaultMode: "chat", modelAlias: "Auto", styleId: "normal", enterToSend: true },
    updatePreferences: vi.fn(),
    send,
    activeRun: null,
    stop: vi.fn(),
    toast: vi.fn(),
    edit: null,
    messages: {},
    quote: null,
    consumeQuote: vi.fn(),
    setPanel: vi.fn(),
  }),
}));
vi.mock("./session", () => ({ useSession: () => ({ models: null }) }));

const dto = (over: Partial<AttachmentDto>): AttachmentDto => ({
  id: "f1",
  messageId: null,
  filename: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 5,
  status: "queued",
  error: "",
  errorCode: "",
  warnings: [],
  parentId: null,
  memberIds: [],
  hasText: false,
  createdAt: null,
  ...over,
});

describe("pollFile", () => {
  it("reports each new stage until the file settles", async () => {
    const seq = [dto({ status: "scanning" }), dto({ status: "extracting" }), dto({ status: "ready", hasText: true })];
    const seen: string[] = [];
    const last = await pollFile("f1", async () => seq.shift()!, (d) => seen.push(d.status), { sleep: async () => undefined });
    expect(seen).toEqual(["scanning", "extracting", "ready"]);
    expect(last?.status).toBe("ready");
  });

  it("keeps polling through a dropped read", async () => {
    let n = 0;
    const last = await pollFile(
      "f1",
      async () => {
        n += 1;
        if (n === 1) throw new Error("offline");
        return dto({ status: "failed", errorCode: "corrupt" });
      },
      () => undefined,
      { sleep: async () => undefined },
    );
    expect(last).toMatchObject({ status: "failed", errorCode: "corrupt" });
  });
});

describe("Send waits for files", () => {
  it("is blocked while a file is being read and when one failed; allowed when all are ready", () => {
    expect(filesBlockSend([{ status: "ready" }, { status: "extracting" }])).toBe("reading");
    expect(filesBlockSend([{ status: "ready" }, { status: "failed" }])).toBe("failed");
    expect(filesBlockSend([{ status: "ready" }])).toBeNull();
  });

  it("names every pipeline stage on the chip", () => {
    for (const status of ["uploading", "queued", "scanning", "extracting", "ocr", "transcribing", "indexing"]) {
      expect(stageLabel({ status })).toBeTruthy();
    }
    expect(stageLabel({ status: "ready" })).toBeNull();
  });
});

/* -------------------------------------------------------------------- the composer itself */

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
  vi.restoreAllMocks();
});

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  }
}

const sendButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!;
const chipText = () => host.querySelector(".attachment-chip small")?.textContent ?? "";

async function renderComposer() {
  const { default: Composer } = await import("./Composer");
  await act(async () => root.render(<Composer chatId="c1" />));
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, "read this");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function attach(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the composer's file chips", () => {
  it("polls a queued file through its stages, holding Send until it is ready", async () => {
    const { api } = await import("./api");
    vi.spyOn(api.files, "upload").mockResolvedValue(dto({ status: "queued" }));
    const reads = [dto({ status: "extracting" }), dto({ status: "ready", hasText: true })];
    vi.spyOn(api.files, "read").mockImplementation(async () => reads.length > 1 ? reads.shift()! : reads[0]!);
    vi.spyOn(api.styles, "list").mockResolvedValue({ presets: [], items: [] } as never);

    await renderComposer();
    await attach(new File(["hello"], "notes.txt", { type: "text/plain" }));
    await waitFor(() => chipText().includes("Waiting to be read") || chipText().includes("Reading"));
    expect(sendButton().disabled).toBe(true);
    await waitFor(() => !sendButton().disabled);
    expect(chipText()).not.toMatch(/Reading|Waiting/);
    // The old note that files with a warning go "without their text" is gone for good.
    expect(host.textContent).not.toContain("sent without their text");
  });

  it("shows Retry and Remove on a failed file, keeps Send blocked, and Retry reads it again", async () => {
    const { api } = await import("./api");
    vi.spyOn(api.files, "upload").mockResolvedValue(dto({ filename: "bad.docx", status: "failed", errorCode: "corrupt", error: "This file could not be opened." }));
    const retry = vi.spyOn(api.files, "retry").mockResolvedValue(dto({ filename: "bad.docx", status: "queued" }));
    vi.spyOn(api.files, "read").mockResolvedValue(dto({ filename: "bad.docx", status: "ready", hasText: true }));
    vi.spyOn(api.styles, "list").mockResolvedValue({ presets: [], items: [] } as never);

    await renderComposer();
    await attach(new File(["x"], "bad.docx"));
    await waitFor(() => chipText().includes("could not be opened"));
    expect(host.querySelector('button[aria-label="Retry bad.docx"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Remove bad.docx"]')).not.toBeNull();
    expect(sendButton().disabled).toBe(true);
    expect(host.textContent).toContain("Retry or remove");

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Retry bad.docx"]')!.click());
    expect(retry).toHaveBeenCalledWith("f1");
    await waitFor(() => !sendButton().disabled);
  });

  it("replaces a ZIP with its member files once it is unpacked", async () => {
    const { api } = await import("./api");
    vi.spyOn(api.files, "upload").mockResolvedValue(dto({ id: "zip", filename: "docs.zip", status: "ready", memberIds: ["m1", "m2"] }));
    vi.spyOn(api.files, "read").mockImplementation(async (id: string) =>
      dto({ id, filename: id === "m1" ? "a.txt" : "b.pdf", status: "ready", parentId: "zip" }),
    );
    vi.spyOn(api.styles, "list").mockResolvedValue({ presets: [], items: [] } as never);

    await renderComposer();
    await attach(new File(["PK"], "docs.zip"));
    await waitFor(() => host.querySelectorAll(".attachment-chip").length === 2);
    const names = [...host.querySelectorAll(".attachment-chip strong")].map((n) => n.textContent);
    expect(names).toEqual(["a.txt", "b.pdf"]);
  });
});
