/**
 * The memory tools (ADR-0047): memory_list, memory_read, memory_write, memory_append,
 * memory_str_replace and memory_delete, over the chat's store (the project's own inside a
 * project, the user's otherwise). Every change is made against the version the model last read,
 * and a conflict hands back the current file so it can merge and retry in the same turn.
 *
 * Invariant 1: bad inputs or errors return explicit ToolResults (never throw).
 */
import { z } from 'zod';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import { MEMORY_FILE_MAX_BYTES, type MemoryFile, type MemoryService, type MemoryWriteResult } from '../services/memory/memoryService.js';

const listInput = z.object({
  path_prefix: z.string().nullish(),
  include_preview: z.boolean().optional(),
  cursor: z.string().nullish(),
});
const readInput = z.object({ path: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(20)]) });
const writeInput = z.object({ path: z.string().min(1), content: z.string(), if_version: z.string().min(1) });
const replaceInput = z.object({
  path: z.string().min(1),
  old_str: z.string().min(1),
  new_str: z.string(),
  if_version: z.string().min(1),
});
const deleteInput = z.object({ path: z.string().min(1), if_version: z.string().min(1) });

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown, ok = true): ToolResult {
  return { toolCallId, ok, content: [{ type: 'json', data }] };
}

/** A file's size against its cap, with a note once it is close (ADR-0052: reads report free space,
 *  writes the new size, and a note tells the model to consolidate before the cap refuses a write).
 *  85% is our threshold: it leaves room for a few more lines before a write is refused. */
export function sizeReport(sizeBytes: number): { sizeBytes: number; capBytes: number; freeBytes: number; note?: string } {
  return {
    sizeBytes,
    capBytes: MEMORY_FILE_MAX_BYTES,
    freeBytes: Math.max(0, MEMORY_FILE_MAX_BYTES - sizeBytes),
    ...(sizeBytes >= MEMORY_FILE_MAX_BYTES * 0.85
      ? { note: 'This file is close to its size cap: consolidate it (merge overlapping lines, drop stale detail, or move a grown topic to its own file).' }
      : {}),
  };
}

function withSize(file: MemoryFile): MemoryFile & ReturnType<typeof sizeReport> {
  return { ...file, ...sizeReport(file.sizeBytes) };
}

function writeResult(toolCallId: string, res: MemoryWriteResult): ToolResult {
  if (res.ok) {
    return jsonResult(
      toolCallId,
      res.file ? { path: res.file.path, version: res.file.version, ...sizeReport(res.file.sizeBytes) } : { deleted: true },
    );
  }
  return jsonResult(toolCallId, { error: res.error, ...(res.current ? { current: res.current } : {}) }, false);
}

export class MemoryToolExecutor implements ToolExecutor {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly userId: string,
    private readonly projectId: string | null = null,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) return textResult(call.id, false, 'The request was aborted before this tool ran.');
    const m = this.memoryService;
    const [u, p] = [this.userId, this.projectId];
    try {
      switch (call.name) {
        case 'memory_list': {
          const x = listInput.safeParse(call.input ?? {});
          if (!x.success) return textResult(call.id, false, `Invalid input: ${x.error.message}`);
          const res = await m.listFiles(u, p, {
            pathPrefix: x.data.path_prefix ?? undefined,
            cursor: x.data.cursor ?? undefined,
          });
          return jsonResult(call.id, {
            files: res.files.map(({ description, ...f }) => (x.data.include_preview ? { ...f, preview: description } : f)),
            nextCursor: res.nextCursor,
          });
        }
        case 'memory_read': {
          const x = readInput.safeParse(call.input);
          if (!x.success) return textResult(call.id, false, `Invalid input: ${x.error.message}`);
          const paths = typeof x.data.path === 'string' ? [x.data.path] : x.data.path;
          const files = await Promise.all(
            paths.map(async (path) => {
              const file = await m.readFile(u, p, path);
              return file ? withSize(file) : { path, error: `${path} does not exist.` };
            }),
          );
          return jsonResult(call.id, { files }, files.some((f) => !('error' in f)));
        }
        case 'memory_write': {
          const x = writeInput.safeParse(call.input);
          if (!x.success) return textResult(call.id, false, `Invalid input: ${x.error.message}`);
          return writeResult(call.id, await m.writeFile(u, p, x.data.path, x.data.content, x.data.if_version));
        }
        case 'memory_append': {
          const x = writeInput.safeParse(call.input);
          if (!x.success) return textResult(call.id, false, `Invalid input: ${x.error.message}`);
          return writeResult(call.id, await m.appendFile(u, p, x.data.path, x.data.content, x.data.if_version));
        }
        case 'memory_str_replace': {
          const x = replaceInput.safeParse(call.input);
          if (!x.success) return textResult(call.id, false, `Invalid input: ${x.error.message}`);
          return writeResult(
            call.id,
            await m.strReplaceFile(u, p, x.data.path, x.data.old_str, x.data.new_str, x.data.if_version),
          );
        }
        case 'memory_delete': {
          const x = deleteInput.safeParse(call.input);
          if (!x.success) return textResult(call.id, false, `Invalid input: ${x.error.message}`);
          return writeResult(call.id, await m.deleteFile(u, p, x.data.path, x.data.if_version));
        }
        default:
          return textResult(call.id, false, `Unknown tool "${call.name}".`);
      }
    } catch (err) {
      return textResult(call.id, false, `${call.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
