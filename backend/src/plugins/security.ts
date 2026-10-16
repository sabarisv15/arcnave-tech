/**
 * Request-edge security (P04, ADR-0065): who the client is behind the proxy, which sites may send
 * state-changing requests, and the response headers every API answer carries.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { ApiError } from '../errors.js';

/**
 * Fastify `trustProxy` for a fixed number of proxy hops.
 *
 * Not `true` (that trusts the leftmost X-Forwarded-For entry, which the client writes) and not a
 * plain number: Fastify 5.12 treats a numeric trustProxy as "trust nothing" because a hop count
 * cannot validate the peer. Behind Cloud Run the peer is always Google's front end, which appends
 * the address it saw; with `hops` = 1 the client address is that rightmost entry, and whatever a
 * client puts further left is never read.
 */
export function trustProxyHops(hops: number): false | ((address: string, hop: number) => boolean) {
  if (hops <= 0) return false;
  return (_address, hop) => hop < hops;
}

/** Rate-limit bucket: the signed-in user, else the client address. Prefixed so the two never collide. */
export function rateLimitKey(request: FastifyRequest): string {
  return request.user ? `user:${request.user.id}` : `ip:${request.ip}`;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Whether a state-changing request may proceed (SD-1f, Stage 16 SE2 "Origin check").
 *
 * The session cookie is SameSite=None (web and API are on different sites), so a browser attaches
 * it to a request any site starts. A browser always says where a POST/PUT/PATCH/DELETE came from:
 * - Sec-Fetch-Site same-origin: the app itself (one origin behind a proxy); allowed whatever the
 *   Origin, because a page cannot forge that header.
 * - Otherwise, Origin present: it must be one of CORS_ORIGINS. `null` (sandboxed frames, some redirects) is
 *   not, and neither is a Google page posting a form: sign-in uses Google's popup and the app
 *   posts the token itself, so a form post from accounts.google.com is never ours.
 * - No Origin but Sec-Fetch-Site says the request crossed sites: refused.
 * - Neither header: not a browser (curl, a server, a health probe). A cookie can only ride along
 *   if the caller already holds it, so there is nothing to forge.
 */
export function originAllowed(
  method: string,
  origin: string | undefined,
  secFetchSite: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (!STATE_CHANGING.has(method.toUpperCase())) return true;
  const site = secFetchSite?.toLowerCase();
  // The browser sets Sec-Fetch-Site and a page cannot forge it: same-origin means the app itself
  // (the compose stack's nginx serves app and API on one origin, on whatever port or host it was
  // opened by), so the allowlist, which exists for cross-origin callers, does not apply.
  if (site === 'same-origin') return true;
  if (origin !== undefined) return allowed.has('*') || allowed.has(origin.replace(/\/+$/, ''));
  return site !== 'cross-site' && site !== 'same-site';
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Headers on every API response (Stage 16 SE10, PH-2). The CSP is report-only: an API answers
 * JSON, but /docs (development) renders a page, and a wrong enforced policy is found by users,
 * not by tests. X-Frame-Options enforces the no-framing rule meanwhile.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy-Report-Only': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

async function securityPlugin(app: FastifyInstance, opts: { allowedOrigins: readonly string[] }): Promise<void> {
  const allowed = new Set(opts.allowedOrigins.map((o) => o.replace(/\/+$/, '')));

  app.addHook('onRequest', async (request, reply) => {
    // Set on the raw response so a handler that writes its own head (the SSE stream) keeps
    // them: Node merges setHeader values into writeHead.
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) reply.raw.setHeader(name, value);

    if (!originAllowed(request.method, single(request.headers.origin), single(request.headers['sec-fetch-site']), allowed)) {
      throw new ApiError('origin_not_allowed');
    }
  });
}

export default fp(securityPlugin, { name: 'security' });
