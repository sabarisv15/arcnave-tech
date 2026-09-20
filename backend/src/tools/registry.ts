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
  GOAL_TOOL_DEFINITIONS,
  MEMORY_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  RUN_PYTHON,
  SKILL_TOOL_DEFINITIONS,
  UPLOAD_TOOL_DEFINITIONS,
  WEB_TOOL_DEFINITIONS,
} from './definitions.js';
import type { ToolDefinition } from '../providers/types.js';

export interface ToolContext {
  userId?: string;
  projectId: string | null;
  activeGoalId?: string | null;
}

export interface ToolRegistry {
  getAvailableTools(context: ToolContext): ToolDefinition[];
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
  ) {}

  getAvailableTools(context: ToolContext): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    if (this.enabled) {
      // Artifact tools (create, read, update) are available across all chats when tool use is on.
      tools.push(...ARTIFACT_TOOL_DEFINITIONS);

      // Upload file reading is available across all chats when tool use is on.
      tools.push(...UPLOAD_TOOL_DEFINITIONS);

      // Persistent memory tools are available across all chats when memory is enabled
      if (this.memoryEnabled) {
        tools.push(...MEMORY_TOOL_DEFINITIONS);
      }

      // Web search and fetch when webEnabled is true
      if (this.webEnabled) {
        tools.push(...WEB_TOOL_DEFINITIONS);
      }

      // run_python is available in all chats when runPythonEnabled is true
      if (this.runPythonEnabled) {
        tools.push(RUN_PYTHON);
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
