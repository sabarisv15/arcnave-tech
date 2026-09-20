/**
 * ArcNave's phase-1 tool set: read access to the current project's already-indexed files.
 *
 * Descriptions matter more than they look like they should — the model reasons from them, not
 * the schema. Per Invariant 4, `search_project_files`'s description must say "lexical keyword
 * search" and must not claim conceptual/semantic matching, because there is none.
 */
import type { ToolDefinition } from '../providers/types.js';

export const SEARCH_PROJECT_FILES: ToolDefinition = {
  name: 'search_project_files',
  description:
    "Lexical keyword search over the current project's indexed files. Returns the most " +
    'relevant excerpts, not whole documents, ranked by BM25 term overlap — this is keyword ' +
    'matching, not semantic or conceptual search, so exact terms matter more than phrasing. ' +
    "Use it when the question likely depends on project-specific content that hasn't already " +
    'appeared in this conversation. Do not use it for general-knowledge questions unrelated to ' +
    'the project.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keywords to search for, not a full natural-language question.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of excerpts to return. Defaults to 5.',
      },
    },
    required: ['query'],
  },
};

export const READ_PROJECT_FILE: ToolDefinition = {
  name: 'read_project_file',
  description:
    'Reads the indexed text of one project file by id, starting at an optional cursor, for ' +
    'when a search excerpt is not enough context. The response is bounded and may be ' +
    'truncated — check `truncated` and pass the returned `nextCursor` back in a follow-up call ' +
    'to continue reading. Only call this with a fileId already seen in this conversation, such ' +
    'as one returned by search_project_files. Do not guess a fileId.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The file id, exactly as returned by search_project_files.',
      },
      cursor: {
        type: 'integer',
        description:
          "Opaque cursor from a previous call's nextCursor. Omit to start from the beginning.",
      },
      maxChars: {
        type: 'integer',
        description: 'Soft budget for returned characters. The server enforces a hard cap ' +
          'regardless of this value.',
      },
    },
    required: ['fileId'],
  },
};

export const PROJECT_TOOL_DEFINITIONS: ToolDefinition[] = [SEARCH_PROJECT_FILES, READ_PROJECT_FILE];

/**
 * Item 9 phase 2. Gated separately from the two tools above (ENABLE_RUN_PYTHON, not just
 * ENABLE_TOOL_USE) — arbitrary code execution is a materially larger blast radius than
 * read-only project-file search. The description says "no persisted state between calls"
 * deliberately: this phase always creates a fresh sandbox per call rather than reusing one
 * across a chat, unlike the Vertex Agent Engine quickstart's same-sandbox-reuse example — if a
 * future phase adds session-scoped reuse, this description has to change in the same commit, or
 * the model is told something false.
 */
export const RUN_PYTHON: ToolDefinition = {
  name: 'run_python',
  description:
    'Runs Python code in an isolated, single-use sandbox with outbound network access but no ' +
    "access to this project's files or any other tool's data. Use it for computation — " +
    'arithmetic, data transformation, verifying a calculation — not for anything that needs ' +
    'project context; combine with search_project_files/read_project_file first if the code ' +
    'needs data from the project. Output is captured stdout/stderr, truncated if large. The ' +
    'sandbox has no persisted state between calls — each call starts fresh.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python source to execute.' },
    },
    required: ['code'],
  },
};

/**
 * Item 10 Goal Bookkeeping Tools.
 * Exposes active goal state, progress tracking, and context-window token remaining queries.
 */
export const GET_GOAL: ToolDefinition = {
  name: 'get_goal',
  description:
    'Reads the active goal for this conversation, its current status, allocated token budget, ' +
    'spent tokens, remaining budget, and recorded checkpoint notes. Call this at the start of an ' +
    'autonomous step or when evaluating remaining budget and milestone progress.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export const UPDATE_GOAL: ToolDefinition = {
  name: 'update_goal',
  description:
    'Updates the active goal status (complete or blocked), or appends a progress checkpoint note. ' +
    'Mark as complete ONLY when the goal objectives are genuinely achieved. ' +
    'Mark as blocked ONLY when the exact same underlying failure has occurred 3 consecutive times (B2 rule); ' +
    'the server will reject the blocked transition if this condition is not met.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['complete', 'blocked'],
        description: 'New goal status. Set to complete when objectives are achieved, or blocked if B2 failure threshold is met.',
      },
      note: {
        type: 'string',
        description: 'Checkpoint or progress summary note to record for this goal.',
      },
      blockedReason: {
        type: 'string',
        description: 'Required explanation when status is set to blocked.',
      },
    },
    additionalProperties: false,
  },
};

export const GET_CONTEXT_REMAINING: ToolDefinition = {
  name: 'get_context_remaining',
  description:
    'Returns the model context window limit, measured tokens used by the current request context, ' +
    'and remaining available tokens in the context window. Returns null values when exact token counting is unavailable.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export const GOAL_TOOL_DEFINITIONS: ToolDefinition[] = [
  GET_GOAL,
  UPDATE_GOAL,
  GET_CONTEXT_REMAINING,
];

/**
 * Item 11 Skills System Tools.
 * Provides lightweight discovery, keyword search, and lazy loading of specialized SKILL.md instructions.
 */
export const LIST_SKILLS: ToolDefinition = {
  name: 'list_skills',
  description:
    'Lists available specialized skills with their name, version, category, capability mode, and summary description. ' +
    'Call this to discover expert procedural instructions for documents, presentations, spreadsheets, data analysis, or deep research.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export const SEARCH_SKILLS: ToolDefinition = {
  name: 'search_skills',
  description:
    'Searches available skills by topic or task keywords (e.g. "presentation", "spreadsheet", "deep research", "data analysis"). ' +
    'Returns ranked matches with summaries and capability modes.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query or task keywords to find relevant skills.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const READ_SKILL: ToolDefinition = {
  name: 'read_skill',
  description:
    'Loads the complete expert instructions, formatting standards, and gotchas for a specified skill. ' +
    'Call this before performing complex domain tasks (e.g. creating documents, slides, financial models, or deep research).',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description:
          'The exact name of the skill to load (e.g. "docx", "pptx", "xlsx", "pdf", "data-analysis", "research-deep-dive", "skill-creator").',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

export const SKILL_TOOL_DEFINITIONS: ToolDefinition[] = [
  LIST_SKILLS,
  SEARCH_SKILLS,
  READ_SKILL,
];

