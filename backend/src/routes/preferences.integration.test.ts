/**
 * Preferences route integration tests.
 *
 * Verifies the chat font options: 'sans', 'system' and 'dyslexic' (and the older 'serif') are accepted;
 * unknown values and removed 'mono' are rejected with 422 validation_error.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('preferences routes', () => {
  it('loads default preferences with font=sans', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/preferences',
      headers: { cookie: user.cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { font: string; theme: string };
    expect(body.font).toBe('sans');
    expect(body.theme).toBe('system');
  });

  it('accepts the dyslexic-friendly font and persists it', async () => {
    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: { cookie: user.cookie },
      payload: { font: 'dyslexic' },
    });

    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { font: string };
    expect(patched.font).toBe('dyslexic');

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: '/v1/preferences',
      headers: { cookie: user.cookie },
    });

    expect(getRes.statusCode).toBe(200);
    const fetched = getRes.json() as { font: string };
    expect(fetched.font).toBe('dyslexic');
  });

  it('accepts serif font', async () => {
    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: { cookie: user.cookie },
      payload: { font: 'serif' },
    });

    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { font: string };
    expect(patched.font).toBe('serif');
  });

  it('rejects removed mono font with 422 validation_error', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: { cookie: user.cookie },
      payload: { font: 'mono' },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects unknown font value with 422 validation_error', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: { cookie: user.cookie },
      payload: { font: 'comic-sans' },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });
});
