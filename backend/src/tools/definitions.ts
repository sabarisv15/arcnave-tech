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
    'Runs Python code in an isolated, single-use sandbox. Do not rely on network access. Use it for ' +
    'computation — arithmetic, data transformation, analysing an uploaded file, verifying a calculation. ' +
    'Every file in the conversation is placed in "input/" before the code runs, at the "run_python path" ' +
    'printed on its line in the attachment list; open it there directly. "input_files" is not needed. ' +
    'If the code generates deliverable files (e.g. charts, spreadsheets, reports, data files), ' +
    'save them to the "output/" directory and explicitly declare their exact filenames in "expected_outputs". ' +
    'Only declared output files will be authorized and uploaded from the sandbox; undeclared files are rejected. ' +
    'Output is captured stdout/stderr, truncated if large. The sandbox has no persisted state between calls — each call starts fresh.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python source to execute.' },
      input_files: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Not needed: every conversation file is already in "input/". Accepted for compatibility.',
      },
      expected_outputs: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of output filenames expected to be written to "output/" (e.g. ["sales_chart.png", "summary.csv"]). ' +
          'Only declared filenames will be authorized and uploaded from the sandbox.',
      },
    },
    required: ['code'],
  },
};

/**
 * run_python as the warm sandbox service runs it (ADR-0010). Selected by `definitionFor` in the
 * catalog whenever that engine is configured, so the model is never told "fresh each call" while
 * its files are in fact kept, or the reverse.
 */
export const RUN_PYTHON_WARM: ToolDefinition = {
  name: 'run_python',
  description:
    'Runs Python code in this chat\'s own sandbox computer. Files persist between calls in the same ' +
    'chat: anything written to the working directory (or "output/") is still there next call, so load ' +
    'or parse a file once, save the result (e.g. rows.json, a .parquet), and reuse it. Python variables ' +
    'do not persist between calls; files do. No network access. Pre-installed: pandas, numpy, scipy, ' +
    'matplotlib, openpyxl, xlrd, xlsxwriter, pdfplumber, pypdf, pymupdf (fitz), python-docx, python-pptx, ' +
    'pillow, opencv, pytesseract with tesseract (eng, tam), poppler (pdftoppm, pdftotext), pandoc, ' +
    'LibreOffice. Nothing can be installed. ' +
    'Every file in the conversation is already in "input/", at the "run_python path" printed on its ' +
    'line in the attachment list; open it there directly. "input_files" is not needed. Any size of file works. ' +
    'Files written or changed in "output/" during the call are returned to the user as downloads. ' +
    'To look at something yourself, save an image (PNG/JPEG/WebP) to "view/": it is shown to you with the ' +
    'result, up to 4 per call. For a scanned page, render just the region you need at high resolution ' +
    '(e.g. pymupdf page.get_pixmap(dpi=200, clip=rect)) and read it, rather than trusting OCR for exact figures. ' +
    'Output is captured stdout/stderr, truncated if large; print summaries, not whole tables. ' +
    'A call may run for a few minutes.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python source to execute.' },
      input_files: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Not needed: every conversation file is already in "input/". Accepted for compatibility.',
      },
    },
    required: ['code'],
  },
};

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
          'The exact name of the skill to load (e.g. "docx", "pptx", "xlsx", "pdf", "pdf-reading", "skill-creator").',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

export const LOAD_SKILL: ToolDefinition = {
  name: 'load_skill',
  description:
    'Internal progressive disclosure mechanism. Loads specialized instructions (SKILL.md) and ' +
    'optional resource files (e.g. templates, reference docs, scripts) for a known skill into context. ' +
    'Call this before creating a file or writing code for one (e.g. "pdf", "xlsx", "docx", "pptx"), ' +
    'unless it is already loaded in this session.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The exact name of the skill to load (e.g. "pdf", "xlsx", "docx", "pptx").',
      },
      resource: {
        type: 'string',
        description: 'Optional relative path to a specific skill resource (e.g. "reference.md", "scripts/validate.py").',
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

/* -------------------------------------------------------------------------- Tool Discovery */

export const SEARCH_TOOLS: ToolDefinition = {
  name: 'search_tools',
  description:
    'Searches the policy-approved catalog of executable tools available in this workspace. ' +
    'Call this when you evaluate that the task requires an execution tool (e.g. generating an Excel/Word/PPTX/PDF deliverable, running Python computations, web search, creating artifacts). ' +
    'Returns matching tool definitions and parameter schemas that can be invoked.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query or capability keywords (e.g. "excel", "deliverable", "python", "image", "web_search", "artifact").',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const DISCOVERY_TOOL_DEFINITIONS: ToolDefinition[] = [SEARCH_TOOLS];

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
        enum: ['document', 'code', 'webpage', 'svg', 'slides'],
        description: "The kind of artifact: 'document' (Markdown text/reports), 'code' (source files/scripts), 'webpage' (a self-contained HTML page or small interactive tool; it runs in a sandbox with no network, and gets the same theme tokens, element styles and chart library options as a render_ui visual), or 'svg' (an SVG image), or 'slides' (a presentation: each slide starts with a `#` or `##` heading and holds a few bullets, one table, or one image; a line starting `Notes:` is that slide's speaker notes; the user can present it and download it as PowerPoint). Defaults to 'document'.",
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

export const SAVE_MEMORY: ToolDefinition = {
  name: 'save_memory',
  description:
    'Saves something about the user to memory under a short topic, so later conversations start from it. ' +
    'Saving to a topic that already exists replaces that topic\'s content, so include what should be kept. ' +
    'Use it when the user asks you to remember something, and on your own for durable facts that will help in ' +
    'later conversations: their work, projects, preferences and standing instructions. Do not save passing ' +
    'details of one task.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Short topic name, e.g. "Work", "Writing style", "Bank statement project".',
      },
      content: {
        type: 'string',
        description: 'What to remember under this topic, written as plain statements.',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project'],
        description:
          'Optional: "project" keeps it to the current project only; defaults to "project" inside a project and "global" elsewhere.',
      },
    },
    required: ['topic', 'content'],
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
    'Removes a memory topic, by its topic name or its memoryId. ' +
    'Deletes it from memory; original chat transcripts are preserved.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'The topic name to remove, as shown in memory.',
      },
      memoryId: {
        type: 'string',
        description: 'The canonical UUID of the memory item to remove, as returned by search_memory.',
      },
      expectedVersion: {
        type: 'integer',
        description: 'Optional expected version for concurrency safety.',
      },
    },
    additionalProperties: false,
  },
};

export const SEARCH_CHATS: ToolDefinition = {
  name: 'search_chats',
  description:
    'Searches the user\'s earlier conversations (inside a project: that project\'s chats only) for words ' +
    'they mention. Use it when the user refers to something discussed before that is not in this ' +
    'conversation. Returns matching excerpts with the chat title and date; cite the chat title when you use one.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words to look for, e.g. "KVB statement reconciliation".' },
      limit: { type: 'integer', description: 'Maximum excerpts to return (1 to 10). Defaults to 5.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const MEMORY_TOOL_DEFINITIONS: ToolDefinition[] = [
  SAVE_MEMORY,
  SEARCH_CHATS,
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
    "A 'visual' block holds your own self-contained HTML (with CSS and JavaScript) for a diagram, chart or small " +
    'interactive explanation that text and the other blocks cannot show, such as a slider that changes a curve. ' +
    'It runs in a sandbox with no network: no fetch, forms, popups or external images; libraries only from ' +
    'cdnjs.cloudflare.com or cdn.jsdelivr.net. window.arcnave.prompt(text) suggests a follow-up for the user to send. ' +
    'Do not call this for simple conversational text or greetings.',
  inputSchema: getProviderSafeUISchema(),
};

export const UI_TOOL_DEFINITIONS: ToolDefinition[] = [RENDER_UI];

/* -------------------------------------------------------------------------- Question Options (WP-06) */

export const ASK_USER_OPTIONS: ToolDefinition = {
  name: 'ask_user_options',
  description:
    'Presents clickable options (multiple choice, multi-select, or ranking) to the user at the bottom of the chat. ' +
    'Use this only when the answer is one of a few known options, and at most once per turn. ' +
    'Calling this tool ends the turn so the user can make their selection. ' +
    'The question will be displayed prominently above the options in the UI, so do not repeat the question in your text reply.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The prompt or question to show above the options.',
      },
      kind: {
        type: 'string',
        enum: ['single', 'multi', 'rank'],
        description:
          '"single" for single-choice buttons (one click responds), "multi" for multi-select checkboxes, "rank" for ordering choices.',
      },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'The display text for this option.',
            },
            description: {
              type: 'string',
              description: 'Optional supporting explanation or detail for this option.',
            },
          },
          required: ['label'],
          additionalProperties: false,
        },
        minItems: 2,
        maxItems: 6,
        description: 'Between 2 and 6 options to present.',
      },
    },
    required: ['question', 'kind', 'options'],
    additionalProperties: false,
  },
};

export const QUESTION_TOOL_DEFINITIONS: ToolDefinition[] = [ASK_USER_OPTIONS];




