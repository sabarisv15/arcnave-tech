/**
 * Markdown -> spec parsing for the three export formats.
 *
 * Pure functions, tested without touching the renderer libraries — those are exercised for
 * real (round-tripped through actual binary generation and extraction) in
 * `projects.integration.test.ts` and `artifacts.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  MarkdownConversionUnsupported,
  markdownToDocumentSpec,
  markdownToSlidesSpec,
  markdownToSpreadsheetSpec,
} from './documents.js';

describe('markdownToSpreadsheetSpec', () => {
  it('parses a GFM table into a sheet named after the preceding heading', () => {
    const spec = markdownToSpreadsheetSpec(
      '# Headcount\n\n| Team | Hires |\n| --- | --- |\n| Platform | 3 |\n| Growth | 1 |\n',
    );
    expect(spec.sheets).toEqual([
      { name: 'Headcount', header: ['Team', 'Hires'], rows: [['Platform', '3'], ['Growth', '1']] },
    ]);
  });

  it('gives each table its own sheet and de-duplicates repeated headings', () => {
    const spec = markdownToSpreadsheetSpec(
      '# Q1\n\n| A |\n| --- |\n| 1 |\n\n# Q1\n\n| A |\n| --- |\n| 2 |\n',
    );
    expect(spec.sheets.map((s) => s.name)).toEqual(['Q1', 'Q1 (2)']);
  });

  it('falls back to a numbered name when no heading precedes the table', () => {
    const spec = markdownToSpreadsheetSpec('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    expect(spec.sheets[0]!.name).toBe('Sheet 1');
  });

  it('rejects markdown with no table, rather than emitting an empty workbook', () => {
    expect(() => markdownToSpreadsheetSpec('just some prose')).toThrow(
      MarkdownConversionUnsupported,
    );
  });
});

describe('markdownToDocumentSpec', () => {
  it('turns headings, paragraphs, and bullets into ordered blocks', () => {
    const spec = markdownToDocumentSpec(
      '# Plan\n\nFirst paragraph.\n\n## Details\n\n- one\n- two\n',
    );
    expect(spec.title).toBe('Plan');
    expect(spec.blocks).toEqual([
      { type: 'heading', level: 1, text: 'Plan' },
      { type: 'paragraph', text: 'First paragraph.' },
      { type: 'heading', level: 2, text: 'Details' },
      { type: 'bullet', text: 'one' },
      { type: 'bullet', text: 'two' },
    ]);
  });

  it('joins wrapped lines of the same paragraph rather than splitting on every newline', () => {
    const spec = markdownToDocumentSpec('one line\nanother line\n');
    expect(spec.blocks).toEqual([{ type: 'paragraph', text: 'one line another line' }]);
  });

  it('rejects empty markdown', () => {
    expect(() => markdownToDocumentSpec('   \n\n  ')).toThrow(MarkdownConversionUnsupported);
  });
});

describe('markdownToSlidesSpec', () => {
  it('starts a new slide on each heading and collects bullets under it', () => {
    const spec = markdownToSlidesSpec('# Kickoff\n- welcome\n- agenda\n\n# Next steps\n- follow up\n');
    expect(spec.slides).toEqual([
      { title: 'Kickoff', bullets: ['welcome', 'agenda'] },
      { title: 'Next steps', bullets: ['follow up'] },
    ]);
  });

  it('rejects markdown with no heading, since every slide needs one', () => {
    expect(() => markdownToSlidesSpec('- a bullet with no heading above it')).toThrow(
      MarkdownConversionUnsupported,
    );
  });
});
