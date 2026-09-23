import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderMarkdownExport } from '../services/documents/index.js';
import {
  normalizeWorkbookRow,
  type StructuredWorkbook,
} from '../services/documents/structuredWorkbook.js';
import { renderStructuredSpreadsheet } from '../services/documents/xlsxRenderer.js';
import { inspectDocxStructure } from '../services/skills/fileOperations/docx.js';
import { inspectPptxStructure } from '../services/skills/fileOperations/pptx.js';

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

  it('Workflow B: DOCX Document Summary -> PPTX Presentation Slides Deliverable', async () => {
    // 1. Initial DOCX Document with Executive Sections
    const docxMarkdown =
      '# Executive Summary\n\n' +
      'Our Q2 performance exceeded expectations across cloud operations.\n\n' +
      '# Infrastructure Modernization\n\n' +
      'Migrated 15 legacy services to containerized Cloud Run jobs.\n\n' +
      '# Financial Outlook\n\n' +
      'Projected annual cost savings of $240,000 through optimized resource utilization.';

    const docxBuf = await renderMarkdownExport(docxMarkdown, 'docx');
    expect(docxBuf).toBeInstanceOf(Buffer);

    // 2. DOCX Skill inspects document structure
    const docxStructure = await inspectDocxStructure(docxBuf);
    expect(docxStructure.headings.length).toBeGreaterThanOrEqual(3);

    // 3. Transform headings/sections into Slide presentation markdown
    const slideDeckMarkdown =
      '# Executive Summary\n\n- Performance exceeded expectations across cloud operations\n- Positive revenue momentum in Q2\n\n' +
      '---\n\n' +
      '# Infrastructure Modernization\n\n- Migrated 15 legacy services to containerized Cloud Run\n- Zero-trust network boundaries established\n\n' +
      '---\n\n' +
      '# Financial Outlook\n\n- Projected annual savings: $240,000\n- High ROI on automated deployment infrastructure';

    // 4. PPTX Skill renders format-native presentation
    const pptxBuf = await renderMarkdownExport(slideDeckMarkdown, 'pptx');
    expect(pptxBuf).toBeInstanceOf(Buffer);

    // 5. Inspect and verify generated PPTX
    const pptxStructure = await inspectPptxStructure(pptxBuf);
    expect(pptxStructure.slideCount).toBe(3);
    expect(pptxStructure.titles.some((t) => t.includes('Executive Summary'))).toBe(true);
    expect(pptxStructure.titles.some((t) => t.includes('Infrastructure Modernization'))).toBe(true);
    expect(pptxStructure.titles.some((t) => t.includes('Financial Outlook'))).toBe(true);
  });
});
