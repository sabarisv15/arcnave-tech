/**
 * web_fetch reaches the network only through safeFetch (ADR-0065, A-08). The old hostname regex
 * let `http://[::1]/` and a public name pointing at 10.x through; both are refused here before
 * the injected transport is asked to connect.
 */
import { describe, expect, it } from 'vitest';

import type { PinnedRequest, Resolver, Transport } from './safeFetch.js';
import { WebFetchService } from './webFetch.js';

function recorder(): { transport: Transport; opened: PinnedRequest[] } {
  const opened: PinnedRequest[] = [];
  const page = '<html><head><title>T</title></head><body><p>Hello <b>page</b></p></body></html>';
  const transport: Transport = (req) => {
    opened.push(req);
    return Promise.resolve({
      status: 200,
      headers: {},
      body: (async function* () {
        yield new TextEncoder().encode(page);
      })(),
      cancel: () => {},
    });
  };
  return { transport, opened };
}

const resolver: Resolver = async (host) =>
  host === 'internal.example.com' ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];

describe('WebFetchService', () => {
  it('refuses loopback and a name that resolves to a private address, opening nothing', async () => {
    const rec = recorder();
    const service = new WebFetchService(1_000, 1_000_000, { resolver, transport: rec.transport });
    for (const url of ['http://[::1]/', 'http://localhost/', 'https://internal.example.com/a']) {
      await expect(service.fetchPage(url), url).rejects.toMatchObject({ code: 'url_not_allowed' });
    }
    expect(rec.opened).toHaveLength(0);
  });

  it('fetches a public page and returns its text', async () => {
    const rec = recorder();
    const service = new WebFetchService(1_000, 1_000_000, { resolver, transport: rec.transport });
    const res = await service.fetchPage('https://example.com/p');
    expect(res).toMatchObject({ url: 'https://example.com/p', title: 'T', content: 'T Hello page' });
    expect(rec.opened[0]?.address).toBe('93.184.216.34');
  });
});

describe('WebFetchService on a page cut inside a block (review r2)', () => {
  it('a truncated page ending mid-script yields no script text', async () => {
    const html =
      '<html><head><title>Cut</title><style>.a{color:red}</style></head><body><p>Visible words</p>' +
      '<script>var done = 1;</script><p>More words</p><script>var secretToken = "abc"; function leak(){';
    const transport: Transport = () =>
      Promise.resolve({
        status: 200,
        headers: {},
        body: (async function* () {
          yield new TextEncoder().encode(html);
          yield new TextEncoder().encode('} </script><p>never read</p>');
        })(),
        cancel: () => {},
      });
    const cap = new TextEncoder().encode(html).byteLength;
    const service = new WebFetchService(5_000, cap, { resolver, transport });
    const res = await service.fetchPage('https://example.com/cut');
    expect(res.truncated).toBe(true);
    expect(res.content).toBe('Cut Visible words More words');
    expect(res.content).not.toMatch(/secretToken|leak|color|var done/);
  });
});

describe('WebFetchService over the byte ceiling (review fix 2)', () => {
  it('returns a 6 MB page cut at the ceiling, marked truncated, reading no further', async () => {
    const cap = 5 * 1024 * 1024;
    const chunk = new Uint8Array(64 * 1024).fill(97);
    let pulledBytes = 0;
    const transport: Transport = () =>
      Promise.resolve({
        status: 200,
        headers: { 'content-length': String(6 * 1024 * 1024) },
        body: (async function* () {
          for (let i = 0; i < 96; i += 1) {
            pulledBytes += chunk.byteLength;
            yield chunk;
          }
        })(),
        cancel: () => {},
      });
    const service = new WebFetchService(5_000, cap, { resolver, transport });
    const res = await service.fetchPage('https://example.com/big', 1_000);
    expect(res.truncated).toBe(true);
    expect(res.content.length).toBe(1_000);
    expect(pulledBytes).toBeLessThanOrEqual(cap + chunk.byteLength);
  });
});
