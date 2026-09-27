/**
 * Model availability.
 *
 * The single source of truth for the composer. The frontend ships no model table of its own,
 * so an alias that is unavailable here is unavailable in the UI, with the reason shown rather
 * than the option silently disappearing.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { messages } from '../db/schema.js';
import { getModelCapability } from '../providers/capabilitiesTable.js';
import { AUTO_ALIAS } from '../providers/registry.js';
import type { AppInstance } from '../types.js';

const modelSchema = z.object({
  alias: z.string(),
  description: z.string(),
  provider: z.string(),
  tier: z.string(),
  available: z.boolean(),
  /** ok | not_configured | vertex_not_configured | probe_failed | unknown */
  reason: z.string(),
  detail: z.string(),
  supportsGrounding: z.boolean(),
  contextWindow: z.number().nullable(),
  /**
   * Exposed so the UI can show which model actually answered. Not a secret: it is a public
   * publisher identifier, not a credential.
   */
  providerModelId: z.string().nullable(),
  reasoningEfforts: z.array(z.string()),
});

export async function modelRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/models',
    {
      schema: {
        tags: ['models'],
        summary: 'Model aliases and their availability',
        querystring: z.object({
          // Probing spends a token per alias, so the composer can ask for cached state.
          // `z.coerce.boolean()` is a trap here: Boolean("false") is `true`, so it would
          // treat every request as a probe regardless of what the caller sent. An explicit
          // two-value enum is the only coercion that reads a query string correctly.
          probe: z
            .enum(['true', 'false'])
            .optional()
            .default('true')
            .transform((v) => v === 'true'),
          chatId: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({
            auto: z.object({
              alias: z.string(),
              description: z.string(),
              available: z.boolean(),
              detail: z.string(),
              reasoningEfforts: z.array(z.string()),
            }),
            models: z.array(modelSchema),
            capabilities: z.object({
              groundedSearch: z.boolean(),
              detail: z.string(),
            }),
          }),
        },
      },
    },
    async (request) => {
      const { registry, cfg, db } = request.services;
      const statuses = await registry.allStatuses({ probe: request.query.probe });

      const models = statuses.map((s) => ({
        alias: s.entry.alias,
        description: s.entry.description,
        provider: s.entry.provider,
        tier: s.entry.tier,
        available: s.available,
        reason: s.reason,
        detail: s.detail,
        supportsGrounding: s.entry.supportsGrounding,
        contextWindow: s.entry.contextWindow,
        providerModelId: s.entry.providerModelId ?? null,
        reasoningEfforts: [...getModelCapability(s.entry.alias).reasoningEfforts],
      }));

      const anyAvailable = models.some((m) => m.available);
      const groundingEnabled =
        cfg.ENABLE_GOOGLE_SEARCH_GROUNDING || cfg.ENABLE_ANTHROPIC_WEB_SEARCH;
      const groundedSearch =
        groundingEnabled && statuses.some((s) => s.available && s.entry.supportsGrounding);

      // For Auto: list the levels of the model Auto resolves to for this chat.
      // When that is not known yet, list only the levels that every Auto candidate supports.
      // Never show a level that will be silently stepped down (Invariant 1).
      let autoEfforts: string[] = [];
      if (request.query.chatId) {
        const [lastMsg] = await db
          .select({ modelAlias: messages.modelAlias })
          .from(messages)
          .where(and(eq(messages.chatId, request.query.chatId), isNotNull(messages.modelAlias)))
          .orderBy(desc(messages.createdAt))
          .limit(1);
        if (lastMsg?.modelAlias) {
          autoEfforts = [...getModelCapability(lastMsg.modelAlias).reasoningEfforts];
        }
      }
      if (autoEfforts.length === 0) {
        const candidateEfforts = statuses
          .filter((s) => s.available && s.entry.alias !== 'GPT-OSS 120B')
          .map((s) => getModelCapability(s.entry.alias).reasoningEfforts);
        if (candidateEfforts.length > 0) {
          autoEfforts = (['low', 'medium', 'high', 'xhigh', 'max'] as const).filter((level) =>
            candidateEfforts.every((efforts) => efforts.includes(level)),
          );
        }
      }

      return {
        auto: {
          alias: AUTO_ALIAS,
          description: 'Routes each request to the right model',
          available: anyAvailable,
          detail: anyAvailable
            ? 'Routes by mode, attachments, context size, and your routing preference.'
            : 'No model is configured, so Auto has nothing to route to.',
          reasoningEfforts: autoEfforts,
        },
        models,
        capabilities: {
          groundedSearch,
          detail: groundedSearch
            ? 'Search and research return citations from real retrieved results.'
            : groundingEnabled
              ? 'Grounding is enabled but no available model supports it.'
              : 'No web search provider is configured. Search and research are unavailable; ordinary chat still works.',
        },
      };
    },
  );

  typed.post(
    '/models/refresh',
    {
      schema: {
        tags: ['models'],
        summary: 'Drop the availability cache and re-probe on the next read',
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      request.services.registry.invalidate();
      return reply.status(204).send(null);
    },
  );
}
