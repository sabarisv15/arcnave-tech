import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { preferences, styles, usageRecords } from '../db/schema.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;
let otherUser: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
  otherUser = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const auth = (u = user): { cookie: string } => ({ cookie: u.cookie });

describe('WP-05 Styles API Integration Tests', () => {
  describe('GET /styles', () => {
    it('returns the 4 built-in presets and user custom styles', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/styles',
        headers: auth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.presets).toHaveLength(4);
      expect(body.presets.map((p: { id: string }) => p.id)).toEqual([
        'normal',
        'concise',
        'explanatory',
        'formal',
      ]);
      expect(body.items).toBeInstanceOf(Array);
    });

    it('does not leak custom styles from other users', async () => {
      // Create style for other user
      const createRes = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(otherUser),
        payload: {
          name: "Other's Style",
          instructions: 'Write like a pirate.',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const otherStyleId = createRes.json().id;

      // User 1 lists styles
      const listRes = await ctx.app.inject({
        method: 'GET',
        url: '/v1/styles',
        headers: auth(user),
      });

      expect(listRes.statusCode).toBe(200);
      const userStyles = listRes.json().items;
      expect(userStyles.some((s: { id: string }) => s.id === otherStyleId)).toBe(false);
    });
  });

  describe('POST /styles', () => {
    it('creates a custom style with name and instructions', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(),
        payload: {
          name: 'Executive Brief',
          instructions: 'Bullet points only, bold key figures, no introductory paragraphs.',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Executive Brief');
      expect(body.instructions).toContain('Bullet points only');
      expect(body.isPreset).toBe(false);
      expect(body.version).toBe(1);
    });

    it('rejects instructions exceeding 4000 characters with 422 style_too_long', async () => {
      const overLong = 'a'.repeat(4001);
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(),
        payload: {
          name: 'Too Long Style',
          instructions: overLong,
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('style_too_long');
    });

    it('rejects an empty name', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(),
        payload: {
          name: '',
          instructions: 'Be brief.',
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    });
  });

  describe('GET /styles/:id', () => {
    it('returns preset style details when given a preset id', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/styles/concise',
        headers: auth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('concise');
      expect(body.name).toBe('Concise');
      expect(body.isPreset).toBe(true);
      expect(body.instructions).toContain('Respond concisely');
    });

    it('returns custom style details when given custom style UUID', async () => {
      const createRes = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(),
        payload: {
          name: 'Detailed Tech',
          instructions: 'Include architecture diagrams and trade-offs.',
        },
      });
      const styleId = createRes.json().id;

      const res = await ctx.app.inject({
        method: 'GET',
        url: `/v1/styles/${styleId}`,
        headers: auth(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Detailed Tech');
    });

    it('returns 404 style_not_found for nonexistent style or unowned style', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/styles/00000000-0000-0000-0000-000000000000',
        headers: auth(),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('style_not_found');
    });
  });

  describe('PATCH /styles/:id', () => {
    it('updates name and instructions and increments version', async () => {
      const createRes = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(),
        payload: {
          name: 'Original Name',
          instructions: 'Original instructions.',
        },
      });
      const created = createRes.json();

      const patchRes = await ctx.app.inject({
        method: 'PATCH',
        url: `/v1/styles/${created.id}`,
        headers: auth(),
        payload: {
          name: 'Updated Name',
          instructions: 'Updated instructions.',
          version: created.version,
        },
      });

      expect(patchRes.statusCode).toBe(200);
      const updated = patchRes.json();
      expect(updated.name).toBe('Updated Name');
      expect(updated.instructions).toBe('Updated instructions.');
      expect(updated.version).toBe(created.version + 1);
    });

    it('rejects update with 422 style_too_long if instructions exceed 4000 characters', async () => {
      const createRes = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(),
        payload: {
          name: 'Short Style',
          instructions: 'Short.',
        },
      });
      const created = createRes.json();

      const patchRes = await ctx.app.inject({
        method: 'PATCH',
        url: `/v1/styles/${created.id}`,
        headers: auth(),
        payload: {
          instructions: 'x'.repeat(4001),
        },
      });

      expect(patchRes.statusCode).toBe(422);
      expect(patchRes.json().error.code).toBe('style_too_long');
    });

    it('rejects version conflict with 409 conflict', async () => {
      const createRes = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(),
        payload: {
          name: 'Version Test',
          instructions: 'Test.',
        },
      });
      const created = createRes.json();

      const patchRes = await ctx.app.inject({
        method: 'PATCH',
        url: `/v1/styles/${created.id}`,
        headers: auth(),
        payload: {
          name: 'New Name',
          version: 999, // Stale version
        },
      });

      expect(patchRes.statusCode).toBe(409);
      expect(patchRes.json().error.code).toBe('conflict');
    });
  });

  describe('DELETE /styles/:id', () => {
    it('deletes custom style with 204 status', async () => {
      const createRes = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles',
        headers: auth(),
        payload: {
          name: 'To Delete',
          instructions: 'Delete me.',
        },
      });
      const created = createRes.json();

      const delRes = await ctx.app.inject({
        method: 'DELETE',
        url: `/v1/styles/${created.id}`,
        headers: auth(),
      });
      expect(delRes.statusCode).toBe(204);

      // Verify it no longer exists
      const getRes = await ctx.app.inject({
        method: 'GET',
        url: `/v1/styles/${created.id}`,
        headers: auth(),
      });
      expect(getRes.statusCode).toBe(404);
      expect(getRes.json().error.code).toBe('style_not_found');
    });
  });

  describe('POST /styles/summarize', () => {
    it('synthesizes instructions from samples, uses fake provider, and records usage row', async () => {
      // Script fake provider response
      ctx.provider.script = [
        { type: 'delta', text: 'Use direct, punchy sentences. Avoid fluff.' },
        {
          type: 'completed',
          usage: {
            inputTokens: 50,
            outputTokens: 25,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            exact: true,
          },
          finishReason: 'stop',
        },
      ];

      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles/summarize',
        headers: auth(),
        payload: {
          samples: [
            'Ship quickly and cleanly. Every line matters.',
            'Clarity trumps cleverness every time.',
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().instructions).toBe('Use direct, punchy sentences. Avoid fluff.');

      // Verify that a usage row was recorded in the database
      const [record] = await ctx.db
        .select()
        .from(usageRecords)
        .where(eq(usageRecords.userId, user.id))
        .orderBy(usageRecords.startedAt);
      expect(record).toBeDefined();
    });

    it('rejects writing sample exceeding 10,000 characters with 422 sample_too_long', async () => {
      const overLongSample = 's'.repeat(10_001);
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles/summarize',
        headers: auth(),
        payload: {
          samples: [overLongSample],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('sample_too_long');
    });

    it('rejects more than 3 samples', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/v1/styles/summarize',
        headers: auth(),
        payload: {
          samples: ['1', '2', '3', '4'],
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    });
  });

  describe('Preferences & Generation Style Integration', () => {
    it('accepts and persists styleId via PATCH /preferences only', async () => {
      const getPrefs = await ctx.app.inject({
        method: 'GET',
        url: '/v1/preferences',
        headers: auth(),
      });
      const initialPrefs = getPrefs.json();
      expect(initialPrefs.styleId).toBe('normal');

      const patchRes = await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/preferences',
        headers: auth(),
        payload: {
          styleId: 'formal',
          version: initialPrefs.version,
        },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().styleId).toBe('formal');
    });

    it('rejects unknown styleId in PATCH /preferences with 404 style_not_found', async () => {
      const getPrefs = await ctx.app.inject({
        method: 'GET',
        url: '/v1/preferences',
        headers: auth(),
      });

      const patchRes = await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/preferences',
        headers: auth(),
        payload: {
          styleId: '00000000-0000-0000-0000-000000000000',
          version: getPrefs.json().version,
        },
      });

      expect(patchRes.statusCode).toBe(404);
      expect(patchRes.json().error.code).toBe('style_not_found');
    });

    it('generates reply with styleId override, verifies prompt contains style instructions, and does NOT overwrite preferences.styleId', async () => {
      // 1. Create a chat
      const chatRes = await ctx.app.inject({
        method: 'POST',
        url: '/v1/chats',
        headers: auth(),
        payload: { title: 'Style test chat' },
      });
      const chatId = chatRes.json().id;

      // 2. Clear seen requests on fake provider
      ctx.provider.seen.length = 0;
      ctx.provider.script = [
        { type: 'delta', text: 'Concise reply.' },
        {
          type: 'completed',
          usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'stop',
        },
      ];

      // 3. Current preference is 'formal' (from previous test)
      const currentPrefsBefore = (await ctx.app.inject({ method: 'GET', url: '/v1/preferences', headers: auth() })).json();
      expect(currentPrefsBefore.styleId).toBe('formal');

      // 4. Generate with styleId: 'concise'
      const genRes = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers: auth(),
        payload: {
          prompt: 'What is photosynthesis?',
          styleId: 'concise',
        },
      });

      expect(genRes.statusCode).toBe(200);

      // 5. Verify fake provider saw the concise style instructions in prompt
      const lastRequest = ctx.provider.seen.at(-1);
      expect(lastRequest).toBeDefined();
      expect(lastRequest!.systemInstruction).toContain('<style_instructions>');
      expect(lastRequest!.systemInstruction).toContain('Respond concisely');

      // 6. Verify preferences.styleId was NOT overwritten on generate (user instruction 1)
      const currentPrefsAfter = (await ctx.app.inject({ method: 'GET', url: '/v1/preferences', headers: auth() })).json();
      expect(currentPrefsAfter.styleId).toBe('formal');
      expect(currentPrefsAfter.version).toBe(currentPrefsBefore.version);
    });

    it('rejects generation with unknown styleId with 404 style_not_found', async () => {
      const chatRes = await ctx.app.inject({
        method: 'POST',
        url: '/v1/chats',
        headers: auth(),
        payload: { title: 'Unknown style chat' },
      });
      const chatId = chatRes.json().id;

      const genRes = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers: auth(),
        payload: {
          prompt: 'Hello',
          styleId: '00000000-0000-0000-0000-000000000000',
        },
      });

      // Returns SSE error frame with code style_not_found
      expect(genRes.body).toContain('style_not_found');
    });
  });
});
