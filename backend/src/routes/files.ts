/**
 * Message attachments.
 *
 * Distinct from project files on purpose. A project file is durable knowledge: chunked,
 * indexed, and ranked by retrieval. An attachment belongs to one message — its text is
 * extracted whole and passed straight into that one prompt, with no chunking and no ranking.
 *
 * Attachments are uploaded before the message exists, so a row starts with `messageId` null and
 * is claimed by `POST /chats/:id/generate`. An unclaimed row is a user who changed their mind;
 * `DELETE /files/:id` and the cleanup below are what stop those accumulating.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { and, eq, isNull, lt } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { attachments, projectFiles } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { processUpload, readingFor, UploadRejected } from '../services/attachments/processUpload.js';
import { checkUpload, generateStorageKey, safeDownloadName, UploadTooLarge } from '../services/storage.js';
import type { AppInstance } from '../types.js';
import { iso, uuidParam } from './helpers.js';
import {
  isWorkbook,
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_COLUMNS,
  PREVIEW_MAX_ROWS,
  readSheets,
  sheetPreviewSchema,
} from './sheetPreview.js';

function isNativelyViewable(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/');
}

const attachmentSchema = z.object({
  id: z.string(),
  messageId: z.string().nullable(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  /** ready | unsupported — `unsupported` still stores the file, it just has no text. */
  status: z.string(),
  error: z.string(),
  /** Whether this file will contribute text to the prompt. */
  hasText: z.boolean(),
  /** True for an image or PDF the model can read directly, regardless of whether text
   *  extraction would have succeeded — this is a different question from `hasText`. */
  viewable: z.boolean(),
  /** Pages in a PDF; null for every other type. */
  pageCount: z.number().nullable(),
  /** How a model is shown this file: text+visual | text | visual | media | none. */
  reading: z.string(),
  createdAt: z.string().nullable(),
});

const directUploadSchema = z.object({
  file: attachmentSchema,
  /** Send the file's bytes here, as the whole request body, then call `complete`. */
  upload: z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    /** True when `url` is this API (send the session cookie); false for the storage bucket. */
    withCredentials: z.boolean(),
  }),
});

type AttachmentRow = typeof attachments.$inferSelect;

export async function fileRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  /* ---------------------------------------------------------------- upload */

  typed.post(
    '/files',
    {
      schema: {
        tags: ['projects'],
        summary: 'Upload a file to attach to a message',
        description:
          'multipart/form-data with a single `file` part. Returns an id to pass in ' +
          '`attachmentIds` on the next generate call. Unattached uploads are not kept forever.',
        consumes: ['multipart/form-data'],
        response: { 201: attachmentSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db, cfg, storage, visionProvider } = request.services;

      const part = await request.file();
      if (!part) {
        throw new ApiError('validation_error', { detail: 'Attach a file in a `file` field.' });
      }
      const data = await part.toBuffer();

      const check = checkUpload(part.filename, part.mimetype, data.length, cfg);
      if (!check.ok) throw new ApiError(check.code!, { detail: check.detail! });

      const storageKey = generateStorageKey(user.id);
      await storage.put(storageKey, data, check.mimeType);
      const [row] = await db
        .insert(attachments)
        .values({
          userId: user.id,
          filename: part.filename.slice(0, 255),
          mimeType: check.mimeType,
          sizeBytes: data.length,
          storageKey,
          status: 'uploading',
        })
        .returning();

      const created = await withLocalCopy(async (localPath) => {
        await writeFile(localPath, data);
        return finishUpload(request, row!, localPath, visionProvider);
      });
      return reply.status(201).send(created);
    },
  );

  /* ---------------------------------------------------------------- direct upload */

  // The local backend's upload target receives the raw bytes as a stream.
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });

  typed.post(
    '/files/uploads',
    {
      schema: {
        tags: ['projects'],
        summary: 'Start an upload of a file to attach to a message',
        description:
          'For files of any size up to ATTACHMENT_MAX_BYTES. Returns the attachment (status ' +
          '`uploading`) and where to PUT its bytes; with GCS storage that is the bucket itself, ' +
          'so the file never passes through this API. Then call `POST /files/:id/complete`.',
        body: z.object({
          filename: z.string().min(1).max(1024),
          mimeType: z.string().max(160).default(''),
          sizeBytes: z.number().int().nonnegative(),
        }),
        response: { 201: directUploadSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db, cfg, storage } = request.services;
      const { filename, mimeType, sizeBytes } = request.body;

      const check = checkUpload(filename, mimeType, sizeBytes, cfg, cfg.ATTACHMENT_MAX_BYTES);
      if (!check.ok) throw new ApiError(check.code!, { detail: check.detail! });

      const storageKey = generateStorageKey(user.id);
      const [row] = await db
        .insert(attachments)
        .values({
          userId: user.id,
          filename: path.basename(filename).slice(0, 255),
          mimeType: check.mimeType,
          sizeBytes,
          storageKey,
          status: 'uploading',
        })
        .returning();

      const direct = await storage.createDirectUpload(storageKey, check.mimeType, browserOrigin(request.headers.origin));
      const upload: z.infer<typeof directUploadSchema>['upload'] = direct
        ? { url: direct, method: 'PUT', headers: {}, withCredentials: false }
        : {
            url: `/files/${row!.id}/content`,
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            withCredentials: true,
          };
      return reply.status(201).send({ file: toDto(row!), upload });
    },
  );

  typed.put(
    '/files/:id/content',
    {
      schema: {
        tags: ['projects'],
        summary: 'Receive the bytes of an upload (local storage only)',
        description:
          'Only handed out by `POST /files/uploads` when storage cannot take the upload ' +
          'directly. The body is the raw file, exactly as many bytes as were declared.',
        params: uuidParam,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { storage } = request.services;
      const file = await loadAttachment(request, request.params.id);
      if (file.status !== 'uploading') {
        throw new ApiError('conflict', { detail: 'This upload has already finished.' });
      }
      if (!(request.body && typeof (request.body as Readable).pipe === 'function')) {
        throw new ApiError('validation_error', { detail: 'Send the file as application/octet-stream.' });
      }
      let written: number;
      try {
        written = await storage.putStream(file.storageKey, request.body as Readable, file.sizeBytes);
      } catch (err) {
        if (err instanceof UploadTooLarge) {
          await discard(request, file);
          throw new ApiError('upload_incomplete', {
            detail: 'More bytes arrived than the file was declared to have. Upload it again.',
          });
        }
        throw err;
      }
      if (written !== file.sizeBytes) {
        await discard(request, file);
        throw new ApiError('upload_incomplete', {
          detail: `${String(written)} of ${String(file.sizeBytes)} bytes arrived. Upload it again.`,
        });
      }
      return reply.status(204).send(null);
    },
  );

  typed.post(
    '/files/:id/complete',
    {
      schema: {
        tags: ['projects'],
        summary: 'Finish an upload: check the bytes arrived, then read the file',
        description:
          'Applies the per-type limits (PDF pages, image dimensions) and extracts text. A file ' +
          'that breaks a limit is deleted and the call fails with the reason.',
        params: uuidParam,
        response: { 200: attachmentSchema },
      },
    },
    async (request) => {
      const { storage, visionProvider } = request.services;
      const file = await loadAttachment(request, request.params.id);
      if (file.status !== 'uploading') return toDto(file);

      const stored = await storage.size(file.storageKey);
      if (stored !== file.sizeBytes) {
        await discard(request, file);
        throw new ApiError('upload_incomplete', {
          detail:
            stored === null
              ? 'The file never arrived. Upload it again.'
              : `${String(stored)} of ${String(file.sizeBytes)} bytes arrived. Upload it again.`,
        });
      }
      return withLocalCopy(async (localPath) => {
        await storage.downloadTo(file.storageKey, localPath);
        return finishUpload(request, file, localPath, visionProvider);
      });
    },
  );

  /* ---------------------------------------------------------------- from project */

  typed.post(
    '/files/from-project',
    {
      schema: {
        tags: ['projects'],
        summary: 'Attach an existing project file to a message',
        description:
          "Reuses the project file's stored bytes rather than re-uploading. Returns an id to " +
          'pass in `attachmentIds` on the next generate call, same as `POST /files`.',
        body: z.object({ projectFileId: z.string().uuid() }),
        response: { 201: attachmentSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;

      const [file] = await db
        .select()
        .from(projectFiles)
        .where(and(eq(projectFiles.id, request.body.projectFileId), eq(projectFiles.userId, user.id)))
        .limit(1);
      if (!file) throw notFound('file');

      const [created] = await db
        .insert(attachments)
        .values({
          userId: user.id,
          projectFileId: file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageKey: file.storageKey,
          status: 'ready',
          error: '',
          extractedText: null,
        })
        .returning();

      return reply.status(201).send(toDto(created!));
    },
  );

  /* ---------------------------------------------------------------- read */

  typed.get(
    '/files/:id',
    {
      schema: {
        tags: ['projects'],
        summary: 'Attachment metadata',
        params: uuidParam,
        response: { 200: attachmentSchema },
      },
    },
    async (request) => toDto(await loadAttachment(request, request.params.id)),
  );

  typed.get(
    '/files/:id/download',
    {
      schema: {
        tags: ['projects'],
        summary: 'Download the stored bytes of an attachment',
        params: uuidParam,
        querystring: z.object({
          download: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { storage } = request.services;
      const file = await loadAttachment(request, request.params.id);
      if (file.status === 'uploading') throw notFound('file');
      if (!(await storage.exists(file.storageKey))) {
        throw new ApiError('not_found', { detail: 'That file is no longer stored.' });
      }

      // Safe raster images may be viewed inline; HTML and SVG remain strictly attachments to protect sessions.
      const isInlineSafe = file.mimeType.startsWith('image/') && file.mimeType !== 'image/svg+xml';
      const forceDownload = Boolean(request.query?.download);
      const disposition = !forceDownload && isInlineSafe ? 'inline' : 'attachment';

      return reply
        .header('Content-Type', file.mimeType)
        .header('Content-Length', String(file.sizeBytes))
        .header('Content-Disposition', `${disposition}; filename="${safeDownloadName(file.filename)}"`)
        .header('X-Content-Type-Options', 'nosniff')
        // Streamed: a file can be hundreds of megabytes.
        .send(storage.openRead(file.storageKey));
    },
  );

  typed.get(
    '/files/:id/preview',
    {
      schema: {
        tags: ['projects'],
        summary: 'A spreadsheet attachment as sheets of typed cells, for the preview panel',
        description: `Every sheet's first ${PREVIEW_MAX_ROWS} rows and ${PREVIEW_MAX_COLUMNS} columns. Only .xlsx.`,
        params: uuidParam,
        response: { 200: sheetPreviewSchema },
      },
    },
    async (request) => {
      const { storage } = request.services;
      const file = await loadAttachment(request, request.params.id);
      if (file.status === 'uploading') throw notFound('file');
      if (!isWorkbook(file.mimeType, file.filename)) throw new ApiError('preview_unsupported');
      if (file.sizeBytes > PREVIEW_MAX_BYTES) {
        throw new ApiError('preview_unsupported', { detail: 'This workbook is too large to preview. Download it instead.' });
      }
      return { sheets: await readSheets(await storage.get(file.storageKey)) };
    },
  );

  /* ---------------------------------------------------------------- delete */

  typed.delete(
    '/files/:id',
    {
      schema: {
        tags: ['projects'],
        summary: 'Delete an attachment',
        description:
          'Refused once the file is attached to a message: removing it would leave a ' +
          'transcript claiming context the model can no longer be shown.',
        params: uuidParam,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { db, storage } = request.services;
      const file = await loadAttachment(request, request.params.id);
      if (file.messageId) {
        throw new ApiError('conflict', {
          detail:
            'This file is already part of a sent message. Delete the conversation instead.',
        });
      }

      await db.delete(attachments).where(eq(attachments.id, file.id));
      if (!file.projectFileId) {
        try {
          await storage.delete(file.storageKey);
        } catch (err) {
          request.log.warn({ err, storageKey: file.storageKey }, 'orphaned object after delete');
        }
      }
      return reply.status(204).send(null);
    },
  );

  /* ---------------------------------------------------------------- cleanup */

  typed.post(
    '/files/cleanup',
    {
      schema: {
        tags: ['projects'],
        summary: 'Discard your own uploads that were never attached to a message',
        description:
          'Scoped to the signed-in user. Safe to call on sign-out or app start; it only ' +
          'touches rows with no message and a creation time older than the cutoff.',
        body: z.object({ olderThanHours: z.number().int().min(1).max(24 * 30).default(24) }),
        response: { 200: z.object({ deleted: z.number() }) },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db, storage } = request.services;
      const cutoff = new Date(Date.now() - request.body.olderThanHours * 3600_000);

      const stale = await db
        .delete(attachments)
        .where(
          and(
            eq(attachments.userId, user.id),
            isNull(attachments.messageId),
            lt(attachments.createdAt, cutoff),
          ),
        )
        .returning({ storageKey: attachments.storageKey, projectFileId: attachments.projectFileId });

      for (const row of stale) {
        // Picked from a project: the bytes are the project file's, not this attachment's.
        if (row.projectFileId) continue;
        try {
          await storage.delete(row.storageKey);
        } catch (err) {
          request.log.warn({ err, storageKey: row.storageKey }, 'orphaned object after cleanup');
        }
      }
      return { deleted: stale.length };
    },
  );
}

/* -------------------------------------------------------------------------- helpers */

async function loadAttachment(
  request: { services: AppInstance['services']; user: { id: string } | null },
  id: string,
): Promise<AttachmentRow> {
  const user = request.user;
  if (!user) throw new ApiError('unauthorized');
  const [row] = await request.services.db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, user.id)))
    .limit(1);
  if (!row) throw notFound('file');
  return row;
}

type ServicesRequest = { services: AppInstance['services']; user: { id: string } | null };

/** Runs `fn` with a path in a fresh temp directory, and removes the directory afterwards. */
async function withLocalCopy<T>(fn: (localPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-upload-'));
  try {
    return await fn(path.join(dir, 'file'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Step 1's reading of a stored upload (see processUpload.ts). A file that breaks one of the
 * limits is removed, row and bytes, and the reason is the error the client gets.
 */
async function finishUpload(
  request: ServicesRequest & { log: { error: (obj: object, msg: string) => void } },
  row: AttachmentRow,
  localPath: string,
  visionProvider: AppInstance['services']['visionProvider'],
): Promise<z.infer<typeof attachmentSchema>> {
  const { db, cfg } = request.services;
  let processed;
  try {
    processed = await processUpload({
      path: localPath,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      visionProvider,
      memoryBudgetBytes: cfg.EXTRACTION_MEMORY_BUDGET_BYTES,
    });
  } catch (err) {
    if (err instanceof UploadRejected) {
      await discard(request, row);
      throw new ApiError(err.code, { detail: err.message });
    }
    // Reading failing is not the upload failing: the file is stored with the reason.
    request.log.error({ err }, 'attachment extraction failed');
    processed = {
      status: 'unsupported' as const,
      error: 'The text of this file could not be read. It is stored but will not be sent.',
      extractedText: null,
      pageCount: null,
    };
  }
  const [updated] = await db
    .update(attachments)
    .set(processed)
    .where(eq(attachments.id, row.id))
    .returning();
  return toDto(updated!);
}

async function discard(request: ServicesRequest, row: AttachmentRow): Promise<void> {
  await request.services.db.delete(attachments).where(eq(attachments.id, row.id));
  await request.services.storage.delete(row.storageKey).catch(() => undefined);
}

/** The page's origin, passed to GCS so it answers that page's cross-origin upload requests. */
function browserOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function toDto(row: AttachmentRow): z.infer<typeof attachmentSchema> {
  const hasText = Boolean(row.extractedText?.trim());
  return {
    id: row.id,
    messageId: row.messageId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    hasText,
    viewable: isNativelyViewable(row.mimeType),
    pageCount: row.pageCount,
    reading: row.status === 'uploading' ? 'none' : readingFor({ mimeType: row.mimeType, pageCount: row.pageCount, hasText }),
    createdAt: iso(row.createdAt),
  };
}
