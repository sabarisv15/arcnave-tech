import { describe, expect, it } from 'vitest';
import {
  coerceDateCell,
  coerceNumericCell,
  mergeStructuredWorkbookChunks,
  normalizeWorkbookRow,
  sanitizeSheetName,
  StructuredWorkbookSchema,
  type StructuredWorkbook,
} from './structuredWorkbook.js';

describe('Structured Workbook (XLSX-Specific)', () => {
  describe('Sheet Name Sanitization', () => {
    it('truncates sheet names longer than 31 characters', () => {
      const longName = 'A'.repeat(50);
      const sanitized = sanitizeSheetName(longName);
      expect(sanitized.length).toBe(31);
    });

    it('replaces disallowed characters in sheet names', () => {
      expect(sanitizeSheetName('Sales:2026/Q1*Final?[1]')).toBe('Sales_2026_Q1_Final__1_');
    });

    it('defaults empty string to Sheet1', () => {
      expect(sanitizeSheetName('')).toBe('Sheet1');
    });
  });

  describe('Numeric Coercion', () => {
    it('handles currency strings with symbols and commas', () => {
      expect(coerceNumericCell('$1,250.00')).toBe(1250);
      expect(coerceNumericCell('₹10,500.50')).toBe(10500.5);
      expect(coerceNumericCell('€500')).toBe(500);
      expect(coerceNumericCell('£99.99')).toBe(99.99);
    });

    it('handles percentages', () => {
      expect(coerceNumericCell('15%')).toBe(0.15);
      expect(coerceNumericCell('-3.5%')).toBe(-0.035);
    });

    it('returns null for non-numeric strings', () => {
      expect(coerceNumericCell('N/A')).toBe(null);
      expect(coerceNumericCell('Deposit')).toBe(null);
      expect(coerceNumericCell(null)).toBe(null);
    });
  });

  describe('Date Coercion', () => {
    it('preserves YYYY-MM-DD', () => {
      expect(coerceDateCell('2026-09-23')).toBe('2026-09-23');
    });

    it('coerces DD/MM/YYYY and DD-MM-YYYY', () => {
      expect(coerceDateCell('23/09/2026')).toBe('2026-09-23');
      expect(coerceDateCell('05-01-2025')).toBe('2025-01-05');
    });

    it('coerces Date instances', () => {
      const d = new Date('2026-09-23T00:00:00.000Z');
      expect(coerceDateCell(d)).toBe('2026-09-23');
    });
  });

  describe('normalizeWorkbookRow', () => {
    const columns = [
      { key: 'date', label: 'Date', type: 'date' as const },
      { key: 'desc', label: 'Description', type: 'string' as const },
      { key: 'amount', label: 'Amount', type: 'number' as const, format: '#,##0.00' },
      { key: 'total', label: 'Total', type: 'formula' as const },
    ];

    it('normalizes object row into typed cell values and preserves row structure', () => {
      const raw = {
        date: '23/09/2026',
        desc: 'Consulting Fee',
        amount: '$5,000.00',
        total: '=SUM(C2:C5)',
      };
      const normalized = normalizeWorkbookRow(columns, raw);

      expect(normalized.cells.date?.value).toEqual({
        type: 'date',
        value: '2026-09-23',
        format: 'YYYY-MM-DD',
      });
      expect(normalized.cells.desc?.value).toEqual({
        type: 'string',
        value: 'Consulting Fee',
        format: undefined,
      });
      expect(normalized.cells.amount?.value).toEqual({
        type: 'number',
        value: 5000,
        format: '#,##0.00',
      });
      expect(normalized.cells.total?.value).toEqual({
        type: 'formula',
        value: 'SUM(C2:C5)',
        format: undefined,
      });
    });

    it('normalizes array row using column index', () => {
      const raw = ['2026-09-23', 'Hardware', '1,200', ''];
      const normalized = normalizeWorkbookRow(columns, raw);

      expect(normalized.cells.date?.value).toEqual({
        type: 'date',
        value: '2026-09-23',
        format: 'YYYY-MM-DD',
      });
      expect(normalized.cells.desc?.value).toEqual({
        type: 'string',
        value: 'Hardware',
        format: undefined,
      });
      expect(normalized.cells.amount?.value).toEqual({
        type: 'number',
        value: 1200,
        format: '#,##0.00',
      });
      expect(normalized.cells.total?.value).toEqual({
        type: 'null',
        value: null,
      });
    });
  });

  describe('mergeStructuredWorkbookChunks & Deduplication Rule', () => {
    it('PRESERVES identical legitimate data rows when provenance is different or absent', () => {
      const chunk1: StructuredWorkbook = {
        sheets: [
          {
            name: 'Ledger',
            columns: [{ key: 'amount', label: 'Amount', type: 'number' }],
            rows: [
              normalizeWorkbookRow([{ key: 'amount', label: 'Amount', type: 'number' }], { amount: 50 }),
            ],
          },
        ],
      };

      const chunk2: StructuredWorkbook = {
        sheets: [
          {
            name: 'Ledger',
            columns: [{ key: 'amount', label: 'Amount', type: 'number' }],
            rows: [
              // Another legitimate $50 transaction
              normalizeWorkbookRow([{ key: 'amount', label: 'Amount', type: 'number' }], { amount: 50 }),
            ],
          },
        ],
      };

      const merged = mergeStructuredWorkbookChunks([chunk1, chunk2]);
      // Both legitimate identical rows must be preserved!
      expect(merged.sheets[0]!.rows).toHaveLength(2);
    });

    it('REMOVES proven chunk-overlap duplicates when provenance matches exactly', () => {
      const col = [{ key: 'id', label: 'ID', type: 'number' as const }];
      const rowChunk1 = normalizeWorkbookRow(col, {
        id: 101,
        _source: { attachmentId: 'att-1', page: 1, row: 5 },
      });
      const rowOverlap = normalizeWorkbookRow(col, {
        id: 101,
        _source: { attachmentId: 'att-1', page: 1, row: 5 }, // Exact same provenance
      });
      const rowChunk2 = normalizeWorkbookRow(col, {
        id: 102,
        _source: { attachmentId: 'att-1', page: 2, row: 1 },
      });

      const chunk1: StructuredWorkbook = {
        sheets: [{ name: 'Data', columns: col, rows: [rowChunk1] }],
        sourceProfile: {
          attachmentIds: ['att-1'],
          sourceType: 'pdf',
          mimeTypes: ['application/pdf'],
          warnings: [{ severity: 'warning', type: 'uncertain_value', message: 'Row 5 was blurry' }],
        },
      };

      const chunk2: StructuredWorkbook = {
        sheets: [{ name: 'Data', columns: col, rows: [rowOverlap, rowChunk2] }],
        sourceProfile: {
          attachmentIds: ['att-1'],
          sourceType: 'pdf',
          mimeTypes: ['application/pdf'],
        },
      };

      const merged = mergeStructuredWorkbookChunks([chunk1, chunk2]);
      expect(merged.sheets[0]!.rows).toHaveLength(2); // Only row 101 (deduped) and row 102
      expect(merged.sourceProfile?.warnings).toHaveLength(1);
    });
  });

  describe('StructuredWorkbookSchema validation', () => {
    it('validates a complete structured workbook with WorkbookRow objects', () => {
      const wb = {
        title: 'Quarterly Report',
        sheets: [
          {
            name: 'Overview',
            columns: [
              { key: 'metric', label: 'Metric', type: 'string' as const },
              { key: 'val', label: 'Value', type: 'number' as const },
            ],
            rows: [
              {
                cells: {
                  metric: { value: { type: 'string' as const, value: 'Revenue' } },
                  val: { value: { type: 'number' as const, value: 100000 } },
                },
              },
            ],
          },
        ],
      };
      const res = StructuredWorkbookSchema.safeParse(wb);
      expect(res.success).toBe(true);
    });
  });
});
