/**
 * Web page fetch for the web_fetch tool.
 *
 * Every request goes through safeFetch (ADR-0065): http/https only, every DNS answer checked and
 * the checked address pinned, redirects re-checked per hop, a streamed byte ceiling and one
 * deadline. This file only turns the page into text.
 */
import { safeFetch, type Resolver, type Transport } from './safeFetch.js';

export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  length: number;
  truncated: boolean;
}

export class WebFetchService {
  /**
   * Unset limits take safeFetch's configured defaults (SAFE_FETCH_TIMEOUT_MS, N-43;
   * SAFE_FETCH_MAX_BYTES). `deps` lets a test supply the resolver and transport.
   */
  constructor(
    private readonly defaultTimeoutMs?: number,
    private readonly maxBytes?: number,
    private readonly deps: { resolver?: Resolver; transport?: Transport } = {},
  ) {}

  async fetchPage(
    rawUrl: string,
    maxChars: number = 10_000,
    signal?: AbortSignal,
  ): Promise<WebFetchResult> {
    const response = await safeFetch(rawUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'ArcNave-Bot/1.0 (+https://arcnave.in)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      ...(signal ? { signal } : {}),
      ...(this.defaultTimeoutMs !== undefined ? { timeoutMs: this.defaultTimeoutMs } : {}),
      ...(this.maxBytes !== undefined ? { maxBytes: this.maxBytes } : {}),
      ...this.deps,
    });

    if (!response.ok) {
      response.cancel();
      throw new Error(`HTTP ${String(response.status)}`);
    }

    // A page past the byte ceiling is read up to it and returned cut, not refused; reading stops
    // there, so memory stays bounded.
    const body = await response.prefix();
    const rawSlice = new TextDecoder('utf-8', { fatal: false }).decode(body.bytes);

    // Simple HTML-to-text cleaner: strip scripts, styles, and html tags
    const cleanText = rawSlice
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      // A page cut at the byte ceiling can end inside a script or style block, which the two
      // rules above leave alone (no closing tag); everything from its opening tag on is code.
      .replace(/<(script|style)\b[\s\S]*$/i, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract title if present
    const titleMatch = rawSlice.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1] ? titleMatch[1].trim() : new URL(response.url).hostname;

    const truncated = body.truncated || cleanText.length > maxChars;
    const content = cleanText.slice(0, maxChars);

    return {
      url: response.url,
      title,
      content,
      length: content.length,
      truncated,
    };
  }
}
