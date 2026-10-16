/**
 * Turn start: the checks and writes that come before a turn runs, cut from the generate route
 * (`routes/chats.ts`) unchanged (ADR-0067; Stage 2 S2-4, RL2; D3 A-14). The route stays thin:
 * it streams the run; this module decides whether there is one.
 *
 * - **Ownership.** A chat is the caller's and not deleted (`loadChat`, which every chat route
 *   uses); a file is read and claimed only by its owner (`appendTurn`, `loadTurnAttachments`).
 * - **One run per chat** (`startTurn`), and a new user + assistant pair (`appendTurn`) or the
 *   retried assistant row cleared (`resetForRetry`).
 * - **The file rules.** A file already in a sent message, or not ready, refuses the send; a chat
 *   holds at most N-10 files (`FILE_LIMITS.maxFilesPerChat`), checked under the chat row lock.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import {
  attachments as attachmentsTable,
  chats,
  messages,
  messageSources,
  researchEvents,
  toolCalls as toolCallsTable,
} from '../../db/schema.js';
import type { DbLike } from '../../db/client.js';
import { ApiError, notFound } from '../../errors.js';
import type { AttachmentRef } from '../../providers/types.js';
import type { AppInstance } from '../../types.js';
import { toAttachmentRef } from '../attachments/attachmentRef.js';
import { FILE_LIMITS } from '../attachments/pipeline.js';

type ChatRow = typeof chats.$inferSelect;

export async function loadChat(
  request: { services: Pick<AppInstance['services'], 'db'>; user: { id: string } | null },
  id: string,
): Promise<ChatRow> {
  const user = request.user;
  if (!user) throw new ApiError('unauthorized');
  const [row] = await request.services.db
    .select()
    .from(chats)
    .where(and(eq(chats.id, id), eq(chats.userId, user.id), isNull(chats.deletedAt)))
    .limit(1);
  if (!row) throw notFound('conversation');
  return row;
}

/**
 * One run per chat; then the assistant row the run fills: a new user + assistant pair, or the
 * retried assistant row cleared. Returns its id.
 */
export async function startTurn(
  request: { services: Pick<AppInstance['services'], 'db' | 'activeRuns'> },
  chatId: string,
  userId: string,
  body: { prompt: string; mode: string; attachmentIds: string[]; retryMessageId?: string | undefined },
): Promise<string> {
  if (request.services.activeRuns.has(chatId)) throw new ApiError('run_in_progress');

  return body.retryMessageId
    ? await resetForRetry(request, chatId, body.retryMessageId)
    : await appendTurn(request, chatId, userId, body.prompt, body.mode, body.attachmentIds);
}

/** This turn's attachments, the caller's own only: metadata and storage references. */
export async function loadTurnAttachments(db: DbLike, userId: string, attachmentIds: string[]): Promise<AttachmentRef[]> {
  // --- gather attachments: metadata + storage references for native and text paths ---
  let turnAttachments: AttachmentRef[] = [];
  if (attachmentIds.length > 0) {
    const rows = await db
      .select({
        id: attachmentsTable.id,
        filename: attachmentsTable.filename,
        mimeType: attachmentsTable.mimeType,
        sizeBytes: attachmentsTable.sizeBytes,
        storageKey: attachmentsTable.storageKey,
        extractedText: attachmentsTable.extractedText,
      })
      .from(attachmentsTable)
      .where(
        and(
          inArray(attachmentsTable.id, attachmentIds),
          eq(attachmentsTable.userId, userId),
        ),
      );

    // Pass metadata + storage references; bytes are fetched on-demand by the provider adapter
    turnAttachments = rows.map(toAttachmentRef);
  }
  return turnAttachments;
}

/**
 * Closes out the assistant row of a run that failed outside the generation service.
 *
 * Failures raised before the stream opens (no model available, budget exhausted)
 * never reach the generation service's own persistence, so the assistant row would
 * stay 'generating' forever and show as a spinner after a reload.
 */
export async function markTurnFailed(
  db: DbLike,
  messageId: string,
  mode: string,
  code: string,
  log: Pick<FastifyBaseLogger, 'error'>,
): Promise<void> {
  await db
    .update(messages)
    .set({
      status: 'error',
      errorCode: code,
      researchStage: mode === 'chat' ? null : 'error',
      completedAt: new Date(),
    })
    .where(and(eq(messages.id, messageId), eq(messages.status, 'generating')))
    .catch((dbErr: unknown) => log.error({ err: dbErr }, 'failed to mark run as errored'));
}

/** Append the user turn plus an empty assistant row, returning the assistant message id. */
export async function appendTurn(
  request: { services: Pick<AppInstance['services'], 'db'> },
  chatId: string,
  userId: string,
  prompt: string,
  mode: string,
  attachmentIds: string[],
): Promise<string> {
  const { db } = request.services;

  return db.transaction(async (tx) => {
    let claimable = 0;
    if (attachmentIds.length > 0) {
      // Serialises turns on this chat, so two sends cannot both fit under the file limit.
      await tx.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId)).for('update');
      const incoming = await tx
        .select({ id: attachmentsTable.id, status: attachmentsTable.status, messageId: attachmentsTable.messageId })
        .from(attachmentsTable)
        .where(and(inArray(attachmentsTable.id, attachmentIds), eq(attachmentsTable.userId, userId)));
      // A file already in a sent message stays there: claiming it again would move it out of
      // that message, and the transcript would claim context it no longer has (D1 #18).
      const claimed = incoming.filter((a) => a.messageId !== null);
      if (claimed.length > 0) {
        throw new ApiError('file_already_attached', { meta: { fileIds: claimed.map((a) => a.id) } });
      }
      // Only a ready file is sent (AS-D6 + owner default for OQ-12): one still being read
      // blocks Send, and so does one that failed until it is retried or removed.
      const notReady = incoming.filter((a) => a.status !== 'ready');
      if (notReady.length > 0) {
        const failed = notReady.some((a) => a.status === 'failed' || a.status === 'unsupported');
        throw new ApiError('file_not_ready', {
          detail: failed
            ? 'A file could not be read. Retry it or remove it, then send.'
            : 'A file is still being read. Wait for it to finish, then send.',
          meta: { files: notReady.map((a) => ({ id: a.id, status: a.status })) },
        });
      }
      const fresh = incoming.length;
      claimable = incoming.length;
      const [held] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(attachmentsTable)
        .innerJoin(messages, eq(messages.id, attachmentsTable.messageId))
        .where(eq(messages.chatId, chatId));
      if ((held?.n ?? 0) + fresh > FILE_LIMITS.maxFilesPerChat) {
        throw new ApiError('too_many_files', {
          detail:
            `This chat already has ${String(held?.n ?? 0)} files, and a chat can hold at most ` +
            `${String(FILE_LIMITS.maxFilesPerChat)}. Start a new chat to add more.`,
        });
      }
    }

    // An aggregate without GROUP BY always yields exactly one row, but the driver types it
    // as possibly-empty, so the fallback keeps the sequence correct rather than asserting.
    const seqRows = await tx
      .select({ next: sql<number>`coalesce(max(${messages.seq}), -1) + 1` })
      .from(messages)
      .where(eq(messages.chatId, chatId));
    const next = seqRows[0]?.next ?? 0;

    const [userMessage] = await tx
      .insert(messages)
      .values({
        chatId,
        userId,
        seq: next,
        role: 'user',
        text: prompt,
        mode,
        status: 'complete',
        completedAt: new Date(),
      })
      .returning({ id: messages.id });

    const [assistant] = await tx
      .insert(messages)
      .values({
        chatId,
        userId,
        seq: next + 1,
        role: 'assistant',
        text: '',
        mode,
        status: 'generating',
      })
      .returning({ id: messages.id });

    if (attachmentIds.length > 0) {
      // `message_id IS NULL` makes the claim itself the guard: the row lock above serialises
      // sends on this chat, not two chats claiming one file. A row claimed meanwhile is not
      // moved, and the send fails instead of silently dropping the file.
      const moved = await tx
        .update(attachmentsTable)
        .set({ messageId: userMessage!.id })
        .where(
          and(
            inArray(attachmentsTable.id, attachmentIds),
            eq(attachmentsTable.userId, userId),
            isNull(attachmentsTable.messageId),
          ),
        )
        .returning({ id: attachmentsTable.id });
      if (moved.length !== claimable) throw new ApiError('file_already_attached');
    }

    // First real message names the chat, so the sidebar stops saying "New conversation".
    if (next === 0) {
      await tx
        .update(chats)
        .set({ title: prompt.slice(0, 80), updatedAt: new Date() })
        .where(eq(chats.id, chatId));
    }

    return assistant!.id;
  });
}

/**
 * Clear a previous attempt so a retry does not append duplicate sources, events or tool calls.
 * The tool calls go too: a call is stored with `onConflictDoNothing` on (message, ordinal), so
 * the old attempt's rows would win over the new attempt's and be replayed as its history.
 */
export async function resetForRetry(
  request: { services: Pick<AppInstance['services'], 'db'> },
  chatId: string,
  messageId: string,
): Promise<string> {
  const { db } = request.services;
  const [existing] = await db
    .select({ id: messages.id, role: messages.role })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.chatId, chatId)))
    .limit(1);
  if (!existing) throw notFound('message');
  if (existing.role !== 'assistant') {
    throw new ApiError('validation_error', { detail: 'Only an assistant message can be retried.' });
  }

  await db.delete(messageSources).where(eq(messageSources.messageId, messageId));
  await db.delete(researchEvents).where(eq(researchEvents.messageId, messageId));
  await db.delete(toolCallsTable).where(eq(toolCallsTable.messageId, messageId));
  await db
    .update(messages)
    .set({
      text: '',
      status: 'generating',
      errorCode: null,
      researchStage: null,
      questions: [],
      finishReason: null,
      searchEntryPoint: null,
      thinking: null,
      segments: null,
      completedAt: null,
    })
    .where(eq(messages.id, messageId));

  return messageId;
}
