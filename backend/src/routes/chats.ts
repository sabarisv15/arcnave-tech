/**
 * Chats, messages, and streaming generation.
 *
 * The SSE endpoint is the interesting one. Three things it has to get right:
 *
 * - **A run outlives its connection.** The run publishes to `services.runHub`; the connection
 *   that started it and any that reattach (`GET /chats/:id/stream`) are subscribers. Only
 *   `POST /chats/:id/stop` (the turn's cancel flag, seen by whichever instance runs it), a chat
 *   delete, shutdown, or the turn deadline stop it.
 * - **The assistant row exists before streaming starts**, bound to a durable turn (ADR-0078). A
 *   reload mid-stream finds a message to show, filled in as the run flushes it.
 * - **One run per chat.** A second generate on a busy chat is refused with 409 rather than
 *   interleaved, on every instance (the turns table's partial unique index).
 */
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  attachments as attachmentsTable,
  chats,
  goalEvents,
  goals,
  messages,
  messageSources,
  projects,
  researchEvents,
  toolCalls as toolCallsTable,
  turnLogs,
  idempotencyKeys,
  turns,
  type TurnRow,
} from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { AUTO_ALIAS } from '../providers/registry.js';
import type { DbLike } from '../db/client.js';
import { versionsAt, type MessageVersions } from '../services/chatVersions.js';
import { NUMBERS } from '../config/numbers.js';
import { launchTurn } from '../services/turn/launch.js';
import { precheckTurn } from '../services/turn/turnGate.js';
import { GENERATE_ENDPOINT, loadChat, sendFingerprint, startTurn, type StartTurnBody } from '../services/turn/turnStart.js';
import { latestTurnOfChat, requestCancel } from '../services/turn/turnStore.js';
import { resumeFrom, SseConnection, streamLive, streamStored, type SnapshotFrame } from './turnStream.js';
import type { AppInstance } from '../types.js';
import {
  assertVersion,
  decodeCursor,
  encodeCursor,
  idempotencyHeader,
  iso,
  paginationQuery,
  uuidParam,
} from './helpers.js';

const modeSchema = z.enum(['chat', 'search', 'research']);

const sourceSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string(),
  urlResolved: z.boolean(),
  domain: z.string(),
  type: z.string(),
  snippet: z.string(),
  passage: z.string(),
  retrievedAt: z.string().nullable(),
});

const eventSchema = z.object({
  stage: z.string(),
  label: z.string(),
  detail: z.string(),
  at: z.string().nullable(),
});

const toolContentSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('json'), data: z.unknown() }),
]);

const toolCallSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  input: z.unknown(),
  ok: z.boolean(),
  content: z.array(toolContentSchema),
  at: z.string().nullable(),
});

const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  status: z.string(),
  error: z.string(),
});

const messageSchema = z.object({
  id: z.string(),
  seq: z.number(),
  role: z.string(),
  text: z.string(),
  mode: z.string(),
  status: z.string(),
  errorCode: z.string().nullable(),
  researchStage: z.string().nullable(),
  questions: z.array(z.string()),
  feedback: z.string().nullable(),
  modelAlias: z.string().nullable(),
  effort: z.string().nullable(),
  providerModelId: z.string().nullable(),
  finishReason: z.string().nullable(),
  artifactId: z.string().nullable(),
  searchEntryPoint: z.string().nullable(),
  /** The model's thought summary, when it gave one. */
  thinking: z.string().nullable(),
  /** The answer in order: thinking, text and tool steps. Null for older answers. */
  segments: z
    .array(
      z.union([
        z.object({ type: z.literal('thinking'), text: z.string() }),
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('tools'), toolCallIds: z.array(z.string()) }),
        z.object({ type: z.literal('ui'), blockIds: z.array(z.string()) }),
      ]),
    )
    .nullable(),
  createdAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  sources: z.array(sourceSchema),
  events: z.array(eventSchema),
  toolCalls: z.array(toolCallSchema),
  attachments: z.array(attachmentSchema),
  /** Other versions of this prompt, made by editing it (ADR-0038); null when there are none. */
  versions: z
    .object({
      index: z.number(),
      versions: z.array(z.object({ chatId: z.string(), createdAt: z.string() })),
    })
    .nullable(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      exact: z.boolean(),
      costUsd: z.number().nullable(),
      costInr: z.number().nullable(),
    })
    .nullable(),
});

type MessageDto = z.infer<typeof messageSchema>;

const goalCheckpointSchema = z.object({
  id: z.string(),
  note: z.string(),
  at: z.string().nullable(),
});

const goalSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  originMessageId: z.string().nullable(),
  description: z.string(),
  status: z.string(),
  tokenBudget: z.number().nullable(),
  spentTokens: z.number(),
  remainingBudget: z.number().nullable(),
  blockedReason: z.string().nullable(),
  consecutiveFailureCount: z.number(),
  lastFailedTool: z.string().nullable(),
  lastFailureFingerprint: z.string().nullable(),
  createdAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  checkpoints: z.array(goalCheckpointSchema),
});

const chatSchema = z.object({
  id: z.string(),
  /** The conversation this chat is a version of; equal to `id` for one never edited. */
  familyId: z.string(),
  title: z.string(),
  projectId: z.string().nullable(),
  pinned: z.boolean(),
  version: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export async function chatRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  /* ---------------------------------------------------------------- list */

  typed.get(
    '/chats',
    {
      schema: {
        tags: ['chats'],
        summary: 'List chats, newest first, pinned first',
        querystring: paginationQuery.extend({
          projectId: z.string().uuid().optional(),
          q: z.string().max(200).optional(),
        }),
        response: {
          200: z.object({ items: z.array(chatSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { limit, cursor, projectId, q } = request.query;
      const decoded = decodeCursor(cursor);

      const filters = [eq(chats.userId, user.id), isNull(chats.deletedAt)];
      if (projectId) filters.push(eq(chats.projectId, projectId));
      if (q?.trim()) filters.push(sql`${chats.title} ilike ${'%' + q.trim() + '%'}`);
      // One row per conversation: of its versions, the one used last (ADR-0038).
      filters.push(sql`not exists (
        select 1 from chats newer
        where newer.user_id = ${chats.userId}
          and newer.deleted_at is null
          and coalesce(newer.root_chat_id, newer.id) = coalesce(${chats.rootChatId}, ${chats.id})
          and (newer.updated_at > ${chats.updatedAt}
               or (newer.updated_at = ${chats.updatedAt} and newer.id > ${chats.id})))`);
      if (decoded) {
        // Keyset pagination: strictly older, or same timestamp with a smaller id.
        filters.push(
          or(
            lt(chats.updatedAt, new Date(decoded.at)),
            and(eq(chats.updatedAt, new Date(decoded.at)), lt(chats.id, decoded.id)),
          )!,
        );
      }

      const rows = await db
        .select()
        .from(chats)
        .where(and(...filters))
        .orderBy(desc(chats.updatedAt), desc(chats.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toChatDto),
        nextCursor:
          rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null,
      };
    },
  );

  /* ---------------------------------------------------------------- create */

  typed.post(
    '/chats',
    {
      schema: {
        tags: ['chats'],
        summary: 'Create an empty chat',
        body: z.object({
          title: z.string().trim().min(1).max(200).default('New conversation'),
          projectId: z.string().uuid().nullable().default(null),
        }),
        response: { 201: chatSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;
      if (request.body.projectId) await assertProject(request, request.body.projectId);
      const [created] = await db
        .insert(chats)
        .values({
          userId: user.id,
          title: request.body.title,
          projectId: request.body.projectId,
        })
        .returning();
      return reply.status(201).send(toChatDto(created!));
    },
  );

  /* ---------------------------------------------------------------- read */

  typed.get(
    '/chats/:id',
    {
      schema: {
        tags: ['chats'],
        summary: 'A chat with its full message history and active goal state',
        params: uuidParam,
        response: {
          200: chatSchema.extend({
            messages: z.array(messageSchema),
            activeGoal: goalSchema.nullable(),
          }),
        },
      },
    },
    async (request) => {
      const { db } = request.services;
      const chat = await loadChat(request, request.params.id);

      const [activeGoalRow] = await db
        .select()
        .from(goals)
        .where(and(eq(goals.chatId, chat.id), eq(goals.status, 'active')))
        .limit(1);

      let activeGoal = null;
      if (activeGoalRow) {
        const events = await db
          .select()
          .from(goalEvents)
          .where(and(eq(goalEvents.goalId, activeGoalRow.id), eq(goalEvents.type, 'checkpoint')))
          .orderBy(desc(goalEvents.createdAt));

        activeGoal = {
          id: activeGoalRow.id,
          chatId: activeGoalRow.chatId,
          originMessageId: activeGoalRow.originMessageId,
          description: activeGoalRow.description,
          status: activeGoalRow.status,
          tokenBudget: activeGoalRow.tokenBudget,
          spentTokens: activeGoalRow.spentTokens,
          remainingBudget:
            activeGoalRow.tokenBudget != null
              ? Math.max(0, activeGoalRow.tokenBudget - activeGoalRow.spentTokens)
              : null,
          blockedReason: activeGoalRow.blockedReason,
          consecutiveFailureCount: activeGoalRow.consecutiveFailureCount,
          lastFailedTool: activeGoalRow.lastFailedTool,
          lastFailureFingerprint: activeGoalRow.lastFailureFingerprint,
          createdAt: activeGoalRow.createdAt ? activeGoalRow.createdAt.toISOString() : null,
          completedAt: activeGoalRow.completedAt ? activeGoalRow.completedAt.toISOString() : null,
          checkpoints: events.map((e) => ({
            id: e.id,
            note: (e.data as { note?: string })?.note ?? '',
            at: e.createdAt ? e.createdAt.toISOString() : null,
          })),
        };
      }

      const transcript = await loadMessages(request, chat.id);
      const versions = await loadVersions(
        request,
        chat,
        transcript.filter((m) => m.role === 'user').map((m) => m.seq),
      );
      return {
        ...toChatDto(chat),
        messages: transcript.map((m) => ({ ...m, versions: versions.get(m.seq) ?? null })),
        activeGoal,
      };
    },
  );

  /* ---------------------------------------------------------------- update */

  typed.patch(
    '/chats/:id',
    {
      schema: {
        tags: ['chats'],
        summary: 'Rename, pin, or move a chat between projects',
        params: uuidParam,
        body: z.object({
          title: z.string().trim().min(1).max(200).optional(),
          pinned: z.boolean().optional(),
          // `null` moves the chat out of its project; omitted leaves it where it is.
          projectId: z.string().uuid().nullable().optional(),
          version: z.number().int().optional(),
        }),
        response: { 200: chatSchema },
      },
    },
    async (request) => {
      const { db } = request.services;
      const chat = await loadChat(request, request.params.id);
      assertVersion(request.body.version, chat.version, 'conversation');

      if (request.body.projectId) await assertProject(request, request.body.projectId);

      const patch: Record<string, unknown> = { version: chat.version + 1, updatedAt: new Date() };
      if (request.body.title !== undefined) patch['title'] = request.body.title;
      if (request.body.pinned !== undefined) patch['pinned'] = request.body.pinned;
      if (request.body.projectId !== undefined) patch['projectId'] = request.body.projectId;

      const [updated] = await db
        .update(chats)
        .set(patch)
        .where(eq(chats.id, chat.id))
        .returning();
      // Versions are one conversation: its name, pin and project are shared.
      const shared: Record<string, unknown> = {};
      for (const key of ['title', 'pinned', 'projectId'] as const) {
        if (key in patch) shared[key] = patch[key];
      }
      if (Object.keys(shared).length > 0) {
        const family = chat.rootChatId ?? chat.id;
        await db
          .update(chats)
          .set(shared)
          .where(
            and(
              eq(chats.userId, chat.userId),
              sql`${chats.id} <> ${chat.id}`,
              or(eq(chats.id, family), eq(chats.rootChatId, family)),
            ),
          );
      }
      return toChatDto(updated!);
    },
  );

  /* ---------------------------------------------------------------- delete */

  typed.delete(
    '/chats/:id',
    {
      schema: {
        tags: ['chats'],
        summary: 'Soft-delete a chat with all its versions',
        params: uuidParam,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { db, runHub } = request.services;
      const chat = await loadChat(request, request.params.id);
      // A conversation is deleted with all its versions (ADR-0038), as one row in the list is
      // one conversation.
      const familyId = chat.rootChatId ?? chat.id;
      const family = await db
        .select({ id: chats.id })
        .from(chats)
        .where(
          and(
            eq(chats.userId, chat.userId),
            isNull(chats.deletedAt),
            or(eq(chats.id, familyId), eq(chats.rootChatId, familyId)),
          ),
        );
      // Stop any run first, so it does not keep writing to a chat the user just deleted: the flag
      // reaches a run on any instance (ADR-0078); the local abort ends one here at once.
      await requestCancel(db, family.map((m) => m.id));
      for (const member of family) runHub.active(member.id)?.controller.abort();
      await db
        .update(chats)
        .set({ deletedAt: new Date() })
        .where(inArray(chats.id, family.map((m) => m.id)));
      return reply.status(204).send(null);
    },
  );

  /* ---------------------------------------------------------------- branch */

  typed.post(
    '/chats/:id/branch',
    {
      schema: {
        tags: ['chats'],
        summary: 'Copy a chat: up to a message, or as a new version of an edited prompt',
        description:
          'With `throughMessageId`, a separate chat holding the history through that message. ' +
          'With `editSeq`, a new version of the same conversation (ADR-0038): the history before ' +
          'the prompt at that seq, which the next generate replaces.',
        params: uuidParam,
        body: z
          .object({
            throughMessageId: z.string().uuid().optional(),
            editSeq: z.number().int().min(0).optional(),
          })
          .refine((b) => b.throughMessageId === undefined || b.editSeq === undefined, {
            message: 'Give throughMessageId or editSeq, not both.',
          }),
        response: { 201: chatSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;
      const chat = await loadChat(request, request.params.id);
      const { throughMessageId, editSeq } = request.body;

      const history = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chat.id))
        .orderBy(asc(messages.seq));

      let kept = history;
      if (throughMessageId) {
        const index = history.findIndex((m) => m.id === throughMessageId);
        if (index === -1) throw notFound('message');
        kept = history.slice(0, index + 1);
      } else if (editSeq !== undefined) {
        if (!history.some((m) => m.seq === editSeq && m.role === 'user')) throw notFound('message');
        kept = history.filter((m) => m.seq < editSeq);
      }

      const branch = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(chats)
          .values(
            editSeq !== undefined
              ? {
                  userId: user.id,
                  title: chat.title,
                  projectId: chat.projectId,
                  pinned: chat.pinned,
                  parentChatId: chat.id,
                  rootChatId: chat.rootChatId ?? chat.id,
                  forkSeq: editSeq,
                }
              : {
                  userId: user.id,
                  title: `${chat.title} · branch`.slice(0, 200),
                  projectId: chat.projectId,
                },
          )
          .returning();
        await copyMessages(tx, kept, created!.id, user.id);
        return created!;
      });
      return reply.status(201).send(toChatDto(branch));
    },
  );

  /* ---------------------------------------------------------------- generate */

  typed.post(
    '/chats/:id/generate',
    {
      schema: {
        tags: ['chats'],
        summary: 'Stream an assistant reply over SSE',
        description:
          'Returns text/event-stream. Frames: ack (first: the turn and message ids), start, research, ' +
          'delta, sources, tool_use, tool_result, done, error; a named ping every 15 s. Each run frame ' +
          'carries an SSE `id`. Disconnecting does not cancel the run: reattach with GET ' +
          '/chats/:id/stream, cancel with POST /stop. Refused before anything is saved: 402 ' +
          '`budget_exceeded`, 400 `model_unavailable` for a named model this deployment cannot serve, ' +
          '409 `run_in_progress`, 503 `server_shutdown`. An `Idempotency-Key` already used with the ' +
          'same body reattaches to that turn; with another body, 409 `idempotency_conflict`.',
        params: uuidParam,
        headers: idempotencyHeader.passthrough(),
        body: z.object({
          prompt: z.string().min(1).max(100_000),
          mode: modeSchema.default('chat'),
          model: z.string().max(64).default(AUTO_ALIAS),
          attachmentIds: z.array(z.string().uuid()).max(NUMBERS.FILES_PER_MESSAGE.value /* N-10 */).default([]),
          /** Re-run an existing assistant message instead of appending a new pair. */
          retryMessageId: z.string().uuid().optional(),
          /** Gemini's code-execution sandbox. See ADR-0004; unavailable on other providers. */
          codeExecution: z.boolean().default(false),
          effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
          /** Optional response style override (preset key or custom style UUID). */
          styleId: z.string().max(64).optional(),
        }),
      },
      config: {
        rateLimit: {
          max: app.services.cfg.RATE_LIMIT_GENERATE_PER_MINUTE,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { services } = request;
      // SIGTERM: runs here are being stopped and saved; a new one would be cut off (ADR-0078).
      if (services.lifecycle.draining) throw new ApiError('server_shutdown');
      const chat = await loadChat(request, request.params.id);
      const key = request.headers['idempotency-key'];
      const body = request.body;

      // A send retried with its key reattaches before any other check: it was accepted once.
      if (key) {
        const replay = await services.db.transaction((tx) => peekIdempotent(tx, user.id, key, chat.id, body));
        if (replay) return reattach(request, reply, chat.id, replay.turnId);
      }

      // --- refused before anything is written (Stage 3 1.6) -------------------------
      const { prefs, reserveTokens } = await precheckTurn(services, user.id, body.model);

      // --- one turn per chat; the rows, the turn, its reservation and key (ADR-0078) ---
      const started = await startTurn(request, chat.id, user.id, body, {
        requestId: request.id,
        projectId: chat.projectId,
        clientPlatform: clientPlatform(request.headers),
        prefs,
        reserveTokens,
        instanceId: services.instanceId,
        idempotencyKey: key,
      });
      if (started.replayed) return reattach(request, reply, chat.id, started.turnId);

      // --- the run lives on its own; this connection is only its first subscriber ------
      // Closing the socket does not stop the run (a sleeping tab or a dropped mobile network
      // would otherwise throw away minutes of tool work). Stop is explicit: POST /stop.
      const run = launchTurn(services, started, { userId: user.id, chatId: chat.id, requestId: request.id, prefs });
      const conn = new SseConnection(request, reply, { userId: user.id, chatId: chat.id });
      await streamLive(conn, run, -1, () => snapshotOfTurnId(request, started.turnId));
      return reply;
    },
  );

  /* ---------------------------------------------------------------- resume */

  typed.get(
    '/chats/:id/stream',
    {
      schema: {
        tags: ['chats'],
        summary: "Reattach to this chat's running (or just finished) reply over SSE",
        description:
          'Replays the run\'s frames after the client\'s position (`Last-Event-ID`, which wins, or ' +
          '`after`: the SSE `id` of the last frame received; omit for all), then streams live frames ' +
          'until the run ends. When this instance does not hold the run (another instance runs it, ' +
          'or it ended), or no longer holds the frames asked for, a `snapshot` frame carries the ' +
          'stored reply, repeated as it changes until the turn ends. 404 `no_active_run` when the ' +
          'chat has never had a turn.',
        params: uuidParam,
        querystring: z.object({ after: z.coerce.number().int().min(-1).default(-1) }),
      },
    },
    async (request, reply) => {
      const chat = await loadChat(request, request.params.id);
      const turn = await latestTurnOfChat(request.services.db, chat.id);
      if (!turn) throw new ApiError('no_active_run');
      return reattach(request, reply, chat.id, turn.id, request.query.after);
    },
  );

  /* ---------------------------------------------------------------- stop */

  typed.post(
    '/chats/:id/stop',
    {
      schema: {
        tags: ['chats'],
        summary: 'Cancel the run in progress on this chat',
        description: 'Sets the turn\'s cancel flag, which the instance running it reads within 2 s; a run on this instance stops at once.',
        params: uuidParam,
        response: { 200: z.object({ stopped: z.boolean() }) },
      },
    },
    async (request) => {
      const { db, runHub } = request.services;
      const chat = await loadChat(request, request.params.id);
      const flagged = await requestCancel(db, [chat.id]);
      const local = runHub.active(chat.id);
      local?.controller.abort();
      return { stopped: flagged.length > 0 || Boolean(local) };
    },
  );

  /* ---------------------------------------------------------------- feedback */

  typed.post(
    '/chats/:id/messages/:messageId/feedback',
    {
      schema: {
        tags: ['chats'],
        summary: 'Rate an assistant reply',
        params: z.object({ id: z.string().uuid(), messageId: z.string().uuid() }),
        body: z.object({ feedback: z.enum(['up', 'down']).nullable() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { db } = request.services;
      const chat = await loadChat(request, request.params.id);
      const result = await db
        .update(messages)
        .set({ feedback: request.body.feedback })
        .where(and(eq(messages.id, request.params.messageId), eq(messages.chatId, chat.id)))
        .returning({ id: messages.id });
      if (result.length === 0) throw notFound('message');
      return reply.status(204).send(null);
    },
  );

  /* ---------------------------------------------------------------- turn log */

  typed.get(
    '/chats/:id/messages/:messageId/log',
    {
      schema: {
        tags: ['chats'],
        summary: "A reply's turn log, as a text file (ADR-0050)",
        description:
          'What the reply sent and did: the model, the attachments as they went (PDF page images included), ' +
          'the tools and skills offered, and every tool call with its input and result.',
        params: z.object({ id: z.string().uuid(), messageId: z.string().uuid() }),
        response: { 200: z.string() },
      },
    },
    async (request, reply) => {
      const { db } = request.services;
      const chat = await loadChat(request, request.params.id);
      const [row] = await db
        .select({ markdown: turnLogs.markdown })
        .from(turnLogs)
        .innerJoin(messages, eq(turnLogs.messageId, messages.id))
        .where(and(eq(turnLogs.messageId, request.params.messageId), eq(messages.chatId, chat.id)))
        .limit(1);
      if (!row) throw notFound('turn log');
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="turn-log-${request.params.messageId}.txt"`)
        .send(row.markdown);
    },
  );
}

/* -------------------------------------------------------------------------- helpers */

type ChatRow = typeof chats.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

/**
 * Streams a turn to this connection from wherever it is: the hub when this instance holds the run
 * (and it is this turn's), the stored row otherwise (`routes/turnStream.ts`).
 */
async function reattach(
  request: FastifyRequest,
  reply: FastifyReply,
  chatId: string,
  turnId: string,
  after?: number,
): Promise<FastifyReply> {
  const user = currentUser(request);
  const from = resumeFrom(request, after);
  const run = request.services.runHub.latest(chatId);
  const conn = new SseConnection(request, reply, { userId: user.id, chatId });
  if (run && run.userId === user.id && run.turnId === turnId) {
    await streamLive(conn, run, from, () => snapshotOfTurnId(request, turnId));
  } else {
    await streamStored(conn, request, turnId, (turn) => snapshotOfTurn(request, turn));
  }
  return reply;
}

/** The stored assistant row of a turn, as a `snapshot` frame (`id:` = the index it covers). */
async function snapshotOfTurn(request: FastifyRequest, turn: TurnRow): Promise<SnapshotFrame> {
  const [message] = await loadMessages(request, turn.chatId, turn.assistantMessageId);
  return { type: 'snapshot', turnId: turn.id, state: turn.state, seq: turn.lastSeq, message: message ?? null };
}

async function snapshotOfTurnId(request: FastifyRequest, turnId: string): Promise<SnapshotFrame | null> {
  const [turn] = await request.services.db.select().from(turns).where(eq(turns.id, turnId)).limit(1);
  return turn ? snapshotOfTurn(request, turn) : null;
}

/** The turn a key names when it was used with this chat and body; 409 for another body. */
async function peekIdempotent(
  tx: DbLike,
  userId: string,
  key: string,
  chatId: string,
  body: StartTurnBody,
): Promise<{ turnId: string } | null> {
  const [row] = await tx
    .select({ requestFingerprint: idempotencyKeys.requestFingerprint, responseJson: idempotencyKeys.responseJson })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key), eq(idempotencyKeys.endpoint, GENERATE_ENDPOINT)))
    .limit(1);
  if (!row) return null;
  if (row.requestFingerprint !== sendFingerprint(chatId, body)) throw new ApiError('idempotency_conflict');
  return row.responseJson as { turnId: string };
}

/**
 * The device a request came from: Chromium's mobile client hint, else the user agent. A visual
 * drawn for a phone is sized for a ~380 px frame (ADR-0049).
 */
export function clientPlatform(headers: FastifyRequest['headers']): 'mobile' | 'desktop' {
  const hint = headers['sec-ch-ua-mobile'];
  if (hint === '?1') return 'mobile';
  if (hint === '?0') return 'desktop';
  return /Mobi|Android|iPhone|iPad/i.test(String(headers['user-agent'] ?? '')) ? 'mobile' : 'desktop';
}

function toChatDto(row: ChatRow): {
  id: string;
  familyId: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
} {
  return {
    id: row.id,
    familyId: row.rootChatId ?? row.id,
    title: row.title,
    projectId: row.projectId,
    pinned: row.pinned,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function assertProject(
  request: { services: AppInstance['services']; user: { id: string } | null },
  projectId: string,
): Promise<void> {
  const user = request.user;
  if (!user) throw new ApiError('unauthorized');
  const [row] = await request.services.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.userId, user.id), isNull(projects.deletedAt)),
    )
    .limit(1);
  if (!row) throw notFound('project');
}

async function loadMessages(
  request: { services: AppInstance['services'] },
  chatId: string,
  /** One message only (a `snapshot` frame). */
  messageId?: string,
): Promise<MessageDto[]> {
  const { db } = request.services;
  const rows = await db
    .select()
    .from(messages)
    .where(messageId ? and(eq(messages.chatId, chatId), eq(messages.id, messageId)) : eq(messages.chatId, chatId))
    .orderBy(asc(messages.seq));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  // Four batched queries rather than N+1 per message.
  const [sources, events, files, calls] = await Promise.all([
    db.select().from(messageSources).where(inArray(messageSources.messageId, ids)),
    db.select().from(researchEvents).where(inArray(researchEvents.messageId, ids)),
    db.select().from(attachmentsTable).where(inArray(attachmentsTable.messageId, ids)),
    db.select().from(toolCallsTable).where(inArray(toolCallsTable.messageId, ids)),
  ]);

  const group = <T extends { messageId: string | null }>(items: T[]): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      if (!item.messageId) continue;
      const list = map.get(item.messageId);
      if (list) list.push(item);
      else map.set(item.messageId, [item]);
    }
    return map;
  };

  const sourcesBy = group(sources);
  const eventsBy = group(events);
  const filesBy = group(files);
  const callsBy = group(calls);

  return rows.map((m) => ({
    id: m.id,
    seq: m.seq,
    role: m.role,
    text: m.text,
    mode: m.mode,
    status: m.status,
    errorCode: m.errorCode,
    researchStage: m.researchStage,
    questions: m.questions,
    feedback: m.feedback,
    modelAlias: m.modelAlias,
    effort: m.effort ?? null,
    providerModelId: m.providerModelId,
    finishReason: m.finishReason,
    artifactId: m.artifactId,
    searchEntryPoint: m.searchEntryPoint,
    thinking: m.thinking,
    segments: m.segments ?? null,
    createdAt: iso(m.createdAt),
    completedAt: iso(m.completedAt),
    sources: (sourcesBy.get(m.id) ?? [])
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({
        id: s.ordinal,
        title: s.title,
        url: s.url,
        urlResolved: s.urlResolved,
        domain: s.domain,
        type: s.sourceType,
        snippet: s.snippet,
        passage: s.passage,
        retrievedAt: iso(s.retrievedAt),
      })),
    events: (eventsBy.get(m.id) ?? [])
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((e) => ({ stage: e.stage, label: e.label, detail: e.detail, at: iso(e.at) })),
    toolCalls: (callsBy.get(m.id) ?? [])
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((c) => ({
        toolCallId: c.toolCallId,
        name: c.name,
        input: c.input,
        ok: c.ok,
        content: c.content as z.infer<typeof toolContentSchema>[],
        at: iso(c.at),
      })),
    attachments: (filesBy.get(m.id) ?? []).map((f) => ({
      id: f.id,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      status: f.status,
      error: f.error,
    })),
    // Usage is attached by the usage route when asked for; the transcript stays lean.
    usage: null,
    versions: null,
  }));
}

/** The versions of each prompt at `seqs`, from the chats in `chat`'s family (ADR-0038). */
async function loadVersions(
  request: { services: AppInstance['services'] },
  chat: ChatRow,
  seqs: number[],
): Promise<Map<number, MessageVersions>> {
  const { db } = request.services;
  const familyId = chat.rootChatId ?? chat.id;
  const family = await db
    .select({
      id: chats.id,
      parentChatId: chats.parentChatId,
      forkSeq: chats.forkSeq,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
      deletedAt: chats.deletedAt,
      // Spelled out: inside a select list drizzle writes columns unqualified, and a bare "id" in
      // the subquery would mean the message's.
      lastSeq: sql<number>`coalesce((select max(m.seq) from messages m where m.chat_id = "chats"."id"), -1)`,
    })
    .from(chats)
    .where(and(eq(chats.userId, chat.userId), or(eq(chats.id, familyId), eq(chats.rootChatId, familyId))));
  if (family.length < 2) return new Map();
  const current = family.find((c) => c.id === chat.id);
  if (!current) return new Map();
  return versionsAt(current, family.map((c) => ({ ...c, lastSeq: Number(c.lastSeq) })), seqs);
}

/**
 * Copies messages into another chat with everything shown with them: sources, progress, tool
 * calls and attachments. An attachment row is copied, not its bytes; retention deletes the bytes
 * only when no row outside the purged chat still names them.
 */
async function copyMessages(tx: DbLike, rows: MessageRow[], chatId: string, userId: string): Promise<void> {
  if (rows.length === 0) return;
  const inserted = await tx
    .insert(messages)
    .values(
      rows.map((m) => ({
        chatId,
        userId,
        seq: m.seq,
        role: m.role,
        text: m.text,
        mode: m.mode,
        // An in-flight message copies as 'stopped': the copy has no run behind it.
        status: m.status === 'generating' || m.status === 'submitting' ? 'stopped' : m.status,
        errorCode: m.errorCode,
        researchStage: m.researchStage,
        questions: m.questions,
        feedback: m.feedback,
        modelAlias: m.modelAlias,
        effort: m.effort,
        provider: m.provider,
        providerModelId: m.providerModelId,
        finishReason: m.finishReason,
        artifactId: m.artifactId,
        searchEntryPoint: m.searchEntryPoint,
        thinking: m.thinking,
        segments: m.segments,
        createdAt: m.createdAt,
        completedAt: m.completedAt,
      })),
    )
    .returning({ id: messages.id, seq: messages.seq });
  const idFor = new Map<string, string>();
  const bySeq = new Map(inserted.map((r) => [r.seq, r.id]));
  for (const m of rows) idFor.set(m.id, bySeq.get(m.seq)!);
  const ids = rows.map((m) => m.id);

  const [sources, events, calls, files] = await Promise.all([
    tx.select().from(messageSources).where(inArray(messageSources.messageId, ids)),
    tx.select().from(researchEvents).where(inArray(researchEvents.messageId, ids)),
    tx.select().from(toolCallsTable).where(inArray(toolCallsTable.messageId, ids)),
    tx.select().from(attachmentsTable).where(inArray(attachmentsTable.messageId, ids)),
  ]);
  const fresh = <T extends { id: string; messageId: string | null }>(r: T) => {
    const { id: _id, ...rest } = r;
    return { ...rest, messageId: idFor.get(r.messageId!)! };
  };
  if (sources.length) await tx.insert(messageSources).values(sources.map(fresh));
  if (events.length) await tx.insert(researchEvents).values(events.map(fresh));
  if (calls.length) await tx.insert(toolCallsTable).values(calls.map(fresh));
  if (files.length) await tx.insert(attachmentsTable).values(files.map(fresh));
}
