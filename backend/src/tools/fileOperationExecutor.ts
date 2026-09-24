/**
 * FileOperationExecutor: Model-facing dispatch adapter for core file operations.
 *
 * Implements Batch 4 of the ArcNave Target Architecture:
 * - Bridges model tool calls (PDF, XLSX, DOCX, PPTX) to pre-compiled Skill-owned file operations.
 * - Enforces user authorization via Database attachment ownership lookup.
 * - Utilizes ExecutionRuntime for isolated workspace lifecycle and safe OOXML/storage persistence.
 * - Inspection operations return pure JSON metadata without writing files or persisting attachments.
 * - Mutation operations write sanitized output files and return download links and JSON metadata.
 * - Never leaks local workspace or host container paths to the model.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { attachments } from '../db/schema.js';
import { logger } from '../logger.js';
import type { Provider, ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { ObjectStorage } from '../services/storage.js';
import {
  inspectPdf,
  mergePdfFiles,
  mergePdfFilesWithReport,
  splitPdfFile,
  splitPdfFileWithReport,
} from '../services/skills/fileOperations/pdf.js';
import {
  combineWorkbooks,
  combineWorkbooksWithReport,
  editSpreadsheetCells,
  editSpreadsheetCellsWithReport,
  inspectSpreadsheet,
} from '../services/skills/fileOperations/xlsx.js';
import {
  appendDocxSection,
  appendDocxSectionWithReport,
  editDocxContent,
  editDocxContentWithReport,
  inspectDocxStructure,
} from '../services/skills/fileOperations/docx.js';
import {
  editPptxSlideText,
  editPptxSlideTextWithReport,
  inspectPptxStructure,
  reorderPptxSlides,
  reorderPptxSlidesWithReport,
} from '../services/skills/fileOperations/pptx.js';
import { verifyPdf } from '../services/documents/verify/pdfVerify.js';
import { verifyXlsx } from '../services/documents/verify/xlsxVerify.js';
import { verifyDocx } from '../services/documents/verify/docxVerify.js';
import { verifyPptx } from '../services/documents/verify/pptxVerify.js';
import {
  overallQaStatus,
  visualQaEngine,
  type OverallQaStatus,
  type VisualQaStatus,
} from '../services/qa/visualQaEngine.js';
import type { CommonOperationResult, DeliverableWarning } from '../services/documents/primitives.js';
import type {
  ExecutionRuntime,
  PersistedOutputFile,
  WorkspaceFiles,
} from './execution/executionRuntime.js';

const log = logger.child({ module: 'fileOperationExecutor' });

export interface FileOperationExecutorOptions {
  db: Database;
  storage: ObjectStorage;
  executionRuntime: ExecutionRuntime;
  userId: string;
  chatId: string;
  messageId: string;
  workspace?: WorkspaceFiles;
  /** Looks at rendered pages for visual QA (G14). Without it the visual layer is `not_checked`. */
  visionProvider?: Provider;
}

/* -------------------------------------------------------------------------- Zod Schemas */

const inspectFileInputSchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
});

const mergePdfFilesInputSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(2, 'At least 2 fileIds are required to merge'),
  outputFilename: z.string().optional(),
});

const splitPdfFileInputSchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
  pageRanges: z
    .array(z.tuple([z.number().int().min(1), z.number().int().min(1)]))
    .min(1, 'At least 1 page range is required'),
  outputFilename: z.string().optional(),
});

const editSpreadsheetCellsInputSchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
  edits: z
    .array(
      z.object({
        sheet: z.string().min(1, 'sheet name is required'),
        cell: z.string().min(1, 'cell coordinate is required'),
        value: z.unknown(),
        type: z.enum(['string', 'number', 'boolean', 'date', 'formula']).optional(),
        format: z.string().optional(),
      }),
    )
    .min(1, 'At least 1 cell edit is required'),
  outputFilename: z.string().optional(),
});

const combineWorkbooksInputSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(2, 'At least 2 fileIds are required to combine'),
  outputFilename: z.string().optional(),
});

const editDocxContentInputSchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
  replacements: z
    .array(
      z.object({
        search: z.string().min(1, 'search string is required'),
        replace: z.string(),
      }),
    )
    .min(1, 'At least 1 replacement is required'),
  outputFilename: z.string().optional(),
});

const appendDocxSectionInputSchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
  heading: z.string().min(1, 'heading is required'),
  paragraphs: z.array(z.string()).min(1, 'At least 1 paragraph is required'),
  outputFilename: z.string().optional(),
});

const reorderPptxSlidesInputSchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
  newOrder: z.array(z.number().int().min(1)).min(1, 'newOrder must contain at least 1 slide index'),
  outputFilename: z.string().optional(),
});

const editPptxSlideTextInputSchema = z.object({
  fileId: z.string().min(1, 'fileId is required'),
  slideIndex: z.number().int().min(1, 'slideIndex must be a positive integer'),
  replacements: z
    .array(
      z.object({
        search: z.string().min(1, 'search string is required'),
        replace: z.string(),
      }),
    )
    .min(1, 'At least 1 replacement is required'),
  outputFilename: z.string().optional(),
});

/* -------------------------------------------------------------------------- Helpers */

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function sanitizeFilename(
  rawName: string | undefined,
  fallbackBase: string,
  expectedExt: string,
): string {
  const normExt = expectedExt.startsWith('.') ? expectedExt.toLowerCase() : `.${expectedExt.toLowerCase()}`;
  if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
    return `${fallbackBase}${normExt}`;
  }

  // Path traversal and slash checks
  if (rawName.includes('..') || rawName.includes('/') || rawName.includes('\\') || rawName.includes('\0')) {
    const base = path.basename(rawName).replace(/[/\\?%*:|"<>]/g, '_');
    return sanitizeFilename(base, fallbackBase, expectedExt);
  }

  const base = path.basename(rawName).trim();
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  if (!clean || clean === normExt) {
    return `${fallbackBase}${normExt}`;
  }

  if (clean.toLowerCase().endsWith(normExt)) {
    return clean;
  }
  return `${clean}${normExt}`;
}

export class FileOperationExecutor implements ToolExecutor {
  private readonly db: Database;
  private readonly storage: ObjectStorage;
  private readonly executionRuntime: ExecutionRuntime;
  private readonly userId: string;
  private readonly chatId: string;
  private readonly messageId: string;
  private readonly workspace?: WorkspaceFiles;
  private readonly visionProvider?: Provider;

  constructor(options: FileOperationExecutorOptions) {
    this.db = options.db;
    this.storage = options.storage;
    this.executionRuntime = options.executionRuntime;
    this.userId = options.userId;
    this.chatId = options.chatId;
    this.messageId = options.messageId;
    this.workspace = options.workspace;
    this.visionProvider = options.visionProvider;
  }

  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }

    try {
      switch (call.name) {
        // PDF Operations
        case 'inspectPdf':
          return await this.handleInspectPdf(call);
        case 'mergePdfFiles':
          return await this.handleMergePdfFiles(call);
        case 'splitPdfFile':
          return await this.handleSplitPdfFile(call);

        // XLSX Operations
        case 'inspectSpreadsheet':
          return await this.handleInspectSpreadsheet(call);
        case 'editSpreadsheetCells':
          return await this.handleEditSpreadsheetCells(call);
        case 'combineWorkbooks':
          return await this.handleCombineWorkbooks(call);

        // DOCX Operations
        case 'inspectDocxStructure':
          return await this.handleInspectDocxStructure(call);
        case 'editDocxContent':
          return await this.handleEditDocxContent(call);
        case 'appendDocxSection':
          return await this.handleAppendDocxSection(call);

        // PPTX Operations
        case 'inspectPptxStructure':
          return await this.handleInspectPptxStructure(call);
        case 'reorderPptxSlides':
          return await this.handleReorderPptxSlides(call);
        case 'editPptxSlideText':
          return await this.handleEditPptxSlideText(call);

        default:
          return textResult(call.id, false, `Unknown file operation tool "${call.name}".`);
      }
    } catch (err: unknown) {
      log.error({ err, tool: call.name, input: call.input }, 'File operation execution failed');
      const message = err instanceof Error ? err.message : String(err);
      return textResult(call.id, false, `Error executing ${call.name}: ${message}`);
    }
  }

  private async runInWorkspace<T>(name: string, fn: (ws: WorkspaceFiles) => Promise<T>): Promise<T> {
    if (this.workspace) {
      return await fn(this.workspace);
    }
    const runId = `fileop_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return await this.executionRuntime.withWorkspace(runId, fn);
  }

  private async runPostMutationQa(
    format: 'pdf' | 'xlsx' | 'docx' | 'pptx',
    buffer: Buffer,
    ws: WorkspaceFiles,
    options?: {
      semanticWarnings?: DeliverableWarning[];
      semanticMetrics?: Record<string, unknown>;
      selectedSheet?: string;
      selectedSlides?: number[];
    },
  ): Promise<{
    structPassed: boolean;
    structErrors: string[];
    structural: { passed: boolean; errors: string[]; warnings?: string[]; metrics?: Record<string, unknown> };
    semantic: { passed: boolean; warnings: DeliverableWarning[]; metrics?: Record<string, unknown> };
    visual: { status: VisualQaStatus; passed: boolean; defects: any[]; previewAvailable: boolean; inspectedPages?: number; inspectedSlides?: number; inspectedSheets?: number; diagnostics?: string[] };
    /** Derived from the three layers; a document's layout always needs a visual check. */
    overall: OverallQaStatus;
    warnings: DeliverableWarning[];
    repairable: boolean;
  }> {
    // 1. Structural Verification
    let structOk = true;
    let structErrors: string[] = [];
    let structWarnings: string[] = [];
    let structMetrics: Record<string, unknown> | undefined;

    if (format === 'pdf') {
      const res = await verifyPdf(buffer);
      structOk = res.ok;
      structErrors = res.errors;
      structWarnings = res.warnings;
      structMetrics = res.metrics;
    } else if (format === 'xlsx') {
      const res = await verifyXlsx(buffer);
      structOk = res.ok;
      structErrors = res.errors;
      structWarnings = res.warnings;
      structMetrics = res.metrics;
    } else if (format === 'docx') {
      const res = await verifyDocx(buffer);
      structOk = res.ok;
      structErrors = res.errors;
      structWarnings = res.warnings;
      structMetrics = res.metrics;
    } else if (format === 'pptx') {
      const res = await verifyPptx(buffer);
      structOk = res.ok;
      structErrors = res.errors;
      structWarnings = res.warnings;
      structMetrics = res.metrics;
    }

    // 2. Visual QA
    const visualReport = await visualQaEngine.evaluateVisualQa({
      buffer,
      format,
      runtime: this.executionRuntime,
      workspace: ws,
      selectedSheet: options?.selectedSheet,
      selectedSlides: options?.selectedSlides,
      visionProvider: this.visionProvider,
    });

    const semanticWarnings = options?.semanticWarnings ?? [];
    const visualWarnings: DeliverableWarning[] = visualReport.defects.map((d) => ({
      severity: d.severity === 'critical' ? 'error' : 'warning',
      type: d.type,
      message: d.description,
      repairable: d.repairable,
    }));

    const structuralWarningObjects: DeliverableWarning[] = structWarnings.map((w) => ({
      severity: 'warning',
      type: 'structural_warning',
      message: w,
      repairable: true,
    }));

    const allWarnings = [...structuralWarningObjects, ...semanticWarnings, ...visualWarnings];
    const repairable = allWarnings.some((w) => w.repairable !== false);

    return {
      structPassed: structOk,
      structErrors,
      structural: {
        passed: structOk,
        errors: structErrors,
        warnings: structWarnings.length > 0 ? structWarnings : undefined,
        metrics: structMetrics,
      },
      semantic: {
        passed: semanticWarnings.length === 0,
        warnings: semanticWarnings,
        metrics: options?.semanticMetrics,
      },
      visual: {
        status: visualReport.status,
        passed: visualReport.passed,
        defects: visualReport.defects,
        previewAvailable: visualReport.previewAvailable,
        inspectedPages: visualReport.inspectedPages,
        inspectedSlides: visualReport.inspectedSlides,
        inspectedSheets: visualReport.inspectedSheets,
        diagnostics: visualReport.diagnostics,
      },
      overall: overallQaStatus({
        structuralPassed: structOk,
        semanticPassed: semanticWarnings.length === 0,
        visual: visualReport.status,
        visualRequired: true,
      }),
      warnings: allWarnings,
      repairable,
    };
  }

  private async resolveAttachmentId(rawId: string): Promise<string> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
    if (isUuid) {
      return rawId;
    }
    try {
      const rows = await this.db
        .select({ id: attachments.id, filename: attachments.filename })
        .from(attachments)
        .where(and(eq(attachments.userId, this.userId), eq(attachments.filename, rawId)));

      if (rows.length > 1) {
        const matchingIds = rows.map((r) => r.id).join(', ');
        throw new Error(
          `Ambiguous filename '${rawId}'. Multiple attachments match this name (${matchingIds}). Please invoke the tool using the specific fileId.`,
        );
      }
      if (rows.length === 1 && rows[0]) {
        return rows[0].id;
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Ambiguous filename')) {
        throw err;
      }
      // Fall through to rawId
    }
    return rawId;
  }

  /* -------------------------------------------------------------------------- PDF Handlers */

  private async handleInspectPdf(call: ToolCall): Promise<ToolResult> {
    const parsed = inspectFileInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('inspectPdf', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const inspection = await inspectPdf(buf);

      const titlePart = inspection.title ? `, Title: "${inspection.title}"` : '';
      const authorPart = inspection.author ? `, Author: "${inspection.author}"` : '';
      const summary = `PDF Inspection: ${inspection.pageCount} page(s)${titlePart}${authorPart}.`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status: 'success',
              operation: 'inspectPdf',
              fileId: parsed.data.fileId,
              inspection,
            },
          },
        ],
      };
    });
  }

  private async handleMergePdfFiles(call: ToolCall): Promise<ToolResult> {
    const parsed = mergePdfFilesInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileIds = await Promise.all(parsed.data.fileIds.map((id) => this.resolveAttachmentId(id)));
    return await this.runInWorkspace('mergePdfFiles', async (ws) => {
      const buffers: Buffer[] = [];
      let firstName = 'merged';

      for (const id of fileIds) {
        const mat = await this.executionRuntime.materializeAttachment(
          ws,
          id,
          this.userId,
          this.db,
          this.storage,
        );
        buffers.push(await fs.readFile(mat.path));
        if (firstName === 'merged') {
          firstName = path.basename(mat.filename, path.extname(mat.filename));
        }
      }

      const { buffer: mergedBuffer, actualPageCount } = await mergePdfFilesWithReport(buffers);

      const qa = await this.runPostMutationQa('pdf', mergedBuffer, ws, {
        semanticMetrics: { totalPages: actualPageCount, inputCount: buffers.length },
      });

      if (!qa.structPassed) {
        const errMsg = `Merged PDF failed structural verification: ${qa.structErrors.join('; ')}`;
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            { type: 'text', text: `Failed to merge PDFs: ${errMsg}` },
            {
              type: 'json',
              data: {
                status: 'failed',
                operation: 'mergePdfFiles',
                structural: qa.structural,
                semantic: qa.semantic,
                visual: qa.visual,
                overall: qa.overall,
                warnings: qa.warnings,
                repairable: true,
                error: errMsg,
              },
            },
          ],
        };
      }

      const safeFilename = sanitizeFilename(
        parsed.data.outputFilename,
        `${firstName}_merged`,
        '.pdf',
      );
      const outPath = path.join(ws.outputDir, safeFilename);
      await fs.writeFile(outPath, mergedBuffer);

      const persisted = await this.executionRuntime.persistOutputFiles(ws, {
        userId: this.userId,
        messageId: this.messageId,
        db: this.db,
        storage: this.storage,
      });

      const outFile = persisted.find((p) => p.filename === safeFilename) || persisted[0];
      if (!outFile) {
        throw new Error('Failed to persist merged PDF file.');
      }

      const status = qa.warnings.length > 0 ? 'warning' : 'success';
      const summary = `Merged ${parsed.data.fileIds.length} PDF files successfully: [Download ${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB).`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status,
              operation: 'mergePdfFiles',
              file: outFile,
              metrics: {
                inputFilesCount: parsed.data.fileIds.length,
                outputSizeBytes: outFile.sizeBytes,
                totalPages: actualPageCount,
              },
              structural: qa.structural,
              semantic: qa.semantic,
              visual: qa.visual,
              overall: qa.overall,
              warnings: qa.warnings,
              repairable: qa.repairable,
            },
          },
        ],
      };
    });
  }

  private async handleSplitPdfFile(call: ToolCall): Promise<ToolResult> {
    const parsed = splitPdfFileInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('splitPdfFile', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const baseName = path.basename(mat.filename, path.extname(mat.filename));

      const splitReport = await splitPdfFileWithReport(buf, parsed.data.pageRanges);

      // Verify each generated segment
      const allQaWarnings: DeliverableWarning[] = [];
      let allPassed = true;
      let primaryStruct: any = undefined;
      let primaryVisual: any = undefined;

      for (let i = 0; i < splitReport.buffers.length; i++) {
        const segBuffer = splitReport.buffers[i]!;
        const range = parsed.data.pageRanges[i]!;
        const pageCount = range[1] - range[0] + 1;
        const qa = await this.runPostMutationQa('pdf', segBuffer, ws, {
          semanticMetrics: { pageRange: range, pageCount },
        });
        if (!primaryStruct) primaryStruct = qa.structural;
        if (!primaryVisual) primaryVisual = qa.visual;
        allQaWarnings.push(...qa.warnings);
        if (!qa.structPassed) {
          allPassed = false;
          primaryStruct = qa.structural;
          break;
        }
      }

      if (!allPassed) {
        const errMsg = `Split PDF segment failed structural verification: ${primaryStruct?.errors?.join('; ') ?? 'corrupted segment'}`;
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            { type: 'text', text: `Failed to split PDF: ${errMsg}` },
            {
              type: 'json',
              data: {
                status: 'failed',
                operation: 'splitPdfFile',
                structural: primaryStruct,
                visual: primaryVisual,
                warnings: allQaWarnings,
                repairable: true,
                error: errMsg,
              },
            },
          ],
        };
      }

      for (let i = 0; i < splitReport.buffers.length; i++) {
        const segBuffer = splitReport.buffers[i]!;
        const range = parsed.data.pageRanges[i]!;
        const partSuffix = `p${range[0]}-${range[1]}`;
        const defaultName = `${baseName}_${partSuffix}`;
        const safeName = parsed.data.outputFilename && splitReport.buffers.length === 1
          ? sanitizeFilename(parsed.data.outputFilename, defaultName, '.pdf')
          : sanitizeFilename(
              parsed.data.outputFilename
                ? `${path.basename(parsed.data.outputFilename, '.pdf')}_${partSuffix}.pdf`
                : `${defaultName}.pdf`,
              defaultName,
              '.pdf',
            );
        await fs.writeFile(path.join(ws.outputDir, safeName), segBuffer);
      }

      const persisted = await this.executionRuntime.persistOutputFiles(ws, {
        userId: this.userId,
        messageId: this.messageId,
        db: this.db,
        storage: this.storage,
      });

      const links = persisted.map((p) => `[${p.filename}](${p.downloadUrl})`).join(', ');
      const status = allQaWarnings.length > 0 ? 'warning' : 'success';
      const summary = `Extracted ${persisted.length} PDF segment(s): ${links}.`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status,
              operation: 'splitPdfFile',
              files: persisted,
              metrics: {
                pageRangesCount: parsed.data.pageRanges.length,
                outputFilesCount: persisted.length,
              },
              structural: primaryStruct,
              visual: primaryVisual,
              warnings: allQaWarnings,
              repairable: allQaWarnings.some((w) => w.repairable !== false),
            },
          },
        ],
      };
    });
  }

  /* -------------------------------------------------------------------------- XLSX Handlers */

  private async handleInspectSpreadsheet(call: ToolCall): Promise<ToolResult> {
    const parsed = inspectFileInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('inspectSpreadsheet', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const inspection = await inspectSpreadsheet(buf);

      const summary = `Spreadsheet Inspection: ${inspection.sheetNames.length} sheet(s) [${inspection.sheetNames.join(', ')}], ${inspection.totalRows} total row(s).`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status: 'success',
              operation: 'inspectSpreadsheet',
              fileId: parsed.data.fileId,
              inspection,
            },
          },
        ],
      };
    });
  }

  private async handleEditSpreadsheetCells(call: ToolCall): Promise<ToolResult> {
    const parsed = editSpreadsheetCellsInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('editSpreadsheetCells', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const baseName = path.basename(mat.filename, path.extname(mat.filename));

      const report = await editSpreadsheetCellsWithReport(buf, parsed.data.edits as any);

      const semanticWarnings: DeliverableWarning[] = [];
      if (report.editsApplied < parsed.data.edits.length) {
        semanticWarnings.push({
          severity: 'warning',
          type: 'partial_edits_applied',
          message: `Applied ${report.editsApplied} of ${parsed.data.edits.length} edits`,
          repairable: true,
        });
      }

      const firstSheet = parsed.data.edits[0]?.sheet;
      const qa = await this.runPostMutationQa('xlsx', report.buffer, ws, {
        semanticWarnings,
        semanticMetrics: { appliedEdits: report.editsApplied, totalRequestedEdits: parsed.data.edits.length },
        selectedSheet: firstSheet,
      });

      if (!qa.structPassed) {
        const errMsg = `Modified spreadsheet failed structural verification: ${qa.structErrors.join('; ')}`;
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            { type: 'text', text: `Failed to edit spreadsheet: ${errMsg}` },
            {
              type: 'json',
              data: {
                status: 'failed',
                operation: 'editSpreadsheetCells',
                structural: qa.structural,
                semantic: qa.semantic,
                visual: qa.visual,
                overall: qa.overall,
                warnings: qa.warnings,
                repairable: true,
                error: errMsg,
              },
            },
          ],
        };
      }

      const safeFilename = sanitizeFilename(
        parsed.data.outputFilename,
        `${baseName}_edited`,
        '.xlsx',
      );
      await fs.writeFile(path.join(ws.outputDir, safeFilename), report.buffer);

      const persisted = await this.executionRuntime.persistOutputFiles(ws, {
        userId: this.userId,
        messageId: this.messageId,
        db: this.db,
        storage: this.storage,
      });

      const outFile = persisted.find((p) => p.filename === safeFilename) || persisted[0];
      if (!outFile) {
        throw new Error('Failed to persist modified spreadsheet.');
      }

      const status = qa.warnings.length > 0 ? 'warning' : 'success';
      const summary = `Updated ${report.editsApplied} cell(s) in spreadsheet: [Download ${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB).`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status,
              operation: 'editSpreadsheetCells',
              file: outFile,
              metrics: {
                editsCount: report.editsApplied,
                requestedEditsCount: parsed.data.edits.length,
                outputSizeBytes: outFile.sizeBytes,
              },
              structural: qa.structural,
              semantic: qa.semantic,
              visual: qa.visual,
              overall: qa.overall,
              warnings: qa.warnings,
              repairable: qa.repairable,
            },
          },
        ],
      };
    });
  }

  private async handleCombineWorkbooks(call: ToolCall): Promise<ToolResult> {
    const parsed = combineWorkbooksInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileIds = await Promise.all(parsed.data.fileIds.map((id) => this.resolveAttachmentId(id)));
    return await this.runInWorkspace('combineWorkbooks', async (ws) => {
      const buffers: Buffer[] = [];
      let firstName = 'combined';

      for (const id of fileIds) {
        const mat = await this.executionRuntime.materializeAttachment(
          ws,
          id,
          this.userId,
          this.db,
          this.storage,
        );
        buffers.push(await fs.readFile(mat.path));
        if (firstName === 'combined') {
          firstName = path.basename(mat.filename, path.extname(mat.filename));
        }
      }

      const report = await combineWorkbooksWithReport(buffers);

      const qa = await this.runPostMutationQa('xlsx', report.buffer, ws, {
        semanticMetrics: { totalSheetsCombined: report.totalSheets, workbooksCount: buffers.length },
      });

      if (!qa.structPassed) {
        const errMsg = `Combined workbook failed structural verification: ${qa.structErrors.join('; ')}`;
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            { type: 'text', text: `Failed to combine workbooks: ${errMsg}` },
            {
              type: 'json',
              data: {
                status: 'failed',
                operation: 'combineWorkbooks',
                structural: qa.structural,
                semantic: qa.semantic,
                visual: qa.visual,
                overall: qa.overall,
                warnings: qa.warnings,
                repairable: true,
                error: errMsg,
              },
            },
          ],
        };
      }

      const safeFilename = sanitizeFilename(
        parsed.data.outputFilename,
        `${firstName}_consolidated`,
        '.xlsx',
      );
      await fs.writeFile(path.join(ws.outputDir, safeFilename), report.buffer);

      const persisted = await this.executionRuntime.persistOutputFiles(ws, {
        userId: this.userId,
        messageId: this.messageId,
        db: this.db,
        storage: this.storage,
      });

      const outFile = persisted.find((p) => p.filename === safeFilename) || persisted[0];
      if (!outFile) {
        throw new Error('Failed to persist consolidated workbook.');
      }

      const status = qa.warnings.length > 0 ? 'warning' : 'success';
      const summary = `Combined ${parsed.data.fileIds.length} Excel workbooks into [${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB).`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status,
              operation: 'combineWorkbooks',
              file: outFile,
              metrics: {
                workbooksCombinedCount: parsed.data.fileIds.length,
                totalSheetsCombined: report.totalSheets,
                outputSizeBytes: outFile.sizeBytes,
              },
              structural: qa.structural,
              semantic: qa.semantic,
              visual: qa.visual,
              overall: qa.overall,
              warnings: qa.warnings,
              repairable: qa.repairable,
            },
          },
        ],
      };
    });
  }

  /* -------------------------------------------------------------------------- DOCX Handlers */

  private async handleInspectDocxStructure(call: ToolCall): Promise<ToolResult> {
    const parsed = inspectFileInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('inspectDocxStructure', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const inspection = await inspectDocxStructure(buf);

      const headingsPart = inspection.headings.length > 0 ? `, Headings: [${inspection.headings.slice(0, 5).join(', ')}]` : '';
      const summary = `Word Document Inspection: ${inspection.paragraphsCount} paragraph(s), ${inspection.tablesCount} table(s)${headingsPart}.`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status: 'success',
              operation: 'inspectDocxStructure',
              fileId: parsed.data.fileId,
              inspection,
            },
          },
        ],
      };
    });
  }

  private async handleEditDocxContent(call: ToolCall): Promise<ToolResult> {
    const parsed = editDocxContentInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('editDocxContent', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const baseName = path.basename(mat.filename, path.extname(mat.filename));

      const report = await editDocxContentWithReport(buf, parsed.data.replacements);

      const semanticWarnings: DeliverableWarning[] = [];
      if (report.replacementsApplied === 0) {
        const searchedTerms = parsed.data.replacements.map((r) => `"${r.search}"`).join(', ');
        semanticWarnings.push({
          severity: 'warning',
          type: 'search_string_not_found',
          message: `Search string not found in document: ${searchedTerms}`,
          repairable: true,
        });
      }

      const qa = await this.runPostMutationQa('docx', report.buffer, ws, {
        semanticWarnings,
        semanticMetrics: { replacementsApplied: report.replacementsApplied },
      });

      if (!qa.structPassed) {
        const errMsg = `Modified Word document failed structural verification: ${qa.structErrors.join('; ')}`;
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            { type: 'text', text: `Failed to edit Word document: ${errMsg}` },
            {
              type: 'json',
              data: {
                status: 'failed',
                operation: 'editDocxContent',
                structural: qa.structural,
                semantic: qa.semantic,
                visual: qa.visual,
                overall: qa.overall,
                warnings: qa.warnings,
                repairable: true,
                error: errMsg,
              },
            },
          ],
        };
      }

      const safeFilename = sanitizeFilename(
        parsed.data.outputFilename,
        `${baseName}_modified`,
        '.docx',
      );
      await fs.writeFile(path.join(ws.outputDir, safeFilename), report.buffer);

      const persisted = await this.executionRuntime.persistOutputFiles(ws, {
        userId: this.userId,
        messageId: this.messageId,
        db: this.db,
        storage: this.storage,
      });

      const outFile = persisted.find((p) => p.filename === safeFilename) || persisted[0];
      if (!outFile) {
        throw new Error('Failed to persist modified Word document.');
      }

      const status = qa.warnings.length > 0 ? 'warning' : 'success';
      const summary = report.replacementsApplied === 0
        ? `No text replacements matched in Word document: [Download ${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB). Warning: search string was not found.`
        : `Applied ${report.replacementsApplied} text replacement(s) in Word document: [Download ${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB).`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status,
              operation: 'editDocxContent',
              file: outFile,
              metrics: {
                replacementsCount: report.replacementsApplied,
                outputSizeBytes: outFile.sizeBytes,
              },
              structural: qa.structural,
              semantic: qa.semantic,
              visual: qa.visual,
              overall: qa.overall,
              warnings: qa.warnings,
              repairable: qa.repairable,
            },
          },
        ],
      };
    });
  }

  private async handleAppendDocxSection(call: ToolCall): Promise<ToolResult> {
    const parsed = appendDocxSectionInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('appendDocxSection', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const baseName = path.basename(mat.filename, path.extname(mat.filename));

      const report = await appendDocxSectionWithReport(buf, parsed.data.heading, parsed.data.paragraphs);

      const qa = await this.runPostMutationQa('docx', report.buffer, ws, {
        semanticMetrics: { heading: parsed.data.heading, paragraphsAppended: report.paragraphsAppended },
      });

      if (!qa.structPassed) {
        const errMsg = `Appended Word document failed structural verification: ${qa.structErrors.join('; ')}`;
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            { type: 'text', text: `Failed to append section to Word document: ${errMsg}` },
            {
              type: 'json',
              data: {
                status: 'failed',
                operation: 'appendDocxSection',
                structural: qa.structural,
                semantic: qa.semantic,
                visual: qa.visual,
                overall: qa.overall,
                warnings: qa.warnings,
                repairable: true,
                error: errMsg,
              },
            },
          ],
        };
      }

      const safeFilename = sanitizeFilename(
        parsed.data.outputFilename,
        `${baseName}_appended`,
        '.docx',
      );
      await fs.writeFile(path.join(ws.outputDir, safeFilename), report.buffer);

      const persisted = await this.executionRuntime.persistOutputFiles(ws, {
        userId: this.userId,
        messageId: this.messageId,
        db: this.db,
        storage: this.storage,
      });

      const outFile = persisted.find((p) => p.filename === safeFilename) || persisted[0];
      if (!outFile) {
        throw new Error('Failed to persist appended Word document.');
      }

      const status = qa.warnings.length > 0 ? 'warning' : 'success';
      const summary = `Appended section "${parsed.data.heading}" with ${report.paragraphsAppended} paragraph(s) to Word document: [Download ${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB).`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status,
              operation: 'appendDocxSection',
              file: outFile,
              metrics: {
                heading: parsed.data.heading,
                paragraphsAppended: report.paragraphsAppended,
                outputSizeBytes: outFile.sizeBytes,
              },
              structural: qa.structural,
              semantic: qa.semantic,
              visual: qa.visual,
              overall: qa.overall,
              warnings: qa.warnings,
              repairable: qa.repairable,
            },
          },
        ],
      };
    });
  }

  /* -------------------------------------------------------------------------- PPTX Handlers */

  private async handleInspectPptxStructure(call: ToolCall): Promise<ToolResult> {
    const parsed = inspectFileInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('inspectPptxStructure', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const inspection = await inspectPptxStructure(buf);

      const titlesPart = inspection.titles.length > 0 ? ` [${inspection.titles.slice(0, 4).join(', ')}]` : '';
      const summary = `PowerPoint Inspection: ${inspection.slideCount} slide(s)${titlesPart}.`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status: 'success',
              operation: 'inspectPptxStructure',
              fileId: parsed.data.fileId,
              inspection,
            },
          },
        ],
      };
    });
  }

  private async handleReorderPptxSlides(call: ToolCall): Promise<ToolResult> {
    const parsed = reorderPptxSlidesInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('reorderPptxSlides', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const baseName = path.basename(mat.filename, path.extname(mat.filename));

      const report = await reorderPptxSlidesWithReport(buf, parsed.data.newOrder);

      const qa = await this.runPostMutationQa('pptx', report.buffer, ws, {
        semanticMetrics: { newOrder: parsed.data.newOrder, slideCount: report.finalSlideCount },
      });

      if (!qa.structPassed) {
        const errMsg = `Reordered PowerPoint presentation failed structural verification: ${qa.structErrors.join('; ')}`;
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            { type: 'text', text: `Failed to reorder PowerPoint slides: ${errMsg}` },
            {
              type: 'json',
              data: {
                status: 'failed',
                operation: 'reorderPptxSlides',
                structural: qa.structural,
                semantic: qa.semantic,
                visual: qa.visual,
                overall: qa.overall,
                warnings: qa.warnings,
                repairable: true,
                error: errMsg,
              },
            },
          ],
        };
      }

      const safeFilename = sanitizeFilename(
        parsed.data.outputFilename,
        `${baseName}_reordered`,
        '.pptx',
      );
      await fs.writeFile(path.join(ws.outputDir, safeFilename), report.buffer);

      const persisted = await this.executionRuntime.persistOutputFiles(ws, {
        userId: this.userId,
        messageId: this.messageId,
        db: this.db,
        storage: this.storage,
      });

      const outFile = persisted.find((p) => p.filename === safeFilename) || persisted[0];
      if (!outFile) {
        throw new Error('Failed to persist reordered PowerPoint presentation.');
      }

      const status = qa.warnings.length > 0 ? 'warning' : 'success';
      const summary = `Reordered PowerPoint slides (new sequence: [${parsed.data.newOrder.join(', ')}]): [Download ${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB).`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status,
              operation: 'reorderPptxSlides',
              file: outFile,
              metrics: {
                newOrder: parsed.data.newOrder,
                outputSizeBytes: outFile.sizeBytes,
              },
              structural: qa.structural,
              semantic: qa.semantic,
              visual: qa.visual,
              overall: qa.overall,
              warnings: qa.warnings,
              repairable: qa.repairable,
            },
          },
        ],
      };
    });
  }

  private async handleEditPptxSlideText(call: ToolCall): Promise<ToolResult> {
    const parsed = editPptxSlideTextInputSchema.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const fileId = await this.resolveAttachmentId(parsed.data.fileId);
    return await this.runInWorkspace('editPptxSlideText', async (ws) => {
      const mat = await this.executionRuntime.materializeAttachment(
        ws,
        fileId,
        this.userId,
        this.db,
        this.storage,
      );
      const buf = await fs.readFile(mat.path);
      const baseName = path.basename(mat.filename, path.extname(mat.filename));

      const report = await editPptxSlideTextWithReport(
        buf,
        parsed.data.slideIndex,
        parsed.data.replacements,
      );

      const semanticWarnings: DeliverableWarning[] = [];
      if (report.replacementsApplied === 0) {
        const searchedTerms = parsed.data.replacements.map((r) => `"${r.search}"`).join(', ');
        semanticWarnings.push({
          severity: 'warning',
          type: 'search_string_not_found',
          message: `Search string not found on slide ${parsed.data.slideIndex}: ${searchedTerms}`,
          repairable: true,
        });
      }

      const qa = await this.runPostMutationQa('pptx', report.buffer, ws, {
        semanticWarnings,
        semanticMetrics: {
          slideIndex: parsed.data.slideIndex,
          replacementsApplied: report.replacementsApplied,
        },
        selectedSlides: [parsed.data.slideIndex],
      });

      if (!qa.structPassed) {
        const errMsg = `Edited PowerPoint presentation failed structural verification: ${qa.structErrors.join('; ')}`;
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            { type: 'text', text: `Failed to edit PowerPoint slide: ${errMsg}` },
            {
              type: 'json',
              data: {
                status: 'failed',
                operation: 'editPptxSlideText',
                structural: qa.structural,
                semantic: qa.semantic,
                visual: qa.visual,
                overall: qa.overall,
                warnings: qa.warnings,
                repairable: true,
                error: errMsg,
              },
            },
          ],
        };
      }

      const safeFilename = sanitizeFilename(
        parsed.data.outputFilename,
        `${baseName}_slide${parsed.data.slideIndex}_edited`,
        '.pptx',
      );
      await fs.writeFile(path.join(ws.outputDir, safeFilename), report.buffer);

      const persisted = await this.executionRuntime.persistOutputFiles(ws, {
        userId: this.userId,
        messageId: this.messageId,
        db: this.db,
        storage: this.storage,
      });

      const outFile = persisted.find((p) => p.filename === safeFilename) || persisted[0];
      if (!outFile) {
        throw new Error('Failed to persist edited PowerPoint presentation.');
      }

      const status = qa.warnings.length > 0 ? 'warning' : 'success';
      const summary = report.replacementsApplied === 0
        ? `No text replacements matched on slide ${parsed.data.slideIndex}: [Download ${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB). Warning: search string was not found.`
        : `Updated text on slide ${parsed.data.slideIndex} (${report.replacementsApplied} replacement(s)): [Download ${outFile.filename}](${outFile.downloadUrl}) (${Math.round(outFile.sizeBytes / 1024)} KB).`;

      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'text', text: summary },
          {
            type: 'json',
            data: {
              status,
              operation: 'editPptxSlideText',
              file: outFile,
              metrics: {
                slideIndex: parsed.data.slideIndex,
                replacementsCount: report.replacementsApplied,
                outputSizeBytes: outFile.sizeBytes,
              },
              structural: qa.structural,
              semantic: qa.semantic,
              visual: qa.visual,
              overall: qa.overall,
              warnings: qa.warnings,
              repairable: qa.repairable,
            },
          },
        ],
      };
    });
  }
}
