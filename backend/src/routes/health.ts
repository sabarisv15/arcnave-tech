/**
 * Liveness, readiness, and model availability.
 *
 * `/healthz` answers "is the process up" and must never touch the database — a health check
 * that fails when Postgres blips will get the container killed during a recoverable outage.
 * `/readyz` answers "can it serve traffic" and does check dependencies.
 */
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { providerReadiness } from '../config.js';
import { pingDb } from '../db/client.js';
import type { AppInstance } from '../types.js';

const startedAt = Date.now();

export async function healthRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // `/health` is the locked path (Stage 19 DS19-D). Google's front end answers `/healthz` itself
  // on a public run.app URL, so a probe from outside never reached this process on that path;
  // `/healthz` stays as an alias for the container's own HEALTHCHECK and compose (ADR-0065).
  for (const path of ['/health', '/healthz'] as const) {
    typed.get(
      path,
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
  }

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
              anthropicConfigured: z.boolean(),
              groundingConfigured: z.boolean(),
              storageBackend: z.string(),
            }),
          }),
          503: z.object({
            status: z.literal('unavailable'),
            checks: z.object({
              database: z.boolean(),
              vertexConfigured: z.boolean(),
              anthropicConfigured: z.boolean(),
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
        anthropicConfigured: cfg.anthropicConfigured,
        groundingConfigured:
          cfg.ENABLE_GOOGLE_SEARCH_GROUNDING || cfg.ENABLE_ANTHROPIC_WEB_SEARCH,
        storageBackend: cfg.STORAGE_BACKEND,
      };

      // Without a database nothing works, so that is the only hard failure. A provider that is
      // in use (a model id is configured for it) but lacks credentials is "degraded": the app
      // still serves history, projects, and settings.
      if (!database) {
        return reply.status(503).send({ status: 'unavailable' as const, checks });
      }
      return reply.send({
        status: providerReadiness(cfg).ready ? ('ready' as const) : ('degraded' as const),
        checks,
      });
    },
  );
}
