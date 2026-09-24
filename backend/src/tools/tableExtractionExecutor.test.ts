import { describe, expect, it } from 'vitest';

import { summarizeExtraction } from './tableExtractionExecutor.js';

describe('extraction result sent to the model', () => {
  it('carries every row, however many, with no truncation note', () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      page: Math.floor(i / 100) + 1,
      rowIndex: i + 1,
      pageRowIndex: (i % 100) + 1,
      tableIndex: 0,
      cells: [`r${String(i + 1)}`],
      confidence: 0.9,
    }));
    const summary = summarizeExtraction({
      extractionId: 'tx_202609_0123456789abcdef',
      fileId: 'f',
      filename: 'x.pdf',
      pageCount: 12,
      rawPages: Array.from({ length: 12 }, (_, i) => ({ page: i + 1, status: 'ok', warnings: [], tables: [] })),
      table: {
        header: null, headersSeen: [], droppedHeaderRepeats: [], rows, totalRows: 1200, columnCount: 1,
        pages: [], failedPages: [], lowConfidenceRows: [], possibleDuplicates: [], raggedRows: [],
      },
    } as never);
    expect((summary.rows as unknown[]).length).toBe(1200);
    expect(summary).not.toHaveProperty('rowsTruncated');
  });
});
