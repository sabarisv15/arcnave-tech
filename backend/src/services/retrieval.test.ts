/**
 * Retrieval: chunking and BM25 ranking.
 *
 * Pure functions, tested without a database on purpose — `rankBm25` is exported separately from
 * `LexicalRetriever` precisely so ranking behaviour is pinned down here and cannot drift when
 * the storage side changes.
 */
import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { AttachmentBlock, Provider } from '../providers/types.js';
import {
  chunkText,
  ExtractionUnsupported,
  extractText,
  formatContext,
  rankBm25,
  tokenize,
} from './retrieval.js';

/** Enough of `Provider` for `describeMedia` callers; nothing here reaches an SDK or Vertex. */
class StubVisionProvider implements Pick<Provider, 'describeMedia'> {
  seen: Array<{ parts: AttachmentBlock[]; prompt: string }> = [];
  response = 'transcribed content';

  async describeMedia(parts: AttachmentBlock[], prompt: string): Promise<string> {
    this.seen.push({ parts, prompt });
    return this.response;
  }
}

/**
 * A single blank page, deliberately with no `/Contents` — pdf.js still opens it (it tolerates
 * a missing/broken xref by rescanning) and `getText()` correctly finds nothing, which is what
 * triggers the OCR branch under test.
 */
const BLANK_PAGE_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Size 4/Root 1 0 R>>\n' +
    '%%EOF',
  'utf8',
);

describe('extractText: scanned PDF falls back to OCR via Gemini vision', () => {
  it('transcribes via the vision provider when no selectable text is found', async () => {
    const vision = new StubVisionProvider();
    const text = await extractText(
      BLANK_PAGE_PDF,
      'application/pdf',
      'scan.pdf',
      vision as unknown as Provider,
    );

    expect(text).toBe('transcribed content');
    expect(vision.seen).toHaveLength(1);
    expect(vision.seen[0]!.parts[0]).toMatchObject({ mimeType: 'image/png' });
  });

  it('fails with a typed reason rather than silently skipping OCR when no provider is configured', async () => {
    await expect(extractText(BLANK_PAGE_PDF, 'application/pdf', 'scan.pdf')).rejects.toThrow(
      /OCR needs a configured Gemini provider/,
    );
  });
});

describe('extractText: audio/video transcription', () => {
  it('transcribes via the vision provider', async () => {
    const vision = new StubVisionProvider();
    vision.response = 'the meeting covered Q3 budget';
    const text = await extractText(
      Buffer.from('not real audio bytes, Gemini reads the real thing server-side'),
      'audio/mpeg',
      'standup.mp3',
      vision as unknown as Provider,
    );

    expect(text).toBe('the meeting covered Q3 budget');
    expect(vision.seen[0]!.parts[0]).toMatchObject({ mimeType: 'audio/mpeg' });
  });

  it('fails with a typed reason rather than silently skipping transcription when no provider is configured', async () => {
    await expect(
      extractText(Buffer.from('x'), 'video/mp4', 'clip.mp4'),
    ).rejects.toThrow(/Transcribing audio\/video needs a configured Gemini provider/);
  });
});

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
});
