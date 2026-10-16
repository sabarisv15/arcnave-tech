/**
 * Grounding citations follow longer redirect chains than web_fetch (review fix 3, ADR-0065):
 * SAFE_FETCH_GROUNDING_MAX_REDIRECTS (default 8), every hop still checked by safeFetch.
 */
import { describe, expect, it } from 'vitest';

import type { PinnedRequest, Resolver, Transport } from '../services/safeFetch.js';
import { resolveUrls } from './grounding.js';

const START = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
const resolver: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];

function chain(locations: Record<string, string>): { transport: Transport; opened: PinnedRequest[] } {
  const opened: PinnedRequest[] = [];
  const transport: Transport = (req) => {
    opened.push(req);
    const next = locations[req.url.toString()];
    return Promise.resolve({
      status: next ? 301 : 200,
      headers: next ? { location: next } : {},
      body: (async function* () {})(),
      cancel: () => {},
    });
  };
  return { transport, opened };
}

describe('resolveUrls through safeFetch', () => {
  it('resolves a 5-hop public chain', async () => {
    const { transport, opened } = chain({
      [START]: 'http://news.example.com/a',
      'http://news.example.com/a': 'https://news.example.com/a',
      'https://news.example.com/a': 'https://www.news.example.com/a',
      'https://www.news.example.com/a': 'https://www.news.example.com/en/a',
      'https://www.news.example.com/en/a': 'https://www.news.example.com/en/a/',
    });
    const [out] = await resolveUrls([START], 5_000, { resolver, transport });
    expect(out).toEqual({ url: 'https://www.news.example.com/en/a/', resolved: true });
    expect(opened).toHaveLength(6);
  });

  it("takes the configured grounding cap (8) by default, above web_fetch's 3", async () => {
    const hops: Record<string, string> = { [START]: 'https://h.example.com/1' };
    for (let i = 1; i < 6; i += 1) hops[`https://h.example.com/${String(i)}`] = `https://h.example.com/${String(i + 1)}`;
    const { transport } = chain(hops);
    const [out] = await resolveUrls([START], 5_000, { resolver, transport });
    expect(out).toEqual({ url: 'https://h.example.com/6', resolved: true });

    const [capped] = await resolveUrls([START], 5_000, { resolver, transport, maxRedirects: 3 });
    expect(capped).toEqual({ url: START, resolved: false });
  });

  it('a hop to 169.254.169.254 is still refused and the citation stays unresolved', async () => {
    const { transport, opened } = chain({
      [START]: 'https://news.example.com/a',
      'https://news.example.com/a': 'http://169.254.169.254/computeMetadata/v1/',
    });
    const [out] = await resolveUrls([START], 5_000, { resolver, transport });
    expect(out).toEqual({ url: START, resolved: false });
    expect(opened.some((r) => r.url.hostname === '169.254.169.254')).toBe(false);
  });
});
