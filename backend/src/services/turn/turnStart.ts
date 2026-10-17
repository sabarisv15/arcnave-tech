/**
 * Turn start: the checks and writes that come before a turn runs, cut from the generate route
 * (`routes/chats.ts`, ADR-0067; Stage 2 S2-4, RL2; D3 A-14) and made durable (ADR-0078). The route
 * stays thin: it streams the run; this module decides whether there is one.
 *
 * - **Ownership.** A chat is the caller's and not deleted (`loadChat`, which every chat route
 *   uses); a file is read and claimed only by its owner, and naming one that is not the caller's
 *   refuses the send with 404 (DEFERRED Part C: it was skipped, and the turn ran without it).
 * - **One turn per chat** (`startTurn`), decided under the chat row's lock, which every start takes
 *   (D3 A-03, CR2): an active turn refuses the start with 409 `run_in_progress`, and the partial
 *   unique index `uq_turns_running_chat` stands behind it. A turn whose lease lapsed is taken over
 *   first, so a dead instance does not hold the chat until the next sweep.
 * - **Idempotency** (Stage 3 1.4, Stage 15 ER-10c). A send with an `Idempotency-Key` already used
 *   with the same body returns that turn (`replayed`), nothing new written; with a different body,
 *   409 `idempotency_conflict`. Checked before `run_in_progress`, under the same lock.
 * - **One transaction.** The user + assistant pair (or the regenerated row cleared), the turn, its
 *   budget reservation and the idempotency key land together, or nothing does: a budget refusal
 *   leaves no row behind (Stage 3 1.6).
 * - **The file rules.** A file already in a sent message, or not ready, refuses the send; a chat
 *   holds at most N-10 files (`FILE_LIMITS.maxFilesPerChat`).
 */
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import {
  attachments as attachmentsTable,
  chats,
  idempotencyKeys,
  messages,
  messageSources,
  researchEvents,
  toolCalls as toolCallsTable,
  turns,
  type TurnParams,
} from '../../db/schema.js';
import type { DbLike, Transaction } from '../../db/client.js';
import { ApiError, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import type { AppInstance } from '../../types.js';
import { errorLogFields } from '../../errorLog.js';
import { fingerprint } from '../../routes/helpers.js';
import { FILE_LIMITS } from '../attachments/pipeline.js';
import { isUniqueViolation } from '../auth.js';
import type { BudgetPrefs } from '../usage.js';
import { dbNowPlus } from './turnLease.js';
import { type SettleDeps, type TurnBinding, FencedOut, activeTurnForUpdate, settleTurn } from './turnStore.js';

export { loadTurnAttachments } from './turnStore.js';

const log = logger.child({ module: 'turns' });

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

/** The endpoint an Idempotency-Key of a send is stored under. */
export const GENERATE_ENDPOINT = 'chats.generate';

export interface StartTurnBody {
  prompt: string;
  mode: TurnParams['mode'];
  model: string;
  attachmentIds: string[];
  retryMessageId?: string | undefined;
  codeExecution: boolean;
  effort?: TurnParams['effort'] | undefined;
  styleId?: string | undefined;
}

export interface StartTurnOptions {
  requestId: string;
  projectId: string | null;
  clientPlatform?: 'mobile' | 'desktop';
  /** The user's budget settings, read by the precheck. */
  prefs: BudgetPrefs;
  /** The worst case held against the budget until the turn settles (N-74). */
  reserveTokens: number;
  /** This process, as the lease owner. */
  instanceId: string;
  idempotencyKey?: string | undefined;
}

export interface StartedTurn {
  turnId: string;
  assistantMessageId: string;
  userMessageId: string | null;
  /** An Idempotency-Key matched an earlier send with the same body: nothing new was written. */
  replayed: boolean;
}

type TurnServicesForStart = { services: Pick<AppInstance['services'], 'db' | 'usage' | 'cfg'> };

/** What an Idempotency-Key's row holds for a send. */
interface StoredTurn {
  turnId: string;
  assistantMessageId: string;
  userMessageId: string | null;
}

/** The fingerprint a send is compared by: the chat and the request body, never only the key. */
export function sendFingerprint(chatId: string, body: StartTurnBody): string {
  return fingerprint({ chatId, ...body });
}

async function findIdempotent(db: DbLike, userId: string, key: string, print: string): Promise<StoredTurn | null> {
  const [row] = await db
    .select({ requestFingerprint: idempotencyKeys.requestFingerprint, responseJson: idempotencyKeys.responseJson })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key), eq(idempotencyKeys.endpoint, GENERATE_ENDPOINT)))
    .limit(1);
  if (!row) return null;
  if (row.requestFingerprint !== print) throw new ApiError('idempotency_conflict');
  return row.responseJson as StoredTurn;
}

function constraintOf(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const name = typeof current === 'object' ? (current as { constraint_name?: unknown }).constraint_name : undefined;
    if (typeof name === 'string') return name;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

/**
 * One turn per chat; then the assistant row the run fills (a new user + assistant pair, or the
 * regenerated assistant row cleared), the turn bound to it, its reservation and its key.
 */
export async function startTurn(
  request: TurnServicesForStart,
  chatId: string,
  userId: string,
  body: StartTurnBody,
  opts: StartTurnOptions,
): Promise<StartedTurn> {
  const { db, usage, cfg } = request.services;
  const print = sendFingerprint(chatId, body);
  try {
    return await db.transaction(async (tx) => {
      // Serialises every start on this chat: two sends, a send and a regenerate, two regenerates.
      await tx.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId)).for('update');

      if (opts.idempotencyKey) {
        const hit = await findIdempotent(tx, userId, opts.idempotencyKey, print);
        if (hit) return { ...hit, replayed: true };
      }
      if (await activeTurnForUpdate({ usage }, tx, chatId)) throw new ApiError('run_in_progress');

      const pair = body.retryMessageId
        ? await resetForRetry(tx, chatId, userId, body.retryMessageId, body.attachmentIds)
        : await appendMessages(tx, chatId, userId, body.prompt, body.mode, body.attachmentIds);

      const params: TurnParams = {
        mode: body.mode,
        modelAlias: body.model,
        attachmentIds: body.attachmentIds,
        codeExecution: body.codeExecution,
        ...(body.effort ? { effort: body.effort } : {}),
        ...(body.styleId ? { styleId: body.styleId } : {}),
        ...(opts.clientPlatform ? { clientPlatform: opts.clientPlatform } : {}),
        projectId: opts.projectId,
      };
      const [turn] = await tx
        .insert(turns)
        .values({
          chatId,
          userId,
          userMessageId: pair.userMessageId,
          assistantMessageId: pair.assistantMessageId,
          kind: body.retryMessageId ? 'regenerate' : 'send',
          // Started here and run by this process at once; `queued` is for an executor that
          // picks a turn up later (the Cloud Tasks seam, D-G3-02).
          state: 'running',
          requestId: opts.requestId,
          params,
          leaseOwner: opts.instanceId,
          leaseExpiresAt: dbNowPlus(cfg.TURN_LEASE_MS),
          heartbeatAt: sql`now()`,
          deadline: dbNowPlus(cfg.TURN_DEADLINE_MS),
        })
        .returning({ id: turns.id });

      await usage.reserve(userId, opts.prefs, opts.reserveTokens, {
        owner: 'turn',
        turnId: turn!.id,
        // Past the turn's own deadline by one lease (N-43 + N-73): nobody settles it after that.
        expiresAt: new Date(Date.now() + cfg.TURN_DEADLINE_MS + cfg.TURN_LEASE_MS),
        tx,
      });

      const stored: StoredTurn = { turnId: turn!.id, ...pair };
      if (opts.idempotencyKey) {
        await tx.insert(idempotencyKeys).values({
          userId,
          key: opts.idempotencyKey,
          endpoint: GENERATE_ENDPOINT,
          requestFingerprint: print,
          responseJson: stored,
          statusCode: 200,
        });
      }
      return { ...stored, replayed: false };
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The same key, sent at once for another chat: the first one's row decides.
    if (constraintOf(err) === 'uq_idempotency' && opts.idempotencyKey) {
      const hit = await findIdempotent(db, userId, opts.idempotencyKey, print);
      if (hit) return { ...hit, replayed: true };
    }
    // The chat lock makes these unreachable from this code; another writer (or an older
    // instance during a rollout) still meets the constraint, and the caller gets a 409.
    throw new ApiError('run_in_progress');
  }
}

/** Append the user turn plus an empty assistant row. */
async function appendMessages(
  tx: Transaction,
  chatId: string,
  userId: string,
  prompt: string,
  mode: string,
  attachmentIds: string[],
): Promise<{ userMessageId: string; assistantMessageId: string }> {
  let claimable = 0;
  if (attachmentIds.length > 0) {
    const incoming = await tx
      .select({ id: attachmentsTable.id, status: attachmentsTable.status, messageId: attachmentsTable.messageId })
      .from(attachmentsTable)
      .where(and(inArray(attachmentsTable.id, attachmentIds), eq(attachmentsTable.userId, userId)));
    // A file the caller does not own (or that does not exist) refuses the send: the turn would
    // otherwise run as if it had never been attached (DEFERRED Part C).
    if (incoming.length !== new Set(attachmentIds).size) throw notFound('file');
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

  // Under the chat row's lock (taken by the caller), so two starts cannot read the same max.
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

  return { userMessageId: userMessage!.id, assistantMessageId: assistant!.id };
}

/**
 * Clear a previous attempt so a retry does not append duplicate sources, events or tool calls.
 * The tool calls go too: a call is stored with `onConflictDoNothing` on (message, ordinal), so
 * the old attempt's rows would win over the new attempt's and be replayed as its history.
 *
 * Guarded (D3 A-04): the row is reset only while it is not `generating`, in the caller's
 * transaction with the turn insert, so a regenerate cannot clear an answer still being written.
 */
async function resetForRetry(
  tx: Transaction,
  chatId: string,
  userId: string,
  messageId: string,
  attachmentIds: string[],
): Promise<{ userMessageId: string | null; assistantMessageId: string }> {
  const [existing] = await tx
    .select({ id: messages.id, role: messages.role, seq: messages.seq })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.chatId, chatId)))
    .limit(1);
  if (!existing) throw notFound('message');
  if (existing.role !== 'assistant') {
    throw new ApiError('validation_error', { detail: 'Only an assistant message can be retried.' });
  }
  if (attachmentIds.length > 0) {
    const [owned] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(attachmentsTable)
      .where(and(inArray(attachmentsTable.id, attachmentIds), eq(attachmentsTable.userId, userId)));
    if ((owned?.n ?? 0) !== new Set(attachmentIds).size) throw notFound('file');
  }

  const [reset] = await tx
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
    .where(and(eq(messages.id, messageId), sql`${messages.status} <> 'generating'`))
    .returning({ id: messages.id });
  if (!reset) throw new ApiError('run_in_progress');

  await tx.delete(messageSources).where(eq(messageSources.messageId, messageId));
  await tx.delete(researchEvents).where(eq(researchEvents.messageId, messageId));
  await tx.delete(toolCallsTable).where(eq(toolCallsTable.messageId, messageId));

  // The prompt this answer answers: the user message just before it.
  const [prompt] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, 'user'), lt(messages.seq, existing.seq)))
    .orderBy(desc(messages.seq))
    .limit(1);
  return { userMessageId: prompt?.id ?? null, assistantMessageId: messageId };
}

/**
 * Ends a turn that failed outside the generation service's own settle (a failure before or
 * around the stream: no model available, a model limit, a capability gate). Same transaction,
 * same order, as every other end (ADR-0078). When the run had already sent `start`, a model call
 * may have been made, so a usage row records it with no counts (`exact: false`, zeros, no price;
 * DEFERRED scenario L). A runner that lost its lease writes nothing.
 */
export async function failTurn(
  deps: SettleDeps,
  ids: { userId: string; chatId: string; messageId: string; requestId: string; projectId: string | null },
  binding: TurnBinding,
  failure: {
    code: string;
    mode: string;
    prefs: BudgetPrefs;
    startedAt: Date;
    model: { alias: string; provider: string; providerModelId: string } | null;
  },
): Promise<void> {
  try {
    await settleTurn(deps, ids, binding, {
      message: { kind: 'failed', errorCode: failure.code, mode: failure.mode },
      usage: failure.model
        ? {
            prefs: failure.prefs,
            modelAlias: failure.model.alias,
            provider: failure.model.provider,
            providerModelId: failure.model.providerModelId,
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, exact: false },
            startedAt: failure.startedAt,
            status: 'error',
            errorCode: failure.code,
          }
        : null,
      end: failure.code === 'server_shutdown' || failure.code === 'interrupted' ? 'interrupted' : 'failed',
      finishCode: failure.code,
    });
  } catch (err) {
    if (err instanceof FencedOut) {
      log.warn({ turnId: binding.turnId }, 'failed turn not settled: the lease was taken over');
      return;
    }
    log.error({ turnId: binding.turnId, ...errorLogFields(err) }, 'failed to settle a failed turn');
  }
}
