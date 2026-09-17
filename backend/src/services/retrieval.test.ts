/**
 * Retrieval: chunking and BM25 ranking.
 *
 * Pure functions, tested without a database on purpose — `rankBm25` is exported separately from
 * `LexicalRetriever` precisely so ranking behaviour is pinned down here and cannot drift when
 * the storage side changes.
 */
import { describe, expect, it } from 'vitest';

import { chunkText, formatContext, rankBm25, tokenize } from './retrieval.js';

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
    { chunkId: 'a', fileId: 'f1', filename: 'budget.md', ordinal: 0, text: 'quarterly budget forecast revenue' },
    { chunkId: 'b', fileId: 'f1', filename: 'budget.md', ordinal: 1, text: 'hiring plan headcount' },
    { chunkId: 'c', fileId: 'f2', filename: 'notes.md', ordinal: 0, text: 'revenue revenue revenue growth' },
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
      { chunkId: 'z', fileId: 'f', filename: 'z.md', ordinal: 0, text: 'apple' },
      { chunkId: 'a', fileId: 'f', filename: 'a.md', ordinal: 0, text: 'apple' },
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
});
