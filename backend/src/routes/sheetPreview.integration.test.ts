/**
 * The spreadsheet preview (WP-11): typed cells for every sheet, bounded, and never for a file
 * that is not a workbook or belongs to someone else.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments } from '../db/schema.js';
import { PREVIEW_MAX_COLUMNS, PREVIEW_MAX_ROWS } from '../services/documents/sheetPreview.js';
import { generateStorageKey } from '../services/storage.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function stored(bytes: Buffer, filename: string, mimeType: string, owner = user): Promise<string> {
  const key = generateStorageKey(owner.id);
  await ctx.app.services.storage.put(key, bytes, mimeType);
  const [row] = await ctx.db
    .insert(attachments)
    .values({ userId: owner.id, filename, mimeType, sizeBytes: bytes.length, storageKey: key })
    .returning();
  return row!.id;
}

async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sales = wb.addWorksheet('Sales');
  sales.addRow(['Region', 'Q1', 'Share', 'Opened', 'Total']);
  sales.addRow(['Chennai', 1200.5, 0.25, new Date('2026-01-15T00:00:00Z'), { formula: 'B2*2', result: 2401 }]);
  sales.getCell('C2').numFmt = '0.00%';
  const big = wb.addWorksheet('Big');
  for (let r = 0; r < PREVIEW_MAX_ROWS + 5; r++) {
    big.addRow(Array.from({ length: PREVIEW_MAX_COLUMNS + 3 }, (_, c) => r * 100 + c));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('GET /files/:id/preview', () => {
  it('returns every sheet as typed cells, with formats and formulas', async () => {
    const id = await stored(await workbook(), 'sales.xlsx', XLSX);
    const r = await ctx.app.inject({ url: `/v1/files/${id}/preview`, headers: { cookie: user.cookie } });
    expect(r.statusCode).toBe(200);
    const { sheets } = r.json() as { sheets: Array<Record<string, unknown> & { rows: unknown[][] }> };
    expect(sheets.map((s) => s.name)).toEqual(['Sales', 'Big']);

    const [header, row] = sheets[0]!.rows as Array<Array<Record<string, unknown>>>;
    expect(header![0]).toEqual({ value: 'Region', type: 'string' });
    expect(row![1]).toEqual({ value: 1200.5, type: 'number' });
    expect(row![2]).toEqual({ value: 0.25, type: 'number', numFmt: '0.00%' });
    expect(row![3]).toMatchObject({ value: '2026-01-15T00:00:00.000Z', type: 'date' });
    expect(row![4]).toEqual({ value: 2401, type: 'number', formula: 'B2*2' });
    expect(sheets[0]).toMatchObject({ truncatedRows: false, truncatedColumns: false });
  });

  it('cuts a large sheet and says so', async () => {
    const id = await stored(await workbook(), 'big.xlsx', XLSX);
    const r = await ctx.app.inject({ url: `/v1/files/${id}/preview`, headers: { cookie: user.cookie } });
    const big = (r.json() as { sheets: Array<{ rows: unknown[][]; rowCount: number; columnCount: number; truncatedRows: boolean; truncatedColumns: boolean }> }).sheets[1]!;
    expect(big.rows).toHaveLength(PREVIEW_MAX_ROWS);
    expect(big.rows[0]).toHaveLength(PREVIEW_MAX_COLUMNS);
    expect(big).toMatchObject({
      rowCount: PREVIEW_MAX_ROWS + 5,
      columnCount: PREVIEW_MAX_COLUMNS + 3,
      truncatedRows: true,
      truncatedColumns: true,
    });
  });

  it('refuses a file that is not a workbook, with its own code', async () => {
    const id = await stored(Buffer.from('a,b\n1,2\n'), 'plain.csv', 'text/csv');
    const r = await ctx.app.inject({ url: `/v1/files/${id}/preview`, headers: { cookie: user.cookie } });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: { code: 'preview_unsupported' } });
  });

  it('refuses a corrupt workbook with the same code', async () => {
    const id = await stored(Buffer.from('not a zip'), 'broken.xlsx', XLSX);
    const r = await ctx.app.inject({ url: `/v1/files/${id}/preview`, headers: { cookie: user.cookie } });
    expect(r.json()).toMatchObject({ error: { code: 'preview_unsupported' } });
  });

  it('never previews another user’s file', async () => {
    const id = await stored(await workbook(), 'mine.xlsx', XLSX);
    const other = await signUp(ctx);
    const r = await ctx.app.inject({ url: `/v1/files/${id}/preview`, headers: { cookie: other.cookie } });
    expect(r.statusCode).toBe(404);
  });
});
