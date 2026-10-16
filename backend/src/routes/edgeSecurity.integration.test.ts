/**
 * P04 exit tests through the real app (ADR-0065): rate-limit buckets behind a proxy, /models
 * signed-in only, the Origin check on state-changing requests, headers, /health and /docs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TestContext } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

/** Cloud Run's front end: the socket peer, the same for every client. */
const PROXY = '35.191.10.20';
const FRONTEND = 'https://www.arcnave.tech';

describe('rate limit buckets behind one proxy (A-09)', () => {
  it('two signed-in users behind the same proxy and client address get separate buckets', async () => {
    ctx = await createTestApp({ RATE_LIMIT_WRITE_PER_MINUTE: '3', TRUST_PROXY_HOPS: '1' });
    const a = await signUp(ctx, 'A');
    const b = await signUp(ctx, 'B');
    const me = (cookie: string) =>
      ctx!.app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        remoteAddress: PROXY,
        headers: { cookie, 'x-forwarded-for': '198.51.100.4' },
      });

    for (let i = 0; i < 3; i += 1) expect((await me(a.cookie)).statusCode).toBe(200);
    const limited = await me(a.cookie);
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: { code: string } }).error.code).toBe('rate_limit');
    // Same proxy, same client address, another account: its own bucket.
    expect((await me(b.cookie)).statusCode).toBe(200);
  });

  it('a spoofed leftmost X-Forwarded-For entry does not move an anonymous caller to a new bucket', async () => {
    ctx = await createTestApp({ RATE_LIMIT_WRITE_PER_MINUTE: '3', TRUST_PROXY_HOPS: '1' });
    const anon = (xff: string) =>
      ctx!.app.inject({ method: 'GET', url: '/v1/auth/me', remoteAddress: PROXY, headers: { 'x-forwarded-for': xff } });

    // The front end appends the real client (203.0.113.9); the client wrote everything before it.
    for (const spoof of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      expect((await anon(`${spoof}, 203.0.113.9`)).statusCode).toBe(200);
    }
    expect((await anon('4.4.4.4, 203.0.113.9')).statusCode).toBe(429);
    expect((await anon('203.0.113.9')).statusCode).toBe(429);
    // A different real client behind the same proxy is not locked out by that one.
    expect((await anon('203.0.113.10')).statusCode).toBe(200);
  });
});

describe('GET /v1/models and POST /v1/models/refresh are signed-in only (S2-3)', () => {
  it('answers 401 without a session and 200/204 with one', async () => {
    ctx = await createTestApp();
    const probes = vi.spyOn(ctx.provider, 'probe');
    const list = await ctx.app.inject({ method: 'GET', url: '/v1/models' });
    expect(list.statusCode).toBe(401);
    expect((list.json() as { error: { code: string } }).error.code).toBe('unauthorized');
    const probe = await ctx.app.inject({ method: 'GET', url: '/v1/models?probe=true' });
    expect(probe.statusCode).toBe(401);
    // Refused before the registry: an anonymous probe spends no provider call.
    expect(probes).not.toHaveBeenCalled();
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/models/refresh' })).statusCode).toBe(401);

    const user = await signUp(ctx);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/models', headers: { cookie: user.cookie } })).statusCode).toBe(200);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/v1/models/refresh', headers: { cookie: user.cookie } })).statusCode,
    ).toBe(204);
  });
});

describe('Origin check on state-changing requests (SD-1f)', () => {
  it('refuses a cross-site POST /v1/auth/logout with a typed 403 and keeps the session', async () => {
    ctx = await createTestApp({ CORS_ORIGINS: FRONTEND });
    const user = await signUp(ctx);

    const forged = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: user.cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(forged.statusCode).toBe(403);
    expect((forged.json() as { error: { code: string } }).error.code).toBe('origin_not_allowed');
    const still = await ctx.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: user.cookie } });
    expect((still.json() as { user: unknown }).user).not.toBeNull();

    const noOrigin = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: user.cookie, 'sec-fetch-site': 'cross-site' },
    });
    expect(noOrigin.statusCode).toBe(403);

    const real = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: user.cookie, origin: FRONTEND, 'sec-fetch-site': 'cross-site' },
    });
    expect(real.statusCode).toBe(204);
    expect(real.headers['access-control-allow-origin']).toBe(FRONTEND);
  });

  it('refuses the body-less POST /chats/:id/stop cross-site; a client that is not a browser passes', async () => {
    ctx = await createTestApp({ CORS_ORIGINS: FRONTEND });
    const user = await signUp(ctx);
    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: { cookie: user.cookie, origin: FRONTEND },
      payload: { title: 'stop me' },
    });
    expect(chat.statusCode).toBe(201);
    const chatId = (chat.json() as { id: string }).id;

    const forged = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/stop`,
      headers: { cookie: user.cookie, origin: 'null' },
    });
    expect(forged.statusCode).toBe(403);
    const plain = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/stop`, headers: { cookie: user.cookie } });
    expect(plain.statusCode).not.toBe(403);
  });

  it('a form post from Google to the sign-in route is refused; the app posting the token is not', async () => {
    ctx = await createTestApp({ CORS_ORIGINS: FRONTEND });
    const fromGoogle = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      headers: {
        origin: 'https://accounts.google.com',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'credential=x&g_csrf_token=y',
    });
    expect(fromGoogle.statusCode).toBe(403);
    expect((fromGoogle.json() as { error: { code: string } }).error.code).toBe('origin_not_allowed');

    // Popup mode: the app's own page posts JSON. It passes the Origin check and reaches the route
    // (which answers that Google sign-in is off in this test app).
    const fromApp = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/google',
      headers: { origin: FRONTEND, 'sec-fetch-site': 'cross-site' },
      payload: { credential: 'x' },
    });
    expect((fromApp.json() as { error: { code: string } }).error.code).toBe('google_signin_disabled');
  });

  it('leaves reads alone', async () => {
    ctx = await createTestApp({ CORS_ORIGINS: FRONTEND });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('platform routes and headers', () => {
  it('serves /health and keeps /healthz, both with the security headers; a 404 carries them too', async () => {
    ctx = await createTestApp();
    for (const url of ['/health', '/healthz']) {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect((res.json() as { status: string }).status).toBe('ok');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toContain('max-age=63072000');
    }
    const missing = await ctx.app.inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-frame-options']).toBe('DENY');
    expect(missing.headers['referrer-policy']).toBe('no-referrer');
    expect(missing.headers['permissions-policy']).toContain('camera=()');
    expect(missing.headers['content-security-policy-report-only']).toContain("frame-ancestors 'none'");
  });

  it('serves Swagger UI only when docs are enabled', async () => {
    ctx = await createTestApp();
    const on = await ctx.app.inject({ method: 'GET', url: '/docs' });
    expect([200, 302]).toContain(on.statusCode);
    await ctx.close();

    ctx = await createTestApp({ DOCS_ENABLED: 'false' });
    expect((await ctx.app.inject({ method: 'GET', url: '/docs' })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(404);
  });
});
