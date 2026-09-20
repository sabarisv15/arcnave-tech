/**
 * Format-native Excel (XLSX) deliverable renderer.
 * Produces structured workbooks with live formula preservation,
 * typed numeric/percentage/currency/date cells, frozen headers, zebra striping,
 * auto-width columns, multiple worksheets, and narrative notes.
 */

import ExcelJS from 'exceljs';
import { resolveArtifactImage } from './images.js';
import type { SpreadsheetSpec } from './types.js';

export async function renderSpreadsheet(spec: SpreadsheetSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ArcNave';
  wb.created = new Date();

  for (const sheetSpec of spec.sheets) {
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
        parsedValues.map((p) => (p.formula ? { formula: p.formula } : p.value)),
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
            // Add row space for image
            ws.addRow([]);
            ws.addRow([]);
            ws.addRow([]);
            ws.addRow([]);
            continue;
          }
        }

        const noteRow = ws.addRow([`Note: ${note}`]);
        noteRow.getCell(1).font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF64748B' } };
      }
    }

    // 4. Auto-fit column widths
    ws.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const val = cell.value;
        const str = typeof val === 'object' && val !== null && 'formula' in val ? `=${val.formula}` : String(val ?? '');
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
