/**
 * Which of the nine AI states (src/brand AiStateMark) a reply is in, read from the events the
 * turn already streams: the message status, its tool calls, its research events and its
 * segments. Nothing here is new protocol; it only names what the client already knows.
 *
 * Mapping (docs/brand/R14-Chat.dc.html status lines; States-Polish for the nine states):
 *
 * | Turn event (existing)                                       | AI state     |
 * | ----------------------------------------------------------- | ------------ |
 * | status `error`                                              | error        |
 * | status `stopped`                                            | none (null)  |
 * | the last tool call asks the user (ask_user_input_v0 /       | needs-input  |
 * |   ask_user_options) and the turn has ended                  |              |
 * | status `complete`                                           | done         |
 * | running tool: web_search, web_fetch, image_search,          | searching    |
 * |   search_* , conversation_search, recent_chats              |              |
 * | running tool: view, read_*, load_skill, list_skills,        | reading      |
 * |   memory_list / memory_read, get_goal, extract_scanned_*    |              |
 * | running tool: bash_tool, run_python, analyze_table_rows,    | running      |
 * |   any tool not listed here                                  |              |
 * | running tool: create_file, str_replace, present_files,      | creating     |
 * |   generate_deliverable, create/update_artifact,             |              |
 * |   generate_image, render_ui and the drawn display tools,    |              |
 * |   memory writes, update_goal; or a visual draft streaming   |              |
 * | research event in progress: stage `searching` / `planning`  | searching    |
 * |   stage `reading`                                           | reading      |
 * |   stage `synthesizing`                                      | writing      |
 * | answer text is the newest segment and still streaming       | writing      |
 * | `submitting`, or generating with thinking / nothing yet     | thinking     |
 */
import type { AiState } from "./brand";
import { DRAWN_TOOLS, type Message, type ToolCall } from "./types";

const ASK_TOOLS = new Set(["ask_user_input_v0", "ask_user_options"]);

const SEARCHING = new Set([
  "web_search",
  "web_fetch",
  "image_search",
  "search_project_files",
  "search_skills",
  "search_tools",
  "search_chats",
  "search_memory",
  "conversation_search",
  "recent_chats",
]);

const READING = new Set([
  "view",
  "read_uploaded_file",
  "read_project_file",
  "read_artifact",
  "read_skill",
  "read_conversation",
  "read_memory",
  "load_skill",
  "list_skills",
  "memory_list",
  "memory_read",
  "get_goal",
  "extract_scanned_table_rows",
]);

const CREATING = new Set([
  "create_file",
  "str_replace",
  "present_files",
  "generate_deliverable",
  "create_artifact",
  "update_artifact",
  "generate_image",
  "render_ui",
  "show_widget",
  "memory_write",
  "memory_append",
  "memory_str_replace",
  "memory_delete",
  "save_memory",
  "update_memory",
  "forget_memory",
  "update_goal",
]);

/** The state one running tool puts the turn in. Unknown tools read as "running". */
export function aiStateForTool(name: string): AiState {
  if (SEARCHING.has(name)) return "searching";
  if (READING.has(name)) return "reading";
  if (CREATING.has(name) || DRAWN_TOOLS.has(name)) return "creating";
  return "running";
}

function asksUser(m: Message): boolean {
  const last = m.toolCalls?.at(-1);
  return !!last && ASK_TOOLS.has(last.name) && last.ok !== false;
}

function runningTool(m: Message): ToolCall | undefined {
  return [...(m.toolCalls ?? [])].reverse().find((c) => c.ok === undefined && !ASK_TOOLS.has(c.name));
}

/** The AI state of a reply, or null when there is none to show (a user turn, a stopped reply). */
export function aiStateForMessage(m: Message): AiState | null {
  if (m.role !== "assistant") return null;
  if (m.status === "error") return "error";
  if (m.status === "stopped" || m.status === "idle") return null;
  const working = m.status === "submitting" || m.status === "generating";
  if (!working) return asksUser(m) ? "needs-input" : "done";

  const tool = runningTool(m);
  if (tool) return aiStateForTool(tool.name);
  if (m.visualDrafts?.length) return "creating";

  const event = m.events?.at(-1);
  if (event && event.stage !== "complete" && event.stage !== "partial" && event.stage !== "error") {
    if (event.stage === "searching" || event.stage === "planning") return "searching";
    if (event.stage === "reading") return "reading";
    if (event.stage === "synthesizing") return "writing";
  }

  if (m.status === "submitting") return "thinking";
  const lastSegment = m.segments?.at(-1);
  if (lastSegment) return lastSegment.type === "text" && lastSegment.text ? "writing" : "thinking";
  return m.text ? "writing" : "thinking";
}

/** The words beside the mark: the running step when one is named, else the state's own name. */
export function aiStatusLabel(state: AiState, step?: string): string {
  if (step) return `${step}…`;
  switch (state) {
    case "writing":
      return "Writing…";
    case "searching":
      return "Searching…";
    case "reading":
      return "Reading…";
    case "running":
      return "Running…";
    case "creating":
      return "Creating…";
    case "thinking":
      return "Thinking…";
    case "done":
      return "Done";
    case "needs-input":
      return "Waiting for your answer";
    case "error":
      return "Something went wrong";
  }
}
