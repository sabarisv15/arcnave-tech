import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { MemoryConcurrencyError, memoryService } from '../services/memory/memoryService.js';
import type { MemoryItem } from '../db/schema.js';
import type { AppInstance } from '../types.js';

const memoryItemDto = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  scope: z.string(),
  projectId: z.string().uuid().nullable(),
  kind: z.string(),
  key: z.string(),
  content: z.string(),
  summary: z.string(),
  isStanding: z.boolean(),
  sourceType: z.string(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function toDto(item: MemoryItem) {
  return {
    id: item.id,
    userId: item.userId,
    scope: item.scope,
    projectId: item.projectId,
    kind: item.kind,
    key: item.key,
    content: item.content,
    summary: item.summary,
    isStanding: item.isStanding,
    sourceType: item.sourceType,
    version: item.version,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function memoryRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  typed.get(
    '/memory',
    {
      schema: {
        tags: ['memory'],
        summary: 'List persistent memory items for the current user',
        querystring: z.object({
          projectId: z.string().uuid().optional(),
          scope: z.enum(['global', 'project']).optional(),
          isStanding: z
            .string()
            .optional()
            .transform((v) => (v === undefined ? undefined : v === 'true')),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(memoryItemDto),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const res = await memoryService.listMemories(user.id, {
        projectId: request.query.projectId,
        scope: request.query.scope,
        isStanding: request.query.isStanding,
        limit: request.query.limit,
        offset: request.query.offset,
      });

      return {
        items: res.items.map((item) => ({
          id: item.id,
          userId: item.userId,
          scope: item.scope,
          projectId: item.projectId,
          kind: item.kind,
          key: item.key,
          content: item.content,
          summary: item.summary,
          isStanding: item.isStanding,
          sourceType: item.sourceType,
          version: item.version,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        total: res.total,
      };
    },
  );

  // Claude's memory topics can be read, edited and deleted in settings (ADR-0025).
  typed.post(
    '/memory',
    {
      schema: {
        tags: ['memory'],
        summary: 'Add or replace a memory topic',
        body: z.object({
          key: z.string().trim().min(1).max(200),
          content: z.string().trim().min(1).max(20_000),
          projectId: z.string().uuid().nullable().optional(),
        }),
        response: { 200: memoryItemDto },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const projectId = request.body.projectId ?? null;
      try {
        const item = await memoryService.createMemory({
          userId: user.id,
          scope: projectId ? 'project' : 'global',
          projectId,
          key: request.body.key,
          content: request.body.content,
          sourceType: 'user_statement',
        });
        return toDto(item);
      } catch (err) {
        throw new ApiError('validation_error', { detail: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  typed.patch(
    '/memory/:id',
    {
      schema: {
        tags: ['memory'],
        summary: 'Edit a memory topic',
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          expectedVersion: z.number().int().min(1),
          key: z.string().trim().min(1).max(200).optional(),
          content: z.string().trim().min(1).max(20_000).optional(),
        }),
        response: { 200: memoryItemDto },
      },
    },
    async (request) => {
      const user = currentUser(request);
      try {
        const item = await memoryService.updateMemory(user.id, request.params.id, request.body.expectedVersion, {
          key: request.body.key,
          content: request.body.content,
          summary: request.body.content?.slice(0, 150),
        });
        return toDto(item);
      } catch (err) {
        if (err instanceof MemoryConcurrencyError) {
          throw new ApiError('conflict', { detail: err.message });
        }
        if (err instanceof Error && err.message.startsWith('Memory item not found')) {
          throw new ApiError('not_found', { detail: err.message });
        }
        throw new ApiError('validation_error', { detail: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  typed.delete(
    '/memory/:id',
    {
      schema: {
        tags: ['memory'],
        summary: 'Forget a persistent memory item',
        params: z.object({
          id: z.string().uuid(),
        }),
        response: {
          200: z.object({
            deleted: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const deleted = await memoryService.forgetMemory(user.id, request.params.id);
      if (!deleted) {
        throw new ApiError('not_found', { detail: `Memory item not found: ${request.params.id}` });
      }
      return { deleted: true };
    },
  );

  typed.delete(
    '/memory/project/:projectId',
    {
      schema: {
        tags: ['memory'],
        summary: 'Clear all persistent memories for a specific project',
        params: z.object({
          projectId: z.string().uuid(),
        }),
        response: {
          200: z.object({
            deleted: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const count = await memoryService.clearProjectMemories(user.id, request.params.projectId);
      return { deleted: count };
    },
  );

  typed.delete(
    '/memory/all',
    {
      schema: {
        tags: ['memory'],
        summary: 'Clear all persistent memories for current user',
        response: {
          200: z.object({
            deleted: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const count = await memoryService.clearAllMemories(user.id);
      return { deleted: count };
    },
  );
}
