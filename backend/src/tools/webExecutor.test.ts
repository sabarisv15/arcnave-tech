import { describe, expect, it } from 'vitest';

import type { WebFetchService } from '../services/webFetch.js';
import { StubWebSearchAdapter, WebSearchService, type WebSearchAdapter } from '../services/webSearch.js';
import { WebToolExecutor } from './webExecutor.js';

const signal = () => new AbortController().signal;
const fetched: string[] = [];
const fetchService = {
  fetchPage: async (url: string) => {
    fetched.push(url);
    return { url, title: 't', text: 'see https://linked.example.com/next for more' };
  },
} as unknown as WebFetchService;

const adapter: WebSearchAdapter = {
  name: 'fake',
  isLive: true,
  search: async () => [{ title: 'r', url: 'https://found.example.com/page', snippet: 's' }],
  searchImages: async (_q, n) =>
    Array.from({ length: n }, (_, i) => ({
      title: `img ${String(i)}`,
      imageUrl: `https://img.example.com/${String(i)}.jpg`,
      thumbnailUrl: `https://img.example.com/${String(i)}_t.jpg`,
      sourceUrl: `https://src.example.com/${String(i)}`,
    })),
};

describe('WebToolExecutor', () => {
  it('fetches only URLs already in the conversation, a search result, or a fetched page', async () => {
    const exec = new WebToolExecutor(new WebSearchService(adapter), fetchService, adapter);
    exec.allowUrlsIn('please read https://user.example.com/doc.');
    const call = (url: string) => exec.execute({ id: 'f', name: 'web_fetch', input: { url } }, signal());

    expect((await call('https://user.example.com/doc')).ok).toBe(true);
    const made = await call('https://user.example.com/other');
    expect(made.ok).toBe(false);
    expect((made.content[0] as { text: string }).text).toContain('has not appeared in the conversation');

    await exec.execute({ id: 's', name: 'web_search', input: { query: 'q' } }, signal());
    expect((await call('https://found.example.com/page/')).ok).toBe(true);
    // A link inside a fetched page may be followed.
    expect((await call('https://linked.example.com/next')).ok).toBe(true);
  });

  it('image_search returns images, and says so when no provider is configured', async () => {
    const exec = new WebToolExecutor(new WebSearchService(adapter), fetchService, adapter);
    const res = await exec.execute({ id: 'i', name: 'image_search', input: { query: 'Tanjore temple', max_results: 4 } }, signal());
    expect(res.ok).toBe(true);
    expect((res.content[0] as { data: { images: unknown[] } }).data.images).toHaveLength(4);
    expect((await exec.execute({ id: 'i', name: 'image_search', input: { query: 'x', max_results: 9 } }, signal())).ok).toBe(false);

    const stub = new StubWebSearchAdapter();
    const none = new WebToolExecutor(new WebSearchService(stub), fetchService, stub);
    const off = await none.execute({ id: 'i', name: 'image_search', input: { query: 'x' } }, signal());
    expect(off.ok).toBe(false);
    expect((off.content[0] as { text: string }).text).toContain('not available');
  });
});
