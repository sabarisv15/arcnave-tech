/**
 * `extract_scanned_table_rows` and `analyze_table_rows`. Every branch returns a `ToolResult`,
 * never throws: a failed page or a failed check is something the model must see and act on.
 */
import { z } from 'zod';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import {
  EXTRACTION_ID,
  ScannedTableExtractor,
  TableExtractionError,
  type ExtractionDeps,
  type StoredExtraction,
} from '../services/tables/scannedTableExtraction.js';
import { AttachmentNotFoundError, type MaterializedAttachment } from './execution/executionRuntime.js';

/** Rows returned inline to the model. The full array always stays in the stored extraction. */
const MAX_ROWS_IN_RESULT = 500;

const extractInput = z.object({
  fileId: z.string().uuid(),
  pages: z.array(z.number().int().positive()).max(1000).optional(),
  extractionId: z.string().regex(EXTRACTION_ID).optional(),
});

const analyzeInput = z.object({
  extractionId: z.string().regex(EXTRACTION_ID),
  operations: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
});

function result(toolCallId: string, ok: boolean, body: unknown): ToolResult {
  return {
    toolCallId,
    ok,
    content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
  };
}

export function summarizeExtraction(stored: StoredExtraction): Record<string, unknown> {
  const t = stored.table;
  const covered = new Set(stored.rawPages.map((p) => p.page));
  const missingPages = Array.from({ length: stored.pageCount }, (_, i) => i + 1).filter((p) => !covered.has(p));
  const rows = t.rows.slice(0, MAX_ROWS_IN_RESULT).map((r) => ({
    page: r.page,
    rowIndex: r.rowIndex,
    cells: r.cells,
    confidence: r.confidence,
    ...(r.rechecked ? { rechecked: true } : {}),
  }));
  return {
    extractionId: stored.extractionId,
    fileId: stored.fileId,
    filename: stored.filename,
    pageCount: stored.pageCount,
    pagesProcessed: [...covered].sort((a, b) => a - b),
    missingPages,
    failedPages: t.failedPages,
    complete: missingPages.length === 0 && t.failedPages.length === 0,
    header: t.header,
    columnCount: t.columnCount,
    totalRows: t.totalRows,
    pages: t.pages,
    lowConfidenceRows: t.lowConfidenceRows,
    possibleDuplicates: t.possibleDuplicates,
    changedOnRecheck: t.changedOnRecheck ?? [],
    rechecks: stored.rawPages.flatMap((p) =>
      (p.rechecks ?? []).map((r) => ({ page: p.page, outcome: r.outcome, rows: r.firstRows.length, changedRows: r.changedRows })),
    ),
    raggedRows: t.raggedRows,
    droppedHeaderRepeats: t.droppedHeaderRepeats.length,
    rows,
    ...(t.rows.length > rows.length
      ? { rowsTruncated: `Showing ${String(rows.length)} of ${String(t.rows.length)} rows; analyze_table_rows works on all of them.` }
      : {}),
  };
}

export class TableExtractionToolExecutor implements ToolExecutor {
  private readonly extractor: ScannedTableExtractor;

  constructor(
    deps: Omit<ExtractionDeps, 'materialized'>,
    private readonly maxPagesPerCall: number,
  ) {
    this.extractor = new ScannedTableExtractor({ ...deps, materialized: new Map<string, MaterializedAttachment>() });
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    try {
      if (call.name === 'extract_scanned_table_rows') {
        const parsed = extractInput.safeParse(call.input);
        if (!parsed.success) return result(call.id, false, `Invalid input: ${parsed.error.message}`);
        const stored = await this.extractor.extract({ ...parsed.data, maxPages: this.maxPagesPerCall }, signal);
        const summary = summarizeExtraction(stored);
        return result(call.id, true, summary);
      }
      if (call.name === 'analyze_table_rows') {
        const parsed = analyzeInput.safeParse(call.input);
        if (!parsed.success) return result(call.id, false, `Invalid input: ${parsed.error.message}`);
        const out = await this.extractor.analyze(parsed.data.extractionId, parsed.data.operations, signal);
        return result(call.id, true, out);
      }
      return result(call.id, false, `Unknown tool "${call.name}".`);
    } catch (err) {
      if (signal.aborted) throw err;
      if (err instanceof TableExtractionError) return result(call.id, false, err.message);
      if (err instanceof AttachmentNotFoundError) {
        return result(call.id, false, `File ${err.attachmentId} was not found, or you do not have access to it.`);
      }
      return result(call.id, false, `Table extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Permission for the table tools: tool use on, the sandbox granted both the trusted CLI (page
 * rendering) and skill scripts (post-processing), and a provider that can read images.
 */
export function tableExtractionAvailable(
  toolUse: boolean,
  runtime: { can(p: 'trustedCliAllowed' | 'skillScriptAllowed'): boolean },
  visionProvider: { describeMedia?: unknown } | undefined,
  skills: unknown,
): boolean {
  return (
    toolUse &&
    runtime.can('trustedCliAllowed') &&
    runtime.can('skillScriptAllowed') &&
    typeof visionProvider?.describeMedia === 'function' &&
    skills !== undefined
  );
}
