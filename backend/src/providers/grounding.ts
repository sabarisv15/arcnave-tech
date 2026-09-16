/**
 * Turning provider grounding metadata into citations we can stand behind.
 *
 * Two documented traps, handled here so neither adapter has to:
 *
 * 1. Gemini's `groundingChunks[].web.uri` is a Vertex redirect
 *    (`https://vertexaisearch.cloud.google.com/grounding-api-redirect/...`) and `.title` is
 *    often a bare domain. The canonical URL requires following the redirect. When resolution
 *    fails we keep the redirect and mark `urlResolved: false` — we never guess a destination.
 *
 * 2. `groundingSupports[].segment` offsets are **byte** offsets into UTF-8, not JS string
 *    indices. Slicing the string directly corrupts any response containing non-ASCII text.
 */
import type { ProviderSource } from './types.js';

const VERTEX_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

/** Domain suffix -> the source type the UI shows. First match wins. */
const TYPE_RULES: ReadonlyArray<readonly [readonly string[], string]> = [
  [['.gov', '.mil', 'europa.eu', '.gov.uk'], 'Government'],
  [['.edu', 'arxiv.org', 'nature.com', 'science.org', 'doi.org', '.ac.uk'], 'Academic'],
  [
    [
      'nytimes.com',
      'bbc.co.uk',
      'bbc.com',
      'reuters.com',
      'apnews.com',
      'theguardian.com',
      'ft.com',
      'wsj.com',
      'aljazeera.com',
    ],
    'News',
  ],
  [['wikipedia.org', 'stackexchange.com', 'stackoverflow.com', 'reddit.com'], 'Community'],
];

export function classifyDomain(domain: string): string {
  const host = domain.toLowerCase();
  for (const [suffixes, label] of TYPE_RULES) {
    if (suffixes.some((s) => host === s || host.endsWith(s))) return label;
  }
  return 'Web';
}

export function domainOf(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  } catch {
    return '';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Slice by byte offset, as grounding supports report them. */
export function sliceUtf8(text: string, start?: number, end?: number): string {
  if (start == null || end == null) return '';
  const bytes = encoder.encode(text);
  if (start < 0 || end > bytes.length || start >= end) return '';
  return decoder.decode(bytes.subarray(start, end)).trim();
}

/**
 * Follow a Vertex grounding redirect to its canonical target.
 *
 * HEAD first: reading the redirect chain is enough and avoids pulling page bodies. Some hosts
 * reject HEAD, so we fall back to GET and discard the body. A failure returns the original
 * URL with `resolved: false` — never a fabricated one.
 */
async function resolveOne(url: string, timeoutMs: number): Promise<{ url: string; resolved: boolean }> {
  if (!url.includes(VERTEX_REDIRECT_HOST)) return { url, resolved: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (!response.ok) {
      response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
      // Release the body so the socket can be reused rather than held open.
      await response.body?.cancel();
    }
    const final = response.url;
    if (!final || final.includes(VERTEX_REDIRECT_HOST)) return { url, resolved: false };
    return { url: final, resolved: true };
  } catch {
    return { url, resolved: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveUrls(
  urls: string[],
  timeoutMs: number,
): Promise<Array<{ url: string; resolved: boolean }>> {
  if (urls.length === 0) return [];
  return Promise.all(urls.map((u) => resolveOne(u, timeoutMs)));
}

/* -------------------------------------------------------------------------- Gemini */

interface GeminiWebChunk {
  web?: { uri?: string; title?: string; domain?: string };
}

interface GeminiSupport {
  segment?: { startIndex?: number; endIndex?: number };
  groundingChunkIndices?: number[];
}

export interface GeminiGroundingMetadata {
  groundingChunks?: GeminiWebChunk[];
  groundingSupports?: GeminiSupport[];
  webSearchQueries?: string[];
  searchEntryPoint?: { renderedContent?: string };
}

export interface GroundingResult {
  sources: ProviderSource[];
  /** The queries the model actually issued. Research progress events cite these. */
  queries: string[];
  searchEntryPoint: string | undefined;
}

export async function sourcesFromGeminiMetadata(
  metadata: GeminiGroundingMetadata | undefined | null,
  responseText: string,
  redirectTimeoutMs: number,
): Promise<GroundingResult> {
  if (!metadata) return { sources: [], queries: [], searchEntryPoint: undefined };

  const chunks = metadata.groundingChunks ?? [];
  const supports = metadata.groundingSupports ?? [];
  const queries = metadata.webSearchQueries ?? [];
  const searchEntryPoint = metadata.searchEntryPoint?.renderedContent;

  // chunk index -> the response text it supports, so each citation carries its own evidence.
  const passages = new Map<number, string[]>();
  for (const support of supports) {
    const text = sliceUtf8(responseText, support.segment?.startIndex, support.segment?.endIndex);
    if (!text) continue;
    for (const index of support.groundingChunkIndices ?? []) {
      const list = passages.get(index);
      if (list) list.push(text);
      else passages.set(index, [text]);
    }
  }

  const raw = chunks
    .map((chunk, index) => ({ index, title: chunk.web?.title ?? '', uri: chunk.web?.uri }))
    .filter((c): c is { index: number; title: string; uri: string } => Boolean(c.uri));

  const resolved = await resolveUrls(
    raw.map((r) => r.uri),
    redirectTimeoutMs,
  );
  const retrievedAt = new Date();

  const sources: ProviderSource[] = raw.map((item, i) => {
    const target = resolved[i]!;
    const domain = domainOf(target.url) || domainOf(item.uri);
    const passage = (passages.get(item.index) ?? []).slice(0, 3).join(' … ');
    return {
      // Gemini often supplies a bare domain as the title; the domain is a more honest label
      // than a headline we invented.
      title: item.title.trim() || domain || 'Untitled source',
      url: target.url,
      urlResolved: target.resolved,
      domain,
      snippet: passage.slice(0, 400),
      passage,
      sourceType: classifyDomain(domain),
      retrievedAt,
    };
  });

  return { sources, queries, searchEntryPoint };
}

/* -------------------------------------------------------------------------- Anthropic */

interface AnthropicSearchResult {
  type?: string;
  url?: string;
  title?: string;
  page_age?: string;
}

/**
 * Citations from Anthropic's web search tool results.
 *
 * These carry real URLs already — there is no redirect layer — so nothing needs resolving.
 */
export function sourcesFromAnthropicBlocks(blocks: AnthropicSearchResult[]): ProviderSource[] {
  const retrievedAt = new Date();
  const seen = new Set<string>();
  const out: ProviderSource[] = [];

  for (const block of blocks) {
    if (block.type !== 'web_search_result') continue;
    const url = block.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const domain = domainOf(url);
    out.push({
      title: block.title ?? domain ?? 'Untitled source',
      url,
      urlResolved: true,
      domain,
      snippet: block.page_age ? `Published ${block.page_age}` : '',
      passage: '',
      sourceType: classifyDomain(domain),
      retrievedAt,
    });
  }
  return out;
}
