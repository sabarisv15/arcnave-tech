import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { MemoryConcurrencyError, memoryService } from '../services/memory/memoryService.js';
import type { MemoryItem } from '../db/schema.js';
import type { AppInstance } from '../types.js';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { memoryItems, projects } from '../db/schema.js';
import {
  MAX_IMPORT_ITEMS,
  MEMORY_EXPORT_VERSION,
  normalise,
  parseImportText,
} from '../services/memory/memoryTransfer.js';

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

  // Memory topics can be read, edited and deleted in settings (ADR-0025).
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

  /* ---------------------------------------------------------------- transfer (ADR-0040) */

  const transferItem = z.object({
    key: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20_000),
    kind: z.enum(['preference', 'workflow', 'fact', 'constraint']).optional(),
    isStanding: z.boolean().optional(),
    projectId: z.string().uuid().nullable().optional(),
  });

  typed.get(
    '/memory/export',
    {
      schema: {
        tags: ['memory'],
        summary: 'Every memory, as JSON that import reads back',
        response: {
          200: z.object({
            version: z.literal(MEMORY_EXPORT_VERSION),
            exportedAt: z.string(),
            items: z.array(transferItem.extend({ projectId: z.string().uuid().nullable() })),
          }),
        },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const rows = await request.services.db
        .select()
        .from(memoryItems)
        .where(eq(memoryItems.userId, user.id))
        .orderBy(asc(memoryItems.createdAt));
      void reply.header('Content-Disposition', 'attachment; filename="arcnave-memory.json"');
      return {
        version: MEMORY_EXPORT_VERSION as typeof MEMORY_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        items: rows.map((r) => ({
          key: r.key,
          content: r.content,
          kind: r.kind as 'preference' | 'workflow' | 'fact' | 'constraint',
          isStanding: r.isStanding,
          projectId: r.projectId,
        })),
      };
    },
  );

  typed.post(
    '/memory/import',
    {
      schema: {
        tags: ['memory'],
        summary: 'Add memories from an export, or from text with one memory per line',
        description:
          'Give `text` (for example what another assistant lists when asked what it remembers) or `data` ' +
          '(an ArcNave memory export). A memory already held, by topic or by wording, is skipped, never replaced.',
        body: z.union([
          z.object({ text: z.string().min(1).max(200_000) }),
          z.object({ data: z.object({ version: z.literal(MEMORY_EXPORT_VERSION), items: z.array(transferItem) }) }),
        ]),
        response: { 200: z.object({ added: z.number(), skipped: z.number() }) },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db } = request.services;
      const incoming = 'text' in request.body ? parseImportText(request.body.text) : request.body.data.items;
      if (incoming.length === 0) {
        throw new ApiError('validation_error', { detail: 'No memories were found in what was given.' });
      }
      if (incoming.length > MAX_IMPORT_ITEMS) {
        throw new ApiError('validation_error', {
          detail: `At most ${MAX_IMPORT_ITEMS} memories can be imported at once; this has ${incoming.length}.`,
        });
      }

      const existing = await db
        .select({ key: memoryItems.key, content: memoryItems.content, projectId: memoryItems.projectId })
        .from(memoryItems)
        .where(eq(memoryItems.userId, user.id));
      const ownedProjects = new Set(
        (
          await db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.userId, user.id), isNull(projects.deletedAt)))
        ).map((p) => p.id),
      );
      const seenKeys = new Set(existing.map((e) => `${e.projectId ?? ''}:${e.key}`));
      const seenContent = new Set(existing.map((e) => normalise(e.content)));

      let added = 0;
      let skipped = 0;
      for (const item of incoming) {
        // A project that is not this account's is not a place to put a memory.
        const projectId = item.projectId && ownedProjects.has(item.projectId) ? item.projectId : null;
        const keyId = `${projectId ?? ''}:${item.key}`;
        const content = normalise(item.content);
        if (seenKeys.has(keyId) || seenContent.has(content)) {
          skipped++;
          continue;
        }
        try {
          await memoryService.createMemory({
            userId: user.id,
            scope: projectId ? 'project' : 'global',
            projectId,
            key: item.key,
            content: item.content,
            ...(item.kind ? { kind: item.kind } : {}),
            ...(item.isStanding !== undefined ? { isStanding: item.isStanding } : {}),
            sourceType: 'user_statement',
          });
          seenKeys.add(keyId);
          seenContent.add(content);
          added++;
        } catch {
          // Refused by the privacy check (a credential in the text): not stored, counted.
          skipped++;
        }
      }
      return { added, skipped };
    },
  );
}
