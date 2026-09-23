import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { normalizeWorkbookRow, type StructuredWorkbook } from './structuredWorkbook.js';
import type { SpreadsheetSpec } from './types.js';
import { renderSpreadsheet, renderStructuredSpreadsheet } from './xlsxRenderer.js';

describe('Format-Native XLSX Renderer', () => {
  it('renders structured workbook with native numbers, dates, booleans, and formulas', async () => {
    const columns = [
      { key: 'item', label: 'Item', type: 'string' as const },
      { key: 'qty', label: 'Quantity', type: 'integer' as const },
      { key: 'price', label: 'Unit Price', type: 'number' as const, format: '$#,##0.00' },
      { key: 'total', label: 'Total', type: 'formula' as const, format: '$#,##0.00' },
      { key: 'inStock', label: 'In Stock', type: 'boolean' as const },
      { key: 'dateAdded', label: 'Date Added', type: 'date' as const },
    ];

    const rows = [
      normalizeWorkbookRow(columns, {
        item: 'Widget A',
        qty: 10,
        price: 15.5,
        total: '=B2*C2',
        inStock: true,
        dateAdded: '2026-09-23',
      }),
      normalizeWorkbookRow(columns, {
        item: 'Widget B',
        qty: 0,
        price: 99,
        total: '=B3*C3',
        inStock: false,
        dateAdded: '2026-09-24',
      }),
    ];

    const workbook: StructuredWorkbook = {
      title: 'Inventory',
      sheets: [
        {
          name: 'Products',
          columns,
          rows,
          summaryTotals: {
            qty: 10,
            price: 114.5,
          },
        },
      ],
    };

    const buf = await renderStructuredSpreadsheet(workbook);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);

    // Load into ExcelJS to verify cell types directly
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);

    const ws = wb.getWorksheet('Products');
    expect(ws).toBeDefined();

    // Row 1: Header
    expect(ws!.getCell('A1').value).toBe('Item');
    expect(ws!.getCell('B1').value).toBe('Quantity');

    // Row 2: Data 1
    // Item: string
    expect(ws!.getCell('A2').value).toBe('Widget A');
    // Qty: number
    expect(typeof ws!.getCell('B2').value).toBe('number');
    expect(ws!.getCell('B2').value).toBe(10);
    // Price: number
    expect(typeof ws!.getCell('C2').value).toBe('number');
    expect(ws!.getCell('C2').value).toBe(15.5);
    // Total: formula object
    const totalCell = ws!.getCell('D2').value as { formula: string };
    expect(totalCell).toHaveProperty('formula', 'B2*C2');
    // In Stock: boolean
    expect(ws!.getCell('E2').value).toBe(true);
    // Date Added: Date object
    expect(ws!.getCell('F2').value).toBeInstanceOf(Date);

    // Verify numFmt
    expect(ws!.getCell('C2').numFmt).toBe('$#,##0.00');
    expect(ws!.getCell('F2').numFmt).toBe('YYYY-MM-DD');
  });

  it('renders multi-sheet workbooks', async () => {
    const workbook: StructuredWorkbook = {
      sheets: [
        {
          name: 'SheetA',
          columns: [{ key: 'val', label: 'Val', type: 'number' }],
          rows: [normalizeWorkbookRow([{ key: 'val', label: 'Val', type: 'number' }], { val: 1 })],
        },
        {
          name: 'SheetB',
          columns: [{ key: 'text', label: 'Text', type: 'string' }],
          rows: [normalizeWorkbookRow([{ key: 'text', label: 'Text', type: 'string' }], { text: 'hello' })],
        },
      ],
    };

    const buf = await renderStructuredSpreadsheet(workbook);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);

    expect(wb.worksheets).toHaveLength(2);
    expect(wb.getWorksheet('SheetA')).toBeDefined();
    expect(wb.getWorksheet('SheetB')).toBeDefined();
  });

  it('supports custom styling options without forcing defaults', async () => {
    const workbook: StructuredWorkbook = {
      sheets: [
        {
          name: 'Minimal',
          columns: [{ key: 'name', label: 'Name', type: 'string' }],
          rows: [normalizeWorkbookRow([{ key: 'name', label: 'Name', type: 'string' }], { name: 'clean' })],
        },
      ],
    };

    const buf = await renderStructuredSpreadsheet(workbook, {
      defaultStyle: {
        freezeHeader: false,
        headerBg: 'none',
        zebra: false,
      },
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('Minimal')!;
    // Views should not have frozen split
    expect(!ws.views || ws.views.length === 0 || ws.views[0]?.state !== 'frozen').toBe(true);
  });

  it('preserves backward compatibility with legacy SpreadsheetSpec', async () => {
    const legacySpec: SpreadsheetSpec = {
      sheets: [
        {
          name: 'LegacySheet',
          header: ['Name', 'Score', 'Percentage'],
          rows: [
            ['Alice', '95', '95%'],
            ['Bob', '88', '88%'],
          ],
        },
      ],
    };

    const buf = await renderSpreadsheet(legacySpec);
    expect(buf).toBeInstanceOf(Buffer);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('LegacySheet')!;
    expect(ws.getCell('A2').value).toBe('Alice');
    expect(ws.getCell('B2').value).toBe(95);
    expect(ws.getCell('C2').value).toBe(0.95);
  });
});
