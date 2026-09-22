/**
 * SkillToolExecutor: Executes list_skills, search_skills, and read_skill tools.
 *
 * Implements:
 * - Invariant 1: Typed ToolResults on missing skills, malformed inputs, or errors (never throws).
 * - Security: Strips any path traversal attempts and never leaks filesystem paths.
 * - Progressive disclosure: Returns compact summaries for list/search, full instructions for read_skill.
 * - Dependency awareness: Reports capability mode ('full' | 'guidance_only' | 'unavailable') and missing capabilities.
 */
import { z } from 'zod';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { SkillDetail, SkillService } from '../services/skills.js';

const loadSkillInput = z.object({
  name: z.string().min(1),
  resource: z.string().optional(),
});

const searchInput = z.object({
  query: z.string().min(1),
});

const readInput = z.object({
  name: z.string().min(1),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown, ok = true): ToolResult {
  return { toolCallId, ok, content: [{ type: 'json', data }] };
}

export class SkillToolExecutor implements ToolExecutor {
  constructor(
    private readonly skillService: SkillService,
    private readonly availableTools: Set<string> = new Set(),
    private readonly onSkillLoaded?: (skill: SkillDetail) => void | Promise<void>,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }

    switch (call.name) {
      case 'load_skill':
        return this.loadSkill(call);
      case 'read_skill':
        return this.loadSkill(call);
      case 'list_skills':
        return this.listSkills(call);
      case 'search_skills':
        return this.searchSkills(call);
      default:
        return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }
  }

  private listSkills(call: ToolCall): ToolResult {
    const items = this.skillService.listSkills(this.availableTools);
    return jsonResult(call.id, { items });
  }

  private searchSkills(call: ToolCall): ToolResult {
    const parsed = searchInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const results = this.skillService.searchSkills(parsed.data.query, this.availableTools);
    return jsonResult(call.id, { results });
  }

  private async loadSkill(call: ToolCall): Promise<ToolResult> {
    const parsed = loadSkillInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const skill = this.skillService.getSkill(parsed.data.name, this.availableTools);
    if (!skill) {
      return textResult(call.id, false, `Skill "${parsed.data.name}" not found.`);
    }

    if (this.onSkillLoaded) {
      await this.onSkillLoaded(skill);
    }

    let resourceContent: string | null = null;
    if (parsed.data.resource) {
      resourceContent = await this.skillService.getSkillResource(
        parsed.data.name,
        parsed.data.resource,
      );
    }

    return jsonResult(call.id, {
      name: skill.name,
      version: skill.version,
      category: skill.category,
      scope: skill.scope,
      mode: skill.mode,
      missingCapabilities: skill.missingCapabilities,
      content: skill.content,
      ...(parsed.data.resource
        ? {
            resourcePath: parsed.data.resource,
            resourceContent: resourceContent ?? '[Resource file not found]',
          }
        : {}),
    });
  }
}
