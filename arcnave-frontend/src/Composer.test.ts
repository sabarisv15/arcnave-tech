import { describe, expect, it } from "vitest";
import { deriveFollowUpSuggestion } from "./Composer";
import type { Message } from "./types";

const message = (role: Message["role"], text: string): Message => ({
  id: crypto.randomUUID(),
  seq: 1,
  role,
  text,
  mode: "chat",
  status: "complete",
});

describe("deriveFollowUpSuggestion", () => {
  it("prefers follow-up metadata produced for the latest answer", () => {
    const assistant = message("assistant", "A detailed answer.");
    assistant.questions = ["Would you like a rollout plan?"];
    expect(deriveFollowUpSuggestion([assistant])).toBe(
      "Would you like a rollout plan?",
    );
  });

  it("uses the question the assistant actually ended with", () => {
    expect(
      deriveFollowUpSuggestion([
        message("user", "Help me choose"),
        message(
          "assistant",
          "Option A is safer for this case. Would you like a side-by-side migration plan?",
        ),
      ]),
    ).toBe("Would you like a side-by-side migration plan?");
  });

  it("does not turn the chat title into a fabricated follow-up", () => {
    expect(
      deriveFollowUpSuggestion([
        message("user", "What is your name?"),
        message("assistant", "I am ArcNave."),
      ]),
    ).toBe("What can you help me accomplish?");
  });

  it("maps implementation conversations to a concrete next action", () => {
    expect(
      deriveFollowUpSuggestion([
        message("user", "How should I deploy this app?"),
        message("assistant", "Use a guarded build from the main branch."),
      ]),
    ).toBe("Turn this into the next concrete action.");
  });
});
