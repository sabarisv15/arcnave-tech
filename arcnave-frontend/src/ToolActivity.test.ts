import { describe, expect, it } from "vitest";
import { summariseToolCalls, toolStepLabel } from "./ToolActivity";
import type { ToolCall } from "./types";

const call = (name: string, ok?: boolean): ToolCall => ({ toolCallId: name, name, input: {}, ok });

describe("tool activity copy", () => {
  it("summarises a turn as Claude does, each tool once in first-use order", () => {
    const calls = [
      call("load_skill", true),
      ...Array.from({ length: 4 }, () => call("run_python", true)),
      call("generate_deliverable", true),
    ];
    expect(summariseToolCalls(calls)).toBe("Loaded a skill, ran 4 commands, created a file");
  });

  it("merges tools that read the same and never pluralises a mass noun", () => {
    expect(summariseToolCalls([call("load_skill", true), call("read_skill", true)])).toBe("Loaded 2 skills");
    expect(summariseToolCalls([call("web_search", true), call("web_search", true)])).toBe("Searched the web");
  });

  it("names the step by its state", () => {
    expect(toolStepLabel(call("run_python"))).toBe("Running command");
    expect(toolStepLabel(call("run_python", true))).toBe("Ran command");
    expect(toolStepLabel(call("run_python", false))).toBe("Command failed");
  });
});
