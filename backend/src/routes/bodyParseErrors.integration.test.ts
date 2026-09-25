/**
 * Fastify rejects some bodies before any route schema runs (bad JSON, empty JSON, an unknown
 * content type, an oversized body). Those must reach the client as typed `ApiError`s, not as
 * `internal_error` 500s.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CATALOG } from '../errors.js';
import type { TestContext } from '../test/harness.js';
import { createTestApp } from '../test/harness.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await ctx.close();
});

function login(headers: Record<string, string>, payload: string) {
  return ctx.app.inject({ method: 'POST', url: '/v1/auth/login', headers, payload });
}

describe('body parse errors', () => {
  it('maps malformed JSON to validation_error', async () => {
    const res = await login({ 'content-type': 'application/json' }, '{"a":}');
    expect(res.statusCode).toBe(ERROR_CATALOG.validation_error.status);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('maps an empty JSON body to validation_error', async () => {
    const res = await login({ 'content-type': 'application/json' }, '');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('maps an unparseable content type to unsupported_media_type', async () => {
    const res = await login({ 'content-type': 'application/x-nonsense' }, 'x');
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ error: { code: 'unsupported_media_type' } });
  });

  it('maps an oversized body to payload_too_large', async () => {
    const res = await login({ 'content-type': 'application/json' }, `"${'a'.repeat(ctx.app.initialConfig.bodyLimit!)}"`);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });
});
