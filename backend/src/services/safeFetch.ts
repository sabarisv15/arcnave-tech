/**
 * The one way backend code fetches a URL that a user, a model or a third-party page chose
 * (Stage 8 C2, Stage 16 INJ-7, ADR-0065).
 *
 * Every hop is checked before a byte leaves:
 * - http and https only, no credentials in the URL;
 * - the host name is refused when it names something internal (localhost, *.internal, the
 *   metadata server);
 * - the name is resolved once, every address it resolves to is checked, and the connection is
 *   made to the address that was checked (pinned through the socket's `lookup`), so a resolver
 *   that answers differently the second time (DNS rebinding) is never asked again;
 * - redirects are not followed by the HTTP client: each Location is a new hop with the same
 *   checks, up to a configured count;
 * - the body is read as a stream and abandoned past a byte ceiling; one deadline covers the
 *   whole fetch.
 *
 * Only global unicast addresses pass. Address literals in any spelling the URL parser accepts
 * (octal, hex, a single decimal, IPv4-mapped IPv6) are canonicalised by WHATWG `URL` first and
 * then classified like any other address.
 *
 * The resolver and the transport are injectable so tests can prove a refusal happens before any
 * socket is opened.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import { config } from '../config.js';

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'url_not_allowed'
  | 'dns_failed'
  | 'too_many_redirects'
  | 'too_large'
  | 'timeout'
  | 'aborted'
  | 'url_not_accessible';

/**
 * A refused or failed fetch. The message never contains the URL or the address: it reaches the
 * model as a tool result and the logs as an error type (Stage 17 NO_CONTENT).
 */
export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Name → every address. The default asks the system resolver once, as a connection would. */
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface PinnedRequest {
  url: URL;
  /** The checked address the connection must use. */
  address: string;
  family: 4 | 6;
  method: 'GET' | 'HEAD';
  headers: Record<string, string>;
  signal: AbortSignal;
  /** How long the TCP connect to `address` may take before the next checked address is tried. */
  connectTimeoutMs?: number;
}

/**
 * The transport could not open a connection to the address (refused, unreachable, connect
 * timeout) and sent nothing. Only this error moves safeFetch on to the next checked address.
 */
export class ConnectError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`connect failed: ${code}`);
    this.name = 'ConnectError';
    this.code = code;
  }
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Drop the connection without reading the rest of the body. */
  cancel(): void;
}

/** Opens one connection to `address` and sends one request. Never resolves a name. */
export type Transport = (request: PinnedRequest) => Promise<TransportResponse>;

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Defaults to SAFE_FETCH_MAX_BYTES. */
  maxBytes?: number;
  /** Defaults to SAFE_FETCH_MAX_REDIRECTS; a caller with longer legitimate chains passes its own. */
  maxRedirects?: number;
  /** Whole fetch, every hop and the body. Defaults to SAFE_FETCH_TIMEOUT_MS (N-43). */
  timeoutMs?: number;
  /** One TCP connect attempt. Defaults to SAFE_FETCH_CONNECT_TIMEOUT_MS. */
  connectTimeoutMs?: number;
  resolver?: Resolver;
  transport?: Transport;
}

export interface SafeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  /** The URL that answered, after redirects. */
  readonly url: string;
  readonly redirects: number;
  header(name: string): string | undefined;
  /** The body, refused past `maxBytes` (the read stops there). */
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  /**
   * The first `maxBytes` of the body: reading stops at the ceiling and the connection is dropped,
   * so memory stays bounded; `truncated` says whether anything was left unread.
   */
  prefix(): Promise<{ bytes: Uint8Array; truncated: boolean }>;
  cancel(): void;
}

/* -------------------------------------------------------------------------- addresses */

function parseIPv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const V4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network", includes 0.0.0.0
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes the metadata server 169.254.169.254
  ['172.16.0.0', 12], // RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

const V4_RANGES = V4_BLOCKED.map(([base, bits]) => {
  const size = 2 ** (32 - bits);
  const start = parseIPv4(base)!;
  return { start, end: start + size - 1 };
});

function ipv4Allowed(address: string): boolean {
  const value = parseIPv4(address);
  if (value === null) return false;
  return !V4_RANGES.some((r) => value >= r.start && value <= r.end);
}

/** Eight 16-bit groups, from the WHATWG canonical form (no dotted tail, `::` expanded here). */
function ipv6Groups(address: string): number[] | null {
  if (address.includes('%')) return null; // a zone id is a link-local scope
  let canonical: string;
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    // benign: not an IPv6 literal: not a blocked address of that form
    return null;
  }
  const [head = '', tail] = canonical.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...right].map((g) =>
    parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function ipv6Allowed(address: string): boolean {
  const g = ipv6Groups(address);
  if (!g) return false;
  const [h0 = 0, h1 = 0] = g;
  // Only global unicast (2000::/3). This alone refuses ::, ::1, IPv4-mapped (::ffff:0:0/96) and
  // IPv4-compatible addresses, NAT64 64:ff9b::/96, fc00::/7, fe80::/10, fec0::/10, ff00::/8.
  if ((h0 & 0xe000) !== 0x2000) return false;
  if (h0 === 0x2001 && h1 < 0x0200) return false; // 2001::/23 protocol assignments (Teredo, ORCHID)
  if (h0 === 0x2001 && h1 === 0x0db8) return false; // documentation
  if (h0 === 0x2002) return false; // 6to4 carries an IPv4 address of any kind
  if (h0 === 0x3fff && h1 < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

/** True only for an address a public web page can have. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4Allowed(address);
  if (family === 6) return ipv6Allowed(address);
  return false;
}

const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal']);
const BLOCKED_SUFFIXES = ['.localhost', '.internal', '.local', '.home.arpa'];

function hostOf(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function checkUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('invalid_url', 'only http and https URLs can be fetched.');
  }
  if (url.username || url.password) {
    throw new SafeFetchError('url_not_allowed', 'a URL carrying credentials is not fetched.');
  }
  const host = hostOf(url);
  if (!host) throw new SafeFetchError('invalid_url', 'the URL has no host.');
  if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SafeFetchError('url_not_allowed', 'the host is internal.');
  }
}

/* -------------------------------------------------------------------------- defaults */

export const systemResolver: Resolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family }));
};

/**
 * Connects to the pinned address only. `lookup` answers with that address whatever the socket
 * asks (Node 22's happy-eyeballs asks for `all`), so no name is ever resolved here.
 */
export const nodeTransport: Transport = (req) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const pinned = ((_host: string, options: unknown, callback: (...args: unknown[]) => void) => {
      const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
      if (all) callback(null, [{ address: req.address, family: req.family }]);
      else callback(null, req.address, req.family);
    }) as unknown as LookupFunction;
    const host = hostOf(req.url);
    const client = req.url.protocol === 'https:' ? https : http;
    const outgoing = client.request(
      {
        protocol: req.url.protocol,
        host,
        port: req.url.port || undefined,
        path: `${req.url.pathname}${req.url.search}`,
        method: req.method,
        headers: { ...req.headers, host: req.url.host },
        lookup: pinned,
        // TLS still verifies the certificate against the name, not the address.
        ...(isIP(host) ? {} : { servername: host }),
        agent: false,
        signal: req.signal,
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: res,
          cancel: () => res.destroy(),
        });
      },
    );
    // A failure before the TCP connect completes sent nothing, so the caller may try the next
    // checked address; anything after the connect is a real failure of this request.
    let connected = false;
    let connectTimer: NodeJS.Timeout | undefined;
    outgoing.on('socket', (socket) => {
      const done = (): void => {
        connected = true;
        clearTimeout(connectTimer);
      };
      if (!socket.connecting) return done();
      socket.once('connect', done);
      if (req.connectTimeoutMs) {
        connectTimer = setTimeout(() => outgoing.destroy(new ConnectError('ETIMEDOUT')), req.connectTimeoutMs);
      }
    });
    outgoing.on('error', (err) => {
      clearTimeout(connectTimer);
      const code = (err as NodeJS.ErrnoException).code;
      if (err instanceof ConnectError) reject(err);
      else if (!connected && !req.signal.aborted && code && CONNECT_ERRORS.has(code)) reject(new ConnectError(code));
      else reject(err);
    });
    outgoing.end();
  });

const CONNECT_ERRORS = new Set(['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ETIMEDOUT']);

/* -------------------------------------------------------------------------- fetch */

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function headerValue(headers: TransportResponse['headers'], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Every address of the host, each one checked, IPv4 first: an instance with no IPv6 egress
 * (Cloud Run without it) must not fail a dual-stack host whose first answer is AAAA.
 */
async function pin(url: URL, resolver: Resolver): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const host = hostOf(url);
  const literal = isIP(host);
  let answers: readonly ResolvedAddress[];
  if (literal) {
    answers = [{ address: host, family: literal }];
  } else {
    try {
      answers = await resolver(host);
    } catch {
      throw new SafeFetchError('dns_failed', 'the host name did not resolve.');
    }
  }
  if (answers.length === 0) throw new SafeFetchError('dns_failed', 'the host name did not resolve.');
  // Every answer, not the first: a name with one public and one private address is refused,
  // because which one a client would use is not ours to choose.
  for (const answer of answers) {
    if (!isPublicAddress(answer.address)) {
      throw new SafeFetchError('url_not_allowed', 'the address is private, internal or reserved.');
    }
  }
  const targets = answers.map((a) => ({ address: a.address, family: isIP(a.address) === 6 ? (6 as const) : (4 as const) }));
  return [...targets.filter((t) => t.family === 4), ...targets.filter((t) => t.family === 6)];
}

function failure(err: unknown, signal: AbortSignal, caller?: AbortSignal): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  if (caller?.aborted) return new SafeFetchError('aborted', 'the request was cancelled.');
  if (signal.aborted) return new SafeFetchError('timeout', 'the page took too long to answer.');
  return new SafeFetchError('url_not_accessible', 'the page could not be reached.');
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const needDefaults =
    options.maxBytes === undefined ||
    options.maxRedirects === undefined ||
    options.timeoutMs === undefined ||
    options.connectTimeoutMs === undefined;
  const cfg = needDefaults ? config() : undefined;
  const maxBytes = options.maxBytes ?? cfg!.SAFE_FETCH_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? cfg!.SAFE_FETCH_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? cfg!.SAFE_FETCH_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? cfg!.SAFE_FETCH_CONNECT_TIMEOUT_MS;
  const resolver = options.resolver ?? systemResolver;
  const transport = options.transport ?? nodeTransport;
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    'user-agent': 'ArcNave-Bot/1.0',
    // Uncompressed, so the byte ceiling counts what crosses the wire.
    'accept-encoding': 'identity',
    ...Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };

  // AbortSignal.any is already aborted when an input is, so a cancelled caller never fetches.
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('invalid_url', 'the URL could not be parsed.');
  }

  let redirects = 0;
  for (;;) {
    let response: TransportResponse;
    try {
      checkUrl(url);
      if (signal.aborted) throw new Error('aborted');
      const targets = await pin(url, resolver);
      // The checked addresses in turn, never a new lookup; only a failed connect moves on.
      let opened: TransportResponse | undefined;
      for (let i = 0; i < targets.length && !opened; i += 1) {
        if (signal.aborted) throw new Error('aborted');
        try {
          opened = await transport({ url, ...targets[i]!, method, headers, signal, connectTimeoutMs });
        } catch (err) {
          if (!(err instanceof ConnectError) || i === targets.length - 1) throw err;
        }
      }
      response = opened!;
    } catch (err) {
      throw failure(err, signal, options.signal);
    }

    const location = headerValue(response.headers, 'location');
    if (REDIRECTS.has(response.status) && location) {
      response.cancel();
      if (redirects >= maxRedirects) {
        throw new SafeFetchError('too_many_redirects', `more than ${String(maxRedirects)} redirects.`);
      }
      redirects += 1;
      try {
        url = new URL(location, url);
      } catch {
        throw new SafeFetchError('invalid_url', 'a redirect pointed to an invalid URL.');
      }
      continue;
    }

    const finalUrl = url.toString();
    const current = response;
    let consumed = false;
    const bytes = async (): Promise<Uint8Array> => {
      if (consumed) throw new SafeFetchError('url_not_accessible', 'the body was already read.');
      consumed = true;
      const declared = Number(headerValue(current.headers, 'content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        current.cancel();
        throw new SafeFetchError('too_large', `the page is larger than ${String(maxBytes)} bytes.`);
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for await (const chunk of current.body) {
          total += chunk.byteLength;
          if (total > maxBytes) {
            current.cancel();
            throw new SafeFetchError('too_large', `the page is larger than ${String(maxBytes)} bytes.`);
          }
          chunks.push(chunk);
        }
      } catch (err) {
        throw failure(err, signal, options.signal);
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    };

    const prefix = async (): Promise<{ bytes: Uint8Array; truncated: boolean }> => {
      if (consumed) throw new SafeFetchError('url_not_accessible', 'the body was already read.');
      consumed = true;
      const chunks: Uint8Array[] = [];
      let total = 0;
      let truncated = false;
      try {
        for await (const chunk of current.body) {
          const room = maxBytes - total;
          if (chunk.byteLength > room) {
            if (room > 0) chunks.push(chunk.subarray(0, room));
            total += room;
            truncated = true;
            current.cancel();
            break;
          }
          chunks.push(chunk);
          total += chunk.byteLength;
        }
      } catch (err) {
        throw failure(err, signal, options.signal);
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes: out, truncated };
    };

    return {
      ok: current.status >= 200 && current.status < 300,
      status: current.status,
      url: finalUrl,
      redirects,
      header: (name) => headerValue(current.headers, name),
      bytes,
      text: async () => new TextDecoder('utf-8', { fatal: false }).decode(await bytes()),
      prefix,
      cancel: () => current.cancel(),
    };
  }
}
