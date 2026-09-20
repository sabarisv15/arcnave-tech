/**
 * Artifact tool executor for Item 11 & Workspace integration.
 *
 * Implements create_artifact, read_artifact, and update_artifact:
 * - Scoped strictly to trusted context (userId, projectId, chatId, assistantMessageId).
 * - Idempotent create_artifact execution backed by idempotency_keys table.
 * - Optimistic concurrency protection (expectedVersion) and atomic FOR UPDATE version increment.
 * - Normalized typed error returns (Invariant 1).
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { artifacts, artifactVersions, idempotencyKeys, messages } from '../db/schema.js';
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';

export interface ArtifactToolContext {
  userId: string;
  projectId: string | null;
  chatId: string;
  assistantMessageId?: string;
  runId?: string;
}

export interface ArtifactCreationResult {
  ok: true;
  artifactId: string;
  title: string;
  kind: string;
  version: number;
}

const createSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title must not be empty')
    .max(200, 'Title must not exceed 200 characters'),
  kind: z.enum(['document', 'code', 'webpage']).default('document'),
  content: z.string().min(1, 'Content must not be empty'),
});

const readSchema = z.object({
  id: z.string().uuid('Invalid artifact ID'),
});

const updateSchema = z.object({
  id: z.string().uuid('Invalid artifact ID'),
  expectedVersion: z.number().int().min(1, 'expectedVersion must be at least 1'),
  content: z.string().min(1, 'Content must not be empty'),
});

function errorResult(call: ToolCall, code: string, error: string): ToolResult {
  return {
    toolCallId: call.id,
    ok: false,
    content: [{ type: 'json', data: { ok: false, code, error } }],
  };
}

function jsonResult(call: ToolCall, data: unknown, ok = true): ToolResult {
  return {
    toolCallId: call.id,
    ok,
    content: [{ type: 'json', data }],
  };
}

function computeFingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 64);
}

export class ArtifactToolExecutor implements ToolExecutor {
  constructor(
    private readonly db: Database,
    private readonly context: ArtifactToolContext,
    private readonly maxContentBytes: number = 500_000,
    private readonly onArtifactCreated?: (artifact: ArtifactCreationResult) => void,
  ) {}

  canExecute(name: string): boolean {
    return name === 'create_artifact' || name === 'read_artifact' || name === 'update_artifact';
  }

  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return errorResult(call, 'aborted', 'Request was cancelled.');
    }

    try {
      switch (call.name) {
        case 'create_artifact':
          return await this.executeCreate(call, signal);
        case 'read_artifact':
          return await this.executeRead(call, signal);
        case 'update_artifact':
          return await this.executeUpdate(call, signal);
        default:
          return errorResult(call, 'unknown_tool', `Unknown artifact tool: ${call.name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Artifact operation failed';
      return errorResult(call, 'execution_failed', message);
    }
  }

  private async executeCreate(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    const parsed = createSchema.safeParse(call.input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? 'Invalid create_artifact input';
      return errorResult(call, 'invalid_input', issue);
    }

    const { title, kind, content } = parsed.data;
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > this.maxContentBytes) {
      return errorResult(
        call,
        'oversized_content',
        `Content size (${byteLength} bytes) exceeds maximum limit of ${this.maxContentBytes} bytes.`,
      );
    }

    // Idempotency check: ensure retries of the same tool call do not duplicate artifacts
    const idempotencyKey = `${this.context.runId ?? 'single'}:${call.id}`;
    const endpoint = 'tool:create_artifact';

    const [existing] = await this.db
      .select({ responseJson: idempotencyKeys.responseJson })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, this.context.userId),
          eq(idempotencyKeys.key, idempotencyKey),
          eq(idempotencyKeys.endpoint, endpoint),
        ),
      )
      .limit(1);

    if (existing) {
      return jsonResult(call, existing.responseJson);
    }

    if (signal?.aborted) {
      return errorResult(call, 'aborted', 'Request was cancelled.');
    }

    const resultData: ArtifactCreationResult = await this.db.transaction(async (tx) => {
      const [artifact] = await tx
        .insert(artifacts)
        .values({
          userId: this.context.userId,
          title,
          kind,
          projectId: this.context.projectId,
          chatId: this.context.chatId,
          currentVersion: 1,
        })
        .returning();

      await tx.insert(artifactVersions).values({
        artifactId: artifact!.id,
        version: 1,
        content,
        format: 'markdown',
      });

      // Associate with assistant message if available
      if (this.context.assistantMessageId) {
        await tx
          .update(messages)
          .set({ artifactId: artifact!.id })
          .where(eq(messages.id, this.context.assistantMessageId));
      }

      const res: ArtifactCreationResult = {
        ok: true,
        artifactId: artifact!.id,
        title: artifact!.title,
        kind: artifact!.kind,
        version: 1,
      };

      await tx.insert(idempotencyKeys).values({
        userId: this.context.userId,
        key: idempotencyKey,
        endpoint,
        requestFingerprint: computeFingerprint(parsed.data),
        responseJson: res,
        statusCode: 200,
      });

      return res;
    });

    this.onArtifactCreated?.(resultData);

    return jsonResult(call, resultData);
  }

  private async executeRead(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    const parsed = readSchema.safeParse(call.input);
    if (!parsed.success) {
      return errorResult(call, 'invalid_input', 'Invalid artifact ID format.');
    }

    if (signal?.aborted) {
      return errorResult(call, 'aborted', 'Request was cancelled.');
    }

    const { id } = parsed.data;

    const [artifact] = await this.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.userId, this.context.userId)))
      .limit(1);

    if (!artifact) {
      return errorResult(call, 'not_found', 'Artifact not found or access denied.');
    }

    // Scoped project verification
    if (
      this.context.projectId !== null &&
      artifact.projectId !== null &&
      artifact.projectId !== this.context.projectId
    ) {
      return errorResult(call, 'permission_denied', 'Artifact belongs to a different project.');
    }

    const [versionRow] = await this.db
      .select({ content: artifactVersions.content, format: artifactVersions.format })
      .from(artifactVersions)
      .where(
        and(
          eq(artifactVersions.artifactId, artifact.id),
          eq(artifactVersions.version, artifact.currentVersion),
        ),
      )
      .limit(1);

    return jsonResult(call, {
      ok: true,
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      version: artifact.currentVersion,
      content: versionRow?.content ?? '',
    });
  }

  private async executeUpdate(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    const parsed = updateSchema.safeParse(call.input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? 'Invalid update_artifact input';
      return errorResult(call, 'invalid_input', issue);
    }

    const { id, expectedVersion, content } = parsed.data;
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > this.maxContentBytes) {
      return errorResult(
        call,
        'oversized_content',
        `Content size (${byteLength} bytes) exceeds maximum limit of ${this.maxContentBytes} bytes.`,
      );
    }

    if (signal?.aborted) {
      return errorResult(call, 'aborted', 'Request was cancelled.');
    }

    // Execute with atomic row lock (FOR UPDATE)
    const result = await this.db.transaction(
      async (tx): Promise<{ error: ToolResult } | { success: Record<string, unknown> }> => {
        const [locked] = await tx
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.id, id), eq(artifacts.userId, this.context.userId)))
          .for('update')
          .limit(1);

        if (!locked) {
          return { error: errorResult(call, 'not_found', 'Artifact not found or access denied.') };
        }

        if (
          this.context.projectId !== null &&
          locked.projectId !== null &&
          locked.projectId !== this.context.projectId
        ) {
          return {
            error: errorResult(call, 'permission_denied', 'Artifact belongs to a different project.'),
          };
        }

        // Optimistic concurrency check
        if (locked.currentVersion !== expectedVersion) {
          return {
            error: errorResult(
              call,
              'version_conflict',
              `Version conflict: artifact is currently at version ${locked.currentVersion}, expected ${expectedVersion}. ` +
                'Another edit has occurred. Please read the artifact again before reapplying updates.',
            ),
          };
        }

        const nextVersion = locked.currentVersion + 1;
        const nextConcurrencyVersion = locked.version + 1;

        await tx.insert(artifactVersions).values({
          artifactId: locked.id,
          version: nextVersion,
          content,
          format: 'markdown',
        });

        await tx
          .update(artifacts)
          .set({
            currentVersion: nextVersion,
            version: nextConcurrencyVersion,
            updatedAt: new Date(),
          })
          .where(eq(artifacts.id, locked.id));

        return {
          success: {
            ok: true,
            id: locked.id,
            title: locked.title,
            version: nextVersion,
          },
        };
      },
    );

    if ('error' in result) {
      return result.error;
    }

    return jsonResult(call, result.success);
  }
}
