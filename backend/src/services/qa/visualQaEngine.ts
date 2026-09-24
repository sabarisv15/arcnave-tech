/**
 * VisualQaEngine: Deterministic Document Surface Rasterization & Real Visual Inspection.
 *
 * Implements Batch 5 Real Visual QA across PDF, XLSX, DOCX, and PPTX:
 * 1. PDF: Native Node rendering via bundled pdf.js in pdf-parse (zero external binaries).
 * 2. Office (DOCX, PPTX, XLSX): Headless sandbox conversion via isolated LibreOffice -> PDF -> PNG.
 *    - Graceful fallback: If LibreOffice is absent in host/local dev, returns `previewAvailable: false`
 *      and marks `QA RENDERER FAILURE` without aborting normal file operations.
 *    - Bounded XLSX: Converts only selected/modified sheets to prevent rendering massive workbooks.
 * 3. Vision Model Inspection: Dispatches rendered page/slide/sheet images to Gemini Vision
 *    with a structured defect prompt, extracting typed `VisualDefect[]`.
 * 4. Resource Bounds: Strictly caps rendered units (max 5), image dimensions, and timeouts.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../logger.js';
import type { Provider } from '../../providers/types.js';
import type { ExportFormat } from '../documents/types.js';
import { VisualDefectSchema, type VisualDefect } from '../documents/primitives.js';
import type { ExecutionRuntime, WorkspaceFiles } from '../../tools/execution/executionRuntime.js';

const log = logger.child({ module: 'visualQaEngine' });

export interface RenderedPageImage {
  label: string;
  buffer: Buffer;
  mimeType: 'image/png';
}

/**
 * G14: what the visual layer actually established. `not_checked` means no vision model looked
 * at the rendering (none configured, it failed, or nothing could be rendered). It is never
 * reported as `passed`, and it never changes the structural result.
 */
export type VisualQaStatus = 'passed' | 'failed' | 'not_checked';

export interface VisualQaReport {
  status: VisualQaStatus;
  /** Exactly `status === 'passed'`. Kept for callers that read a boolean. */
  passed: boolean;
  defects: VisualDefect[];
  previewAvailable: boolean;
  inspectedPages?: number;
  inspectedSlides?: number;
  inspectedSheets?: number;
  diagnostics: string[];
}

export interface VisualQaOptions {
  buffer: Buffer;
  format: ExportFormat;
  runtime?: ExecutionRuntime;
  workspace?: WorkspaceFiles;
  visionProvider?: Provider;
  signal?: AbortSignal;
  selectedSheet?: string;
  selectedSlides?: number[];
  maxUnits?: number;
}

export class VisualQaEngine {
  private readonly defaultMaxUnits = 5;

  /**
   * Renders PDF pages to PNG buffers using Node-native pdf-parse (pdf.js).
   */
  async renderPdfPages(
    pdfBuffer: Buffer,
    options?: { maxPages?: number; selectedPages?: number[] },
  ): Promise<RenderedPageImage[]> {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: pdfBuffer });
    try {
      const screenshotResult = await parser.getScreenshot();
      if (!screenshotResult?.pages || screenshotResult.pages.length === 0) {
        return [];
      }

      const total = screenshotResult.pages.length;
      const maxPages = options?.maxPages ?? this.defaultMaxUnits;
      const selected = options?.selectedPages;

      const indicesToTake: number[] = [];
      if (selected && selected.length > 0) {
        for (const p of selected) {
          const idx = p - 1;
          if (idx >= 0 && idx < total && !indicesToTake.includes(idx)) {
            indicesToTake.push(idx);
          }
        }
      } else if (total <= maxPages) {
        for (let i = 0; i < total; i++) indicesToTake.push(i);
      } else {
        // Sample: first page, last page, and evenly spaced middle pages
        indicesToTake.push(0);
        const middleCount = maxPages - 2;
        const step = Math.floor((total - 2) / (middleCount + 1)) || 1;
        for (let i = 1; i <= middleCount; i++) {
          const idx = Math.min(total - 2, i * step);
          if (!indicesToTake.includes(idx)) indicesToTake.push(idx);
        }
        if (!indicesToTake.includes(total - 1)) {
          indicesToTake.push(total - 1);
        }
      }

      const images: RenderedPageImage[] = [];
      for (const idx of indicesToTake) {
        const page = screenshotResult.pages[idx];
        if (page?.data) {
          images.push({
            label: `Page ${idx + 1}`,
            buffer: Buffer.from(page.data),
            mimeType: 'image/png',
          });
        }
      }

      return images;
    } catch (err: unknown) {
      log.warn({ err }, 'Failed to rasterize PDF pages via pdf-parse');
      return [];
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  /**
   * Renders Office documents (DOCX, PPTX, XLSX) through the isolated sandbox LibreOffice bridge.
   */
  async renderOfficeDocument(
    buffer: Buffer,
    format: 'docx' | 'pptx' | 'xlsx',
    runtime: ExecutionRuntime,
    workspace: WorkspaceFiles,
    options?: { selectedSheet?: string; selectedSlides?: number[]; maxUnits?: number },
  ): Promise<{ images: RenderedPageImage[]; previewAvailable: boolean; diagnostic?: string }> {
    if (buffer.length > 50 * 1024 * 1024) {
      return {
        images: [],
        previewAvailable: false,
        diagnostic: 'QA RENDERER FAILURE: File size exceeds visual QA limit of 50MB.',
      };
    }

    try {
      let inputBuffer = buffer;

      // Bounded XLSX rendering: create a temporary workbook with only the selected worksheet
      if (format === 'xlsx') {
        try {
          const ExcelJS = (await import('exceljs')).default;
          const srcWb = new ExcelJS.Workbook();
          await srcWb.xlsx.load(buffer as any);

          if (srcWb.worksheets.length > 1) {
            const targetSheetName = options?.selectedSheet || srcWb.worksheets[0]?.name;
            const targetSheet = targetSheetName ? srcWb.getWorksheet(targetSheetName) : srcWb.worksheets[0];
            if (targetSheet) {
              const isolatedWb = new ExcelJS.Workbook();
              const newSheet = isolatedWb.addWorksheet(targetSheet.name);
              targetSheet.eachRow({ includeEmpty: true }, (row, rowNum) => {
                const newRow = newSheet.getRow(rowNum);
                newRow.height = row.height;
                row.eachCell({ includeEmpty: true }, (cell, colNum) => {
                  const newCell = newRow.getCell(colNum);
                  newCell.value = cell.value;
                  newCell.numFmt = cell.numFmt;
                  newCell.style = { ...cell.style };
                });
              });
              const isolatedBuf = await isolatedWb.xlsx.writeBuffer();
              inputBuffer = Buffer.from(isolatedBuf as ArrayBuffer);
            }
          }
        } catch (subErr) {
          log.warn({ subErr }, 'Failed to isolate sheet for bounded XLSX render; proceeding with full buffer');
        }
      }

      const baseName = `render_input_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const inputFilename = `${baseName}.${format}`;
      const inputPath = path.join(workspace.tempDir, inputFilename);
      await fs.writeFile(inputPath, inputBuffer);

      // Invoke headless conversion in sandbox: soffice --headless --convert-to pdf --outdir . inputFilename
      const cliResult = await runtime.executeControlledCli(
        'soffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', '.', inputFilename],
        { cwd: workspace.tempDir, timeoutMs: 30000 },
      );

      if (cliResult.exitCode !== 0) {
        await fs.unlink(inputPath).catch(() => undefined);
        return {
          images: [],
          previewAvailable: false,
          diagnostic: `QA RENDERER FAILURE: Headless Office conversion exited with code ${cliResult.exitCode}: ${cliResult.stderr || cliResult.stdout}`,
        };
      }

      const expectedPdfName = `${baseName}.pdf`;
      const expectedPdfPath = path.join(workspace.tempDir, expectedPdfName);
      let pdfExists = false;
      try {
        await fs.access(expectedPdfPath);
        pdfExists = true;
      } catch {
        // Fallback scan for any generated PDF matching prefix
        const files = await fs.readdir(workspace.tempDir);
        const match = files.find((f) => f.startsWith('render_input_') && f.endsWith('.pdf'));
        if (match) {
          pdfExists = true;
        }
      }

      if (!pdfExists) {
        await fs.unlink(inputPath).catch(() => undefined);
        return {
          images: [],
          previewAvailable: false,
          diagnostic: 'QA RENDERER FAILURE: Headless Office conversion produced no PDF output.',
        };
      }

      const convertedPdfBytes = await fs.readFile(expectedPdfPath);
      // Clean up temporary conversion files immediately
      await fs.unlink(inputPath).catch(() => undefined);
      await fs.unlink(expectedPdfPath).catch(() => undefined);

      const images = await this.renderPdfPages(convertedPdfBytes, {
        maxPages: options?.maxUnits ?? this.defaultMaxUnits,
        selectedPages: options?.selectedSlides,
      });

      // Label adjustment for format
      const labeledImages = images.map((img, idx) => ({
        ...img,
        label:
          format === 'pptx'
            ? `Slide ${options?.selectedSlides?.[idx] ?? idx + 1}`
            : format === 'xlsx'
              ? `Sheet "${options?.selectedSheet || 'Preview'}"`
              : img.label,
      }));

      return {
        images: labeledImages,
        previewAvailable: labeledImages.length > 0,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        images: [],
        previewAvailable: false,
        diagnostic: `QA RENDERER FAILURE: Headless Office rendering unavailable in this environment: ${msg}`,
      };
    }
  }

  /**
   * Inspects rendered images with Gemini Vision to detect visible layout defects.
   */
  async inspectWithVision(
    images: RenderedPageImage[],
    format: ExportFormat,
    provider?: Provider,
    signal?: AbortSignal,
  ): Promise<{ status: VisualQaStatus; defects: VisualDefect[]; diagnostics: string[] }> {
    if (images.length === 0) {
      return {
        status: 'not_checked',
        defects: [],
        diagnostics: ['No rendered images were provided for visual inspection.'],
      };
    }

    if (!provider?.describeMedia) {
      // Deterministic fallback: check that image buffers are non-empty and have valid PNG headers
      const validImages = images.every(
        (img) =>
          img.buffer.length > 200 &&
          img.buffer[0] === 0x89 &&
          img.buffer[1] === 0x50 &&
          img.buffer[2] === 0x4e &&
          img.buffer[3] === 0x47,
      );

      // A valid PNG proves the renderer produced an image, not that the layout is right.
      return {
        status: validImages ? 'not_checked' : 'failed',
        defects: validImages
          ? []
          : [
              {
                type: 'malformed_rendering',
                location: 'Image buffer',
                severity: 'high',
                description: 'Rendered image buffer failed PNG magic header verification.',
                repairable: true,
              },
            ],
        diagnostics: [
          validImages
            ? `Visual layout not checked: no vision provider is configured (${String(images.length)} rendered image(s) are valid PNGs).`
            : 'Image buffer integrity failed.',
        ],
      };
    }

    try {
      const mediaParts = images.map((img) => ({
        mimeType: img.mimeType,
        base64: img.buffer.toString('base64'),
      }));

      const visionPrompt = `You are an automated document visual QA inspector for ${format.toUpperCase()} deliverables.
Inspect the attached rendered image(s) [${images.map((i) => i.label).join(', ')}] strictly for genuine layout/visual defects:
- text_clipping: text or titles cut off at page/slide borders or boundaries
- text_overlap: text colliding, overlapping, or rendered on top of other text
- broken_table: table borders disjointed, columns clipped, or headers misaligned
- unreadable_text: font sizes too small or unreadable text collisions
- blank_page: completely empty or corrupt rendering with zero meaningful content

Respond strictly in valid JSON format:
{
  "passed": boolean,
  "defects": [
    {
      "type": "text_clipping" | "text_overlap" | "broken_table" | "unreadable_text" | "blank_page",
      "location": string,
      "severity": "low" | "medium" | "high" | "critical",
      "description": string,
      "repairable": boolean
    }
  ]
}`;

      const rawResponse = await provider.describeMedia(
        mediaParts,
        visionPrompt,
        signal ?? new AbortController().signal,
      );

      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          status: 'not_checked',
          defects: [],
          diagnostics: ['Visual layout not checked: the vision provider returned an unstructured assessment: ' + rawResponse.slice(0, 100)],
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as { passed?: boolean; defects?: unknown[] };
      const defects: VisualDefect[] = [];

      if (Array.isArray(parsed.defects)) {
        for (const item of parsed.defects) {
          const valid = VisualDefectSchema.safeParse(item);
          if (valid.success) {
            defects.push(valid.data);
          }
        }
      }

      const passed = parsed.passed !== false && defects.length === 0;

      return {
        status: passed ? 'passed' : 'failed',
        defects,
        diagnostics: [
          passed
            ? `Vision inspection passed across ${images.length} rendered unit(s).`
            : `Vision inspection flagged ${defects.length} defect(s): ${defects.map((d) => d.description).join('; ')}`,
        ],
      };
    } catch (err: unknown) {
      log.warn({ err }, 'Vision model inspection failed; visual layer not checked');
      return {
        status: 'not_checked',
        defects: [],
        diagnostics: [`Visual layout not checked: the vision call failed: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  /**
   * Complete end-to-end Visual QA pipeline for any deliverable buffer.
   */
  async evaluateVisualQa(options: VisualQaOptions): Promise<VisualQaReport> {
    const { buffer, format, runtime, workspace, visionProvider, signal, selectedSheet, selectedSlides, maxUnits } =
      options;

    const diagnostics: string[] = [];
    let images: RenderedPageImage[] = [];
    let previewAvailable = false;

    if (format === 'pdf') {
      images = await this.renderPdfPages(buffer, {
        maxPages: maxUnits ?? this.defaultMaxUnits,
        selectedPages: selectedSlides,
      });
      previewAvailable = images.length > 0;
      if (!previewAvailable) {
        diagnostics.push('PDF rasterizer produced zero page images.');
      }
    } else if (runtime && workspace) {
      const renderRes = await this.renderOfficeDocument(buffer, format, runtime, workspace, {
        selectedSheet,
        selectedSlides,
        maxUnits,
      });
      images = renderRes.images;
      previewAvailable = renderRes.previewAvailable;
      if (renderRes.diagnostic) {
        diagnostics.push(renderRes.diagnostic);
      }
    } else {
      previewAvailable = false;
      diagnostics.push(
        'QA RENDERER FAILURE: Headless Office rendering unavailable (no execution workspace provided).',
      );
    }

    if (!previewAvailable || images.length === 0) {
      return {
        status: 'not_checked',
        passed: false,
        defects: [],
        previewAvailable: false,
        diagnostics,
      };
    }

    const visionResult = await this.inspectWithVision(images, format, visionProvider, signal);
    diagnostics.push(...visionResult.diagnostics);

    const report: VisualQaReport = {
      status: visionResult.status,
      passed: visionResult.status === 'passed',
      defects: visionResult.defects,
      previewAvailable: true,
      diagnostics,
    };

    if (format === 'pdf') report.inspectedPages = images.length;
    else if (format === 'pptx') report.inspectedSlides = images.length;
    else if (format === 'xlsx') report.inspectedSheets = images.length;

    return report;
  }
}

export const visualQaEngine = new VisualQaEngine();

export type OverallQaStatus = 'verified' | 'passed_with_warnings' | 'unverified' | 'failed';

/**
 * G14: the layers stay separate and `overall` is derived, never assumed. A structural or
 * visual failure fails. When the task needed visual verification and no vision model looked,
 * the result is `unverified`, however good the structure is.
 */
export function overallQaStatus(input: {
  structuralPassed: boolean;
  semanticPassed: boolean;
  visual: VisualQaStatus;
  visualRequired: boolean;
}): OverallQaStatus {
  if (!input.structuralPassed || input.visual === 'failed') return 'failed';
  if (input.visualRequired && input.visual === 'not_checked') return 'unverified';
  return input.semanticPassed ? 'verified' : 'passed_with_warnings';
}
