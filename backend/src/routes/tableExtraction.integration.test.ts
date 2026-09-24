/**
 * Phase 3 acceptance, locally: a scanned PDF (no text layer) and the original natural prompt.
 * The model is faked but every tool is real: the router's catalog, search_tools, load_skill,
 * pdftoppm in the process sandbox, the page-by-page vision calls (answered by a fake vision
 * provider that returns what a vision model would), the skill scripts, and the storage-backed
 * extraction.
 *
 * `ENABLE_RUN_PYTHON` is off throughout: extraction must not depend on arbitrary code (G20).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AttachmentBlock, GenerationRequest, ToolResult } from '../providers/types.js';
import { buildScannedPdf, imageSize, PAGE_HEIGHT_PT, pageWidthPt } from '../test/fixtures/scannedPdf.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, signUp } from '../test/harness.js';

const HEADER = ['Date', 'Narration', 'Debit', 'Credit', 'Balance'];
const STATEMENT: string[][][] = [
  [
    HEADER,
    ['', 'Opening balance', '', '', '1000.00'],
    ['01/04', 'UPI/RAVI KUMAR/Rent', '500.00', '', '500.00'],
    ['02/04', 'SALARY CREDIT ACME LTD', '', '3000.00', '3500.00'],
    ['03/04', 'ATM WDL', '200.00', '', '3300.00'],
  ],
  [
    HEADER,
    ['05/04', 'NEFT/SUNITA TRADERS', '1000.00', '', '2300.00'],
    ['06/04', 'SMS CHARGES', '15.00', '', '2285.00'],
  ],
  [
    HEADER,
    ['08/04', 'UPI/MOHAN STORES', '85.00', '', '2200.00'],
    ['09/04', 'INTEREST CREDIT', '', '50.00', '2250.00'],
    ['Debits: 5   Credits: 2'],
  ],
];
const PROMPT = 'Count every transaction exactly and classify them with party name and without party name.';

/** What a vision model returns for one page: every table row, with a box per row. */
function pageReply(page: number, overrides: { confidence?: Record<number, number>; cells?: Record<number, string[]> } = {}): string {
  const rows = STATEMENT[page - 1]!.filter((cells) => cells.length === HEADER.length).map((cells, r) => ({
    cells: overrides.cells?.[r] ?? cells,
    confidence: overrides.confidence?.[r] ?? 0.97,
    isHeader: r === 0,
    box: [0.03, (30 + r * 18 - 10) / 400, 0.9, (30 + r * 18 + 4) / 400],
  }));
  return JSON.stringify({ tables: [{ rows }], warnings: [] });
}

let ctx: TestContext;
let user: TestUser;
const visionCalls: Array<{ prompt: string; width: number; height: number }> = [];

beforeAll(async () => {
  ctx = await createTestApp({
    ENABLE_TOOL_USE: 'true',
    ENABLE_SKILLS: 'true',
    ENABLE_RUN_PYTHON: 'false',
    ENABLE_TRUSTED_CLI: 'true',
    ENABLE_SKILL_SCRIPTS: 'true',
    SANDBOX_ENGINE: 'process',
    MAX_UPLOAD_BYTES: String(8 * 1024 * 1024),
  });
  user = await signUp(ctx);

  const page3Reads = { n: 0 };
  ctx.provider.mediaHandler = async (parts: AttachmentBlock[], prompt: string) => {
    const { width, height } = imageSize(parts[0]!.base64!);
    expect(parts[0]!.mimeType).toBe('image/jpeg');
    visionCalls.push({ prompt, width, height });
    // Upload-time OCR of the scanned PDF (retrieval), not part of the extraction.
    if (!prompt.includes('Extract every table row')) return 'scanned statement text';
    const page = Number(/page (\d+)/.exec(prompt)![1]);
    if (prompt.includes('enlarged crop')) {
      // Pass 2 on page 2: the low-confidence row, read again from the crop.
      return JSON.stringify({
        tables: [{ rows: [{ cells: STATEMENT[1]![1], confidence: 0.96, isHeader: false, box: [0, 0.1, 1, 0.9] }] }],
        warnings: [],
      });
    }
    if (page === 2) return pageReply(2, { confidence: { 1: 0.45 } });
    if (page === 3) {
      page3Reads.n += 1;
      // First read misreads a balance; the re-extraction reads it correctly.
      if (page3Reads.n === 1) return pageReply(3, { cells: { 1: ['08/04', 'UPI/MOHAN STORES', '85.00', '', '2220.00'] } });
    }
    return pageReply(page);
  };
});

afterEach(() => {
  ctx.provider.onRequest = null;
});

afterAll(async () => {
  await ctx.close();
});

async function uploadPdf(): Promise<string> {
  const part = multipart('kvbfedral.pdf', await buildScannedPdf(STATEMENT), 'application/pdf');
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: { ...part.headers, cookie: user.cookie },
    payload: part.payload,
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function generate(payload: Record<string, unknown>): Promise<void> {
  const chat = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers: { cookie: user.cookie },
    payload: { title: 'New conversation' },
  });
  const chatId = (chat.json() as { id: string }).id;
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${chatId}/generate`,
    headers: { cookie: user.cookie },
    payload,
  });
  expect(response.statusCode).toBe(200);
}

const flat = (r: ToolResult): string =>
  r.content.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c.data))).join('');
const json = (r: ToolResult): Record<string, any> =>
  JSON.parse((r.content[0] as { text: string }).text) as Record<string, any>;

describe('scanned table extraction, end to end (Phase 3 acceptance)', () => {
  it('model → load_skill(pdf) → search_tools → extract → reconcile → repair → verified counts', async () => {
    const fileId = await uploadPdf();
    const trace: Array<{ name: string; result: ToolResult }> = [];
    let exposed: string[] = [];

    ctx.provider.onRequest = async (request: GenerationRequest) => {
      if (trace.length > 0 || !request.toolExecutor) return;
      exposed = (request.tools ?? []).map((t) => t.name);
      const call = async (name: string, input: Record<string, unknown>) => {
        const result = await request.toolExecutor!.execute({ id: `c${String(trace.length)}`, name, input }, request.signal);
        trace.push({ name, result });
        return result;
      };

      await call('load_skill', { name: 'pdf' });
      await call('search_tools', { query: 'extract table rows from scanned pdf' });
      const first = json(await call('extract_scanned_table_rows', { fileId }));
      const checks = (expectedDebits: number) => [
        { op: 'count', name: 'transactions', where: [{ column: 0, test: 'nonEmpty' }] },
        { op: 'count', name: 'debits', where: [{ column: 2, test: 'nonEmpty' }], expected: expectedDebits },
        { op: 'count', name: 'credits', where: [{ column: 3, test: 'nonEmpty' }], expected: 2 },
        { op: 'count', name: 'with party name', where: [{ column: 1, test: 'matches', value: '^(UPI|NEFT)/' }] },
        { op: 'count', name: 'without party name', where: [{ column: 0, test: 'nonEmpty' }, { column: 1, test: 'notMatches', value: '^(UPI|NEFT)/' }] },
        { op: 'running_balance', name: 'balance', balanceColumn: 4, increaseColumn: 3, decreaseColumn: 2 },
      ];
      const failed = json(await call('analyze_table_rows', { extractionId: first.extractionId, operations: checks(5) }));
      await call('extract_scanned_table_rows', { fileId, pages: failed.suspiciousPages, extractionId: first.extractionId });
      await call('analyze_table_rows', { extractionId: first.extractionId, operations: checks(5) });
    };
    visionCalls.length = 0;
    await generate({ prompt: PROMPT, attachmentIds: [fileId] });

    // The model starts with discovery only; the table tools are reachable, run_python is not.
    expect(exposed).toEqual(['search_tools', 'load_skill']);
    expect(trace.map((t) => t.name)).toEqual([
      'load_skill',
      'search_tools',
      'extract_scanned_table_rows',
      'analyze_table_rows',
      'extract_scanned_table_rows',
      'analyze_table_rows',
    ]);
    expect(trace.every((t) => t.result.ok)).toBe(true);
    expect(flat(trace[0]!.result)).toContain('Exact and Exhaustive Work');
    const found = flat(trace[1]!.result);
    expect(found).toContain('extract_scanned_table_rows');
    expect(found).not.toContain('run_python');

    // Every page was rendered and read on its own: the image width identifies the page.
    const firstPass = visionCalls.filter((c) => c.prompt.includes('of a scanned document. Extract'));
    expect(firstPass.map((c) => Number(/page (\d+)/.exec(c.prompt)![1]))).toEqual(expect.arrayContaining([1, 2, 3]));
    for (const c of firstPass.slice(0, 3)) {
      const page = Number(/page (\d+)/.exec(c.prompt)![1]);
      // Long side scaled to 2000 px; the page's own aspect ratio sets the other side.
      expect(c.width).toBe(2000);
      expect(Math.abs(c.height - (2000 * PAGE_HEIGHT_PT) / pageWidthPt(page))).toBeLessThanOrEqual(1);
    }

    const first = json(trace[2]!.result);
    expect(first.complete).toBe(true);
    expect(first.pagesProcessed).toEqual([1, 2, 3]);
    expect(first.header).toEqual(HEADER);
    expect(first.droppedHeaderRepeats).toBe(2);
    expect(first.totalRows).toBe(8);
    expect(first.rows.every((r: { page: number }) => [1, 2, 3].includes(r.page))).toBe(true);
    expect(first.rows.map((r: { rowIndex: number }) => r.rowIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Pass 2 re-read page 2's weak row from a high-resolution crop and replaced it.
    expect(visionCalls.some((c) => c.prompt.includes('enlarged crop') && c.prompt.includes('page 2'))).toBe(true);
    const sunita = first.rows.find((r: { cells: string[] }) => r.cells[1] === 'NEFT/SUNITA TRADERS');
    expect(sunita).toMatchObject({ page: 2, confidence: 0.96, rechecked: true });
    expect(first.lowConfidenceRows).toEqual([]);
    // Both readings are kept: the recheck is recorded, and the unchanged row has no firstReading.
    expect(first.rechecks).toEqual([{ page: 2, outcome: 'replaced', rows: 1, changedRows: 0 }]);
    expect(first.changedOnRecheck).toEqual([]);

    // Reconciliation catches the misread balance and names the page.
    const failed = json(trace[3]!.result);
    expect(failed.allPassed).toBe(false);
    expect(failed.failed).toEqual(['balance']);
    expect(failed.suspiciousPages).toEqual([3]);

    // The repaired page was re-rendered at the recheck resolution.
    const reRead = visionCalls.filter((c) => c.prompt.includes('page 3 of a scanned document'));
    expect(reRead).toHaveLength(2);
    expect(reRead[1]!.width).toBe(Math.ceil((pageWidthPt(3) * 300) / 72));

    const verified = json(trace[5]!.result);
    expect(verified.allPassed).toBe(true);
    const value = (name: string) => verified.results.find((r: { name: string }) => r.name === name);
    expect(value('transactions').value).toBe(7);
    expect(value('debits')).toMatchObject({ value: 5, status: 'pass' });
    expect(value('credits')).toMatchObject({ value: 2, status: 'pass' });
    expect(value('with party name').value).toBe(3);
    expect(value('without party name').value).toBe(4);
    expect(value('balance')).toMatchObject({ status: 'pass', checkedTransitions: 7, mismatchCount: 0 });
  });

  it('reports a page the vision model could not read as failed, never as empty success', async () => {
    const fileId = await uploadPdf();
    const saved = ctx.provider.mediaHandler;
    ctx.provider.mediaHandler = async (parts, prompt) =>
      prompt.includes('page 2 of a scanned document') ? 'I cannot read this page.' : saved!(parts, prompt);
    let result: Record<string, any> | undefined;
    ctx.provider.onRequest = async (request) => {
      if (result || !request.toolExecutor) return;
      result = json(await request.toolExecutor.execute({ id: 'c', name: 'extract_scanned_table_rows', input: { fileId } }, request.signal));
    };
    try {
      await generate({ prompt: PROMPT, attachmentIds: [fileId] });
    } finally {
      ctx.provider.mediaHandler = saved;
    }
    expect(result!.complete).toBe(false);
    expect(result!.failedPages).toEqual([2]);
    expect(result!.pages.find((p: { page: number }) => p.page === 2)).toMatchObject({ status: 'failed', rowCount: 0 });
  });

  it('a second read that changes a row keeps both readings and says so', async () => {
    const fileId = await uploadPdf();
    const saved = ctx.provider.mediaHandler;
    const changed = ['05/04', 'NEFT/SUNITA TRADERS', '1600.00', '', '2300.00'];
    ctx.provider.mediaHandler = async (parts, prompt) =>
      prompt.includes('enlarged crop')
        ? JSON.stringify({ tables: [{ rows: [{ cells: changed, confidence: 0.9, isHeader: false, box: [0, 0.1, 1, 0.9] }] }], warnings: [] })
        : saved!(parts, prompt);
    let result: Record<string, any> | undefined;
    ctx.provider.onRequest = async (request) => {
      if (result || !request.toolExecutor) return;
      result = json(await request.toolExecutor.execute({ id: 'c', name: 'extract_scanned_table_rows', input: { fileId } }, request.signal));
    };
    try {
      await generate({ prompt: PROMPT, attachmentIds: [fileId] });
    } finally {
      ctx.provider.mediaHandler = saved;
    }
    expect(result!.rechecks).toEqual([{ page: 2, outcome: 'replaced', rows: 1, changedRows: 1 }]);
    expect(result!.changedOnRecheck).toEqual([
      { page: 2, rowIndex: 5, first: STATEMENT[1]![1], second: changed },
    ]);
    expect(result!.pages.find((p: { page: number }) => p.page === 2).warnings.join(' ')).toContain('changed 1 row');
  });

  it('refuses a fileId that belongs to someone else', async () => {
    const fileId = await uploadPdf();
    const other = await signUp(ctx, 'Other');
    let result: ToolResult | undefined;
    ctx.provider.onRequest = async (request) => {
      if (result || !request.toolExecutor) return;
      result = await request.toolExecutor.execute({ id: 'c', name: 'extract_scanned_table_rows', input: { fileId } }, request.signal);
    };
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: other.cookie }, payload: { title: 't' } });
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${(chat.json() as { id: string }).id}/generate`,
      headers: { cookie: other.cookie },
      payload: { prompt: PROMPT },
    });
    expect(result!.ok).toBe(false);
    expect((result!.content[0] as { text: string }).text).toContain('not found');
  });
});

describe('table extraction permission (G20)', () => {
  it('is not in the catalog without skill scripts, and run_python never is with Python off', async () => {
    const off = await createTestApp({
      ENABLE_TOOL_USE: 'true',
      ENABLE_SKILLS: 'true',
      ENABLE_TRUSTED_CLI: 'true',
      ENABLE_SKILL_SCRIPTS: 'false',
      SANDBOX_ENGINE: 'process',
    });
    try {
      const u = await signUp(off);
      let found = '';
      off.provider.onRequest = async (request) => {
        if (found || !request.toolExecutor) return;
        const r = await request.toolExecutor.execute({ id: 'c', name: 'search_tools', input: { query: 'extract table rows python' } }, request.signal);
        found = flat(r);
      };
      const chat = await off.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: u.cookie }, payload: { title: 't' } });
      await off.app.inject({
        method: 'POST',
        url: `/v1/chats/${(chat.json() as { id: string }).id}/generate`,
        headers: { cookie: u.cookie },
        payload: { prompt: 'hi' },
      });
      expect(found).not.toBe('');
      expect(found).not.toContain('extract_scanned_table_rows');
      expect(found).not.toContain('run_python');
    } finally {
      await off.close();
    }
  });
});
