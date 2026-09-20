import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { artifacts, artifactVersions, chats, idempotencyKeys, messages, projects } from '../db/schema.js';
import type { ToolResult } from '../providers/types.js';
import { createTestApp, signUp, type TestContext } from '../test/harness.js';
import { ArtifactToolExecutor } from './artifactExecutor.js';

function jsonContent(result: ToolResult): Record<string, any> {
  const block = result.content[0];
  if (!block || block.type !== 'json') throw new Error('expected a json content block');
  return block.data as Record<string, any>;
}

describe('ArtifactToolExecutor', () => {
  let ctx: TestContext;
  let userAId: string;
  let userBId: string;
  let chatId: string;
  let messageId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    const userA = await signUp(ctx);
    userAId = userA.id;

    const userB = await signUp(ctx);
    userBId = userB.id;

    const [chat] = await ctx.db
      .insert(chats)
      .values({
        userId: userAId,
        title: 'Artifact Test Chat',
      })
      .returning();
    chatId = chat!.id;

    const [msg] = await ctx.db
      .insert(messages)
      .values({
        chatId,
        userId: userAId,
        seq: 1,
        role: 'assistant',
        text: 'Working on artifact...',
        status: 'generating',
      })
      .returning();
    messageId = msg!.id;
  });

  describe('create_artifact', () => {
    it('creates an artifact and associates it with the assistant message', async () => {
      let callbackEmitted = false;
      const executor = new ArtifactToolExecutor(
        ctx.db,
        {
          userId: userAId,
          projectId: null,
          chatId,
          assistantMessageId: messageId,
        },
        500_000,
        (art) => {
          callbackEmitted = true;
          expect(art.title).toBe('Q3 Financial Report');
        },
      );

      const res = await executor.execute({
        id: 'call-1',
        name: 'create_artifact',
        input: {
          title: 'Q3 Financial Report',
          kind: 'document',
          content: '# Summary\nRevenue grew by 20%.',
        },
      });

      expect(res.ok).toBe(true);
      const parsed = jsonContent(res);
      expect(parsed.ok).toBe(true);
      expect(parsed.artifactId).toBeDefined();
      expect(parsed.version).toBe(1);
      expect(callbackEmitted).toBe(true);

      // Verify DB row
      const [artRow] = await ctx.db.select().from(artifacts).where(eq(artifacts.id, parsed.artifactId));
      expect(artRow).toBeDefined();
      expect(artRow!.title).toBe('Q3 Financial Report');
      expect(artRow!.currentVersion).toBe(1);

      // Verify version row
      const [verRow] = await ctx.db
        .select()
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, parsed.artifactId));
      expect(verRow).toBeDefined();
      expect(verRow!.content).toContain('Revenue grew by 20%.');

      // Verify message association
      const [updatedMsg] = await ctx.db.select().from(messages).where(eq(messages.id, messageId));
      expect(updatedMsg!.artifactId).toBe(parsed.artifactId);
    });

    it('enforces idempotency on replayed tool calls with same toolCallId', async () => {
      const executor = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: null,
        chatId,
      });

      const uniqueTitle = `Idempotent Doc ${Date.now()}-${Math.random()}`;
      const call = {
        id: `call-idempotent-${Date.now()}`,
        name: 'create_artifact',
        input: {
          title: uniqueTitle,
          kind: 'document',
          content: 'First creation content',
        },
      };

      // First run
      const res1 = await executor.execute(call);
      expect(res1.ok).toBe(true);
      const parsed1 = jsonContent(res1);

      // Replayed run (e.g. agent retry or network replay)
      const res2 = await executor.execute(call);
      expect(res2.ok).toBe(true);
      const parsed2 = jsonContent(res2);

      // Invariant: returns identical artifactId, no duplicate created
      expect(parsed2.artifactId).toBe(parsed1.artifactId);

      // Verify only 1 artifact with this title exists
      const rows = await ctx.db.select().from(artifacts).where(eq(artifacts.title, uniqueTitle));
      expect(rows).toHaveLength(1);
    });

    it('rejects oversized content exceeding maxContentBytes', async () => {
      const executor = new ArtifactToolExecutor(
        ctx.db,
        {
          userId: userAId,
          projectId: null,
          chatId,
        },
        100, // Small limit
      );

      const res = await executor.execute({
        id: 'call-oversized',
        name: 'create_artifact',
        input: {
          title: 'Giant Doc',
          content: 'A'.repeat(200),
        },
      });

      expect(res.ok).toBe(false);
      const parsed = jsonContent(res);
      expect(parsed.code).toBe('oversized_content');
    });

    it('rejects invalid inputs', async () => {
      const executor = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: null,
        chatId,
      });

      const res = await executor.execute({
        id: 'call-invalid',
        name: 'create_artifact',
        input: {
          title: '', // Empty title
          content: 'Valid content',
        },
      });

      expect(res.ok).toBe(false);
      const parsed = jsonContent(res);
      expect(parsed.code).toBe('invalid_input');
    });

    it('handles AbortSignal gracefully', async () => {
      const executor = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: null,
        chatId,
      });

      const controller = new AbortController();
      controller.abort();

      const res = await executor.execute(
        {
          id: 'call-aborted',
          name: 'create_artifact',
          input: {
            title: 'Aborted Doc',
            content: 'Should not create',
          },
        },
        controller.signal,
      );

      expect(res.ok).toBe(false);
      const parsed = jsonContent(res);
      expect(parsed.code).toBe('aborted');
    });
  });

  describe('read_artifact & update_artifact', () => {
    let createdArtifactId: string;

    beforeEach(async () => {
      const executor = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: null,
        chatId,
      });

      const res = await executor.execute({
        id: `setup-${Date.now()}`,
        name: 'create_artifact',
        input: {
          title: 'Project Roadmap',
          kind: 'document',
          content: 'Version 1 content: Phase 1 planned.',
        },
      });
      const parsed = jsonContent(res);
      createdArtifactId = parsed.artifactId;
    });

    it('reads the latest content and version', async () => {
      const executor = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: null,
        chatId,
      });

      const res = await executor.execute({
        id: 'call-read',
        name: 'read_artifact',
        input: {
          id: createdArtifactId,
        },
      });

      expect(res.ok).toBe(true);
      const parsed = jsonContent(res);
      expect(parsed.title).toBe('Project Roadmap');
      expect(parsed.version).toBe(1);
      expect(parsed.content).toContain('Phase 1 planned');
    });

    it('prevents user B from reading user A artifact', async () => {
      const executorUserB = new ArtifactToolExecutor(ctx.db, {
        userId: userBId, // different user
        projectId: null,
        chatId,
      });

      const res = await executorUserB.execute({
        id: 'call-read-other',
        name: 'read_artifact',
        input: {
          id: createdArtifactId,
        },
      });

      expect(res.ok).toBe(false);
      const parsed = jsonContent(res);
      expect(parsed.code).toBe('not_found');
    });

    it('updates an artifact when expectedVersion matches and increments version atomically', async () => {
      const executor = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: null,
        chatId,
      });

      const res = await executor.execute({
        id: 'call-update',
        name: 'update_artifact',
        input: {
          id: createdArtifactId,
          expectedVersion: 1,
          content: 'Version 2 content: Phase 1 complete, Phase 2 in progress.',
        },
      });

      expect(res.ok).toBe(true);
      const parsed = jsonContent(res);
      expect(parsed.version).toBe(2);

      // Verify read reflects new version
      const readRes = await executor.execute({
        id: 'call-read-v2',
        name: 'read_artifact',
        input: {
          id: createdArtifactId,
        },
      });
      const readParsed = jsonContent(readRes);
      expect(readParsed.version).toBe(2);
      expect(readParsed.content).toContain('Phase 2 in progress');
    });

    it('rejects update with version_conflict if expectedVersion does not match currentVersion', async () => {
      const executor = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: null,
        chatId,
      });

      // Update to version 2 first
      await executor.execute({
        id: 'call-update-1',
        name: 'update_artifact',
        input: {
          id: createdArtifactId,
          expectedVersion: 1,
          content: 'V2 content',
        },
      });

      // Stale update still expecting version 1
      const staleRes = await executor.execute({
        id: 'call-update-stale',
        name: 'update_artifact',
        input: {
          id: createdArtifactId,
          expectedVersion: 1, // Stale!
          content: 'Stale V2 content overwrite attempt',
        },
      });

      expect(staleRes.ok).toBe(false);
      const parsed = jsonContent(staleRes);
      expect(parsed.code).toBe('version_conflict');
    });

    it('enforces project scoping: project A context cannot access project B artifact', async () => {
      // Create artifact within real project 1
      const [proj1] = await ctx.db
        .insert(projects)
        .values({ userId: userAId, title: 'Project 1' })
        .returning();
      const [proj2] = await ctx.db
        .insert(projects)
        .values({ userId: userAId, title: 'Project 2' })
        .returning();

      const project1Id = proj1!.id;
      const project2Id = proj2!.id;

      const executorProj1 = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: project1Id,
        chatId,
      });

      const createRes = await executorProj1.execute({
        id: 'create-proj1',
        name: 'create_artifact',
        input: {
          title: 'Project 1 Secret Plan',
          content: 'Secret content',
        },
      });
      const artId = jsonContent(createRes).artifactId;

      // Try reading from Project 2 context
      const executorProj2 = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: project2Id,
        chatId,
      });

      const readRes = await executorProj2.execute({
        id: 'read-proj2',
        name: 'read_artifact',
        input: { id: artId },
      });

      expect(readRes.ok).toBe(false);
      expect(jsonContent(readRes).code).toBe('permission_denied');

      // Try updating from Project 2 context
      const updateRes = await executorProj2.execute({
        id: 'update-proj2',
        name: 'update_artifact',
        input: {
          id: artId,
          expectedVersion: 1,
          content: 'Hacked content',
        },
      });

      expect(updateRes.ok).toBe(false);
      expect(jsonContent(updateRes).code).toBe('permission_denied');
    });

    it('prevents concurrent updates from creating duplicate version numbers (FOR UPDATE lock)', async () => {
      const executor = new ArtifactToolExecutor(ctx.db, {
        userId: userAId,
        projectId: null,
        chatId,
      });

      // Launch two concurrent updates targeting expectedVersion: 1
      const [p1, p2] = await Promise.all([
        executor.execute({
          id: 'concurrent-1',
          name: 'update_artifact',
          input: {
            id: createdArtifactId,
            expectedVersion: 1,
            content: 'Concurrent Update A',
          },
        }),
        executor.execute({
          id: 'concurrent-2',
          name: 'update_artifact',
          input: {
            id: createdArtifactId,
            expectedVersion: 1,
            content: 'Concurrent Update B',
          },
        }),
      ]);

      const results = [jsonContent(p1), jsonContent(p2)];
      const successes = results.filter((r) => r.ok === true);
      const conflicts = results.filter((r) => r.code === 'version_conflict');

      // Exactly one update must succeed, and the other must be rejected with version_conflict
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect(successes[0]!.version).toBe(2);
    });
  });
});
