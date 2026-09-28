/**
 * ArcNave's phase-1 tool set: read access to the current project's already-indexed files.
 *
 * Descriptions matter more than they look like they should — the model reasons from them, not
 * the schema. Per Invariant 4, `search_project_files`'s description must say "lexical keyword
 * search" and must not claim conceptual/semantic matching, because there is none.
 */
import type { ToolDefinition } from '../providers/types.js';
import { DISPLAY_TOOL_DEFINITIONS } from './displayDefinitions.js';

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
        'Gives files to the user as file cards; a Markdown, HTML, React (.jsx), Mermaid, SVG or PDF file also ' +
        'opens beside the chat as an artifact. Use it for every file the user should get, after it is ' +
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
    'fetched: one the user gave, or one a search or fetch result in this conversation returned. A URL recalled ' +
    'from memory or made by editing a seen URL is refused. Pages behind a login ' +
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

/**
 * web_fetch on a turn whose search is the model's built-in one: those results reach the model as
 * grounded text, not as URLs the fetch gate has seen, so the description must not promise them
 * (ADR-0049).
 */
export const WEB_FETCH_WITH_BUILT_IN_SEARCH: ToolDefinition = {
  ...WEB_FETCH,
  description:
    'Fetches the readable text of a web page. Only a URL that already appears in this conversation can be ' +
    'fetched: one the user gave, or one an earlier fetch result in this conversation returned. Results of the ' +
    'built-in web search are not URLs this tool can open. A URL recalled from memory or made by editing a seen ' +
    'URL is refused. Pages behind a login cannot be read. The URL must include https://.',
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

export const VISUALIZE_MODULES = ['diagram', 'mockup', 'interactive', 'data_viz', 'art', 'chart', 'elicitation'] as const;

export const READ_ME: ToolDefinition = {
  name: 'read_me',
  description:
    'Returns what show_widget needs: the theme\'s CSS variables and colours, typography, layout rules and examples ' +
    'for a kind of visual. Call it before your first show_widget call, and again later for a different module. It ' +
    'is a setup step: do not mention or narrate it; go straight on to the visual.',
  inputSchema: {
    type: 'object',
    properties: {
      modules: {
        type: 'array',
        items: { type: 'string', enum: [...VISUALIZE_MODULES] },
        description: 'Which modules to load. Pick all that fit.',
      },
      platform: {
        type: 'string',
        enum: ['mobile', 'desktop', 'unknown'],
        description: "'mobile' when the person is on a narrow (~380px) screen, so sizes suit it; otherwise 'desktop'. Defaults to 'unknown' (desktop sizing).",
      },
    },
    additionalProperties: false,
  },
};

export const SHOW_WIDGET: ToolDefinition = {
  name: 'show_widget',
  description:
    'Shows visual content inline alongside your reply: SVG graphics and diagrams, charts, or interactive HTML ' +
    'widgets. Use it for flowcharts, architecture diagrams, dashboards, forms, calculators, data tables, games, ' +
    'illustrations or any visual. Code starting with <svg is drawn as SVG, anything else as HTML. A global ' +
    'sendPrompt(text) puts a follow-up in the person\'s message box for them to send. Call read_me before your first ' +
    'show_widget call, silently, then answer as if you went straight to the visual.',
  inputSchema: {
    type: 'object',
    properties: {
      loading_messages: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 4,
        description:
          '1 to 4 messages of about 5 words shown while the visual draws, in the person\'s language. One for a simple ' +
          'visual, more for a complex one. On a serious topic (illness, death, grief, war, disaster, trauma, abuse, ' +
          'addiction, medical decisions) keep them plain and neutral.',
      },
      title: {
        type: 'string',
        description:
          "Short snake_case name for this visual, specific enough to tell it apart from the conversation's other " +
          "visuals ('q4_revenue_by_product_line', not 'chart'). Also the download file name: no spaces or special characters.",
      },
      widget_code: {
        type: 'string',
        description:
          'The SVG or HTML to draw. SVG: raw code starting with <svg>, colours from the CSS variables. HTML: content ' +
          'only, no DOCTYPE, <html>, <head> or <body>. Use the CSS variables for theming, keep the background ' +
          'transparent and avoid top-level padding. Scripts run after the code is complete.',
      },
    },
    required: ['loading_messages', 'title', 'widget_code'],
    additionalProperties: false,
  },
};

export const UI_TOOL_DEFINITIONS: ToolDefinition[] = [READ_ME, SHOW_WIDGET, ...DISPLAY_TOOL_DEFINITIONS];

/* -------------------------------------------------------------------------- Questions */

export const ASK_USER_INPUT: ToolDefinition = {
  name: 'ask_user_input_v0',
  description:
    'Shows tappable options to learn the person\'s preferences, constraints or goals before giving advice ' +
    '(a workout plan: goal, time, equipment; a book: genre, mood). Tapping is easier than typing on a phone.\n\n' +
    'First check the conversation: if the answer is already there or can be inferred, use it. If you are about to ' +
    'write clarifying questions as prose bullets, ask them with this tool instead.\n\n' +
    'Do not use it when the person asks "A or B?" (they want your recommendation), is venting, asks for your ' +
    'opinion, asks a factual question, needs written feedback, or already gave detailed constraints (proceed and ' +
    'state any assumption inline).\n\n' +
    'Always write a short message before the options. Prefer one question; three is a ceiling, not a target; ' +
    'each with 2 to 4 short, mutually exclusive options. Calling this ends your turn: the choice arrives as the ' +
    'person\'s next message, not as a tool result, so write nothing after it.',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '1 to 3 questions to ask.',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question shown to the person.' },
            options: {
              type: 'array',
              description: '2 to 4 options with short labels.',
              minItems: 2,
              maxItems: 4,
              items: { type: 'string', description: 'Short label.' },
            },
            type: {
              type: 'string',
              enum: ['single_select', 'multi_select', 'rank_priorities'],
              description:
                "'single_select' to choose one option, 'multi_select' to choose one or more, " +
                "'rank_priorities' to drag the options into order. Defaults to single_select.",
            },
          },
          required: ['question', 'options'],
          additionalProperties: false,
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
};

export const QUESTION_TOOL_DEFINITIONS: ToolDefinition[] = [ASK_USER_INPUT];




