/** The spreadsheet preview contract shared by the file and artifact routes (WP-11). */
import { z } from 'zod';

import { ApiError } from '../errors.js';
import { PREVIEW_MAX_COLUMNS, PREVIEW_MAX_ROWS, previewWorkbook } from '../services/documents/sheetPreview.js';

export { PREVIEW_MAX_COLUMNS, PREVIEW_MAX_ROWS };

/** Parsing is in memory; beyond this a preview would cost more than the download. */
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function isWorkbook(mimeType: string | null | undefined, filename: string): boolean {
  return mimeType === XLSX_MIME || /\.xlsx$/i.test(filename);
}

export const sheetPreviewSchema = z.object({
  sheets: z.array(
    z.object({
      name: z.string(),
      rows: z.array(
        z.array(
          z.object({
            value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
            type: z.enum(['number', 'string', 'boolean', 'date', 'error']).nullable(),
            numFmt: z.string().optional(),
            formula: z.string().optional(),
          }),
        ),
      ),
      rowCount: z.number(),
      columnCount: z.number(),
      truncatedRows: z.boolean(),
      truncatedColumns: z.boolean(),
    }),
  ),
});

export async function readSheets(bytes: Buffer): Promise<Awaited<ReturnType<typeof previewWorkbook>>> {
  try {
    return await previewWorkbook(bytes);
  } catch {
    throw new ApiError('preview_unsupported', { detail: 'This workbook could not be read. Download it instead.' });
  }
}
