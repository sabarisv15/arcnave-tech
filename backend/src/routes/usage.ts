/**
 * Usage, limits, and export.
 *
 * Everything here reports what was measured. Two rules the shapes exist to keep:
 *
 * - `costUsd: null` means "no verified price for this model", not "free". The UI must render
 *   those differently, so `pricingConfigured` is returned alongside the numbers.
 * - `exact: false` means the provider returned no token metadata for that call. The counts are
 *   zeros, and they are labelled rather than quietly estimated.
 *
 * Writing limits lives here rather than in `preferences.ts` even though both back onto the
 * same table, because the Usage & limits panel is the only screen that edits them and a single
 * writer keeps the version bump unambiguous.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { chats, messages, preferences, usageRecords } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { resolveZone } from '../services/usage.js';
import type { AppInstance } from '../types.js';
import { assertVersion, iso } from './helpers.js';
import { loadPrefs } from './preferences.js';

const totalsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  costUsd: z.number().nullable(),
  requests: z.number(),
});

const groupSchema = z.object({
  key: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number().nullable(),
  requests: z.number(),
});

const limitsSchema = z.object({
  maxOutputTokens: z.number(),
  dailyTokenBudget: z.number().nullable(),
  monthlyTokenBudget: z.number().nullable(),
  warnThresholdPct: z.number(),
  routingPreference: z.string(),
  timezone: z.string(),
  dailyUsed: z.number(),
  monthlyUsed: z.number(),
  dailyPct: z.number().nullable(),
  monthlyPct: z.number().nullable(),
  warnings: z.array(z.string()),
  dailyResetsAt: z.string(),
  monthlyResetsAt: z.string(),
});

const summarySchema = z.object({
  today: totalsSchema,
  month: totalsSchema,
  allTime: totalsSchema,
  byModel: z.array(groupSchema),
  byProject: z.array(groupSchema),
  limits: limitsSchema,
  /** False means every `costUsd` in this payload is null because no pricing is configured. */
  pricingConfigured: z.boolean(),
});

const messageUsageSchema = z.object({
  messageId: z.string(),
  modelAlias: z.string(),
  provider: z.string(),
  providerModelId: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  exact: z.boolean(),
  costUsd: z.number().nullable(),
  latencyMs: z.number().nullable(),
  status: z.string(),
  finishReason: z.string().nullable(),
  errorCode: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export async function usageRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  /* ---------------------------------------------------------------- summary */

  typed.get(
    '/usage',
    {
      schema: {
        tags: ['usage'],
        summary: 'Token and cost totals for today, this month, and all time',
        response: { 200: summarySchema },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { usage } = request.services;
      const prefs = await loadPrefs(request, user.id);
      return usage.summary(user.id, prefs);
    },
  );

  /* ---------------------------------------------------------------- limits */

  typed.get(
    '/usage/limits',
    {
      schema: {
        tags: ['usage'],
        summary: 'Current limits and how much of them is spent',
        response: { 200: limitsSchema.extend({ version: z.number() }) },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { usage } = request.services;
      const prefs = await loadPrefs(request, user.id);
      const summary = await usage.summary(user.id, prefs);
      return { ...summary.limits, version: prefs.version };
    },
  );

  typed.patch(
    '/usage/limits',
    {
      schema: {
        tags: ['usage'],
        summary: 'Set output ceiling, token budgets, warning threshold, and timezone',
        description:
          'Send null for a budget to clear it. Budgets are enforced by reservation before a ' +
          'call, so lowering one below what is already spent blocks the next request rather ' +
          'than cancelling one in flight.',
        body: z.object({
          maxOutputTokens: z.number().int().min(1).optional(),
          dailyTokenBudget: z.number().int().min(1).nullable().optional(),
          monthlyTokenBudget: z.number().int().min(1).nullable().optional(),
          warnThresholdPct: z.number().int().min(1).max(100).optional(),
          routingPreference: z.enum(['fast', 'balanced', 'quality']).optional(),
          timezone: z.string().max(64).optional(),
          version: z.number().int().optional(),
        }),
        response: { 200: limitsSchema.extend({ version: z.number() }) },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db, cfg, usage } = request.services;
      const current = await loadPrefs(request, user.id);
      assertVersion(request.body.version, current.version, 'settings');

      const body = request.body;

      if (
        body.maxOutputTokens !== undefined &&
        body.maxOutputTokens > cfg.MAX_OUTPUT_TOKENS_CEILING
      ) {
        throw new ApiError('validation_error', {
          detail:
            `The output ceiling for this deployment is ` +
            `${cfg.MAX_OUTPUT_TOKENS_CEILING.toLocaleString('en-US')} tokens.`,
          meta: { ceiling: cfg.MAX_OUTPUT_TOKENS_CEILING },
        });
      }

      // An unknown zone would silently fall back to UTC at read time and quietly move the
      // user's budget reset. Refuse it at write time instead, while it can still be corrected.
      if (body.timezone !== undefined && resolveZone(body.timezone) !== body.timezone) {
        throw new ApiError('validation_error', {
          detail: `“${body.timezone}” is not a time zone this server recognises.`,
        });
      }

      const patch: Record<string, unknown> = { version: current.version + 1 };
      for (const field of [
        'maxOutputTokens',
        'dailyTokenBudget',
        'monthlyTokenBudget',
        'warnThresholdPct',
        'routingPreference',
        'timezone',
      ] as const) {
        if (body[field] !== undefined) patch[field] = body[field];
      }

      await db.update(preferences).set(patch).where(eq(preferences.userId, user.id));

      const updated = await loadPrefs(request, user.id);
      const summary = await usage.summary(user.id, updated);
      return { ...summary.limits, version: updated.version };
    },
  );

  /* ---------------------------------------------------------------- per message */

  typed.get(
    '/usage/messages',
    {
      schema: {
        tags: ['usage'],
        summary: 'Usage for each assistant message in a chat',
        description:
          'The chat transcript omits usage to stay lean. Fetch it here when the per-message ' +
          'token row is actually being shown.',
        querystring: z.object({ chatId: z.string().uuid() }),
        response: { 200: z.object({ items: z.array(messageUsageSchema) }) },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db } = request.services;

      const [chat] = await db
        .select({ id: chats.id })
        .from(chats)
        .where(and(eq(chats.id, request.query.chatId), eq(chats.userId, user.id)))
        .limit(1);
      if (!chat) throw notFound('conversation');

      const ids = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.chatId, chat.id));
      if (ids.length === 0) return { items: [] };

      const rows = await db
        .select()
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.userId, user.id),
            inArray(
              usageRecords.messageId,
              ids.map((m) => m.id),
            ),
          ),
        );

      return {
        items: rows
          .filter((r): r is typeof r & { messageId: string } => r.messageId !== null)
          .map((r) => ({
            messageId: r.messageId,
            modelAlias: r.modelAlias,
            provider: r.provider,
            providerModelId: r.providerModelId,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            totalTokens: r.totalTokens,
            cacheReadTokens: r.cacheReadTokens,
            cacheWriteTokens: r.cacheWriteTokens,
            exact: r.tokensExact,
            costUsd: r.costUsd,
            latencyMs: r.latencyMs,
            status: r.status,
            finishReason: r.finishReason,
            errorCode: r.errorCode,
            startedAt: iso(r.startedAt),
            completedAt: iso(r.completedAt),
          })),
      };
    },
  );

  /* ---------------------------------------------------------------- export */

  typed.get(
    '/usage/export',
    {
      schema: {
        tags: ['usage'],
        summary: 'Download the raw usage records as CSV',
        description:
          'One row per generation attempt, including cancellations and failures. Empty cost ' +
          'cells mean no price is configured for that model, not zero cost.',
        querystring: z.object({
          /** ISO 8601. Omit for everything. */
          since: z.string().datetime().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { usage } = request.services;
      const since = request.query.since ? new Date(request.query.since) : null;
      const rows = await usage.exportRows(user.id, since);

      const header = [
        'started_at',
        'completed_at',
        'latency_ms',
        'model_alias',
        'provider',
        'provider_model_id',
        'input_tokens',
        'output_tokens',
        'total_tokens',
        'cache_read_tokens',
        'cache_write_tokens',
        'tokens_exact',
        'status',
        'finish_reason',
        'error_code',
        'cost_usd',
        'chat_id',
        'message_id',
        'project_id',
        'request_id',
      ];

      const body = rows.map((r) =>
        [
          r.startedAt.toISOString(),
          r.completedAt?.toISOString() ?? '',
          r.latencyMs ?? '',
          r.modelAlias,
          r.provider,
          r.providerModelId,
          r.inputTokens,
          r.outputTokens,
          r.totalTokens,
          r.cacheReadTokens,
          r.cacheWriteTokens,
          r.tokensExact,
          r.status,
          r.finishReason ?? '',
          r.errorCode ?? '',
          // Empty, not 0: an unpriced model has no cost figure to report.
          r.costUsd ?? '',
          r.chatId ?? '',
          r.messageId ?? '',
          r.projectId ?? '',
          r.requestId,
        ].map(csvCell),
      );

      const stamp = new Date().toISOString().slice(0, 10);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="arcnave-usage-${stamp}.csv"`)
        .header('X-Content-Type-Options', 'nosniff')
        .send([header.join(','), ...body.map((cells) => cells.join(','))].join('\r\n') + '\r\n');
    },
  );
}

/**
 * Quote a CSV cell, and defuse spreadsheet formula injection.
 *
 * A cell opening with `=`, `+`, `-` or `@` is executed as a formula when the file is opened in
 * Excel or Sheets. None of our columns should ever start with one, but a model alias is
 * configuration and configuration is attacker-adjacent, so the prefix is neutralised here
 * rather than trusted upstream.
 */
export function csvCell(value: string | number | boolean): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
