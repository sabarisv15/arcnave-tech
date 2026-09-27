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

export const LOAD_SKILL: ToolDefinition = {
  name: 'load_skill',
  description:
    'Internal progressive disclosure mechanism. Loads specialized instructions (SKILL.md) and ' +
    'optional resource files (e.g. templates, reference docs, scripts) for a known skill into context. ' +
    'Call this before using domain-specific file operations (e.g. "pdf", "xlsx", "docx", "pptx", "data-analysis") ' +
    'to receive detailed domain guidance before discovering and selecting execution tools, unless already loaded in this session.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The exact name of the skill to load (e.g. "pdf", "xlsx", "docx", "pptx", "data-analysis").',
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
        enum: ['document', 'code', 'webpage', 'svg'],
        description: "The kind of artifact: 'document' (Markdown text/reports), 'code' (source files/scripts), 'webpage' (a self-contained HTML page or small interactive tool; it runs in a sandbox with no network, and gets the same theme tokens, element styles and chart library options as a render_ui visual), or 'svg' (an SVG image). Defaults to 'document'.",
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

/* -------------------------------------------------------------------------- Table extraction */

/**
 * Phase 3: generic exact extraction of table rows from PDF pages, scanned or digital. The
 * description states what the tool guarantees and what it does not (vision is probabilistic;
 * low-confidence rows and failed pages are reported, never hidden).
 */
export const EXTRACT_SCANNED_TABLE_ROWS: ToolDefinition = {
  name: 'extract_scanned_table_rows',
  description:
    'Extracts every table row from the pages of an uploaded PDF, including scanned PDFs with no text layer, ' +
    'as structured rows: {page, rowIndex, cells[], confidence, sourceRegion}. Use it whenever an answer needs exact ' +
    'counts, totals or every row of a table (statements, registers, ledgers, attendance sheets, invoices), not a summary. ' +
    'For that, call it first: run_python and read_uploaded_file cannot read a scanned page. ' +
    'Pages are rendered and read one by one; rows read with low confidence are re-read from a high-resolution crop. ' +
    'The result lists every page processed, failed pages, low-confidence rows, possible cross-page duplicates, and an ' +
    'extractionId. Reading is probabilistic: report low-confidence rows and failed pages to the user, and reconcile with ' +
    'analyze_table_rows before stating an exact figure. To re-read suspicious pages, call again with "pages" and the same ' +
    'extractionId; those pages are re-rendered at higher resolution and replace the earlier reading.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'fileId of the uploaded PDF (from the conversation attachment list).' },
      pages: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Optional 1-based page numbers. Omit to extract every page.',
      },
      extractionId: {
        type: 'string',
        description: 'Optional. An earlier extraction of the same file to add these pages to, or replace them in.',
      },
    },
    required: ['fileId'],
  },
};

export const ANALYZE_TABLE_ROWS: ToolDefinition = {
  name: 'analyze_table_rows',
  description:
    'Deterministically counts, sums and reconciles the rows of an extraction from extract_scanned_table_rows. ' +
    'You decide which column means what; this tool only computes, so every count and total it returns comes from the ' +
    'row array. Operations: {"op":"count","name","where"?,"expected"?}, {"op":"sum","name","column","where"?,"expected"?}, ' +
    '{"op":"running_balance","name","balanceColumn","increaseColumn"?,"decreaseColumn"?,"tolerance"?,"where"?}, ' +
    '{"op":"classify","name","where"?,"rules":[{"label","reason","where","capture"?}],"default"?,"capture"?:{"column","pattern"}} — ' +
    'every selected row gets the first matching rule\'s label (else the default, "UNKNOWN"), with per-label counts that ' +
    'add up to the total; "capture" pulls a value such as a party name from a column with a regex group (a rule\'s own "capture" overrides the operation\'s). ' +
    'Columns are 0-based cell indexes. "where" is a list of filters that must all hold: ' +
    '{"column","test":"nonEmpty"|"empty"|"numeric"|"matches"|"notMatches"|"equals","value"?} ("matches" is a ' +
    'case-insensitive regular expression), or {"pageFrom","pageTo"} to select a page range (e.g. one of two statements in one PDF). Give "expected" when the document prints its own figure (a count or total) so ' +
    'the result says pass or fail. Failed checks list the rows and "suspiciousPages" to re-extract. ' +
    'Report its counts and totals; do not print more than about 50 rows in the chat. A full row list goes in an xlsx ' +
    'file via generate_deliverable, because a long list is cut off at the output limit.',
  inputSchema: {
    type: 'object',
    properties: {
      extractionId: { type: 'string', description: 'The extractionId returned by extract_scanned_table_rows.' },
      operations: {
        type: 'array',
        items: { type: 'object' },
        description: 'The counts, sums and balance checks to run, in order.',
      },
    },
    required: ['extractionId', 'operations'],
  },
};

export const TABLE_EXTRACTION_TOOL_DEFINITIONS: ToolDefinition[] = [EXTRACT_SCANNED_TABLE_ROWS, ANALYZE_TABLE_ROWS];

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

/* -------------------------------------------------------------------------- Deliverable Export */

export const GENERATE_DELIVERABLE: ToolDefinition = {
  name: 'generate_deliverable',
  description:
    'Generates, exports, and verifies an office document or spreadsheet deliverable (.xlsx, .docx, .pptx, or .pdf). ' +
    'Supports two modes:\n' +
    '1. Direct generation: Provide "format", "title", and Markdown "content" containing tables, headings, or slides.\n' +
    '2. Structured workbook: for "xlsx", provide typed sheets, columns and rows as "workbook" (preferred for data read from a PDF, image or file).\n' +
    '3. Text copy: "sourceAttachmentId" of an uploaded text, CSV or TSV file copies its text as it is. It does not read PDFs, images or Office files: read those first and pass what you extracted.\n' +
    'Always call this tool when the user asks for a downloadable Excel file, Word doc, PowerPoint deck, or PDF. Returns a downloadable file card.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['xlsx', 'docx', 'pptx', 'pdf'],
        description: 'The target deliverable format: "xlsx" for spreadsheets, "docx" for Word documents, "pptx" for slide presentations, "pdf" for documents.',
      },
      title: {
        type: 'string',
        description: 'Filename or document title (e.g. "kvbfedral", "Bank_Statement_Transactions", "Quarterly_Report").',
      },
      content: {
        type: 'string',
        description: 'Optional Markdown content (used for direct generation). For XLSX, format tabular data as Markdown tables with headers.',
      },
      sourceAttachmentId: {
        type: 'string',
        description: 'Optional id of an uploaded text, CSV or TSV file whose text is copied as it is. Not for PDFs, images or Office files.',
      },
      instructions: {
        type: 'string',
        description: 'Not applied to the data: shown as a note in the file. Apply the user\'s instructions yourself to the rows or content you pass.',
      },
      workbook: {
        type: 'object',
        description: 'Optional structured workbook object containing typed sheets, columns, and rows (for format-native XLSX generation).',
      },
      artifactRef: {
        type: 'string',
        description: 'Optional opaque workspace intermediate artifact reference (e.g. "artifact_8f27c4...") containing prepared structured JSON.',
      },
      sourceProfile: {
        type: 'object',
        description: 'Optional source profile metadata describing processed units, structure, and warnings.',
      },
      saveAsArtifact: {
        type: 'boolean',
        description: 'Set to true ONLY if the user explicitly commanded saving this deliverable as a workspace artifact. Defaults to false.',
      },
    },
    required: ['format'],
    additionalProperties: false,
  },
};

export const DELIVERABLE_TOOL_DEFINITIONS: ToolDefinition[] = [GENERATE_DELIVERABLE];

/* -------------------------------------------------------------------------- File Operations (Batch 4) */

export const INSPECT_PDF: ToolDefinition = {
  name: 'inspectPdf',
  description:
    'Inspects a PDF document to extract structural properties, total page count, embedded title, and author metadata. ' +
    'Returns structured JSON metadata. Does not generate new deliverable files.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded PDF file attachment to inspect.',
      },
    },
    required: ['fileId'],
    additionalProperties: false,
  },
};

export const MERGE_PDF_FILES: ToolDefinition = {
  name: 'mergePdfFiles',
  description:
    'Deterministically merges two or more PDF files into a single consolidated PDF document. ' +
    'Preserves the exact input order of files, all pages, vector fonts, and layout styling intact. ' +
    'Requires at least 2 input files.',
  inputSchema: {
    type: 'object',
    properties: {
      fileIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description: 'Array of PDF attachment UUIDs to merge in sequential order (minimum 2 files).',
      },
      outputFilename: {
        type: 'string',
        description: 'Optional output filename for the merged PDF (e.g. "consolidated_reports.pdf").',
      },
    },
    required: ['fileIds'],
    additionalProperties: false,
  },
};

export const SPLIT_PDF_FILE: ToolDefinition = {
  name: 'splitPdfFile',
  description:
    'Extracts specific page ranges from an uploaded PDF document into one or more separate PDF files. ' +
    'Each range is specified as a 1-based [startPage, endPage] pair (e.g. [[1, 3], [5, 5]]).',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded PDF file attachment to split.',
      },
      pageRanges: {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 2,
          maxItems: 2,
        },
        minItems: 1,
        description: 'List of 1-based [startPage, endPage] pairs to extract (e.g. [[1, 5], [8, 10]]).',
      },
      outputFilename: {
        type: 'string',
        description: 'Optional base filename for the extracted PDF files (e.g. "extracted_pages.pdf").',
      },
    },
    required: ['fileId', 'pageRanges'],
    additionalProperties: false,
  },
};

export const INSPECT_SPREADSHEET: ToolDefinition = {
  name: 'inspectSpreadsheet',
  description:
    'Inspects an Excel spreadsheet (.xlsx) to discover active worksheet names, total row counts, ' +
    'and sample cell data types (number, string, formula, date, boolean). Returns structured JSON without generating output files.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded .xlsx spreadsheet attachment to inspect.',
      },
    },
    required: ['fileId'],
    additionalProperties: false,
  },
};

export const EDIT_SPREADSHEET_CELLS: ToolDefinition = {
  name: 'editSpreadsheetCells',
  description:
    'Performs targeted cell updates in an existing Excel (.xlsx) workbook. ' +
    'Preserves all untouched sheets, formulas, cell styles, fonts, and dimensions intact without rebuilding the spreadsheet. ' +
    'Supports typed values: number, formula (e.g. "=SUM(B2:B10)"), date, boolean, or string.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded .xlsx workbook attachment to modify.',
      },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            sheet: {
              type: 'string',
              description: 'The worksheet name containing the cell (e.g. "Summary", "Q3_Data").',
            },
            cell: {
              type: 'string',
              description: 'The cell coordinate address in standard A1 notation (e.g. "B8", "D14").',
            },
            value: {
              description: 'The new value to write to the cell. For formulas, provide the formula string (e.g. "=B2*C2").',
            },
            type: {
              type: 'string',
              enum: ['string', 'number', 'boolean', 'date', 'formula'],
              description: 'Optional explicit value type. Must be "formula" for calculated derivations.',
            },
            format: {
              type: 'string',
              description: 'Optional Excel number format string (e.g. "$#,##0.00", "0.0%", "YYYY-MM-DD").',
            },
          },
          required: ['sheet', 'cell', 'value'],
          additionalProperties: false,
        },
        minItems: 1,
        description: 'List of targeted cell modifications to apply.',
      },
      outputFilename: {
        type: 'string',
        description: 'Optional output filename for the modified spreadsheet (e.g. "updated_financials.xlsx").',
      },
    },
    required: ['fileId', 'edits'],
    additionalProperties: false,
  },
};

export const COMBINE_WORKBOOKS: ToolDefinition = {
  name: 'combineWorkbooks',
  description:
    'Combines sheets from two or more Excel workbooks into a single consolidated .xlsx workbook. ' +
    'Preserves sheet order and automatically disambiguates duplicate sheet names (e.g. "Data", "Data_2"). ' +
    'Requires at least 2 input files.',
  inputSchema: {
    type: 'object',
    properties: {
      fileIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description: 'Array of .xlsx attachment UUIDs to combine in sequential order (minimum 2 files).',
      },
      outputFilename: {
        type: 'string',
        description: 'Optional output filename for the consolidated workbook (e.g. "consolidated_master.xlsx").',
      },
    },
    required: ['fileIds'],
    additionalProperties: false,
  },
};

export const INSPECT_DOCX_STRUCTURE: ToolDefinition = {
  name: 'inspectDocxStructure',
  description:
    'Inspects a Word document (.docx) to extract paragraph counts, table counts, and detected section headings. ' +
    'Returns structured JSON metadata without modifying or generating files.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded .docx document attachment to inspect.',
      },
    },
    required: ['fileId'],
    additionalProperties: false,
  },
};

export const EDIT_DOCX_CONTENT: ToolDefinition = {
  name: 'editDocxContent',
  description:
    'Performs targeted search-and-replace text modifications inside an existing Word document (.docx). ' +
    'Preserves the entire existing OOXML package structure, styles, headers, footers, margins, and embedded media intact. ' +
    'Never rebuilds a document from scratch when targeted edits are requested.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded .docx document attachment to edit.',
      },
      replacements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description: 'Exact text string to find.',
            },
            replace: {
              type: 'string',
              description: 'Replacement text to insert.',
            },
          },
          required: ['search', 'replace'],
          additionalProperties: false,
        },
        minItems: 1,
        description: 'List of search-and-replace text pairs.',
      },
      outputFilename: {
        type: 'string',
        description: 'Optional output filename for the edited Word document (e.g. "modified_contract.docx").',
      },
    },
    required: ['fileId', 'replacements'],
    additionalProperties: false,
  },
};

export const APPEND_DOCX_SECTION: ToolDefinition = {
  name: 'appendDocxSection',
  description:
    'Appends a new titled section and paragraphs to an existing Word document (.docx). ' +
    'Appends content before the end of the body without disturbing prior document sections or styles.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded .docx document attachment to append to.',
      },
      heading: {
        type: 'string',
        description: 'Heading title for the new section (e.g. "Addendum A: Terms of Service").',
      },
      paragraphs: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Array of paragraph text strings to append under the new section.',
      },
      outputFilename: {
        type: 'string',
        description: 'Optional output filename for the updated document (e.g. "agreement_appended.docx").',
      },
    },
    required: ['fileId', 'heading', 'paragraphs'],
    additionalProperties: false,
  },
};

export const INSPECT_PPTX_STRUCTURE: ToolDefinition = {
  name: 'inspectPptxStructure',
  description:
    'Inspects a PowerPoint presentation (.pptx) to extract total slide count and slide title strings. ' +
    'Returns structured JSON metadata without modifying or generating files.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded .pptx presentation attachment to inspect.',
      },
    },
    required: ['fileId'],
    additionalProperties: false,
  },
};

export const REORDER_PPTX_SLIDES: ToolDefinition = {
  name: 'reorderPptxSlides',
  description:
    'Reorders slides in an existing PowerPoint presentation (.pptx) by adjusting slide list sequencing in presentation.xml. ' +
    'Preserves all underlying slide layouts, media, master slides, themes, and animations intact without re-encoding slide XMLs.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded .pptx presentation attachment to reorder.',
      },
      newOrder: {
        type: 'array',
        items: { type: 'integer' },
        minItems: 1,
        description: 'Array of 1-based slide indices representing the desired sequence (e.g. [2, 1, 3, 4]).',
      },
      outputFilename: {
        type: 'string',
        description: 'Optional output filename for the reordered presentation (e.g. "reordered_deck.pptx").',
      },
    },
    required: ['fileId', 'newOrder'],
    additionalProperties: false,
  },
};

export const EDIT_PPTX_SLIDE_TEXT: ToolDefinition = {
  name: 'editPptxSlideText',
  description:
    'Performs targeted text replacements on a specific slide in an existing PowerPoint presentation (.pptx). ' +
    'Preserves master layouts, themes, animations, vector shapes, and all other slides intact.',
  inputSchema: {
    type: 'object',
    properties: {
      fileId: {
        type: 'string',
        description: 'The UUID of the uploaded .pptx presentation attachment to edit.',
      },
      slideIndex: {
        type: 'integer',
        minimum: 1,
        description: '1-based index of the slide to edit (e.g. 1 for first slide, 2 for second slide).',
      },
      replacements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            search: {
              type: 'string',
              description: 'Exact text string to find on the specified slide.',
            },
            replace: {
              type: 'string',
              description: 'Replacement text to insert.',
            },
          },
          required: ['search', 'replace'],
          additionalProperties: false,
        },
        minItems: 1,
        description: 'List of search-and-replace text pairs for the specified slide.',
      },
      outputFilename: {
        type: 'string',
        description: 'Optional output filename for the updated presentation (e.g. "deck_updated.pptx").',
      },
    },
    required: ['fileId', 'slideIndex', 'replacements'],
    additionalProperties: false,
  },
};

export const FILE_OPERATION_TOOL_DEFINITIONS: ToolDefinition[] = [
  INSPECT_PDF,
  MERGE_PDF_FILES,
  SPLIT_PDF_FILE,
  INSPECT_SPREADSHEET,
  EDIT_SPREADSHEET_CELLS,
  COMBINE_WORKBOOKS,
  INSPECT_DOCX_STRUCTURE,
  EDIT_DOCX_CONTENT,
  APPEND_DOCX_SECTION,
  INSPECT_PPTX_STRUCTURE,
  REORDER_PPTX_SLIDES,
  EDIT_PPTX_SLIDE_TEXT,
];

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




