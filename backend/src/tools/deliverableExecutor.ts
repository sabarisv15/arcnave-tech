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
  renderStructuredSpreadsheet,
  type ExportFormat,
} from '../services/documents/index.js';
import { StructuredWorkbookSchema } from '../services/documents/structuredWorkbook.js';
import { deliverableValidator, type SemanticExpectations } from '../services/qa/deliverableValidator.js';
import { generateStorageKey, type ObjectStorage } from '../services/storage.js';
import { readWorkspaceArtifact } from './execution/workspaceArtifacts.js';

const log = logger.child({ module: 'deliverableExecutor' });

const deliverableInputSchema = z.object({
  format: z.enum(['xlsx', 'docx', 'pptx', 'pdf']),
  title: z.string().optional(),
  content: z.string().optional(),
  sourceAttachmentId: z.string().optional(),
  instructions: z.string().optional(),
  workbook: z.record(z.string(), z.unknown()).optional(),
  artifactRef: z.string().optional(),
  sourceProfile: z.record(z.string(), z.unknown()).optional(),
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

import type { ExecutionRuntime, WorkspaceFiles } from './execution/executionRuntime.js';

export class DeliverableToolExecutor implements ToolExecutor {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly db: Database,
    private readonly userId: string,
    private readonly chatId: string,
    private readonly assistantMessageId: string,
    private readonly onDeliverableGenerated?: (card: DeliverableCardDto) => void,
    private readonly runtime?: ExecutionRuntime,
    private readonly workspace?: WorkspaceFiles,
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

    // Reject raw binary files passed directly as content
    if (rawContent) {
      if (
        rawContent.startsWith('%PDF-') ||
        rawContent.startsWith('PK\x03\x04') ||
        /[\x00-\x08\x0E-\x1F]/.test(rawContent.slice(0, 100))
      ) {
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            {
              type: 'text',
              text: 'Deliverable generation rejected: raw binary data cannot be passed directly as content. Please provide structured data or markdown.',
            },
          ],
        };
      }
    }

    // Resolve intermediate artifact if artifactRef is provided
    let resolvedWorkbook = parsed.data.workbook;
    if (parsed.data.artifactRef && this.workspace) {
      try {
        const rawArtifact = await readWorkspaceArtifact(this.workspace, parsed.data.artifactRef);
        resolvedWorkbook = JSON.parse(rawArtifact.toString('utf8'));
      } catch (err: any) {
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            {
              type: 'text',
              text: `Failed to resolve intermediate artifact "${parsed.data.artifactRef}": ${err.message}`,
            },
          ],
        };
      }
    }

    let buffer: Buffer;
    let validationSummary = rawContent?.trim() || '';

    // Branch A: Structured Workbook rendering for XLSX
    if (format === 'xlsx' && resolvedWorkbook) {
      const parsedWb = StructuredWorkbookSchema.safeParse(resolvedWorkbook);
      if (!parsedWb.success) {
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            {
              type: 'text',
              text: `Invalid structured workbook for XLSX: ${parsedWb.error.message}`,
            },
          ],
        };
      }

      try {
        buffer = await renderStructuredSpreadsheet(parsedWb.data);
        const totalRows = parsedWb.data.sheets.reduce((acc, s) => acc + s.rows.length, 0);
        validationSummary = `Structured spreadsheet with ${parsedWb.data.sheets.length} sheets and ${totalRows} rows.`;
      } catch (err) {
        log.error({ err, format, title }, 'renderStructuredSpreadsheet failed');
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            {
              type: 'text',
              text: `Failed to render structured spreadsheet: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    } else {
      // Branch B: Markdown rendering or Mode B source attachment extraction
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

        // Only a text file's text is copied. A PDF's, an image's or an Office file's extracted
        // text has lost its layout: split on spaces and commas it made a sheet that looked like a
        // conversion and was not one (audit D1). The model reads those files and passes rows.
        const textLike =
          sourceRow.mimeType.startsWith('text/') ||
          sourceRow.mimeType === 'application/csv' ||
          sourceRow.mimeType === 'application/json';
        if (!textLike) {
          return {
            toolCallId: call.id,
            ok: false,
            content: [
              {
                type: 'text',
                text:
                  `"${sourceRow.filename}" is not a text file, so it cannot be copied as it is. Read it (its pages, ` +
                  'read_uploaded_file, or run_python), apply the user\'s instructions, and pass what you extracted: ' +
                  `${format === 'xlsx' ? 'typed rows as "workbook"' : 'the content as "content"'}.`,
              },
            ],
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
              text: 'Deliverable generation failed: Neither content, workbook, nor a readable source attachment was provided.',
            },
          ],
        };
      }

      // Ensure format conformance for XLSX
      if (format === 'xlsx' && !markdown.includes('|')) {
        markdown = this.convertTextToSpreadsheetMarkdown(markdown, title, instructions);
      }

      validationSummary = markdown;

      try {
        if (this.runtime) {
          const rendered = await this.runtime.renderDocument(markdown, format, this.workspace);
          buffer = rendered.buffer;
        } else {
          buffer = await renderMarkdownExport(markdown, format);
        }
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
    }

    // Extract semantic expectations from structured workbook or markdown table
    let expectations: SemanticExpectations | undefined;
    if (format === 'xlsx' && resolvedWorkbook) {
      const parsedWb = StructuredWorkbookSchema.safeParse(resolvedWorkbook);
      if (parsedWb.success) {
        const totalRows = parsedWb.data.sheets.reduce((acc, s) => acc + s.rows.length, 0);
        expectations = {
          expectedMinSheets: parsedWb.data.sheets.length,
          expectedMinRows: totalRows,
          expectedHeaders: parsedWb.data.sheets[0]?.columns.map((c) => c.label),
        };
      }
    } else if (rawContent) {
      const lines = rawContent.split('\n').filter((l) => l.includes('|'));
      if (lines.length >= 2) {
        const headerCols = lines[0]?.split('|').map((c) => c.trim()).filter(Boolean);
        const dataRowsCount = lines.filter((l) => !l.includes('---')).length - 1;
        if (dataRowsCount > 0) {
          expectations = {
            expectedHeaders: headerCols,
            expectedMinRows: dataRowsCount,
          };
        }
      }
    }

    // 3-Level QA Validation
    const qaReport = await deliverableValidator.validate(buffer, format, validationSummary, expectations);
    if (!qaReport.passed) {
      log.warn({ qaReport, format, title }, 'Deliverable QA validation failed');
      return {
        toolCallId: call.id,
        ok: false,
        content: [
          {
            type: 'text',
            text: `Deliverable QA failed (${qaReport.recommendation}):\n${qaReport.diagnostics.join('\n')}\n\nPlease inspect the above QA diagnostics, self-repair the structured data or formatting, and retry.`,
          },
          {
            type: 'json',
            data: { qaReport },
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
            content: validationSummary,
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
          text: `Generated ${format.toUpperCase()} file successfully: [Download ${card.filename}](${card.downloadUrl}) (${Math.round(card.sizeBytes / 1024)} KB). QA Status: Passed (score ${qaReport.overallScore}).`,
        },
        {
          type: 'json',
          data: {
            ...card,
            fileRef: card.downloadUrl,
            qaReport,
            sourceProfile: parsed.data.sourceProfile,
          },
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
