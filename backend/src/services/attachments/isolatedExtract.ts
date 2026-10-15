/**
 * Running a parser over an untrusted file in a child process (Stage 9 ISOLATION / G6, D1 #7).
 *
 * The child gets a V8 heap limit (EXTRACTION_MEMORY_BUDGET_BYTES / EXTRACTION_CONCURRENCY), a
 * wall clock (EXTRACTION_TIMEOUT_MS) and an environment with no secret in it. At most
 * EXTRACTION_CONCURRENCY children run per instance, so the instance never holds more parser
 * memory than the one budget the old in-process queue (`oneAtATime`) was sized for, while
 * different files no longer wait for each other in the request.
 *
 * What runs here: the JavaScript parsers (officeparser, ExcelJS, SheetJS, pdf.js). What does
 * not: poppler (already its own process, with a timeout), plain-text decoding (no parser), and
 * transcription and OCR, which are provider calls and stay with the caller.
 *
 * The heap limit bounds the JavaScript heap, not Buffers allocated outside it; a parser that
 * holds a whole archive in Buffers is bounded by the file's N-10 size instead.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../config.js';
import type { Provider } from '../../providers/types.js';
import { extensionOf } from '../storage.js';
import {
  ExtractionUnsupported,
  extractPages,
  pagesFromPdfLayer,
  type ExtractedPage,
  type PdfLayer,
} from '../retrieval.js';
import type { ChildRequest, ChildResult } from './extractChild.js';
import { FileFailure, fileErrorText, type FileErrorCode } from './fileErrors.js';
import { preflightContainer } from './preflight.js';
import { fileSource } from './zipReader.js';

/** The limits one child runs under, from config. */
export interface IsolationLimits {
  heapMb: number;
  timeoutMs: number;
  concurrency: number;
  maxRatio: number;
}

export function isolationLimits(cfg: Config): IsolationLimits {
  const concurrency = Math.max(1, cfg.EXTRACTION_CONCURRENCY);
  return {
    heapMb: Math.max(64, Math.floor(cfg.EXTRACTION_MEMORY_BUDGET_BYTES / concurrency / (1024 * 1024))),
    timeoutMs: cfg.EXTRACTION_TIMEOUT_MS,
    concurrency,
    maxRatio: cfg.ZIP_MAX_RATIO,
  };
}

/** The child ran out of its heap: the file is too large to parse within the budget. */
export class ExtractionOutOfMemory extends Error {
  override name = 'ExtractionOutOfMemory';
}

/* ------------------------------------------------------------------ concurrency */

let running = 0;
const waiting: Array<() => void> = [];

async function slot<T>(limit: number, fn: () => Promise<T>): Promise<T> {
  while (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/** Children running now, for tests. */
export function runningExtractions(): number {
  return running;
}

/* ------------------------------------------------------------------ child */

function childCommand(): { file: string; args: string[] } {
  const here = fileURLToPath(import.meta.url);
  // Under the test runner and `npm run dev` this module is TypeScript; the child then needs
  // the same loader. The built image runs the compiled `.js` with plain node.
  if (here.endsWith('.ts')) return { file: path.join(path.dirname(here), 'extractChild.ts'), args: ['--import', 'tsx'] };
  return { file: path.join(path.dirname(here), 'extractChild.js'), args: [] };
}

/** A path, a kind of work and the limits; the child's result, or a typed failure. */
export async function runChild(
  req: Omit<ChildRequest, 'out'>,
  limits: IsolationLimits,
): Promise<ChildResult> {
  return slot(limits.concurrency, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-extract-'));
    try {
      const reqPath = path.join(dir, 'request.json');
      const out = path.join(dir, 'result.json');
      await writeFile(reqPath, JSON.stringify({ ...req, out } satisfies ChildRequest));
      const { file, args } = childCommand();
      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string; timedOut: boolean }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, [...args, `--max-old-space-size=${String(limits.heapMb)}`, file, reqPath], {
            // No secret reaches a parser: only what node and the temp directory need.
            env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'production', TMPDIR: os.tmpdir() },
            stdio: ['ignore', 'ignore', 'pipe'],
          });
          let stderr = '';
          child.stderr.on('data', (chunk: Buffer) => {
            if (stderr.length < 16_384) stderr += chunk.toString('utf8');
          });
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, limits.timeoutMs);
          child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
          child.on('close', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, stderr, timedOut });
          });
        },
      );
      if (outcome.timedOut) throw new FileFailure('timeout');
      if (outcome.code !== 0) {
        if (/heap out of memory|Allocation failed|Reached heap limit/i.test(outcome.stderr) || outcome.signal === 'SIGABRT' || outcome.code === 134) {
          throw new ExtractionOutOfMemory('extraction exceeded its heap');
        }
        throw new FileFailure('corrupt');
      }
      return JSON.parse(await readFile(out, 'utf8')) as ChildResult;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

/* ------------------------------------------------------------------ which files */

const ZIP_DOCUMENTS = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.epub']);

/** Formats read by a JavaScript parser, so by the child. */
export function parsedInChild(mimeType: string, filename: string): boolean {
  const ext = extensionOf(filename);
  if (ZIP_DOCUMENTS.has(ext) || ext === '.xls' || ext === '.rtf') return true;
  return (
    mimeType.includes('wordprocessingml') ||
    mimeType.includes('presentationml') ||
    mimeType.includes('spreadsheetml') ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.oasis.opendocument.text' ||
    mimeType === 'application/epub+zip' ||
    mimeType === 'application/rtf' ||
    mimeType === 'text/rtf'
  );
}

export function isZipDocument(filename: string, mimeType: string): boolean {
  const ext = extensionOf(filename);
  if (ZIP_DOCUMENTS.has(ext)) return true;
  return mimeType.includes('openxmlformats') || mimeType === 'application/vnd.oasis.opendocument.text' || mimeType === 'application/epub+zip';
}

/**
 * The text of a parsed document at `filePath`: pre-flight first when it is a ZIP container,
 * then the child. Throws `FileFailure` (refusals, corrupt, timeout), `ExtractionUnsupported`
 * (readable but nothing to read), or `ExtractionOutOfMemory`.
 */
export async function isolatedText(
  filePath: string,
  filename: string,
  mimeType: string,
  limits: IsolationLimits,
): Promise<string> {
  if (isZipDocument(filename, mimeType)) {
    const src = await fileSource(filePath);
    try {
      await preflightContainer(src, filename, { maxRatio: limits.maxRatio });
    } finally {
      await src.close();
    }
  }
  const result = await runChild({ op: 'text', input: filePath, filename, mimeType }, limits);
  if (!result.ok) throw childFailure(result);
  if (!('text' in result)) throw new FileFailure('corrupt');
  return result.text;
}

function childFailure(result: { code: string; message: string }): Error {
  // `unsupported_type` from an extractor means "nothing in it to read" (an empty sheet); the
  // caller keeps such a file with a note. Every other code is a failure of the file itself.
  if (result.code === 'unsupported_type') return new ExtractionUnsupported(result.message);
  return new FileFailure(result.code as FileErrorCode, result.message);
}

/**
 * `extractPages` for project indexing with the parsers isolated: same signature, same results.
 * Failures come back as `ExtractionUnsupported` with their ER-9 code, which is what
 * `indexFile` records.
 */
export function isolatedExtractPages(cfg: Config): typeof extractPages {
  const limits = isolationLimits(cfg);
  return async (data: Buffer, mimeType: string, filename: string, visionProvider?: Provider): Promise<ExtractedPage[]> => {
    const isPdf = mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
    if (!isPdf && !parsedInChild(mimeType, filename)) return extractPages(data, mimeType, filename, visionProvider);

    const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-index-'));
    try {
      const input = path.join(dir, 'file');
      await writeFile(input, data);
      if (isPdf) {
        const result = await runChild(
          { op: 'pdfLayer', input, filename, mimeType, wantScreenshots: Boolean(visionProvider?.describeMedia) },
          limits,
        );
        if (!result.ok) throw childFailure(result);
        if (!('layer' in result)) throw new FileFailure('corrupt');
        return await pagesFromPdfLayer(result.layer as PdfLayer, visionProvider);
      }
      return [{ num: null, text: await isolatedText(input, filename, mimeType, limits) }];
    } catch (err) {
      if (err instanceof FileFailure) throw new ExtractionUnsupported(fileErrorText(err.code, err.detail), err.code);
      if (err instanceof ExtractionOutOfMemory) {
        throw new ExtractionUnsupported('This file is too large to read its text. Split it into smaller files.', 'too_large');
      }
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
