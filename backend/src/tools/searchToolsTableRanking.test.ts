/**
 * Phase 3 live finding: for "count every transaction…" the model tried run_python three times
 * before finding the table tools. A request to count or classify every row must rank the
 * extraction pair above run_python and read_uploaded_file.
 */
import { describe, expect, it } from 'vitest';

import {
  ANALYZE_TABLE_ROWS,
  EXTRACT_SCANNED_TABLE_ROWS,
  READ_UPLOADED_FILE,
  RUN_PYTHON,
} from './definitions.js';
import { SearchToolsExecutor } from './searchToolsExecutor.js';

const catalog = [RUN_PYTHON, READ_UPLOADED_FILE, EXTRACT_SCANNED_TABLE_ROWS, ANALYZE_TABLE_ROWS];

async function rank(query: string): Promise<string[]> {
  const res = await new SearchToolsExecutor(catalog).execute(
    { id: 's', name: 'search_tools', input: { query } },
    new AbortController().signal,
  );
  const part = res.content.find((c) => c.type === 'json') as { data: { tools: { name: string }[] } };
  return part.data.tools.map((t) => t.name);
}

describe('search_tools ranking for exact table work', () => {
  it.each([
    'count every transaction exactly and classify them',
    'read pdf file and calculate totals of the statement',
    'how many entries in each bank statement',
    'python pdf transactions count',
  ])('"%s" ranks extraction first and returns analysis with it', async (query) => {
    const names = await rank(query);
    expect(names[0]).toBe('extract_scanned_table_rows');
    expect(names).toContain('analyze_table_rows');
  });

  it('a plain python request still finds run_python first', async () => {
    expect((await rank('run python code to simulate a regression'))[0]).toBe('run_python');
  });
});
