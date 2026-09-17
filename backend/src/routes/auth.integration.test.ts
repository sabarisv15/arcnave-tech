/**
 * Registration gate.
 *
 * `REGISTRATION_ENABLED=false` is the single-account testing mode: sign-up must fail with a
 * typed, machine-readable error rather than a generic 500 or a silent no-op, and login for an
 * account that already exists must be unaffected.
 */
import { describe, expect, it } from 'vitest';

import type { TestContext } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

describe('registration gate', () => {
  it('defaults to open', async () => {
    const ctx = await createTestApp();
    try {
      const user = await signUp(ctx);
      expect(user.email).toContain('@example.test');
    } finally {
      await ctx.close();
    }
  });

  it('refuses new accounts with a typed error when disabled, and leaves login untouched', async () => {
    const seed: TestContext = await createTestApp();
    const existing = await signUp(seed);
    await seed.close();

    const closed = await createTestApp({ REGISTRATION_ENABLED: 'false' });
    try {
      const blocked = await closed.app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { email: 'someone-new@example.test', password: 'correct-horse-battery-staple' },
      });
      expect(blocked.statusCode).toBe(403);
      expect((blocked.json() as { error: { code: string } }).error.code).toBe(
        'registration_closed',
      );

      const login = await closed.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: existing.email, password: 'correct-horse-battery-staple' },
      });
      expect(login.statusCode).toBe(200);
    } finally {
      await closed.close();
    }
  });
});
