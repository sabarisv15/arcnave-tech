/**
 * The service status the app shows above every chat (Stage 15 ER-12b; ADR-0081).
 *
 * The incident banner is a flag ops set (`INCIDENT_BANNER`), never automatic text and never
 * user, file or model text (Stage 17 OD-11). No sign-in is needed: the banner is meant for
 * everyone, and it says nothing about any account.
 */
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AppInstance } from '../types.js';

export async function statusRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(
    '/status',
    {
      schema: {
        tags: ['ops'],
        summary: 'Service status: the ops incident banner, when one is set (ER-12b).',
        response: {
          200: z.object({
            /** Ops-written text, or null when there is no incident. */
            incidentBanner: z.string().nullable(),
          }),
        },
      },
    },
    async (_request, reply) => {
      void reply.header('Cache-Control', 'no-store');
      return { incidentBanner: app.services.cfg.INCIDENT_BANNER ?? null };
    },
  );
}
