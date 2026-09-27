/**
 * Account data controls (WP-13, ADR-0040): a full export, and deleting the account.
 */
import { and, eq } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { accountExports, chats, users } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { buildAccountExport } from '../services/accountExport.js';
import { verifyPassword } from '../services/auth.js';
import { generateStorageKey } from '../services/storage.js';
import type { AppInstance } from '../types.js';
import { iso, uuidParam } from './helpers.js';

/** How long an export's download link works. */
export const EXPORT_TTL_MS = 24 * 3_600_000;

export async function accountRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  typed.post(
    '/account/export',
    {
      schema: {
        tags: ['auth'],
        summary: 'Build a zip of everything this account holds',
        description: 'The download link works for 24 hours, and only for the signed-in owner.',
        response: {
          201: z.object({ id: z.string(), downloadPath: z.string(), sizeBytes: z.number(), expiresAt: z.string().nullable() }),
        },
      },
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db, storage } = request.services;
      const zip = Buffer.from(await buildAccountExport(db, storage, user.id));
      const key = generateStorageKey(user.id);
      await storage.put(key, zip, 'application/zip');
      const [row] = await db
        .insert(accountExports)
        .values({ userId: user.id, storageKey: key, sizeBytes: zip.length, expiresAt: new Date(Date.now() + EXPORT_TTL_MS) })
        .returning();
      return reply.status(201).send({
        id: row!.id,
        downloadPath: `/account/exports/${row!.id}/download`,
        sizeBytes: row!.sizeBytes,
        expiresAt: iso(row!.expiresAt),
      });
    },
  );

  typed.get(
    '/account/exports/:id/download',
    {
      schema: { tags: ['auth'], summary: 'Download an export while its link is valid', params: uuidParam },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db, storage } = request.services;
      const [row] = await db
        .select()
        .from(accountExports)
        .where(and(eq(accountExports.id, request.params.id), eq(accountExports.userId, user.id)))
        .limit(1);
      if (!row) throw notFound('export');
      if (row.expiresAt.getTime() < Date.now()) throw new ApiError('export_expired');
      const day = row.createdAt.toISOString().slice(0, 10);
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Length', String(row.sizeBytes))
        .header('Content-Disposition', `attachment; filename="arcnave-export-${day}.zip"`)
        .header('Cache-Control', 'no-store')
        .send(storage.openRead(row.storageKey));
    },
  );

  typed.delete(
    '/account',
    {
      schema: {
        tags: ['auth'],
        summary: 'Delete this account and everything it holds',
        description:
          'Needs the current password. Stored files go first, then every row; the session ends. ' +
          'It cannot be undone.',
        body: z.object({ password: z.string().min(1).max(200) }),
        response: { 204: z.null() },
      },
      config: { rateLimit: { max: app.services.cfg.RATE_LIMIT_AUTH_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db, storage, activeRuns, cfg } = request.services;
      const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
      if (!row || !(await verifyPassword(request.body.password, row.passwordHash))) {
        throw new ApiError('password_incorrect');
      }
      // Stop anything still writing for this account before its rows go.
      const owned = await db.select({ id: chats.id }).from(chats).where(eq(chats.userId, user.id));
      for (const chat of owned) activeRuns.get(chat.id)?.abort();
      // Bytes first: if storage fails, the rows that name the bytes are still there to retry.
      await storage.deleteOwned(user.id);
      // Every other table's rows cascade from the user (ADR-0040 lists them).
      await db.delete(users).where(eq(users.id, user.id));
      void reply.clearCookie(cfg.SESSION_COOKIE_NAME, { path: '/' });
      return reply.status(204).send(null);
    },
  );
}
