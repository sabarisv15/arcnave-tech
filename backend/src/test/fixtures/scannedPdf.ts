/**
 * Builds a genuinely scanned PDF for tests: pages are drawn with text, rasterised with
 * pdftoppm, and the PNGs embedded as the only content of a new PDF. The result has no text
 * layer at all, like a phone-scanned bank statement.
 *
 * Each page gets a distinct width, so a test can tell from a rendered image's pixel width which
 * page it is looking at.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const run = promisify(execFile);

export const pageWidthPt = (page: number): number => 600 + page * 12;
export const PAGE_HEIGHT_PT = 400;

export async function buildScannedPdf(pages: string[][][]): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanned-fixture-'));
  try {
    const src = await PDFDocument.create();
    const font = await src.embedFont(StandardFonts.Helvetica);
    pages.forEach((rows, i) => {
      const page = src.addPage([pageWidthPt(i + 1), PAGE_HEIGHT_PT]);
      rows.forEach((cells, r) => {
        page.drawText(cells.join('   '), { x: 20, y: PAGE_HEIGHT_PT - 30 - r * 18, size: 10, font });
      });
    });
    await fs.writeFile(path.join(dir, 'src.pdf'), await src.save());
    await run('pdftoppm', ['-r', '72', '-png', path.join(dir, 'src.pdf'), path.join(dir, 'p')]);

    const out = await PDFDocument.create();
    const width = String(pages.length).length;
    for (let i = 1; i <= pages.length; i++) {
      const png = await out.embedPng(await fs.readFile(path.join(dir, `p-${String(i).padStart(width, '0')}.png`)));
      const page = out.addPage([pageWidthPt(i), PAGE_HEIGHT_PT]);
      page.drawImage(png, { x: 0, y: 0, width: pageWidthPt(i), height: PAGE_HEIGHT_PT });
    }
    return Buffer.from(await out.save());
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Pixel size of a PNG (IHDR) or JPEG (first SOF marker) image. */
export function imageSize(base64: string): { width: number; height: number } {
  const b = Buffer.from(base64, 'base64');
  if (b[0] === 0x89) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('not a PNG or JPEG');
}
