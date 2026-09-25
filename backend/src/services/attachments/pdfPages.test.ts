/**
 * What a model is shown for a PDF (ADR-0013), against real poppler: up to 100 pages as page
 * images and page text, beyond that text only, never the PDF itself.
 */
import { imageSize } from 'image-size';
import { beforeEach, describe, expect, it } from 'vitest';

import { pdfWithPages } from '../../test/fixtures/files.js';
import { clearPdfPageCache, PAGE_IMAGE_LONG_EDGE_PX, pdfForModel } from './pdfPages.js';

beforeEach(() => clearPdfPageCache());

describe('pdfForModel', () => {
  it('gives each page of a short PDF as a JPEG at the chosen size, with that page’s text', async () => {
    const out = await pdfForModel(await pdfWithPages(3, ['Opening balance 100', '', 'Closing 250']));
    expect(out.kind).toBe('pages');
    if (out.kind !== 'pages') return;
    expect(out.pages.map((p) => p.num)).toEqual([1, 2, 3]);
    expect(out.pages.map((p) => p.text)).toEqual(['Opening balance 100', '', 'Closing 250']);
    for (const page of out.pages) {
      expect(page.image?.mimeType).toBe('image/jpeg');
      const { width, height } = imageSize(Buffer.from(page.image!.base64, 'base64'));
      expect(Math.max(width!, height!)).toBe(PAGE_IMAGE_LONG_EDGE_PX);
    }
  });

  it('reads a PDF over 100 pages as text only, as Claude does', async () => {
    const out = await pdfForModel(await pdfWithPages(101, ['First page words']));
    expect(out).toMatchObject({ kind: 'text', pageCount: 101 });
    if (out.kind === 'text') expect(out.text).toContain('--- Page 1 ---\nFirst page words');
  });

  it('reports a file that is not a PDF instead of sending it', async () => {
    const out = await pdfForModel(Buffer.from('%PDF-1.4\nnot really'));
    expect(out.kind).toBe('unreadable');
  });

  it('renders a stored PDF once, however many turns resend it', async () => {
    const pdf = await pdfWithPages(1, ['once']);
    const first = await pdfForModel(pdf, 'key-1');
    const second = await pdfForModel(pdf, 'key-1');
    expect(second).toBe(first);
  });
});
