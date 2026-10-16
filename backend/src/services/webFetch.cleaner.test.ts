/**
 * The web_fetch cleaner (ADR-0069): linear on any page (F2), browser-like block ends (F3), and the
 * same text as before on ordinary pages. The goldens in `test/fixtures/html` were produced by the
 * cleaner at fce4a22; `article.expected.json` notes the one place the old output was wrong.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Resolver, Transport } from './safeFetch.js';
import { htmlToText, pageTitle, WebFetchService } from './webFetch.js';

const FIXTURES = path.resolve(__dirname, '../test/fixtures/html');
const pages = readdirSync(FIXTURES).filter((f) => f.endsWith('.html')).sort();
const golden = (page: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, page.replace(/\.html$/, '.expected.json')), 'utf8')) as { title: string | null; text: string };

const resolver: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];
function serving(body: string): Transport {
  return () =>
    Promise.resolve({
      status: 200,
      headers: {},
      body: (async function* () {
        yield new TextEncoder().encode(body);
      })(),
      cancel: () => {},
    });
}

describe('ordinary pages read as before (goldens from the old cleaner)', () => {
  it('has the fixtures', () => {
    expect(pages).toEqual(['article.html', 'docs.html', 'news.html', 'plain.html', 'shop.html']);
  });

  it.each(pages)('%s', (page) => {
    const raw = readFileSync(path.join(FIXTURES, page), 'utf8');
    const expected = golden(page);
    expect(htmlToText(raw)).toEqual({ text: expected.text, droppedToEnd: false });
    expect(pageTitle(raw)).toBe(expected.title);
  });

  it('through fetchPage: the article page, whole and not truncated', async () => {
    const raw = readFileSync(path.join(FIXTURES, 'article.html'), 'utf8');
    const service = new WebFetchService(5_000, 1_000_000, { resolver, transport: serving(raw) });
    const res = await service.fetchPage('https://example.com/guide', 100_000);
    expect(res).toMatchObject({ title: golden('article.html').title, content: golden('article.html').text, truncated: false });
  });
});

describe('a < that opens no tag stays as text', () => {
  it('<> and a < with no later > are kept, as the old /<[^>]+>/ rule kept them', () => {
    expect(htmlToText('a <> b < c').text).toBe('a <> b < c');
  });
});

describe('a block ends where a browser ends it (F3)', () => {
  it.each([
    ['whitespace before >', '<style>a{}</style ><p>After</p>'],
    ['a line break before >', '<script>x()</script\n><p>After</p>'],
    ['upper case', '<STYLE>a{}</STYLE><p>After</p>'],
    ['mixed case end tag', '<script>x()</ScRiPt><p>After</p>'],
    ['attributes on the end tag', '<script>x()</script foo><p>After</p>'],
  ])('%s closes the block', (_label, html) => {
    expect(htmlToText(html)).toEqual({ text: 'After', droppedToEnd: false });
  });

  it.each([
    ['<style-guide>', '<p>Before</p><style-guide>Kept</style-guide>', 'Before Kept'],
    ['<scripture>', '<p>Before</p><scripture>Psalm 23</scripture>', 'Before Psalm 23'],
    ['<script-loader>', '<p>Before</p><script-loader>Loaded</script-loader>', 'Before Loaded'],
    ['<styles>', '<styles>Styled</styles>', 'Styled'],
  ])('%s is not a style or script block', (_label, html, text) => {
    expect(htmlToText(html)).toEqual({ text, droppedToEnd: false });
  });

  it('a comment is dropped whole, even with > in it; <!--> ends itself', () => {
    expect(htmlToText('<p>A</p><!-- <p>old</p> a > b --><p>B</p>').text).toBe('A B');
    expect(htmlToText('<p>A</p><!--><p>B</p><!---><p>C</p>').text).toBe('A B C');
    expect(htmlToText('<!-- <script> -->After').text).toBe('After');
  });

  it('only a block that really has no end takes the rest of the page, and says so', () => {
    for (const html of ['<p>Kept</p><script>var secret = 1; <p>gone</p>', '<p>Kept</p><style>a{} <p>gone</p>', '<p>Kept</p><!-- <p>gone</p>', '<p>Kept</p><script']) {
      expect(htmlToText(html)).toEqual({ text: 'Kept', droppedToEnd: true });
    }
  });

  it('fetchPage reports truncated when an unclosed block took the rest of a page that arrived whole', async () => {
    const service = new WebFetchService(5_000, 1_000_000, { resolver, transport: serving('<title>T</title><p>Kept</p><script>var x = 1;<p>gone</p>') });
    const res = await service.fetchPage('https://example.com/broken');
    expect(res).toMatchObject({ title: 'T', content: 'T Kept', truncated: true });
  });

  it('the title ends the same way, and <titlebar> is not a title', () => {
    expect(pageTitle('<titlebar>Menu</titlebar><title>Real</title >')).toBe('Real');
    expect(pageTitle('<TITLE lang="en">Upper</TITLE>')).toBe('Upper');
    expect(pageTitle('<title></title><title>Second</title>')).toBe('Second');
    expect(pageTitle('<title>No end')).toBeNull();
  });
});

/** Pages built to make a backtracking cleaner take hours (F2). Each must finish in < 2 s. */
const MB5 = 5 * 1024 * 1024;
const fill = (unit: string) => unit.repeat(Math.ceil(MB5 / unit.length)).slice(0, MB5);
const ADVERSARIAL: Array<[string, string]> = [
  ['<script repeated, no >', fill('<script')],
  ['<script> repeated, never closed', fill('<script>')],
  ['<script>…</scrip near misses', `<script>${fill('</scrip ')}`],
  ['an unclosed <!--, then 5 MB', `<!--${fill('a-')}`],
  ['<!-- repeated, never closed', fill('<!--')],
  ['< repeated, no >', fill('<')],
  ['<> repeated', fill('<>')],
  ['<style repeated, nested, never closed', fill('<style><style')],
  ['<style>…</style> pairs', fill('<style>a</style>')],
  ['<title repeated, no >', fill('<title')],
  ['<title> repeated, no text', fill('<title>')],
  ['<title>x</titl near misses', fill('<title>x</titl')],
  ['whitespace and & alternating', fill(' \t&amp;\n')],
];

describe('linear on any page: 5 MB adversarial inputs (F2)', () => {
  it.each(ADVERSARIAL)('%s', (_label, raw) => {
    const started = performance.now();
    htmlToText(raw);
    pageTitle(raw);
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(2000);
  });

  it('through fetchPage at the 5 MB byte ceiling', async () => {
    const raw = fill('<script>'); // opens one script that never closes
    const service = new WebFetchService(5_000, MB5, { resolver, transport: serving(raw) });
    const started = performance.now();
    const res = await service.fetchPage('https://example.com/hostile');
    expect(performance.now() - started).toBeLessThan(2000);
    expect(res).toMatchObject({ content: '', truncated: true });
  });
});
