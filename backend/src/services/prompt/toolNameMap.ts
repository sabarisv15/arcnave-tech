/**
 * Stage tool names → the tool names ArcNave declares today. TRANSITIONAL, AND OURS.
 *
 * The v3 renderings (Stage 6, `06-system-prompt-v3-{claude,gemini}.md`) are written for the
 * Stage 8 tool set (`file_search`, `fetch_url`, `run_code`, `create_artifact`, `load_skill`…).
 * ArcNave still declares the earlier set (`search_project_files`, `web_fetch`, `bash_tool`,
 * `create_file`, `view`…). A prompt that tells the model to call a tool it was not given makes
 * the model call nothing or invent a call (mistakes.md 2026-09-26), so the runtime files are the
 * stage text with each stage name replaced, as a whole token, by the declared equivalent.
 *
 * This is the only edit made to the stage text (task tech-p07, ADR-0075). When Prompt 6 renames the
 * tools to the stage names, every `target` here equals its key and the map becomes the identity:
 * a one-line change per tool, after which the runtime files equal the doc code blocks byte for
 * byte.
 *
 * A stage tool with no exact equivalent is `target: null`. Its rule text stays as the stage wrote
 * it, and `<capabilities_state>` reports the matching flag `off` (Stage 6 CP-1 design: "use a
 * capability only when it is listed as on and its tool is available").
 */

/** The capability flags of `<capabilities_state>` (Stage 6 policy spec, "Shared runtime layout"). */
export type CapabilityFlag =
  | 'web_search'
  | 'fetch_url'
  | 'file_search'
  | 'run_code'
  | 'memory'
  | 'sensitive_memory'
  | 'skill_loader'
  | 'formats';

export interface StageTool {
  /** The declared tool that does this today, or null when none does exactly. */
  target: string | null;
  /** The `<capabilities_state>` flag that says whether this tool may be used. */
  flag: CapabilityFlag | null;
  /** Why this target (or why none). */
  why: string;
}

/** Every tool Stage 8 (08d) names, with today's equivalent. */
export const STAGE_TOOLS: Readonly<Record<string, StageTool>> = {
  file_search: {
    target: 'search_project_files',
    flag: 'file_search',
    why: 'searches the project files; the only file search ArcNave has (chat files are in the attachment list).',
  },
  read_file: {
    target: 'read_project_file',
    flag: 'file_search',
    why: 'reads a project file whole or by range. Not named in either v3 rendering, so nothing is replaced.',
  },
  web_search: {
    target: 'web_search',
    flag: 'web_search',
    why: 'same name: the search function, or the model\'s built-in search on a grounded turn.',
  },
  fetch_url: {
    target: 'web_fetch',
    flag: 'fetch_url',
    why: 'fetches a page by URL; it already refuses a URL not seen in the conversation (TO-5).',
  },
  run_code: {
    target: 'bash_tool',
    flag: 'run_code',
    why: 'runs code in the sandbox (Python available, no network); the only code runner.',
  },
  memory_write: { target: 'memory_write', flag: 'memory', why: 'same name.' },
  memory_delete: { target: 'memory_delete', flag: 'memory', why: 'same name.' },
  memory_read: { target: 'memory_read', flag: 'memory', why: 'same name.' },
  create_artifact: {
    target: 'create_file',
    flag: 'formats',
    why: 'an artifact is a file written with create_file and presented (ADR-0048).',
  },
  update_artifact: {
    target: 'str_replace',
    flag: 'formats',
    why: 'an artifact is edited with str_replace (ADR-0048). Not named in either v3 rendering, so nothing is replaced.',
  },
  load_skill: {
    target: null,
    flag: 'skill_loader',
    why: 'no skill loader: a skill is read as a file with view, which reads any file, so it is not an exact equivalent. skill_loader="off".',
  },
  get_operation_status: {
    target: null,
    flag: null,
    why: 'no operation status tool and no job states (pending_operations comes with P08/P13). Not named by name in either rendering ("the status tool if available").',
  },
};

/**
 * The replace table: stage name → declared name, for stage tools whose name appears in a v3
 * rendering and differs from the target. Identity entries are left out (they change nothing).
 */
export const TOOL_NAME_MAP: Readonly<Record<string, string>> = {
  file_search: 'search_project_files',
  fetch_url: 'web_fetch',
  run_code: 'bash_tool',
  create_artifact: 'create_file',
};

/** A whole-token match of `name`: not part of a longer identifier on either side. */
export function wholeToken(name: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g');
}

/** The stage text with every mapped stage tool name replaced as a whole token. Deterministic. */
export function applyToolNameMap(text: string, map: Readonly<Record<string, string>> = TOOL_NAME_MAP): string {
  let out = text;
  for (const [from, to] of Object.entries(map)) out = out.replace(wholeToken(from), to);
  return out;
}
