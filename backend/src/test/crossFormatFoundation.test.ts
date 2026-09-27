import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderMarkdownExport } from '../services/documents/index.js';
import {
  normalizeWorkbookRow,
  type StructuredWorkbook,
} from '../services/documents/structuredWorkbook.js';
import { renderStructuredSpreadsheet } from '../services/documents/xlsxRenderer.js';

describe('Cross-Format Foundation (Multi-Skill Cooperating Workflows)', () => {
  it('Workflow A: PDF Tabular Extraction -> XLSX Structured Workbook Deliverable', async () => {
    // 1. Simulating source PDF extracted tabular data
    const extractedPdfRows = [
      { date: '2026-09-01', description: 'Consulting Fee', amount: 5000, balance: 15000 },
      { date: '2026-09-02', description: 'Server Hardware', amount: -1200, balance: 13800 },
      { date: '2026-09-03', description: 'Client Retainer', amount: 3500, balance: 17300 },
    ];

    // 2. Transformed into StructuredWorkbook contract
    const columns = [
      { key: 'date', label: 'Transaction Date', type: 'date' as const },
      { key: 'description', label: 'Description', type: 'string' as const },
      { key: 'amount', label: 'Amount (USD)', type: 'number' as const, format: '$#,##0.00' },
      { key: 'balance', label: 'Ending Balance', type: 'number' as const, format: '$#,##0.00' },
    ];

    const workbook: StructuredWorkbook = {
      title: 'PDF_Extracted_Ledger',
      sheets: [
        {
          name: 'Statement Transactions',
          columns,
          rows: extractedPdfRows.map((r, idx) =>
            normalizeWorkbookRow(columns, {
              ...r,
              _source: { attachmentId: 'att-pdf-1', page: 1, row: idx + 1 },
            }),
          ),
          summaryTotals: {
            amount: 7300,
            balance: 17300,
          },
        },
      ],
      sourceProfile: {
        attachmentIds: ['att-pdf-1'],
        sourceType: 'pdf',
        mimeTypes: ['application/pdf'],
        unitsProcessed: { pages: 1, rows: 3 },
      },
    };

    // 3. Render directly via format-native XLSX renderer
    const xlsxBuf = await renderStructuredSpreadsheet(workbook);
    expect(xlsxBuf).toBeInstanceOf(Buffer);

    // 4. Verify output workbook
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBuf as any);
    const ws = wb.getWorksheet('Statement Transactions');
    expect(ws).toBeDefined();
    expect(ws!.rowCount).toBe(5); // Header + 3 data rows + Summary total row

    // Verify cell types
    expect(ws!.getCell('C2').value).toBe(5000);
    expect(ws!.getCell('C3').value).toBe(-1200);
    expect(ws!.getCell('D2').value).toBe(15000);
    expect(ws!.getCell('A2').value).toBeInstanceOf(Date);
  });
});
