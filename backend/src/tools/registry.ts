/**
 * Resolves which tools a request may use. Every allowed tool is declared on every turn, with no
 * discovery step (ADR-0047): the reference assistant declares its own tools up front and keeps
 * search for connector tools, which ArcNave does not have. Project *authorization* already
 * happened before this is called — `GenerationService.loadProject` scopes by `userId`, so a
 * `projectId` reaching here is already the caller's own project.
 */
import {
  CHAT_TOOL_DEFINITIONS,
  MEMORY_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  QUESTION_TOOL_DEFINITIONS,
  UI_TOOL_DEFINITIONS,
  WEB_TOOL_DEFINITIONS,
  codeToolDefinitions,
} from './definitions.js';
import type { ToolDefinition } from '../providers/types.js';

export interface ToolContext {
  userId?: string;
  projectId: string | null;
  /** Per-turn authorization. Infrastructure availability alone never exposes code execution. */
  allowCode?: boolean;
}

export interface ToolRegistryFlags {
  /** A sandbox engine is configured (ENABLE_RUN_PYTHON and a client). */
  codeEnabled?: boolean;
  /** The engine keeps a chat's files between calls (the warm service). */
  persistentSandbox?: boolean;
  webEnabled?: boolean;
  /** Memory, and the past-chat tools with it. */
  memoryEnabled?: boolean;
  /** show_widget, read_me and the display cards. */
  generativeUiEnabled?: boolean;
}

export interface ToolRegistry {
  getAvailableTools(context: ToolContext): ToolDefinition[];
}

export class ProjectToolRegistry implements ToolRegistry {
  constructor(
    private readonly enabled: boolean,
    private readonly flags: ToolRegistryFlags = {},
  ) {}

  getAvailableTools(context: ToolContext): ToolDefinition[] {
    if (!this.enabled) return [];
    const tools: ToolDefinition[] = [...QUESTION_TOOL_DEFINITIONS];
    if (this.flags.memoryEnabled) tools.push(...MEMORY_TOOL_DEFINITIONS, ...CHAT_TOOL_DEFINITIONS);
    if (this.flags.generativeUiEnabled) tools.push(...UI_TOOL_DEFINITIONS);
    if (this.flags.webEnabled) tools.push(...WEB_TOOL_DEFINITIONS);
    // Code execution is visible only when both the deployment and this turn allow it.
    if (this.flags.codeEnabled && context.allowCode === true) {
      tools.push(...codeToolDefinitions(Boolean(this.flags.persistentSandbox)));
    }
    if (context.projectId !== null) tools.push(...PROJECT_TOOL_DEFINITIONS);
    return tools;
  }
}
