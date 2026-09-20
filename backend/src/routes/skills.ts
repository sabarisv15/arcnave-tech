/**
 * Skills API endpoints for Item 11: Skills System.
 *
 * Exposes safe public data for skill discovery and inspection in the UI.
 * Never leaks internal filesystem paths or server secrets.
 */
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { notFound } from '../errors.js';
import { requireAuth } from '../plugins/context.js';
import type { AppInstance } from '../types.js';

const skillSummarySchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  category: z.string(),
  scope: z.string(),
  mode: z.string(),
  missingCapabilities: z.array(z.string()),
});

const skillDetailSchema = skillSummarySchema.extend({
  content: z.string(),
});

export async function skillRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  typed.get(
    '/skills',
    {
      schema: {
        tags: ['skills'],
        summary: 'List all available skills and their capability modes',
        response: {
          200: z.object({
            items: z.array(skillSummarySchema),
          }),
        },
      },
    },
    async (request) => {
      const { skills } = request.services;
      const items = skills.listSkills();
      return { items };
    },
  );

  typed.get(
    '/skills/:name',
    {
      schema: {
        tags: ['skills'],
        summary: 'Retrieve instructions and metadata for a specific skill',
        params: z.object({
          name: z.string().min(1).max(100),
        }),
        response: {
          200: skillDetailSchema,
        },
      },
    },
    async (request) => {
      const { skills } = request.services;
      const skill = skills.getSkill(request.params.name);
      if (!skill) {
        throw notFound('skill');
      }
      return skill;
    },
  );
}
