/**
 * Secure Web Page Fetch Service.
 *
 * Implements strict SSRF protection:
 * - Scheme check: only http:// and https://
 * - Host check: prevents loopback, link-local, private RFC1918 subnets, and cloud metadata endpoints (169.254.169.254)
 * - Size and timeout bounds
 * - Text content extraction
 */

export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  length: number;
  truncated: boolean;
}

const FORBIDDEN_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./, // AWS / GCP / Azure metadata endpoint
  /^0\./,
  /^::1$/,
  /^fe80:/i,
];

export function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  for (const pattern of FORBIDDEN_HOST_PATTERNS) {
    if (pattern.test(h)) return true;
  }
  return false;
}

export class WebFetchService {
  constructor(
    private readonly defaultTimeoutMs: number = 10_000,
    private readonly maxBytes: number = 1_000_000, // 1MB raw limit
  ) {}

  async fetchPage(
    rawUrl: string,
    maxChars: number = 10_000,
    signal?: AbortSignal,
  ): Promise<WebFetchResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid URL "${rawUrl}"`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Unsupported URL protocol "${parsedUrl.protocol}". Only http: and https: are allowed.`);
    }

    if (isForbiddenHost(parsedUrl.hostname)) {
      throw new Error(`Access to host "${parsedUrl.hostname}" is forbidden by SSRF security policy.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    const onAbort = () => controller.abort();
    if (signal?.aborted) onAbort();
    else if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    try {
      const response = await fetch(parsedUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'ArcNave-Bot/1.0 (+https://arcnave.tech)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      // Re-verify final URL after redirects against SSRF
      const finalUrl = new URL(response.url);
      if (isForbiddenHost(finalUrl.hostname)) {
        throw new Error(`Redirect to host "${finalUrl.hostname}" is forbidden by SSRF security policy.`);
      }

      const htmlOrText = await response.text();
      const rawSlice = htmlOrText.slice(0, this.maxBytes);

      // Simple HTML-to-text cleaner: strip scripts, styles, and html tags
      let cleanText = rawSlice
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

      // Extract title if present
      const titleMatch = rawSlice.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1] ? titleMatch[1].trim() : parsedUrl.hostname;

      const truncated = cleanText.length > maxChars;
      const content = cleanText.slice(0, maxChars);

      return {
        url: response.url,
        title,
        content,
        length: content.length,
        truncated,
      };
    } finally {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }
}
