/**
 * User preferences.
 *
 * The row is created with the account, so reads never have to invent defaults — a missing row
 * is a bug, not a state to paper over, and `loadPrefs` says so rather than silently returning
 * something plausible.
 *
 * Budget and routing fields are readable here but written through `PATCH /usage/limits`. One
 * writer per field keeps the optimistic-concurrency version honest: two endpoints bumping the
 * same counter would make a conflict from the Usage panel look like a conflict from Settings.
 */
import { eq } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { preferences } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { AUTO_ALIAS } from '../providers/registry.js';
import { resolveZone } from '../services/usage.js';
import type { AppInstance } from '../types.js';
import { assertVersion, iso } from './helpers.js';

export type PrefsRow = typeof preferences.$inferSelect;

const preferencesSchema = z.object({
  theme: z.string(),
  font: z.string(),
  modelAlias: z.string(),
  instructions: z.string(),
  enterToSend: z.boolean(),
  reducedMotion: z.boolean(),
  defaultMode: z.string(),
  sourceScope: z.string(),
  saveHistory: z.boolean(),
  /** Read-only here. Write through PATCH /usage/limits. */
  maxOutputTokens: z.number(),
  dailyTokenBudget: z.number().nullable(),
  monthlyTokenBudget: z.number().nullable(),
  warnThresholdPct: z.number(),
  routingPreference: z.string(),
  timezone: z.string(),
  version: z.number(),
  updatedAt: z.string().nullable(),
});

export async function preferenceRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  typed.get(
    '/preferences',
    {
      schema: {
        tags: ['preferences'],
        summary: 'Every stored preference for the signed-in user',
        response: { 200: preferencesSchema },
      },
    },
    async (request) => {
      const user = currentUser(request);
      return toDto(await loadPrefs(request, user.id));
    },
  );

  typed.patch(
    '/preferences',
    {
      schema: {
        tags: ['preferences'],
        summary: 'Update preferences',
        description:
          'Only the fields you send change. Token budgets and the output ceiling are not ' +
          'accepted here — use PATCH /usage/limits.',
        body: z.object({
          theme: z.enum(['system', 'light', 'dark']).optional(),
          font: z.enum(['sans', 'serif', 'mono']).optional(),
          modelAlias: z.string().trim().min(1).max(64).optional(),
          instructions: z.string().max(20_000).optional(),
          enterToSend: z.boolean().optional(),
          reducedMotion: z.boolean().optional(),
          defaultMode: z.enum(['chat', 'search', 'research']).optional(),
          sourceScope: z.string().trim().min(1).max(32).optional(),
          saveHistory: z.boolean().optional(),
          version: z.number().int().optional(),
        }),
        response: { 200: preferencesSchema },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db, registry } = request.services;
      const current = await loadPrefs(request, user.id);
      assertVersion(request.body.version, current.version, 'settings');

      // A default model the registry does not know would fail at generate time with a puzzling
      // error. Reject it here, where the Settings field can show why. Availability is not
      // checked: a configured model that is briefly unreachable is still a valid choice.
      const wantedAlias = request.body.modelAlias;
      if (wantedAlias !== undefined && wantedAlias !== AUTO_ALIAS && !registry.entry(wantedAlias)) {
        throw new ApiError('validation_error', {
          detail: `“${wantedAlias}” is not a model this workspace offers.`,
        });
      }

      const patch: Record<string, unknown> = { version: current.version + 1 };
      for (const field of [
        'theme',
        'font',
        'modelAlias',
        'instructions',
        'enterToSend',
        'reducedMotion',
        'defaultMode',
        'sourceScope',
        'saveHistory',
      ] as const) {
        if (request.body[field] !== undefined) patch[field] = request.body[field];
      }

      await db.update(preferences).set(patch).where(eq(preferences.userId, user.id));
      return toDto(await loadPrefs(request, user.id));
    },
  );
}

/**
 * Read the preferences row, or fail loudly.
 *
 * Shared with the usage routes. Every account gets a row at registration, so absence means the
 * row was deleted out from under us; returning defaults would hide that and quietly reset
 * someone's budgets to "unlimited".
 */
export async function loadPrefs(
  request: { services: AppInstance['services'] },
  userId: string,
): Promise<PrefsRow> {
  const [row] = await request.services.db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  if (!row) {
    throw new ApiError('internal_error', {
      detail: 'Your settings row is missing. Sign out and back in, or contact support.',
    });
  }
  return row;
}

function toDto(row: PrefsRow): z.infer<typeof preferencesSchema> {
  return {
    theme: row.theme,
    font: row.font,
    modelAlias: AUTO_ALIAS,
    instructions: row.instructions,
    enterToSend: row.enterToSend,
    reducedMotion: row.reducedMotion,
    defaultMode: row.defaultMode,
    sourceScope: row.sourceScope,
    saveHistory: row.saveHistory,
    maxOutputTokens: row.maxOutputTokens,
    dailyTokenBudget: row.dailyTokenBudget,
    monthlyTokenBudget: row.monthlyTokenBudget,
    warnThresholdPct: row.warnThresholdPct,
    routingPreference: row.routingPreference,
    // Normalised on the way out so the client never renders a zone the server will not honour.
    timezone: resolveZone(row.timezone),
    version: row.version,
    updatedAt: iso(row.updatedAt),
  };
}
