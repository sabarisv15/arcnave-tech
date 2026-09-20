/**
 * Web search service abstraction.
 *
 * Pluggable adapter interface so backend code never binds directly to a single provider.
 */

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResultItem[];
}

export interface WebSearchAdapter {
  readonly name: string;
  readonly isLive: boolean;
  search(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResultItem[]>;
}

/**
 * SerpAPI adapter: searches Google Search index via SerpAPI.
 */
export class SerpApiWebSearchAdapter implements WebSearchAdapter {
  readonly name = 'serpapi';
  readonly isLive = true;

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResultItem[]> {
    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('engine', 'google');
    url.searchParams.set('num', String(maxResults));

    const res = await fetch(url.toString(), { method: 'GET', signal });
    if (!res.ok) {
      throw new Error(`SerpAPI error: HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
    return organic.slice(0, maxResults).map((item: any) => ({
      title: item.title ?? 'Untitled',
      url: item.link ?? '',
      snippet: item.snippet ?? '',
      publishedDate: item.date,
    }));
  }
}

/**
 * Google Custom Search Engine (CSE) JSON API adapter.
 */
export class GoogleCustomSearchAdapter implements WebSearchAdapter {
  readonly name = 'google-cse';
  readonly isLive = true;

  constructor(
    private readonly apiKey: string,
    private readonly searchEngineId: string,
  ) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResultItem[]> {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('q', query);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('cx', this.searchEngineId);
    url.searchParams.set('num', String(maxResults));

    const res = await fetch(url.toString(), { method: 'GET', signal });
    if (!res.ok) {
      throw new Error(`Google Custom Search error: HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    const items = Array.isArray(data.items) ? data.items : [];
    return items.slice(0, maxResults).map((item: any) => ({
      title: item.title ?? 'Untitled',
      url: item.link ?? '',
      snippet: item.snippet ?? '',
    }));
  }
}

/**
 * Fallback / Stub adapter when no external search provider API key is configured.
 */
export class StubWebSearchAdapter implements WebSearchAdapter {
  readonly name = 'stub';
  readonly isLive = false;

  async search(query: string, maxResults: number): Promise<WebSearchResultItem[]> {
    return [
      {
        title: `Search results for "${query}"`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Public web search query executed for: ${query}. (Configure web search adapter in environment for live index queries).`,
      },
    ].slice(0, maxResults);
  }
}

export function buildWebSearchAdapter(cfg: {
  SERPAPI_API_KEY?: string;
  GOOGLE_SEARCH_API_KEY?: string;
  GOOGLE_SEARCH_ENGINE_ID?: string;
}): WebSearchAdapter {
  if (cfg.SERPAPI_API_KEY?.trim()) {
    return new SerpApiWebSearchAdapter(cfg.SERPAPI_API_KEY.trim());
  }
  if (cfg.GOOGLE_SEARCH_API_KEY?.trim() && cfg.GOOGLE_SEARCH_ENGINE_ID?.trim()) {
    return new GoogleCustomSearchAdapter(
      cfg.GOOGLE_SEARCH_API_KEY.trim(),
      cfg.GOOGLE_SEARCH_ENGINE_ID.trim(),
    );
  }
  return new StubWebSearchAdapter();
}

export class WebSearchService {
  constructor(private readonly adapter: WebSearchAdapter = new StubWebSearchAdapter()) {}

  get isLive(): boolean {
    return this.adapter.isLive;
  }

  async search(query: string, maxResults: number = 5, signal?: AbortSignal): Promise<WebSearchResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { query, results: [] };
    }
    const boundedLimit = Math.max(1, Math.min(maxResults, 10));
    const results = await this.adapter.search(trimmed, boundedLimit, signal);
    return {
      query: trimmed,
      results,
    };
  }
}

