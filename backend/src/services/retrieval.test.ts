/**
 * Retrieval: chunking and BM25 ranking.
 *
 * Pure functions, tested without a database on purpose — `rankBm25` is exported separately from
 * `LexicalRetriever` precisely so ranking behaviour is pinned down here and cannot drift when
 * the storage side changes.
 */
import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  chunkText,
  ExtractionUnsupported,
  extractText,
  formatContext,
  joinChunks,
  rankBm25,
  tokenize,
} from './retrieval.js';

describe('tokenize', () => {
  it('lowercases, drops stopwords, and drops single characters', () => {
    expect(tokenize('The QUICK brown fox a b')).toEqual(['quick', 'brown', 'fox']);
  });

  it('returns nothing for punctuation alone', () => {
    expect(tokenize('!!! ... ???')).toEqual([]);
  });
});

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps a short document in a single chunk', () => {
    expect(chunkText('One paragraph.\n\nAnother one.')).toEqual([
      'One paragraph.\n\nAnother one.',
    ]);
  });

  it('splits a paragraph larger than the target', () => {
    const chunks = chunkText('x'.repeat(500), 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
  });

  it('overlaps neighbours so a claim spanning a boundary survives in one piece', () => {
    const a = 'alpha '.repeat(30).trim();
    const b = 'bravo '.repeat(30).trim();
    const overlap = 60;
    const chunks = chunkText(`${a}\n\n${b}`, 200, overlap);
    expect(chunks.length).toBeGreaterThan(1);
    // The second chunk opens with the tail of the first. Compared after trimming because
    // every chunk is trimmed on the way out, which can eat a boundary space.
    expect(chunks[1]!.startsWith(chunks[0]!.slice(-overlap).trim())).toBe(true);
  });
});

describe('rankBm25', () => {
  const docs = [
    { chunkId: 'a', fileId: 'f1', filename: 'budget.md', ordinal: 0, text: 'quarterly budget forecast revenue', page: null },
    { chunkId: 'b', fileId: 'f1', filename: 'budget.md', ordinal: 1, text: 'hiring plan headcount', page: null },
    { chunkId: 'c', fileId: 'f2', filename: 'notes.md', ordinal: 0, text: 'revenue revenue revenue growth', page: null },
  ];

  it('ranks the document with more occurrences of the term first', () => {
    const results = rankBm25(docs, ['revenue'], 10);
    expect(results[0]!.chunkId).toBe('c');
  });

  it('excludes documents that contain none of the terms', () => {
    const results = rankBm25(docs, ['revenue'], 10);
    expect(results.map((r) => r.chunkId)).not.toContain('b');
  });

  it('honours the limit', () => {
    expect(rankBm25(docs, ['revenue', 'hiring', 'budget'], 2)).toHaveLength(2);
  });

  it('returns nothing for an empty corpus or empty query', () => {
    expect(rankBm25([], ['revenue'], 10)).toEqual([]);
    expect(rankBm25(docs, [], 10)).toEqual([]);
  });

  it('breaks score ties deterministically, by filename then ordinal', () => {
    const tied = [
      { chunkId: 'z', fileId: 'f', filename: 'z.md', ordinal: 0, text: 'apple', page: null },
      { chunkId: 'a', fileId: 'f', filename: 'a.md', ordinal: 0, text: 'apple', page: null },
    ];
    expect(rankBm25(tied, ['apple'], 10).map((r) => r.chunkId)).toEqual(['a', 'z']);
  });
});

describe('formatContext', () => {
  const chunk = {
    chunkId: 'a',
    fileId: 'f',
    filename: 'notes.md',
    ordinal: 0,
    text: 'y'.repeat(100),
    score: 1,
    page: null,
  };

  it('is empty when nothing was retrieved, so no preamble is injected', () => {
    expect(formatContext([], 1000)).toBe('');
  });

  it('stays under the character budget by dropping whole chunks', () => {
    const out = formatContext([chunk, { ...chunk, chunkId: 'b', ordinal: 1 }], 160);
    expect(out.length).toBeLessThan(400);
    expect(out).toContain('part 1');
    expect(out).not.toContain('part 2');
  });

  it('is empty rather than misleading when even one chunk will not fit', () => {
    expect(formatContext([chunk], 10)).toBe('');
  });

  it('cites a page number instead of a part number when the chunk has one', () => {
    const out = formatContext([{ ...chunk, page: 4 }], 1000);
    expect(out).toContain('p. 4');
    expect(out).not.toContain('part 1');
  });
});

describe('extractText (.xlsx)', () => {
  async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  it('extracts cell text, pipe-separated, from a real workbook', async () => {
    const data = await buildXlsx([
      ['Name', 'Amount'],
      ['Widgets', 42],
    ]);
    const text = await extractText(data, mime, 'report.xlsx');
    expect(text).toContain('Name | Amount');
    expect(text).toContain('Widgets | 42');
  });

  it('labels each sheet by name, for a workbook with more than one', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('Revenue').addRow(['Q1', 100]);
    workbook.addWorksheet('Costs').addRow(['Q1', 40]);
    const data = Buffer.from(await workbook.xlsx.writeBuffer());

    const text = await extractText(data, mime, 'budget.xlsx');
    expect(text).toContain('--- Revenue ---');
    expect(text).toContain('--- Costs ---');
  });

  it('rejects a workbook with no readable cells', async () => {
    const data = await buildXlsx([]);
    await expect(extractText(data, mime, 'empty.xlsx')).rejects.toThrow(ExtractionUnsupported);
  });

  it('is recognised by filename extension even without the canonical MIME type', async () => {
    const data = await buildXlsx([['x']]);
    const text = await extractText(data, 'application/octet-stream', 'report.xlsx');
    expect(text).toContain('x');
  });

  it('extracts HTML tables disguised as .xlsx or .xls (e.g. AICTE portal exports)', async () => {
    const html =
      '<html><body><table>' +
      '<tr><th>AICTE ID</th><th>Course</th><th>Intake</th></tr>' +
      '<tr><td>1-12345</td><td>Computer Science</td><td>120</td></tr>' +
      '</table></body></html>';
    const data = Buffer.from(html, 'utf8');

    const textXlsx = await extractText(data, mime, 'AICTE_Intake_Details_Verified.xlsx');
    expect(textXlsx).toContain('AICTE ID | Course | Intake');
    expect(textXlsx).toContain('1-12345 | Computer Science | 120');

    const textXls = await extractText(
      data,
      'application/vnd.ms-excel',
      'AICTE_Intake_Details_Verified.xls',
    );
    expect(textXls).toContain('AICTE ID | Course | Intake');
    expect(textXls).toContain('1-12345 | Computer Science | 120');
  });

  it('extracts binary BIFF8 .xls spreadsheets', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Department', 'FacultyCount'],
      ['Mechanical', 25],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Staff');
    const biff8Buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;

    const text = await extractText(
      biff8Buf,
      'application/vnd.ms-excel',
      'Department_Staff.xls',
    );
    expect(text).toContain('--- Staff ---');
    expect(text).toContain('Department | FacultyCount');
    expect(text).toContain('Mechanical | 25');
  });
});

describe('joinChunks', () => {
  const normalized = (t: string) => t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).join('\n\n');

  it('puts chunkText back together exactly, overlap removed', () => {
    const words = (n: number, seed: number) =>
      Array.from({ length: n }, (_, i) => `w${String((i * 7919 + seed) % 1000)}`).join(' ');
    const texts = [
      [words(50, 1), words(300, 2), words(20, 3), words(900, 4), words(5, 5)].join('\n\n'),
      words(2000, 6),
      ['short', 'tiny', words(600, 7), 'x'].join('\n\n'),
    ];
    for (const t of texts) {
      const chunks = chunkText(t);
      expect(chunks.length).toBeGreaterThan(1);
      expect(joinChunks(chunks)).toBe(normalized(t));
    }
  });
});
