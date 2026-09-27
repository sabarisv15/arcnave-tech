/**
 * Public share links (ADR-0039).
 *
 * The owner shares a chat or an artifact as a snapshot; anyone with the link reads that snapshot
 * without an account. The public payload is built from an allow-list of fields: message text,
 * citations, the visuals and artifacts a reply showed. Attachments, tool inputs and results,
 * thinking, memory, usage and the owner's identity are never read into it.
 */
import { randomBytes } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, lte, max } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  artifacts,
  artifactVersions,
  chats,
  messages,
  messageSources,
  shareLinks,
  toolCalls,
} from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import type { AppInstance } from '../types.js';
import { iso, uuidParam } from './helpers.js';

type ShareRow = typeof shareLinks.$inferSelect;

const shareLinkSchema = z.object({
  id: z.string(),
  token: z.string(),
  /** The app path that opens the link: `/s/{token}`. */
  path: z.string(),
  targetType: z.enum(['chat', 'artifact']),
  targetId: z.string(),
  title: z.string(),
  snapshotAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});

const sourceSchema = z.object({ id: z.number(), title: z.string(), url: z.string(), domain: z.string() });
const sharedArtifactSchema = z.object({ title: z.string(), kind: z.string(), content: z.string() });

const publicShareSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    title: z.string(),
    sharedAt: z.string().nullable(),
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string(),
        createdAt: z.string().nullable(),
        sources: z.array(sourceSchema),
        /** The reply's visuals and other rendered blocks, as the chat showed them. */
        uiBlocks: z.array(z.unknown()),
        artifact: sharedArtifactSchema.nullable(),
      }),
    ),
  }),
  z.object({
    type: z.literal('artifact'),
    title: z.string(),
    sharedAt: z.string().nullable(),
    artifact: sharedArtifactSchema.extend({ version: z.number() }),
  }),
]);

/** 32 random bytes: nothing about the target or the owner can be read from, or guessed into, it. */
export function newShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function shareRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /* ---------------------------------------------------------------- public */

  typed.get(
    '/public/share/:token',
    {
      schema: {
        tags: ['share'],
        summary: 'Read a shared snapshot. No sign-in.',
        params: z.object({ token: z.string().min(20).max(64) }),
        response: { 200: publicShareSchema },
      },
      config: {
        rateLimit: {
          max: app.services.cfg.RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE,
          timeWindow: '1 minute',
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const { db } = request.services;
      // A shared page must not be indexed, and a revoked link must stop working at once.
      reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store');
      const [link] = await db
        .select()
        .from(shareLinks)
        .where(and(eq(shareLinks.token, request.params.token), isNull(shareLinks.revokedAt)))
        .limit(1);
      if (!link) throw new ApiError('share_not_found');
      return link.targetType === 'chat' ? publicChat(request, link) : publicArtifact(request, link);
    },
  );

  /* ---------------------------------------------------------------- owner */

  await app.register(async (owner) => {
    owner.addHook('onRequest', requireAuth);
    const ownerTyped = owner.withTypeProvider<ZodTypeProvider>();

    ownerTyped.post(
      '/chats/:id/share',
      {
        schema: {
          tags: ['share'],
          summary: 'Share a chat by public link, or update the snapshot of its link',
          description: 'The link shows the chat up to its last finished reply. Messages sent later stay private until this is called again.',
          params: uuidParam,
          response: { 200: shareLinkSchema },
        },
      },
      async (request) => {
        const user = currentUser(request);
        const { db } = request.services;
        const [chat] = await db
          .select()
          .from(chats)
          .where(and(eq(chats.id, request.params.id), eq(chats.userId, user.id), isNull(chats.deletedAt)))
          .limit(1);
        if (!chat) throw notFound('conversation');
        const [last] = await db
          .select({ seq: max(messages.seq) })
          .from(messages)
          .where(and(eq(messages.chatId, chat.id), eq(messages.role, 'assistant'), eq(messages.status, 'complete')));
        if (last?.seq === null || last?.seq === undefined) throw new ApiError('share_empty');
        const link = await upsertLink(request, user.id, 'chat', chat.id, last.seq);
        return toDto(link, chat.title);
      },
    );

    ownerTyped.post(
      '/artifacts/:id/share',
      {
        schema: {
          tags: ['share'],
          summary: 'Share an artifact by public link, or update its link to the current version',
          params: uuidParam,
          response: { 200: shareLinkSchema },
        },
      },
      async (request) => {
        const user = currentUser(request);
        const { db } = request.services;
        const [artifact] = await db
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.id, request.params.id), eq(artifacts.userId, user.id)))
          .limit(1);
        if (!artifact) throw notFound('artifact');
        const [latest] = await db
          .select({ version: max(artifactVersions.version) })
          .from(artifactVersions)
          .where(
            and(
              eq(artifactVersions.artifactId, artifact.id),
              eq(artifactVersions.format, 'markdown'),
              lte(artifactVersions.version, artifact.currentVersion),
            ),
          );
        if (latest?.version === null || latest?.version === undefined) {
          throw new ApiError('share_empty', { detail: 'This artifact has no version to share yet.' });
        }
        const link = await upsertLink(request, user.id, 'artifact', artifact.id, latest.version);
        return toDto(link, artifact.title);
      },
    );

    ownerTyped.get(
      '/share-links',
      {
        schema: {
          tags: ['share'],
          summary: 'The links this account has shared and not turned off',
          querystring: z.object({
            targetType: z.enum(['chat', 'artifact']).optional(),
            targetId: z.string().uuid().optional(),
          }),
          response: { 200: z.object({ items: z.array(shareLinkSchema) }) },
        },
      },
      async (request) => {
        const user = currentUser(request);
        const { db } = request.services;
        const filters = [eq(shareLinks.userId, user.id), isNull(shareLinks.revokedAt)];
        if (request.query.targetType) filters.push(eq(shareLinks.targetType, request.query.targetType));
        if (request.query.targetId) filters.push(eq(shareLinks.targetId, request.query.targetId));
        const rows = await db.select().from(shareLinks).where(and(...filters)).orderBy(desc(shareLinks.snapshotAt));

        const chatIds = rows.filter((r) => r.targetType === 'chat').map((r) => r.targetId);
        const artifactIds = rows.filter((r) => r.targetType === 'artifact').map((r) => r.targetId);
        const [chatRows, artifactRows] = await Promise.all([
          chatIds.length
            ? db.select({ id: chats.id, title: chats.title }).from(chats).where(and(inArray(chats.id, chatIds), isNull(chats.deletedAt)))
            : [],
          artifactIds.length
            ? db.select({ id: artifacts.id, title: artifacts.title }).from(artifacts).where(inArray(artifacts.id, artifactIds))
            : [],
        ]);
        const titles = new Map([...chatRows, ...artifactRows].map((r) => [r.id, r.title]));
        // A link whose chat or artifact is gone no longer opens, so it is not listed.
        return {
          items: rows.filter((r) => titles.has(r.targetId)).map((r) => toDto(r, titles.get(r.targetId)!)),
        };
      },
    );

    ownerTyped.delete(
      '/share-links/:id',
      {
        schema: {
          tags: ['share'],
          summary: 'Turn a link off. It stops opening at once.',
          params: uuidParam,
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const user = currentUser(request);
        const { db } = request.services;
        const [row] = await db
          .update(shareLinks)
          .set({ revokedAt: new Date() })
          .where(and(eq(shareLinks.id, request.params.id), eq(shareLinks.userId, user.id), isNull(shareLinks.revokedAt)))
          .returning({ id: shareLinks.id });
        if (!row) throw notFound('link');
        return reply.status(204).send(null);
      },
    );
  });
}

/** One live link per target: sharing again keeps the link and moves its snapshot. */
async function upsertLink(
  request: { services: AppInstance['services'] },
  userId: string,
  targetType: 'chat' | 'artifact',
  targetId: string,
  snapshotSeq: number,
): Promise<ShareRow> {
  const { db } = request.services;
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.userId, userId),
          eq(shareLinks.targetType, targetType),
          eq(shareLinks.targetId, targetId),
          isNull(shareLinks.revokedAt),
        ),
      )
      .for('update')
      .limit(1);
    if (existing) {
      const [updated] = await tx
        .update(shareLinks)
        .set({ snapshotSeq, snapshotAt: new Date() })
        .where(eq(shareLinks.id, existing.id))
        .returning();
      return updated!;
    }
    const [created] = await tx
      .insert(shareLinks)
      .values({ userId, token: newShareToken(), targetType, targetId, snapshotSeq })
      .returning();
    return created!;
  });
}

function toDto(row: ShareRow, title: string): z.infer<typeof shareLinkSchema> {
  return {
    id: row.id,
    token: row.token,
    path: `/s/${row.token}`,
    targetType: row.targetType as 'chat' | 'artifact',
    targetId: row.targetId,
    title,
    snapshotAt: iso(row.snapshotAt),
    createdAt: iso(row.createdAt),
  };
}

async function sharedArtifactAt(
  request: { services: AppInstance['services'] },
  artifactId: string,
  at: Date,
): Promise<z.infer<typeof sharedArtifactSchema> | null> {
  const { db } = request.services;
  const [row] = await db
    .select({ title: artifacts.title, kind: artifacts.kind, content: artifactVersions.content })
    .from(artifactVersions)
    .innerJoin(artifacts, eq(artifacts.id, artifactVersions.artifactId))
    .where(
      and(
        eq(artifactVersions.artifactId, artifactId),
        eq(artifactVersions.format, 'markdown'),
        lte(artifactVersions.createdAt, at),
      ),
    )
    .orderBy(desc(artifactVersions.version))
    .limit(1);
  return row ?? null;
}

/** A reply's `render_ui` blocks, with each visual's markup taken from the call when the stored
 *  result left it out (the same join the app makes when it reads a transcript). */
function uiBlocksOf(calls: Array<{ input: unknown; content: unknown }>): unknown[] {
  const out: unknown[] = [];
  for (const call of calls) {
    const json = (call.content as Array<{ type?: string; data?: { blocks?: unknown[] } }>).find((c) => c.type === 'json');
    const blocks = Array.isArray(json?.data?.blocks) ? json!.data!.blocks! : [];
    const inputBlocks = Array.isArray((call.input as { blocks?: unknown[] } | null)?.blocks)
      ? (call.input as { blocks: unknown[] }).blocks
      : [];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (block['type'] === 'visual' && typeof block['html'] !== 'string') {
        const source = inputBlocks[Number(block['sequence']) - 1] as Record<string, unknown> | undefined;
        out.push(typeof source?.['html'] === 'string' ? { ...block, html: source['html'] } : block);
      } else {
        out.push(block);
      }
    }
  }
  return out;
}

async function publicChat(
  request: { services: AppInstance['services'] },
  link: ShareRow,
): Promise<z.infer<typeof publicShareSchema>> {
  const { db } = request.services;
  const [chat] = await db
    .select({ title: chats.title })
    .from(chats)
    .where(and(eq(chats.id, link.targetId), eq(chats.userId, link.userId), isNull(chats.deletedAt)))
    .limit(1);
  if (!chat) throw new ApiError('share_not_found');

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      text: messages.text,
      status: messages.status,
      artifactId: messages.artifactId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.chatId, link.targetId), lte(messages.seq, link.snapshotSeq)))
    .orderBy(asc(messages.seq));
  // A reply that did not finish is not part of what was shared; its prompt stays, as asked.
  const shown = rows.filter((m) => m.role === 'user' || m.status === 'complete');
  const ids = shown.filter((m) => m.role === 'assistant').map((m) => m.id);

  const [sources, visuals] = await Promise.all([
    ids.length
      ? db
          .select({
            messageId: messageSources.messageId,
            id: messageSources.ordinal,
            title: messageSources.title,
            url: messageSources.url,
            domain: messageSources.domain,
          })
          .from(messageSources)
          .where(inArray(messageSources.messageId, ids))
          .orderBy(asc(messageSources.ordinal))
      : [],
    ids.length
      ? db
          .select({ messageId: toolCalls.messageId, input: toolCalls.input, content: toolCalls.content })
          .from(toolCalls)
          .where(and(inArray(toolCalls.messageId, ids), eq(toolCalls.name, 'render_ui'), eq(toolCalls.ok, true)))
          .orderBy(asc(toolCalls.ordinal))
      : [],
  ]);

  const out = [];
  for (const m of shown) {
    const artifact = m.role === 'assistant' && m.artifactId ? await sharedArtifactAt(request, m.artifactId, link.snapshotAt) : null;
    out.push({
      role: m.role as 'user' | 'assistant',
      text: m.text,
      createdAt: iso(m.createdAt),
      sources: sources.filter((s) => s.messageId === m.id).map(({ messageId: _m, ...s }) => s),
      uiBlocks: uiBlocksOf(visuals.filter((v) => v.messageId === m.id)),
      artifact,
    });
  }
  return { type: 'chat', title: chat.title, sharedAt: iso(link.snapshotAt), messages: out };
}

async function publicArtifact(
  request: { services: AppInstance['services'] },
  link: ShareRow,
): Promise<z.infer<typeof publicShareSchema>> {
  const { db } = request.services;
  const [row] = await db
    .select({ title: artifacts.title, kind: artifacts.kind, content: artifactVersions.content, version: artifactVersions.version })
    .from(artifactVersions)
    .innerJoin(artifacts, eq(artifacts.id, artifactVersions.artifactId))
    .where(
      and(
        eq(artifactVersions.artifactId, link.targetId),
        eq(artifacts.userId, link.userId),
        eq(artifactVersions.version, link.snapshotSeq),
      ),
    )
    .limit(1);
  if (!row) throw new ApiError('share_not_found');
  return { type: 'artifact', title: row.title, sharedAt: iso(link.snapshotAt), artifact: row };
}
