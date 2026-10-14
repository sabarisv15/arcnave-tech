import { describe, expect, it } from "vitest";
import { aiStateForMessage, aiStateForTool, aiStatusLabel } from "./aiState";
import { answerLang } from "./answerLang";
import { AI_STATES } from "./brand";
import type { Message, ToolCall } from "./types";

const reply = (patch: Partial<Message> = {}): Message => ({
  id: "a1",
  seq: 2,
  role: "assistant",
  text: "",
  mode: "chat",
  status: "generating",
  ...patch,
});
const call = (name: string, ok?: boolean): ToolCall => ({ toolCallId: name, name, input: {}, ok });

describe("aiStateForMessage", () => {
  it("is thinking while the request is sent and before anything arrives", () => {
    expect(aiStateForMessage(reply({ status: "submitting" }))).toBe("thinking");
    expect(aiStateForMessage(reply())).toBe("thinking");
    expect(aiStateForMessage(reply({ segments: [{ type: "thinking", text: "Planning" }], thinking: "Planning" }))).toBe(
      "thinking",
    );
  });

  it("is writing while answer text streams", () => {
    expect(aiStateForMessage(reply({ text: "Done. 58 students" }))).toBe("writing");
    expect(
      aiStateForMessage(
        reply({ text: "Done.", segments: [{ type: "thinking", text: "t" }, { type: "text", text: "Done." }] }),
      ),
    ).toBe("writing");
  });

  it("names the running tool's job", () => {
    expect(aiStateForMessage(reply({ toolCalls: [call("web_search")] }))).toBe("searching");
    expect(aiStateForMessage(reply({ toolCalls: [call("read_uploaded_file")] }))).toBe("reading");
    expect(aiStateForMessage(reply({ toolCalls: [call("run_python")] }))).toBe("running");
    expect(aiStateForMessage(reply({ toolCalls: [call("generate_deliverable")] }))).toBe("creating");
    // a finished tool no longer drives the state; the newest running one does
    expect(aiStateForMessage(reply({ toolCalls: [call("web_search", true), call("bash_tool")] }))).toBe("running");
    // while answer text has started, a running tool still wins
    expect(aiStateForMessage(reply({ text: "Let me check", toolCalls: [call("view")] }))).toBe("reading");
  });

  it("maps every tool family, and unknown tools to running", () => {
    expect(aiStateForTool("image_search")).toBe("searching");
    expect(aiStateForTool("search_project_files")).toBe("searching");
    expect(aiStateForTool("load_skill")).toBe("reading");
    expect(aiStateForTool("create_artifact")).toBe("creating");
    expect(aiStateForTool("render_ui")).toBe("creating");
    expect(aiStateForTool("chart_display_v0")).toBe("creating");
    expect(aiStateForTool("some_new_tool")).toBe("running");
  });

  it("follows the research stages", () => {
    const event = (stage: string) => ({ stage, label: stage, detail: "", at: null });
    expect(aiStateForMessage(reply({ mode: "research", events: [event("planning")] }))).toBe("searching");
    expect(aiStateForMessage(reply({ mode: "research", events: [event("reading")] }))).toBe("reading");
    expect(aiStateForMessage(reply({ mode: "research", events: [event("synthesizing")] }))).toBe("writing");
  });

  it("is creating while a visual is being drawn", () => {
    expect(aiStateForMessage(reply({ visualDrafts: [{ id: "v", title: "Chart", html: "" }] as never }))).toBe(
      "creating",
    );
  });

  it("ends as done, needs-input, error, or nothing when stopped", () => {
    expect(aiStateForMessage(reply({ status: "complete", text: "Done." }))).toBe("done");
    expect(aiStateForMessage(reply({ status: "complete", toolCalls: [call("ask_user_input_v0", true)] }))).toBe(
      "needs-input",
    );
    expect(aiStateForMessage(reply({ status: "complete", toolCalls: [call("ask_user_options", true)] }))).toBe(
      "needs-input",
    );
    expect(aiStateForMessage(reply({ status: "error" }))).toBe("error");
    expect(aiStateForMessage(reply({ status: "stopped" }))).toBeNull();
    expect(aiStateForMessage(reply({ role: "user", status: "complete" }))).toBeNull();
  });

  it("only ever returns one of the nine locked states", () => {
    const seen = new Set<string>();
    for (const m of [
      reply({ status: "submitting" }),
      reply({ text: "x" }),
      reply({ toolCalls: [call("web_search")] }),
      reply({ toolCalls: [call("view")] }),
      reply({ toolCalls: [call("bash_tool")] }),
      reply({ toolCalls: [call("create_file")] }),
      reply({ status: "complete" }),
      reply({ status: "complete", toolCalls: [call("ask_user_options", true)] }),
      reply({ status: "error" }),
    ]) {
      const state = aiStateForMessage(m);
      expect(AI_STATES).toContain(state);
      seen.add(state!);
    }
    expect(seen.size).toBe(AI_STATES.length);
  });
});

describe("aiStatusLabel", () => {
  it("prefers the named step, else the state's name", () => {
    expect(aiStatusLabel("searching", "Searching the web")).toBe("Searching the web…");
    expect(aiStatusLabel("writing")).toBe("Writing…");
    expect(aiStatusLabel("needs-input")).toBe("Waiting for your answer");
  });
});

describe("answerLang", () => {
  it("marks answers written mostly in Tamil script", () => {
    expect(answerLang("அன்புள்ள பெற்றோருக்கு, உங்கள் பிள்ளை EEE மூன்றாம் பருவத்தில்")).toBe("ta");
  });
  it("leaves English and Tanglish unmarked, even with a quoted Tamil word", () => {
    expect(answerLang("Done. 58 students in EEE 3rd sem.")).toBeUndefined();
    expect(answerLang("Parents-ku Tamil-la letter ready pannu")).toBeUndefined();
    expect(answerLang("The word for parents is பெற்றோர், used in the formal letter you asked for today.")).toBeUndefined();
  });
});
