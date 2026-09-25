/**
 * Step 1 against Claude's published rules: PDFs up to 1,000 pages, text and page images up to
 * 100, text only beyond; images up to 8000×8000; every other document as extracted text.
 * Runs poppler for real (the backend image installs it), because the rules are only as true as
 * the page count and text it reports.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pdfWithPages, png } from '../../test/fixtures/files.js';
import { extractionLimitBytes, FILE_LIMITS, oneAtATime, processUpload, readingFor, UploadRejected } from './processUpload.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/documents');
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'process-upload-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function processBytes(filename: string, mimeType: string, bytes: Buffer, memoryBudgetBytes = 2 * 1024 ** 3) {
  const p = path.join(dir, filename);
  await writeFile(p, bytes);
  return processUpload({ path: p, filename, mimeType, sizeBytes: bytes.length, memoryBudgetBytes });
}

describe('PDF', () => {
  it('counts pages and extracts text per page, locally, so any model gets the same text', async () => {
    const out = await processBytes('a.pdf', 'application/pdf', await pdfWithPages(3, ['Opening balance 100', '', 'Closing 250']));
    expect(out).toMatchObject({ status: 'ready', error: '', pageCount: 3 });
    expect(out.extractedText).toContain('--- Page 1 ---\nOpening balance 100');
    expect(out.extractedText).toContain('--- Page 3 ---\nClosing 250');
    expect(out.extractedText).not.toContain('--- Page 2 ---');
    expect(readingFor({ mimeType: 'application/pdf', pageCount: 3, hasText: true })).toBe('text+visual');
  });

  it('reads a PDF of more than 100 pages as text only, and says so', async () => {
    const out = await processBytes('long.pdf', 'application/pdf', await pdfWithPages(FILE_LIMITS.pdfVisualMaxPages + 1, ['Intro']));
    expect(out.status).toBe('ready');
    expect(out.error).toContain('only its text is read');
    expect(readingFor({ mimeType: 'application/pdf', pageCount: out.pageCount, hasText: true })).toBe('text');
  });

  it('keeps a long scanned PDF (no text) ready for code, and says the model cannot read it', async () => {
    const out = await processBytes('scan.pdf', 'application/pdf', await pdfWithPages(FILE_LIMITS.pdfVisualMaxPages + 1));
    expect(out).toMatchObject({ status: 'ready', extractedText: null });
    expect(out.error).toContain('no text layer');
    expect(readingFor({ mimeType: 'application/pdf', pageCount: out.pageCount, hasText: false })).toBe('none');
  });

  it('refuses a PDF over 1,000 pages', async () => {
    const pdf = await pdfWithPages(FILE_LIMITS.pdfMaxPages + 1);
    await expect(processBytes('huge.pdf', 'application/pdf', pdf)).rejects.toThrow(UploadRejected);
    await expect(processBytes('huge.pdf', 'application/pdf', pdf)).rejects.toThrow(/1,001 pages/);
  });

  it('marks a file that is not really a PDF unsupported, with the reason', async () => {
    const out = await processBytes('fake.pdf', 'application/pdf', Buffer.from('%PDF-1.4\nnot a pdf'));
    expect(out.status).toBe('unsupported');
    expect(out.error).toContain('could not be opened');
  });
});

describe('image', () => {
  it('accepts up to 8000×8000', async () => {
    const out = await processBytes('ok.png', 'image/png', png(8000, 1));
    expect(out).toMatchObject({ status: 'ready', extractedText: null });
    expect(readingFor({ mimeType: 'image/png', pageCount: null, hasText: false })).toBe('visual');
  });

  it('refuses an image over 10 MB, as claude.ai does, and accepts one at exactly 10 MB', async () => {
    const pad = (n: number) => Buffer.concat([png(10, 10), Buffer.alloc(n - png(10, 10).length)]);
    await expect(processBytes('big.png', 'image/png', pad(FILE_LIMITS.imageMaxBytes + 1))).rejects.toThrow(/at most 10 MB/);
    expect((await processBytes('ok.png', 'image/png', pad(FILE_LIMITS.imageMaxBytes))).status).toBe('ready');
  });

  it('refuses an image wider or taller than 8000 pixels', async () => {
    await expect(processBytes('wide.png', 'image/png', png(8001, 1))).rejects.toThrow(/8001×1 pixels/);
  });
});

describe('documents Claude reads as text', () => {
  it.each([
    ['sample.odt', 'application/vnd.oasis.opendocument.text'],
    ['sample.rtf', 'application/rtf'],
    ['sample.epub', 'application/epub+zip'],
  ])('extracts %s', async (name, mime) => {
    const out = await processBytes(name, mime, await readFile(path.join(FIXTURES, name)));
    expect(out.status).toBe('ready');
    expect(out.extractedText).toContain('Invoice total 4521');
    expect(out.extractedText).toContain('Second paragraph here.');
  });

  it('stores a document too large to extract as ready, with the reason, so code can still open it', async () => {
    // A .docx takes ~370 bytes of memory per byte to extract; this budget allows 270 bytes.
    const out = await processBytes(
      'big.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.alloc(1000),
      100_000,
    );
    expect(out).toMatchObject({ status: 'ready', extractedText: null });
    expect(out.error).toContain('Text is extracted from files of this type up to');
  });

  it('gives each type the size its measured memory cost allows', () => {
    const budget = 4 * 1024 ** 3; // an 8 GiB instance
    const mb = (bytes: number) => Math.floor(bytes / 1024 ** 2);
    expect(mb(extractionLimitBytes('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx', budget))).toBe(11);
    expect(mb(extractionLimitBytes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx', budget))).toBe(45);
    expect(mb(extractionLimitBytes('application/pdf', 'a.pdf', budget))).toBe(2048);
    // The limit follows the type, not the name the browser gave it.
    expect(extractionLimitBytes('text/csv', 'a.csv', budget)).toBeGreaterThan(500 * 1024 ** 2);
  });

  it('runs extractions one at a time, so two large uploads never add up', async () => {
    let running = 0;
    let most = 0;
    const task = () =>
      oneAtATime(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
      });
    await Promise.all([task(), task(), task(), task()]);
    expect(most).toBe(1);
    // A failing extraction does not jam the queue for the next upload.
    await expect(oneAtATime(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(oneAtATime(async () => 'next')).resolves.toBe('next');
  });
});
