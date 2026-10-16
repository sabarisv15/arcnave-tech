/**
 * How each file of a turn reaches the model (Stage 6 CXD-4, Stage 9 TOKENS / PDF->MODEL /
 * IMAGES / CLAUDE-IMG, D1 #10, #11, #21, #28; P09 / P12, ADR-0063).
 *
 * - Images are sent as their normalised copy (EXIF stripped and rotated, ≤ 2,576 px, ≤ 5 MB),
 *   never the original; when a request carries more than 20 images, each is sent at ≤ 2,000 px.
 * - A file whose provider token count for this model family fits N-05 (30k) goes whole. A file
 *   over it, or with no count, goes as excerpts retrieved for this question from its chunks
 *   (BM25, Invariant 4: lexical, not semantic). Never whole without a count (Invariant 3).
 * - A PDF within the budget and at most PDF_WHOLE_MAX_PAGES pages goes whole: every page's image
 *   and text. A larger one sends the images of the PDF_PAGE_IMAGES_PER_TURN pages that best match
 *   the question (the first pages when nothing matches), and its text whole or as excerpts.
 * - Pages read by OCR carry their OCR text, which the poppler render alone does not have.
 */
import { eq, inArray } from 'drizzle-orm';

import type { Config } from '../../config.js';
import { NUMBERS } from '../../config/numbers.js';
import type { Database } from '../../db/client.js';
import { derivativeChunks, fileDerivativePages, fileDerivatives } from '../../db/schema.js';
import type { AttachmentBlock, Turn } from '../../providers/types.js';
import { rankBm25, tokenize } from '../retrieval.js';
import { fitsWhole, type ModelFamily } from './derivatives.js';

type DerivativeRow = typeof fileDerivatives.$inferSelect;

const isImage = (a: AttachmentBlock) => a.mimeType.startsWith('image/');

/** Every block of the turn, current and history, in one list (the same objects). */
function allBlocks(current: AttachmentBlock[], history: Turn[]): AttachmentBlock[] {
  return [...current, ...history.flatMap((t) => t.attachments ?? [])];
}

async function loadDerivatives(db: Database, blocks: AttachmentBlock[]): Promise<Map<string, DerivativeRow>> {
  const ids = [...new Set(blocks.map((b) => b.id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(fileDerivatives).where(inArray(fileDerivatives.attachmentId, ids));
  return new Map(rows.map((r) => [r.attachmentId!, r]));
}

/**
 * Before bytes are loaded: an image block points at its normalised copy, so the original is
 * never fetched or sent (D1 #21). A file read before ADR-0063 has none and is sent as it was.
 */
export async function useNormalisedImages(db: Database, current: AttachmentBlock[], history: Turn[]): Promise<{ current: AttachmentBlock[]; history: Turn[] }> {
  const derived = await loadDerivatives(db, allBlocks(current, history).filter(isImage));
  const swap = (a: AttachmentBlock): AttachmentBlock => {
    const d = a.id ? derived.get(a.id) : undefined;
    if (!isImage(a) || !d?.normalizedKey || !d.normalizedMimeType) return a;
    const { base64: _original, ...rest } = a;
    return { ...rest, storageKey: d.normalizedKey, mimeType: d.normalizedMimeType };
  };
  return {
    current: current.map(swap),
    history: history.map((t) => (t.attachments ? { ...t, attachments: t.attachments.map(swap) } : t)),
  };
}

/** Over 20 images in one request, each image goes at ≤ IMAGE_MANY_LONG_EDGE_PX (Stage 9 G48). */
export async function applyManyImagesRule(cfg: Config, current: AttachmentBlock[], history: Turn[]): Promise<{ current: AttachmentBlock[]; history: Turn[] }> {
  const blocks = allBlocks(current, history);
  const images = blocks.filter((a) => isImage(a) && a.base64).length + blocks.reduce((n, a) => n + (a.pages?.filter((p) => p.image).length ?? 0), 0);
  if (images <= 20) return { current, history };
  const { default: sharp } = await import('sharp');
  const edge = cfg.IMAGE_MANY_LONG_EDGE_PX;
  // The normalised copies are our own JPEG / PNG output, so resizing them here parses nothing
  // untrusted. Page images are rendered at 2,000 px already (pdfPages.ts).
  const shrink = async (a: AttachmentBlock): Promise<AttachmentBlock> => {
    if (!isImage(a) || !a.base64) return a;
    const meta = await sharp(Buffer.from(a.base64, 'base64')).metadata();
    if ((meta.width ?? 0) <= edge && (meta.height ?? 0) <= edge) return a;
    const out = await sharp(Buffer.from(a.base64, 'base64')).resize({ width: edge, height: edge, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
    return { ...a, base64: out.toString('base64'), mimeType: 'image/jpeg' };
  };
  return {
    current: await Promise.all(current.map(shrink)),
    history: await Promise.all(history.map(async (t) => (t.attachments ? { ...t, attachments: await Promise.all(t.attachments.map(shrink)) } : t))),
  };
}

/** How many excerpts fit the whole-file budget: N-05 tokens in chunks of N-14 tokens. */
const EXCERPTS = Math.max(1, Math.floor(NUMBERS.WHOLE_FILE_MAX_TOKENS.value / NUMBERS.CHUNK_TARGET_TOKENS.value)); // N-05 / N-14

async function excerptsFor(db: Database, d: DerivativeRow, filename: string, prompt: string): Promise<string | null> {
  const chunks = await db.select().from(derivativeChunks).where(eq(derivativeChunks.derivativeId, d.id)).orderBy(derivativeChunks.ordinal);
  if (chunks.length === 0) return null;
  const ranked = rankBm25(
    chunks.map((c) => ({ chunkId: c.id, fileId: d.id, filename, ordinal: c.ordinal, text: c.text, page: c.page })),
    tokenize(prompt),
    EXCERPTS,
  );
  // Nothing in the question matches: the start of the file, in order.
  const picked = (ranked.length ? ranked.map((r) => chunks.find((c) => c.id === r.chunkId)!) : chunks.slice(0, EXCERPTS)).sort((a, b) => a.ordinal - b.ordinal);
  const body = picked.map((c) => `--- ${c.locator || `part ${String(c.ordinal + 1)}`} ---\n${c.text}`).join('\n\n');
  return (
    `[Excerpts of "${filename}" selected for this question: ${String(picked.length)} of ${String(chunks.length)} parts. ` +
    'The file is too large to send whole; code can open the whole file.]\n\n' +
    body
  );
}

/**
 * After bytes are loaded: each file whole or by excerpt, and a PDF's pages by the N-13 budget.
 */
export async function applyFileBudget(
  db: Database,
  family: ModelFamily,
  prompt: string,
  current: AttachmentBlock[],
  history: Turn[],
): Promise<{ current: AttachmentBlock[]; history: Turn[] }> {
  const derived = await loadDerivatives(db, allBlocks(current, history));
  if (derived.size === 0) return { current, history };
  const pageTexts = new Map<string, Map<number, string>>();
  const pdfIds = [...derived.values()].filter((d) => d.kind === 'pdf').map((d) => d.id);
  if (pdfIds.length) {
    const rows = await db.select().from(fileDerivativePages).where(inArray(fileDerivativePages.derivativeId, pdfIds));
    for (const r of rows) {
      if (r.kind !== 'page' || r.source !== 'ocr') continue;
      const m = pageTexts.get(r.derivativeId) ?? new Map<number, string>();
      m.set(Number(r.label.replace(/\D+/g, '')), r.text);
      pageTexts.set(r.derivativeId, m);
    }
  }

  const fit = async (a: AttachmentBlock): Promise<AttachmentBlock> => {
    const d = a.id ? derived.get(a.id) : undefined;
    if (!d || a.omittedReason) return a;
    const whole = fitsWhole(d.tokenCounts, family);
    const name = a.filename ?? 'file';

    if (a.pages) {
      const ocr = pageTexts.get(d.id);
      let pages = a.pages.map((p) => (ocr?.has(p.num) ? { ...p, text: ocr.get(p.num)! } : p));
      const total = pages.length;
      if (whole && total <= NUMBERS.PDF_WHOLE_MAX_PAGES.value) return { ...a, pages, wholeWithinBudget: true }; // N-13
      const k = NUMBERS.PDF_PAGE_IMAGES_PER_TURN.value; // N-13 (Normal)
      const ranked = rankBm25(
        pages.map((p) => ({ chunkId: String(p.num), fileId: d.id, filename: name, ordinal: p.num, text: p.text, page: p.num })),
        tokenize(prompt),
        k,
      ).map((r) => Number(r.chunkId));
      const chosen = new Set(ranked);
      for (const p of pages) if (chosen.size < k) chosen.add(p.num);
      // Text: every page's when the file fits N-05, else the chosen pages' only.
      pages = pages.flatMap((p) => (chosen.has(p.num) ? [p] : whole ? [{ num: p.num, text: p.text }] : []));
      const shown = [...chosen].sort((x, y) => x - y);
      return {
        ...a,
        pages,
        pageCount: total,
        wholeWithinBudget: false,
        pagesNote:
          `[This PDF has ${String(total)} pages. Images are sent for ${String(shown.length)} of them (pages ${shown.join(', ')}), ` +
          `chosen for this question; ${whole ? 'the text of every page follows' : 'only those pages’ text follows'}. Code can open the whole file.]`,
      };
    }
    if (isImage(a)) return a;
    if (whole) return { ...a, wholeWithinBudget: true };
    const excerpts = await excerptsFor(db, d, name, prompt);
    if (excerpts === null) return { ...a, wholeWithinBudget: false };
    const { textOnlyPageCount: _t, ...rest } = a;
    return { ...rest, extractedText: excerpts, excerpted: true, wholeWithinBudget: false };
  };
  return {
    current: await Promise.all(current.map(fit)),
    history: await Promise.all(history.map(async (t) => (t.attachments ? { ...t, attachments: await Promise.all(t.attachments.map(fit)) } : t))),
  };
}

export function familyOf(provider: string): ModelFamily {
  return provider === 'google' ? 'gemini' : 'claude';
}
