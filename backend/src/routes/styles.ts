/**
 * Styles API routes (WP-05 / ADR-0033).
 *
 * Provides:
 * - Listing of presets + user custom styles (GET /styles)
 * - CRUD for custom styles (POST, GET, PATCH, DELETE /styles/:id)
 * - Style synthesis from 1-3 writing samples (POST /styles/summarize)
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { preferences, styles, type Style } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { STYLE_PRESETS, getPresetStyle, summarizeStyleSamples } from '../services/styles.js';
import type { AppInstance } from '../types.js';
import { assertVersion, iso } from './helpers.js';
import type { ProviderUsage } from '../providers/types.js';
import { EMPTY_USAGE } from '../providers/types.js';
import { errorLogFields } from '../errorLog.js';

export const stylePresetDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
});

export const styleDtoSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  instructions: z.string(),
  isPreset: z.boolean(),
  version: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export type StyleDto = z.infer<typeof styleDtoSchema>;

function toDto(row: Style): StyleDto {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    instructions: row.instructions,
    isPreset: false,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function styleRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  /* ---------------------------------------------------------------- list */

  typed.get(
    '/styles',
    {
      schema: {
        tags: ['styles'],
        summary: 'List available style presets and user custom styles',
        response: {
          200: z.object({
            presets: z.array(stylePresetDtoSchema),
            items: z.array(styleDtoSchema),
          }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db } = request.services;

      const rows = await db
        .select()
        .from(styles)
        .where(eq(styles.userId, user.id))
        .orderBy(desc(styles.createdAt));

      return {
        presets: STYLE_PRESETS.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          instructions: p.instructions,
        })),
        items: rows.map(toDto),
      };
    },
  );

  /* ---------------------------------------------------------------- create */

  typed.post(
    '/styles',
    {
      schema: {
        tags: ['styles'],
        summary: 'Create a custom response style',
        body: z.object({
          name: z.string().trim().min(1).max(60),
          // Route schema does not pre-empt style_too_long (422) check
          instructions: z.string().min(1),
        }),
        response: { 201: styleDtoSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { name, instructions } = request.body;

      if (instructions.length > 4000) {
        throw new ApiError('style_too_long');
      }

      const [created] = await db
        .insert(styles)
        .values({
          userId: user.id,
          name,
          instructions,
        })
        .returning();

      return reply.status(201).send(toDto(created!));
    },
  );

  /* ---------------------------------------------------------------- summarize */

  typed.post(
    '/styles/summarize',
    {
      schema: {
        tags: ['styles'],
        summary: 'Synthesize style instructions from writing samples',
        description: 'Analyzes 1-3 writing samples to produce concise style instructions (<= 4000 chars).',
        body: z.object({
          samples: z.array(z.string().min(1)).min(1).max(3),
        }),
        response: {
          200: z.object({
            instructions: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db, registry, usage } = request.services;

      // 1. Cap each sample at 10,000 characters
      for (const sample of request.body.samples) {
        if (sample.length > 10_000) {
          throw new ApiError('sample_too_long');
        }
      }

      // 2. Resolve model (Invariant 1: never fall back silently)
      const available = await registry.availableEntries({ probe: 'never' });
      const entry = available[0] ?? registry.entry(registry.aliases[0] ?? '');
      if (!entry) {
        throw new ApiError('no_model_available');
      }
      const status = await registry.status(entry.alias, { probe: 'never' });
      if (!status?.available) {
        throw new ApiError('model_unavailable');
      }

      const provider = registry.providerFor(entry);
      if (!provider) {
        throw new ApiError('model_unavailable');
      }

      // 3. User budget check & reservation
      const [prefsRow] = await db
        .select({
          dailyTokenBudget: preferences.dailyTokenBudget,
          monthlyTokenBudget: preferences.monthlyTokenBudget,
          warnThresholdPct: preferences.warnThresholdPct,
          timezone: preferences.timezone,
        })
        .from(preferences)
        .where(eq(preferences.userId, user.id))
        .limit(1);

      const budgetPrefs = {
        dailyTokenBudget: prefsRow?.dailyTokenBudget ?? null,
        monthlyTokenBudget: prefsRow?.monthlyTokenBudget ?? null,
        warnThresholdPct: prefsRow?.warnThresholdPct ?? 80,
        timezone: prefsRow?.timezone ?? 'UTC',
      };

      // A utility call, not a turn: the hold has its own owner, and expires with the turn
      // deadline if nothing settles it (ADR-0078).
      const reservation = await usage.reserve(user.id, budgetPrefs, 2048, {
        owner: 'utility',
        expiresAt: new Date(Date.now() + request.services.cfg.TURN_DEADLINE_MS + request.services.cfg.TURN_LEASE_MS),
      });

      const startedAt = new Date();
      let usageResult: ProviderUsage = { ...EMPTY_USAGE };
      let runStatus: 'complete' | 'error' = 'complete';
      let errorCode: string | null = null;

      try {
        const result = await summarizeStyleSamples(
          provider,
          entry.providerModelId!,
          request.body.samples,
        );
        usageResult = result.usage;
        return { instructions: result.instructions };
      } catch (err) {
        runStatus = 'error';
        errorCode = err instanceof ApiError ? err.code : 'internal_error';
        throw err;
      } finally {
        // A-23: a billing write that fails must not fail the answer, but it is not silent.
        await usage.release(reservation).catch((err: unknown) => {
          request.log.warn({ ...errorLogFields(err), requestId: request.id }, 'style summary: budget reservation not released');
        });
        await usage.record({
          userId: user.id,
          prefs: budgetPrefs,
          requestId: request.id,
          chatId: null,
          messageId: null,
          projectId: null,
          modelAlias: entry.alias,
          provider: entry.provider,
          providerModelId: entry.providerModelId ?? entry.alias,
          usage: usageResult,
          startedAt,
          status: runStatus,
          errorCode,
        }).catch((err: unknown) => {
          request.log.warn({ ...errorLogFields(err), requestId: request.id }, 'style summary: usage row not recorded');
        });
      }
    },
  );

  /* ---------------------------------------------------------------- get */

  typed.get(
    '/styles/:id',
    {
      schema: {
        tags: ['styles'],
        summary: 'Get style details by ID or preset name',
        params: z.object({ id: z.string() }),
        response: { 200: styleDtoSchema },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { id } = request.params;

      const preset = getPresetStyle(id);
      if (preset) {
        return {
          id: preset.id,
          userId: null,
          name: preset.name,
          instructions: preset.instructions,
          isPreset: true,
          version: 1,
          createdAt: null,
          updatedAt: null,
        };
      }

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new ApiError('style_not_found');
      }

      const [row] = await db
        .select()
        .from(styles)
        .where(and(eq(styles.id, id), eq(styles.userId, user.id)));

      if (!row) {
        throw new ApiError('style_not_found');
      }

      return toDto(row);
    },
  );

  /* ---------------------------------------------------------------- update */

  typed.patch(
    '/styles/:id',
    {
      schema: {
        tags: ['styles'],
        summary: 'Update custom style',
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().trim().min(1).max(60).optional(),
          instructions: z.string().min(1).optional(),
          version: z.number().int().optional(),
        }),
        response: { 200: styleDtoSchema },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { id } = request.params;
      const { name, instructions, version } = request.body;

      if (instructions !== undefined && instructions.length > 4000) {
        throw new ApiError('style_too_long');
      }

      const [existing] = await db
        .select()
        .from(styles)
        .where(and(eq(styles.id, id), eq(styles.userId, user.id)));

      if (!existing) {
        throw new ApiError('style_not_found');
      }

      assertVersion(version, existing.version, 'style');

      const [updated] = await db
        .update(styles)
        .set({
          ...(name ? { name } : {}),
          ...(instructions !== undefined ? { instructions } : {}),
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(styles.id, id))
        .returning();

      return toDto(updated!);
    },
  );

  /* ---------------------------------------------------------------- delete */

  typed.delete(
    '/styles/:id',
    {
      schema: {
        tags: ['styles'],
        summary: 'Delete custom style',
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { id } = request.params;

      const [existing] = await db
        .select()
        .from(styles)
        .where(and(eq(styles.id, id), eq(styles.userId, user.id)));

      if (!existing) {
        throw new ApiError('style_not_found');
      }

      // A preference pointing at this style would fail every later turn with style_not_found,
      // so it goes back to Normal in the same transaction as the delete.
      await db.transaction(async (tx) => {
        await tx
          .update(preferences)
          .set({ styleId: 'normal', version: sql`${preferences.version} + 1` })
          .where(and(eq(preferences.userId, user.id), eq(preferences.styleId, id)));
        await tx.delete(styles).where(eq(styles.id, id));
      });
      return reply.status(204).send(null);
    },
  );
}
