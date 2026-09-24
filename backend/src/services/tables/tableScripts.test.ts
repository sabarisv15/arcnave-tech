/**
 * The two pdf skill scripts behind table extraction (G24), run the way production runs them:
 * through `ExecutionRuntime.runSkillScriptJson` in the process sandbox.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCapabilityRegistry } from '../../capabilities/factory.js';
import { loadConfig } from '../../config.js';
import { ExecutionRuntime } from '../../tools/execution/executionRuntime.js';
import { ProcessSandboxClient } from '../../tools/sandbox/processSandboxClient.js';
import { SkillService } from '../skills.js';

const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x@localhost/x', COOKIE_SECRET: 'x'.repeat(32) });
const skills = new SkillService(path.resolve('.'), 'skills', buildCapabilityRegistry(cfg));
const runtime = new ExecutionRuntime(new ProcessSandboxClient(), undefined, {
  pythonAllowed: false,
  trustedCliAllowed: false,
  skillScriptAllowed: true,
});

async function run(resource: string, input: unknown): Promise<any> {
  await skills.load();
  return runtime.withWorkspace(`scripts_${Date.now()}`, async (ws) => {
    const res = await runtime.runSkillScriptJson({ skill: 'pdf', resource }, input, ws, skills);
    if (!res.ok) throw new Error(res.error);
    return res.output;
  });
}

const row = (page: number, rowIndex: number, cells: string[]) => ({ page, rowIndex, cells, confidence: 0.9 });

describe('analyze_table_rows.py', () => {
  it('parses bracketed, Dr-suffixed and currency-formatted numbers exactly', async () => {
    const out = await run('scripts/analyze_table_rows.py', {
      rows: [row(1, 1, ['₹1,234.50']), row(1, 2, ['(34.50)']), row(2, 3, ['100 Dr']), row(2, 4, ['n/a'])],
      operations: [{ op: 'sum', name: 's', column: 0 }],
    });
    expect(out.results[0].value).toBe('1100.00');
    expect(out.results[0].unparsedCells).toEqual([{ page: 2, rowIndex: 4, cell: 'n/a' }]);
    expect(out.suspiciousPages).toEqual([2]);
  });

  it('a count that differs from the printed figure fails with the difference', async () => {
    const out = await run('scripts/analyze_table_rows.py', {
      rows: [row(1, 1, ['a', '5']), row(1, 2, ['b', '']), row(2, 3, ['c', '7'])],
      operations: [{ op: 'count', name: 'debits', where: [{ column: 1, test: 'nonEmpty' }], expected: 3 }],
    });
    expect(out.results[0]).toMatchObject({ value: 2, expected: 3, difference: -1, status: 'fail' });
    expect(out.allPassed).toBe(false);
    expect(out.failed).toEqual(['debits']);
  });

  it('an unknown op is an error, not a pass', async () => {
    const out = await run('scripts/analyze_table_rows.py', { rows: [], operations: [{ op: 'guess', name: 'g' }] });
    expect(out.results[0].status).toBe('error');
    expect(out.allPassed).toBe(false);
  });
});

describe('normalize_table_rows.py', () => {
  it('drops only exact header repeats and never drops a data row', async () => {
    const header = { cells: ['Date', 'Amt'], confidence: 0.99, isHeader: true };
    const out = await run('scripts/normalize_table_rows.py', {
      lowConfidenceThreshold: 0.8,
      pages: [
        { page: 1, status: 'ok', warnings: [], tables: [{ rows: [header, { cells: ['1/4', ' 5 '], confidence: 0.9 }] }] },
        {
          page: 2,
          status: 'ok',
          warnings: [],
          tables: [{ rows: [header, { cells: ['1/4', '5'], confidence: 0.5 }, { cells: ['', ''], confidence: 1 }] }],
        },
      ],
    });
    expect(out.totalRows).toBe(2);
    expect(out.rows.map((r: { cells: string[] }) => r.cells)).toEqual([['1/4', '5'], ['1/4', '5']]);
    expect(out.droppedHeaderRepeats).toHaveLength(1);
    expect(out.possibleDuplicates).toEqual([{ page: 2, rowIndex: 2, sameAs: 1 }]);
    expect(out.lowConfidenceRows).toEqual([{ page: 2, rowIndex: 2, confidence: 0.5, cells: ['1/4', '5'] }]);
  });
});
