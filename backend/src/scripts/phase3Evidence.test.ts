import { describe, expect, it } from 'vitest';

import { isTransaction, mapColumns, num, runningBalance, segmentsFromHeaders, type Row } from './phase3Evidence.js';

const r = (page: number, rowIndex: number, cells: string[]): Row => ({ page, rowIndex, cells, confidence: 1, pageRowIndex: rowIndex, tableIndex: 0 });

describe('phase 3 live evidence checks', () => {
  it('parses amounts to exact paise', () => {
    expect(num('1,23,456.78')).toBe(12345678);
    expect(num('500.00 Dr')).toBe(-50000);
    expect(num('(10)')).toBe(-1000);
    expect(num('')).toBeNull();
    expect(num('12-04')).toBeNull();
  });

  it('maps bank header columns and finds balance breaks by row', () => {
    const c = mapColumns(['Txn Date', 'Particulars', 'Withdrawals', 'Deposits', 'Balance']);
    expect(c).toEqual({ date: 0, narration: 1, debit: 2, credit: 3, balance: 4 });
    const rows = [
      r(1, 1, ['', 'Opening', '', '', '1000.00']),
      r(1, 2, ['1/4', 'A', '100.00', '', '900.00']),
      r(2, 3, ['2/4', 'B', '', '50.00', '960.00']),
    ];
    expect(rows.filter((x) => isTransaction(x, c))).toHaveLength(2);
    const bal = runningBalance(rows, c);
    expect(bal.checked).toBe(2);
    expect(bal.mismatches).toEqual([{ page: 2, rowIndex: 3, expected: '950.00', actual: '960.00', difference: '10.00' }]);
  });

  it('splits pages into statements by the header in effect', () => {
    const segs = segmentsFromHeaders({
      pageCount: 12,
      table: {
        headersSeen: [
          { page: 1, cells: ['Date', 'Narration', 'Debit', 'Credit', 'Balance'] },
          { page: 5, cells: ['Tran Date', 'Particulars', 'Withdrawals', 'Deposits', 'Balance'] },
        ],
      },
    } as never);
    expect(segs.map((s) => [s.from, s.to])).toEqual([[1, 4], [5, 12]]);
  });
});
