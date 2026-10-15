/**
 * The pipeline's reading of each type (Stage 9 PIPE; ADR-0011's page and pixel rules kept).
 * Runs poppler for real (the backend image installs it), because the rules are only as true as
 * the page count and text it reports, and the Office parsers in their real child process.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../config.js';
import { zipSync } from 'fflate';


/** A Word document whose body is the given paragraphs' XML. */
function docxBody(paragraphsXml: string): Buffer {
  const enc = (t: string) => new TextEncoder().encode(t);
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': enc('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': enc('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': enc(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphsXml}</w:body></w:document>`),
    }),
  );
}
import { pdfWithPages, png } from '../../test/fixtures/files.js';
import { FILE_LIMITS, readAttachment, readingFor, type Outcome } from './pipeline.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/documents');
const cfg = loadConfig({ NODE_ENV: 'test' });
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pipeline-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readBytes(filename: string, mimeType: string, bytes: Buffer, over: Partial<typeof cfg> = {}): Promise<Outcome> {
  const p = path.join(dir, filename);
  await writeFile(p, bytes);
  return readAttachment({ path: p, filename, mimeType, sizeBytes: bytes.length, cfg: { ...cfg, ...over } });
}

describe('PDF', () => {
  it('counts pages and extracts text per page, locally, so any model gets the same text', async () => {
    const out = await readBytes('a.pdf', 'application/pdf', await pdfWithPages(3, ['Opening balance 100', '', 'Closing 250']));
    expect(out).toMatchObject({ status: 'ready', error: '', pageCount: 3 });
    if (out.status !== 'ready') throw new Error('not ready');
    expect(out.extractedText).toContain('--- Page 1 ---\nOpening balance 100');
    expect(out.extractedText).toContain('--- Page 3 ---\nClosing 250');
    expect(out.extractedText).not.toContain('--- Page 2 ---');
    expect(readingFor({ mimeType: 'application/pdf', pageCount: 3, hasText: true })).toBe('text+visual');
  });

  it('reads a PDF of more than 100 pages as text only, and says so with a warning code', async () => {
    const out = await readBytes('long.pdf', 'application/pdf', await pdfWithPages(FILE_LIMITS.pdfVisualMaxPages + 1, ['Intro']));
    expect(out).toMatchObject({ status: 'ready', warnings: [expect.objectContaining({ code: 'text_only' })] });
    if (out.status !== 'ready') throw new Error('not ready');
    expect(readingFor({ mimeType: 'application/pdf', pageCount: out.pageCount, hasText: true })).toBe('text');
  });

  it('keeps a long scanned PDF (no text) ready for code, and says the model cannot read it', async () => {
    const out = await readBytes('scan.pdf', 'application/pdf', await pdfWithPages(FILE_LIMITS.pdfVisualMaxPages + 1));
    expect(out).toMatchObject({ status: 'ready', extractedText: null });
    expect(out.error).toContain('no text layer');
  });

  it('fails a PDF over 1,000 pages as `too_many_pages`, naming the count', async () => {
    const out = await readBytes('huge.pdf', 'application/pdf', await pdfWithPages(FILE_LIMITS.pdfMaxPages + 1));
    expect(out).toMatchObject({ status: 'failed', errorCode: 'too_many_pages' });
    expect(out.error).toContain('1,001 pages');
  });

  it('fails a file that is not really a PDF as `corrupt`, in our words', async () => {
    const out = await readBytes('fake.pdf', 'application/pdf', Buffer.from('%PDF-1.4\nnot a pdf'));
    expect(out).toMatchObject({ status: 'failed', errorCode: 'corrupt' });
    expect(out.error).toContain('could not be opened');
  });
});

describe('image', () => {
  it('accepts up to 8000×8000', async () => {
    const out = await readBytes('ok.png', 'image/png', png(8000, 1));
    expect(out).toMatchObject({ status: 'ready', extractedText: null });
    expect(readingFor({ mimeType: 'image/png', pageCount: null, hasText: false })).toBe('visual');
  });

  it('fails an image over 20 MB (N-10) and accepts one at exactly 20 MB', async () => {
    const pad = (n: number) => Buffer.concat([png(10, 10), Buffer.alloc(n - png(10, 10).length)]);
    const over = await readBytes('big.png', 'image/png', pad(FILE_LIMITS.imageMaxBytes + 1));
    expect(over).toMatchObject({ status: 'failed', errorCode: 'too_large' });
    expect(over.error).toContain('at most 20 MB');
    expect((await readBytes('ok.png', 'image/png', pad(FILE_LIMITS.imageMaxBytes))).status).toBe('ready');
  });

  it('fails an image wider or taller than 8000 pixels', async () => {
    const out = await readBytes('wide.png', 'image/png', png(8001, 1));
    expect(out).toMatchObject({ status: 'failed', errorCode: 'too_large' });
    expect(out.error).toContain('8001×1 pixels');
  });
});

describe('documents read as text (in the isolated child)', () => {
  it.each([
    ['sample.odt', 'application/vnd.oasis.opendocument.text'],
    ['sample.rtf', 'application/rtf'],
    ['sample.epub', 'application/epub+zip'],
  ])('extracts %s', async (name, mime) => {
    const out = await readBytes(name, mime, await readFile(path.join(FIXTURES, name)));
    expect(out.status).toBe('ready');
    if (out.status !== 'ready') throw new Error('not ready');
    expect(out.extractedText).toContain('Invoice total 4521');
    expect(out.extractedText).toContain('Second paragraph here.');
  });

  it('keeps a document its parser cannot read within its heap ready, with the reason, for code', async () => {
    // The smallest heap (64 MB) for 200,000 paragraphs: the parser's tree outgrows it.
    const paras = Array.from({ length: 200_000 }, (_, i) => `<w:p><w:r><w:t>Paragraph ${String(i)} words</w:t></w:r></w:p>`).join('');
    const big = docxBody(paras);
    const out = await readBytes('big.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', big, {
      EXTRACTION_MEMORY_BUDGET_BYTES: 32 * 1024 * 1024,
      EXTRACTION_CONCURRENCY: 1,
    });
    expect(out).toMatchObject({ status: 'ready', extractedText: null, warnings: [expect.objectContaining({ code: 'not_extracted' })] });
  });
});
