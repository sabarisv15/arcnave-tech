/**
 * Project knowledge: extraction, chunking, and retrieval.
 *
 * **This is lexical retrieval, not semantic retrieval.** Scoring is BM25 over chunk text.
 * There are no embeddings and no vector index, so the product never describes it as semantic.
 * `Retriever` is the seam: a managed implementation (Vertex AI Search, or pgvector plus an
 * embedding model) can replace `LexicalRetriever` without touching callers.
 *
 * Chunking is what keeps us inside Vertex's 30 MB payload cap and stops one large file from
 * crowding out every other source of context.
 */
import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';

import type { Database } from '../db/client.js';
import { fileChunks, projectFiles } from '../db/schema.js';
import type { Provider } from '../providers/types.js';

export const CHUNK_TARGET_CHARS = 1400;
export const CHUNK_OVERLAP_CHARS = 180;
export const MAX_CHUNKS_PER_FILE = 400;

/** The file was stored fine, but its text cannot be extracted for indexing. */
export class ExtractionUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionUnsupported';
  }
}

/* -------------------------------------------------------------------------- extraction */

/**
 * @param visionProvider Used for OCR (scanned PDFs) and audio/video transcription. Optional —
 *   when absent, those two branches fail with a typed reason instead of silently skipping the
 *   content, per Invariant 1. See ADR-0004, items 3 and 5.
 */
export async function extractText(
  data: Buffer,
  mimeType: string,
  filename: string,
  visionProvider?: Provider,
): Promise<string> {
  const lower = filename.toLowerCase();

  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    return extractPdf(data, visionProvider);
  }
  if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
    return extractWithOfficeParser(data, 'This Word file');
  }
  if (lower.endsWith('.pptx') || mimeType.includes('presentationml')) {
    return extractWithOfficeParser(data, 'This PowerPoint file');
  }
  if (lower.endsWith('.xlsx') || mimeType.includes('spreadsheetml')) return extractXlsx(data);
  if (mimeType.startsWith('text/') || TEXT_MIMES.has(mimeType)) {
    return data.toString('utf8');
  }
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
    return extractAudioVideo(data, mimeType, visionProvider);
  }
  if (mimeType.startsWith('image/')) {
    throw new ExtractionUnsupported(
      'Images are stored and can be attached to messages, but their contents are not indexed.',
    );
  }
  throw new ExtractionUnsupported(
    `No text extractor is available for ${mimeType || 'this file type'}.`,
  );
}

/**
 * Like `extractText`, but keeps page boundaries where the format has them (currently just PDF
 * with a text layer) so `indexFile` can chunk per page and a citation can name one. Everything
 * else comes back as a single page-less entry — see ADR-0004, item 6.
 */
export async function extractPages(
  data: Buffer,
  mimeType: string,
  filename: string,
  visionProvider?: Provider,
): Promise<ExtractedPage[]> {
  const lower = filename.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    return extractPdfPages(data, visionProvider);
  }
  return [{ num: null, text: await extractText(data, mimeType, filename, visionProvider) }];
}

const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/javascript',
  'video/mp2t',
]);

const OCR_PROMPT =
  'Transcribe every word of visible text on these scanned document pages, verbatim, in ' +
  'reading order. Output only the transcribed text, nothing else.';

/** A page of extracted text. `num` is null when the format has no pages, or OCR combined them. */
export interface ExtractedPage {
  num: number | null;
  text: string;
}

async function extractPdf(data: Buffer, visionProvider?: Provider): Promise<string> {
  const pages = await extractPdfPages(data, visionProvider);
  const text = pages.map((p) => p.text).join('\n\n');
  if (text.trim() === '') {
    throw new ExtractionUnsupported('No text could be read from this PDF, even with OCR.');
  }
  return text;
}

/**
 * Real per-page text when the PDF has a text layer, so a retrieved chunk can cite the page it
 * came from (see ADR-0004, item 6) rather than just the filename.
 *
 * A scanned PDF has no per-page attribution: OCR transcribes every rasterized page in one
 * vision call (one call per page would multiply Gemini cost by page count), so its result is a
 * single page-less block — file-level citation only, not page-accurate. That trade-off is
 * deliberate, not an oversight.
 */
async function extractPdfPages(data: Buffer, visionProvider?: Provider): Promise<ExtractedPage[]> {
  // pdf-parse v2 is class-based (v1's default-export function is gone) and holds a pdf.js
  // document open until destroyed, so the parser is disposed in a finally.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    // pdf-parse always inlines a `-- N of M --` page separator into the concatenated `.text`,
    // even for a page with zero real content, so that string is never actually empty for a
    // scanned PDF — only the per-page text is. Checked here, not against the whole-document
    // string, or a scanned PDF would silently skip the OCR branch below.
    const hasSelectableText = result.pages.some((page) => page.text.trim() !== '');
    if (hasSelectableText) {
      return result.pages
        .filter((page) => page.text.trim() !== '')
        .map((page) => ({ num: page.num, text: page.text }));
    }

    // No selectable text: this is a scanned PDF. Rasterize pages and let Gemini read them —
    // never a bundled OCR engine, so this capability comes and goes with the same
    // configuration as every other Gemini-backed feature. See ADR-0004, item 3.
    if (!visionProvider?.describeMedia) {
      throw new ExtractionUnsupported(
        'No selectable text found. This looks like a scanned PDF; OCR needs a configured ' +
          'Gemini provider, which is not available.',
      );
    }
    const screenshots = await parser.getScreenshot();
    const parts = screenshots.pages.map((page) => ({
      mimeType: 'image/png',
      base64: Buffer.from(page.data).toString('base64'),
    }));
    const text = await visionProvider.describeMedia(parts, OCR_PROMPT, new AbortController().signal);
    return [{ num: null, text }];
  } catch (err) {
    if (err instanceof ExtractionUnsupported) throw err;
    throw new ExtractionUnsupported(`This PDF could not be read: ${String(err)}`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractAudioVideo(
  data: Buffer,
  mimeType: string,
  visionProvider?: Provider,
): Promise<string> {
  if (!visionProvider?.describeMedia) {
    throw new ExtractionUnsupported(
      'Transcribing audio/video needs a configured Gemini provider, which is not available. ' +
        'The file is stored but not indexed.',
    );
  }
  let text: string;
  try {
    text = await visionProvider.describeMedia(
      [{ mimeType, base64: data.toString('base64') }],
      'Transcribe this recording verbatim. If it is not speech, describe what it contains ' +
        'instead. Output only the transcript or description, nothing else.',
      new AbortController().signal,
    );
  } catch (err) {
    throw new ExtractionUnsupported(`This file could not be transcribed: ${String(err)}`);
  }
  if (text.trim() === '') {
    throw new ExtractionUnsupported('Transcription returned no text for this file.');
  }
  return text;
}

/**
 * `.docx` and `.pptx` share a parser: officeParser renders both into an AST and can emit
 * Markdown, which is what keeps a `.docx` table intact as pipe rows instead of the word soup
 * `extractRawText`-style extraction produces when it drops cell boundaries.
 */
async function extractWithOfficeParser(data: Buffer, label: string): Promise<string> {
  let text: string;
  try {
    const { parseOffice } = await import('officeparser');
    const ast = await parseOffice(data, { ocr: false });
    text = (await ast.to('md')).value ?? '';
  } catch (err) {
    throw new ExtractionUnsupported(`${label} could not be read: ${String(err)}`);
  }
  if (text.trim() === '') {
    throw new ExtractionUnsupported(`${label} contains no extractable text.`);
  }
  return text;
}

/** Each worksheet becomes a pipe-delimited grid, one line per row, so cell adjacency survives. */
async function extractXlsx(data: Buffer): Promise<string> {
  let workbook: import('exceljs').Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    // exceljs/index.d.ts shadows the global `Buffer` with its own local
    // `interface Buffer extends ArrayBuffer {}`, which Node's real Buffer does not structurally
    // satisfy (`.slice()` returns Uint8Array, not ArrayBuffer). That local type is not
    // constructible from outside the module, so this is a real Buffer with a narrow, targeted
    // `any` around a broken third-party ambient declaration, not a loosened contract of ours.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(data as any);
  } catch (err) {
    throw new ExtractionUnsupported(`This spreadsheet could not be read: ${String(err)}`);
  }

  const sheets: string[] = [];
  for (const sheet of workbook.worksheets) {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(String(cell.text ?? '').trim());
      });
      if (cells.some((c) => c !== '')) rows.push(cells.join(' | '));
    });
    if (rows.length > 0) sheets.push(`--- ${sheet.name} ---\n${rows.join('\n')}`);
  }

  const text = sheets.join('\n\n');
  if (text.trim() === '') {
    throw new ExtractionUnsupported('This spreadsheet has no cells with data on any sheet.');
  }
  return text;
}

/* -------------------------------------------------------------------------- chunking */

/**
 * Split on paragraph boundaries, with a character overlap between neighbours.
 *
 * The overlap means a sentence spanning a boundary is still fully present in one chunk, so
 * retrieval does not lose the claim that straddles the split.
 */
export function chunkText(
  text: string,
  target = CHUNK_TARGET_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (normalized === '') return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.trim() !== '') chunks.push(current.trim());
    current = '';
  };

  for (let paragraph of paragraphs) {
    // A single oversized paragraph is hard-split rather than emitted whole.
    while (paragraph.length > target) {
      flush();
      chunks.push(paragraph.slice(0, target).trim());
      paragraph = paragraph.slice(Math.max(1, target - overlap));
    }
    if (current.length + paragraph.length + 2 > target) {
      const tail = overlap > 0 && current ? current.slice(-overlap) : '';
      flush();
      current = tail ? `${tail}\n\n${paragraph}` : paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  flush();
  return chunks.slice(0, MAX_CHUNKS_PER_FILE);
}

const STOPWORDS = new Set(
  `a an and are as at be by for from has have in is it its of on or that the to was were will
   with this these those you your we our they their he she i not`.split(/\s+/),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

/* -------------------------------------------------------------------------- retrieval */

export interface RetrievedChunk {
  chunkId: string;
  fileId: string;
  filename: string;
  ordinal: number;
  text: string;
  score: number;
  /** 1-based source page, when known. Null means "not paginated", never 0. */
  page: number | null;
}

export interface Retriever {
  search(
    db: Database,
    projectId: string,
    query: string,
    limit: number,
  ): Promise<RetrievedChunk[]>;
}

/**
 * BM25 over the project's indexed chunks.
 *
 * Scoring runs in JavaScript rather than SQL so the ranking is unit-testable without a
 * database and behaves identically wherever it runs. Corpus size is bounded by
 * MAX_CHUNKS_PER_FILE times the file count, which keeps this honest for a project-scale
 * knowledge base — it is not a general search engine.
 */
export class LexicalRetriever implements Retriever {
  async search(
    db: Database,
    projectId: string,
    query: string,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const rows = await db
      .select({
        id: fileChunks.id,
        fileId: fileChunks.projectFileId,
        ordinal: fileChunks.ordinal,
        text: fileChunks.text,
        page: fileChunks.page,
        filename: projectFiles.filename,
      })
      .from(fileChunks)
      .innerJoin(projectFiles, eq(fileChunks.projectFileId, projectFiles.id))
      .where(and(eq(fileChunks.projectId, projectId), eq(projectFiles.status, 'ready')));

    return rankBm25(
      rows.map((r) => ({
        chunkId: r.id,
        fileId: r.fileId,
        filename: r.filename,
        ordinal: r.ordinal,
        text: r.text,
        page: r.page,
      })),
      terms,
      limit,
    );
  }
}

/** Standard BM25 tuning constants; k1 controls term-frequency saturation, b length norm. */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

interface ScorableChunk {
  chunkId: string;
  fileId: string;
  filename: string;
  ordinal: number;
  text: string;
  page: number | null;
}

/** Exported separately so ranking can be tested without a database. */
export function rankBm25(
  documents: ScorableChunk[],
  terms: string[],
  limit: number,
): RetrievedChunk[] {
  if (documents.length === 0 || terms.length === 0) return [];

  const tokenized = documents.map((doc) => ({ doc, tokens: tokenize(doc.text) }));
  const total = tokenized.length;
  const avgLength =
    tokenized.reduce((sum, d) => sum + d.tokens.length, 0) / total || 1;

  const docFreq = new Map<string, number>();
  for (const { tokens } of tokenized) {
    for (const term of new Set(tokens)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  const scored: RetrievedChunk[] = [];
  for (const { doc, tokens } of tokenized) {
    if (tokens.length === 0) continue;
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

    let score = 0;
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const denominator = tf + BM25_K1 * (1 - BM25_B + (BM25_B * tokens.length) / avgLength);
      score += (idf * (tf * (BM25_K1 + 1))) / denominator;
    }
    if (score > 0) {
      scored.push({ ...doc, score: Math.round(score * 10000) / 10000 });
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score || a.filename.localeCompare(b.filename) || a.ordinal - b.ordinal,
  );
  return scored.slice(0, limit);
}

/**
 * Render retrieved chunks for the system prompt, under a hard character budget.
 *
 * The budget is the whole reason we retrieve: injecting every file into every request would
 * blow both the context window and Vertex's 30 MB payload limit.
 */
export function formatContext(chunks: RetrievedChunk[], maxChars: number): string {
  if (chunks.length === 0) return '';
  const parts: string[] = [];
  let used = 0;
  for (const chunk of chunks) {
    const location = chunk.page != null ? `p. ${chunk.page}` : `part ${chunk.ordinal + 1}`;
    const block = `--- ${chunk.filename} (${location}) ---\n${chunk.text}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
  }
  if (parts.length === 0) return '';
  return (
    "Excerpts from this project's files, selected by relevance to the question. " +
    'These are partial extracts, not whole documents.\n\n' +
    parts.join('\n\n')
  );
}

/* -------------------------------------------------------------------------- indexing */

export interface IndexResult {
  chunkCount: number;
  status: 'ready' | 'unsupported';
  error: string;
}

/**
 * Extract, chunk, and store chunks for a project file.
 *
 * Idempotent: existing chunks are deleted first, so a retry after a failure cannot produce
 * duplicates or leave a half-indexed file. Safe to call repeatedly.
 */
export async function indexFile(
  db: Database,
  file: { id: string; projectId: string; mimeType: string; filename: string },
  data: Buffer,
  visionProvider?: Provider,
): Promise<IndexResult> {
  await db.delete(fileChunks).where(eq(fileChunks.projectFileId, file.id));

  let pages: ExtractedPage[];
  try {
    pages = await extractPages(data, file.mimeType, file.filename, visionProvider);
  } catch (err) {
    if (err instanceof ExtractionUnsupported) {
      return { chunkCount: 0, status: 'unsupported', error: err.message };
    }
    throw err;
  }

  // Chunked per page, so a chunk never straddles a page boundary and a citation can name one
  // — the reason `extractPages` exists instead of a flat string. `ordinal` still counts across
  // the whole file, because `uq_chunk_ordinal` is unique per file, not per page.
  const rows: Array<{ text: string; page: number | null; charCount: number }> = [];
  for (const page of pages) {
    for (const piece of chunkText(page.text)) {
      rows.push({ text: piece, page: page.num, charCount: piece.length });
    }
  }
  const pieces = rows.slice(0, MAX_CHUNKS_PER_FILE);
  if (pieces.length === 0) {
    return {
      chunkCount: 0,
      status: 'unsupported',
      error: 'This file contained no extractable text.',
    };
  }

  await db.insert(fileChunks).values(
    pieces.map((piece, ordinal) => ({
      projectFileId: file.id,
      projectId: file.projectId,
      ordinal,
      text: piece.text,
      charCount: piece.charCount,
      page: piece.page,
    })),
  );

  return { chunkCount: pieces.length, status: 'ready', error: '' };
}
