/**
 * A workbook as the preview panel shows it (WP-11): every sheet's name and its top-left block of
 * cells, typed, with the number format each cell carries. Bounded, so a million-row sheet costs
 * the same to preview as a small one, and says when it was cut.
 */
import ExcelJS from 'exceljs';
import { NUMBERS } from '../../config/numbers.js';

export const PREVIEW_MAX_ROWS = NUMBERS.SHEET_PREVIEW_MAX_ROWS.value; // N-41
export const PREVIEW_MAX_COLUMNS = NUMBERS.SHEET_PREVIEW_MAX_COLUMNS.value; // N-41

export type PreviewCellType = 'number' | 'string' | 'boolean' | 'date' | 'error';

export interface PreviewCell {
  /** The value shown: a formula's cached result, a date as ISO 8601, rich text flattened. */
  value: string | number | boolean | null;
  type: PreviewCellType | null;
  /** Excel number format, e.g. `0.00%`; omitted for General. */
  numFmt?: string;
  /** Present when the cell holds a formula; the value is its last computed result. */
  formula?: string;
}

export interface PreviewSheet {
  name: string;
  rows: PreviewCell[][];
  /** Rows and columns the sheet uses, before the preview cut. */
  rowCount: number;
  columnCount: number;
  truncatedRows: boolean;
  truncatedColumns: boolean;
}

function cellOf(cell: ExcelJS.Cell): PreviewCell {
  const numFmt = cell.numFmt && cell.numFmt !== 'General' ? cell.numFmt : undefined;
  const raw = cell.value;
  const base = (value: PreviewCell['value'], type: PreviewCell['type']): PreviewCell => ({
    value,
    type,
    ...(numFmt ? { numFmt } : {}),
  });

  if (raw === null || raw === undefined) return { value: null, type: null };
  if (typeof raw === 'number') return base(raw, 'number');
  if (typeof raw === 'string') return base(raw, 'string');
  if (typeof raw === 'boolean') return base(raw, 'boolean');
  if (raw instanceof Date) return base(raw.toISOString(), 'date');
  if (typeof raw === 'object') {
    if ('formula' in raw || 'sharedFormula' in raw) {
      const result = (raw as { result?: unknown }).result;
      const formula = (raw as { formula?: string }).formula ?? (raw as { sharedFormula?: string }).sharedFormula;
      const inner = cellValue(result);
      return { ...base(inner.value, inner.type), ...(formula ? { formula } : {}) };
    }
    if ('richText' in raw) return base(raw.richText.map((r) => r.text).join(''), 'string');
    if ('text' in raw && typeof raw.text === 'string') return base(raw.text, 'string'); // hyperlink
    if ('error' in raw) return base(String(raw.error), 'error');
  }
  return base(String(raw), 'string');
}

function cellValue(result: unknown): { value: PreviewCell['value']; type: PreviewCell['type'] } {
  if (result === null || result === undefined) return { value: null, type: null };
  if (typeof result === 'number') return { value: result, type: 'number' };
  if (typeof result === 'boolean') return { value: result, type: 'boolean' };
  if (result instanceof Date) return { value: result.toISOString(), type: 'date' };
  if (typeof result === 'object' && result && 'error' in result) {
    return { value: String((result as { error: unknown }).error), type: 'error' };
  }
  return { value: String(result), type: 'string' };
}

export async function previewWorkbook(bytes: Buffer): Promise<PreviewSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return workbook.worksheets
    .filter((ws) => ws.state !== 'veryHidden')
    .map((ws) => {
      const rowCount = ws.actualRowCount === 0 ? 0 : ws.rowCount;
      const columnCount = ws.actualColumnCount === 0 ? 0 : ws.columnCount;
      const rowsShown = Math.min(rowCount, PREVIEW_MAX_ROWS);
      const colsShown = Math.min(columnCount, PREVIEW_MAX_COLUMNS);
      const rows: PreviewCell[][] = [];
      for (let r = 1; r <= rowsShown; r++) {
        const row = ws.getRow(r);
        const cells: PreviewCell[] = [];
        for (let c = 1; c <= colsShown; c++) cells.push(cellOf(row.getCell(c)));
        rows.push(cells);
      }
      return {
        name: ws.name,
        rows,
        rowCount,
        columnCount,
        truncatedRows: rowCount > PREVIEW_MAX_ROWS,
        truncatedColumns: columnCount > PREVIEW_MAX_COLUMNS,
      };
    });
}
