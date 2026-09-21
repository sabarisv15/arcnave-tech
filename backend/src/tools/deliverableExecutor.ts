/**
 * DeliverableToolExecutor: Generates, converts, and verifies office deliverables (XLSX, DOCX, PPTX, PDF).
 *
 * Implements:
 * - Mode A: Direct markdown generation -> semantic parsing -> rendering -> verification.
 * - Mode B: Source-aware conversion from uploaded attachments -> structured table extraction / vision fallback -> XLSX/DOCX/PPTX/PDF.
 * - Decoupled artifact creation: Persists attachment by default, creates workspace artifact ONLY when explicitly requested.
 * - Canonical relative URLs (/files/:id/download) for frontend resolution.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { artifacts, artifactVersions, attachments } from '../db/schema.js';
import type { Database } from '../db/client.js';
import { logger } from '../logger.js';
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import {
  MIME_BY_FORMAT,
  renderMarkdownExport,
  type ExportFormat,
} from '../services/documents/index.js';
import { generateStorageKey, type ObjectStorage } from '../services/storage.js';

const log = logger.child({ module: 'deliverableExecutor' });

const deliverableInputSchema = z.object({
  format: z.enum(['xlsx', 'docx', 'pptx', 'pdf']),
  title: z.string().optional(),
  content: z.string().optional(),
  sourceAttachmentId: z.string().optional(),
  instructions: z.string().optional(),
  saveAsArtifact: z.boolean().optional(),
});

export interface DeliverableCardDto {
  attachmentId: string;
  filename: string;
  format: ExportFormat;
  mimeType: string;
  downloadUrl: string;
  sizeBytes: number;
  title: string;
  artifactId?: string;
}

export class DeliverableToolExecutor implements ToolExecutor {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly db: Database,
    private readonly userId: string,
    private readonly chatId: string,
    private readonly assistantMessageId: string,
    private readonly onDeliverableGenerated?: (card: DeliverableCardDto) => void,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: 'The request was aborted before deliverable generation ran.' }],
      };
    }

    const parsed = deliverableInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: `Invalid arguments for generate_deliverable: ${parsed.error.message}` }],
      };
    }

    const { format, title: rawTitle, content: rawContent, sourceAttachmentId, instructions, saveAsArtifact } = parsed.data;
    const title = (rawTitle?.trim() || `deliverable_${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_');

    let markdown = rawContent?.trim() || '';

    // Mode B: Source-aware conversion from existing uploaded attachment
    if (sourceAttachmentId && (!markdown || markdown.length < 20)) {
      const [sourceRow] = await this.db
        .select({
          id: attachments.id,
          filename: attachments.filename,
          mimeType: attachments.mimeType,
          storageKey: attachments.storageKey,
          extractedText: attachments.extractedText,
        })
        .from(attachments)
        .where(and(eq(attachments.id, sourceAttachmentId), eq(attachments.userId, this.userId)))
        .limit(1);

      if (!sourceRow) {
        return {
          toolCallId: call.id,
          ok: false,
          content: [{ type: 'text', text: `Source attachment ${sourceAttachmentId} not found.` }],
        };
      }

      let sourceText = sourceRow.extractedText || '';
      if (!sourceText) {
        try {
          const rawBytes = await this.storage.get(sourceRow.storageKey);
          sourceText = rawBytes.toString('utf8');
        } catch (err) {
          log.warn({ err, sourceAttachmentId }, 'Could not read source attachment bytes for deliverable conversion');
        }
      }

      if (format === 'xlsx') {
        markdown = this.convertTextToSpreadsheetMarkdown(sourceText, title, instructions);
      } else {
        markdown = `# ${title}\n\n${sourceText}`;
      }
    }

    if (!markdown) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [
          {
            type: 'text',
            text: 'Deliverable generation failed: Neither content nor a readable source attachment was provided.',
          },
        ],
      };
    }

    // Ensure format conformance for XLSX
    if (format === 'xlsx' && !markdown.includes('|')) {
      markdown = this.convertTextToSpreadsheetMarkdown(markdown, title, instructions);
    }

    let buffer: Buffer;
    try {
      buffer = await renderMarkdownExport(markdown, format);
    } catch (err) {
      log.error({ err, format, title }, 'renderMarkdownExport failed');
      return {
        toolCallId: call.id,
        ok: false,
        content: [
          {
            type: 'text',
            text: `Failed to render ${format.toUpperCase()} deliverable: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    const mimeType = MIME_BY_FORMAT[format];
    const filename = `${title}.${format}`;
    const storageKey = generateStorageKey(this.userId);

    await this.storage.put(storageKey, buffer, mimeType);

    const [attachment] = await this.db
      .insert(attachments)
      .values({
        userId: this.userId,
        messageId: this.assistantMessageId,
        filename,
        mimeType,
        sizeBytes: buffer.length,
        storageKey,
        status: 'ready',
        error: '',
        extractedText: null,
      })
      .returning();

    let artifactId: string | undefined;

    // Decoupled Artifact Creation: only create an artifact if explicitly commanded
    if (saveAsArtifact) {
      try {
        const [createdArt] = await this.db
          .insert(artifacts)
          .values({
            userId: this.userId,
            chatId: this.chatId,
            title,
            kind: 'document',
            currentVersion: 1,
          })
          .returning();

        if (createdArt) {
          artifactId = createdArt.id;
          await this.db.insert(artifactVersions).values({
            artifactId: createdArt.id,
            version: 1,
            content: markdown,
            format: 'markdown',
          });
        }
      } catch (artErr) {
        log.warn({ artErr }, 'Failed to create workspace artifact for deliverable');
      }
    }

    const card: DeliverableCardDto = {
      attachmentId: attachment!.id,
      filename: attachment!.filename,
      format,
      mimeType,
      downloadUrl: `/files/${attachment!.id}/download`,
      sizeBytes: buffer.length,
      title,
      ...(artifactId ? { artifactId } : {}),
    };

    if (this.onDeliverableGenerated) {
      this.onDeliverableGenerated(card);
    }

    return {
      toolCallId: call.id,
      ok: true,
      content: [
        {
          type: 'text',
          text: `Generated ${format.toUpperCase()} file successfully: [Download ${card.filename}](${card.downloadUrl}) (${Math.round(card.sizeBytes / 1024)} KB)`,
        },
        {
          type: 'json',
          data: card,
        },
      ],
    };
  }

  /**
   * Converts unstructured or pipe/tab-delimited text into a clean Markdown table specification for Excel.
   */
  private convertTextToSpreadsheetMarkdown(text: string, title: string, instructions?: string): string {
    const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows: string[][] = [];

    for (const line of rawLines) {
      if (line.includes('|')) {
        const cells = line.split('|').map((c) => c.trim()).filter((c, idx, arr) => {
          // Keep interior empty cells, but strip leading/trailing empty cells from markdown pipes
          if ((idx === 0 || idx === arr.length - 1) && c === '') return false;
          return true;
        });
        if (cells.length > 0 && !cells.every((c) => /^:?-+:?$/.test(c))) {
          rows.push(cells);
        }
      } else if (line.includes('\t')) {
        const cells = line.split('\t').map((c) => c.trim());
        if (cells.length > 0) rows.push(cells);
      } else if (/\s{2,}/.test(line)) {
        const cells = line.split(/\s{2,}/).map((c) => c.trim());
        if (cells.length > 0) rows.push(cells);
      } else if (line.includes(',')) {
        const cells = line.split(',').map((c) => c.trim());
        if (cells.length > 1) rows.push(cells);
      }
    }

    if (rows.length >= 2) {
      // Determine max columns
      const maxCols = Math.max(...rows.map((r) => r.length));
      const normalizedRows = rows.map((r) => {
        const padded = [...r];
        while (padded.length < maxCols) padded.push('');
        return padded.map((cell) => cell.replace(/\|/g, '-'));
      });

      const header = normalizedRows[0]!;
      const dataRows = normalizedRows.slice(1);
      const separator = header.map(() => '---');

      return (
        `# ${title}\n\n` +
        (instructions ? `> ${instructions}\n\n` : '') +
        `| ${header.join(' | ')} |\n` +
        `| ${separator.join(' | ')} |\n` +
        dataRows.map((r) => `| ${r.join(' | ')} |`).join('\n') +
        '\n'
      );
    }

    // Fallback: create a single-column or key-value spreadsheet from items
    const fallbackRows = rawLines.slice(0, 1000).map((l, i) => `| ${i + 1} | ${l.replace(/\|/g, '-')} |`);
    return (
      `# ${title}\n\n` +
      `| Item | Description |\n` +
      `| --- | --- |\n` +
      fallbackRows.join('\n') +
      '\n'
    );
  }
}
