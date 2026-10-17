/**
 * Web page fetch for the web_fetch tool.
 *
 * Every request goes through safeFetch (ADR-0065): http/https only, every DNS answer checked and
 * the checked address pinned, redirects re-checked per hop, a streamed byte ceiling and one
 * deadline. This file only turns the page into text.
 */
import { safeFetch, type Resolver, type Transport } from './safeFetch.js';
import { NUMBERS } from '../config/numbers.js';

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
    maxChars: number = NUMBERS.WEB_FETCH_DEFAULT_MAX_CHARS.value, // N-09
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

    const { text: cleanText, droppedToEnd } = htmlToText(rawSlice);
    const title = pageTitle(rawSlice) ?? new URL(response.url).hostname;

    // Cut by the byte ceiling, by an unclosed block that took the rest of the page, or by
    // maxChars: in each case the model has not seen the whole page and must be told so.
    const truncated = body.truncated || droppedToEnd || cleanText.length > maxChars;
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

/*
 * The page's text, by scanning (ADR-0069). The page is anyone's: the regexes this replaces
 * backtracked quadratically on `<` with no `>`, or on `<script` with no close, and blocked the
 * event loop for every user. Every search below is an indexOf that moves forward, so the work is
 * linear in the page's length whatever it holds.
 */

/** The page's visible text, and whether an unclosed comment, script or style took the rest of it. */
export function htmlToText(raw: string): { text: string; droppedToEnd: boolean } {
  const { text, droppedToEnd } = withoutCodeAndComments(raw);
  return {
    text: withoutTags(text)
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim(),
    droppedToEnd,
  };
}

/** The text of the first `<title>` with text in it, or null. */
export function pageTitle(raw: string): string | null {
  let from = 0;
  for (;;) {
    const lt = raw.indexOf('<', from);
    if (lt === -1) return null;
    if (!(hasNameAt(raw, lt + 1, 'title') && endsTagName(raw, lt + 6))) {
      from = lt + 1;
      continue;
    }
    const gt = raw.indexOf('>', lt + 6);
    if (gt === -1) return null;
    const textEnd = raw.indexOf('<', gt + 1);
    if (textEnd === -1) return null;
    if (textEnd > gt + 1 && raw.charCodeAt(textEnd + 1) === SLASH && hasNameAt(raw, textEnd + 2, 'title') && endsTagName(raw, textEnd + 7)) {
      return raw.slice(gt + 1, textEnd).trim();
    }
    // Any `<title` before `gt` shares this `>` and this text, so it fails the same way.
    from = gt + 1;
  }
}

const SLASH = 0x2f;
const RAW_TEXT_ELEMENTS = ['script', 'style'];

/**
 * Comments, scripts and styles, each replaced by a space. A block runs to its first end tag —
 * `</script`, in any case, then whitespace, `/` or `>` — as a browser ends it, so `</style >`
 * closes a style and `<style-guide>` opens nothing. A block with no end (a page cut by the byte
 * ceiling, or broken) is code to the end of the page: dropped, and reported.
 */
function withoutCodeAndComments(raw: string): { text: string; droppedToEnd: boolean } {
  const out: string[] = [];
  let kept = 0;
  let from = 0;
  for (;;) {
    const lt = raw.indexOf('<', from);
    if (lt === -1) break;
    let end: number | null = null;
    if (raw.startsWith('<!--', lt)) {
      // From `<!` so that `<!-->` and `<!--->` end themselves, as in a browser.
      const close = raw.indexOf('-->', lt + 2);
      end = close === -1 ? -1 : close + 3;
    } else {
      const name = RAW_TEXT_ELEMENTS.find((n) => hasNameAt(raw, lt + 1, n) && endsTagName(raw, lt + 1 + n.length));
      if (name) end = endTagEnd(raw, lt + 1 + name.length, name);
    }
    if (end === null) {
      from = lt + 1;
      continue;
    }
    out.push(raw.slice(kept, lt), ' ');
    if (end === -1) return { text: out.join(''), droppedToEnd: true };
    kept = from = end;
  }
  out.push(raw.slice(kept));
  return { text: out.join(''), droppedToEnd: false };
}

/** Just past the `>` of the first `</name…>` at or after `from`; -1 when there is none. */
function endTagEnd(raw: string, from: number, name: string): number {
  for (let at = raw.indexOf('</', from); at !== -1; at = raw.indexOf('</', at + 2)) {
    if (hasNameAt(raw, at + 2, name) && endsTagName(raw, at + 2 + name.length)) {
      const gt = raw.indexOf('>', at + 2 + name.length);
      return gt === -1 ? -1 : gt + 1;
    }
  }
  return -1;
}

/**
 * Every `<…>` with something between the brackets, replaced by a space, as the cleaner always did
 * (so `<>` and a `<` with no later `>` stay as text).
 */
function withoutTags(text: string): string {
  const out: string[] = [];
  let kept = 0;
  let from = 0;
  for (;;) {
    const lt = text.indexOf('<', from);
    if (lt === -1) break;
    const gt = text.indexOf('>', lt + 1);
    // No `>` anywhere after: nothing later can be a tag either.
    if (gt === -1) break;
    if (gt === lt + 1) {
      from = gt;
      continue;
    }
    out.push(text.slice(kept, lt), ' ');
    kept = from = gt + 1;
  }
  out.push(text.slice(kept));
  return out.join('');
}

/** `name` (lowercase ASCII) is at `at`, in any ASCII case, as the old `/i` patterns matched. */
function hasNameAt(raw: string, at: number, name: string): boolean {
  if (at + name.length > raw.length) return false;
  for (let k = 0; k < name.length; k += 1) {
    const c = raw.charCodeAt(at + k);
    if ((c >= 0x41 && c <= 0x5a ? c + 0x20 : c) !== name.charCodeAt(k)) return false;
  }
  return true;
}

/** A tag name ends here: HTML whitespace, `/`, `>`, or the end of a page cut mid-tag. */
function endsTagName(raw: string, at: number): boolean {
  if (at >= raw.length) return true;
  const c = raw.charCodeAt(at);
  return c === 0x3e || c === SLASH || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
}
