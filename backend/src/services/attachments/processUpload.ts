/**
 * Step 1 of file handling: what happens to an uploaded file before any model sees it.
 *
 * Claude is the reference (support.claude.com, "What kinds of documents can I upload to
 * Claude"): a PDF of up to 1,000 pages is accepted, and one of up to 100 pages is read as text
 * and as page images, a longer one as text only; an image may be up to 8000×8000 pixels; every
 * other document is read as its extracted text. This module applies the same rules.
 *
 * Extracted text is kept whole. As in Claude, what limits it is the answering model's context
 * window, and that is decided when the file is sent to a model, from exact token counts; an
 * upload-time character cap would decide it here, blind to the model.
 *
 * It must not depend on which model answers. The model is one API behind an interface and can
 * change; so PDFs are counted and their text layer read here, locally, with poppler, instead of
 * relying on one provider's native PDF reader. Audio and video transcription is the one
 * exception: it stays with `visionProvider` because nothing local can do it.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { imageSize } from 'image-size';

import type { Provider } from '../../providers/types.js';
import { ExtractionUnsupported, extractText } from '../retrieval.js';

const run = promisify(execFile);

/** Claude's published limits. */
export const FILE_LIMITS = {
  maxFilesPerChat: 20,
  pdfMaxPages: 1000,
  /** Up to this many pages a PDF is read as text and page images; beyond it, text only. */
  pdfVisualMaxPages: 100,
  imageMaxDimension: 8000,
} as const;

/**
 * How a model will be shown this file. Decided here, once, so that every provider reads the
 * same file the same way:
 * - `text+visual`: its text and an image of each page (a PDF of up to 100 pages)
 * - `text`: its extracted text only
 * - `visual`: the image itself
 * - `media`: audio or video, as the media itself
 * - `none`: nothing could be read; the file is still stored and available to code
 */
export type Reading = 'text+visual' | 'text' | 'visual' | 'media' | 'none';

export function readingFor(file: { mimeType: string; pageCount: number | null; hasText: boolean }): Reading {
  if (file.mimeType === 'application/pdf') {
    if (file.pageCount !== null && file.pageCount <= FILE_LIMITS.pdfVisualMaxPages) return 'text+visual';
    return file.hasText ? 'text' : 'none';
  }
  if (file.mimeType.startsWith('image/')) return 'visual';
  if (file.mimeType.startsWith('audio/') || file.mimeType.startsWith('video/')) return 'media';
  return file.hasText ? 'text' : 'none';
}

/** The file breaks one of Claude's limits. It is not stored; the upload is refused. */
export class UploadRejected extends Error {
  override name = 'UploadRejected';
  constructor(
    readonly code: 'payload_too_large' | 'unsupported_media_type',
    detail: string,
  ) {
    super(detail);
  }
}

export interface ProcessedUpload {
  /**
   * ready | unsupported. Only a `ready` file is carried into later turns and code, so
   * `unsupported` is kept for a file nothing can open (corrupt, or password-protected).
   */
  status: 'ready' | 'unsupported';
  /** Shown to the user next to the file. Empty when there is nothing to say. */
  error: string;
  extractedText: string | null;
  pageCount: number | null;
}

export interface ProcessUploadInput {
  /** The file on local disk. */
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  visionProvider?: Provider;
  /**
   * Peak memory one extraction may take. A file whose extractor would need more (by
   * EXTRACTION_MEMORY_PER_BYTE) is stored with a note and its text is not extracted.
   */
  memoryBudgetBytes: number;
}

type Extractor = 'pdf' | 'docx' | 'odt' | 'epub' | 'xlsx' | 'xls' | 'rtf' | 'pptx' | 'text' | 'media';

/**
 * Peak memory an extractor takes per byte of file, measured 2026-09-25 on generated files
 * (PDF 1.8 MB/1,000 pages, DOCX 4.5 MB, ODT 4.3 MB, EPUB 4.3 MB, XLSX 8.7 and 44 MB, XLS 6.6 MB,
 * RTF 3 MB, PPTX 49 MB, CSV 62 MB), rounded up. The in-process parsers build a whole document
 * tree, so they take tens to hundreds of times the file's size; one 44 MB workbook peaked at
 * 3.8 GB. `media` is not measured: it is the copies transcription makes (the file, its base64,
 * the request body).
 */
export const EXTRACTION_MEMORY_PER_BYTE: Record<Extractor, number> = {
  pdf: 2,
  docx: 370,
  odt: 210,
  epub: 80,
  xlsx: 90,
  xls: 35,
  rtf: 20,
  pptx: 16,
  text: 2,
  media: 4,
};

function extractorFor(mimeType: string, filename: string): Extractor {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (mimeType === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mimeType.includes('wordprocessingml')) return 'docx';
  if (ext === 'pptx' || mimeType.includes('presentationml')) return 'pptx';
  if (ext === 'odt' || mimeType === 'application/vnd.oasis.opendocument.text') return 'odt';
  if (ext === 'rtf' || mimeType.endsWith('/rtf')) return 'rtf';
  if (ext === 'epub' || mimeType === 'application/epub+zip') return 'epub';
  if (ext === 'xlsx' || mimeType.includes('spreadsheetml')) return 'xlsx';
  if (ext === 'xls' || mimeType.includes('ms-excel')) return 'xls';
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return 'media';
  return 'text';
}

/** The largest file of this type whose extraction fits the budget. */
export function extractionLimitBytes(mimeType: string, filename: string, memoryBudgetBytes: number): number {
  return Math.floor(memoryBudgetBytes / EXTRACTION_MEMORY_PER_BYTE[extractorFor(mimeType, filename)]);
}

// One extraction at a time per instance: the budget is sized for one, and two large uploads
// arriving together would otherwise take twice the memory and could kill the instance.
let queue: Promise<unknown> = Promise.resolve();
export function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function processUpload(input: ProcessUploadInput): Promise<ProcessedUpload> {
  if (input.mimeType.startsWith('image/')) return processImage(input);
  const limit = extractionLimitBytes(input.mimeType, input.filename, input.memoryBudgetBytes);
  if (input.mimeType === 'application/pdf') return oneAtATime(() => processPdf(input, limit));
  if (input.sizeBytes > limit) {
    return {
      // `ready`, not `unsupported`: only a ready file reaches later turns and code.
      status: 'ready',
      error:
        `Text is extracted from files of this type up to ${formatMb(limit)}; this one is ` +
        `${formatMb(input.sizeBytes)}. It is stored, and code can still open it.`,
      extractedText: null,
      pageCount: null,
    };
  }
  return oneAtATime(() => processDocument(input));
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function processPdf(input: ProcessUploadInput, textLimitBytes: number): Promise<ProcessedUpload> {
  let pageCount: number;
  try {
    const { stdout } = await run('pdfinfo', [input.path], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const match = /^Pages:\s+(\d+)/m.exec(stdout);
    if (!match) throw new Error('pdfinfo reported no page count');
    pageCount = Number(match[1]);
  } catch (err) {
    return {
      status: 'unsupported',
      error: `This PDF could not be opened (${pdfError(err)}). It is stored, but nothing in it can be read.`,
      extractedText: null,
      pageCount: null,
    };
  }
  if (pageCount > FILE_LIMITS.pdfMaxPages) {
    throw new UploadRejected(
      'payload_too_large',
      `This PDF has ${pageCount.toLocaleString('en-US')} pages. PDFs can have at most ` +
        `${FILE_LIMITS.pdfMaxPages.toLocaleString('en-US')} pages.`,
    );
  }

  const notes: string[] = [];
  if (pageCount > FILE_LIMITS.pdfVisualMaxPages) {
    notes.push(
      `This PDF has more than ${String(FILE_LIMITS.pdfVisualMaxPages)} pages, so only its text is read; ` +
        'images, charts and scanned pages in it are not.',
    );
  }

  let text = '';
  const tooLargeToRead = input.sizeBytes > textLimitBytes;
  if (tooLargeToRead) {
    notes.push(`Text is extracted from PDFs up to ${formatMb(textLimitBytes)}; this one is ${formatMb(input.sizeBytes)}.`);
  } else {
    try {
      // One text block per page, split on the form feed pdftotext ends each page with, so a page
      // number in the text is the page the words are on.
      const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', input.path, '-'], {
        timeout: 120_000,
        maxBuffer: 256 * 1024 * 1024,
      });
      text = stdout
        .split('\f')
        .map((page, i) => ({ num: i + 1, body: page.trim() }))
        .filter((p) => p.num <= pageCount && p.body !== '')
        .map((p) => `--- Page ${String(p.num)} ---\n${p.body}`)
        .join('\n\n');
    } catch (err) {
      notes.push(`The text of this PDF could not be read (${pdfError(err)}).`);
    }
  }

  if (!tooLargeToRead && text === '' && pageCount > FILE_LIMITS.pdfVisualMaxPages) {
    notes.push('It has no text layer, so nothing in it can be read.');
  }
  return {
    // Still `ready`: the file itself goes to code, which can read what the model cannot.
    status: 'ready',
    error: notes.join(' '),
    extractedText: text || null,
    pageCount,
  };
}

async function processImage(input: ProcessUploadInput): Promise<ProcessedUpload> {
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = imageSize(input.path));
  } catch {
    // Unreadable dimensions are reported below, not thrown: the file is still stored.
  }
  if (width === undefined || height === undefined) {
    return {
      status: 'unsupported',
      error: 'This image could not be read. It is stored, but a model cannot be shown it.',
      extractedText: null,
      pageCount: null,
    };
  }
  const max = FILE_LIMITS.imageMaxDimension;
  if (width > max || height > max) {
    throw new UploadRejected(
      'payload_too_large',
      `This image is ${String(width)}×${String(height)} pixels. Images can be at most ${String(max)}×${String(max)}.`,
    );
  }
  return { status: 'ready', error: '', extractedText: null, pageCount: null };
}

async function processDocument(input: ProcessUploadInput): Promise<ProcessedUpload> {
  try {
    const data = await readFile(input.path);
    const text = await extractText(data, input.mimeType, input.filename, input.visionProvider);
    return { status: 'ready', error: '', extractedText: text, pageCount: null };
  } catch (err) {
    if (err instanceof ExtractionUnsupported || (err instanceof Error && err.name === 'ExtractionUnsupported')) {
      return { status: 'unsupported', error: err.message, extractedText: null, pageCount: null };
    }
    throw err;
  }
}

function pdfError(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr?.trim();
  if (stderr) return stderr.split('\n')[0]!.slice(0, 200);
  return err instanceof Error ? err.message.slice(0, 200) : String(err);
}
