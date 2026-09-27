import { describe, expect, it } from "vitest";
import {
  deriveFollowUpSuggestion,
  describeEffortControl,
  PASTE_AS_FILE_CHARS,
  pastedTextFile,
} from "./Composer";
import type { ModelsDto } from "./api";
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
  it("uses a separate confirmed composer proposal, rather than copying Keep exploring", () => {
    const assistant = message("assistant", "A detailed answer.");
    assistant.questions = ["Would you like a rollout plan?"];
    assistant.toolCalls = [{ toolCallId: "next", name: "suggest_next_actions", ok: true, input: { actions: assistant.questions, composer: "Create a staged rollout checklist." } }];
    expect(deriveFollowUpSuggestion([assistant])).toBe(
      "Create a staged rollout checklist.",
    );
  });

  it("does not put a question addressed to the user in the composer", () => {
    expect(
      deriveFollowUpSuggestion([
        message("user", "Help me choose"),
        message(
          "assistant",
          "Option A is safer for this case. Would you like a side-by-side migration plan?",
        ),
      ]),
    ).toBe("");
  });

  it("does not turn the chat title into a fabricated follow-up", () => {
    expect(
      deriveFollowUpSuggestion([
        message("user", "What is your name?"),
        message("assistant", "I am ArcNave."),
      ]),
    ).toBe("");
  });

  it("does not fabricate a next action from a keyword", () => {
    expect(
      deriveFollowUpSuggestion([
        message("user", "How should I deploy this app?"),
        message("assistant", "Use a guarded build from the main branch."),
      ]),
    ).toBe("");
  });
});

describe("pastedTextFile", () => {
  it("keeps a short paste as message text", () => {
    expect(pastedTextFile("x".repeat(PASTE_AS_FILE_CHARS))).toBeNull();
  });

  it("turns a long paste into a text file with every character", async () => {
    const text = "line\n".repeat(PASTE_AS_FILE_CHARS);
    const file = pastedTextFile(text)!;
    expect(file.name).toBe("pasted-text.txt");
    expect(file.type).toBe("text/plain");
    expect(await file.text()).toBe(text);
  });
});

describe("describeEffortControl", () => {
  const modelsFixture: ModelsDto = {
    auto: {
      alias: "Auto",
      description: "Picks the right model",
      available: true,
      detail: "OK",
      reasoningEfforts: ["low", "medium", "high"],
    },
    models: [
      {
        alias: "Gemini 3.8 Flash",
        description: "Fastest for quick answers",
        provider: "google",
        tier: "economy",
        available: true,
        reason: "ok",
        detail: "OK",
        supportsGrounding: true,
        contextWindow: 1_000_000,
        providerModelId: "gemini-3.8-flash",
        reasoningEfforts: ["low", "medium", "high"],
      },
      {
        alias: "Sonnet 5",
        description: "Efficient for everyday tasks",
        provider: "anthropic",
        tier: "balanced",
        available: true,
        reason: "ok",
        detail: "OK",
        supportsGrounding: true,
        contextWindow: 1_000_000,
        providerModelId: "claude-sonnet-5",
        reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        alias: "GPT-OSS 120B",
        description: "Open-weight reasoning and coding",
        provider: "openai-oss",
        tier: "balanced",
        available: true,
        reason: "ok",
        detail: "OK",
        supportsGrounding: false,
        contextWindow: 128_000,
        providerModelId: "gpt-oss-120b",
        reasoningEfforts: [],
      },
    ],
    capabilities: { groundedSearch: true, detail: "OK" },
  };

  it("hides the effort control when the selected model exposes fewer than 2 levels", () => {
    expect(
      describeEffortControl(modelsFixture, "GPT-OSS 120B", "medium"),
    ).toBeNull();
  });

  it("for Auto when chat model is not known yet, lists only levels every Auto candidate supports (never advertising levels that step down)", () => {
    const state = describeEffortControl(modelsFixture, "Auto", "medium", []);
    expect(state).not.toBeNull();
    expect(state!.supported).toEqual(["low", "medium", "high"]);
    expect(state!.items.map((i) => i.level)).toEqual(["low", "medium", "high"]);
  });

  it("for Auto when chat already has a sticky model, lists that model's supported levels", () => {
    const assistantMsg = message("assistant", "Here is the answer.");
    assistantMsg.modelAlias = "Sonnet 5";
    const state = describeEffortControl(modelsFixture, "Auto", "xhigh", [
      message("user", "Hello"),
      assistantMsg,
    ]);
    expect(state).not.toBeNull();
    expect(state!.supported).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(state!.applied).toBe("xhigh");
    expect(state!.steppedDown).toBe(false);
    expect(state!.buttonLabel).toBe("X-High");
  });

  it("when saved preference is not supported by the selected model, shows the level that will actually apply", () => {
    const state = describeEffortControl(
      modelsFixture,
      "Gemini 3.8 Flash",
      "xhigh",
    );
    expect(state).not.toBeNull();
    expect(state!.steppedDown).toBe(true);
    expect(state!.requested).toBe("xhigh");
    expect(state!.applied).toBe("high");
    expect(state!.buttonLabel).toBe("X-High → High on this model");
    const selectedItem = state!.items.find((i) => i.selected);
    expect(selectedItem?.level).toBe("high");
    expect(selectedItem?.description).toBe("X-High → High on this model");
  });
});

