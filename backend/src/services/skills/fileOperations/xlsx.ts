import ExcelJS from 'exceljs';

export interface CellEdit {
  sheet: string;
  cell: string; // e.g. "B2"
  value: unknown;
  type?: 'string' | 'number' | 'boolean' | 'date' | 'formula';
  format?: string;
}

export interface SpreadsheetInspectResult {
  sheetNames: string[];
  totalRows: number;
  cellTypes: Record<string, string>;
}

/**
 * XLSX Skill operations: inspect typed cells, edit selected cells, combine workbooks.
 * Preserves native Excel formatting, formulas, and existing sheets.
 */
export async function inspectSpreadsheet(inputBuffer: Buffer): Promise<SpreadsheetInspectResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(inputBuffer as any);

  const sheetNames = wb.worksheets.map((ws) => ws.name);
  let totalRows = 0;
  const cellTypes: Record<string, string> = {};

  wb.worksheets.forEach((ws) => {
    totalRows += ws.rowCount;
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum <= 5) {
        row.eachCell({ includeEmpty: false }, (cell, colNum) => {
          const key = `${ws.name}!${cell.address}`;
          if (cell.type === ExcelJS.ValueType.Number) cellTypes[key] = 'number';
          else if (cell.type === ExcelJS.ValueType.String) cellTypes[key] = 'string';
          else if (cell.type === ExcelJS.ValueType.Formula) cellTypes[key] = 'formula';
          else if (cell.type === ExcelJS.ValueType.Date) cellTypes[key] = 'date';
          else if (cell.type === ExcelJS.ValueType.Boolean) cellTypes[key] = 'boolean';
          else cellTypes[key] = 'other';
        });
      }
    });
  });

  return {
    sheetNames,
    totalRows,
    cellTypes,
  };
}

export interface SpreadsheetEditResult {
  buffer: Buffer;
  editsApplied: number;
  modifiedSheets: string[];
}

export async function editSpreadsheetCellsWithReport(
  inputBuffer: Buffer,
  edits: CellEdit[],
): Promise<SpreadsheetEditResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(inputBuffer as any);
  const modifiedSheets = new Set<string>();

  for (const edit of edits) {
    const ws = wb.getWorksheet(edit.sheet);
    if (!ws) {
      throw new Error(`Worksheet "${edit.sheet}" not found in workbook.`);
    }

    const cell = ws.getCell(edit.cell);
    if (edit.type === 'formula') {
      const formulaStr = String(edit.value).replace(/^=/, '');
      cell.value = { formula: formulaStr };
    } else if (edit.type === 'date' || edit.value instanceof Date) {
      cell.value = edit.value instanceof Date ? edit.value : new Date(String(edit.value));
      cell.numFmt = edit.format || 'YYYY-MM-DD';
    } else {
      cell.value = edit.value as any;
    }

    if (edit.format && edit.type !== 'date') {
      cell.numFmt = edit.format;
    }
    modifiedSheets.add(edit.sheet);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    editsApplied: edits.length,
    modifiedSheets: Array.from(modifiedSheets),
  };
}

export async function editSpreadsheetCells(
  inputBuffer: Buffer,
  edits: CellEdit[],
): Promise<Buffer> {
  const res = await editSpreadsheetCellsWithReport(inputBuffer, edits);
  return res.buffer;
}

export interface SpreadsheetCombineResult {
  buffer: Buffer;
  totalSheets: number;
  sheetNames: string[];
}

export async function combineWorkbooksWithReport(
  inputBuffers: Buffer[],
): Promise<SpreadsheetCombineResult> {
  if (inputBuffers.length === 0) {
    throw new Error('At least one workbook buffer is required to combine.');
  }

  const targetWb = new ExcelJS.Workbook();
  const seenSheetNames = new Set<string>();
  const finalSheetNames: string[] = [];

  for (let idx = 0; idx < inputBuffers.length; idx++) {
    const srcWb = new ExcelJS.Workbook();
    await srcWb.xlsx.load(inputBuffers[idx]! as any);

    for (const srcSheet of srcWb.worksheets) {
      let sheetName = srcSheet.name;
      if (seenSheetNames.has(sheetName)) {
        sheetName = `${sheetName}_${idx + 1}`.slice(0, 31);
      }
      seenSheetNames.add(sheetName);
      finalSheetNames.push(sheetName);

      const targetSheet = targetWb.addWorksheet(sheetName);
      srcSheet.eachRow({ includeEmpty: true }, (row, rowNum) => {
        const targetRow = targetSheet.getRow(rowNum);
        targetRow.height = row.height;
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          const targetCell = targetRow.getCell(colNum);
          targetCell.value = cell.value;
          targetCell.numFmt = cell.numFmt;
          targetCell.style = { ...cell.style };
        });
      });
    }
  }

  const arrayBuffer = await targetWb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    totalSheets: finalSheetNames.length,
    sheetNames: finalSheetNames,
  };
}

export async function combineWorkbooks(inputBuffers: Buffer[]): Promise<Buffer> {
  const res = await combineWorkbooksWithReport(inputBuffers);
  return res.buffer;
}

