/**
 * ArcNave's phase-1 tool set: read access to the current project's already-indexed files.
 *
 * Descriptions matter more than they look like they should — the model reasons from them, not
 * the schema. Per Invariant 4, `search_project_files`'s description must say "lexical keyword
 * search" and must not claim conceptual/semantic matching, because there is none.
 */
import type { ToolDefinition } from '../providers/types.js';
import { getProviderSafeUISchema } from '../services/ui/schemas.js';

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

/* -------------------------------------------------------------------------- Artifacts */

export const CREATE_ARTIFACT: ToolDefinition = {
  name: 'create_artifact',
  description:
    'Creates a new standalone editable artifact (document, code, or webpage) in the workspace. ' +
    'The artifact immediately appears in the side panel for the user to inspect, edit, and export to supported formats (.docx, .xlsx, .pptx). ' +
    'Call this whenever the user asks for a document, report, presentation, spreadsheet, or asks to convert an uploaded file into a reusable deliverable. ' +
    'Do NOT output raw text in chat telling the user to copy-paste when they requested a document/file.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Concise title for the artifact (1 to 200 characters).',
      },
      kind: {
        type: 'string',
        enum: ['document', 'code', 'webpage'],
        description: "The kind of artifact: 'document' (Markdown text/reports), 'code' (source files/scripts), or 'webpage' (HTML). Defaults to 'document'.",
      },
      content: {
        type: 'string',
        description: 'The complete content of the artifact. Use clean, well-formatted Markdown with headings, tables, and lists for documents.',
      },
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
};

export const READ_ARTIFACT: ToolDefinition = {
  name: 'read_artifact',
  description:
    'Reads the latest version, title, kind, and content of an existing workspace artifact. ' +
    'Call this before updating or refining an artifact so you understand its current text and version.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The UUID of the artifact to read.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
};

export const UPDATE_ARTIFACT: ToolDefinition = {
  name: 'update_artifact',
  description:
    'Appends a new version to an existing workspace artifact. ' +
    'Requires expectedVersion (the current version you read) to prevent overwriting concurrent user edits. ' +
    'If a version conflict occurs, read_artifact again to inspect the latest changes before reapplying your update.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The UUID of the artifact to update.',
      },
      expectedVersion: {
        type: 'integer',
        description: 'The current version of the artifact you expect to update (must match currentVersion).',
      },
      content: {
        type: 'string',
        description: 'The full updated content for the new artifact version.',
      },
    },
    required: ['id', 'expectedVersion', 'content'],
    additionalProperties: false,
  },
};

export const ARTIFACT_TOOL_DEFINITIONS: ToolDefinition[] = [
  CREATE_ARTIFACT,
  READ_ARTIFACT,
  UPDATE_ARTIFACT,
];

/* -------------------------------------------------------------------------- Uploads */

export const READ_UPLOADED_FILE: ToolDefinition = {
  name: 'read_uploaded_file',
  description:
    'Reads content from an uploaded conversation attachment by fileId. ' +
    'Supports page-aware slicing for PDFs (startPage, endPage) and character offsets (cursor/start, maxChars) for text files. ' +
    'Use this to re-read or inspect uploaded documents, forms, or tables without losing source fidelity.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded file/attachment.',
      },
      startPage: {
        type: 'integer',
        description: 'Optional 1-based start page for PDFs.',
      },
      endPage: {
        type: 'integer',
        description: 'Optional 1-based end page for PDFs (inclusive).',
      },
      start: {
        type: 'integer',
        description: 'Optional character offset into extracted text content. Defaults to 0.',
      },
      maxChars: {
        type: 'integer',
        description: 'Soft budget for returned characters. The server enforces a hard cap.',
      },
    },
    required: ['fileId'],
    additionalProperties: false,
  },
};

export const UPLOAD_TOOL_DEFINITIONS: ToolDefinition[] = [READ_UPLOADED_FILE];

/* -------------------------------------------------------------------------- Web */

export const WEB_SEARCH: ToolDefinition = {
  name: 'web_search',
  description:
    'Searches the public web for real-time, current information or specific factual sources. ' +
    'Returns a ranked list of search results including titles, snippets, and canonical URLs. ' +
    'Use for up-to-date facts, current events, or verifying external claims.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keywords or search query to look up on the web (1-6 words recommended).',
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of results to retrieve (1 to 10). Defaults to 5.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const WEB_FETCH: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetches and extracts readable text from a specified public HTTP/HTTPS URL. ' +
    'Returns the document title, extracted text content, and pagination/truncation details. ' +
    'Use when you need to read the full body of a web article or documentation page returned by web_search.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The public http:// or https:// URL to fetch.',
      },
      maxChars: {
        type: 'integer',
        description: 'Maximum characters to retrieve (1000 to 30000). Defaults to 10000.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
};

export const WEB_TOOL_DEFINITIONS: ToolDefinition[] = [WEB_SEARCH, WEB_FETCH];

/* -------------------------------------------------------------------------- Phase 5: Memory tools */

export const SEARCH_MEMORY: ToolDefinition = {
  name: 'search_memory',
  description:
    'Searches persistent memory across past conversations for user preferences, constraints, ' +
    'project decisions, or remembered facts. Returns matching memories with their canonical memoryId, ' +
    'key, summary, content excerpt, version, and relevance score.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keywords or search phrase to look up in persistent memory.',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project'],
        description: 'Optional scope filter: "global" for user-wide memories, "project" for current project.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of memories to return (1 to 10). Defaults to 5.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const READ_MEMORY: ToolDefinition = {
  name: 'read_memory',
  description:
    'Reads the complete content and metadata of a persistent memory item by its canonical memoryId.',
  inputSchema: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The canonical UUID of the memory item, as returned by search_memory.',
      },
    },
    required: ['memoryId'],
    additionalProperties: false,
  },
};

export const UPDATE_MEMORY: ToolDefinition = {
  name: 'update_memory',
  description:
    'Updates an existing persistent memory item. Requires the canonical memoryId and ' +
    'expectedVersion for optimistic concurrency control.',
  inputSchema: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The canonical UUID of the memory item to update.',
      },
      expectedVersion: {
        type: 'integer',
        description: 'The current version of the memory item being modified, to prevent race conditions.',
      },
      content: {
        type: 'string',
        description: 'Updated memory content.',
      },
      summary: {
        type: 'string',
        description: 'Short single-sentence summary of the memory.',
      },
      isStanding: {
        type: 'boolean',
        description: 'Whether this memory is a standing preference loaded into all conversations.',
      },
    },
    required: ['memoryId', 'expectedVersion'],
    additionalProperties: false,
  },
};

export const FORGET_MEMORY: ToolDefinition = {
  name: 'forget_memory',
  description:
    'Removes a memory item from active persistent storage by its canonical memoryId. ' +
    'Deletes the item from active memory; original chat transcripts are preserved.',
  inputSchema: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The canonical UUID of the memory item to remove.',
      },
      expectedVersion: {
        type: 'integer',
        description: 'Optional expected version for concurrency safety.',
      },
    },
    required: ['memoryId'],
    additionalProperties: false,
  },
};

export const MEMORY_TOOL_DEFINITIONS: ToolDefinition[] = [
  SEARCH_MEMORY,
  READ_MEMORY,
  UPDATE_MEMORY,
  FORGET_MEMORY,
];

export const RENDER_UI: ToolDefinition = {
  name: 'render_ui',
  description:
    'Renders a structured, interactive generative UI layout in the chat. Use it when ' +
    'structured presentation significantly improves clarity (e.g. comparing options, ' +
    'plotting time-series or categorical data, displaying KPI metrics with deltas/trends, ' +
    'showing project timelines, or laying out multi-step processes or interactive dashboards). ' +
    'Do not call this for simple conversational text or greetings.',
  inputSchema: getProviderSafeUISchema(),
};

export const UI_TOOL_DEFINITIONS: ToolDefinition[] = [RENDER_UI];

/* -------------------------------------------------------------------------- Image Generation */

export const GENERATE_IMAGE: ToolDefinition = {
  name: 'generate_image',
  description:
    'Generates or edits visual images using Google Vertex AI image models (gemini-3.1-flash-image). ' +
    'Call this whenever the user asks to draw, generate, visualize, create, or edit an image. ' +
    'Returns an image card in chat for display and download.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed visual description of the image to generate or edit.',
      },
      aspectRatio: {
        type: 'string',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        description: 'Aspect ratio for the generated image. Defaults to 1:1.',
      },
      sourceImageAttachmentId: {
        type: 'string',
        description: 'Optional attachment UUID of an existing image to edit, modify, or restyle.',
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
};

export const IMAGE_TOOL_DEFINITIONS: ToolDefinition[] = [GENERATE_IMAGE];


