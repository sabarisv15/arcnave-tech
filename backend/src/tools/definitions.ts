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

/* -------------------------------------------------------------------------- The code machine */

/**
 * The sandbox computer, as five tools: a shell, and file tools that read, create, edit and hand
 * over files (ADR-0047). They run on the same sandbox engine; `persistent` says whether that
 * engine keeps files between calls (the warm service does, the single-use Job does not), so the
 * model is never told files stay when they do not.
 */
export function codeToolDefinitions(persistent: boolean): ToolDefinition[] {
  const machine = persistent
    ? "This chat's own sandbox computer. Files persist between calls in the same chat; shell state " +
      '(variables, the current directory) does not. '
    : 'A single-use sandbox computer: each call starts from an empty machine, so do the whole job in one command. ';
  return [
    {
      name: 'bash_tool',
      description:
        'Runs a bash command on ' + machine.charAt(0).toLowerCase() + machine.slice(1) +
        'No network access, and nothing can be installed. Python 3 with pandas, numpy, scipy, matplotlib, ' +
        'openpyxl, xlrd, xlsxwriter, pdfplumber, pypdf, pymupdf (fitz), python-docx, python-pptx, pillow, ' +
        'opencv and pytesseract; poppler (pdftoppm, pdftotext), pandoc and LibreOffice. The files in the ' +
        'conversation are in input/ (read-only), at the path on each file\'s attachment line. Write files ' +
        'for the user to output/ and hand them over with present_files. Output is truncated when long, ' +
        'so print summaries, not whole tables.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to run.' },
          description: { type: 'string', description: 'Why this command is being run.' },
        },
        required: ['command', 'description'],
      },
    },
    {
      name: 'view',
      description:
        'Shows a text file with numbered lines, an image (PNG, JPEG, GIF, WebP) as a picture, or a ' +
        'directory listing two levels deep (hidden files left out). The line prefix (spaces, number, tab) ' +
        'is display only: never include it in str_replace. A text file with no view_range is cut in the ' +
        'middle past 16,000 characters. Skills are read from /skills/<name>/SKILL.md.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Why this is being viewed.' },
          path: { type: 'string', description: 'Path of the file or directory, e.g. "input/report.pdf" or "/skills/xlsx/SKILL.md".' },
          view_range: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 2,
            maxItems: 2,
            description: 'Optional [start_line, end_line] for a text file, from 1; [start_line, -1] reads to the end.',
          },
        },
        required: ['description', 'path'],
      },
    },
    {
      name: 'create_file',
      description:
        'Creates a new file with the given content, making its folders. Fails when the path already ' +
        'exists: edit an existing file with str_replace, or overwrite it with bash_tool.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Why this file is being created. Give this first.' },
          path: { type: 'string', description: 'Path of the file to create. Give this second.' },
          file_text: { type: 'string', description: 'The whole content of the file. Give this last.' },
        },
        required: ['description', 'path', 'file_text'],
      },
    },
    {
      name: 'str_replace',
      description:
        'Replaces one string in a file with another. old_str must match the file exactly and occur ' +
        'exactly once; widen it with surrounding text until it is unique. View the file just before ' +
        'editing it: after an edit, earlier views of that file are stale. input/ and /skills are read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the file to edit.' },
          description: { type: 'string', description: 'Why this edit is being made.' },
          old_str: { type: 'string', description: 'The text to replace; it must occur exactly once.' },
          new_str: { type: 'string', description: 'The replacement; empty deletes old_str.' },
        },
        required: ['path', 'description', 'old_str'],
      },
    },
    {
      name: 'present_files',
      description:
        'Gives files to the user as downloads. Use it for every file the user should get, after it is ' +
        'created; not for intermediate files you only read yourself. A file outside output/ is copied ' +
        'there first. Put the file the user should open first at the front of the list.',
      inputSchema: {
        type: 'object',
        properties: {
          filepaths: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'Paths of the files to give the user.',
          },
        },
        required: ['filepaths'],
      },
    },
  ];
}

export const CODE_TOOL_NAMES = ['bash_tool', 'view', 'create_file', 'str_replace', 'present_files'] as const;

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
    'Searches the web. Returns a ranked list of results with title, URL and snippet. Use it for current ' +
    'information, facts that may have changed, and sources to cite.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const WEB_FETCH: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetches the readable text of a web page. Only a URL that already appears in this conversation can be ' +
    'fetched: one the user gave, or one a web_search or web_fetch returned. A URL recalled from memory or made ' +
    'by editing a seen URL is refused; search for the page and fetch the link it returns. Pages behind a login ' +
    'cannot be read. The URL must include https://.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch, exactly as it appeared.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
};

export const IMAGE_SEARCH: ToolDefinition = {
  name: 'image_search',
  description:
    'Finds images on the web and shows them to the user. Use it when pictures would help the user ' +
    'understand (a place, an animal, a product, a style); skip it when the answer is text, code or support.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to find images of.' },
      max_results: { type: 'integer', minimum: 3, maximum: 5, description: 'How many images, 3 to 5. Defaults to 3.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const WEB_TOOL_DEFINITIONS: ToolDefinition[] = [WEB_SEARCH, WEB_FETCH, IMAGE_SEARCH];

/* -------------------------------------------------------------------------- Memory (ADR-0047) */

/** Memory is a set of Markdown files, each changed only against the version last read. */
const VERSION_NEW =
  'The version token from your most recent memory_read or memory_write of this file, or the word new ' +
  'for a file that does not exist yet. Never make one up.';
const PRIVACY = 'Never file, even when asked: government-ID, payment-card or bank-account numbers; immigration status; caste; a minor\'s own age or date of birth; sexual history; abuse; criminal history or being a victim of crime; suicide, self-harm or eating disorders; health or personality inferences the user did not state.';

export const MEMORY_LIST: ToolDefinition = {
  name: 'memory_list',
  description:
    'Lists memory files by path, with size and last update, optionally under a path prefix. ' +
    'include_preview adds each file\'s description line. Read a file with memory_read.',
  inputSchema: {
    type: 'object',
    properties: {
      path_prefix: { type: 'string', description: 'Only list paths starting with this, e.g. "/topics/".' },
      include_preview: { type: 'boolean', description: 'Also give each file\'s one-line description.' },
      cursor: { type: 'string', description: 'The last path of a previous listing, to continue after it.' },
    },
    additionalProperties: false,
  },
};

export const MEMORY_READ: ToolDefinition = {
  name: 'memory_read',
  description:
    'Reads one or more memory files: content, last update and version token. Pass several paths in one call ' +
    'rather than one call each.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
        ],
        description: 'A path such as "/topics/work.md", or a list of up to 20 paths.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

export const MEMORY_WRITE: ToolDefinition = {
  name: 'memory_write',
  description:
    'Creates a memory file, or replaces one whole: every line left out is deleted. Pass the version from ' +
    'your last memory_read of it, or new for a file not yet listed; a file already there must be read first. ' +
    'A conflict returns the current content so you can merge and retry. ' + PRIVACY,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path of the file, e.g. "/topics/work.md".' },
      content: { type: 'string', description: 'The whole file.' },
      if_version: { type: 'string', description: VERSION_NEW },
    },
    required: ['path', 'content', 'if_version'],
    additionalProperties: false,
  },
};

export const MEMORY_APPEND: ToolDefinition = {
  name: 'memory_append',
  description:
    'Adds text on a new line at the end of a memory file, without resending the rest. Do not append a fact ' +
    'the file already has: change that line with memory_str_replace. ' + PRIVACY,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path of the file.' },
      content: { type: 'string', description: 'Text to add at the end.' },
      if_version: { type: 'string', description: VERSION_NEW },
    },
    required: ['path', 'content', 'if_version'],
    additionalProperties: false,
  },
};

export const MEMORY_STR_REPLACE: ToolDefinition = {
  name: 'memory_str_replace',
  description:
    'Changes one part of a memory file: old_str must occur exactly once. An empty new_str deletes it. ' +
    'Needs the version from your last memory_read or memory_write of the file. ' + PRIVACY,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path of the file.' },
      old_str: { type: 'string', description: 'The exact text to replace, occurring once.' },
      new_str: { type: 'string', description: 'The replacement; empty deletes old_str.' },
      if_version: { type: 'string', description: 'The version token from your last read or write of this file.' },
    },
    required: ['path', 'old_str', 'new_str', 'if_version'],
    additionalProperties: false,
  },
};

export const MEMORY_DELETE: ToolDefinition = {
  name: 'memory_delete',
  description:
    'Deletes a whole memory file. Only when the user asks to forget that file or subject; to remove one line, ' +
    'use memory_str_replace. Never delete to tidy up. Needs the version from a memory_read of the file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path of the file.' },
      if_version: { type: 'string', description: 'The version token from your memory_read of this file.' },
    },
    required: ['path', 'if_version'],
    additionalProperties: false,
  },
};

export const MEMORY_TOOL_DEFINITIONS: ToolDefinition[] = [
  MEMORY_LIST,
  MEMORY_READ,
  MEMORY_WRITE,
  MEMORY_APPEND,
  MEMORY_STR_REPLACE,
  MEMORY_DELETE,
];

/* -------------------------------------------------------------------------- Past chats */

export const CONVERSATION_SEARCH: ToolDefinition = {
  name: 'conversation_search',
  description:
    'Searches the user\'s past chats (inside a project, that project\'s chats) for a few words. Returns ' +
    'matching excerpts with the chat\'s id, title and date, and a page_token to open each one with ' +
    'read_conversation. Use short keywords, never a pasted passage.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A few keywords.' },
      max_results: { type: 'integer', minimum: 1, maximum: 10, description: 'Results to return, 1 to 10. Defaults to 5.' },
      within_conversation_id: { type: 'string', description: 'Search inside this one chat only.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export const READ_CONVERSATION: ToolDefinition = {
  name: 'read_conversation',
  description:
    'Opens a past chat at a conversation_search hit and returns the turns around it. Not for reading whole chats.',
  inputSchema: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'The chat id from a tool result. Never guess one.' },
      page_token: { type: 'string', description: 'A hit\'s page_token, or next_page_token / prev_page_token. Omit to start at the beginning.' },
      max_turns: { type: 'integer', minimum: 1, maximum: 50, description: 'Turns to return, up to 50. Defaults to 20.' },
    },
    required: ['conversation_id'],
    additionalProperties: false,
  },
};

export const RECENT_CHATS: ToolDefinition = {
  name: 'recent_chats',
  description:
    'Lists the user\'s most recently updated chats (inside a project, that project\'s), newest first, ' +
    'with a short excerpt of each. Page with before and after.',
  inputSchema: {
    type: 'object',
    properties: {
      n: { type: 'integer', minimum: 1, maximum: 20, description: 'How many chats, 1 to 20. Defaults to 3.' },
      before: { type: 'string', description: 'Only chats updated before this ISO date-time.' },
      after: { type: 'string', description: 'Only chats updated after this ISO date-time.' },
    },
    additionalProperties: false,
  },
};

export const CHAT_TOOL_DEFINITIONS: ToolDefinition[] = [CONVERSATION_SEARCH, READ_CONVERSATION, RECENT_CHATS];

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




