import { z } from 'zod';
import {
  DeliverableWarningSchema,
  SourceReferenceSchema,
  TypedValueSchema,
  ValueFormatSchema,
  type DeliverableWarning,
  type SourceReference,
  type TypedValue,
  type ValueFormat,
} from './primitives.js';
import { SourceProfileSchema, type SourceProfile } from './sourceProfile.js';

export const WorkbookColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z
    .enum(['string', 'number', 'integer', 'date', 'datetime', 'boolean', 'formula', 'null'])
    .default('string'),
  format: z.union([ValueFormatSchema, z.string()]).optional(),
  width: z.number().int().positive().optional(),
});

export type WorkbookColumn = z.infer<typeof WorkbookColumnSchema>;

/**
 * Explicit workbook cell containing typed value and optional source provenance.
 */
export const WorkbookCellSchema = z.object({
  value: TypedValueSchema,
  source: SourceReferenceSchema.optional(),
});

export type WorkbookCell = z.infer<typeof WorkbookCellSchema>;

/**
 * Explicit workbook row containing typed cells mapped by column key, with optional row provenance.
 */
export const WorkbookRowSchema = z.object({
  cells: z.record(z.string(), WorkbookCellSchema),
  source: SourceReferenceSchema.optional(),
});

export type WorkbookRow = z.infer<typeof WorkbookRowSchema>;

/**
 * Sanitizes worksheet name according to Excel rules:
 * - Max 31 characters
 * - Cannot contain: \ / ? * [ ] :
 * - Cannot be empty
 */
export function sanitizeSheetName(name: string): string {
  if (!name || typeof name !== 'string') return 'Sheet1';
  let sanitized = name.replace(/[\\/?*[\]:]/g, '_').trim();
  if (sanitized.length > 31) {
    sanitized = sanitized.slice(0, 31).trim();
  }
  return sanitized.length > 0 ? sanitized : 'Sheet1';
}

export const WorkbookSheetSchema = z.object({
  name: z.string().min(1).transform(sanitizeSheetName),
  columns: z.array(WorkbookColumnSchema).min(1),
  rows: z.array(WorkbookRowSchema),
  notes: z.array(z.string()).optional(),
  summaryTotals: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export type WorkbookSheet = z.infer<typeof WorkbookSheetSchema>;

export const StructuredWorkbookSchema = z.object({
  title: z.string().optional(),
  creator: z.string().optional(),
  sheets: z.array(WorkbookSheetSchema).min(1),
  sourceProfile: SourceProfileSchema.optional(),
});

export type StructuredWorkbook = z.infer<typeof StructuredWorkbookSchema>;

/**
 * Coerces numeric representations (e.g. "$1,250.00", "₹10,500.50", "15%") into a clean number.
 */
export function coerceNumericCell(val: unknown): number | null {
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (val === null || val === undefined) return null;

  const str = String(val).trim();
  if (str === '') return null;

  // Percentage check: e.g. "12.5%" -> 0.125
  const percentMatch = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(str);
  if (percentMatch) {
    const p = parseFloat(percentMatch[1]!);
    return isNaN(p) ? null : p / 100;
  }

  // Strip currency prefixes/suffixes and commas
  const clean = str
    .replace(/[$€£₹¥]/g, '')
    .replace(/,/g, '')
    .trim();

  if (/^-?\d+(?:\.\d+)?$/.test(clean)) {
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  }

  return null;
}

/**
 * Coerces date representations to standard YYYY-MM-DD string.
 */
export function coerceDateCell(val: unknown): string | null {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val !== 'string') return null;

  const str = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // Common DD/MM/YYYY or DD-MM-YYYY format check
  const dmyMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(str);
  if (dmyMatch) {
    const day = dmyMatch[1]!.padStart(2, '0');
    const month = dmyMatch[2]!.padStart(2, '0');
    const year = dmyMatch[3]!;
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Normalizes a raw row (either a WorkbookRow, a plain Record, or an array) into a standard WorkbookRow.
 */
export function normalizeWorkbookRow(
  columns: WorkbookColumn[],
  rawRow: unknown,
): WorkbookRow {
  if (
    rawRow &&
    typeof rawRow === 'object' &&
    'cells' in rawRow &&
    typeof (rawRow as any).cells === 'object'
  ) {
    return rawRow as WorkbookRow;
  }

  const cells: Record<string, WorkbookCell> = {};
  let rowSource: SourceReference | undefined;

  // Check if rawRow has attached source
  if (rawRow && typeof rawRow === 'object' && '_source' in rawRow) {
    rowSource = (rawRow as any)._source as SourceReference;
  }

  columns.forEach((col, idx) => {
    let rawVal: unknown;
    let cellSource: SourceReference | undefined = rowSource;

    if (Array.isArray(rawRow)) {
      rawVal = rawRow[idx];
    } else if (rawRow && typeof rawRow === 'object') {
      rawVal = (rawRow as Record<string, unknown>)[col.key] ?? (rawRow as Record<string, unknown>)[col.label];
    }

    // Check if rawVal is already a WorkbookCell
    if (rawVal && typeof rawVal === 'object' && 'value' in rawVal && 'type' in (rawVal as any).value) {
      cells[col.key] = rawVal as WorkbookCell;
      return;
    }

    // Check if rawVal is already a TypedValue
    if (
      rawVal &&
      typeof rawVal === 'object' &&
      'type' in rawVal &&
      'value' in rawVal &&
      ['string', 'number', 'integer', 'boolean', 'date', 'datetime', 'formula', 'null'].includes(
        (rawVal as any).type,
      )
    ) {
      cells[col.key] = { value: rawVal as TypedValue, source: cellSource };
      return;
    }

    if (rawVal === null || rawVal === undefined || rawVal === '') {
      cells[col.key] = { value: { type: 'null', value: null }, source: cellSource };
      return;
    }

    const strVal = String(rawVal).trim();

    // Check if formula (starts with =)
    if (strVal.startsWith('=') || col.type === 'formula') {
      const formulaStr = strVal.startsWith('=') ? strVal.slice(1).trim() : strVal;
      cells[col.key] = {
        value: {
          type: 'formula',
          value: formulaStr,
          format: col.format,
        },
        source: cellSource,
      };
      return;
    }

    if (col.type === 'number' || col.type === 'integer') {
      const num = coerceNumericCell(rawVal);
      if (num !== null) {
        if (col.type === 'integer') {
          cells[col.key] = {
            value: {
              type: 'integer',
              value: Math.round(num),
              format: col.format,
            },
            source: cellSource,
          };
        } else {
          cells[col.key] = {
            value: {
              type: 'number',
              value: num,
              format: col.format ?? (String(num).includes('.') ? '#,##0.00' : '#,##0'),
            },
            source: cellSource,
          };
        }
        return;
      }
    }

    if (col.type === 'date') {
      const dt = coerceDateCell(rawVal);
      if (dt !== null) {
        cells[col.key] = {
          value: {
            type: 'date',
            value: dt,
            format: col.format ?? 'YYYY-MM-DD',
          },
          source: cellSource,
        };
        return;
      }
    }

    if (col.type === 'boolean') {
      if (typeof rawVal === 'boolean') {
        cells[col.key] = { value: { type: 'boolean', value: rawVal }, source: cellSource };
        return;
      }
      const lower = strVal.toLowerCase();
      if (lower === 'true' || lower === 'yes' || lower === '1') {
        cells[col.key] = { value: { type: 'boolean', value: true }, source: cellSource };
        return;
      }
      if (lower === 'false' || lower === 'no' || lower === '0') {
        cells[col.key] = { value: { type: 'boolean', value: false }, source: cellSource };
        return;
      }
    }

    // Default to string
    cells[col.key] = {
      value: {
        type: 'string',
        value: strVal,
        format: col.format,
      },
      source: cellSource,
    };
  });

  return { cells, source: rowSource };
}

/**
 * Creates a unique provenance key for a row if source provenance is available.
 * Rule: Identical data rows are PRESERVED by default unless provenance confirms they are the exact same source element.
 */
function getRowProvenanceKey(row: WorkbookRow): string | null {
  const src = row.source ?? Object.values(row.cells).find((c) => c.source)?.source;
  if (!src || !src.attachmentId) return null;
  return `${src.attachmentId}:${src.page ?? ''}:${src.sheet ?? ''}:${src.table ?? ''}:${src.row ?? ''}`;
}

/**
 * Deterministically merges chunked extractions into a single structured workbook.
 * - Preserves sheet separation and ordering.
 * - Preserves legitimate duplicate source rows (e.g. two $50 deposits on the same day).
 * - Removes ONLY proven chunk-overlap duplicates based on matching provenance.
 * - Combines source profiles, metrics, and warnings.
 */
export function mergeStructuredWorkbookChunks(chunks: StructuredWorkbook[]): StructuredWorkbook {
  if (chunks.length === 0) {
    throw new Error('Cannot merge empty chunks array');
  }
  if (chunks.length === 1) {
    return chunks[0]!;
  }

  const baseTitle = chunks[0]!.title || 'Consolidated Deliverable';
  const baseCreator = chunks[0]!.creator || 'ArcNave';

  const sheetMap = new Map<
    string,
    {
      name: string;
      columns: WorkbookColumn[];
      rows: WorkbookRow[];
      seenProvenance: Set<string>;
      notes: string[];
      summaryTotals?: Record<string, string | number>;
    }
  >();

  const sheetOrder: string[] = [];
  const combinedWarnings: DeliverableWarning[] = [];
  const combinedAttachmentIds = new Set<string>();
  let totalRowsCount = 0;

  for (const chunk of chunks) {
    if (chunk.sourceProfile?.warnings) {
      for (const w of chunk.sourceProfile.warnings) {
        combinedWarnings.push(w);
      }
    }
    if (chunk.sourceProfile?.attachmentIds) {
      for (const id of chunk.sourceProfile.attachmentIds) {
        combinedAttachmentIds.add(id);
      }
    }

    for (const sheet of chunk.sheets) {
      const sanitizedName = sanitizeSheetName(sheet.name);
      let target = sheetMap.get(sanitizedName);

      if (!target) {
        target = {
          name: sanitizedName,
          columns: [...sheet.columns],
          rows: [],
          seenProvenance: new Set<string>(),
          notes: sheet.notes ? [...sheet.notes] : [],
          summaryTotals: sheet.summaryTotals ? { ...sheet.summaryTotals } : undefined,
        };
        sheetMap.set(sanitizedName, target);
        sheetOrder.push(sanitizedName);
      } else {
        if (sheet.notes) {
          for (const note of sheet.notes) {
            if (!target.notes.includes(note)) target.notes.push(note);
          }
        }
        if (sheet.summaryTotals) {
          target.summaryTotals = { ...target.summaryTotals, ...sheet.summaryTotals };
        }
      }

      for (const rawRow of sheet.rows) {
        const normalizedRow = normalizeWorkbookRow(target.columns, rawRow);
        const provKey = getRowProvenanceKey(normalizedRow);

        // Deduplication rule: ONLY deduplicate if proven provenance key matches
        if (provKey && target.seenProvenance.has(provKey)) {
          continue; // Skip proven chunk-boundary duplicate
        }
        if (provKey) {
          target.seenProvenance.add(provKey);
        }

        target.rows.push(normalizedRow);
        totalRowsCount++;
      }
    }
  }

  const mergedSheets: WorkbookSheet[] = sheetOrder.map((name) => {
    const s = sheetMap.get(name)!;
    return {
      name: s.name,
      columns: s.columns,
      rows: s.rows,
      notes: s.notes.length > 0 ? s.notes : undefined,
      summaryTotals: s.summaryTotals,
    };
  });

  const mergedProfile: SourceProfile = {
    attachmentIds: Array.from(combinedAttachmentIds),
    sourceType: chunks[0]!.sourceProfile?.sourceType || 'multi_chunk_extraction',
    mimeTypes: chunks[0]!.sourceProfile?.mimeTypes || ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    unitsProcessed: {
      sheets: mergedSheets.length,
      rows: totalRowsCount,
    },
    warnings: combinedWarnings.length > 0 ? combinedWarnings : undefined,
    metrics: {
      chunksMerged: chunks.length,
      totalRows: totalRowsCount,
    },
  };

  return {
    title: baseTitle,
    creator: baseCreator,
    sheets: mergedSheets,
    sourceProfile: mergedProfile,
  };
}
