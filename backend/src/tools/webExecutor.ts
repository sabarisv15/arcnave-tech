/**
 * Executes web_search, web_fetch and image_search.
 *
 * web_fetch opens only a URL that already appeared in the conversation (the user's message, the
 * history, or a result of this turn): a page's text cannot steer the model into sending data to
 * an address it made up (ADR-0047).
 */
import { z } from 'zod';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { WebFetchService } from '../services/webFetch.js';
import type { WebSearchAdapter, WebSearchService } from '../services/webSearch.js';

const searchInput = z.object({ query: z.string().min(1) });
const fetchInput = z.object({ url: z.string().url() });
const imageInput = z.object({ query: z.string().min(1), max_results: z.number().int().min(3).max(4).optional() });

const URL_PATTERN = /https?:\/\/[^\s"'<>\\)\]}]+/g;

/** The same page, whatever trailing slash or fragment it was written with. */
function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.replace(/[.,;:!?]+$/, ''));
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown): ToolResult {
  return { toolCallId, ok: true, content: [{ type: 'json', data }] };
}

export class WebToolExecutor implements ToolExecutor {
  private readonly seenUrls = new Set<string>();

  constructor(
    private readonly searchService: WebSearchService,
    private readonly fetchService: WebFetchService,
    private readonly adapter?: WebSearchAdapter,
  ) {}

  /** Adds every URL in these texts to the ones web_fetch may open. */
  allowUrlsIn(...texts: string[]): void {
    for (const text of texts) {
      for (const match of text.match(URL_PATTERN) ?? []) {
        const url = normalizeUrl(match);
        if (url) this.seenUrls.add(url);
      }
    }
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }

    switch (call.name) {
      case 'web_search': {
        const parsed = searchInput.safeParse(call.input);
        if (!parsed.success) return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
        try {
          const res = await this.searchService.search(parsed.data.query, undefined, signal);
          this.allowUrlsIn(...res.results.map((r) => r.url));
          return jsonResult(call.id, res);
        } catch (err) {
          return textResult(call.id, false, `Web search failed: ${String(err)}`);
        }
      }

      case 'web_fetch': {
        const parsed = fetchInput.safeParse(call.input);
        if (!parsed.success) return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
        const url = normalizeUrl(parsed.data.url);
        if (!url || !this.seenUrls.has(url)) {
          return textResult(
            call.id,
            false,
            'This URL has not appeared in the conversation, so it cannot be fetched. Search for the page with ' +
              'web_search and fetch a link it returns, or use a URL the user gave.',
          );
        }
        try {
          const res = await this.fetchService.fetchPage(parsed.data.url, undefined, signal);
          this.allowUrlsIn(JSON.stringify(res));
          return jsonResult(call.id, res);
        } catch (err) {
          return textResult(call.id, false, `Web fetch failed: ${String(err)}`);
        }
      }

      case 'image_search': {
        const parsed = imageInput.safeParse(call.input);
        if (!parsed.success) return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
        if (!this.adapter?.isLive || !this.adapter.searchImages) {
          return textResult(call.id, false, 'Image search is not available here: no image search provider is configured.');
        }
        try {
          const images = await this.adapter.searchImages(parsed.data.query, parsed.data.max_results ?? 3, signal);
          this.allowUrlsIn(...images.map((i) => i.sourceUrl));
          return jsonResult(call.id, { query: parsed.data.query, images });
        } catch (err) {
          return textResult(call.id, false, `Image search failed: ${String(err)}`);
        }
      }

      default:
        return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }
  }
}
