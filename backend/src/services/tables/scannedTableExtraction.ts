/**
 * Generic table-row extraction from PDF pages (Phase 3). A bank statement is one use of it;
 * attendance sheets, registers, invoices and ledgers are others. Nothing here knows what the
 * columns mean.
 *
 *   exact fileId → workspace input/
 *   → trusted CLI (pdftoppm) renders pages in the sandbox, no network
 *   → the backend sends each page image to the vision provider (ADR-0007: network calls never
 *     run in the sandbox) and gets rows with a confidence and a source region
 *   → pass 2: low-confidence rows are re-rendered as a high-resolution crop and read again
 *   → a packaged skill script normalises and indexes the rows deterministically
 *
 * Vision output is probabilistic, so nothing is trusted silently: a page whose reply cannot be
 * parsed is reported failed, never filled in; a recheck that disagrees keeps the first reading
 * and says so; low-confidence rows are returned to the model by page and row.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import type { Database } from '../../db/client.js';
import { logger } from '../../logger.js';
import type { Provider } from '../../providers/types.js';
import type { ExecutionRuntime, MaterializedAttachment, WorkspaceFiles } from '../../tools/execution/executionRuntime.js';
import type { SkillService } from '../skills.js';
import type { ObjectStorage } from '../storage.js';

const log = logger.child({ module: 'scannedTableExtraction' });

export const LOW_CONFIDENCE_THRESHOLD = 0.8;
export const EXTRACTION_ID = /^tx_(\d{4})(\d{2})_([a-f0-9]{16})$/;
/**
 * First pass: each page scaled so its long side is this many pixels, whatever its physical size.
 * A fixed dpi does not work: a phone-scanned statement arrived as 1413 x 2000 pt pages, so 150
 * dpi meant 2944 x 4167 px (up-sampled from a ~75 ppi photo, no new detail) and 18 s per page.
 */
const PAGE_LONG_SIDE_PX = 2000;
/** Pass 2 and re-extraction: pages and crops at this resolution. */
const RECHECK_DPI = 300;
/** JPEG, not PNG: PNG encoding of a large page took 4-17 s; JPEG takes well under a second. */
const RENDER_FORMAT = ['-jpeg', '-jpegopt', 'quality=92'];
const IMAGE_EXT = 'jpg';
const IMAGE_MIME = 'image/jpeg';
/** A remote sandbox returns at most 20 declared outputs per run. */
const RENDER_BATCH = 20;
const VISION_CONCURRENCY = 4;
const REGION_PADDING = 0.01;

export interface SourceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The generic row contract. `sourceRegion` is normalised to the page, origin top-left. */
export interface ExtractedTableRow {
  page: number;
  rowIndex: number;
  cells: string[];
  confidence: number;
  sourceRegion?: SourceRegion;
}

/** One page as the vision model read it, before normalisation. */
export interface RawPage {
  page: number;
  status: 'ok' | 'failed';
  warnings: string[];
  tables: Array<{
    rows: Array<{
      cells: string[];
      confidence: number;
      isHeader: boolean;
      sourceRegion?: SourceRegion | null;
      rechecked?: boolean;
      /** Set when the second read changed this row's cells; the first reading is kept here. */
      firstReading?: { cells: string[]; confidence: number };
    }>;
  }>;
  /** Every pass-2 attempt on this page, whatever its outcome. */
  rechecks?: RecheckRecord[];
}

/** One pass-2 re-read: both readings, and what was kept. Nothing is replaced unrecorded. */
export interface RecheckRecord {
  region: SourceRegion;
  outcome: 'replaced' | 'kept_first' | 'render_failed' | 'read_failed';
  firstRows: Array<{ cells: string[]; confidence: number }>;
  secondRows: Array<{ cells: string[]; confidence: number }>;
  /** Rows whose cells differ between the readings (only meaningful when counts match). */
  changedRows: number;
}

/** What `normalize_table_rows.py` writes. */
export interface NormalizedTable {
  header: string[] | null;
  headersSeen: Array<{ page: number; cells: string[] }>;
  droppedHeaderRepeats: Array<{ page: number; cells: string[] }>;
  rows: Array<ExtractedTableRow & { pageRowIndex: number; tableIndex: number; rechecked?: boolean }>;
  totalRows: number;
  columnCount: number;
  pages: Array<{ page: number; status: string; tableCount: number; rowCount: number; warnings: string[] }>;
  failedPages: number[];
  lowConfidenceRows: Array<{ page: number; rowIndex: number; confidence: number; cells: string[] }>;
  possibleDuplicates: Array<{ page: number; rowIndex: number; sameAs: number }>;
  changedOnRecheck?: Array<{ page: number; rowIndex: number; first: string[]; second: string[] }>;
  raggedRows: Array<{ page: number; rowIndex: number; cellCount: number }>;
}

export interface StoredExtraction {
  extractionId: string;
  fileId: string;
  filename: string;
  pageCount: number;
  rawPages: RawPage[];
  table: NormalizedTable;
}

/** A failure the model should see and can act on. Never thrown past the executor. */
export class TableExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableExtractionError';
  }
}

const visionRow = z.object({
  cells: z.array(z.union([z.string(), z.number(), z.null()])).transform((c) => c.map((v) => (v === null ? '' : String(v)))),
  confidence: z.number().min(0).max(1),
  isHeader: z.boolean().optional().default(false),
  box: z.array(z.number()).length(4).optional().nullable(),
});
const visionReply = z.object({
  tables: z.array(z.object({ rows: z.array(visionRow) })),
  warnings: z.array(z.string()).optional().default([]),
});
type VisionReply = z.infer<typeof visionReply>;

const JSON_CONTRACT = `Reply with JSON only, no prose, in exactly this shape:
{"tables":[{"rows":[{"cells":["..."],"confidence":0.0,"isHeader":false,"box":[x0,y0,x1,y1]}]}],"warnings":["..."]}
Rules:
- One object per printed table row, in top-to-bottom order. Transcribe every row; never summarise, skip, merge, reorder or compute anything.
- "cells": the row's cells left to right, text exactly as printed. A cell that wraps onto several lines is one cell joined with a space. An empty cell is "". Every row of a table has one entry per column.
- "isHeader": true only for column-heading rows.
- "confidence": 0 to 1, how sure you are that every cell of this row is transcribed exactly. Use a low value for blurred, faint, overlapping or partly cut-off text.
- "box": the row's bounding box as fractions of the image width and height, origin top-left.
- No table in the image: {"tables":[],"warnings":[]}. Anything cut off, illegible or ambiguous goes in "warnings".`;

function pagePrompt(page: number): string {
  return `This image is page ${String(page)} of a scanned document. Extract every table row on it.\n${JSON_CONTRACT}`;
}

function recheckPrompt(page: number): string {
  return `This image is an enlarged crop of part of page ${String(page)} of a scanned document. Extract every table row visible in it, including rows only partly visible.\n${JSON_CONTRACT}`;
}

function parseVisionReply(text: string): VisionReply | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = visionReply.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toRegion(box: number[] | null | undefined): SourceRegion | undefined {
  if (!box) return undefined;
  const [x0, y0, x1, y1] = box.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number, number];
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Maps a region in crop coordinates back onto the full page. */
function uncrop(region: SourceRegion | undefined, crop: SourceRegion): SourceRegion | undefined {
  if (!region) return undefined;
  return {
    x: crop.x + region.x * crop.width,
    y: crop.y + region.y * crop.height,
    width: region.width * crop.width,
    height: region.height * crop.height,
  };
}

function toRawRows(reply: VisionReply, crop?: SourceRegion): RawPage['tables'] {
  return reply.tables.map((t) => ({
    rows: t.rows.map((r) => {
      const region = toRegion(r.box);
      return {
        cells: r.cells,
        confidence: r.confidence,
        isHeader: r.isHeader,
        sourceRegion: crop ? uncrop(region, crop) : region,
      };
    }),
  }));
}

/** Contiguous runs of the sorted page list, each at most `RENDER_BATCH` long. */
function renderBatches(pages: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const p of [...pages].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last && p === last[1] + 1 && last[1] - last[0] + 1 < RENDER_BATCH) last[1] = p;
    else out.push([p, p]);
  }
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ExtractionDeps {
  runtime: ExecutionRuntime;
  workspace: WorkspaceFiles;
  visionProvider: Provider;
  skills: SkillService;
  storage: ObjectStorage;
  db: Database;
  userId: string;
  /** fileId → materialised copy, shared across calls in one turn so a repair pass does not
   *  stage a second copy of the same PDF. */
  materialized?: Map<string, MaterializedAttachment>;
}

export class ScannedTableExtractor {
  constructor(private readonly deps: ExtractionDeps) {}

  /**
   * The extractionId encodes where the extraction is stored, in the object store's own key
   * format, under the caller's userId. One user's id can therefore never name another user's
   * extraction: the key is rebuilt from the requesting user, not taken from the id.
   */
  static newExtractionId(): string {
    const now = new Date();
    const month = `${String(now.getUTCFullYear())}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `tx_${month}_${randomBytes(8).toString('hex')}`;
  }

  static storageKey(userId: string, extractionId: string): string | null {
    const m = EXTRACTION_ID.exec(extractionId);
    if (!m) return null;
    const shard = createHash('sha256').update(userId).digest('hex').slice(0, 4);
    return `${shard}/${m[1]!}/${m[2]!}/${userId}/${m[3]!}`;
  }

  async load(extractionId: string): Promise<StoredExtraction | null> {
    const key = ScannedTableExtractor.storageKey(this.deps.userId, extractionId);
    if (!key) return null;
    if (!(await this.deps.storage.exists(key))) return null;
    return JSON.parse((await this.deps.storage.get(key)).toString('utf8')) as StoredExtraction;
  }

  /**
   * Extracts `pages` (all pages when omitted) of the PDF `fileId`. With `extractionId`, the
   * pages replace or extend that extraction, which is how a chunked or repaired extraction
   * accumulates. Re-extracting a page renders it at the recheck resolution.
   */
  async extract(
    input: { fileId: string; pages?: number[]; extractionId?: string; maxPages: number },
    signal: AbortSignal,
  ): Promise<StoredExtraction> {
    const { runtime, workspace, db, storage, userId } = this.deps;
    const previous = input.extractionId ? await this.load(input.extractionId) : null;
    if (input.extractionId && !previous) {
      throw new TableExtractionError(`No extraction "${input.extractionId}" exists for this user.`);
    }
    if (previous && previous.fileId !== input.fileId) {
      throw new TableExtractionError(
        `Extraction "${previous.extractionId}" belongs to file ${previous.fileId}, not ${input.fileId}.`,
      );
    }

    let file = this.deps.materialized?.get(input.fileId);
    if (!file) {
      file = await runtime.materializeAttachment(workspace, input.fileId, userId, db, storage);
      this.deps.materialized?.set(input.fileId, file);
    }
    if (file.mimeType !== 'application/pdf') {
      throw new TableExtractionError(`File ${input.fileId} is ${file.mimeType}; this tool reads PDFs.`);
    }
    const pdfBytes = await fs.readFile(file.path);
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
    } catch (err) {
      throw new TableExtractionError(`File ${input.fileId} could not be opened as a PDF: ${String(err)}`);
    }
    const pageCount = doc.getPageCount();

    const requested = input.pages?.length
      ? [...new Set(input.pages)].sort((a, b) => a - b)
      : Array.from({ length: pageCount }, (_, i) => i + 1);
    const outOfRange = requested.filter((p) => p < 1 || p > pageCount);
    if (outOfRange.length > 0) {
      throw new TableExtractionError(`Pages ${outOfRange.join(', ')} do not exist; the PDF has ${String(pageCount)} pages.`);
    }
    if (requested.length > input.maxPages) {
      throw new TableExtractionError(
        `The PDF has ${String(pageCount)} pages and one call extracts at most ${String(input.maxPages)}. ` +
          `Call again with "pages" in chunks of up to ${String(input.maxPages)}, passing the extractionId from the first call so the chunks accumulate.`,
      );
    }

    const pdfRel = path.relative(workspace.workspaceDir, file.path);
    const resolution = previous ? ['-r', String(RECHECK_DPI)] : ['-scale-to', String(PAGE_LONG_SIDE_PX)];
    const images = await this.renderPages(pdfRel, requested, pageCount, resolution, signal);

    const rawPages = await mapLimit(requested, VISION_CONCURRENCY, async (page) => {
      const image = images.get(page);
      if (!image) {
        return { page, status: 'failed', warnings: ['The page could not be rendered.'], tables: [] } satisfies RawPage;
      }
      const first = await this.readPage(page, image, signal);
      if (first.status !== 'ok') return first;
      return this.recheckLowConfidence(first, doc, pdfRel, signal);
    });

    const merged = new Map<number, RawPage>((previous?.rawPages ?? []).map((p) => [p.page, p]));
    for (const p of rawPages) merged.set(p.page, p);
    const allRaw = [...merged.values()].sort((a, b) => a.page - b.page);

    const table = await this.normalize(allRaw, signal);
    const stored: StoredExtraction = {
      extractionId: previous?.extractionId ?? ScannedTableExtractor.newExtractionId(),
      fileId: input.fileId,
      filename: file.filename,
      pageCount,
      rawPages: allRaw,
      table,
    };
    await storage.put(
      ScannedTableExtractor.storageKey(userId, stored.extractionId)!,
      Buffer.from(JSON.stringify(stored)),
      'application/json',
    );
    return stored;
  }

  /** Runs a skill-script analysis over a stored extraction's rows. */
  async analyze(extractionId: string, operations: unknown[], signal: AbortSignal): Promise<unknown> {
    const stored = await this.load(extractionId);
    if (!stored) throw new TableExtractionError(`No extraction "${extractionId}" exists for this user.`);
    const res = await this.deps.runtime.runSkillScriptJson(
      { skill: 'pdf', resource: 'scripts/analyze_table_rows.py' },
      { rows: stored.table.rows, operations },
      this.deps.workspace,
      this.deps.skills,
      signal,
    );
    if (!res.ok) throw new TableExtractionError(`Row analysis failed: ${res.error}`);
    return res.output;
  }

  private async normalize(rawPages: RawPage[], signal: AbortSignal): Promise<NormalizedTable> {
    const res = await this.deps.runtime.runSkillScriptJson(
      { skill: 'pdf', resource: 'scripts/normalize_table_rows.py' },
      { pages: rawPages, lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD },
      this.deps.workspace,
      this.deps.skills,
      signal,
    );
    if (!res.ok) throw new TableExtractionError(`Row normalisation failed: ${res.error}`);
    return res.output as NormalizedTable;
  }

  /** Renders pages to PNG in the sandbox and reads them back, leaving nothing in output/. */
  private async renderPages(
    pdfRel: string,
    pages: number[],
    pageCount: number,
    resolution: string[],
    signal: AbortSignal,
  ): Promise<Map<number, Buffer>> {
    const { runtime, workspace } = this.deps;
    const width = String(pageCount).length;
    const prefix = `tx_${Date.now().toString(36)}`;
    const images = new Map<number, Buffer>();
    for (const [from, to] of renderBatches(pages)) {
      const names: string[] = [];
      for (let p = from; p <= to; p++) names.push(`${prefix}-${String(p).padStart(width, '0')}.${IMAGE_EXT}`);
      const res = await runtime.executeControlledCli(
        'pdftoppm',
        [...resolution, ...RENDER_FORMAT, '-f', String(from), '-l', String(to), pdfRel, `output/${prefix}`],
        { cwd: workspace.workspaceDir, expectedOutputs: names, timeoutMs: 60_000, signal },
      );
      if (res.exitCode !== 0) log.warn({ from, to, stderr: res.stderr }, 'pdftoppm failed for a page batch');
      for (let p = from; p <= to; p++) {
        const file = path.join(workspace.outputDir, names[p - from]!);
        try {
          images.set(p, await fs.readFile(file));
        } catch {
          // Reported as a failed page by the caller.
        }
        await fs.rm(file, { force: true });
      }
    }
    return images;
  }

  private async renderCrop(
    pdfRel: string,
    page: number,
    region: SourceRegion,
    doc: PDFDocument,
    signal: AbortSignal,
  ): Promise<Buffer | null> {
    const { runtime, workspace } = this.deps;
    const { width, height } = doc.getPage(page - 1).getSize();
    const scale = RECHECK_DPI / 72;
    const name = `tx_crop_${Date.now().toString(36)}_${String(page)}`;
    const res = await runtime.executeControlledCli(
      'pdftoppm',
      [
        '-r', String(RECHECK_DPI), ...RENDER_FORMAT, '-f', String(page), '-l', String(page),
        '-x', String(Math.floor(region.x * width * scale)),
        '-y', String(Math.floor(region.y * height * scale)),
        '-W', String(Math.ceil(region.width * width * scale)),
        '-H', String(Math.ceil(region.height * height * scale)),
        '-singlefile', pdfRel, `output/${name}`,
      ],
      { cwd: workspace.workspaceDir, expectedOutputs: [`${name}.${IMAGE_EXT}`], timeoutMs: 60_000, signal },
    );
    const file = path.join(workspace.outputDir, `${name}.${IMAGE_EXT}`);
    try {
      return res.exitCode === 0 ? await fs.readFile(file) : null;
    } catch {
      return null;
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  /** One vision read, retried once when the reply is not the contract. */
  private async ask(image: Buffer, prompt: string, signal: AbortSignal): Promise<VisionReply | string> {
    const describe = this.deps.visionProvider.describeMedia?.bind(this.deps.visionProvider);
    if (!describe) return 'No vision provider is configured.';
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await describe([{ mimeType: IMAGE_MIME, base64: image.toString('base64') }], prompt, signal);
        const reply = parseVisionReply(text);
        if (reply) return reply;
        lastError = 'The vision model did not return rows in the required format.';
      } catch (err) {
        if (signal.aborted) throw err;
        lastError = `The vision call failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return lastError;
  }

  private async readPage(page: number, image: Buffer, signal: AbortSignal): Promise<RawPage> {
    const reply = await this.ask(image, pagePrompt(page), signal);
    if (typeof reply === 'string') return { page, status: 'failed', warnings: [reply], tables: [] };
    return { page, status: 'ok', warnings: reply.warnings, tables: toRawRows(reply) };
  }

  /**
   * Pass 2. The region covering every low-confidence row is rendered again at a higher
   * resolution and read again. The recheck replaces the rows in that region only when it
   * finds the same number of rows there; otherwise the first reading stays, still flagged, and
   * the disagreement is a page warning.
   */
  private async recheckLowConfidence(
    page: RawPage,
    doc: PDFDocument,
    pdfRel: string,
    signal: AbortSignal,
  ): Promise<RawPage> {
    const flat = page.tables.flatMap((t, ti) => t.rows.map((r, ri) => ({ r, ti, ri })));
    const weak = flat.filter(({ r }) => !r.isHeader && r.confidence < LOW_CONFIDENCE_THRESHOLD);
    if (weak.length === 0) return page;

    const boxes = weak.map(({ r }) => r.sourceRegion);
    const region: SourceRegion = boxes.every(Boolean)
      ? (() => {
          const x0 = Math.max(0, Math.min(...boxes.map((b) => b!.x)) - REGION_PADDING);
          const y0 = Math.max(0, Math.min(...boxes.map((b) => b!.y)) - REGION_PADDING);
          const x1 = Math.min(1, Math.max(...boxes.map((b) => b!.x + b!.width)) + REGION_PADDING);
          const y1 = Math.min(1, Math.max(...boxes.map((b) => b!.y + b!.height)) + REGION_PADDING);
          return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        })()
      : { x: 0, y: 0, width: 1, height: 1 };

    const inRegion = flat.filter(({ r }) => {
      if (r.isHeader) return false;
      if (!r.sourceRegion) return region.width === 1 && region.height === 1;
      const cy = r.sourceRegion.y + r.sourceRegion.height / 2;
      return cy >= region.y && cy <= region.y + region.height;
    });

    const firstRows = inRegion.map(({ r }) => ({ cells: r.cells, confidence: r.confidence }));
    const record = (rec: Omit<RecheckRecord, 'region' | 'firstRows'>, warning?: string): RawPage => ({
      ...page,
      warnings: warning ? [...page.warnings, warning] : page.warnings,
      rechecks: [...(page.rechecks ?? []), { region, firstRows, ...rec }],
    });

    const crop = await this.renderCrop(pdfRel, page.page, region, doc, signal);
    if (!crop) {
      return record(
        { outcome: 'render_failed', secondRows: [], changedRows: 0 },
        'Low-confidence rows could not be re-rendered for a second read.',
      );
    }
    const reply = await this.ask(crop, recheckPrompt(page.page), signal);
    if (typeof reply === 'string') {
      return record({ outcome: 'read_failed', secondRows: [], changedRows: 0 }, `Second read of low-confidence rows failed: ${reply}`);
    }
    const again = toRawRows(reply, region).flatMap((t) => t.rows).filter((r) => !r.isHeader);
    const secondRows = again.map((r) => ({ cells: r.cells, confidence: r.confidence }));
    if (again.length !== inRegion.length) {
      return record(
        { outcome: 'kept_first', secondRows, changedRows: 0 },
        `Second read found ${String(again.length)} rows where the first found ${String(inRegion.length)} in the same region; the first reading is kept and its low-confidence rows stay flagged.`,
      );
    }
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c.trim() === b[i]!.trim());
    let changedRows = 0;
    const tables = page.tables.map((t) => ({ rows: [...t.rows] }));
    inRegion.forEach(({ ti, ri, r }, i) => {
      const next = again[i]!;
      const changed = !same(r.cells, next.cells);
      if (changed) changedRows += 1;
      tables[ti]!.rows[ri] = {
        ...next,
        sourceRegion: next.sourceRegion ?? r.sourceRegion,
        rechecked: true,
        ...(changed ? { firstReading: { cells: r.cells, confidence: r.confidence } } : {}),
      };
    });
    const out = record(
      { outcome: 'replaced', secondRows, changedRows },
      changedRows > 0
        ? `Second read changed ${String(changedRows)} row(s); the higher-resolution reading is used and each changed row keeps its first reading.`
        : undefined,
    );
    return { ...out, tables };
  }
}
