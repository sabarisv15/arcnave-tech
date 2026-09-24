/**
 * Tool Catalog: Unified policy-approved metadata and definition repository for ArcNave.
 *
 * Implements Batch 1 of the ArcNave Target Architecture:
 * - Single source of truth for tool metadata (name, description, category, schema, keywords).
 * - Distinguishes small initial core tools (sent in Round 0) from deferred tools.
 * - Dynamic discovery: search_tools searches this policy-approved catalog.
 * - Discovered tools are dynamically injected into active provider schemas for subsequent rounds.
 */

import type { Config } from '../config.js';
import type { ToolDefinition } from '../providers/types.js';
import {
  CREATE_ARTIFACT,
  DELIVERABLE_TOOL_DEFINITIONS,
  DISCOVERY_TOOL_DEFINITIONS,
  GENERATE_DELIVERABLE,
  GENERATE_IMAGE,
  GET_CONTEXT_REMAINING,
  GET_GOAL,
  GOAL_TOOL_DEFINITIONS,
  IMAGE_TOOL_DEFINITIONS,
  LIST_SKILLS,
  LOAD_SKILL,
  MEMORY_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  READ_ARTIFACT,
  READ_PROJECT_FILE,
  READ_SKILL,
  READ_UPLOADED_FILE,
  RENDER_UI,
  RUN_PYTHON,
  EXTRACT_SCANNED_TABLE_ROWS,
  ANALYZE_TABLE_ROWS,
  SEARCH_MEMORY,
  SEARCH_PROJECT_FILES,
  SEARCH_SKILLS,
  SEARCH_TOOLS,
  SKILL_TOOL_DEFINITIONS,
  UI_TOOL_DEFINITIONS,
  UPDATE_ARTIFACT,
  UPDATE_GOAL,
  UPLOAD_TOOL_DEFINITIONS,
  WEB_FETCH,
  WEB_SEARCH,
  WEB_TOOL_DEFINITIONS,
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
} from './definitions.js';
import type { ToolContext } from './registry.js';

export type ToolCategory =
  | 'discovery'
  | 'computation'
  | 'files'
  | 'deliverable'
  | 'image'
  | 'web'
  | 'artifacts'
  | 'project'
  | 'memory'
  | 'ui'
  | 'agent'
  | 'skills';

export interface ToolFeatureFlags {
  runPythonEnabled?: boolean;
  skillsEnabled?: boolean;
  webEnabled?: boolean;
  memoryEnabled?: boolean;
  generativeUiEnabled?: boolean;
  imageEnabled?: boolean;
  agentLoopEnabled?: boolean;
}

export interface ToolCatalogEntry {
  name: string;
  category: ToolCategory;
  shortDescription: string;
  keywords: string[];
  definition: ToolDefinition;
  /** Whether this tool should be in the initial core set (Round 0) or deferred until discovered */
  isInitialCore: boolean;
  /** Whether the feature flag / infrastructure allows this tool */
  isFeatureEnabled: (cfg: Config, flags: ToolFeatureFlags) => boolean;
  /** Whether this request/turn authorization allows this tool */
  isAuthorized: (context: ToolContext) => boolean;
}

export const TOOL_CATALOG_ENTRIES: ToolCatalogEntry[] = [
  // 1. Discovery (Always in initial core set)
  {
    name: 'search_tools',
    category: 'discovery',
    shortDescription: 'Searches the policy-approved catalog of executable tools available in this workspace.',
    keywords: ['search', 'tools', 'catalog', 'find tools', 'discovery', 'capabilities', 'help'],
    definition: SEARCH_TOOLS,
    isInitialCore: true,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },

  // 2. Skills: load_skill is lightweight entry point in initial set when skills are enabled
  {
    name: 'load_skill',
    category: 'skills',
    shortDescription: 'Loads domain-specific instructions (SKILL.md) and resources into context.',
    keywords: ['skill', 'load skill', 'instructions', 'domain guide', 'pdf', 'xlsx', 'docx', 'pptx', 'data-analysis'],
    definition: LOAD_SKILL,
    isInitialCore: true,
    isFeatureEnabled: (_cfg, flags) => Boolean(flags.skillsEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'list_skills',
    category: 'skills',
    shortDescription: 'Lists available specialized skills with summaries.',
    keywords: ['skills', 'list skills', 'browse skills'],
    definition: LIST_SKILLS,
    isInitialCore: false,
    isFeatureEnabled: (_cfg, flags) => Boolean(flags.skillsEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'search_skills',
    category: 'skills',
    shortDescription: 'Searches available skills by keywords.',
    keywords: ['skills', 'search skills', 'find skills'],
    definition: SEARCH_SKILLS,
    isInitialCore: false,
    isFeatureEnabled: (_cfg, flags) => Boolean(flags.skillsEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'read_skill',
    category: 'skills',
    shortDescription: 'Reads complete expert instructions for a specified skill.',
    keywords: ['skill', 'read skill', 'skill instructions'],
    definition: READ_SKILL,
    isInitialCore: false,
    isFeatureEnabled: (_cfg, flags) => Boolean(flags.skillsEnabled),
    isAuthorized: () => true,
  },

  // 3. Agent Goal Tools (Initial core set ONLY in AgentLoop mode with an active goal)
  {
    name: 'get_goal',
    category: 'agent',
    shortDescription: 'Reads the active goal, budget, and checkpoint notes.',
    keywords: ['goal', 'get goal', 'status', 'budget', 'checkpoint'],
    definition: GET_GOAL,
    isInitialCore: true,
    isFeatureEnabled: (_cfg, flags) => Boolean(flags.agentLoopEnabled),
    isAuthorized: (ctx) => Boolean(ctx.activeGoalId),
  },
  {
    name: 'update_goal',
    category: 'agent',
    shortDescription: 'Updates active goal status or records progress notes.',
    keywords: ['goal', 'update goal', 'complete', 'progress note'],
    definition: UPDATE_GOAL,
    isInitialCore: true,
    isFeatureEnabled: (_cfg, flags) => Boolean(flags.agentLoopEnabled),
    isAuthorized: (ctx) => Boolean(ctx.activeGoalId),
  },
  {
    name: 'get_context_remaining',
    category: 'agent',
    shortDescription: 'Returns context window limit and remaining tokens.',
    keywords: ['context', 'tokens', 'headroom', 'tokens remaining'],
    definition: GET_CONTEXT_REMAINING,
    isInitialCore: true,
    isFeatureEnabled: (_cfg, flags) => Boolean(flags.agentLoopEnabled),
    isAuthorized: (ctx) => Boolean(ctx.activeGoalId),
  },

  // 4. Computation (DEFERRED: discovered via search_tools)
  {
    name: 'run_python',
    category: 'computation',
    shortDescription: 'Runs Python code in an isolated sandbox for computation, data analysis, and statistics.',
    keywords: [
      'python',
      'code',
      'calculate',
      'compute',
      'simulate',
      'regression',
      'data analysis',
      'pandas',
      'numpy',
      'statistics',
      'math',
      'script',
      'numerical',
    ],
    definition: RUN_PYTHON,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.runPythonEnabled),
    isAuthorized: (ctx) => ctx.allowPython === true,
  },

  // 4b. Exact table extraction (DEFERRED). Permission: trusted CLI + skill scripts + vision.
  {
    name: 'extract_scanned_table_rows',
    category: 'files',
    shortDescription: 'Extracts every table row from PDF pages, scanned or digital, with page and confidence per row.',
    keywords: [
      'table', 'rows', 'extract', 'scanned', 'ocr', 'pdf', 'statement', 'transactions', 'count', 'exact',
      'every row', 'ledger', 'register', 'invoice', 'attendance', 'marksheet',
    ],
    definition: EXTRACT_SCANNED_TABLE_ROWS,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'analyze_table_rows',
    category: 'computation',
    shortDescription: 'Counts, sums and reconciles extracted table rows deterministically.',
    keywords: ['count', 'sum', 'total', 'reconcile', 'balance', 'verify', 'rows', 'table', 'exact', 'classify'],
    definition: ANALYZE_TABLE_ROWS,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },

  // 5. Deliverable Export (DEFERRED: discovered via search_tools)
  {
    name: 'generate_deliverable',
    category: 'deliverable',
    shortDescription: 'Generates and exports office deliverables (.xlsx, .docx, .pptx, .pdf).',
    keywords: [
      'excel',
      'spreadsheet',
      'xlsx',
      'sheet',
      'workbook',
      'word',
      'doc',
      'docx',
      'document',
      'powerpoint',
      'presentation',
      'pptx',
      'slides',
      'deck',
      'pdf',
      'deliverable',
      'export',
      'download',
      'table',
      'convert',
      'report',
    ],
    definition: GENERATE_DELIVERABLE,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: (ctx) => ctx.allowDeliverable !== false,
  },

  // 6. Upload File Reading (DEFERRED: discovered via search_tools)
  {
    name: 'read_uploaded_file',
    category: 'files',
    shortDescription: 'Reads content from uploaded conversation attachments by fileId with page/char slicing.',
    keywords: ['read file', 'file', 'attachment', 'upload', 'uploaded', 'pdf', 'inspect file', 'source file'],
    definition: READ_UPLOADED_FILE,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },

  // 7. Web Tools (DEFERRED: discovered via search_tools)
  {
    name: 'web_search',
    category: 'web',
    shortDescription: 'Searches the public web for real-time information or factual sources.',
    keywords: ['web search', 'search', 'web', 'internet', 'google', 'look up', 'online', 'news', 'current events', 'research'],
    definition: WEB_SEARCH,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.webEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'web_fetch',
    category: 'web',
    shortDescription: 'Fetches and extracts readable text from public HTTP/HTTPS URLs.',
    keywords: ['web fetch', 'fetch', 'url', 'http', 'https', 'website', 'webpage', 'read url', 'open link', 'page content'],
    definition: WEB_FETCH,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.webEnabled),
    isAuthorized: () => true,
  },

  // 8. Image Generation (DEFERRED: discovered via search_tools)
  {
    name: 'generate_image',
    category: 'image',
    shortDescription: 'Generates or edits visual images using image models.',
    keywords: ['image', 'picture', 'photo', 'illustration', 'draw', 'generate image', 'render image', 'visual', 'diagram', 'artwork'],
    definition: GENERATE_IMAGE,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.imageEnabled),
    isAuthorized: () => true,
  },

  // 9. Artifact Tools (DEFERRED: discovered via search_tools)
  {
    name: 'create_artifact',
    category: 'artifacts',
    shortDescription: 'Creates a new standalone editable artifact in the workspace.',
    keywords: ['create artifact', 'artifact', 'document draft', 'reusable content', 'write report'],
    definition: CREATE_ARTIFACT,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'read_artifact',
    category: 'artifacts',
    shortDescription: 'Reads latest version and content of an existing artifact.',
    keywords: ['read artifact', 'artifact', 'inspect artifact'],
    definition: READ_ARTIFACT,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'update_artifact',
    category: 'artifacts',
    shortDescription: 'Appends a new version to an existing artifact.',
    keywords: ['update artifact', 'modify artifact', 'edit artifact'],
    definition: UPDATE_ARTIFACT,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },

  // 10. Project Tools (DEFERRED: discovered via search_tools)
  {
    name: 'search_project_files',
    category: 'project',
    shortDescription: 'Lexical search over current project files.',
    keywords: ['search project', 'project files', 'repo', 'knowledge base', 'project search'],
    definition: SEARCH_PROJECT_FILES,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: (ctx) => Boolean(ctx.projectId),
  },
  {
    name: 'read_project_file',
    category: 'project',
    shortDescription: 'Reads indexed text of one project file by fileId.',
    keywords: ['read project file', 'project file', 'inspect project file'],
    definition: READ_PROJECT_FILE,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: (ctx) => Boolean(ctx.projectId),
  },

  // 11. Generative UI (DEFERRED: discovered via search_tools)
  {
    name: 'render_ui',
    category: 'ui',
    shortDescription: 'Renders structured, interactive UI layouts, charts, and metric cards in chat.',
    keywords: ['render ui', 'ui', 'dashboard', 'interactive card', 'chart', 'kpi'],
    definition: RENDER_UI,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.generativeUiEnabled),
    isAuthorized: () => true,
  },

  // 12. Persistent Memory (DEFERRED: discovered via search_tools)
  {
    name: 'search_memory',
    category: 'memory',
    shortDescription: 'Searches persistent memory across past conversations.',
    keywords: ['search memory', 'memory', 'remember', 'recall preferences'],
    definition: SEARCH_MEMORY,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.memoryEnabled),
    isAuthorized: () => true,
  },

  // 13. File Operations (DEFERRED: discovered via search_tools)
  // PDF
  {
    name: 'inspectPdf',
    category: 'files',
    shortDescription: 'Inspects a PDF document to extract structural properties, page count, and metadata.',
    keywords: ['pdf', 'inspect pdf', 'pdf metadata', 'pdf page count', 'read pdf', 'pdf properties', 'inspectPdf'],
    definition: INSPECT_PDF,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'mergePdfFiles',
    category: 'files',
    shortDescription: 'Deterministically merges two or more PDF files into a single consolidated PDF document.',
    keywords: ['pdf', 'merge pdf', 'combine pdf', 'join pdf', 'concatenate pdf', 'pdf merge', 'mergePdfFiles'],
    definition: MERGE_PDF_FILES,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'splitPdfFile',
    category: 'files',
    shortDescription: 'Extracts specific page ranges from an uploaded PDF into one or more separate PDF files.',
    keywords: ['pdf', 'split pdf', 'extract pdf pages', 'slice pdf', 'pdf pages', 'pdf split', 'splitPdfFile'],
    definition: SPLIT_PDF_FILE,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },

  // XLSX
  {
    name: 'inspectSpreadsheet',
    category: 'files',
    shortDescription: 'Inspects an Excel spreadsheet (.xlsx) to discover sheet names, row counts, and sample cell types.',
    keywords: ['xlsx', 'excel', 'spreadsheet', 'inspect spreadsheet', 'sheet names', 'row count', 'inspect excel', 'workbook', 'inspectSpreadsheet'],
    definition: INSPECT_SPREADSHEET,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'editSpreadsheetCells',
    category: 'files',
    shortDescription: 'Performs targeted cell updates in an existing Excel (.xlsx) workbook preserving all styles and formulas.',
    keywords: ['xlsx', 'excel', 'spreadsheet', 'edit cells', 'update cells', 'modify spreadsheet', 'excel formula', 'edit spreadsheet', 'editSpreadsheetCells'],
    definition: EDIT_SPREADSHEET_CELLS,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'combineWorkbooks',
    category: 'files',
    shortDescription: 'Combines sheets from two or more Excel workbooks into a single consolidated workbook.',
    keywords: ['xlsx', 'excel', 'spreadsheet', 'combine workbooks', 'merge excel', 'combine spreadsheets', 'consolidate workbooks', 'combineWorkbooks'],
    definition: COMBINE_WORKBOOKS,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },

  // DOCX
  {
    name: 'inspectDocxStructure',
    category: 'files',
    shortDescription: 'Inspects a Word document (.docx) to extract paragraph counts, table counts, and section headings.',
    keywords: ['docx', 'word', 'document', 'inspect docx', 'docx structure', 'headings', 'paragraphs', 'word document', 'inspectDocxStructure'],
    definition: INSPECT_DOCX_STRUCTURE,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'editDocxContent',
    category: 'files',
    shortDescription: 'Performs targeted search-and-replace text modifications inside an existing Word document (.docx).',
    keywords: ['docx', 'word', 'document', 'edit docx', 'replace text', 'word edit', 'search replace docx', 'modify document', 'editDocxContent'],
    definition: EDIT_DOCX_CONTENT,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'appendDocxSection',
    category: 'files',
    shortDescription: 'Appends a new titled section and paragraphs to an existing Word document (.docx).',
    keywords: ['docx', 'word', 'document', 'append section', 'add section', 'append docx', 'add paragraphs', 'expand document', 'appendDocxSection'],
    definition: APPEND_DOCX_SECTION,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },

  // PPTX
  {
    name: 'inspectPptxStructure',
    category: 'files',
    shortDescription: 'Inspects a PowerPoint presentation (.pptx) to extract slide count and slide titles.',
    keywords: ['pptx', 'powerpoint', 'presentation', 'slides', 'inspect pptx', 'slide count', 'slide titles', 'deck', 'inspectPptxStructure'],
    definition: INSPECT_PPTX_STRUCTURE,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'reorderPptxSlides',
    category: 'files',
    shortDescription: 'Reorders slides in an existing PowerPoint presentation (.pptx) preserving all formatting.',
    keywords: ['pptx', 'powerpoint', 'presentation', 'slides', 'reorder slides', 'slide sequence', 'reorder pptx', 'deck', 'reorderPptxSlides'],
    definition: REORDER_PPTX_SLIDES,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
  {
    name: 'editPptxSlideText',
    category: 'files',
    shortDescription: 'Performs targeted text replacements on a specific slide in an existing PowerPoint presentation (.pptx).',
    keywords: ['pptx', 'powerpoint', 'presentation', 'slides', 'edit slide', 'replace slide text', 'slide text', 'modify slide', 'editPptxSlideText'],
    definition: EDIT_PPTX_SLIDE_TEXT,
    isInitialCore: false,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },
];

/**
 * Returns the small core tool set to send in the initial provider request (Round 0).
 */
export function getInitialCoreTools(
  cfg: Config,
  flags: ToolFeatureFlags,
  context: ToolContext,
): ToolDefinition[] {
  if (!cfg.ENABLE_TOOL_USE) return [];

  return TOOL_CATALOG_ENTRIES.filter(
    (e) => e.isInitialCore && e.isFeatureEnabled(cfg, flags) && e.isAuthorized(context),
  ).map((e) => e.definition);
}

/**
 * Returns the complete policy-approved catalog of tools that search_tools can discover.
 */
export function getDeferredPolicyCatalog(
  cfg: Config,
  flags: ToolFeatureFlags,
  context: ToolContext,
  allowedToolNames?: string[],
): ToolDefinition[] {
  if (!cfg.ENABLE_TOOL_USE) return [];

  return TOOL_CATALOG_ENTRIES.filter((e) => {
    if (!e.isFeatureEnabled(cfg, flags) || !e.isAuthorized(context)) return false;
    if (allowedToolNames && !allowedToolNames.includes(e.name)) return false;
    return true;
  }).map((e) => e.definition);
}
