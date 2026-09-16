/**
 * Liveness, readiness, and model availability.
 *
 * `/healthz` answers "is the process up" and must never touch the database — a health check
 * that fails when Postgres blips will get the container killed during a recoverable outage.
 * `/readyz` answers "can it serve traffic" and does check dependencies.
 */
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { pingDb } from '../db/client.js';
import type { AppInstance } from '../types.js';

const startedAt = Date.now();

export async function healthRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/healthz',
    {
      schema: {
        tags: ['ops'],
        summary: 'Liveness. Does not touch dependencies.',
        response: {
          200: z.object({
            status: z.literal('ok'),
            uptimeSeconds: z.number(),
            version: z.string(),
          }),
        },
      },
      config: { rateLimit: false },
    },
    async () => ({
      status: 'ok' as const,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      version: process.env['npm_package_version'] ?? '1.0.0',
    }),
  );

  typed.get(
    '/readyz',
    {
      schema: {
        tags: ['ops'],
        summary: 'Readiness. Checks the database and reports configuration state.',
        response: {
          200: z.object({
            status: z.enum(['ready', 'degraded']),
            checks: z.object({
              database: z.boolean(),
              vertexConfigured: z.boolean(),
              groundingConfigured: z.boolean(),
              storageBackend: z.string(),
            }),
          }),
          503: z.object({
            status: z.literal('unavailable'),
            checks: z.object({
              database: z.boolean(),
              vertexConfigured: z.boolean(),
              groundingConfigured: z.boolean(),
              storageBackend: z.string(),
            }),
          }),
        },
      },
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const cfg = request.services.cfg;
      const database = await pingDb();
      const checks = {
        database,
        vertexConfigured: cfg.vertexConfigured,
        groundingConfigured:
          cfg.ENABLE_GOOGLE_SEARCH_GROUNDING || cfg.ENABLE_ANTHROPIC_WEB_SEARCH,
        storageBackend: cfg.STORAGE_BACKEND,
      };

      // Without a database nothing works, so that is the only hard failure. Missing Vertex
      // configuration is "degraded": the app still serves history, projects, and settings.
      if (!database) {
        return reply.status(503).send({ status: 'unavailable' as const, checks });
      }
      return reply.send({
        status: checks.vertexConfigured ? ('ready' as const) : ('degraded' as const),
        checks,
      });
    },
  );
}
