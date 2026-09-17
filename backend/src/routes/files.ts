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
import { and, eq, isNull, lt } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { attachments, projectFiles } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { ExtractionUnsupported, extractText } from '../services/retrieval.js';
import { checkUpload, generateStorageKey, safeDownloadName } from '../services/storage.js';
import type { AppInstance } from '../types.js';
import { iso, uuidParam } from './helpers.js';

/** Extracted text handed to a single prompt, so it is capped independently of file size. */
const MAX_EXTRACTED_CHARS = 200_000;

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
  createdAt: z.string().nullable(),
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
      const { db, cfg, storage } = request.services;

      const part = await request.file();
      if (!part) {
        throw new ApiError('validation_error', { detail: 'Attach a file in a `file` field.' });
      }
      const data = await part.toBuffer();

      const check = checkUpload(part.filename, part.mimetype, data.length, cfg);
      if (!check.ok) throw new ApiError(check.code!, { detail: check.detail! });

      const storageKey = generateStorageKey(user.id);
      await storage.put(storageKey, data, check.mimeType);

      // Images and PDFs are read by the model directly (see the multimodal file input design)
      // — there is nothing useful to extract, and extracting anyway would just be discarded
      // work. Extraction failing for any other type is not upload failing: a format nothing
      // here can read is stored with a machine-readable reason, never silently dropped.
      let extractedText: string | null = null;
      let status = 'ready';
      let error = '';
      if (!isNativelyViewable(check.mimeType)) {
        try {
          const text = await extractText(data, check.mimeType, part.filename);
          extractedText = text.slice(0, MAX_EXTRACTED_CHARS);
          if (text.length > MAX_EXTRACTED_CHARS) {
            error =
              `Only the first ${MAX_EXTRACTED_CHARS.toLocaleString('en-US')} characters of ` +
              'this file are sent with your message.';
          }
        } catch (err) {
          if (err instanceof ExtractionUnsupported) {
            status = 'unsupported';
            error = err.message;
          } else {
            request.log.error({ err }, 'attachment extraction failed');
            status = 'unsupported';
            error = 'The text of this file could not be read. It is stored but will not be sent.';
          }
        }
      }

      const [created] = await db
        .insert(attachments)
        .values({
          userId: user.id,
          filename: part.filename.slice(0, 255),
          mimeType: check.mimeType,
          sizeBytes: data.length,
          storageKey,
          status,
          error,
          extractedText,
        })
        .returning();

      return reply.status(201).send(toDto(created!));
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
      },
    },
    async (request, reply) => {
      const { storage } = request.services;
      const file = await loadAttachment(request, request.params.id);
      const data = await storage.get(file.storageKey);

      return reply
        .header('Content-Type', file.mimeType)
        .header('Content-Length', String(data.length))
        // Always an attachment: serving user-uploaded HTML or SVG inline on this origin would
        // let it run script against the session cookie.
        .header('Content-Disposition', `attachment; filename="${safeDownloadName(file.filename)}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .send(data);
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
        .returning({ storageKey: attachments.storageKey });

      for (const row of stale) {
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

function toDto(row: AttachmentRow): z.infer<typeof attachmentSchema> {
  return {
    id: row.id,
    messageId: row.messageId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    hasText: Boolean(row.extractedText?.trim()),
    viewable: isNativelyViewable(row.mimeType),
    createdAt: iso(row.createdAt),
  };
}
