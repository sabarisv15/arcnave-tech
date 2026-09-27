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
  DISCOVERY_TOOL_DEFINITIONS,
  LIST_SKILLS,
  LOAD_SKILL,
  MEMORY_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  READ_ARTIFACT,
  READ_PROJECT_FILE,
  READ_SKILL,
  RENDER_UI,
  RUN_PYTHON,
  RUN_PYTHON_WARM,
  SEARCH_MEMORY,
  SAVE_MEMORY,
  SEARCH_CHATS,
  READ_MEMORY,
  UPDATE_MEMORY,
  FORGET_MEMORY,
  SEARCH_PROJECT_FILES,
  SEARCH_SKILLS,
  SEARCH_TOOLS,
  SKILL_TOOL_DEFINITIONS,
  UI_TOOL_DEFINITIONS,
  UPDATE_ARTIFACT,
  WEB_FETCH,
  WEB_SEARCH,
  WEB_TOOL_DEFINITIONS,
  ASK_USER_OPTIONS,
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
  /** The definition when it depends on configuration (run_python's engine); else `definition`. */
  definitionFor?: (cfg: Config) => ToolDefinition;
  /** Whether this tool should be in the initial core set (Round 0) or deferred until discovered */
  isInitialCore: boolean;
  /** Whether the feature flag / infrastructure allows this tool */
  isFeatureEnabled: (cfg: Config, flags: ToolFeatureFlags) => boolean;
  /** Whether this request/turn authorization allows this tool */
  isAuthorized: (context: ToolContext) => boolean;
}

/** Whether run_python runs on the warm sandbox service (ADR-0010), mirroring container.ts. */
/**
 * Whether run_python can open Office files (xlrd, python-docx, python-pptx, pandoc): the warm
 * service image has them (Dockerfile.service); the single-use Cloud Run Job image does not
 * (sandbox/Dockerfile). The process engine is local development, expected to mirror the warm
 * image. Office text is kept inline when this is false (ADR-0045).
 */
export function sandboxReadsOfficeFiles(cfg: Config): boolean {
  return usesWarmSandbox(cfg) || cfg.SANDBOX_ENGINE === 'process';
}

export function usesWarmSandbox(cfg: Config): boolean {
  return cfg.SANDBOX_ENGINE === 'warm' || (cfg.SANDBOX_ENGINE === 'auto' && Boolean(cfg.SANDBOX_SERVICE_URL));
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
    keywords: ['skill', 'load skill', 'instructions', 'domain guide', 'pdf', 'pdf-reading', 'xlsx', 'docx', 'pptx'],
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

  // 3. Computation (DEFERRED: discovered via search_tools)
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
    definitionFor: (cfg) => (usesWarmSandbox(cfg) ? RUN_PYTHON_WARM : RUN_PYTHON),
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.runPythonEnabled),
    isAuthorized: (ctx) => ctx.allowPython === true,
  },

  // 4. Web Tools (DEFERRED: discovered via search_tools)
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

  // 5. Artifact Tools (DEFERRED: discovered via search_tools)
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

  // 6. Project Tools (DEFERRED: discovered via search_tools)
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

  // 7. Generative UI & Interactive Options
  {
    name: 'render_ui',
    category: 'ui',
    shortDescription: 'Renders structured, interactive UI layouts, charts, and metric cards in chat.',
    keywords: ['render ui', 'ui', 'dashboard', 'interactive card', 'chart', 'kpi'],
    definition: RENDER_UI,
    isInitialCore: true,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.generativeUiEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'ask_user_options',
    category: 'ui',
    shortDescription: 'Shows clickable question options (single, multi, rank) for the user to choose from.',
    keywords: ['ask', 'options', 'question', 'choice', 'clarify', 'single', 'multi', 'rank'],
    definition: ASK_USER_OPTIONS,
    isInitialCore: true,
    isFeatureEnabled: (cfg) => cfg.ENABLE_TOOL_USE,
    isAuthorized: () => true,
  },

  // 8. Persistent Memory (DEFERRED: discovered via search_tools)
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
  {
    name: 'save_memory',
    category: 'memory',
    shortDescription: 'Saves something about the user to memory under a topic.',
    keywords: ['save memory', 'remember', 'memory', 'note this'],
    definition: SAVE_MEMORY,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.memoryEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'search_chats',
    category: 'memory',
    shortDescription: 'Searches the user\'s earlier conversations.',
    keywords: ['search chats', 'past conversation', 'earlier chat', 'we discussed', 'history'],
    definition: SEARCH_CHATS,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.memoryEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'read_memory',
    category: 'memory',
    shortDescription: 'Reads one memory item in full by its id.',
    keywords: ['read memory', 'memory'],
    definition: READ_MEMORY,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.memoryEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'update_memory',
    category: 'memory',
    shortDescription: 'Updates an existing memory item by its id and version.',
    keywords: ['update memory', 'edit memory', 'memory'],
    definition: UPDATE_MEMORY,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.memoryEnabled),
    isAuthorized: () => true,
  },
  {
    name: 'forget_memory',
    category: 'memory',
    shortDescription: 'Removes a memory topic.',
    keywords: ['forget', 'forget memory', 'delete memory', 'memory'],
    definition: FORGET_MEMORY,
    isInitialCore: false,
    isFeatureEnabled: (cfg, flags) => Boolean(cfg.ENABLE_TOOL_USE && flags.memoryEnabled),
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
  ).map((e) => e.definitionFor?.(cfg) ?? e.definition);
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
  }).map((e) => e.definitionFor?.(cfg) ?? e.definition);
}
