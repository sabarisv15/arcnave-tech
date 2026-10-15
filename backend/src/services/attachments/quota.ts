/**
 * Per-user upload quota (Stage 1 FT-15, N-11): counted when an upload starts, before any byte
 * is accepted or any storage URL is handed out. One upsert per upload, so two uploads at once
 * cannot both read the old count (a transaction is not a lock; the unique row is).
 */
import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { uploadQuota } from '../../db/schema.js';
import { ApiError } from '../../errors.js';

export async function reserveUpload(db: Database, userId: string, perDay: number, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const [row] = await db
    .insert(uploadQuota)
    .values({ userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [uploadQuota.userId, uploadQuota.day],
      set: { count: sql`${uploadQuota.count} + 1` },
    })
    .returning({ count: uploadQuota.count });
  if ((row?.count ?? 0) > perDay) {
    // A refused upload is not one of the day's uploads.
    await db
      .update(uploadQuota)
      .set({ count: sql`${uploadQuota.count} - 1` })
      .where(sql`${uploadQuota.userId} = ${userId} and ${uploadQuota.day} = ${day}`);
    throw new ApiError('upload_quota_exceeded', {
      detail: `You can upload ${String(perDay)} files a day. Try again tomorrow.`,
      meta: { fileErrorCode: 'quota' },
    });
  }
}
