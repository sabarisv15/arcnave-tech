/**
 * Reading one uploaded attachment: the file pipeline's steps (Stage 9 PIPE, ADR-0062).
 *
 *   scanning   → the scanner (a no-op until the malware phase; FILE_SCANNER)
 *   extracting → content sniff against the name (FT-12), then by type:
 *                PDF   poppler, its own process (page count, text layer, encrypted)
 *                image header read (dimensions)
 *                text  decoded, no parser
 *                Office / EPUB / RTF: pre-flight, then the isolated child (isolatedExtract.ts)
 *                ZIP   central directory, then members unpacked into their own attachments
 *   transcribing → audio / video, by the vision provider (a provider call, not a parser)
 *   ready | failed (+ ER-9 `error_code`)
 *
 * `ocr` and `indexing` are states the chip can show; nothing enters them yet (P09 / P12).
 *
 * The same function runs in a file job (worker) and inside a request (FILE_PIPELINE=sync, and
 * the multipart `POST /files`), which is what lets the parity test hold the two paths equal.
 * A failure is the file's outcome, never a thrown request error: the chip shows its reason,
 * Retry and Remove (AS-D6).
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { imageSize } from 'image-size';

import type { Config } from '../../config.js';
import { NUMBERS } from '../../config/numbers.js';
import type { FileWarning } from '../../db/schema.js';
import type { Provider } from '../../providers/types.js';
import { ExtractionUnsupported, extractText } from '../retrieval.js';
import { extensionOf } from '../storage.js';
import { FileFailure, fileErrorText, warning, type FileErrorCode } from './fileErrors.js';
import { ExtractionOutOfMemory, isolatedText, isolationLimits, parsedInChild } from './isolatedExtract.js';
import { sniffFile } from './sniff.js';

const run = promisify(execFile);

/** Upload rules that are not sizes (ADR-0011, kept). Sizes and counts are N-10 (numbers.ts). */
export const FILE_LIMITS = {
  /** N-10: ≤20 files per chat. */
  maxFilesPerChat: NUMBERS.FILES_PER_CHAT.value,
  /** N-10: docs ≤1,000 pages. */
  pdfMaxPages: NUMBERS.PDF_MAX_PAGES.value,
  /** Up to this many pages a PDF is read as text and page images; beyond it, text only. */
  pdfVisualMaxPages: 100,
  imageMaxDimension: 8000,
  /** N-10: images ≤20 MB. */
  imageMaxBytes: NUMBERS.UPLOAD_IMAGE_MAX_BYTES.value,
} as const;

/** The stages a file passes through; `status` on the attachment row while a job runs. */
export type FileStage = 'queued' | 'scanning' | 'extracting' | 'ocr' | 'transcribing' | 'indexing';
export const IN_PROGRESS: ReadonlySet<string> = new Set<FileStage | 'uploading'>([
  'uploading',
  'queued',
  'scanning',
  'extracting',
  'ocr',
  'transcribing',
  'indexing',
]);

export type Outcome =
  | {
      status: 'ready';
      error: string;
      warnings: FileWarning[];
      extractedText: string | null;
      pageCount: number | null;
    }
  | { status: 'failed'; errorCode: FileErrorCode; error: string };

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

export interface Scanner {
  /** Throws `FileFailure('malware')` for a harmful file. */
  scan(localPath: string): Promise<void>;
}

/** FILE_SCANNER=none: the stage runs, nothing is scanned. The UI never says "scanned". */
export const noScanner: Scanner = { scan: async () => undefined };

export interface PipelineInput {
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  cfg: Config;
  visionProvider?: Provider;
  scanner?: Scanner;
  /** Records the stage on the row; the job's lease fences it. */
  setStage?: (stage: FileStage) => Promise<void>;
  /** Unpacks a ZIP into member attachments; the pipeline only decides that it is one. */
  expandZip?: (localPath: string) => Promise<Outcome>;
}

export async function readAttachment(input: PipelineInput): Promise<Outcome> {
  try {
    await input.setStage?.('scanning');
    await (input.scanner ?? noScanner).scan(input.path);
    await input.setStage?.('extracting');
    const kind = await sniffFile(input.path, input.filename, input.mimeType);

    if (kind === 'zip' && extensionOf(input.filename) === '.zip') {
      if (!input.expandZip) throw new FileFailure('unsupported_type');
      return await input.expandZip(input.path);
    }
    if (input.mimeType.startsWith('image/')) return await readImage(input);
    if (input.mimeType === 'application/pdf') return await readPdf(input);
    if (input.mimeType.startsWith('audio/') || input.mimeType.startsWith('video/')) {
      if (input.mimeType !== 'video/mp2t') {
        await input.setStage?.('transcribing');
        return await readMedia(input);
      }
    }
    if (parsedInChild(input.mimeType, input.filename)) return await readParsed(input);
    // Plain text, CSV, MD, JSON, code: decoded, no parser in between.
    return ready((await readFile(input.path)).toString('utf8'));
  } catch (err) {
    if (err instanceof FileFailure) return failed(err.code, err.detail);
    throw err;
  }
}

function ready(extractedText: string | null, warnings: FileWarning[] = [], pageCount: number | null = null): Outcome {
  return {
    status: 'ready',
    // `error` keeps carrying a ready file's notes, as before, for clients that read only it.
    error: warnings.map((w) => w.detail).join(' '),
    warnings,
    extractedText,
    pageCount,
  };
}

export function failed(code: FileErrorCode, detail?: string): Outcome {
  return { status: 'failed', errorCode: code, error: fileErrorText(code, detail) };
}

/* ------------------------------------------------------------------ PDF */

async function readPdf(input: PipelineInput): Promise<Outcome> {
  let pageCount: number;
  try {
    const { stdout } = await run('pdfinfo', [input.path], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const match = /^Pages:\s+(\d+)/m.exec(stdout);
    if (!match) throw new Error('pdfinfo reported no page count');
    pageCount = Number(match[1]);
  } catch (err) {
    // poppler says "Incorrect password" for a PDF that needs one to open (FT-11).
    const stderr = (err as { stderr?: string }).stderr ?? '';
    if (/password/i.test(stderr)) throw new FileFailure('encrypted');
    throw new FileFailure('corrupt', 'This PDF could not be opened. It may be damaged. Save it again and upload it.');
  }
  if (pageCount > FILE_LIMITS.pdfMaxPages) {
    throw new FileFailure(
      'too_many_pages',
      `This PDF has ${pageCount.toLocaleString('en-US')} pages. PDFs can have at most ` +
        `${FILE_LIMITS.pdfMaxPages.toLocaleString('en-US')} pages.`,
    );
  }

  const warnings: FileWarning[] = [];
  if (pageCount > FILE_LIMITS.pdfVisualMaxPages) {
    warnings.push(
      warning(
        'text_only',
        `This PDF has more than ${String(FILE_LIMITS.pdfVisualMaxPages)} pages, so only its text is read; ` +
          'images, charts and scanned pages in it are not.',
      ),
    );
  }
  let text = '';
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
  } catch {
    warnings.push(warning('text_partial', 'The text layer of this PDF could not be read; its pages are still shown as images.'));
  }
  if (text === '' && pageCount > FILE_LIMITS.pdfVisualMaxPages) {
    warnings.push(warning('no_text_layer', 'It has no text layer, so nothing in it can be read.'));
  }
  // Still `ready` with no text: the file itself goes to code, which can read what the model cannot.
  return ready(text || null, warnings, pageCount);
}

/* ------------------------------------------------------------------ image */

async function readImage(input: PipelineInput): Promise<Outcome> {
  if (input.sizeBytes > FILE_LIMITS.imageMaxBytes) {
    throw new FileFailure(
      'too_large',
      `This image is ${(input.sizeBytes / 1024 / 1024).toFixed(1)} MB. Images can be at most ` +
        `${String(Math.round(FILE_LIMITS.imageMaxBytes / (1024 * 1024)))} MB.`,
    );
  }
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = imageSize(input.path));
  } catch {
    throw new FileFailure('corrupt', 'This image could not be read. It may be damaged. Save it again and upload it.');
  }
  if (width === undefined || height === undefined) throw new FileFailure('corrupt');
  const max = FILE_LIMITS.imageMaxDimension;
  if (width > max || height > max) {
    throw new FileFailure(
      'too_large',
      `This image is ${String(width)}×${String(height)} pixels. Images can be at most ${String(max)}×${String(max)}.`,
    );
  }
  return ready(null);
}

/* ------------------------------------------------------------------ media */

async function readMedia(input: PipelineInput): Promise<Outcome> {
  try {
    const text = await extractText(await readFile(input.path), input.mimeType, input.filename, input.visionProvider);
    return ready(text);
  } catch (err) {
    if (err instanceof ExtractionUnsupported) {
      // A model that hears audio still gets the recording itself; only the transcript is missing.
      return ready(null, [warning('not_extracted', err.message)]);
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ parsed documents */

async function readParsed(input: PipelineInput): Promise<Outcome> {
  try {
    return ready(await isolatedText(input.path, input.filename, input.mimeType, isolationLimits(input.cfg)));
  } catch (err) {
    if (err instanceof ExtractionOutOfMemory) {
      // Readable by code, not by the parser within its budget: kept, with a note, as before.
      return ready(null, [
        warning('not_extracted', 'This file is too large to read its text here. It is stored, and code can still open it.'),
      ]);
    }
    if (err instanceof ExtractionUnsupported) return ready(null, [warning('not_extracted', err.message)]);
    throw err;
  }
}
