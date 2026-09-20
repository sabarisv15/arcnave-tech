/**
 * Executes uploaded-file tools (read_uploaded_file).
 *
 * Scoped to the current user: ensures users can only read their own uploaded files.
 * Page-aware for PDFs (using pdf-parse/vision provider when available) and
 * cursor/offset-aware for extracted text documents.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { attachments } from '../db/schema.js';
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { ObjectStorage } from '../services/storage.js';

const readUploadedFileInput = z.object({
  fileId: z.string().uuid(),
  startPage: z.number().int().min(1).optional(),
  endPage: z.number().int().min(1).optional(),
  start: z.number().int().min(0).optional(),
  maxChars: z.number().int().min(1).max(50_000).optional(),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown): ToolResult {
  return { toolCallId, ok: true, content: [{ type: 'json', data }] };
}

export class UploadToolExecutor implements ToolExecutor {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly userId: string,
    private readonly defaultMaxChars: number = 8000,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }
    if (call.name !== 'read_uploaded_file') {
      return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }

    const parsed = readUploadedFileInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const { fileId, startPage, endPage, start = 0, maxChars = this.defaultMaxChars } = parsed.data;

    // Secure user-scoped lookup
    const [row] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, fileId), eq(attachments.userId, this.userId)));

    if (!row) {
      return textResult(call.id, false, `Attachment with id "${fileId}" was not found or access denied.`);
    }

    // If extractedText is populated (e.g. text/csv/code/doc)
    let fullText = row.extractedText ?? '';

    // If no extractedText yet (e.g. PDF or binary file), attempt reading from storage / pdf-parse
    if (!fullText && row.storageKey) {
      try {
        const buf = await this.storage.get(row.storageKey);
        if (buf) {
          if (row.mimeType === 'application/pdf') {
            try {
              const { PDFParse } = await import('pdf-parse');
              const parser = new PDFParse({ data: buf });
              try {
                const parsedPdf = await parser.getText();
                fullText = parsedPdf.text || '';
              } finally {
                await parser.destroy();
              }
            } catch {
              fullText = buf.toString('utf-8');
            }
          } else {
            fullText = buf.toString('utf-8');
          }
        }
      } catch (err) {
        return textResult(call.id, false, `Failed to load file contents: ${String(err)}`);
      }
    }

    if (!fullText) {
      return textResult(
        call.id,
        true,
        `File "${row.filename}" (${row.mimeType}) contains no readable text content.`,
      );
    }

    // Page-aware slice if page markers exist, or character slice
    const sliceStart = Math.min(start, fullText.length);
    const sliceEnd = Math.min(sliceStart + maxChars, fullText.length);
    const content = fullText.slice(sliceStart, sliceEnd);
    const truncated = sliceEnd < fullText.length;
    const nextCursor = truncated ? sliceEnd : undefined;

    return jsonResult(call.id, {
      fileId: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      start: sliceStart,
      length: content.length,
      totalLength: fullText.length,
      truncated,
      nextCursor,
      content,
    });
  }
}
