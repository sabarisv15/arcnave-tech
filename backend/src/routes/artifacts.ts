/**
 * Artifacts and their version history.
 *
 * An artifact is append-only. Editing writes a new row in `artifact_versions` and moves the
 * pointer; it never overwrites content. That is what makes "restore" a real operation rather
 * than an apology — restoring version 2 appends a copy of it as version 5, so the history of
 * what was shown to the user stays intact and the undo is itself undoable.
 *
 * `artifacts.currentVersion` is the pointer. `artifacts.version` is the optimistic-concurrency
 * counter, the same as everywhere else. They are different numbers on purpose; naming them
 * alike would invite a fix that silently clobbers a concurrent edit.
 */
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { artifacts, artifactVersions, chats, projects } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import type { AppInstance } from '../types.js';
import {
  assertVersion,
  decodeCursor,
  encodeCursor,
  iso,
  paginationQuery,
  uuidParam,
} from './helpers.js';

const MAX_CONTENT_CHARS = 400_000;

const kindSchema = z.enum(['document', 'code', 'webpage']);

const artifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  projectId: z.string().nullable(),
  chatId: z.string().nullable(),
  /** The version number currently pointed at. 0 means created but never written to. */
  currentVersion: z.number(),
  version: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const versionSchema = z.object({
  version: z.number(),
  createdAt: z.string().nullable(),
  charCount: z.number(),
});

type ArtifactRow = typeof artifacts.$inferSelect;

export async function artifactRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', requireAuth);

  /* ---------------------------------------------------------------- list */

  typed.get(
    '/artifacts',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'List artifacts, newest first',
        querystring: paginationQuery.extend({
          projectId: z.string().uuid().optional(),
          chatId: z.string().uuid().optional(),
          kind: kindSchema.optional(),
          q: z.string().max(200).optional(),
        }),
        response: {
          200: z.object({ items: z.array(artifactSchema), nextCursor: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { limit, cursor, projectId, chatId, kind, q } = request.query;
      const decoded = decodeCursor(cursor);

      const filters = [eq(artifacts.userId, user.id)];
      if (projectId) filters.push(eq(artifacts.projectId, projectId));
      if (chatId) filters.push(eq(artifacts.chatId, chatId));
      if (kind) filters.push(eq(artifacts.kind, kind));
      if (q?.trim()) filters.push(sql`${artifacts.title} ilike ${'%' + q.trim() + '%'}`);
      if (decoded) {
        filters.push(
          or(
            lt(artifacts.updatedAt, new Date(decoded.at)),
            and(eq(artifacts.updatedAt, new Date(decoded.at)), lt(artifacts.id, decoded.id)),
          )!,
        );
      }

      const rows = await db
        .select()
        .from(artifacts)
        .where(and(...filters))
        .orderBy(desc(artifacts.updatedAt), desc(artifacts.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toArtifactDto),
        nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null,
      };
    },
  );

  /* ---------------------------------------------------------------- create */

  typed.post(
    '/artifacts',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Create an artifact with its first version',
        body: z.object({
          title: z.string().trim().min(1).max(200),
          kind: kindSchema.default('document'),
          content: z.string().max(MAX_CONTENT_CHARS).default(''),
          projectId: z.string().uuid().nullable().default(null),
          chatId: z.string().uuid().nullable().default(null),
        }),
        response: { 201: artifactSchema.extend({ content: z.string() }) },
      },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { db } = request.services;
      const { title, kind, content, projectId, chatId } = request.body;

      await assertOwnedRefs(request, projectId, chatId);

      const created = await db.transaction(async (tx) => {
        const [artifact] = await tx
          .insert(artifacts)
          .values({ userId: user.id, title, kind, projectId, chatId, currentVersion: 1 })
          .returning();
        await tx
          .insert(artifactVersions)
          .values({ artifactId: artifact!.id, version: 1, content });
        return artifact!;
      });

      return reply.status(201).send({ ...toArtifactDto(created), content });
    },
  );

  /* ---------------------------------------------------------------- read */

  typed.get(
    '/artifacts/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'An artifact with the content of its current version',
        params: uuidParam,
        querystring: z.object({
          /** Read an older version without restoring it. */
          version: z.coerce.number().int().min(1).optional(),
        }),
        response: {
          200: artifactSchema.extend({
            content: z.string(),
            readVersion: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const artifact = await loadArtifact(request, request.params.id);
      const wanted = request.query.version ?? artifact.currentVersion;
      const content = await readVersion(request, artifact, wanted);
      return { ...toArtifactDto(artifact), content, readVersion: wanted };
    },
  );

  /* ---------------------------------------------------------------- rename / move */

  typed.patch(
    '/artifacts/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Rename an artifact or move it between a project and a chat',
        description: 'Content is never changed here. Use POST /artifacts/:id/versions for that.',
        params: uuidParam,
        body: z.object({
          title: z.string().trim().min(1).max(200).optional(),
          kind: kindSchema.optional(),
          projectId: z.string().uuid().nullable().optional(),
          chatId: z.string().uuid().nullable().optional(),
          version: z.number().int().optional(),
        }),
        response: { 200: artifactSchema },
      },
    },
    async (request) => {
      const { db } = request.services;
      const artifact = await loadArtifact(request, request.params.id);
      assertVersion(request.body.version, artifact.version, 'artifact');

      await assertOwnedRefs(request, request.body.projectId, request.body.chatId);

      const patch: Record<string, unknown> = {
        version: artifact.version + 1,
        updatedAt: new Date(),
      };
      for (const field of ['title', 'kind', 'projectId', 'chatId'] as const) {
        if (request.body[field] !== undefined) patch[field] = request.body[field];
      }

      const [updated] = await db
        .update(artifacts)
        .set(patch)
        .where(eq(artifacts.id, artifact.id))
        .returning();
      return toArtifactDto(updated!);
    },
  );

  /* ---------------------------------------------------------------- new version */

  typed.post(
    '/artifacts/:id/versions',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Append a new version and point the artifact at it',
        params: uuidParam,
        body: z.object({
          content: z.string().max(MAX_CONTENT_CHARS),
          version: z.number().int().optional(),
        }),
        response: { 201: artifactSchema.extend({ content: z.string() }) },
      },
    },
    async (request, reply) => {
      const { db } = request.services;
      const artifact = await loadArtifact(request, request.params.id);
      assertVersion(request.body.version, artifact.version, 'artifact');

      const updated = await appendVersion(request, artifact.id, request.body.content);
      return reply.status(201).send({ ...toArtifactDto(updated), content: request.body.content });
    },
  );

  /* ---------------------------------------------------------------- history */

  typed.get(
    '/artifacts/:id/versions',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Version history, newest first (metadata only)',
        params: uuidParam,
        response: {
          200: z.object({ currentVersion: z.number(), items: z.array(versionSchema) }),
        },
      },
    },
    async (request) => {
      const { db } = request.services;
      const artifact = await loadArtifact(request, request.params.id);
      const rows = await db
        .select({
          version: artifactVersions.version,
          createdAt: artifactVersions.createdAt,
          // Counted in SQL so listing a long history does not ship every byte of every
          // version to render a size column.
          charCount: sql<number>`length(${artifactVersions.content})::int`,
        })
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, artifact.id))
        .orderBy(desc(artifactVersions.version));

      return {
        currentVersion: artifact.currentVersion,
        items: rows.map((r) => ({
          version: r.version,
          createdAt: iso(r.createdAt),
          charCount: r.charCount,
        })),
      };
    },
  );

  /* ---------------------------------------------------------------- restore */

  typed.post(
    '/artifacts/:id/restore',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Restore an earlier version by appending a copy of it',
        description:
          'History is never truncated: restoring version 2 of five creates version 6 with ' +
          'version 2’s content, so the restore can itself be undone.',
        params: uuidParam,
        body: z.object({
          restoreVersion: z.number().int().min(1),
          version: z.number().int().optional(),
        }),
        response: { 201: artifactSchema.extend({ content: z.string() }) },
      },
    },
    async (request, reply) => {
      const artifact = await loadArtifact(request, request.params.id);
      assertVersion(request.body.version, artifact.version, 'artifact');

      const content = await readVersion(request, artifact, request.body.restoreVersion);
      const updated = await appendVersion(request, artifact.id, content);
      return reply.status(201).send({ ...toArtifactDto(updated), content });
    },
  );

  /* ---------------------------------------------------------------- delete */

  typed.delete(
    '/artifacts/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Delete an artifact and all of its versions',
        description:
          'Hard delete. Messages that referenced it keep their `artifactId`, which resolves ' +
          'to a 404 rather than rewriting conversation history.',
        params: uuidParam,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { db } = request.services;
      const artifact = await loadArtifact(request, request.params.id);
      await db.delete(artifacts).where(eq(artifacts.id, artifact.id));
      return reply.status(204).send(null);
    },
  );
}

/* -------------------------------------------------------------------------- helpers */

interface OwnedRequest {
  services: AppInstance['services'];
  user: { id: string } | null;
}

async function loadArtifact(request: OwnedRequest, id: string): Promise<ArtifactRow> {
  const user = request.user;
  if (!user) throw new ApiError('unauthorized');
  const [row] = await request.services.db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, id), eq(artifacts.userId, user.id)))
    .limit(1);
  if (!row) throw notFound('artifact');
  return row;
}

async function readVersion(
  request: OwnedRequest,
  artifact: ArtifactRow,
  version: number,
): Promise<string> {
  const [row] = await request.services.db
    .select({ content: artifactVersions.content })
    .from(artifactVersions)
    .where(
      and(eq(artifactVersions.artifactId, artifact.id), eq(artifactVersions.version, version)),
    )
    .limit(1);
  if (!row) throw notFound('artifact version');
  return row.content;
}

/**
 * Append a version inside one transaction, serialised on the artifact row.
 *
 * The `FOR UPDATE` is load-bearing. `max(version) + 1` alone takes no lock: under READ
 * COMMITTED two concurrent appends both read the same number, both insert it, and one dies on
 * the unique index as a 500. Locking the parent row first makes concurrent appends queue, so
 * the second one reads a max that already includes the first.
 *
 * The concurrency counter is bumped from the *locked* row rather than from whatever the caller
 * read earlier, for the same reason — two writers must not both set it to the same value.
 */
async function appendVersion(
  request: OwnedRequest,
  artifactId: string,
  content: string,
): Promise<ArtifactRow> {
  const { db } = request.services;
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .for('update')
      .limit(1);
    if (!locked) throw notFound('artifact');

    const [head] = await tx
      .select({ next: sql<number>`coalesce(max(${artifactVersions.version}), 0) + 1` })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId));
    const next = head?.next ?? 1;

    await tx.insert(artifactVersions).values({ artifactId, version: next, content });

    const [updated] = await tx
      .update(artifacts)
      .set({ currentVersion: next, version: locked.version + 1, updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .returning();
    return updated!;
  });
}

/**
 * Reject a project or chat reference the caller does not own.
 *
 * Without this an artifact could be filed into someone else's project by guessing a UUID. The
 * columns are `on delete set null`, not foreign-key-scoped to the user, so the check has to
 * happen here.
 */
async function assertOwnedRefs(
  request: OwnedRequest,
  projectId: string | null | undefined,
  chatId: string | null | undefined,
): Promise<void> {
  const user = request.user;
  if (!user) throw new ApiError('unauthorized');
  const { db } = request.services;

  if (projectId) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.userId, user.id),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw notFound('project');
  }

  if (chatId) {
    const [row] = await db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.userId, user.id), isNull(chats.deletedAt)))
      .limit(1);
    if (!row) throw notFound('conversation');
  }
}

function toArtifactDto(row: ArtifactRow): z.infer<typeof artifactSchema> {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    projectId: row.projectId,
    chatId: row.chatId,
    currentVersion: row.currentVersion,
    version: row.version,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
