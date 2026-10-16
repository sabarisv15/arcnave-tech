/**
 * Reading one uploaded file: the file pipeline's steps (Stage 9 PIPE, ADR-0062, ADR-0063).
 *
 *   scanning   → the scanner (clamd, or a no-op with FILE_SCANNER=none; scanner.ts)
 *   extracting → content sniff against the name (FT-12), then by type:
 *                PDF   poppler (page count, encrypted, text per page); pdf-lib in the child for
 *                      forms, comments, embedded files and the active-content strip
 *                image normalised copy in the child (EXIF rotate + strip, ≤ 2,576 px, ≤ 5 MB, HEIC)
 *                text  decoded by its encoding (BOM / UTF-16 / UTF-8 / Windows-1252), NUL check
 *                Office / EPUB / RTF: pre-flight, then the isolated child builds the derivative
 *                ZIP   central directory, then members unpacked into their own attachments
 *   ocr        → PDF pages whose text layer is unusable, by the OCR engine (ocr.ts)
 *   transcribing → audio / video, cut into timed segments (audio.ts)
 *   ready | failed (+ ER-9 `error_code`)
 *
 * A ready file comes back with its derivative (Stage 9 NORM): Markdown, the units it is made of
 * with their locators, a sidecar and warnings. The job stores it (fileJobs.ts), counts its tokens
 * and chunks it. The same function reads chat attachments and project files (one ingest path,
 * D1 #20). A failure is the file's outcome, never a thrown request error (AS-D6).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { imageSize } from 'image-size';

import type { Config } from '../../config.js';
import { NUMBERS } from '../../config/numbers.js';
import type { FileWarning } from '../../db/schema.js';
import type { Provider } from '../../providers/types.js';
import { ExtractionUnsupported } from '../retrieval.js';
import { extensionOf } from '../storage.js';
import { clock, transcribe } from './audio.js';
import { EXTRACTOR_VERSION, type Unit } from './derive.js';
import { FileFailure, fileErrorText, warning, type FileErrorCode } from './fileErrors.js';
import { ExtractionOutOfMemory, isolatedDerive, isolatedImage, isolatedPdfInspect, isolationLimits, parsedInChild } from './isolatedExtract.js';
import type { ModelInputStore } from './modelInputStore.js';
import { ocrPdfPages, pageNeedsOcr, type OcrEngine } from './ocr.js';
import { PAGE_IMAGE_LONG_EDGE_PX } from './pdfPages.js';
import { noScanner, type Scanner } from './scanner.js';
import { sniffFile } from './sniff.js';
import { decodeTextFile } from './textDecode.js';
import { runTool } from './untrustedTools.js';

export { noScanner, type Scanner } from './scanner.js';

/** Upload rules that are not sizes (ADR-0011, kept). Sizes and counts are N-10 (numbers.ts). */
export const FILE_LIMITS = {
  /** N-10: ≤20 files per chat. */
  maxFilesPerChat: NUMBERS.FILES_PER_CHAT.value,
  /** N-10: docs ≤1,000 pages. */
  pdfMaxPages: NUMBERS.PDF_MAX_PAGES.value,
  /** Up to this many pages a PDF is rendered as text and page images; beyond it, text only. */
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

/** What the pipeline made of a file, before the job stores it (Stage 9 NORM). */
export interface DerivativeDraft {
  kind: string;
  extractorVersion: string;
  /** The Markdown when it is in memory; null when it is only in `markdownPath`. */
  markdown: string | null;
  /** A local file holding the whole Markdown (a large text file is never one string). */
  markdownPath?: string;
  markdownChars: number;
  /** The first characters of the Markdown, for chunking a text too large to hold whole. */
  head?: string;
  units: Unit[];
  sidecar: Record<string, unknown>;
  warnings: FileWarning[];
  /** Images: the normalised copy every model is sent. */
  normalized?: { path: string; mimeType: string };
}

export type Outcome =
  | {
      status: 'ready';
      error: string;
      warnings: FileWarning[];
      extractedText: string | null;
      pageCount: number | null;
      derivative?: DerivativeDraft | null;
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

export interface PipelineInput {
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  cfg: Config;
  /** A scratch directory the derivative's files (Markdown, normalised copy) are written to. */
  workDir: string;
  visionProvider?: Provider;
  ocr?: OcrEngine | null;
  scanner?: Scanner;
  modelInputs?: ModelInputStore;
  /** Records the stage on the row; the job's lease fences it. */
  setStage?: (stage: FileStage) => Promise<void>;
  /** Unpacks a ZIP into member attachments; the pipeline only decides that it is one. */
  expandZip?: (localPath: string) => Promise<Outcome>;
  /** Stores new bytes in place of the upload (the PDF active-content strip). */
  replaceStored?: (localPath: string) => Promise<void>;
  signal?: AbortSignal;
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
    return await readText(input);
  } catch (err) {
    if (err instanceof FileFailure) return failed(err.code, err.detail);
    throw err;
  }
}

function ready(extractedText: string | null, warnings: FileWarning[] = [], pageCount: number | null = null, derivative: DerivativeDraft | null = null): Outcome {
  return {
    status: 'ready',
    // `error` keeps carrying a ready file's notes, as before, for clients that read only it.
    error: warnings.map((w) => w.detail).join(' '),
    warnings,
    extractedText,
    pageCount,
    derivative,
  };
}

export function failed(code: FileErrorCode, detail?: string): Outcome {
  return { status: 'failed', errorCode: code, error: fileErrorText(code, detail) };
}

/** The Markdown kept in `extracted_text`: whole, or null past EXTRACTED_TEXT_MAX_CHARS. */
function inlineText(cfg: Config, markdown: string | null): string | null {
  if (markdown === null || markdown.trim() === '') return null;
  return markdown.length <= cfg.EXTRACTED_TEXT_MAX_CHARS ? markdown : null;
}

function draft(kind: string, markdown: string, units: Unit[], sidecar: Record<string, unknown>, warnings: FileWarning[]): DerivativeDraft {
  return { kind, extractorVersion: EXTRACTOR_VERSION, markdown, markdownChars: markdown.length, units, sidecar, warnings };
}

/* ------------------------------------------------------------------ PDF */

async function pdfPageCountOf(file: string): Promise<number> {
  try {
    const { stdout } = await runTool('pdfinfo', [file], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const match = /^Pages:\s+(\d+)/m.exec(stdout);
    if (!match) throw new Error('pdfinfo reported no page count');
    return Number(match[1]);
  } catch (err) {
    // poppler says "Incorrect password" for a PDF that needs one to open (FT-11).
    const stderr = (err as { stderr?: string }).stderr ?? '';
    if (/password/i.test(stderr)) throw new FileFailure('encrypted');
    throw new FileFailure('corrupt', 'This PDF could not be opened. It may be damaged. Save it again and upload it.');
  }
}

async function readPdf(input: PipelineInput): Promise<Outcome> {
  const { cfg } = input;
  const pageCount = await pdfPageCountOf(input.path);
  if (pageCount > FILE_LIMITS.pdfMaxPages) {
    throw new FileFailure(
      'too_many_pages',
      `This PDF has ${pageCount.toLocaleString('en-US')} pages. PDFs can have at most ` +
        `${FILE_LIMITS.pdfMaxPages.toLocaleString('en-US')} pages.`,
    );
  }

  const warnings: FileWarning[] = [];
  let pdfPath = input.path;
  // Forms, comments, embedded files, and the active-content strip, in the child (pdf-lib parses
  // untrusted bytes). A PDF pdf-lib cannot read is still read by poppler below.
  let extras: Awaited<ReturnType<typeof isolatedPdfInspect>> | null = null;
  try {
    const stripped = path.join(input.workDir, 'stripped.pdf');
    extras = await isolatedPdfInspect(input.path, stripped, isolationLimits(cfg));
    if (extras.removed.length) {
      await input.replaceStored?.(stripped);
      pdfPath = stripped;
      warnings.push(warning('active_content_removed', 'Scripts and automatic actions in this PDF were removed from the stored copy.'));
    }
    if (extras.embeddedFiles > 0) {
      warnings.push(warning('embedded_files_ignored', `This PDF carries ${String(extras.embeddedFiles)} embedded file(s); they are not read.`));
    }
  } catch (err) {
    if (err instanceof FileFailure && err.code === 'timeout') throw err;
    extras = null;
  }

  if (pageCount > FILE_LIMITS.pdfVisualMaxPages) {
    warnings.push(
      warning(
        'text_only',
        `This PDF has more than ${String(FILE_LIMITS.pdfVisualMaxPages)} pages, so only its text is read; ` +
          'images and charts in it are not.',
      ),
    );
  }
  let texts: string[] = [];
  try {
    // One text block per page, split on the form feed pdftotext ends each page with, so a page
    // number in the text is the page the words are on.
    const { stdout } = await runTool('pdftotext', ['-enc', 'UTF-8', pdfPath, '-'], { timeout: 120_000, maxBuffer: 256 * 1024 * 1024 });
    texts = stdout.split('\f').slice(0, pageCount).map((t) => t.trim());
  } catch {
    warnings.push(warning('text_partial', 'The text layer of this PDF could not be read; its pages are still shown as images.'));
  }
  while (texts.length < pageCount) texts.push('');

  const units: Unit[] = texts.map((text, i) => ({ kind: 'page', label: `p. ${String(i + 1)}`, text, source: 'text' }));
  // A page with no text and no image is blank, not scanned: it is not sent to OCR.
  const withImages = await pagesWithImages(pdfPath);
  const toOcr = units.flatMap((u, i) => {
    const reason = pageNeedsOcr(u.text);
    if (!reason) return [];
    if (reason === 'empty' && withImages && !withImages.has(i + 1)) return [];
    return [i + 1];
  });
  const ocrReasons = Object.fromEntries(toOcr.map((n) => [n, pageNeedsOcr(texts[n - 1]!)]));
  if (toOcr.length > 0) {
    if (input.ocr) {
      await input.setStage?.('ocr');
      const pages = await ocrPdfPages(pdfPath, toOcr, input.ocr, {
        batchPages: cfg.OCR_BATCH_PAGES,
        deadlineMs: cfg.OCR_BATCH_DEADLINE_MS,
        concurrency: cfg.OCR_CONCURRENCY,
        longEdgePx: PAGE_IMAGE_LONG_EDGE_PX,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      for (const p of pages) {
        const u = units[p.num - 1]!;
        if (p.ok) Object.assign(u, { text: p.text, source: 'ocr', ocrEngine: p.engine, ocrVersion: p.version });
        // A page with some text that OCR could not improve keeps its text layer.
        else if (pageNeedsOcr(u.text) === 'empty') Object.assign(u, { text: '', source: 'failed', ocrEngine: p.engine });
      }
      const lost = pages.filter((p) => !p.ok).map((p) => p.num);
      if (lost.length) {
        warnings.push(warning('ocr_partial', `${String(lost.length)} scanned page(s) could not be read: ${summarisePages(lost)}. Retry the file to try again.`));
      }
    } else {
      warnings.push(warning('ocr_unavailable', `${String(toOcr.length)} page(s) look scanned, and no OCR engine is configured, so their text is not read.`));
    }
  }

  const blocks = units.filter((u) => u.text !== '').map((u) => `--- Page ${u.label.slice(3)} ---\n${u.text}`);
  if (extras?.fields.length) {
    const text = `## Form fields\n${extras.fields.map((f) => `- ${f.name}: ${f.value}`).join('\n')}`;
    units.push({ kind: 'form', label: 'Form fields', text, source: 'parsed' });
    blocks.push(text);
  }
  if (extras?.comments.length) {
    const text = `## Comments\n${extras.comments.map((c) => `- p. ${String(c.page)}${c.author ? `, ${c.author}` : ''}: ${c.text}`).join('\n')}`;
    units.push({ kind: 'comments', label: 'Comments', text, source: 'parsed' });
    blocks.push(text);
  }
  const markdown = blocks.join('\n\n');
  if (markdown === '' && pageCount > FILE_LIMITS.pdfVisualMaxPages) {
    warnings.push(warning('no_text_layer', 'It has no text layer, so nothing in it can be read.'));
  }
  const sidecar = {
    pageCount,
    ocrPages: units.filter((u) => u.source === 'ocr').length,
    ocrReasons,
    formFields: extras?.fields.length ?? 0,
    comments: extras?.comments.length ?? 0,
    activeContentRemoved: extras?.removed ?? [],
    encrypted: extras?.encrypted ?? false,
  };
  // Still `ready` with no text: the file itself goes to code, which can read what the model cannot.
  return ready(inlineText(cfg, markdown), warnings, pageCount, draft('pdf', markdown, units, sidecar, warnings));
}

/** Pages that draw at least one image (poppler's `pdfimages -list`); null when it cannot tell. */
async function pagesWithImages(pdfPath: string): Promise<Set<number> | null> {
  try {
    const { stdout } = await runTool('pdfimages', ['-list', pdfPath], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    const pages = new Set<number>();
    for (const line of stdout.split('\n').slice(2)) {
      const page = Number(line.trim().split(/\s+/)[0]);
      if (Number.isInteger(page) && page > 0) pages.add(page);
    }
    return pages;
  } catch {
    return null;
  }
}

function summarisePages(nums: number[]): string {
  return nums.length <= 10 ? nums.join(', ') : `${nums.slice(0, 10).join(', ')} and ${String(nums.length - 10)} more`;
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
  const max = FILE_LIMITS.imageMaxDimension;
  const heif = input.mimeType === 'image/heic' || input.mimeType === 'image/heif';
  if (!heif) {
    let width: number | undefined;
    let height: number | undefined;
    try {
      ({ width, height } = imageSize(input.path));
    } catch {
      throw new FileFailure('corrupt', 'This image could not be read. It may be damaged. Save it again and upload it.');
    }
    if (width === undefined || height === undefined) throw new FileFailure('corrupt');
    if (width > max || height > max) {
      throw new FileFailure('too_large', `This image is ${String(width)}×${String(height)} pixels. Images can be at most ${String(max)}×${String(max)}.`);
    }
  }
  const out = path.join(input.workDir, 'normalized');
  let img;
  try {
    img = await isolatedImage(
      input.path,
      input.mimeType,
      out,
      { maxEdge: input.cfg.IMAGE_MAX_LONG_EDGE_PX, maxBytes: input.cfg.IMAGE_MAX_BYTES, maxPixels: max * max },
      isolationLimits(input.cfg),
    );
  } catch (err) {
    if (err instanceof FileFailure && err.code === 'timeout') throw err;
    throw new FileFailure('corrupt', 'This image could not be read. It may be damaged. Save it again and upload it.');
  }
  const d = draft('image', '', [], { width: img.width, height: img.height, originalWidth: img.originalWidth, originalHeight: img.originalHeight, bytes: img.bytes }, []);
  d.normalized = { path: out, mimeType: img.mimeType };
  return ready(null, [], null, d);
}

/* ------------------------------------------------------------------ media */

async function readMedia(input: PipelineInput): Promise<Outcome> {
  const provider = input.visionProvider;
  if (!provider?.readMedia) {
    // A model that hears audio still gets the recording itself; only the transcript is missing.
    return ready(null, [warning('not_extracted', 'Transcribing audio/video needs a configured Gemini provider, which is not available. The file is stored but not transcribed.')]);
  }
  const { cfg } = input;
  const { durationS, segments } = await transcribe(input.path, provider as Provider & Required<Pick<Provider, 'readMedia'>>, {
    maxSeconds: NUMBERS.AUDIO_MAX_SECONDS.value, // N-10
    segmentSeconds: cfg.AUDIO_SEGMENT_SECONDS,
    overlapSeconds: cfg.AUDIO_OVERLAP_SECONDS,
    deadlineMs: cfg.AUDIO_SEGMENT_DEADLINE_MS,
    concurrency: cfg.AUDIO_CONCURRENCY,
    ...(input.modelInputs ? { modelInputs: input.modelInputs } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const units: Unit[] = segments.map((s) => ({
    kind: 'segment',
    label: `${clock(s.startMs)}–${clock(s.endMs)}`,
    text: s.text,
    source: s.ok ? 'transcript' : 'failed',
    tStartMs: s.startMs,
    tEndMs: s.endMs,
  }));
  const okCount = segments.filter((s) => s.ok).length;
  if (okCount === 0) return ready(null, [warning('not_extracted', 'This recording could not be transcribed. You can retry it.')]);
  const warnings: FileWarning[] = [];
  if (okCount < segments.length) {
    const lost = units.filter((u) => u.source === 'failed').map((u) => u.label);
    warnings.push(warning('transcript_partial', `${String(lost.length)} part(s) of this recording could not be transcribed: ${lost.slice(0, 5).join(', ')}.`));
  }
  const markdown = units.filter((u) => u.text).map((u) => `[${u.label}] ${u.text}`).join('\n\n');
  const sidecar = { durationS, segments: segments.length, model: segments.find((s) => s.ok)?.model ?? '' };
  return ready(inlineText(cfg, markdown), warnings, null, draft('audio', markdown, units, sidecar, warnings));
}

/* ------------------------------------------------------------------ parsed documents */

async function readParsed(input: PipelineInput): Promise<Outcome> {
  try {
    const body = await isolatedDerive(input.path, input.filename, input.mimeType, isolationLimits(input.cfg));
    return ready(inlineText(input.cfg, body.markdown), body.warnings, null, draft(body.kind, body.markdown, body.units, body.sidecar, body.warnings));
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

/* ------------------------------------------------------------------ plain text */

/** How much of a large text is kept in memory for chunking (E4: 2,000 chunks × ~3,200 chars). */
const TEXT_HEAD_CHARS = 8_000_000;

async function readText(input: PipelineInput): Promise<Outcome> {
  const out = path.join(input.workDir, 'text.md');
  const decoded = await decodeTextFile(input.path, out, Math.max(TEXT_HEAD_CHARS, input.cfg.EXTRACTED_TEXT_MAX_CHARS));
  const ext = extensionOf(input.filename);
  const kind = ext === '.csv' ? 'csv' : 'text';
  const sidecar: Record<string, unknown> = { encoding: decoded.encoding, chars: decoded.chars };
  if (kind === 'csv') sidecar['header'] = decoded.head.split(/\r?\n/, 1)[0] ?? '';
  const d: DerivativeDraft = {
    kind,
    extractorVersion: EXTRACTOR_VERSION,
    markdown: decoded.text,
    markdownChars: decoded.chars,
    head: decoded.head,
    units: [],
    sidecar,
    warnings: decoded.warnings,
  };
  if (decoded.text === null) d.markdownPath = out;
  const text = decoded.text !== null && decoded.chars <= input.cfg.EXTRACTED_TEXT_MAX_CHARS ? decoded.text : null;
  return ready(text, decoded.warnings, null, d);
}

/** For tests and the parity run: the stored Markdown of a draft, wherever it lives. */
export async function draftMarkdown(d: DerivativeDraft): Promise<string> {
  if (d.markdown !== null) return d.markdown;
  return d.markdownPath ? readFile(d.markdownPath, 'utf8') : '';
}
