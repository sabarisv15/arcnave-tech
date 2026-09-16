import { describe, expect, it } from "vitest";
import { generate, responseFor } from "./adapter";
import { coolingAnswer, sources } from "./fixtures";
import { validateFile } from "./storage";
import type { AdapterEvent } from "./adapter";
const request = {
  prompt: "How can cities stay cooler?",
  mode: "research" as const,
  model: "Quick",
  scope: "All sources",
};
describe("evidence integrity", () => {
  it("has a source record for every citation in the example", () => {
    const ids = [...coolingAnswer.matchAll(/\]\(#source-(\d+)\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(sources.some((s) => s.id === id)).toBe(true);
  });
  it("never attaches unrelated references to an unknown research question", () => {
    const result = responseFor({
      ...request,
      prompt: "What happened to my parcel?",
    });
    expect(result.refs).toEqual([]);
    expect(result.text).toContain("has not searched the web");
    expect(result.text).not.toMatch(/\]\(#source-/);
  });
  it("respects source scope without reusing unsupported citations", () => {
    const result = responseFor({ ...request, scope: "Academic" });
    expect(result.refs).toHaveLength(1);
    expect(result.refs.every((s) => s.type === "Academic")).toBe(true);
    expect(result.text).not.toMatch(/\]\(#source-/);
  });
  it("changes follow-up questions for a new topic", () => {
    expect(
      responseFor({ ...request, prompt: "How does a compass work?" })
        .questions[0],
    ).toContain("compass");
  });
});
describe("event contract and cancellation", () => {
  it("never yields after an already-aborted request", async () => {
    const ac = new AbortController();
    ac.abort();
    const stream = generate(request, ac.signal);
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
  });
  it("ends with an explicit error rather than a success event", async () => {
    const result: AdapterEvent[] = [];
    for await (const event of generate(
      { ...request, fault: "rate-limit" },
      new AbortController().signal,
    ))
      result.push(event);
    expect(result).toEqual([{ type: "error", code: "rate-limit" }]);
  });
  it("cancels while preparing a response", async () => {
    const ac = new AbortController();
    const stream = generate(request, ac.signal);
    const next = stream.next();
    ac.abort();
    await expect(next).rejects.toMatchObject({ name: "AbortError" });
  });
  it("emits the exact prepared answer without losing whitespace", async () => {
    let text = "";
    let completed = false;
    for await (const event of generate(
      { ...request, mode: "search" },
      new AbortController().signal,
    )) {
      if (event.type === "delta") text += event.text;
      if (event.type === "done") completed = true;
    }
    expect(text).toBe(coolingAnswer);
    expect(completed).toBe(true);
  }, 10000);
});
describe("file boundary", () => {
  it("rejects unsupported executable uploads", () => {
    expect(validateFile({ name: "unsafe.exe", size: 100 })).toContain(
      "not supported",
    );
  });
  it("rejects files over the declared limit", () => {
    expect(
      validateFile({ name: "large.pdf", size: 21 * 1024 * 1024 }),
    ).toContain("20 MB");
  });
  it("accepts supported formats case-insensitively", () => {
    expect(validateFile({ name: "NOTES.TXT", size: 50 })).toBeNull();
    expect(validateFile({ name: "photo.webp", size: 2048 })).toBeNull();
  });
});
