/**
 * Independent checks for the Phase 3 live acceptance (`verifyPhase3KvbFederalLive.ts`). They
 * read the stored row array only, never the model's answer, so a count the model got wrong
 * cannot pass by agreeing with itself.
 */
import type { StoredExtraction } from '../services/tables/scannedTableExtraction.js';

/* ------------------------------------------------------------------------------ numbers */

export function num(text: string | undefined): number | null {
  if (!text) return null;
  let s = text.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/dr$/i.test(s)) {
    neg = true;
    s = s.slice(0, -2);
  } else if (/cr$/i.test(s)) s = s.slice(0, -2);
  s = s.replace(/[^0-9.-]/g, '');
  if (!s || s === '-' || s === '.' || (s.indexOf('-') > 0)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  // Paise, so sums compare exactly.
  return Math.round((neg ? -v : v) * 100);
}

/* ------------------------------------------------------------------------------ table checks */

export type Row = StoredExtraction['table']['rows'][number];

export interface Columns {
  date: number | null;
  narration: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

export function mapColumns(header: string[] | null): Columns {
  const find = (re: RegExp) => {
    const i = (header ?? []).findIndex((h) => re.test(h));
    return i >= 0 ? i : null;
  };
  return {
    date: find(/date/i),
    narration: find(/narration|particular|description|details|remark/i),
    debit: find(/debit|withdraw|\bdr\b/i),
    credit: find(/credit|deposit|\bcr\b/i),
    balance: find(/balance/i),
  };
}

export function isTransaction(r: Row, c: Columns): boolean {
  const d = c.debit !== null ? num(r.cells[c.debit]) : null;
  const k = c.credit !== null ? num(r.cells[c.credit]) : null;
  return (d !== null && d !== 0) || (k !== null && k !== 0);
}

export function runningBalance(rows: Row[], c: Columns) {
  const mismatches: Array<{ page: number; rowIndex: number; expected: string; actual: string; difference: string }> = [];
  let prev: number | null = null;
  let checked = 0;
  if (c.balance === null) return { checked, mismatches, available: false };
  for (const r of rows) {
    const bal = num(r.cells[c.balance]);
    if (bal === null) continue;
    if (prev !== null && isTransaction(r, c)) {
      const dr = c.debit !== null ? Math.abs(num(r.cells[c.debit]) ?? 0) : 0;
      const cr = c.credit !== null ? num(r.cells[c.credit]) ?? 0 : 0;
      const expected: number = prev + cr - dr;
      checked += 1;
      if (expected !== bal) {
        mismatches.push({
          page: r.page,
          rowIndex: r.rowIndex,
          expected: (expected / 100).toFixed(2),
          actual: (bal / 100).toFixed(2),
          difference: ((bal - expected) / 100).toFixed(2),
        });
      }
    }
    prev = bal;
  }
  return { checked, mismatches, available: true };
}

/** Pages grouped by the header in effect, in page order: one group per statement. */
export function segmentsFromHeaders(stored: StoredExtraction): Array<{ from: number; to: number; header: string[] }> {
  const heads = [...stored.table.headersSeen].sort((a, b) => a.page - b.page);
  const out: Array<{ from: number; to: number; header: string[] }> = [];
  for (const h of heads) {
    const key = h.cells.join('|').toLowerCase();
    const last = out.at(-1);
    if (last && last.header.join('|').toLowerCase() === key) continue;
    if (last) last.to = h.page - 1;
    out.push({ from: h.page, to: stored.pageCount, header: h.cells });
  }
  return out;
}

