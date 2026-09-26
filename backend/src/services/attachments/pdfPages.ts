/**
 * Stage 2 for PDFs: what a model is shown when a PDF is sent to it.
 *
 * Claude is the reference ("How PDF support works", platform.claude.com/docs, PDF support):
 * "When you send a PDF to Claude ... the system converts each page of the document into an
 * image" and "the text from each page is extracted and provided alongside each page's image."
 * Its limits decide which PDFs get images (ADR-0011): up to 100 pages, text and page images;
 * beyond that, text only.
 *
 * The work is done here, locally with poppler, rather than by handing the PDF's bytes to one
 * provider's own PDF reader. The model is one API behind an interface. Every provider gets the
 * same pages, the same text, and the same images.
 *
 * Page images are JPEG, quality 90, with the long edge at 2000 px. That is the largest size
 * Claude accepts when a request carries more than 20 images. Measured on the 12-page scanned
 * KVB statement: 0.7 s to render, 5.8 MB in all, and the balance and count figures were legible.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AttachmentPage } from '../../providers/types.js';
import { FILE_LIMITS } from './processUpload.js';

const run = promisify(execFile);

export const PAGE_IMAGE_LONG_EDGE_PX = 2000;
export const PAGE_IMAGE_JPEG_QUALITY = 90;

export type PdfPage = AttachmentPage;

export type PdfForModel =
  | { kind: 'pages'; pageCount: number; pages: PdfPage[] }
  | { kind: 'text'; pageCount: number; text: string }
  | { kind: 'unreadable'; reason: string };

/**
 * Rendered results, keyed by stored object. A conversation resends its files every turn; the
 * bytes behind a key never change, so neither do their pages. Bounded by encoded size.
 */
const CACHE_MAX_BYTES = 256 * 1024 * 1024;
const cache = new Map<string, { value: PdfForModel; bytes: number }>();
let cachedBytes = 0;

function remember(key: string, value: PdfForModel): void {
  const bytes =
    value.kind === 'pages'
      ? value.pages.reduce((n, p) => n + (p.image?.base64?.length ?? 0) + p.text.length, 0)
      : value.kind === 'text'
        ? value.text.length
        : 0;
  if (bytes > CACHE_MAX_BYTES) return;
  cache.delete(key);
  cache.set(key, { value, bytes });
  cachedBytes += bytes;
  for (const [k, v] of cache) {
    if (cachedBytes <= CACHE_MAX_BYTES) break;
    cache.delete(k);
    cachedBytes -= v.bytes;
  }
}

/** Test hook: forget every rendered PDF. */
export function clearPdfPageCache(): void {
  cache.clear();
  cachedBytes = 0;
}

/** A rendered PDF already in memory, without its bytes: a follow-up turn skips the download. */
export function cachedPdfForModel(cacheKey: string): PdfForModel | undefined {
  const hit = cache.get(cacheKey);
  if (!hit) return undefined;
  cache.delete(cacheKey);
  cache.set(cacheKey, hit);
  return hit.value;
}

export async function pdfForModel(data: Buffer, cacheKey?: string): Promise<PdfForModel> {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) {
      // Refresh recency: Map iteration order is insertion order.
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return hit.value;
    }
  }
  const value = await render(data);
  if (cacheKey && value.kind !== 'unreadable') remember(cacheKey, value);
  return value;
}

async function render(data: Buffer): Promise<PdfForModel> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-pdf-'));
  try {
    const pdf = path.join(dir, 'in.pdf');
    await writeFile(pdf, data);

    let pageCount: number;
    try {
      const { stdout } = await run('pdfinfo', [pdf], { timeout: 60_000, maxBuffer: 1024 * 1024 });
      const match = /^Pages:\s+(\d+)/m.exec(stdout);
      if (!match) throw new Error('pdfinfo reported no page count');
      pageCount = Number(match[1]);
    } catch (err) {
      return { kind: 'unreadable', reason: firstLine(err) };
    }

    const { stdout: rawText } = await run('pdftotext', ['-enc', 'UTF-8', pdf, '-'], {
      timeout: 120_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    const texts = rawText.split('\f').slice(0, pageCount);

    if (pageCount > FILE_LIMITS.pdfVisualMaxPages) {
      const text = texts
        .map((t, i) => ({ num: i + 1, body: t.trim() }))
        .filter((p) => p.body !== '')
        .map((p) => `--- Page ${String(p.num)} ---\n${p.body}`)
        .join('\n\n');
      return { kind: 'text', pageCount, text };
    }

    await run(
      'pdftoppm',
      [
        '-jpeg',
        '-jpegopt',
        `quality=${String(PAGE_IMAGE_JPEG_QUALITY)}`,
        '-scale-to',
        String(PAGE_IMAGE_LONG_EDGE_PX),
        pdf,
        path.join(dir, 'p'),
      ],
      { timeout: 300_000, maxBuffer: 1024 * 1024 },
    );
    // pdftoppm zero-pads the page number to the width of the page count: p-1.jpg or p-001.jpg.
    const files = (await readdir(dir)).filter((f) => /^p-\d+\.jpg$/.test(f));
    const byNum = new Map(files.map((f) => [Number(/\d+/.exec(f)![0]), f]));
    const pages: PdfPage[] = [];
    for (let num = 1; num <= pageCount; num++) {
      const file = byNum.get(num);
      pages.push({
        num,
        text: (texts[num - 1] ?? '').trim(),
        ...(file ? { image: { mimeType: 'image/jpeg' as const, base64: (await readFile(path.join(dir, file))).toString('base64') } } : {}),
      });
    }
    return { kind: 'pages', pageCount, pages };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function firstLine(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr?.trim();
  if (stderr) return stderr.split('\n')[0]!.slice(0, 200);
  return err instanceof Error ? err.message.slice(0, 200) : String(err);
}
