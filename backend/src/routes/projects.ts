/**
 * Projects: the durable knowledge container.
 *
 * A project owns three things the rest of the app reads: instructions that are prepended to
 * every generation inside it, files that are extracted and chunked so retrieval has something
 * to rank, and saved sources kept from earlier answers.
 *
 * Two deliberate choices worth knowing before editing:
 *
 * - **Indexing is synchronous.** A file is extracted and chunked inside the upload request, so
 *   the response already says `ready` or `unsupported` and the UI never has to poll a status
 *   that may never change. Uploads are capped at `MAX_UPLOAD_BYTES`, which keeps the request
 *   bounded. A queue is the right answer at a larger size limit, not at this one.
 * - **Extraction failure is not upload failure.** A stored file that cannot be read for text
 *   lands as `unsupported` with the reason attached, because the bytes really are stored. We
 *   do not delete the user's file to make a status column tidy.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  chats,
  fileChunks,
  projectFiles,
  projects,
  savedSources,
} from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { storageKeyInUse } from '../services/attachments/references.js';
import { isolatedExtractPages } from '../services/attachments/isolatedExtract.js';
import { sniffBuffer } from '../services/attachments/sniff.js';
import { FileFailure, fileErrorText } from '../services/attachments/fileErrors.js';
import { reserveUpload } from '../services/attachments/quota.js';
import { INDEX_VERSION, indexFile } from '../services/retrieval.js';
import { checkUpload, generateStorageKey, safeDownloadName, sha256 } from '../services/storage.js';
import type { AppInstance } from '../types.js';
import {
  assertVersion,
  decodeCursor,
  encodeCursor,
  iso,
  paginationQuery,
  uuidParam,
} from './helpers.js';

/* -------------------------------------------------------------------------- shapes */

const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  instructions: z.string(),
  pinned: z.boolean(),
  position: z.number(),
  version: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  counts: z.object({
    files: z.number(),
    chats: z.number(),
    sources: z.number(),
    /** Chunks across every `ready` file: what retrieval can actually see. */
    indexedChunks: z.number(),
  }),
});

const fileSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  /** pending | indexing | ready | failed | unsupported */
  status: z.string(),
  error: z.string(),
  /** Stage 15 ER-9 code when `failed` / `unsupported`; '' otherwise. */
  errorCode: z.string(),
  /** Notes on a ready file, e.g. `chunk_cap` when only part of it is searchable. */
  warnings: z.array(z.object({ code: z.string(), detail: z.string() })),
  chunkCount: z.number(),
  checksumSha256: z.string(),
  indexedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});

const savedSourceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  url: z.string(),
  domain: z.string(),
  type: z.string(),
  snippet: z.string(),
  retrievedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});

type ProjectRow = typeof projects.$inferSelect;
type ProjectFileRow = typeof projectFiles.$inferSelect;
type SavedSourceRow = typeof savedSources.$inferSelect;

/* -------------------------------------------------------------------------- routes */

export async function projectRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  /* ---------------------------------------------------------------- list */

  typed.get(
    '/projects',
    {
      schema: {
        tags: ['projects'],
        summary: 'List projects, pinned first',
        querystring: paginationQuery.extend({ q: z.string().max(200).optional() }),
        response: {
          200: z.object({ items: z.array(projectSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { limit, cursor, q } = request.query;
      const decoded = decodeCursor(cursor);

      const filters = [eq(projects.userId, user.id), isNull(projects.deletedAt)];
      if (q?.trim()) {
        const pattern = `%${q.trim()}%`;
        filters.push(
          or(
            sql`${projects.title} ilike ${pattern}`,
            sql`${projects.description} ilike ${pattern}`,
          )!,
        );
      }
      if (decoded) {
        filters.push(
          or(
            lt(projects.updatedAt, new Date(decoded.at)),
            and(eq(projects.updatedAt, new Date(decoded.at)), lt(projects.id, decoded.id)),
          )!,
        );
      }

      const rows = await db
        .select()
        .from(projects)
        .where(and(...filters))
        .orderBy(desc(projects.updatedAt), desc(projects.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const counts = await countsFor(request, page.map((p) => p.id));

      // Pinned first, then the caller's manual order, then recency. Sorted here rather than in
      // SQL because the keyset cursor has to run on `updatedAt` to stay stable across inserts;
      // mixing the two orderings in one query would make the cursor meaningless.
      const items = page
        .map((row) => toProjectDto(row, counts.get(row.id)))
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            a.position - b.position ||
            (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
        );

      return {
        items,
        nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null,
      };
    },
  );

  /* ---------------------------------------------------------------- create */

  typed.post(
    '/projects',
    {
      schema: {
        tags: ['projects'],
        summary: 'Create a project',
        body: z.object({
          title: z.string().trim().min(1).max(200),
          description: z.string().max(2000).default(''),
          instructions: z.string().max(20_000).default(''),
        }),
        response: { 201: projectSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;

      // New projects land at the end of the manual order rather than silently at the top.
      const [tail] = await db
        .select({ next: sql<number>`coalesce(max(${projects.position}), -1) + 1` })
        .from(projects)
        .where(and(eq(projects.userId, user.id), isNull(projects.deletedAt)));

      const [created] = await db
        .insert(projects)
        .values({
          userId: user.id,
          title: request.body.title,
          description: request.body.description,
          instructions: request.body.instructions,
          position: tail?.next ?? 0,
        })
        .returning();

      return reply.status(201).send(toProjectDto(created!));
    },
  );

  /* ---------------------------------------------------------------- read */

  typed.get(
    '/projects/:id',
    {
      schema: {
        tags: ['projects'],
        summary: 'One project with its files and saved sources',
        params: uuidParam,
        response: {
          200: projectSchema.extend({
            files: z.array(fileSchema),
            sources: z.array(savedSourceSchema),
          }),
        },
      },
    },
    async (request) => {
      const { db } = request.services;
      const project = await loadProject(request, request.params.id);
      const counts = await countsFor(request, [project.id]);

      const [files, sources] = await Promise.all([
        db
          .select()
          .from(projectFiles)
          .where(eq(projectFiles.projectId, project.id))
          .orderBy(desc(projectFiles.createdAt)),
        db
          .select()
          .from(savedSources)
          .where(eq(savedSources.projectId, project.id))
          .orderBy(desc(savedSources.createdAt)),
      ]);

      return {
        ...toProjectDto(project, counts.get(project.id)),
        files: files.map(toFileDto),
        sources: sources.map(toSavedSourceDto),
      };
    },
  );

  /* ---------------------------------------------------------------- update */

  typed.patch(
    '/projects/:id',
    {
      schema: {
        tags: ['projects'],
        summary: 'Rename a project, edit its instructions, or pin it',
        params: uuidParam,
        body: z.object({
          title: z.string().trim().min(1).max(200).optional(),
          description: z.string().max(2000).optional(),
          instructions: z.string().max(20_000).optional(),
          pinned: z.boolean().optional(),
          version: z.number().int().optional(),
        }),
        response: { 200: projectSchema },
      },
    },
    async (request) => {
      const { db } = request.services;
      const project = await loadProject(request, request.params.id);
      assertVersion(request.body.version, project.version, 'project');

      const patch: Record<string, unknown> = {
        version: project.version + 1,
        updatedAt: new Date(),
      };
      for (const field of ['title', 'description', 'instructions', 'pinned'] as const) {
        if (request.body[field] !== undefined) patch[field] = request.body[field];
      }

      const [updated] = await db
        .update(projects)
        .set(patch)
        .where(eq(projects.id, project.id))
        .returning();

      const counts = await countsFor(request, [project.id]);
      return toProjectDto(updated!, counts.get(project.id));
    },
  );

  /* ---------------------------------------------------------------- reorder */

  typed.post(
    '/projects/reorder',
    {
      schema: {
        tags: ['projects'],
        summary: 'Set the manual order of projects',
        description:
          'Send the ids in the order you want them. Any project omitted keeps its current ' +
          'position and may therefore end up interleaved; send the full list to be sure.',
        body: z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { ids } = request.body;

      // Reject the whole reorder if any id is not the caller's, rather than silently applying
      // the subset that is — a partial order is worse than a refused one.
      const owned = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            inArray(projects.id, ids),
            eq(projects.userId, user.id),
            isNull(projects.deletedAt),
          ),
        );
      if (owned.length !== new Set(ids).size) throw notFound('project');

      await db.transaction(async (tx) => {
        for (const [position, id] of ids.entries()) {
          // `updatedAt` is deliberately left alone: reordering the sidebar is not an edit to
          // the project, and bumping it would reshuffle every recency-sorted list.
          await tx.update(projects).set({ position }).where(eq(projects.id, id));
        }
      });

      return reply.status(204).send(null);
    },
  );

  /* ---------------------------------------------------------------- delete */

  typed.delete(
    '/projects/:id',
    {
      schema: {
        tags: ['projects'],
        summary: 'Soft-delete a project',
        description:
          'Chats in the project are kept and detached from it, because a conversation has ' +
          'value independent of the folder it was filed under.',
        params: uuidParam,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { db } = request.services;
      const project = await loadProject(request, request.params.id);
      await db.transaction(async (tx) => {
        await tx.update(chats).set({ projectId: null }).where(eq(chats.projectId, project.id));
        await tx
          .update(projects)
          .set({ deletedAt: new Date() })
          .where(eq(projects.id, project.id));
      });
      return reply.status(204).send(null);
    },
  );

  /* ---------------------------------------------------------------- files: upload */

  typed.post(
    '/projects/:id/files',
    {
      schema: {
        tags: ['projects'],
        summary: 'Upload a file into a project and index it',
        description:
          'multipart/form-data with a single `file` part. The response already carries the ' +
          'final indexing status; there is nothing to poll.',
        consumes: ['multipart/form-data'],
        params: uuidParam,
        response: { 201: fileSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db, cfg, storage } = request.services;
      const project = await loadProject(request, request.params.id);

      const part = await request.file();
      if (!part) {
        throw new ApiError('validation_error', { detail: 'Attach a file in a `file` field.' });
      }
      // Reading to a buffer throws a 413 past `limits.fileSize`, which the error handler maps
      // to payload_too_large. Everything downstream needs the whole file anyway: a checksum, a
      // storage write, and text extraction all want the complete bytes.
      const data = await part.toBuffer();

      const check = checkUpload(part.filename, part.mimetype, data.length, cfg);
      if (!check.ok) throw new ApiError(check.code!, { detail: check.detail! });
      // The content must be what the name says (FT-12): a macro or legacy file renamed, or an
      // executable named .pdf, is refused before it is stored.
      try {
        sniffBuffer(data, part.filename, check.mimeType);
      } catch (err) {
        if (err instanceof FileFailure) {
          throw new ApiError(err.code === 'too_large' ? 'payload_too_large' : 'unsupported_media_type', {
            detail: fileErrorText(err.code, err.detail),
            meta: { fileErrorCode: err.code },
          });
        }
        throw err;
      }
      await reserveUpload(db, user.id, cfg.UPLOADS_PER_USER_PER_DAY);

      const storageKey = generateStorageKey(user.id);
      await storage.put(storageKey, data, check.mimeType);

      const [created] = await db
        .insert(projectFiles)
        .values({
          projectId: project.id,
          userId: user.id,
          filename: part.filename.slice(0, 255),
          mimeType: check.mimeType,
          sizeBytes: data.length,
          storageKey,
          checksumSha256: sha256(data),
          status: 'indexing',
        })
        .returning();

      const indexed = await runIndex(request, created!, data);
      return reply.status(201).send(toFileDto(indexed));
    },
  );

  /* ---------------------------------------------------------------- files: list */

  typed.get(
    '/projects/:id/files',
    {
      schema: {
        tags: ['projects'],
        summary: 'Files in a project',
        params: uuidParam,
        response: { 200: z.object({ items: z.array(fileSchema) }) },
      },
    },
    async (request) => {
      const { db } = request.services;
      const project = await loadProject(request, request.params.id);
      const rows = await db
        .select()
        .from(projectFiles)
        .where(eq(projectFiles.projectId, project.id))
        .orderBy(desc(projectFiles.createdAt));
      return { items: rows.map(toFileDto) };
    },
  );

  /* ---------------------------------------------------------------- files: download */

  typed.get(
    '/projects/:id/files/:fileId/download',
    {
      schema: {
        tags: ['projects'],
        summary: 'Download the stored bytes of a project file',
        params: z.object({ id: z.string().uuid(), fileId: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const { storage } = request.services;
      const project = await loadProject(request, request.params.id);
      const file = await loadProjectFile(request, project.id, request.params.fileId);
      const data = await storage.get(file.storageKey);

      return reply
        .header('Content-Type', file.mimeType)
        .header('Content-Length', String(data.length))
        // `attachment` rather than `inline`: a stored HTML or SVG file rendered in this origin
        // would run its own script against the session cookie.
        .header(
          'Content-Disposition',
          `attachment; filename="${safeDownloadName(file.filename)}"`,
        )
        .header('X-Content-Type-Options', 'nosniff')
        .send(data);
    },
  );

  /* ---------------------------------------------------------------- files: reindex */

  typed.post(
    '/projects/:id/files/:fileId/reindex',
    {
      schema: {
        tags: ['projects'],
        summary: 'Re-extract and re-chunk a file',
        description: 'Useful after a failed extraction. Existing chunks are replaced, not added to.',
        params: z.object({ id: z.string().uuid(), fileId: z.string().uuid() }),
        response: { 200: fileSchema },
      },
    },
    async (request) => {
      const { db, storage } = request.services;
      const project = await loadProject(request, request.params.id);
      const file = await loadProjectFile(request, project.id, request.params.fileId);

      await db
        .update(projectFiles)
        .set({ status: 'indexing', error: '' })
        .where(eq(projectFiles.id, file.id));

      const data = await storage.get(file.storageKey);
      return toFileDto(await runIndex(request, file, data));
    },
  );

  /* ---------------------------------------------------------------- files: delete */

  typed.delete(
    '/projects/:id/files/:fileId',
    {
      schema: {
        tags: ['projects'],
        summary: 'Remove a file and its chunks',
        params: z.object({ id: z.string().uuid(), fileId: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { db, storage } = request.services;
      const project = await loadProject(request, request.params.id);
      const file = await loadProjectFile(request, project.id, request.params.fileId);

      // Row first, object second. If the object delete fails we have an orphaned blob, which
      // costs storage; the other order leaves a row pointing at bytes that are gone, which the
      // user sees as a file that will not open.
      await db.delete(projectFiles).where(eq(projectFiles.id, file.id));
      // A chat attachment picked from this file reads these same bytes (its key is a copy of
      // ours). They stay until the last such attachment goes; retention removes them then.
      if (await storageKeyInUse(db, file.storageKey)) return reply.status(204).send(null);
      try {
        await storage.delete(file.storageKey);
      } catch (err) {
        request.log.warn({ err, storageKey: file.storageKey }, 'orphaned object after delete');
      }

      return reply.status(204).send(null);
    },
  );

  /* ---------------------------------------------------------------- search */

  typed.get(
    '/projects/:id/search',
    {
      schema: {
        tags: ['projects'],
        summary: 'Rank this project’s indexed chunks against a query',
        description:
          'Lexical (BM25) ranking over extracted text. This is not semantic search: a query ' +
          'that shares no words with a document will not match it.',
        params: uuidParam,
        querystring: z.object({
          q: z.string().trim().min(1).max(500),
          limit: z.coerce.number().int().min(1).max(50).default(10),
        }),
        response: {
          200: z.object({
            method: z.literal('bm25'),
            items: z.array(
              z.object({
                chunkId: z.string(),
                fileId: z.string(),
                filename: z.string(),
                ordinal: z.number(),
                text: z.string(),
                score: z.number(),
                /** 1-based source page, when the file is paginated (PDF). Null otherwise. */
                page: z.number().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const { db, retriever } = request.services;
      const project = await loadProject(request, request.params.id);
      const items = await retriever.search(db, project.id, request.query.q, request.query.limit);
      return { method: 'bm25' as const, items };
    },
  );

  /* ---------------------------------------------------------------- saved sources */

  typed.get(
    '/projects/:id/sources',
    {
      schema: {
        tags: ['projects'],
        summary: 'Sources saved to a project',
        params: uuidParam,
        response: { 200: z.object({ items: z.array(savedSourceSchema) }) },
      },
    },
    async (request) => {
      const { db } = request.services;
      const project = await loadProject(request, request.params.id);
      const rows = await db
        .select()
        .from(savedSources)
        .where(eq(savedSources.projectId, project.id))
        .orderBy(desc(savedSources.createdAt));
      return { items: rows.map(toSavedSourceDto) };
    },
  );

  typed.post(
    '/projects/:id/sources',
    {
      schema: {
        tags: ['projects'],
        summary: 'Save a source to a project',
        params: uuidParam,
        body: z.object({
          title: z.string().trim().min(1).max(500),
          url: z.string().url().max(4000),
          type: z.string().max(32).default('Web'),
          snippet: z.string().max(4000).default(''),
          retrievedAt: z.string().datetime().optional(),
        }),
        response: { 201: savedSourceSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;
      const project = await loadProject(request, request.params.id);

      const parsed = new URL(request.body.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ApiError('validation_error', { detail: 'Only http and https links can be saved.' });
      }

      const [created] = await db
        .insert(savedSources)
        .values({
          projectId: project.id,
          userId: user.id,
          title: request.body.title,
          url: request.body.url,
          // Derived, never taken from the client: the badge must reflect the real destination.
          domain: parsed.hostname.replace(/^www\./, ''),
          sourceType: request.body.type,
          snippet: request.body.snippet,
          retrievedAt: request.body.retrievedAt ? new Date(request.body.retrievedAt) : new Date(),
        })
        .returning();

      return reply.status(201).send(toSavedSourceDto(created!));
    },
  );

  typed.delete(
    '/projects/:id/sources/:sourceId',
    {
      schema: {
        tags: ['projects'],
        summary: 'Remove a saved source',
        params: z.object({ id: z.string().uuid(), sourceId: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { db } = request.services;
      const project = await loadProject(request, request.params.id);
      const removed = await db
        .delete(savedSources)
        .where(
          and(
            eq(savedSources.id, request.params.sourceId),
            eq(savedSources.projectId, project.id),
          ),
        )
        .returning({ id: savedSources.id });
      if (removed.length === 0) throw notFound('source');
      return reply.status(204).send(null);
    },
  );
}

/* -------------------------------------------------------------------------- helpers */

interface OwnedRequest {
  services: AppInstance['services'];
  user: { id: string } | null;
}

/** Load a project the caller owns, or 404. Ownership and existence are the same answer. */
export async function loadProject(request: OwnedRequest, id: string): Promise<ProjectRow> {
  const user = request.user;
  if (!user) throw new ApiError('unauthorized');
  const [row] = await request.services.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) throw notFound('project');
  return row;
}

async function loadProjectFile(
  request: OwnedRequest,
  projectId: string,
  fileId: string,
): Promise<ProjectFileRow> {
  const [row] = await request.services.db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.id, fileId), eq(projectFiles.projectId, projectId)))
    .limit(1);
  if (!row) throw notFound('file');
  return row;
}

interface Counts {
  files: number;
  chats: number;
  sources: number;
  indexedChunks: number;
}

/** One grouped query per relation rather than four per project. */
async function countsFor(
  request: { services: AppInstance['services'] },
  ids: string[],
): Promise<Map<string, Counts>> {
  const map = new Map<string, Counts>();
  if (ids.length === 0) return map;
  const { db } = request.services;

  const [files, chatRows, sources, chunks] = await Promise.all([
    db
      .select({ key: projectFiles.projectId, n: sql<number>`count(*)::int` })
      .from(projectFiles)
      .where(inArray(projectFiles.projectId, ids))
      .groupBy(projectFiles.projectId),
    db
      .select({ key: chats.projectId, n: sql<number>`count(*)::int` })
      .from(chats)
      .where(and(inArray(chats.projectId, ids), isNull(chats.deletedAt)))
      .groupBy(chats.projectId),
    db
      .select({ key: savedSources.projectId, n: sql<number>`count(*)::int` })
      .from(savedSources)
      .where(inArray(savedSources.projectId, ids))
      .groupBy(savedSources.projectId),
    db
      .select({ key: fileChunks.projectId, n: sql<number>`count(*)::int` })
      .from(fileChunks)
      .innerJoin(projectFiles, eq(fileChunks.projectFileId, projectFiles.id))
      .where(and(inArray(fileChunks.projectId, ids), eq(projectFiles.status, 'ready')))
      .groupBy(fileChunks.projectId),
  ]);

  for (const id of ids) map.set(id, { files: 0, chats: 0, sources: 0, indexedChunks: 0 });
  const apply = (
    rows: Array<{ key: string | null; n: number }>,
    field: keyof Counts,
  ): void => {
    for (const row of rows) {
      if (!row.key) continue;
      const entry = map.get(row.key);
      if (entry) entry[field] = row.n;
    }
  };
  apply(files, 'files');
  apply(chatRows, 'chats');
  apply(sources, 'sources');
  apply(chunks, 'indexedChunks');
  return map;
}

/**
 * Extract, chunk, and store the result, then write the outcome back onto the file row.
 *
 * An extraction that cannot proceed (scanned PDF, image) is `unsupported` with the reason
 * shown; an unexpected throw is `failed`. The two are different to the user: one will never
 * work, the other is worth retrying.
 */
async function runIndex(
  request: { services: AppInstance['services']; log: AppInstance['log'] },
  file: ProjectFileRow,
  data: Buffer,
): Promise<ProjectFileRow> {
  const { db, visionProvider } = request.services;
  let patch: Partial<ProjectFileRow>;

  try {
    const result = await indexFile(db, file, data, visionProvider, isolatedExtractPages(request.services.cfg));
    patch = {
      status: result.status,
      error: result.error,
      errorCode: result.errorCode,
      warnings: result.warnings,
      chunkCount: result.chunkCount,
      indexVersion: INDEX_VERSION,
      indexedAt: new Date(),
    };
  } catch (err) {
    request.log.error({ errName: err instanceof Error ? err.name : 'unknown', fileId: file.id }, 'indexing failed');
    patch = {
      status: 'failed',
      error: 'This file could not be indexed. You can retry it.',
      errorCode: '',
      warnings: [],
      chunkCount: 0,
      indexedAt: null,
    };
  }

  const [updated] = await db
    .update(projectFiles)
    .set(patch)
    .where(eq(projectFiles.id, file.id))
    .returning();
  return updated!;
}

/* -------------------------------------------------------------------------- DTOs */

function toProjectDto(
  row: ProjectRow,
  counts: Counts = { files: 0, chats: 0, sources: 0, indexedChunks: 0 },
): z.infer<typeof projectSchema> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    pinned: row.pinned,
    position: row.position,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    counts,
  };
}

function toFileDto(row: ProjectFileRow): z.infer<typeof fileSchema> {
  return {
    id: row.id,
    projectId: row.projectId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    errorCode: row.errorCode,
    warnings: row.warnings,
    chunkCount: row.chunkCount,
    checksumSha256: row.checksumSha256,
    indexedAt: iso(row.indexedAt),
    createdAt: iso(row.createdAt),
  };
}

function toSavedSourceDto(row: SavedSourceRow): z.infer<typeof savedSourceSchema> {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    url: row.url,
    domain: row.domain,
    type: row.sourceType,
    snippet: row.snippet,
    retrievedAt: iso(row.retrievedAt),
    createdAt: iso(row.createdAt),
  };
}
