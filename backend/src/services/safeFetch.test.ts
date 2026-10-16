/**
 * safeFetch refuses every internal target before a byte leaves (ADR-0065, Stage 8 C2, INJ-7).
 *
 * "Before a byte leaves" is checked directly: the transport is a fake that records every
 * connection it was asked to open, and a refused fetch must leave that list empty (or stop at
 * the hop before the refused one). The last block runs the real transport against a local
 * server to prove the connection goes to the pinned address with no second lookup.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ConnectError,
  isPublicAddress,
  nodeTransport,
  safeFetch,
  SafeFetchError,
  type PinnedRequest,
  type Resolver,
  type Transport,
  type TransportResponse,
} from './safeFetch.js';

const PUBLIC_V4 = '93.184.216.34';

interface Recorder {
  transport: Transport;
  opened: PinnedRequest[];
}

/** A transport that answers from a table by URL and records each connection it opens. */
function fakeTransport(
  answer: (req: PinnedRequest) => { status: number; headers?: Record<string, string>; body?: Uint8Array[] },
): Recorder {
  const opened: PinnedRequest[] = [];
  const transport: Transport = (req) => {
    opened.push(req);
    const { status, headers = {}, body = [] } = answer(req);
    const response: TransportResponse = {
      status,
      headers,
      body: (async function* () {
        for (const chunk of body) yield chunk;
      })(),
      cancel: () => {},
    };
    return Promise.resolve(response);
  };
  return { transport, opened };
}

function resolverFrom(table: Record<string, string[]>): Resolver & { calls: string[] } {
  const calls: string[] = [];
  const fn: Resolver = async (host: string) => {
    calls.push(host);
    const list = table[host];
    if (!list) throw new Error('ENOTFOUND');
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return Object.assign(fn, { calls });
}

const limits = { maxBytes: 1024, maxRedirects: 3, timeoutMs: 2_000 };

async function refused(url: string, resolver: Resolver, rec: Recorder): Promise<SafeFetchError> {
  const err = await safeFetch(url, { ...limits, resolver, transport: rec.transport }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SafeFetchError);
  return err as SafeFetchError;
}

describe('safeFetch refuses internal targets before any connection', () => {
  const okEverywhere = () => fakeTransport(() => ({ status: 200, body: [new TextEncoder().encode('hi')] }));

  it('http://[::1]/ is refused and opens no socket', async () => {
    const rec = okEverywhere();
    const err = await refused('http://[::1]/', resolverFrom({}), rec);
    expect(err.code).toBe('url_not_allowed');
    expect(rec.opened).toHaveLength(0);
  });

  it('a public-looking name that resolves to 10.x is refused and opens no socket', async () => {
    const rec = okEverywhere();
    const err = await refused('https://intranet.example.com/x', resolverFrom({ 'intranet.example.com': ['10.1.2.3'] }), rec);
    expect(err.code).toBe('url_not_allowed');
    expect(rec.opened).toHaveLength(0);
  });

  it('checks every DNS answer, not only the first', async () => {
    const rec = okEverywhere();
    const err = await refused(
      'https://mixed.example.com/',
      resolverFrom({ 'mixed.example.com': [PUBLIC_V4, '192.168.1.10'] }),
      rec,
    );
    expect(err.code).toBe('url_not_allowed');
    expect(rec.opened).toHaveLength(0);
  });

  it('a redirect to 169.254.169.254 is refused at that hop; only the public first hop was opened', async () => {
    const rec = fakeTransport((req) =>
      req.url.hostname === 'public.example.com'
        ? { status: 302, headers: { location: 'http://169.254.169.254/computeMetadata/v1/' } }
        : { status: 200, body: [new TextEncoder().encode('metadata')] },
    );
    const err = await refused('https://public.example.com/r', resolverFrom({ 'public.example.com': [PUBLIC_V4] }), rec);
    expect(err.code).toBe('url_not_allowed');
    expect(rec.opened.map((r) => r.url.hostname)).toEqual(['public.example.com']);
  });

  it('a redirect to metadata.google.internal is refused without resolving it', async () => {
    const resolver = resolverFrom({ 'public.example.com': [PUBLIC_V4], 'metadata.google.internal': [PUBLIC_V4] });
    const rec = fakeTransport(() => ({ status: 301, headers: { location: 'http://metadata.google.internal/' } }));
    const err = await refused('https://public.example.com/', resolver, rec);
    expect(err.code).toBe('url_not_allowed');
    expect(resolver.calls).toEqual(['public.example.com']);
    expect(rec.opened).toHaveLength(1);
  });

  it('IPv4-mapped IPv6 is refused, in the literal and as a DNS answer', async () => {
    const rec = okEverywhere();
    expect((await refused('http://[::ffff:127.0.0.1]/', resolverFrom({}), rec)).code).toBe('url_not_allowed');
    expect((await refused('http://[::ffff:a9fe:a9fe]/', resolverFrom({}), rec)).code).toBe('url_not_allowed');
    const viaDns = await refused('https://mapped.example.com/', resolverFrom({ 'mapped.example.com': ['::ffff:10.0.0.1'] }), rec);
    expect(viaDns.code).toBe('url_not_allowed');
    expect(rec.opened).toHaveLength(0);
  });

  it('numeric, octal, hex and decimal spellings of loopback are refused', async () => {
    const rec = okEverywhere();
    for (const url of [
      'http://127.0.0.1/',
      'http://0x7f.0.0.1/',
      'http://0177.0.0.1/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://127.1/',
      'http://0.0.0.0/',
      'http://0/',
    ]) {
      expect((await refused(url, resolverFrom({}), rec)).code, url).toBe('url_not_allowed');
    }
    expect(rec.opened).toHaveLength(0);
  });

  it('refuses internal names, credentials and other schemes without resolving', async () => {
    const resolver = resolverFrom({});
    const rec = okEverywhere();
    expect((await refused('http://localhost:8080/', resolver, rec)).code).toBe('url_not_allowed');
    expect((await refused('http://api.localhost/', resolver, rec)).code).toBe('url_not_allowed');
    expect((await refused('http://metadata.google.internal./', resolver, rec)).code).toBe('url_not_allowed');
    expect((await refused('http://db.c.my-project.internal/', resolver, rec)).code).toBe('url_not_allowed');
    expect((await refused('https://user:pw@example.com/', resolver, rec)).code).toBe('url_not_allowed');
    expect((await refused('file:///etc/passwd', resolver, rec)).code).toBe('invalid_url');
    expect((await refused('gopher://example.com/', resolver, rec)).code).toBe('invalid_url');
    expect(resolver.calls).toEqual([]);
    expect(rec.opened).toHaveLength(0);
  });

  it('a rebinding resolver (public first, private second) is asked once and the public answer is pinned', async () => {
    let asked = 0;
    const rebinding: Resolver = async () => {
      asked += 1;
      return [{ address: asked === 1 ? PUBLIC_V4 : '127.0.0.1', family: 4 }];
    };
    const rec = fakeTransport(() => ({ status: 200, body: [new TextEncoder().encode('page')] }));
    const res = await safeFetch('https://rebind.example.com/', { ...limits, resolver: rebinding, transport: rec.transport });
    expect(await res.text()).toBe('page');
    expect(asked).toBe(1);
    expect(rec.opened.map((r) => r.address)).toEqual([PUBLIC_V4]);
  });

  it('a rebinding resolver that turns private on a redirect hop is refused at that hop', async () => {
    let asked = 0;
    const rebinding: Resolver = async () => {
      asked += 1;
      return [{ address: asked === 1 ? PUBLIC_V4 : '10.0.0.5', family: 4 }];
    };
    const rec = fakeTransport(() => ({ status: 307, headers: { location: '/next' } }));
    const err = await refused('https://rebind.example.com/', rebinding, rec);
    expect(err.code).toBe('url_not_allowed');
    expect(rec.opened).toHaveLength(1);
  });
});

describe('safeFetch limits', () => {
  const resolver = resolverFrom({ 'a.example.com': [PUBLIC_V4], 'b.example.com': ['2606:4700::1111'] });

  it('follows redirects up to the limit, checking each hop, then refuses', async () => {
    let n = 0;
    const loop = fakeTransport(() => ({ status: 302, headers: { location: `https://a.example.com/${String(++n)}` } }));
    const err = await refused('https://a.example.com/', resolver, loop);
    expect(err.code).toBe('too_many_redirects');
    expect(loop.opened).toHaveLength(limits.maxRedirects + 1);

    const once = fakeTransport((req) =>
      req.url.hostname === 'a.example.com'
        ? { status: 301, headers: { location: 'https://b.example.com/end' } }
        : { status: 200, body: [new TextEncoder().encode('end')] },
    );
    const res = await safeFetch('https://a.example.com/', { ...limits, resolver, transport: once.transport });
    expect(res.url).toBe('https://b.example.com/end');
    expect(res.redirects).toBe(1);
    expect(once.opened.map((r) => r.address)).toEqual([PUBLIC_V4, '2606:4700::1111']);
  });

  it('stops reading the body past the byte ceiling', async () => {
    const big = new Uint8Array(600);
    const rec = fakeTransport(() => ({ status: 200, body: [big, big, big] }));
    const res = await safeFetch('https://a.example.com/', { ...limits, resolver, transport: rec.transport });
    await expect(res.bytes()).rejects.toMatchObject({ code: 'too_large' });
  });

  it('refuses a declared Content-Length over the ceiling before reading', async () => {
    let read = false;
    const rec: Transport = () =>
      Promise.resolve({
        status: 200,
        headers: { 'content-length': '999999' },
        body: (async function* () {
          read = true;
          yield new Uint8Array(1);
        })(),
        cancel: () => {},
      });
    const res = await safeFetch('https://a.example.com/', { ...limits, resolver, transport: rec });
    await expect(res.bytes()).rejects.toMatchObject({ code: 'too_large' });
    expect(read).toBe(false);
  });

  it('a cancelled caller fetches nothing; a slow page ends as timeout', async () => {
    const rec = fakeTransport(() => ({ status: 200 }));
    const aborted = AbortSignal.abort();
    await expect(
      safeFetch('https://a.example.com/', { ...limits, resolver, transport: rec.transport, signal: aborted }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(rec.opened).toHaveLength(0);

    const hang: Transport = (req) =>
      new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(
      safeFetch('https://a.example.com/', { ...limits, timeoutMs: 50, resolver, transport: hang }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('never puts the URL in an error message', async () => {
    const err = await refused('http://10.9.8.7/secret-path?token=abc', resolver, fakeTransport(() => ({ status: 200 })));
    expect(err.message).not.toContain('10.9.8.7');
    expect(err.message).not.toContain('secret-path');
  });
});

describe('isPublicAddress', () => {
  it('passes global unicast only', () => {
    for (const ok of [PUBLIC_V4, '8.8.8.8', '2606:4700::1111', '2a00:1450:4001:80b::200e']) {
      expect(isPublicAddress(ok), ok).toBe(true);
    }
    for (const bad of [
      '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '127.0.0.1', '0.0.0.0', '100.64.0.1',
      '100.127.255.255', '169.254.169.254', '224.0.0.1', '255.255.255.255', '198.18.0.1',
      '::', '::1', '::ffff:8.8.8.8', '::ffff:7f00:1', '::127.0.0.1', '64:ff9b::a00:1', 'fc00::1', 'fd12:3456::1',
      'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1', '2002:a00:1::1', '2001::1', 'not-an-ip',
    ]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });
});

describe('nodeTransport connects to the pinned address', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it('uses the pinned address for a name that does not resolve, and sends the name as Host', async () => {
    let seen: IncomingHttpHeaders | undefined;
    server = createServer((req, res) => {
      seen = req.headers;
      res.end('pinned');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    // `.invalid` never resolves (RFC 6761): reaching the server proves no lookup happened.
    const res = await nodeTransport({
      url: new URL(`http://pinned.invalid:${String(port)}/p?q=1`),
      address: '127.0.0.1',
      family: 4,
      method: 'GET',
      headers: { 'user-agent': 't' },
      signal: AbortSignal.timeout(2_000),
    });
    const chunks: Uint8Array[] = [];
    for await (const c of res.body) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe('pinned');
    expect(seen?.host).toBe(`pinned.invalid:${String(port)}`);
  });
});

describe('safeFetch tries the checked addresses in turn (review fix 1)', () => {
  const page = () =>
    (async function* () {
      yield new TextEncoder().encode('ok');
    })();

  it('first address fails to connect → the next checked one is used, IPv4 first, one lookup only', async () => {
    let lookups = 0;
    const resolver: Resolver = async () => {
      lookups += 1;
      return [
        { address: '2606:4700::1111', family: 6 },
        { address: '93.184.216.34', family: 4 },
        { address: '93.184.216.35', family: 4 },
      ];
    };
    const tried: string[] = [];
    const transport: Transport = (req) => {
      tried.push(req.address);
      if (req.address === '93.184.216.34') return Promise.reject(new ConnectError('ENETUNREACH'));
      return Promise.resolve({ status: 200, headers: {}, body: page(), cancel: () => {} });
    };
    const res = await safeFetch('https://dual.example.com/', { ...limits, resolver, transport });
    expect(await res.text()).toBe('ok');
    expect(tried).toEqual(['93.184.216.34', '93.184.216.35']);
    expect(lookups).toBe(1);
  });

  it('a dual-stack host whose first answer is AAAA falls back to IPv6 only after IPv4 fails', async () => {
    const resolver: Resolver = async () => [
      { address: '2606:4700::1111', family: 6 },
      { address: '93.184.216.34', family: 4 },
    ];
    const tried: string[] = [];
    const transport: Transport = (req) => {
      tried.push(req.address);
      return req.family === 4
        ? Promise.reject(new ConnectError('ECONNREFUSED'))
        : Promise.resolve({ status: 200, headers: {}, body: page(), cancel: () => {} });
    };
    await safeFetch('https://dual.example.com/', { ...limits, resolver, transport });
    expect(tried).toEqual(['93.184.216.34', '2606:4700::1111']);
  });

  it('never tries a blocked address, and does not move on after a non-connect failure', async () => {
    const tried: string[] = [];
    const transport: Transport = (req) => {
      tried.push(req.address);
      return Promise.reject(new Error('socket hang up'));
    };
    const mixed: Resolver = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.9', family: 4 },
    ];
    await expect(safeFetch('https://m.example.com/', { ...limits, resolver: mixed, transport })).rejects.toMatchObject({
      code: 'url_not_allowed',
    });
    expect(tried).toEqual([]);

    const two: Resolver = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ];
    await expect(safeFetch('https://t.example.com/', { ...limits, resolver: two, transport })).rejects.toMatchObject({
      code: 'url_not_accessible',
    });
    expect(tried).toEqual(['93.184.216.34']);
  });

  it('the real transport reports a refused connect as ConnectError', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', () => resolve()));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const err = await nodeTransport({
      url: new URL(`http://pinned.invalid:${String(port)}/`),
      address: '127.0.0.1',
      family: 4,
      method: 'GET',
      headers: {},
      signal: AbortSignal.timeout(2_000),
      connectTimeoutMs: 1_000,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe('ECONNREFUSED');
  });
});

describe('safeFetch connect timeout and deadline (review r2)', () => {
  const three: Resolver = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '93.184.216.35', family: 4 },
    { address: '93.184.216.36', family: 4 },
  ];

  /**
   * A connector with the real transport's contract: an address in `dead` never connects, so it
   * fails with ConnectError('ETIMEDOUT') once the per-address connect timeout passes, or with an
   * abort when the overall deadline fires first.
   */
  function connector(dead: Set<string>): { transport: Transport; tried: string[]; timeouts: number[] } {
    const tried: string[] = [];
    const timeouts: number[] = [];
    const transport: Transport = (req) => {
      tried.push(req.address);
      timeouts.push(req.connectTimeoutMs ?? -1);
      if (!dead.has(req.address)) {
        return Promise.resolve({
          status: 200,
          headers: {},
          body: (async function* () {
            yield new TextEncoder().encode('ok');
          })(),
          cancel: () => {},
        });
      }
      return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new ConnectError('ETIMEDOUT')), req.connectTimeoutMs);
        req.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    };
    return { transport, tried, timeouts };
  }

  it('an address that never connects times out after the connect timeout and the next is used', async () => {
    const c = connector(new Set(['93.184.216.34']));
    const res = await safeFetch('https://slow.example.com/', {
      ...limits,
      timeoutMs: 2_000,
      connectTimeoutMs: 50,
      resolver: three,
      transport: c.transport,
    });
    expect(await res.text()).toBe('ok');
    expect(c.tried).toEqual(['93.184.216.34', '93.184.216.35']);
    expect(c.timeouts).toEqual([50, 50]);
  });

  it('the overall deadline stops the address loop with a timeout; later addresses are never tried', async () => {
    const c = connector(new Set(['93.184.216.34', '93.184.216.35', '93.184.216.36']));
    const started = Date.now();
    await expect(
      safeFetch('https://slow.example.com/', {
        ...limits,
        timeoutMs: 120,
        connectTimeoutMs: 100,
        resolver: three,
        transport: c.transport,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(c.tried).toEqual(['93.184.216.34', '93.184.216.35']);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('safeFetch prefix (review fix 2)', () => {
  it('reads at most the ceiling and says the body was cut', async () => {
    let pulled = 0;
    const transport: Transport = () =>
      Promise.resolve({
        status: 200,
        headers: { 'content-length': '5000' },
        body: (async function* () {
          for (let i = 0; i < 50; i += 1) {
            pulled += 1;
            yield new Uint8Array(100).fill(97);
          }
        })(),
        cancel: () => {},
      });
    const resolver: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];
    const res = await safeFetch('https://a.example.com/', { ...limits, resolver, transport });
    const body = await res.prefix();
    expect(body.bytes.byteLength).toBe(limits.maxBytes);
    expect(body.truncated).toBe(true);
    expect(pulled).toBeLessThanOrEqual(Math.ceil(limits.maxBytes / 100) + 1);
  });
});
