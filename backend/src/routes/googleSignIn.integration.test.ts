/**
 * Google sign-in (ADR-0056). A fake verifier stands in for Google through the container seam:
 * nothing here calls Google. It checks the four rules the route exists for — link an existing
 * account by verified e-mail, create a password-less one, stay off when unconfigured, and let
 * `REGISTRATION_ENABLED=false` block new accounts — plus the session it issues.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiError } from '../errors.js';
import type { GoogleIdentity, GoogleTokenVerifier } from '../services/googleSignIn.js';
import { FakeProvider, createTestApp, signUp, type TestContext } from '../test/harness.js';

/** Treats the credential as the e-mail; `unverified:` and `bad` exercise the refusals. */
class FakeVerifier implements GoogleTokenVerifier {
  seen: string[] = [];
  verify(idToken: string): Promise<GoogleIdentity> {
    this.seen.push(idToken);
    if (idToken === 'bad') return Promise.reject(new ApiError('invalid_credentials'));
    const unverified = idToken.startsWith('unverified:');
    const email = unverified ? idToken.slice('unverified:'.length) : idToken;
    return Promise.resolve({ subject: `sub-${email}`, email, emailVerified: !unverified, name: 'Google Person' });
  }
}

const GOOGLE_ENV = { GOOGLE_OAUTH_CLIENT_ID: 'test-client.apps.googleusercontent.com' };
let ctx: TestContext;
const verifier = new FakeVerifier();

beforeAll(async () => {
  ctx = await createTestApp(GOOGLE_ENV, new FakeProvider(), { googleVerifier: verifier });
});

afterAll(async () => {
  await ctx.close();
});

const google = (app: TestContext, credential: string) =>
  app.app.inject({ method: 'POST', url: '/v1/auth/google', payload: { credential } });

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? String(raw[0]) : String(raw);
  return first.split(';')[0]!;
}

describe('POST /v1/auth/google', () => {
  it('links to the existing account with the same verified e-mail and starts its session', async () => {
    const existing = await signUp(ctx);
    const response = await google(ctx, existing.email.toUpperCase());
    expect(response.statusCode).toBe(200);
    const body = response.json() as { user: { id: string; email: string }; created: boolean };
    expect(body).toMatchObject({ user: { id: existing.id, email: existing.email }, created: false });

    const me = await ctx.app.inject({ url: '/v1/auth/me', headers: { cookie: sessionCookie(response) } });
    expect((me.json() as { user: { id: string } }).user.id).toBe(existing.id);
  });

  it('creates a password-less account for a new address, which password sign-in then refuses', async () => {
    const email = `new-${String(Date.now())}@example.test`;
    const response = await google(ctx, email);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { email, name: 'Google Person' }, created: true });

    const again = await google(ctx, email);
    expect(again.json()).toMatchObject({ created: false });

    const password = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'any-password-at-all' },
    });
    expect(password.statusCode).toBe(401);
    expect((password.json() as { error: { code: string } }).error.code).toBe('invalid_credentials');
  });

  it('never links an address Google has not verified, and rejects a bad token', async () => {
    const existing = await signUp(ctx);
    const unverified = await google(ctx, `unverified:${existing.email}`);
    expect(unverified.statusCode).toBe(401);
    expect(unverified.headers['set-cookie']).toBeUndefined();

    const bad = await google(ctx, 'bad');
    expect((bad.json() as { error: { code: string } }).error.code).toBe('invalid_credentials');
  });

  it('answers google_signin_disabled when no client id is configured', async () => {
    const off = await createTestApp({}, new FakeProvider(), { googleVerifier: verifier });
    try {
      const response = await google(off, 'someone@example.test');
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error: { code: string } }).error.code).toBe('google_signin_disabled');
    } finally {
      await off.close();
    }
  });

  it('with registration closed, signs existing accounts in but creates none', async () => {
    const existing = await signUp(ctx);
    const closed = await createTestApp({ ...GOOGLE_ENV, REGISTRATION_ENABLED: 'false' }, new FakeProvider(), {
      googleVerifier: verifier,
    });
    try {
      const known = await google(closed, existing.email);
      expect(known.statusCode).toBe(200);
      const fresh = await google(closed, `closed-${String(Date.now())}@example.test`);
      expect(fresh.statusCode).toBe(403);
      expect((fresh.json() as { error: { code: string } }).error.code).toBe('registration_closed');
    } finally {
      await closed.close();
    }
  });
});
