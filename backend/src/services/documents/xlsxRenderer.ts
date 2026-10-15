/**
 * Format-native Excel (XLSX) deliverable renderer.
 * Produces structured workbooks with live formula preservation,
 * typed numeric/percentage/currency/date cells, optional styling,
 * auto-width columns, multiple worksheets, and narrative notes.
 */

import ExcelJS from 'exceljs';
import { resolveArtifactImage } from './images.js';
import {
  normalizeWorkbookRow,
  type StructuredWorkbook,
  type WorkbookCell,
  type WorkbookRow,
  type WorkbookSheet,
} from './structuredWorkbook.js';
import type { SpreadsheetSpec } from './types.js';

export interface SheetStyleOptions {
  freezeHeader?: boolean;
  headerBg?: string;
  headerColor?: string;
  zebra?: boolean;
}

/**
 * Format-native renderer consuming typed StructuredWorkbook directly into ExcelJS.
 * - Numbers are written as native numbers, not strings.
 * - Dates are converted to real Excel Date objects only at render time.
 * - Formulas are preserved without `=`.
 * - Style metadata is flexible and controlled via Skill/options.
 */
export async function renderStructuredSpreadsheet(
  workbook: StructuredWorkbook,
  options?: { defaultStyle?: SheetStyleOptions },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = workbook.creator || 'ArcNave';
  wb.created = new Date();

  for (const sheet of workbook.sheets) {
    const style: SheetStyleOptions = {
      freezeHeader: true,
      zebra: true,
      ...options?.defaultStyle,
    };

    const ws = wb.addWorksheet(sheet.name, {
      views: style.freezeHeader ? [{ state: 'frozen', ySplit: 1 }] : [],
    });

    // 1. Header Row
    const headerRow = ws.addRow(sheet.columns.map((c) => c.label));
    headerRow.height = 24;

    const bgArgb = style.headerBg && style.headerBg !== 'none'
      ? (style.headerBg.startsWith('#') ? 'FF' + style.headerBg.slice(1).toUpperCase() : style.headerBg)
      : (style.headerBg === 'none' ? undefined : 'FF1E293B');

    const colorArgb = style.headerColor
      ? (style.headerColor.startsWith('#') ? 'FF' + style.headerColor.slice(1).toUpperCase() : style.headerColor)
      : 'FFFFFFFF';

    headerRow.eachCell((cell) => {
      if (bgArgb) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgArgb },
        };
      }
      cell.font = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: bgArgb ? { argb: colorArgb } : undefined,
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      };
    });

    // 2. Data Rows
    sheet.rows.forEach((rawRow, rIdx) => {
      const isZebra = style.zebra && rIdx % 2 === 1;
      const normalizedRow: WorkbookRow =
        rawRow && typeof rawRow === 'object' && 'cells' in rawRow
          ? (rawRow as WorkbookRow)
          : normalizeWorkbookRow(sheet.columns, rawRow);

      const cellValues = sheet.columns.map((col) => {
        const cellItem: WorkbookCell | undefined = normalizedRow.cells[col.key];
        const val = cellItem?.value;
        if (!val || val.type === 'null') return null;

        if (val.type === 'formula') {
          return { formula: val.value.replace(/^=/, '') };
        }
        if (val.type === 'date') {
          // Convert serialized YYYY-MM-DD to Date at render boundary
          const d = new Date(val.value + 'T00:00:00Z');
          return isNaN(d.getTime()) ? val.value : d;
        }
        if (val.type === 'datetime') {
          const d = new Date(val.value);
          return isNaN(d.getTime()) ? val.value : d;
        }
        return typeof val.value === 'string' ? neutraliseFormulaText(val.value) : val.value;
      });

      const row = ws.addRow(cellValues);
      row.height = 20;

      row.eachCell((cell, colIdx) => {
        const colDef = sheet.columns[colIdx - 1];
        const cellItem: WorkbookCell | undefined = colDef ? normalizedRow.cells[colDef.key] : undefined;
        const val = cellItem?.value;

        // Resolve number format
        let fmtStr: string | undefined;
        const valFormat = val && 'format' in val ? (val as { format?: unknown }).format : undefined;
        if (typeof valFormat === 'string') {
          fmtStr = valFormat;
        } else if (typeof valFormat === 'object' && valFormat !== null && 'numberFormat' in valFormat) {
          fmtStr = (valFormat as { numberFormat?: string }).numberFormat;
        } else if (typeof colDef?.format === 'string') {
          fmtStr = colDef.format;
        } else if (typeof colDef?.format === 'object' && colDef.format !== null && 'numberFormat' in colDef.format) {
          fmtStr = (colDef.format as { numberFormat?: string }).numberFormat;
        }

        if (fmtStr) {
          cell.numFmt = fmtStr;
        } else if (val?.type === 'date') {
          cell.numFmt = 'YYYY-MM-DD';
        } else if (val?.type === 'datetime') {
          cell.numFmt = 'YYYY-MM-DD HH:MM:SS';
        } else if (val?.type === 'number') {
          cell.numFmt = String(val.value).includes('.') ? '#,##0.00' : '#,##0';
        }

        // Alignment
        if (val?.type === 'number' || val?.type === 'integer' || val?.type === 'formula') {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (val?.type === 'boolean') {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }

        cell.font = { name: 'Segoe UI', size: 10 };
        if (isZebra) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
    });

    // 3. Summary totals row if provided
    if (sheet.summaryTotals && Object.keys(sheet.summaryTotals).length > 0) {
      const totalsValues = sheet.columns.map((col, idx) => {
        if (idx === 0 && !sheet.summaryTotals![col.key]) {
          return 'Total';
        }
        const val = sheet.summaryTotals![col.key];
        return val ?? null;
      });

      const totalsRow = ws.addRow(totalsValues);
      totalsRow.height = 22;
      totalsRow.eachCell((cell, colIdx) => {
        const colDef = sheet.columns[colIdx - 1];
        cell.font = { name: 'Segoe UI', size: 10, bold: true };
        if (typeof cell.value === 'number') {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = typeof colDef?.format === 'string' ? colDef.format : '#,##0.00';
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'double', color: { argb: 'FF0F172A' } },
        };
      });
    }

    // 4. Narrative Notes
    if (sheet.notes && sheet.notes.length > 0) {
      ws.addRow([]); // Blank spacer row
      for (const note of sheet.notes) {
        const noteRow = ws.addRow([`Note: ${note}`]);
        noteRow.getCell(1).font = {
          name: 'Segoe UI',
          size: 9,
          italic: true,
          color: { argb: 'FF64748B' },
        };
      }
    }

    // 5. Auto-fit column widths
    ws.columns.forEach((col, colIdx) => {
      const colDef = sheet.columns[colIdx];
      if (colDef?.width) {
        col.width = colDef.width;
        return;
      }

      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const val = cell.value;
        const str =
          typeof val === 'object' && val !== null && 'formula' in val
            ? `=${val.formula}`
            : String(val ?? '');
        if (str.length > maxLen) {
          maxLen = Math.min(50, str.length);
        }
      });
      col.width = maxLen + 4;
    });
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/**
 * Universal spreadsheet renderer: handles both legacy SpreadsheetSpec and modern StructuredWorkbook.
 */
export async function renderSpreadsheet(
  spec: SpreadsheetSpec | StructuredWorkbook,
): Promise<Buffer> {
  // Check if modern StructuredWorkbook
  if (
    'sheets' in spec &&
    spec.sheets.length > 0 &&
    'columns' in (spec.sheets[0] as unknown as Record<string, unknown>)
  ) {
    return renderStructuredSpreadsheet(spec as StructuredWorkbook);
  }

  const legacySpec = spec as SpreadsheetSpec;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ArcNave';
  wb.created = new Date();

  for (const sheetSpec of legacySpec.sheets) {
    const ws = wb.addWorksheet(sheetSpec.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // 1. Header Row
    const headerRow = ws.addRow(sheetSpec.header);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' }, // Dark slate
      };
      cell.font = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      };
    });

    // 2. Data Rows
    sheetSpec.rows.forEach((rowData, rIdx) => {
      const isZebra = rIdx % 2 === 1;
      const parsedValues = rowData.map((raw) => {
        const str = raw.trim();

        // Check if formula: starts with =
        if (str.startsWith('=')) {
          return { formula: str.slice(1) };
        }

        // Check percentage: e.g. 15.5% or -3.2%
        const percentMatch = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(str);
        if (percentMatch) {
          return { value: parseFloat(percentMatch[1]!) / 100, format: '0.0%' };
        }

        // Check currency: e.g. $1,250.00 or €500 or ₹1000
        const currencyMatch = /^[$\u20AC\u00A3\u20B9]\s*(-?[\d,]+(?:\.\d+)?)$/.exec(str);
        if (currencyMatch) {
          const num = parseFloat(currencyMatch[1]!.replace(/,/g, ''));
          if (!isNaN(num)) {
            return { value: num, format: '"$"#,##0.00' };
          }
        }

        // Check ISO date: YYYY-MM-DD
        const dateMatch = /^\d{4}-\d{2}-\d{2}$/.exec(str);
        if (dateMatch) {
          const d = new Date(str);
          if (!isNaN(d.getTime())) {
            return { value: d, format: 'YYYY-MM-DD' };
          }
        }

        // Check standard numbers
        const numClean = str.replace(/,/g, '');
        if (/^-?\d+(?:\.\d+)?$/.test(numClean)) {
          const num = parseFloat(numClean);
          if (!isNaN(num)) {
            return { value: num, format: str.includes('.') ? '#,##0.00' : '#,##0' };
          }
        }

        return { value: raw };
      });

      const row = ws.addRow(
        parsedValues.map((p) => (p.formula ? { formula: p.formula } : typeof p.value === 'string' ? neutraliseFormulaText(p.value) : p.value)),
      );
      row.height = 20;

      row.eachCell((cell, colIdx) => {
        const item = parsedValues[colIdx - 1];
        if (item?.format) {
          cell.numFmt = item.format;
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else if (typeof cell.value === 'number' || item?.formula) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }

        cell.font = { name: 'Segoe UI', size: 10 };
        if (isZebra) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
    });

    // 3. Narrative Notes & Metadata below table
    if (sheetSpec.notes && sheetSpec.notes.length > 0) {
      ws.addRow([]); // Blank row spacer
      for (const note of sheetSpec.notes) {
        // Check if note is an image: ![alt](src)
        const imgMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(note.trim());
        if (imgMatch) {
          const img = await resolveArtifactImage(imgMatch[2]!.trim());
          if (img) {
            const ext = img.mime === 'image/jpeg' ? 'jpeg' : 'png';
            const imgId = wb.addImage({
              buffer: img.buffer as any,
              extension: ext,
            });
            const lastRow = ws.rowCount + 1;
            ws.addImage(imgId, {
              tl: { col: 1, row: lastRow },
              ext: { width: Math.min(400, img.width), height: Math.min(250, img.height) },
            });
            ws.addRow([]);
            ws.addRow([]);
            ws.addRow([]);
            ws.addRow([]);
            continue;
          }
        }

        const noteRow = ws.addRow([`Note: ${note}`]);
        noteRow.getCell(1).font = {
          name: 'Segoe UI',
          size: 9,
          italic: true,
          color: { argb: 'FF64748B' },
        };
      }
    }

    // 4. Auto-fit column widths
    ws.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const val = cell.value;
        const str =
          typeof val === 'object' && val !== null && 'formula' in val
            ? `=${val.formula}`
            : String(val ?? '');
        if (str.length > maxLen) {
          maxLen = Math.min(45, str.length);
        }
      });
      col.width = maxLen + 4;
    });
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/**
 * Stage 9 G13 (OWASP CSV injection): text from a user or a file that starts with `=`, `+`, `-`,
 * `@`, a tab or a carriage return is written with a leading apostrophe, so no spreadsheet program
 * reading this workbook, or a CSV saved from it, runs it as a formula. A formula the model asked
 * for is a `{ formula }` cell and is never passed through here; a plain number is left alone.
 */
export function neutraliseFormulaText(value: string): string {
  if (!/^[=+\-@\t\r]/.test(value)) return value;
  if (/^[+-]?\d[\d,]*(\.\d+)?%?$/.test(value.trim())) return value;
  return `'${value}`;
}
