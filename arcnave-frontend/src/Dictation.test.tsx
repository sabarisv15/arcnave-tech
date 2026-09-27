// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DictationButton, joinDictated } from "./Dictation";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
const render = (node: React.ReactNode) => act(() => root.render(node));
const button = (name: RegExp | string) =>
  [...host.querySelectorAll("button")].find((b) =>
    typeof name === "string" ? b.getAttribute("aria-label") === name : name.test(b.getAttribute("aria-label") ?? ""),
  )!;
const click = (el: HTMLElement) => act(() => el.click());

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
}

const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal });

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as Record<string, unknown>)["webkitSpeechRecognition"];
  localStorage.clear();
});

describe("joinDictated", () => {
  it("puts one space between typed and spoken text", () => {
    expect(joinDictated("Hello", "world")).toBe("Hello world");
    expect(joinDictated("Hello ", " world ")).toBe("Hello world");
    expect(joinDictated("", "vanakkam")).toBe("vanakkam");
    expect(joinDictated("keep", "  ")).toBe("keep");
  });
});

describe("DictationButton", () => {
  it("is not shown where the browser cannot recognise speech", () => {
    render(<DictationButton text="" setText={() => {}} onError={() => {}} />);
    expect(host.innerHTML).toBe("");
  });

  it("dictates in the saved language, adding to what was typed", () => {
    (window as unknown as Record<string, unknown>)["webkitSpeechRecognition"] = FakeRecognition;
    localStorage.setItem("arcnave-ui:dictation-language", "ta-IN");
    const setText = vi.fn();
    render(<DictationButton text="Draft:" setText={setText} onError={() => {}} />);
    click(button(/^Dictate/));
    const r = FakeRecognition.last!;
    expect(r.lang).toBe("ta-IN");
    expect(r.start).toHaveBeenCalled();

    act(() => r.onresult?.({ resultIndex: 0, results: [result("vanakkam", false)] }));
    expect(setText).toHaveBeenLastCalledWith("Draft: vanakkam");
    act(() => r.onresult?.({ resultIndex: 0, results: [result("vanakkam ellarukkum", true)] }));
    expect(setText).toHaveBeenLastCalledWith("Draft: vanakkam ellarukkum");

    click(button("Stop dictation"));
    expect(r.stop).toHaveBeenCalled();
    expect(button(/^Dictate/)).toBeTruthy();
  });

  it("says why when the microphone is blocked", () => {
    (window as unknown as Record<string, unknown>)["webkitSpeechRecognition"] = FakeRecognition;
    localStorage.setItem("arcnave-ui:dictation-language", "en-IN");
    const onError = vi.fn();
    render(<DictationButton text="" setText={() => {}} onError={onError} />);
    click(button(/^Dictate/));
    act(() => FakeRecognition.last!.onerror?.({ error: "not-allowed" }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Microphone access is blocked"));
  });
});
