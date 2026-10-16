/**
 * OCR at upload (Stage 9 OCR-M11, D1 #8; P09).
 *
 * Per page, not per file: a page is OCR'd only when its text layer is empty, carries pdf.js-style
 * `(cid:N)` glyph codes, or reads as garbage (see `pageNeedsOcr`). Those pages are rendered and
 * sent in batches of at most OCR_BATCH_PAGES, each batch with its own deadline, at most one
 * retry, and a finish-reason check; a page still unread after that is `failed` and the file
 * carries an `ocr_partial` warning. Every OCR'd page records `ocr_engine` and `ocr_version`.
 *
 * The engine is an interface: Gemini now; the locked Document AI engine (ADR-0006, pinned RC)
 * plugs in behind it later and Gemini becomes its fallback.
 */
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { MediaPart, Provider } from '../../providers/types.js';
import { isAbort } from '../../providers/types.js';
import { runTool } from './untrustedTools.js';
import { makeWorkDir } from './workDir.js';

/* ------------------------------------------------------------------ detection */

export type OcrReason = 'empty' | 'cid' | 'garbage';

/**
 * Whether a page's text layer is unusable. The thresholds are ours (no locked number):
 * - fewer than 10 letters or digits: a scan, or a page that is only an image;
 * - `(cid:`: glyph ids with no Unicode mapping, as some extractors print them;
 * - garbage: more than 30 % of the non-space characters are private-use, replacement or control
 *   characters, or Latin-1 symbols; or more than 20 % of the words carry ASCII punctuation
 *   between letters. Legacy Tamil fonts (TAM / TAB / Bamini-style) map Tamil glyphs onto
 *   Latin-1 symbols or onto ASCII letters and `;[]\^`, which is what the last two catch.
 */
export function pageNeedsOcr(text: string): OcrReason | null {
  const visible = text.replace(/\s+/g, '');
  const wordChars = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (wordChars < 10) return 'empty';
  if (text.includes('(cid:')) return 'cid';
  const bad = (visible.match(/[\p{Co}�\p{Cc}\p{Cn}¡-¿×÷]/gu) ?? []).length;
  if (bad / visible.length > 0.3) return 'garbage';
  const words = text.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length >= 5) {
    const legacy = words.filter((w) => /[A-Za-z][;[\]\\^`{}|~][A-Za-z]/.test(w)).length;
    if (legacy / words.length > 0.2) return 'garbage';
  }
  return null;
}

/* ------------------------------------------------------------------ engine */

export interface OcrPageResult {
  num: number;
  text: string;
}

export interface OcrBatchResult {
  pages: OcrPageResult[];
  /** The engine's version for `ocr_version`. */
  version: string;
}

export interface OcrEngine {
  /** Stored as `ocr_engine`. */
  readonly name: string;
  /** Reads these page images. Throws `OcrIncomplete` when the answer cannot be trusted whole. */
  ocrBatch(pages: Array<{ num: number; image: MediaPart }>, signal: AbortSignal): Promise<OcrBatchResult>;
}

export class OcrIncomplete extends Error {
  override name = 'OcrIncomplete';
}

/** A page's marker in the engine's answer; the prompt asks for exactly this line per page. */
const MARKER = /^=== PAGE (\d+) ===\s*$/gm;

export function ocrPrompt(nums: number[]): string {
  return (
    `These are ${String(nums.length)} scanned page images, in order, numbered ${nums.join(', ')}. ` +
    'For each page, write the line "=== PAGE <number> ===" and then every word of visible text on that page, ' +
    'verbatim, in reading order, in the language and script it is written in. Keep table rows on one line each, ' +
    'with cells separated by " | ". Write nothing else.'
  );
}

/** Splits an answer at the page markers. A page with no marker is missing. */
export function parseOcrAnswer(answer: string, nums: number[]): OcrPageResult[] {
  const wanted = new Set(nums);
  const marks = [...answer.matchAll(MARKER)].map((m) => ({ num: Number(m[1]), start: m.index, end: m.index + m[0].length }));
  const out: OcrPageResult[] = [];
  marks.forEach((m, i) => {
    if (!wanted.has(m.num)) return;
    const text = answer.slice(m.end, marks[i + 1]?.start ?? answer.length).trim();
    out.push({ num: m.num, text });
  });
  return out;
}

/** Gemini 3.8 Flash as the OCR engine (OCR-M11: the fallback engine; the primary is later). */
export class GeminiOcrEngine implements OcrEngine {
  readonly name = 'gemini';
  constructor(private readonly provider: Provider & Required<Pick<Provider, 'readMedia'>>) {}

  async ocrBatch(pages: Array<{ num: number; image: MediaPart }>, signal: AbortSignal): Promise<OcrBatchResult> {
    const nums = pages.map((p) => p.num);
    const reading = await this.provider.readMedia(pages.map((p) => p.image), ocrPrompt(nums), signal);
    // Anything but a natural stop (MAX_TOKENS, SAFETY, RECITATION…) may have cut pages short.
    if (reading.finishReason !== 'STOP') throw new OcrIncomplete(reading.finishReason);
    return { pages: parseOcrAnswer(reading.text, nums), version: reading.model };
  }
}

export function ocrEngineFor(provider: Provider | undefined): OcrEngine | null {
  if (!provider?.readMedia) return null;
  return new GeminiOcrEngine(provider as Provider & Required<Pick<Provider, 'readMedia'>>);
}

/* ------------------------------------------------------------------ PDF pages */

export interface OcrOptions {
  batchPages: number;
  deadlineMs: number;
  concurrency: number;
  /** Long edge of a rendered page image, px. */
  longEdgePx: number;
  /** Stops the work (the job's lease was lost, the file was deleted). */
  signal?: AbortSignal;
}

export interface OcrdPage {
  num: number;
  text: string;
  ok: boolean;
  engine: string;
  version: string;
}

/** Renders one page of the PDF at `pdfPath` to a JPEG, base64. */
async function renderPage(pdfPath: string, num: number, dir: string, longEdgePx: number): Promise<string> {
  const base = path.join(dir, `p${String(num)}`);
  await runTool(
    'pdftoppm',
    ['-jpeg', '-jpegopt', 'quality=85', '-scale-to', String(longEdgePx), '-f', String(num), '-l', String(num), '-singlefile', pdfPath, base],
    { timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  const file = `${base}.jpg`;
  const data = await readFile(file);
  await rm(file, { force: true });
  return data.toString('base64');
}

/**
 * OCRs `nums` of the PDF at `pdfPath`: batches of `batchPages`, `concurrency` at once, each with
 * its own deadline and at most one retry of the pages it did not return.
 */
export async function ocrPdfPages(pdfPath: string, nums: number[], engine: OcrEngine, opts: OcrOptions): Promise<OcrdPage[]> {
  const batches: number[][] = [];
  for (let i = 0; i < nums.length; i += opts.batchPages) batches.push(nums.slice(i, i + opts.batchPages));
  const results = new Map<number, OcrdPage>();
  const dir = await makeWorkDir('arcnave-ocr-');
  try {
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++]!;
        let missing = batch;
        for (let attempt = 0; attempt < 2 && missing.length > 0; attempt++) {
          if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          // Rendered per attempt and dropped after it: a 1,000-page scan never sits in memory.
          const images = await Promise.all(
            missing.map(async (num) => ({ num, image: { mimeType: 'image/jpeg', base64: await renderPage(pdfPath, num, dir, opts.longEdgePx) } })),
          );
          const deadline = AbortSignal.timeout(opts.deadlineMs);
          const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
          try {
            const out = await engine.ocrBatch(images, signal);
            for (const p of out.pages) {
              if (p.text.trim() !== '') results.set(p.num, { num: p.num, text: p.text, ok: true, engine: engine.name, version: out.version });
            }
          } catch (err) {
            if (opts.signal?.aborted) throw err;
            // A deadline, a cut answer or a provider error: the batch gets its one retry.
            if (!(err instanceof OcrIncomplete) && !isAbort(err) && !(err instanceof Error)) throw err;
          }
          missing = missing.filter((n) => !results.has(n));
        }
        for (const num of missing) results.set(num, { num, text: '', ok: false, engine: engine.name, version: '' });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, batches.length)) }, worker));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return nums.map((n) => results.get(n)!);
}
