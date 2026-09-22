/**
 * SearchToolsExecutor: Executes deferred tool discovery.
 *
 * Implements:
 * - Policy-approved catalog search: Searches allowed tools by query keywords.
 * - Progressive tool disclosure: Discloses exact matching tool schemas on-demand.
 * - Dynamic activation callback: Activates discovered tools for subsequent loop rounds.
 * - Invariant 1: Typed ToolResults, never throws unhandled errors.
 */

import { z } from 'zod';

import type { ToolCall, ToolDefinition, ToolExecutor, ToolResult } from '../providers/types.js';

const searchToolsInput = z.object({
  query: z.string().min(1),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown, ok = true): ToolResult {
  return { toolCallId, ok, content: [{ type: 'json', data }] };
}

export class SearchToolsExecutor implements ToolExecutor {
  constructor(
    private readonly catalog: ToolDefinition[],
    private readonly onToolDiscovered?: (tool: ToolDefinition) => void | Promise<void>,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before search_tools completed.');
    }

    if (call.name !== 'search_tools') {
      return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }

    const parsed = searchToolsInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const query = parsed.data.query.toLowerCase().trim();
    const tokens = query.split(/\s+/).filter(Boolean);

    const scored: { tool: ToolDefinition; score: number }[] = [];

    for (const tool of this.catalog) {
      // Don't return search_tools itself in search results
      if (tool.name === 'search_tools') continue;

      let score = 0;
      const name = tool.name.toLowerCase();
      const desc = tool.description.toLowerCase();

      for (const token of tokens) {
        if (name === token) score += 10;
        else if (name.includes(token)) score += 5;

        if (desc.includes(token)) score += 3;
      }

      // Keyword associations for common tasks
      if (tokens.some((t) => ['excel', 'spreadsheet', 'xlsx', 'sheet'].includes(t)) && name === 'generate_deliverable') {
        score += 8;
      }
      if (tokens.some((t) => ['word', 'doc', 'docx', 'document'].includes(t)) && name === 'generate_deliverable') {
        score += 8;
      }
      if (tokens.some((t) => ['pptx', 'powerpoint', 'slide', 'presentation', 'deck'].includes(t)) && name === 'generate_deliverable') {
        score += 8;
      }
      if (tokens.some((t) => ['pdf', 'report'].includes(t)) && name === 'generate_deliverable') {
        score += 8;
      }
      if (tokens.some((t) => ['python', 'code', 'calculate', 'compute', 'simulate'].includes(t)) && name === 'run_python') {
        score += 8;
      }

      if (score > 0) {
        scored.push({ tool, score });
      }
    }

    const matching = scored
      .sort((a, b) => b.score - a.score)
      .map((s) => s.tool);

    // Notify discovery callback for matching tools so they are dynamically activated
    if (this.onToolDiscovered) {
      for (const tool of matching) {
        await this.onToolDiscovered(tool);
      }
    }

    if (matching.length === 0) {
      return jsonResult(call.id, {
        message: `No matching tools found in policy-approved catalog for query "${parsed.data.query}".`,
        tools: [],
      });
    }

    return jsonResult(call.id, {
      message: `Found ${matching.length} matching tool(s) in catalog. Their schemas are now available for invocation.`,
      tools: matching.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }
}
