/**
 * Resolves which tools a request may use. The seam future phases hang permission logic off of
 * (faculty role, semester, feature flags, risk level) without `GenerationService` ever holding a
 * hardcoded tool array again. Phase 1's rule is deliberately the whole rule: enabled, and a
 * project is in scope. Project *authorization* already happened before this is called —
 * `GenerationService.loadProject` scopes by `userId`, so a `projectId` reaching here is already
 * the caller's own project.
 */
import { PROJECT_TOOL_DEFINITIONS } from './definitions.js';
import type { ToolDefinition } from '../providers/types.js';

export interface ToolContext {
  projectId: string | null;
}

export interface ToolRegistry {
  getAvailableTools(context: ToolContext): ToolDefinition[];
}

export class ProjectToolRegistry implements ToolRegistry {
  constructor(private readonly enabled: boolean) {}

  getAvailableTools(context: ToolContext): ToolDefinition[] {
    if (!this.enabled || context.projectId === null) return [];
    return PROJECT_TOOL_DEFINITIONS;
  }
}
