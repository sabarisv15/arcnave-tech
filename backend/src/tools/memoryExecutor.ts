/**
 * Memory tool executor for Phase 5.2.
 *
 * Implements:
 * - search_memory: full-text search with rank-based scoring
 * - read_memory: direct lookup by canonical memoryId
 * - update_memory: optimistic concurrency control via expectedVersion
 * - forget_memory: active storage deletion with source chat preservation
 *
 * Invariant 1: Bad inputs or errors return explicit ToolResults (never throw).
 */
import { z } from 'zod';
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import { MemoryConcurrencyError, type MemoryService } from '../services/memory/memoryService.js';

const searchMemoryInput = z.object({
  query: z.string().min(1),
  scope: z.enum(['global', 'project']).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const readMemoryInput = z.object({
  memoryId: z.string().uuid(),
});

const updateMemoryInput = z.object({
  memoryId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  content: z.string().optional(),
  summary: z.string().optional(),
  isStanding: z.boolean().optional(),
});

const forgetMemoryInput = z.object({
  memoryId: z.string().uuid(),
  expectedVersion: z.number().int().min(1).optional(),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown, ok = true): ToolResult {
  return { toolCallId, ok, content: [{ type: 'json', data }] };
}

export class MemoryToolExecutor implements ToolExecutor {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly userId: string,
    private readonly projectId: string | null = null,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }

    try {
      switch (call.name) {
        case 'search_memory':
          return await this.searchMemory(call);
        case 'read_memory':
          return await this.readMemory(call);
        case 'update_memory':
          return await this.updateMemory(call);
        case 'forget_memory':
          return await this.forgetMemory(call);
        default:
          return textResult(call.id, false, `Unknown tool "${call.name}".`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(call.id, false, `Memory tool execution error: ${message}`);
    }
  }

  private async searchMemory(call: ToolCall): Promise<ToolResult> {
    const parsed = searchMemoryInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const results = await this.memoryService.searchMemory(this.userId, {
      query: parsed.data.query,
      scope: parsed.data.scope,
      projectId: this.projectId,
      limit: parsed.data.limit ?? 5,
    });

    if (results.length === 0) {
      return jsonResult(call.id, {
        results: [],
        message: 'No matching persistent memories found.',
      });
    }

    return jsonResult(call.id, {
      results: results.map((r) => ({
        memoryId: r.id,
        key: r.key,
        summary: r.summary,
        content: r.content,
        scope: r.scope,
        kind: r.kind,
        isStanding: r.isStanding,
        version: r.version,
        score: r.score,
        updatedAt: r.updatedAt,
      })),
    });
  }

  private async readMemory(call: ToolCall): Promise<ToolResult> {
    const parsed = readMemoryInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const item = await this.memoryService.getMemoryById(this.userId, parsed.data.memoryId);
    if (!item) {
      return textResult(call.id, false, `Memory item not found with id "${parsed.data.memoryId}".`);
    }

    return jsonResult(call.id, {
      memoryId: item.id,
      key: item.key,
      summary: item.summary,
      content: item.content,
      scope: item.scope,
      kind: item.kind,
      isStanding: item.isStanding,
      version: item.version,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    });
  }

  private async updateMemory(call: ToolCall): Promise<ToolResult> {
    const parsed = updateMemoryInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    try {
      const updated = await this.memoryService.updateMemory(
        this.userId,
        parsed.data.memoryId,
        parsed.data.expectedVersion,
        {
          content: parsed.data.content,
          summary: parsed.data.summary,
          isStanding: parsed.data.isStanding,
        },
      );

      return jsonResult(call.id, {
        updated: true,
        memoryId: updated.id,
        key: updated.key,
        version: updated.version,
        isStanding: updated.isStanding,
      });
    } catch (err) {
      if (err instanceof MemoryConcurrencyError) {
        return textResult(
          call.id,
          false,
          `Concurrency error: expected version ${err.expectedVersion}, but actual version is ${err.actualVersion}. Please re-read the memory item before updating.`,
        );
      }
      throw err;
    }
  }

  private async forgetMemory(call: ToolCall): Promise<ToolResult> {
    const parsed = forgetMemoryInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const deleted = await this.memoryService.forgetMemory(
      this.userId,
      parsed.data.memoryId,
      parsed.data.expectedVersion,
    );

    if (!deleted) {
      return textResult(
        call.id,
        false,
        `Could not forget memory with id "${parsed.data.memoryId}": item not found or version mismatch.`,
      );
    }

    return jsonResult(call.id, {
      forgotten: true,
      memoryId: parsed.data.memoryId,
      message: 'Memory removed from active storage. Original chat messages remain intact.',
    });
  }
}
