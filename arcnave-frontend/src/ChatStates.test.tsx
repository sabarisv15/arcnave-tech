// @vitest-environment jsdom
// The states a reply can end in (board S6-Chat-States): chosen from the error `code` and the
// stored `finishReason`, never from prose (Invariant 5).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CutShortNote,
  DroppedNote,
  FailureCard,
  InlineEdit,
  ModelLabel,
  StoppedNote,
  failureView,
} from "./ChatStates";
import { errorCopy } from "./api";

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
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());

describe("the failure card picks its copy by error code", () => {
  const codes = ["provider_limit", "budget_exceeded", "model_refused", "provider_timeout"] as const;

  it.each(codes)("%s shows the words for that code, whatever prose the server sent", (code) => {
    render(
      <FailureCard
        code={code}
        title="SERVER TITLE THAT MUST NOT WIN"
        onRetry={() => undefined}
      />,
    );
    const card = host.querySelector(".cs-failure")!;
    expect(card.getAttribute("data-code")).toBe(code);
    expect(card.textContent).not.toContain("SERVER TITLE");
    expect(card.querySelector("b")!.textContent).toBe(failureView(code).title);
  });

  it("uses the board's words for a model that could not answer and for a refusal", () => {
    expect(failureView("provider_error").title).toBe("arcnave couldn’t answer this time.");
    expect(failureView("model_refused").title).toBe("arcnave can’t help with this one.");
  });

  it("says each of the four things differently", () => {
    const titles = codes.map((c) => failureView(c).title);
    expect(new Set(titles).size).toBe(4);
    expect(failureView("provider_limit").title).toBe(errorCopy["provider_limit"]!.title);
    expect(failureView("provider_timeout").title).toBe(errorCopy["provider_timeout"]!.title);
    expect(failureView("budget_exceeded").title).toBe(errorCopy["budget_exceeded"]!.title);
  });

  it("draws limits as a warning, a refusal as information, and a fault as an error", () => {
    expect(failureView("provider_limit").tone).toBe("warn");
    expect(failureView("budget_exceeded").tone).toBe("warn");
    expect(failureView("rate_limit").tone).toBe("warn");
    expect(failureView("model_refused").tone).toBe("info");
    expect(failureView("provider_timeout").tone).toBe("err");
    expect(failureView("provider_error").tone).toBe("err");
  });

  it("keeps the server's detail, which knows which budget and how much, but not its title", () => {
    const view = failureView("budget_exceeded", {
      title: "Something else",
      detail: "This request would exceed your daily token budget (900 of 1,000 used).",
    });
    expect(view.title).toBe(errorCopy["budget_exceeded"]!.title);
    expect(view.detail).toContain("daily token budget");
  });

  it("falls back to the server's title only for a code it has no words for", () => {
    const unknown = failureView("brand_new_code", { title: "From the server", detail: "More." });
    expect(unknown.title).toBe("From the server");
    expect(failureView("brand_new_code").title).toBe("That did not work");
    expect(failureView(null).title).toBe("That did not work");
  });

  it("offers Retry always and the limits page only for a budget", () => {
    const onRetry = vi.fn();
    const onOpenLimits = vi.fn();
    render(<FailureCard code="budget_exceeded" onRetry={onRetry} onOpenLimits={onOpenLimits} />);
    expect(buttons()).toEqual(["Usage & limits", "Retry"]);
    act(() => host.querySelectorAll("button")[0]!.click());
    act(() => host.querySelectorAll("button")[1]!.click());
    expect(onOpenLimits).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();

    render(<FailureCard code="provider_timeout" onRetry={onRetry} onOpenLimits={onOpenLimits} />);
    expect(buttons()).toEqual(["Retry"]);
  });

  it("disables Retry while another response runs", () => {
    render(<FailureCard code="provider_error" onRetry={() => undefined} retryDisabled />);
    expect(host.querySelector("button")!.disabled).toBe(true);
  });

  it("shows the AI error mark for a fault and a small icon for a limit", () => {
    render(<FailureCard code="provider_timeout" onRetry={() => undefined} />);
    expect(host.querySelector('.ai-mark[data-state="error"]')).not.toBeNull();
    render(<FailureCard code="provider_limit" onRetry={() => undefined} />);
    expect(host.querySelector(".ai-mark")).toBeNull();
    expect(host.querySelector("svg.cs-glyph")).not.toBeNull();
  });
});

describe("a cut-short answer offers Continue", () => {
  it.each([
    ["max_tokens", "output_limit", "It hit the length limit."],
    ["MAX_TOKENS", "output_limit", "It hit the length limit."],
    ["tool_limit", "tool_limit", "It used every tool step this turn allows."],
  ])("%s", (finishReason, reason, words) => {
    const onContinue = vi.fn();
    render(<CutShortNote finishReason={finishReason} onContinue={onContinue} />);
    const note = host.querySelector(".cs-cut")!;
    expect(note.getAttribute("data-reason")).toBe(reason);
    expect(note.textContent).toContain("This answer was cut short.");
    expect(note.textContent).toContain(words);
    expect(buttons()).toEqual(["Continue"]);
    act(() => host.querySelector("button")!.click());
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("shows nothing for an answer that ended normally", () => {
    for (const reason of [undefined, "stop", "STOP", "end_turn"]) {
      render(<CutShortNote finishReason={reason} onContinue={() => undefined} />);
      expect(host.querySelector(".cs-note")).toBeNull();
    }
  });

  it("says a partial answer stopped early after a tool ran, and still offers Continue (ADR-0064)", () => {
    const onContinue = vi.fn();
    render(<CutShortNote finishReason="partial" onContinue={onContinue} />);
    const note = host.querySelector(".cs-cut")!;
    expect(note.getAttribute("data-reason")).toBe("partial");
    expect(note.textContent).toContain(
      "This answer stopped early. The model failed after a tool had already run; the tool was not run again.",
    );
    expect(buttons()).toEqual(["Continue"]);
    act(() => host.querySelector("button")!.click());
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("disables Continue while another response runs", () => {
    render(<CutShortNote finishReason="tool_limit" onContinue={() => undefined} disabled />);
    expect(host.querySelector("button")!.disabled).toBe(true);
  });
});

describe("stopped and dropped answers keep the written part", () => {
  it("a stopped answer offers Continue and Regenerate", () => {
    const onContinue = vi.fn();
    const onRegenerate = vi.fn();
    render(<StoppedNote onContinue={onContinue} onRegenerate={onRegenerate} />);
    expect(host.textContent).toContain("You stopped this answer. The part above is kept.");
    expect(buttons()).toEqual(["Continue", "Regenerate"]);
    act(() => host.querySelectorAll("button")[1]!.click());
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("a dropped connection offers Continue", () => {
    render(<DroppedNote onContinue={() => undefined} />);
    expect(host.textContent).toContain("The connection dropped mid-answer. The part above is kept.");
    expect(buttons()).toEqual(["Continue"]);
  });
});

describe("model label", () => {
  it("names the model and the effort that answered", () => {
    render(<ModelLabel modelAlias="Claude Sonnet 5.5" effort="high" />);
    expect(host.textContent).toBe("Claude Sonnet 5.5 · High");
  });

  it("shows the model alone when no effort was recorded, and nothing when no model was", () => {
    render(<ModelLabel modelAlias="Gemini 3.8 Flash" effort={undefined} />);
    expect(host.textContent).toBe("Gemini 3.8 Flash");
    render(<ModelLabel modelAlias={undefined} effort="low" />);
    expect(host.textContent).toBe("");
  });
});

describe("edit in place", () => {
  it("sends the edited text, and cancels on Escape", () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    render(<InlineEdit initial="Draft the letter" onSend={onSend} onCancel={onCancel} />);
    const field = host.querySelector("textarea")!;
    expect(field.value).toBe("Draft the letter");
    expect(host.textContent).toContain("Sending makes a new version. The old one stays.");
    act(() => host.querySelectorAll("button")[1]!.click());
    expect(onSend).toHaveBeenCalledWith("Draft the letter");
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cannot send an empty message", () => {
    render(<InlineEdit initial="   " onSend={() => undefined} onCancel={() => undefined} />);
    expect(host.querySelectorAll("button")[1]!.disabled).toBe(true);
  });
});
