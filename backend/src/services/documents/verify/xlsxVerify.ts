/**
 * Post-generation inspector and verifier for Excel (XLSX) files.
 * Verifies workbook integrity, worksheet counts, formula preservation,
 * typed numeric/currency/date cells, and embedded media.
 */

import ExcelJS from 'exceljs';
import type { VerificationResult } from '../types.js';

export async function verifyXlsx(buffer: Buffer): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metrics: Record<string, number | string | boolean> = {
    sheets: 0,
    formulas: 0,
    numbers: 0,
    dates: 0,
    currencies: 0,
    images: 0,
  };

  if (!Buffer.isBuffer(buffer) || buffer.length < 500) {
    return {
      ok: false,
      errors: ['Invalid XLSX buffer: Buffer is null or smaller than minimum OOXML size.'],
      warnings,
      metrics,
    };
  }

  // 1. Magic number check: PK\x03\x04
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    return {
      ok: false,
      errors: ['Invalid XLSX header: Missing standard ZIP/OOXML magic bytes PK\\x03\\x04.'],
      warnings,
      metrics,
    };
  }

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    metrics.sheets = wb.worksheets.length;
    if (wb.worksheets.length === 0) {
      errors.push('XLSX workbook has 0 worksheets.');
    }

    let formulaCount = 0;
    let numberCount = 0;
    let dateCount = 0;
    let currencyCount = 0;
    let totalImages = 0;

    for (const ws of wb.worksheets) {
      // Check images
      const images = ws.getImages?.();
      if (images) totalImages += images.length;

      ws.eachRow((row) => {
        row.eachCell((cell) => {
          const val = cell.value;
          if (val && typeof val === 'object' && 'formula' in val) {
            formulaCount++;
          }
          if (typeof val === 'number') {
            numberCount++;
          }
          if (val instanceof Date) {
            dateCount++;
          }
          if (cell.numFmt && (cell.numFmt.includes('$') || cell.numFmt.includes('\u20B9') || cell.numFmt.includes('\u20AC'))) {
            currencyCount++;
          }
        });
      });
    }

    metrics.formulas = formulaCount;
    metrics.numbers = numberCount;
    metrics.dates = dateCount;
    metrics.currencies = currencyCount;
    metrics.images = totalImages;
  } catch (err: unknown) {
    errors.push(`Failed to inspect XLSX workbook: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}
