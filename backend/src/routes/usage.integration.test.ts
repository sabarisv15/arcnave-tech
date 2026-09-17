/**
 * Usage, limits, preferences, and export.
 *
 * The assertions here are mostly about honesty rather than arithmetic: null cost must not
 * become zero, inexact token counts must stay labelled, and a preference the server will not
 * act on must be refused rather than stored and echoed back.
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

const auth = (): { cookie: string } => ({ cookie: user.cookie });

/* -------------------------------------------------------------------------- summary */

describe('usage summary', () => {
  it('starts empty, and reports that nothing is priced rather than that nothing cost anything', async () => {
    const fresh = await signUp(ctx);
    const response = await ctx.app.inject({ url: '/v1/usage', headers: { cookie: fresh.cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      today: { totalTokens: number; costUsd: number | null; requests: number };
      pricingConfigured: boolean;
      limits: { dailyTokenBudget: number | null; timezone: string };
    };

    expect(body.today).toMatchObject({ totalTokens: 0, requests: 0 });
    // Null, not 0: no pricing table is configured in the test environment.
    expect(body.today.costUsd).toBeNull();
    expect(body.pricingConfigured).toBe(false);
    expect(body.limits.dailyTokenBudget).toBeNull();
    expect(body.limits.timezone).toBe('UTC');
  });

  it('prices usage only when a pricing table is configured', async () => {
    const priced = await createTestApp({
      PRICING_TABLE: JSON.stringify({
        'fake-flash': { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      }),
    });
    try {
      const owner = await signUp(priced);
      const response = await priced.app.inject({
        url: '/v1/usage',
        headers: { cookie: owner.cookie },
      });
      expect((response.json() as { pricingConfigured: boolean }).pricingConfigured).toBe(true);
    } finally {
      await priced.close();
    }
  });
});

/* -------------------------------------------------------------------------- limits */

describe('limits', () => {
  it('stores budgets and reports the reset instant in the users own timezone', async () => {
    const owner = await signUp(ctx);
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers: { cookie: owner.cookie },
      payload: { dailyTokenBudget: 50_000, timezone: 'Asia/Kolkata' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      dailyTokenBudget: number;
      timezone: string;
      dailyResetsAt: string;
    };
    expect(body).toMatchObject({ dailyTokenBudget: 50_000, timezone: 'Asia/Kolkata' });
    // Local midnight in Kolkata is 18:30 the previous day in UTC.
    expect(body.dailyResetsAt.endsWith('18:30:00.000Z')).toBe(true);
  });

  it('clears a budget when sent null', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers,
      payload: { monthlyTokenBudget: 1000 },
    });

    const cleared = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers,
      payload: { monthlyTokenBudget: null },
    });
    expect((cleared.json() as { monthlyTokenBudget: number | null }).monthlyTokenBudget).toBeNull();
  });

  it('refuses an output ceiling above what this deployment allows, and says the number', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers: auth(),
      payload: { maxOutputTokens: 999_999 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'validation_error', meta: { ceiling: ctx.cfg.MAX_OUTPUT_TOKENS_CEILING } },
    });
  });

  it('refuses a timezone the server would silently turn into UTC', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers: auth(),
      payload: { timezone: 'Mars/Olympus_Mons' },
    });
    expect(response.statusCode).toBe(422);
  });

  it.each(['fast', 'cheap', 'best'])(
    'refuses the routing preference %j, which the router would silently read as balanced',
    async (routingPreference) => {
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/usage/limits',
        headers: auth(),
        payload: { routingPreference },
      });
      expect(response.statusCode).toBe(422);
    },
  );

  it.each(['economy', 'balanced', 'quality'])(
    'accepts the routing preference %j, which the router acts on',
    async (routingPreference) => {
      const owner = await signUp(ctx);
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/usage/limits',
        headers: { cookie: owner.cookie },
        payload: { routingPreference },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ routingPreference });
    },
  );

  it('refuses a stale version', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers,
      payload: { warnThresholdPct: 50 },
    });

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers,
      payload: { warnThresholdPct: 60, version: 1 },
    });
    expect(stale.statusCode).toBe(409);
  });
});

/* -------------------------------------------------------------------------- preferences */

describe('preferences', () => {
  it('exists for every account at registration', async () => {
    const fresh = await signUp(ctx);
    const response = await ctx.app.inject({
      url: '/v1/preferences',
      headers: { cookie: fresh.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      theme: 'system',
      modelAlias: 'Auto',
      enterToSend: true,
      version: 1,
    });
  });

  it('updates only the fields sent', async () => {
    const owner = await signUp(ctx);
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: { cookie: owner.cookie },
      payload: { theme: 'dark', defaultMode: 'research' },
    });

    expect(response.json()).toMatchObject({
      theme: 'dark',
      defaultMode: 'research',
      // Untouched.
      font: 'sans',
      enterToSend: true,
      version: 2,
    });
  });

  it('refuses a default model this workspace does not offer', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: auth(),
      payload: { modelAlias: 'GPT 5 Terra' },
    });

    expect(response.statusCode).toBe(422);
    expect(String((response.json() as { error: { detail: string } }).error.detail)).toContain(
      'GPT 5 Terra',
    );
  });

  it.each(['Auto', 'Opus 5', 'Gemini 3.8 Flash'])('accepts the real alias %j', async (modelAlias) => {
    const owner = await signUp(ctx);
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers: { cookie: owner.cookie },
      payload: { modelAlias },
    });
    expect(response.statusCode).toBe(200);
  });

  it('does not accept budget fields, which belong to the usage route', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers,
      payload: { dailyTokenBudget: 4242 },
    });

    // Extra keys are stripped by the schema rather than applied, so the budget survives.
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/preferences',
      headers,
      payload: { theme: 'light', dailyTokenBudget: 1 },
    });

    const read = await ctx.app.inject({ url: '/v1/preferences', headers });
    expect(read.json()).toMatchObject({ theme: 'light', dailyTokenBudget: 4242 });
  });
});

/* -------------------------------------------------------------------------- export */

describe('CSV export', () => {
  it('downloads as an attachment with a dated filename', async () => {
    const response = await ctx.app.inject({ url: '/v1/usage/export', headers: auth() });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(String(response.headers['content-disposition'])).toMatch(
      /^attachment; filename="arcnave-usage-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('always emits the header row, even with nothing to report', async () => {
    const fresh = await signUp(ctx);
    const response = await ctx.app.inject({
      url: '/v1/usage/export',
      headers: { cookie: fresh.cookie },
    });

    const lines = response.body.trim().split('\r\n');
    expect(lines[0]).toContain('started_at,completed_at,latency_ms,model_alias');
    expect(lines[0]).toContain('cost_usd');
    expect(lines).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- per message */

describe('per-message usage', () => {
  it('404s a chat the caller does not own rather than reporting an empty list', async () => {
    const owner = await signUp(ctx);
    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: { cookie: owner.cookie },
      payload: { title: 'theirs' },
    });
    const chatId = (chat.json() as { id: string }).id;

    const response = await ctx.app.inject({
      url: `/v1/usage/messages?chatId=${chatId}`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(404);
  });

  it('is empty for a chat with no generations', async () => {
    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: auth(),
      payload: { title: 'quiet' },
    });
    const chatId = (chat.json() as { id: string }).id;

    const response = await ctx.app.inject({
      url: `/v1/usage/messages?chatId=${chatId}`,
      headers: auth(),
    });
    expect(response.json()).toEqual({ items: [] });
  });
});

/* -------------------------------------------------------------------------- isolation */

describe('isolation', () => {
  it('requires a session on every usage route', async () => {
    for (const url of ['/v1/usage', '/v1/usage/limits', '/v1/usage/export', '/v1/preferences']) {
      expect((await ctx.app.inject({ url })).statusCode, url).toBe(401);
    }
  });

  it('never mixes one users totals into anothers', async () => {
    const a = await signUp(ctx);
    const b = await signUp(ctx);

    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/usage/limits',
      headers: { cookie: a.cookie },
      payload: { dailyTokenBudget: 111 },
    });

    const forB = await ctx.app.inject({ url: '/v1/usage', headers: { cookie: b.cookie } });
    expect(
      (forB.json() as { limits: { dailyTokenBudget: number | null } }).limits.dailyTokenBudget,
    ).toBeNull();
  });
});
