/**
 * Executes web search and web fetch tools.
 */
import { z } from 'zod';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { WebFetchService } from '../services/webFetch.js';
import type { WebSearchService } from '../services/webSearch.js';

const searchInput = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(10).optional(),
});

const fetchInput = z.object({
  url: z.string().url(),
  maxChars: z.number().int().min(100).max(30_000).optional(),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown): ToolResult {
  return { toolCallId, ok: true, content: [{ type: 'json', data }] };
}

export class WebToolExecutor implements ToolExecutor {
  constructor(
    private readonly searchService: WebSearchService,
    private readonly fetchService: WebFetchService,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }

    switch (call.name) {
      case 'web_search': {
        const parsed = searchInput.safeParse(call.input);
        if (!parsed.success) {
          return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
        }
        try {
          const res = await this.searchService.search(parsed.data.query, parsed.data.maxResults, signal);
          return jsonResult(call.id, res);
        } catch (err) {
          return textResult(call.id, false, `Web search failed: ${String(err)}`);
        }
      }

      case 'web_fetch': {
        const parsed = fetchInput.safeParse(call.input);
        if (!parsed.success) {
          return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
        }
        try {
          const res = await this.fetchService.fetchPage(parsed.data.url, parsed.data.maxChars, signal);
          return jsonResult(call.id, res);
        } catch (err) {
          return textResult(call.id, false, `Web fetch failed: ${String(err)}`);
        }
      }

      default:
        return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }
  }
}
