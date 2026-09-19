/**
 * Resolves which tools a request may use. The seam future phases hang permission logic off of
 * (faculty role, semester, feature flags, risk level) without `GenerationService` ever holding a
 * hardcoded tool array again. Phase 1's rule is deliberately the whole rule: enabled, and a
 * project is in scope. Project *authorization* already happened before this is called —
 * `GenerationService.loadProject` scopes by `userId`, so a `projectId` reaching here is already
 * the caller's own project.
 */
import { PROJECT_TOOL_DEFINITIONS, RUN_PYTHON } from './definitions.js';
import type { ToolDefinition } from '../providers/types.js';

export interface ToolContext {
  projectId: string | null;
}

export interface ToolRegistry {
  getAvailableTools(context: ToolContext): ToolDefinition[];
}

export class ProjectToolRegistry implements ToolRegistry {
  constructor(
    private readonly enabled: boolean,
    /** Item 9 phase 2's own gate, independent of `enabled` — arbitrary code execution is a
     *  materially larger blast radius than read-only project-file search, so it must be
     *  independently toggleable even when the rest of the tool set is on. */
    private readonly runPythonEnabled: boolean = false,
  ) {}

  getAvailableTools(context: ToolContext): ToolDefinition[] {
    if (!this.enabled || context.projectId === null) return [];
    return this.runPythonEnabled ? [...PROJECT_TOOL_DEFINITIONS, RUN_PYTHON] : PROJECT_TOOL_DEFINITIONS;
  }
}
