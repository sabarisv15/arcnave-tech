import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import QuestionOptions, {
  extractAskUserInput,
  formatAnswers,
  formatMultiSelection,
  formatRankSelection,
  reorderOptions,
} from "./QuestionOptions";
import ToolActivity from "./ToolActivity";
import type { AskUserQuestion, Message } from "./types";

const makeAssistantMessage = (toolCalls?: Message["toolCalls"], role: Message["role"] = "assistant"): Message => ({
  id: "msg-1",
  seq: 1,
  role,
  text: "",
  mode: "chat",
  status: "complete",
  toolCalls,
});

describe("extractAskUserInput", () => {
  it("reads one to three questions, defaulting each to single_select", () => {
    const msg = makeAssistantMessage([
      {
        toolCallId: "tc-1",
        name: "ask_user_input_v0",
        ok: true,
        input: {
          questions: [
            { question: "Goal?", options: ["Strength", "Cardio"] },
            { question: "Kit?", options: ["None", "Dumbbells", "Gym"], type: "multi_select" },
          ],
        },
      },
    ]);
    expect(extractAskUserInput(msg)).toEqual([
      { question: "Goal?", type: "single_select", options: ["Strength", "Cardio"] },
      { question: "Kit?", type: "multi_select", options: ["None", "Dumbbells", "Gym"] },
    ]);
  });

  it("still shows the one question of an older ask_user_options reply", () => {
    const msg = makeAssistantMessage([
      { toolCallId: "tc", name: "ask_user_options", ok: true, input: { question: "Pick", kind: "rank", options: [{ label: "A" }, { label: "B" }] } },
    ]);
    expect(extractAskUserInput(msg)).toEqual([{ question: "Pick", type: "rank_priorities", options: ["A", "B"] }]);
  });

  it("returns null for a user message, a failed call, or questions the card cannot show", () => {
    expect(extractAskUserInput(makeAssistantMessage(undefined, "user"))).toBeNull();
    const call = (input: unknown, ok = true) =>
      extractAskUserInput(makeAssistantMessage([{ toolCallId: "t", name: "ask_user_input_v0", ok, input }]));
    const q = { question: "Q", options: ["a", "b"] };
    expect(call({ questions: [q] }, false)).toBeNull();
    expect(call({ questions: [] })).toBeNull();
    expect(call({ questions: [q, q, q, q] })).toBeNull();
    expect(call({ questions: [{ question: "Q", options: ["a"] }] })).toBeNull();
    expect(call({ questions: [{ question: "Q", options: ["a", "b", "c", "d", "e"] }] })).toBeNull();
    expect(call({ questions: [{ ...q, type: "rank" }] })).toBeNull();
  });
});

describe("QuestionOptions", () => {
  it("shows a single-select question as buttons with no Send, and counts the questions", () => {
    const data: AskUserQuestion[] = [
      { question: "How should the report look?", type: "single_select", options: ["Summary", "Detailed"] },
      { question: "Deadline?", type: "single_select", options: ["Today", "This week"] },
    ];
    const html = renderToStaticMarkup(<QuestionOptions data={data} onSubmit={() => {}} />);
    expect(html).toContain("How should the report look?");
    expect(html).toContain("Summary");
    expect(html).toContain("1 of 2");
    expect(html).not.toContain("Deadline?");
    expect(html).not.toContain(">Send<");
  });

  it("shows checkboxes for multi_select and reorder controls for rank_priorities", () => {
    const multi = renderToStaticMarkup(
      <QuestionOptions data={[{ question: "Features?", type: "multi_select", options: ["Auth", "DB", "Files"] }]} onSubmit={() => {}} />,
    );
    expect(multi).toContain("Select all that apply");
    expect(multi).toContain('type="checkbox"');
    expect(multi).toContain(">Send<");
    const rank = renderToStaticMarkup(
      <QuestionOptions
        data={[
          { question: "Rank:", type: "rank_priorities", options: ["Latency", "Cost", "Accuracy"] },
          { question: "Then?", type: "single_select", options: ["a", "b"] },
        ]}
        onSubmit={() => {}}
      />,
    );
    expect(rank).toContain("Order by preference");
    expect(rank).toContain('aria-label="Move Accuracy up"');
    expect(rank).toContain(">Next<");
  });

  it("formats selections, and puts each answer under its question when there are several", () => {
    expect(formatMultiSelection(["Auth", "DB", "Files"], new Set([0, 2]))).toBe("Auth, Files");
    expect(formatRankSelection(reorderOptions(["Latency", "Cost", "Accuracy"], 2, 0))).toBe("1. Accuracy\n2. Latency\n3. Cost");
    const one: AskUserQuestion[] = [{ question: "Q", type: "single_select", options: ["a", "b"] }];
    expect(formatAnswers(one, ["a"])).toBe("a");
    expect(formatAnswers([...one, { question: "R", type: "single_select", options: ["c", "d"] }], ["a", "d"])).toBe("Q\na\n\nR\nd");
  });
});

describe("ToolActivity hides the question card", () => {
  it("renders nothing when ask_user_input_v0 is the only tool call", () => {
    const html = renderToStaticMarkup(
      <ToolActivity
        calls={[{ toolCallId: "tc-ask", name: "ask_user_input_v0", input: { questions: [] }, ok: true }]}
        working={false}
        answering={false}
      />,
    );
    expect(html).toBe("");
  });
});
