/**
 * Chats, messages, and streaming generation.
 *
 * The SSE endpoint is the interesting one. Three things it has to get right:
 *
 * - **A run outlives its connection.** The run publishes to `services.runHub`; the connection
 *   that started it and any that reattach (`GET /chats/:id/stream`) are subscribers. Only
 *   `POST /chats/:id/stop` (via `services.activeRuns`), shutdown, or the turn deadline abort it.
 * - **The assistant row exists before streaming starts.** A reload mid-stream must find a
 *   message to show, not a gap; the row is created first and filled in as events arrive.
 * - **One run per chat.** A second generate on a busy chat is refused rather than interleaved.
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
} from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import { AUTO_ALIAS } from '../providers/registry.js';
import type { AttachmentRef } from '../providers/types.js';
import { toAttachmentRef } from '../services/attachments/attachmentRef.js';
import { FILE_LIMITS } from '../services/attachments/processUpload.js';
import type { Run } from '../services/runHub.js';
import type { AppInstance } from '../types.js';
import {
  assertVersion,
  decodeCursor,
  encodeCursor,
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
      ]),
    )
    .nullable(),
  createdAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  sources: z.array(sourceSchema),
  events: z.array(eventSchema),
  toolCalls: z.array(toolCallSchema),
  attachments: z.array(attachmentSchema),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      exact: z.boolean(),
      costUsd: z.number().nullable(),
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

      return {
        ...toChatDto(chat),
        messages: await loadMessages(request, chat.id),
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
      return toChatDto(updated!);
    },
  );

  /* ---------------------------------------------------------------- delete */

  typed.delete(
    '/chats/:id',
    {
      schema: {
        tags: ['chats'],
        summary: 'Soft-delete a chat',
        params: uuidParam,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { db, activeRuns } = request.services;
      const chat = await loadChat(request, request.params.id);
      // Stop any run first, so it does not keep writing to a chat the user just deleted.
      activeRuns.get(chat.id)?.abort();
      await db.update(chats).set({ deletedAt: new Date() }).where(eq(chats.id, chat.id));
      return reply.status(204).send(null);
    },
  );

  /* ---------------------------------------------------------------- branch */

  typed.post(
    '/chats/:id/branch',
    {
      schema: {
        tags: ['chats'],
        summary: 'Copy a chat, optionally truncated after a given message',
        params: uuidParam,
        body: z.object({ throughMessageId: z.string().uuid().optional() }),
        response: { 201: chatSchema },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;
      const chat = await loadChat(request, request.params.id);

      const history = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chat.id))
        .orderBy(asc(messages.seq));

      let kept = history;
      if (request.body.throughMessageId) {
        const index = history.findIndex((m) => m.id === request.body.throughMessageId);
        if (index === -1) throw notFound('message');
        kept = history.slice(0, index + 1);
      }

      const [branch] = await db
        .insert(chats)
        .values({
          userId: user.id,
          title: `${chat.title} · branch`.slice(0, 200),
          projectId: chat.projectId,
        })
        .returning();

      if (kept.length > 0) {
        await db.insert(messages).values(
          kept.map((m, index) => ({
            chatId: branch!.id,
            userId: user.id,
            seq: index,
            role: m.role,
            text: m.text,
            mode: m.mode,
            // An in-flight message copies as 'stopped': the branch has no run behind it.
            status: m.status === 'generating' || m.status === 'submitting' ? 'stopped' : m.status,
            questions: m.questions,
            modelAlias: m.modelAlias,
            effort: m.effort,
            provider: m.provider,
            providerModelId: m.providerModelId,
            finishReason: m.finishReason,
            completedAt: m.completedAt,
          })),
        );
      }
      return reply.status(201).send(toChatDto(branch!));
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
          'Returns text/event-stream. Frames: start, research, delta, sources, tool_use, ' +
          'tool_result, done, error. Each frame carries an SSE `id`. Disconnecting does not ' +
          'cancel the run: reattach with GET /chats/:id/stream, cancel with POST /stop.',
        params: uuidParam,
        body: z.object({
          prompt: z.string().min(1).max(100_000),
          mode: modeSchema.default('chat'),
          model: z.string().max(64).default(AUTO_ALIAS),
          attachmentIds: z.array(z.string().uuid()).max(10).default([]),
          /** Re-run an existing assistant message instead of appending a new pair. */
          retryMessageId: z.string().uuid().optional(),
          /** Gemini's code-execution sandbox. See ADR-0004; unavailable on other providers. */
          codeExecution: z.boolean().default(false),
          effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
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
      const { db, generation, activeRuns, runHub } = request.services;
      const chat = await loadChat(request, request.params.id);

      if (activeRuns.has(chat.id)) throw new ApiError('run_in_progress');

      const { prompt, mode, model, attachmentIds, retryMessageId, codeExecution, effort } =
        request.body;

      // --- create or reuse the assistant row ----------------------------
      const assistantMessageId = retryMessageId
        ? await resetForRetry(request, chat.id, retryMessageId)
        : await appendTurn(request, chat.id, user.id, prompt, mode, attachmentIds);

      // --- the run lives on its own; this connection is only its first subscriber ------
      // Closing the socket does not stop the run (a sleeping tab or a dropped mobile network
      // would otherwise throw away minutes of tool work). Stop is explicit: POST /stop.
      const controller = new AbortController();
      activeRuns.set(chat.id, controller);
      const run = runHub.start(chat.id, user.id, assistantMessageId, controller);

      void (async () => {
        try {
          // --- gather attachments: metadata + storage references for native and text paths ---
          let attachmentManifest = '';
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
                  eq(attachmentsTable.userId, user.id),
                ),
              );

            attachmentManifest = rows
              .map(
                (r) =>
                  `- fileId: "${r.id}" | filename: "${r.filename}" | type: ${r.mimeType} | size: ${r.sizeBytes} bytes`,
              )
              .join('\n');

            // Pass metadata + storage references; bytes are fetched on-demand by the provider adapter
            turnAttachments = rows.map(toAttachmentRef);
          }
          for await (const event of generation.run({
            userId: user.id,
            requestId: request.id,
            chatId: chat.id,
            messageId: assistantMessageId,
            prompt,
            mode,
            modelAlias: model,
            projectId: chat.projectId,
            hasAttachments: attachmentIds.length > 0,
            attachmentManifest,
            attachments: turnAttachments,
            codeExecution,
            effort,
            signal: controller.signal,
          })) {
            run.publish(event);
          }
        } catch (err) {
          // The response is already committed as 200/event-stream, so an error cannot become a
          // status code here. It is delivered as a typed frame the client already handles.
          const body =
            err instanceof ApiError
              ? { code: err.code, title: err.title, detail: err.detail }
              : { code: 'internal_error', title: 'Something went wrong', detail: 'The response could not finish.' };
          if (!(err instanceof ApiError)) {
            request.log.error({ err }, 'generation failed');
          }

          // Failures raised before the stream opens (no model available, budget exhausted)
          // never reach the generation service's own persistence, so the assistant row would
          // stay 'generating' forever and show as a spinner after a reload.
          await db
            .update(messages)
            .set({
              status: 'error',
              errorCode: body.code,
              researchStage: mode === 'chat' ? null : 'error',
              completedAt: new Date(),
            })
            .where(and(eq(messages.id, assistantMessageId), eq(messages.status, 'generating')))
            .catch((dbErr: unknown) => request.log.error({ err: dbErr }, 'failed to mark run as errored'));

          run.publish({ type: 'error', ...body });
        } finally {
          if (activeRuns.get(chat.id) === controller) activeRuns.delete(chat.id);
          runHub.finish(run);
        }
      })();

      await streamRun(request, reply, run, -1);
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
          'Replays the run\'s frames after `after` (the SSE `id` of the last frame received; ' +
          'omit for all), then streams live frames until the run ends. 404 `no_active_run` ' +
          'when this instance holds no run for the chat: read the chat for the persisted reply.',
        params: uuidParam,
        querystring: z.object({ after: z.coerce.number().int().min(-1).default(-1) }),
      },
    },
    async (request, reply) => {
      const { runHub } = request.services;
      const chat = await loadChat(request, request.params.id);
      const run = runHub.latest(chat.id);
      if (!run || run.userId !== currentUser(request).id) throw new ApiError('no_active_run');
      if (!(await streamRun(request, reply, run, request.query.after))) {
        throw new ApiError('no_active_run');
      }
      return reply;
    },
  );

  /* ---------------------------------------------------------------- stop */

  typed.post(
    '/chats/:id/stop',
    {
      schema: {
        tags: ['chats'],
        summary: 'Cancel the run in progress on this chat',
        params: uuidParam,
        response: { 200: z.object({ stopped: z.boolean() }) },
      },
    },
    async (request) => {
      const { activeRuns } = request.services;
      const chat = await loadChat(request, request.params.id);
      const controller = activeRuns.get(chat.id);
      controller?.abort();
      return { stopped: Boolean(controller) };
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
}

/* -------------------------------------------------------------------------- helpers */

type ChatRow = typeof chats.$inferSelect;

/**
 * Writes one run's frames to this connection: the buffered ones after `after`, then live ones
 * until the run ends or this client goes away. Leaving never stops the run. Resolves false,
 * before writing anything, when the frames after `after` are no longer buffered.
 */
async function streamRun(
  request: FastifyRequest,
  reply: FastifyReply,
  run: Run,
  after: number,
): Promise<boolean> {
  if (!run.canReplayFrom(after)) return false;
  const { cfg } = request.services;
  const origin = request.headers.origin;
  const corsHeaders: Record<string, string> =
    origin && cfg.CORS_ORIGINS.includes(origin)
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        }
      : {};

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Request-ID': request.id,
    ...corsHeaders,
  });

  await new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | null = null;
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
    }, 15_000);
    const end = (): void => {
      clearInterval(heartbeat);
      request.raw.off('close', end);
      unsubscribe?.();
      if (!reply.raw.writableEnded) reply.raw.end();
      resolve();
    };
    request.raw.on('close', end);
    unsubscribe = run.subscribe(
      after,
      (event, index) => {
        if (reply.raw.writableEnded) return;
        reply.raw.write(`id: ${String(index)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      },
      end,
    );
  });
  return true;
}

function toChatDto(row: ChatRow): {
  id: string;
  title: string;
  projectId: string | null;
  pinned: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
} {
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    pinned: row.pinned,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function loadChat(
  request: { services: AppInstance['services']; user: { id: string } | null },
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
): Promise<MessageDto[]> {
  const { db } = request.services;
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
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
  }));
}

/** Append the user turn plus an empty assistant row, returning the assistant message id. */
async function appendTurn(
  request: { services: AppInstance['services'] },
  chatId: string,
  userId: string,
  prompt: string,
  mode: string,
  attachmentIds: string[],
): Promise<string> {
  const { db } = request.services;

  return db.transaction(async (tx) => {
    if (attachmentIds.length > 0) {
      // Serialises turns on this chat, so two sends cannot both fit under the file limit.
      await tx.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId)).for('update');
      const incoming = await tx
        .select({ id: attachmentsTable.id, status: attachmentsTable.status, messageId: attachmentsTable.messageId })
        .from(attachmentsTable)
        .where(and(inArray(attachmentsTable.id, attachmentIds), eq(attachmentsTable.userId, userId)));
      if (incoming.some((a) => a.status === 'uploading')) {
        throw new ApiError('upload_incomplete', {
          detail: 'A file is still uploading. Wait for it to finish, then send.',
        });
      }
      const fresh = incoming.filter((a) => a.messageId === null).length;
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
      await tx
        .update(attachmentsTable)
        .set({ messageId: userMessage!.id })
        .where(
          and(inArray(attachmentsTable.id, attachmentIds), eq(attachmentsTable.userId, userId)),
        );
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

/** Clear a previous attempt so a retry does not append duplicate sources or events. */
async function resetForRetry(
  request: { services: AppInstance['services'] },
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
