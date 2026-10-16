/**
 * Running a parser over an untrusted file in a child process (Stage 9 ISOLATION / G6, D1 #7).
 *
 * The child gets a V8 heap limit (EXTRACTION_MEMORY_BUDGET_BYTES / EXTRACTION_CONCURRENCY), a
 * wall clock (EXTRACTION_TIMEOUT_MS) and an environment with no secret in it. At most
 * EXTRACTION_CONCURRENCY children run per instance, so the instance never holds more parser
 * memory than the one budget the old in-process queue (`oneAtATime`) was sized for, while
 * different files no longer wait for each other in the request.
 *
 * What runs here: the JavaScript parsers (officeparser, ExcelJS, SheetJS, pdf-lib, sharp, the HEIC
 * decoder). What does
 * not: poppler (already its own process, with a timeout), plain-text decoding (no parser), and
 * transcription and OCR, which are provider calls and stay with the caller.
 *
 * The heap limit bounds the JavaScript heap, not Buffers allocated outside it; a parser that
 * holds a whole archive in Buffers is bounded by the file's N-10 size instead.
 */
import { spawn } from 'node:child_process';
import { open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../../config.js';
import { extensionOf } from '../storage.js';
import { ExtractionUnsupported } from '../retrieval.js';
import type { DerivedBody, NormalisedImage, PdfInspection } from './derive.js';
import type { ChildRequest, ChildResult } from './extractChild.js';
import { FileFailure, fileErrorText, type FileErrorCode } from './fileErrors.js';
import { preflightContainer, type PreflightOptions } from './preflight.js';
import { fileSource } from './zipReader.js';
import { fileTmpDir, makeWorkDir } from './workDir.js';

/** The limits one child runs under, from config. */
export interface IsolationLimits {
  heapMb: number;
  timeoutMs: number;
  concurrency: number;
  maxRatio: number;
  /** Wall clock of the ZIP pre-flight's streaming pass (ZIP_PREFLIGHT_TIMEOUT_MS, ours). */
  preflightMs?: number;
}

export function isolationLimits(cfg: Config): IsolationLimits {
  const concurrency = Math.max(1, cfg.EXTRACTION_CONCURRENCY);
  return {
    heapMb: Math.max(64, Math.floor(cfg.EXTRACTION_MEMORY_BUDGET_BYTES / concurrency / (1024 * 1024))),
    timeoutMs: cfg.EXTRACTION_TIMEOUT_MS,
    concurrency,
    maxRatio: cfg.ZIP_MAX_RATIO,
    preflightMs: cfg.ZIP_PREFLIGHT_TIMEOUT_MS,
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
    const dir = await makeWorkDir('arcnave-extract-');
    try {
      const reqPath = path.join(dir, 'request.json');
      const out = path.join(dir, 'result.json');
      await writeFile(reqPath, JSON.stringify({ ...req, out } satisfies ChildRequest));
      const { file, args } = childCommand();
      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string; timedOut: boolean }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, [...args, `--max-old-space-size=${String(limits.heapMb)}`, file, reqPath], {
            // No secret reaches a parser: only what node and the temp directory need. NODE_ENV is
            // not a secret, and the child's module graph is the API's (ADR-0066).
            env: { PATH: process.env.PATH ?? '', NODE_ENV: process.env.NODE_ENV ?? 'production', TMPDIR: fileTmpDir() },
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

function preflightOptions(limits: IsolationLimits): PreflightOptions {
  return { maxRatio: limits.maxRatio, ...(limits.preflightMs !== undefined ? { deadlineMs: limits.preflightMs } : {}) };
}

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

/** Whether the file's own bytes open with a ZIP local-file or empty-archive signature. */
async function hasZipMagic(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    return bytesRead === 4 && head[0] === 0x50 && head[1] === 0x4b && [0x0304, 0x0506, 0x0708].includes(head.readUInt16BE(2));
  } finally {
    await handle.close();
  }
}

/**
 * The pre-flight, for every file a parser will open as a ZIP: by name or type, and by its bytes,
 * because the sniff lets a ZIP through under other names (an `.xlsx` saved as `.xls`), and the
 * parser opens what the bytes are, not what the name says (review R3#1, ADR-0066).
 */
async function preflightIfZip(filePath: string, filename: string, mimeType: string, limits: IsolationLimits): Promise<void> {
  if (!isZipDocument(filename, mimeType) && !(await hasZipMagic(filePath))) return;
  const src = await fileSource(filePath);
  try {
    await preflightContainer(src, filename, preflightOptions(limits));
  } finally {
    await src.close();
  }
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
  await preflightIfZip(filePath, filename, mimeType, limits);
  const result = await runChild({ op: 'text', input: filePath, filename, mimeType }, limits);
  if (!result.ok) throw childFailure(result);
  if (!('text' in result)) throw new FileFailure('corrupt');
  return result.text;
}

/** A parsed document's normalised derivative (derive.ts), built in the child after pre-flight. */
export async function isolatedDerive(filePath: string, filename: string, mimeType: string, limits: IsolationLimits): Promise<DerivedBody> {
  await preflightIfZip(filePath, filename, mimeType, limits);
  const result = await runChild({ op: 'derive', input: filePath, filename, mimeType }, limits);
  if (!result.ok) throw childFailure(result);
  if (!('derived' in result)) throw new FileFailure('corrupt');
  return result.derived;
}

/** A PDF's forms, comments and embedded files, and its active content stripped into `strippedPath`. */
export async function isolatedPdfInspect(filePath: string, strippedPath: string, limits: IsolationLimits): Promise<PdfInspection> {
  const result = await runChild({ op: 'pdfInspect', input: filePath, output: strippedPath, filename: 'file.pdf', mimeType: 'application/pdf' }, limits);
  if (!result.ok) throw childFailure(result);
  if (!('pdf' in result)) throw new FileFailure('corrupt');
  return result.pdf;
}

/** An image's normalised copy (derive.ts `normaliseImage`) written to `outPath`. */
export async function isolatedImage(
  filePath: string,
  mimeType: string,
  outPath: string,
  image: { maxEdge: number; maxBytes: number; maxPixels: number },
  limits: IsolationLimits,
): Promise<NormalisedImage> {
  const result = await runChild({ op: 'image', input: filePath, output: outPath, filename: 'image', mimeType, image }, limits);
  if (!result.ok) throw childFailure(result);
  if (!('image' in result)) throw new FileFailure('corrupt');
  return result.image;
}

function childFailure(result: { code: string; message: string }): Error {
  // `unsupported_type` from an extractor means "nothing in it to read" (an empty sheet); the
  // caller keeps such a file with a note. Every other code is a failure of the file itself.
  if (result.code === 'unsupported_type') return new ExtractionUnsupported(result.message);
  return new FileFailure(result.code as FileErrorCode, result.message);
}
