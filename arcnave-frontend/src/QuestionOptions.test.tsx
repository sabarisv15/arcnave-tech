import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import QuestionOptions, {
  extractAskUserOptions,
  formatMultiSelection,
  formatRankSelection,
  reorderOptions,
} from "./QuestionOptions";
import ToolActivity from "./ToolActivity";
import type { AskUserOptionsInput, Message } from "./types";

const makeAssistantMessage = (
  toolCalls?: Message["toolCalls"],
  role: Message["role"] = "assistant",
): Message => ({
  id: "msg-1",
  seq: 1,
  role,
  text: "",
  mode: "chat",
  status: "complete",
  toolCalls,
});

describe("extractAskUserOptions", () => {
  it("extracts valid ask_user_options payload from an assistant message", () => {
    const msg = makeAssistantMessage([
      {
        toolCallId: "tc-1",
        name: "ask_user_options",
        ok: true,
        input: {
          question: "Which framework should we use?",
          kind: "single",
          options: [
            { label: "React", description: "Component-based UI" },
            { label: "Svelte", description: "Compiler-first UI" },
          ],
        },
      },
    ]);

    expect(extractAskUserOptions(msg)).toEqual({
      question: "Which framework should we use?",
      kind: "single",
      options: [
        { label: "React", description: "Component-based UI" },
        { label: "Svelte", description: "Compiler-first UI" },
      ],
    });
  });

  it("returns null when the latest message is a user message (dismissed after user replies)", () => {
    const userMsg = makeAssistantMessage(undefined, "user");
    expect(extractAskUserOptions(userMsg)).toBeNull();
  });

  it("returns null when ask_user_options failed validation or has out-of-range options", () => {
    const failedCall = makeAssistantMessage([
      {
        toolCallId: "tc-fail",
        name: "ask_user_options",
        ok: false,
        input: {
          question: "Pick one",
          kind: "single",
          options: [{ label: "A" }, { label: "B" }],
        },
      },
    ]);
    expect(extractAskUserOptions(failedCall)).toBeNull();

    const tooFew = makeAssistantMessage([
      {
        toolCallId: "tc-few",
        name: "ask_user_options",
        ok: true,
        input: {
          question: "Pick one",
          kind: "single",
          options: [{ label: "Only one" }],
        },
      },
    ]);
    expect(extractAskUserOptions(tooFew)).toBeNull();
  });
});

describe("QuestionOptions rendering and selection formatting", () => {
  it("renders question text above options in single mode without a Send button", () => {
    const data: AskUserOptionsInput = {
      question: "How would you like the report formatted?",
      kind: "single",
      options: [
        { label: "Executive summary", description: "1-page overview" },
        { label: "Detailed breakdown", description: "Full tables and appendix" },
      ],
    };
    const html = renderToStaticMarkup(
      <QuestionOptions data={data} onSubmit={() => {}} />,
    );
    expect(html).toContain("How would you like the report formatted?");
    expect(html).toContain("Executive summary");
    expect(html).toContain("1-page overview");
    expect(html).toContain("Detailed breakdown");
    expect(html).not.toContain(">Send<");
  });

  it("renders checkboxes and a disabled Send button in multi mode, and formats selected labels", () => {
    const data: AskUserOptionsInput = {
      question: "Which features do you need?",
      kind: "multi",
      options: [
        { label: "Authentication" },
        { label: "Database" },
        { label: "File uploads" },
      ],
    };
    const html = renderToStaticMarkup(
      <QuestionOptions data={data} onSubmit={() => {}} />,
    );
    expect(html).toContain("Which features do you need?");
    expect(html).toContain("Select all that apply");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain(">Send<");

    expect(formatMultiSelection(data.options, new Set([0, 2]))).toBe(
      "Authentication, File uploads",
    );
  });

  it("renders numbered items and reorder controls in rank mode, and formats reordered items", () => {
    const data: AskUserOptionsInput = {
      question: "Rank your priorities:",
      kind: "rank",
      options: [
        { label: "Latency" },
        { label: "Cost" },
        { label: "Accuracy" },
      ],
    };
    const html = renderToStaticMarkup(
      <QuestionOptions data={data} onSubmit={() => {}} />,
    );
    expect(html).toContain("Rank your priorities:");
    expect(html).toContain("Order by preference");
    expect(html).toContain('aria-label="Move Accuracy up"');
    expect(html).toContain(">Send<");

    const reordered = reorderOptions(data.options, 2, 0);
    expect(formatRankSelection(reordered)).toBe(
      "1. Accuracy\n2. Latency\n3. Cost",
    );
  });
});

describe("ToolActivity hides ask_user_options", () => {
  it("renders nothing when ask_user_options is the only tool call", () => {
    const html = renderToStaticMarkup(
      <ToolActivity
        calls={[
          {
            toolCallId: "tc-ask",
            name: "ask_user_options",
            input: { question: "Pick one" },
            ok: true,
          },
        ]}
        working={false}
        answering={false}
      />,
    );
    expect(html).toBe("");
  });
});
