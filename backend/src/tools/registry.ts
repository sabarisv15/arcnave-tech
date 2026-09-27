/**
 * Resolves which tools a request may use. The seam future phases hang permission logic off of
 * (faculty role, semester, feature flags, risk level) without `GenerationService` ever holding a
 * hardcoded tool array again. Phase 1's rule is deliberately the whole rule: enabled, and a
 * project is in scope. Project *authorization* already happened before this is called —
 * `GenerationService.loadProject` scopes by `userId`, so a `projectId` reaching here is already
 * the caller's own project.
 */
import {
  ARTIFACT_TOOL_DEFINITIONS,
  DISCOVERY_TOOL_DEFINITIONS,
  GENERATE_DELIVERABLE,
  GOAL_TOOL_DEFINITIONS,
  IMAGE_TOOL_DEFINITIONS,
  LOAD_SKILL,
  MEMORY_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  RUN_PYTHON,
  SKILL_TOOL_DEFINITIONS,
  TABLE_EXTRACTION_TOOL_DEFINITIONS,
  UI_TOOL_DEFINITIONS,
  UPLOAD_TOOL_DEFINITIONS,
  WEB_TOOL_DEFINITIONS,
  FILE_OPERATION_TOOL_DEFINITIONS,
  QUESTION_TOOL_DEFINITIONS,
} from './definitions.js';
import type { ToolDefinition } from '../providers/types.js';
import { NEXT_ACTIONS } from './nextActions.js';

/**
 * Allowed tools declared on every turn, beside search_tools and load_skill, so the model can call
 * them without searching first: the most frequently used tools stay non-deferred. These are the ones file
 * work needs on nearly every turn; the rest stay discoverable (ADR-0006, amended by ADR-0022).
 */
export const DECLARED_EVERY_TURN: readonly string[] = [
  'ask_user_options',
  'render_ui',
  'suggest_next_actions',
  'run_python',
  'read_uploaded_file',
  'generate_deliverable',
  // Memory is saved as the user chats, without being asked (ADR-0025): the tool must be in hand.
  'save_memory',
  'forget_memory',
  // Past chats are searched when the user refers to one, shown as a tool call.
  'search_chats',
  // A project past the whole-file limit is read through search (ADR-0020): the tools must be in hand, not discovered first.
  'search_project_files',
  'read_project_file',
];

/** Declared beside DECLARED_EVERY_TURN when the conversation holds a file (ADR-0046). */
export const DECLARED_WITH_ATTACHMENTS: readonly string[] = ['extract_scanned_table_rows', 'analyze_table_rows'];

export interface ToolContext {
  userId?: string;
  projectId: string | null;
  activeGoalId?: string | null;
  /** Per-turn authorization. Infrastructure availability alone never exposes code execution. */
  allowPython?: boolean;
  /** Exposes generate_deliverable tool for document, spreadsheet, slide, and PDF requests */
  allowDeliverable?: boolean;
}

export interface ToolRegistry {
  getAvailableTools(context: ToolContext): ToolDefinition[];
  getInitialTools?(context: ToolContext): ToolDefinition[];
  getPolicyCatalog?(context: ToolContext, allowedToolNames?: string[]): ToolDefinition[];
}

export class ProjectToolRegistry implements ToolRegistry {
  constructor(
    private readonly enabled: boolean,
    /** Arbitrary code execution gate. Decoupled from projectId requirement per Phase 5. */
    private readonly runPythonEnabled: boolean = false,
    /** Item 10 agent loop gate — exposes goal bookkeeping tools (get_goal, update_goal,
     *  get_context_remaining) when an active goal exists. */
    private readonly agentLoopEnabled: boolean = false,
    /** Item 11 skills gate — exposes skill discovery and lazy-loading tools (list_skills,
     *  search_skills, read_skill). */
    private readonly skillsEnabled: boolean = false,
    /** Phase 2 web gate — exposes web_search and web_fetch tools. */
    private readonly webEnabled: boolean = false,
    /** Phase 5 memory gate — exposes persistent memory tools (search_memory, read_memory,
     *  update_memory, forget_memory) in both chat and agent modes. */
    private readonly memoryEnabled: boolean = false,
    /** Phase 6 Generative UI gate — exposes render_ui tool across all chats. */
    private readonly generativeUiEnabled: boolean = false,
    /** Modern Gemini Image gate — exposes generate_image across all chats. */
    private readonly imageEnabled: boolean = false,
    /** Phase 3 table extraction: trusted CLI + skill scripts + a vision provider all present. */
    private readonly tableExtractionEnabled: boolean = false,
    /** run_python as the configured engine runs it (RUN_PYTHON_WARM on the warm service), so
     *  the description matches what the sandbox actually keeps between calls. */
    private readonly runPythonDefinition: ToolDefinition = RUN_PYTHON,
  ) {}

  /**
   * Returns the small initial core tool set sent in Round 0 of provider requests.
   * Only search_tools (plus load_skill if skills enabled; plus goal tools if in AgentLoop with active goal).
   * Heavy tools (run_python, generate_deliverable, web_search, read_uploaded_file, etc.) are NOT included.
   */
  getInitialTools(context: ToolContext): ToolDefinition[] {
    if (!this.enabled) return [];
    const tools: ToolDefinition[] = [...DISCOVERY_TOOL_DEFINITIONS];
    if (this.skillsEnabled) {
      tools.push(LOAD_SKILL);
    }
    if (this.agentLoopEnabled && context.activeGoalId) {
      tools.push(...GOAL_TOOL_DEFINITIONS);
    }
    tools.push(...this.getAvailableTools(context).filter((t) => DECLARED_EVERY_TURN.includes(t.name)));
    return tools;
  }

  /**
   * Returns the complete policy-approved catalog of executable tools that can be discovered
   * on-demand via search_tools for the current context and permissions.
   */
  getPolicyCatalog(context: ToolContext, allowedToolNames?: string[]): ToolDefinition[] {
    if (!this.enabled) return [];
    const available = [...this.getAvailableTools(context), ...FILE_OPERATION_TOOL_DEFINITIONS];
    if (allowedToolNames) {
      return available.filter((t) => allowedToolNames.includes(t.name));
    }
    return available;
  }

  getAvailableTools(context: ToolContext): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    if (this.enabled) {
      tools.push(NEXT_ACTIONS);
      // Artifact tools (create, read, update) are available across all chats when tool use is on.
      tools.push(...ARTIFACT_TOOL_DEFINITIONS);

      // Question options tool across all chats when tool use is on (ADR-0034).
      tools.push(...QUESTION_TOOL_DEFINITIONS);

      // Upload file reading is available across all chats when tool use is on.
      tools.push(...UPLOAD_TOOL_DEFINITIONS);

      // Deliverable generation (Mode A markdown or Mode B source extraction for XLSX/DOCX/PPTX/PDF)
      if (context.allowDeliverable === true) {
        tools.push(GENERATE_DELIVERABLE);
      }

      // Image generation via Gemini Image hierarchy
      if (this.imageEnabled) {
        tools.push(...IMAGE_TOOL_DEFINITIONS);
      }

      // Persistent memory tools are available across all chats when memory is enabled
      if (this.memoryEnabled) {
        tools.push(...MEMORY_TOOL_DEFINITIONS);
      }

      // Generative UI tool (render_ui) when generativeUiEnabled is true
      if (this.generativeUiEnabled) {
        tools.push(...UI_TOOL_DEFINITIONS);
      }

      // Web search and fetch when webEnabled is true
      if (this.webEnabled) {
        tools.push(...WEB_TOOL_DEFINITIONS);
      }

      // Code execution is high-cost and high-latency. It is visible only when both the
      // deployment and the current request's deterministic capability policy allow it.
      if (this.runPythonEnabled && context.allowPython === true) {
        tools.push(this.runPythonDefinition);
      }

      if (this.tableExtractionEnabled) {
        tools.push(...TABLE_EXTRACTION_TOOL_DEFINITIONS);
      }

      // Project knowledge tools require an active project
      if (context.projectId !== null) {
        tools.push(...PROJECT_TOOL_DEFINITIONS);
      }
    }
    if (this.agentLoopEnabled && context.activeGoalId) {
      tools.push(...GOAL_TOOL_DEFINITIONS);
    }
    if (this.skillsEnabled) {
      tools.push(...SKILL_TOOL_DEFINITIONS);
    }
    return tools;
  }
}
