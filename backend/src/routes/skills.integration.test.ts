import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, signUp, type TestContext } from '../test/harness.js';

let ctx: TestContext;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestApp();
  const user = await signUp(ctx);
  cookie = user.cookie;
});

afterAll(async () => {
  await ctx?.close();
});

describe('Skills REST API', () => {
  it('GET /v1/skills requires authentication', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/skills',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /v1/skills returns list of available skills when authenticated', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/skills',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: any[] };
    expect(body.items).toBeDefined();
    expect(body.items.length).toBeGreaterThanOrEqual(7);

    const names = body.items.map((i) => i.name);
    expect(names).toContain('docx');
    expect(names).toContain('pptx');
    expect(names).toContain('xlsx');
    expect(names).toContain('pdf');
    expect(names).toContain('data-analysis');
    expect(names).toContain('research-deep-dive');
    expect(names).toContain('skill-creator');

    // Does not leak internal filesystem paths
    const sample = body.items[0];
    expect(sample).not.toHaveProperty('path');
    expect(sample).toHaveProperty('mode');
  });

  it('GET /v1/skills/:name returns skill instructions and details', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/skills/pptx',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; mode: string; content: string };
    expect(body.name).toBe('pptx');
    expect(body.mode).toBe('guidance_only'); // artifact.pptx tool is not present
    expect(body.content).toContain('Presentation (PPTX) Deck Design');
  });

  it('GET /v1/skills/:name returns 404 for unknown skill', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/skills/non_existent_skill_xyz',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /v1/skills/:name cleanly rejects path traversal attempts', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/skills/..%2F..%2Fpackage.json',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
  });
});
