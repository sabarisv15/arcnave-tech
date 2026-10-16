/**
 * Executes the tools a provider is allowed to call for one request.
 *
 * Scoped to a single project: constructed fresh per generate call, never shared across
 * requests. Every branch returns a `ToolResult` — it never throws — because a bad tool name or a
 * bad input is something the *model* needs to see and react to (Invariant 1). `read_project_file`
 * enforces `readMaxChars` server-side regardless of what the model asks for, so an oversized
 * document is never handed over whole.
 *
 * `read_project_file`'s cursor is a character offset into the file's chunks concatenated in
 * `ordinal` order, not a chunk ordinal. A single stored chunk can be, and in production usually
 * is, larger than the requested (or configured) page size — `CHUNK_TARGET_CHARS` in
 * `retrieval.ts` is 1400, comfortably bigger than a deliberately small `maxChars`. Paginating by
 * whole chunk would either hand back a chunk far past the hard cap, or — if truncated
 * mid-chunk — have nowhere honest to point `nextCursor` at, since the next chunk's ordinal skips
 * the untruncated remainder. A character offset has no such gap: every call returns a slice
 * bounded by the cap, and `nextCursor` always names the exact next character to resume from.
 *
 * Abort handling is honest about its limits: a single Postgres query issued through this
 * executor cannot be interrupted mid-flight by this code, so the signal is checked at entry
 * (refuse to start a new query) rather than claimed to cancel work already in flight.
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { fileChunks, projectFiles } from '../db/schema.js';
import { nameForModel } from '../providers/attachmentContent.js';
import type { ToolCall, ToolContent, ToolExecutor, ToolResult } from '../providers/types.js';
import type { Retriever } from '../services/retrieval.js';

const searchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
});

const readInput = z.object({
  fileId: z.string().uuid(),
  /** Character offset into the file's chunks concatenated in order, not a chunk ordinal. */
  cursor: z.number().int().min(0).optional(),
  maxChars: z.number().int().min(1).optional(),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown): ToolResult {
  return { toolCallId, ok: true, content: [{ type: 'json', data }] };
}

export class ProjectToolExecutor implements ToolExecutor {
  constructor(
    private readonly db: Database,
    private readonly retriever: Retriever,
    private readonly projectId: string,
    private readonly readMaxChars: number,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }
    switch (call.name) {
      case 'search_project_files':
        return this.searchProjectFiles(call);
      case 'read_project_file':
        return this.readProjectFile(call);
      default:
        return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }
  }

  private async searchProjectFiles(call: ToolCall): Promise<ToolResult> {
    const parsed = searchInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }
    const chunks = await this.retriever.search(
      this.db,
      this.projectId,
      parsed.data.query,
      parsed.data.limit ?? 5,
    );
    if (chunks.length === 0) {
      return textResult(call.id, true, 'No matching excerpts were found for that query.');
    }
    return jsonResult(call.id, {
      results: chunks.map((c) => ({
        fileId: c.fileId,
        // The uploader's name, written as every other place shows it to the model (ADR-0069).
        filename: nameForModel(c.filename),
        page: c.page,
        score: c.score,
        text: c.text,
      })),
    });
  }

  private async readProjectFile(call: ToolCall): Promise<ToolResult> {
    const parsed = readInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const rows = await this.db
      .select({ text: fileChunks.text, filename: projectFiles.filename })
      .from(fileChunks)
      .innerJoin(projectFiles, eq(fileChunks.projectFileId, projectFiles.id))
      .where(
        and(eq(fileChunks.projectFileId, parsed.data.fileId), eq(fileChunks.projectId, this.projectId)),
      )
      .orderBy(asc(fileChunks.ordinal));

    if (rows.length === 0) {
      return textResult(
        call.id,
        false,
        `No indexed file with id "${parsed.data.fileId}" exists in this project.`,
      );
    }

    const fullText = rows.map((r) => r.text).join('\n\n');
    const cursor = parsed.data.cursor ?? 0;
    const budget = Math.min(parsed.data.maxChars ?? this.readMaxChars, this.readMaxChars);
    const content = fullText.slice(cursor, cursor + budget);
    const truncated = cursor + content.length < fullText.length;

    return jsonResult(call.id, {
      filename: nameForModel(rows[0]!.filename),
      content,
      truncated,
      nextCursor: truncated ? cursor + content.length : null,
    });
  }
}
