/**
 * How long a deleted chat and an unsent upload are kept.
 *
 * Claude is the reference (Anthropic Privacy Center, "Can you delete data sent via Claude?"): a
 * deleted conversation leaves the user's history at once and is removed from the back end
 * within 30 days. `DELETE /chats/:id` does the first part (it sets `deletedAt`); this sweep does
 * the second. It removes the chat's rows (messages, their attachments and everything else that
 * cascades) and the stored bytes of files uploaded into it.
 *
 * - An attachment picked from a project shares that project file's stored object, so its bytes
 *   are the project's, and they stay.
 * - Artifacts are the user's own library and outlive the chat (`chat_id` is set null).
 * - An upload never sent with a message is removed after UNSENT_UPLOAD_TTL_HOURS. The upload
 *   route has always said such files are "not kept forever".
 * - A chat's sandbox checkpoint (ADR-0015) goes with the chat, and otherwise after
 *   SANDBOX_STATE_RETENTION_DAYS without a run, as Claude's containers expire after 30 days.
 */
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import { attachments, chats, messages, sandboxWorkspaces } from '../db/schema.js';
import { deleteCheckpoint } from '../tools/sandbox/workspaceState.js';
import type { ObjectStorage } from './storage.js';

/** Fixed key so two instances never sweep at once; any other value would do. */
const RETENTION_LOCK_KEY = 872_634_002;
/** Chats purged per sweep, so one sweep stays short; the next sweep takes the rest. */
const CHATS_PER_SWEEP = 50;

export interface RetentionPolicy {
  chatPurgeAfterDays: number;
  unsentUploadTtlHours: number;
  sandboxStateDays: number;
}

export interface SweepResult {
  chatsPurged: number;
  uploadsPurged: number;
  checkpointsPurged: number;
  /** True when another instance held the lock, and this one did nothing. */
  skipped: boolean;
}

export async function sweepRetention(
  db: Database,
  storage: ObjectStorage,
  policy: RetentionPolicy,
  now: Date = new Date(),
  log: { warn: (obj: object, msg: string) => void } = console,
): Promise<SweepResult> {
  return db.transaction(async (tx) => {
    const [lock] = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(${RETENTION_LOCK_KEY}) as ok`,
    )) as unknown as Array<{ ok: boolean }>;
    if (!lock?.ok) return { chatsPurged: 0, uploadsPurged: 0, checkpointsPurged: 0, skipped: true };

    const chatCutoff = new Date(now.getTime() - policy.chatPurgeAfterDays * 86_400_000);
    const due = await tx
      .select({ id: chats.id })
      .from(chats)
      .where(and(isNotNull(chats.deletedAt), lt(chats.deletedAt, chatCutoff)))
      .limit(CHATS_PER_SWEEP);

    let chatsPurged = 0;
    for (const chat of due) {
      const files = await tx
        .select({ storageKey: attachments.storageKey })
        .from(attachments)
        .innerJoin(messages, eq(messages.id, attachments.messageId))
        .where(and(eq(messages.chatId, chat.id), isNull(attachments.projectFileId)));
      // Bytes first, rows second: a failed object delete keeps the row, so the next sweep
      // retries it instead of leaving bytes nothing points to.
      if (!(await deleteObjects(storage, files.map((f) => f.storageKey), log))) continue;
      const workspaces = await tx
        .select({ manifestKey: sandboxWorkspaces.manifestKey })
        .from(sandboxWorkspaces)
        .where(eq(sandboxWorkspaces.chatId, chat.id));
      let checkpointsGone = true;
      for (const w of workspaces) checkpointsGone = (await deleteCheckpoint(storage, w.manifestKey, log)) && checkpointsGone;
      if (!checkpointsGone) continue;
      await tx.delete(chats).where(eq(chats.id, chat.id));
      chatsPurged++;
    }

    const uploadCutoff = new Date(now.getTime() - policy.unsentUploadTtlHours * 3_600_000);
    const unsent = await tx
      .select({ id: attachments.id, storageKey: attachments.storageKey, projectFileId: attachments.projectFileId })
      .from(attachments)
      .where(and(isNull(attachments.messageId), lt(attachments.createdAt, uploadCutoff)));
    const removable: string[] = [];
    for (const row of unsent) {
      if (row.projectFileId || (await deleteObjects(storage, [row.storageKey], log))) removable.push(row.id);
    }
    if (removable.length > 0) await tx.delete(attachments).where(inArray(attachments.id, removable));

    const stateCutoff = new Date(now.getTime() - policy.sandboxStateDays * 86_400_000);
    const stale = await tx
      .select({ ws: sandboxWorkspaces.workspaceId, manifestKey: sandboxWorkspaces.manifestKey })
      .from(sandboxWorkspaces)
      .where(lt(sandboxWorkspaces.lastRunAt, stateCutoff))
      .limit(CHATS_PER_SWEEP);
    let checkpointsPurged = 0;
    for (const w of stale) {
      if (!(await deleteCheckpoint(storage, w.manifestKey, log))) continue;
      await tx.delete(sandboxWorkspaces).where(eq(sandboxWorkspaces.workspaceId, w.ws));
      checkpointsPurged++;
    }

    return { chatsPurged, uploadsPurged: removable.length, checkpointsPurged, skipped: false };
  });
}

async function deleteObjects(
  storage: ObjectStorage,
  keys: string[],
  log: { warn: (obj: object, msg: string) => void },
): Promise<boolean> {
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (err) {
      log.warn({ err, storageKey: key }, 'retention: stored object could not be deleted; will retry');
      return false;
    }
  }
  return true;
}
