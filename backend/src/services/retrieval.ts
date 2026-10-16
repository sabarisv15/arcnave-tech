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
import { and, asc, eq, inArray } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

import type { Database } from '../db/client.js';
import { fileChunks, fileDerivatives, projectFiles } from '../db/schema.js';
import type { ObjectStorage } from './storage.js';
import type { FileWarning } from '../db/schema.js';
import type { FileErrorCode } from './attachments/fileErrors.js';

export const CHUNK_TARGET_CHARS = 1400;
export const CHUNK_OVERLAP_CHARS = 180;
/**
 * Chunks indexed per file: Stage 9 EMBED E4, "~2,000 chunks / file, no silent truncation".
 * No N-id. A file that reaches it is indexed up to here and carries a `chunk_cap` warning.
 */
export const MAX_CHUNKS_PER_FILE = 2000;
/** The cap before INDEX_VERSION 2. A file indexed then at this many chunks was cut short. */
const LEGACY_MAX_CHUNKS_PER_FILE = 400;
/**
 * The indexer's version, stored on each project file. 2: Unicode tokens (letters, marks and
 * digits of every script), NFC chunk text, the E4 cap. 3: the one ingest path (ADR-0063):
 * derivatives, per-page OCR, chunks of ~N-14 tokens. A file below it is re-read by a `reindex`
 * file job (fileJobs.ts).
 */
export const INDEX_VERSION = 3;

/** The file was stored fine, but its text cannot be extracted for indexing. */
export class ExtractionUnsupported extends Error {
  /** Stage 15 ER-9 code (fileErrors.ts). The message is our own copy, never a library's. */
  readonly code: FileErrorCode;
  constructor(message: string, code: FileErrorCode = 'unsupported_type') {
    super(message);
    this.name = 'ExtractionUnsupported';
    this.code = code;
    Object.setPrototypeOf(this, ExtractionUnsupported.prototype);
  }
}

/* -------------------------------------------------------------------------- extraction */

/**
 * The text of an Office, e-book, spreadsheet or plain-text file. Runs inside the isolated
 * extractor (extractChild.ts). PDFs, images and recordings are read by the file pipeline
 * (pipeline.ts: poppler and per-page OCR, the image normaliser, timed transcription), not here.
 */
export async function extractText(data: Buffer, mimeType: string, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
    return extractWithOfficeParser(data, 'This Word file', 'docx');
  }
  if (lower.endsWith('.pptx') || mimeType.includes('presentationml')) {
    return extractWithOfficeParser(data, 'This PowerPoint file', 'pptx');
  }
  if (lower.endsWith('.odt') || mimeType === 'application/vnd.oasis.opendocument.text') {
    return extractWithOfficeParser(data, 'This OpenDocument file', 'odt');
  }
  if (lower.endsWith('.rtf') || mimeType === 'application/rtf' || mimeType === 'text/rtf') {
    return extractWithOfficeParser(data, 'This RTF file', 'rtf');
  }
  if (lower.endsWith('.epub') || mimeType === 'application/epub+zip') {
    return extractWithOfficeParser(data, 'This EPUB book', 'epub');
  }
  if (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    mimeType.includes('spreadsheetml') ||
    mimeType.includes('ms-excel')
  ) {
    return extractSpreadsheet(data, filename);
  }
  if (mimeType.startsWith('text/') || TEXT_MIMES.has(mimeType)) {
    return data.toString('utf8');
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

const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/javascript',
  'video/mp2t',
]);

/**
 * `.docx`, `.pptx`, `.odt`, `.rtf` and `.epub` share a parser: officeParser renders each into an AST and can emit
 * Markdown, which is what keeps a `.docx` table intact as pipe rows instead of the word soup
 * `extractRawText`-style extraction produces when it drops cell boundaries.
 */
async function extractWithOfficeParser(
  data: Buffer,
  label: string,
  fileType: 'docx' | 'pptx' | 'odt' | 'rtf' | 'epub',
): Promise<string> {
  let text: string;
  try {
    const { parseOffice } = await import('officeparser');
    // officeParser's docs ask for the type when parsing a Buffer; it is known from the upload
    // check. Without it the parser sniffs the bytes, and it sniffed a 30 MB .pptx as a plain zip
    // and refused it.
    const ast = await parseOffice(data, { ocr: false, fileType });
    text = (await ast.to('md')).value ?? '';
  } catch {
    // The parser's message is about its internals; the user gets the ER-9 copy (D1 #23).
    throw new ExtractionUnsupported(`${label} could not be opened. It may be damaged. Save it again and upload it.`, 'corrupt');
  }
  if (text.trim() === '') {
    throw new ExtractionUnsupported(`${label} contains no extractable text.`);
  }
  return text;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractHtmlTable(html: string): string {
  const rows: string[] = [];
  const trMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const tr of trMatches) {
    const cells: string[] = [];
    const cellMatches = tr[1]!.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi);
    for (const cell of cellMatches) {
      const text = decodeHtmlEntities(cell[1]!.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      cells.push(text);
    }
    if (cells.some((c) => c !== '')) rows.push(cells.join(' | '));
  }
  return rows.length > 0 ? rows.join('\n') : '';
}

function extractFromSheetJs(data: Buffer): string {
  const workbook = XLSX.read(data, { type: 'buffer', cellDates: true });
  const sheets: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const rows: string[] = [];
    for (const row of matrix) {
      if (!Array.isArray(row)) continue;
      const cells = row.map((c) => String(c ?? '').trim());
      if (cells.some((c) => c !== '')) rows.push(cells.join(' | '));
    }
    if (rows.length > 0) sheets.push(`--- ${sheetName} ---\n${rows.join('\n')}`);
  }
  return sheets.join('\n\n');
}

/** Each worksheet becomes a pipe-delimited grid, one line per row, so cell adjacency survives. */
export async function extractSpreadsheet(data: Buffer, _filename?: string): Promise<string> {
  // 1. If starts with PK\x03\x04 (ZIP archive), try ExcelJS first for standard OpenXML .xlsx
  const isZip =
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04;

  if (isZip) {
    try {
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(data as any);
      const sheets: string[] = [];
      for (const sheet of workbook.worksheets) {
        const rows: string[] = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            let val = '';
            try {
              val = String(cell.text ?? '').trim();
            } catch {
              val = String(cell.value ?? '').trim();
            }
            cells.push(val);
          });
          if (cells.some((c) => c !== '')) rows.push(cells.join(' | '));
        });
        if (rows.length > 0) sheets.push(`--- ${sheet.name} ---\n${rows.join('\n')}`);
      }
      const text = sheets.join('\n\n');
      if (text.trim() !== '') return text;
    } catch {
      // Fall through to SheetJS below
    }
  }

  // 2. Try SheetJS (handles .xlsx, .xls BIFF8/BIFF5, HTML tables, XML Spreadsheet 2003, CSV)
  try {
    const text = extractFromSheetJs(data);
    if (text.trim() !== '') return text;
  } catch {
    // Fall through to HTML table / CSV fallback
  }

  // 3. Fallback for raw HTML table (common with portal exports like AICTE)
  try {
    const str = data.toString('utf8');
    if (str.includes('<table') || str.includes('<html')) {
      const htmlText = extractHtmlTable(str);
      if (htmlText.trim() !== '') return htmlText;
    }
  } catch {
    // Fall through
  }

  // 4. Fallback for raw CSV/text disguised as spreadsheet
  const rawText = data.toString('utf8').trim();
  if (
    rawText &&
    !rawText.includes('\0') &&
    (rawText.includes(',') || rawText.includes('\t') || rawText.includes('\n'))
  ) {
    return rawText;
  }

  throw new ExtractionUnsupported('This spreadsheet has no cells with data on any sheet.');
}

export const extractXlsx = extractSpreadsheet;

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
  return chunks;
}

const STOPWORDS = new Set(
  `a an and are as at be by for from has have in is it its of on or that the to was were will
   with this these those you your we our they their he she i not`.split(/\s+/),
);

/**
 * Words of any script: runs of letters, combining marks and digits (LANG-1). The marks matter:
 * a Tamil or Hindi vowel sign is a mark, and a tokenizer without them cuts every word apart.
 * NFC first, at index and at query time alike, so the same word typed or extracted in a
 * different Unicode form is the same token. No language detection and no stemming.
 */
export function tokenize(text: string): string[] {
  return (text.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}']+/gu) ?? []).filter(
    (t) => [...t].length > 1 && !STOPWORDS.has(t),
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

/* -------------------------------------------------------------------------- whole files */

/**
 * The text `chunkText` split, put back together: the overlap each chunk repeats from the one
 * before it is dropped. An overlap is the longest start of a chunk that the previous one ends
 * with, at least 20 characters, or the whole previous chunk (a short one is carried entire).
 */
export function joinChunks(chunks: string[]): string {
  let out = '';
  let prev = '';
  for (const chunk of chunks) {
    if (!prev) {
      out = chunk;
    } else {
      let k = Math.min(prev.length, chunk.length, CHUNK_OVERLAP_CHARS * 2);
      while (k > 0 && !prev.endsWith(chunk.slice(0, k))) k -= 1;
      out += k >= 20 || (k > 0 && k === prev.length) ? chunk.slice(k) : `\n\n${chunk}`;
    }
    prev = chunk;
  }
  return out;
}

export interface ProjectFileText {
  filename: string;
  text: string;
  /** False when indexing stopped at MAX_CHUNKS_PER_FILE, so the text is not the whole file. */
  whole: boolean;
}

/**
 * Every ready file of a project, as its whole text, oldest first, with page markers. A file read
 * by the one ingest path (ADR-0063) is its derivative's Markdown, which is whole by construction;
 * an older file is its chunks put back together.
 */
export async function projectFileTexts(
  db: Database,
  projectId: string,
  onlyFileId?: string,
  storage?: Pick<ObjectStorage, 'get'>,
): Promise<ProjectFileText[]> {
  const files = await db
    .select({
      id: projectFiles.id,
      filename: projectFiles.filename,
      chunkCount: projectFiles.chunkCount,
      warnings: projectFiles.warnings,
      indexVersion: projectFiles.indexVersion,
      markdownKey: fileDerivatives.markdownKey,
    })
    .from(projectFiles)
    .leftJoin(fileDerivatives, eq(fileDerivatives.projectFileId, projectFiles.id))
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.status, 'ready'), onlyFileId ? eq(projectFiles.id, onlyFileId) : undefined))
    .orderBy(asc(projectFiles.createdAt), asc(projectFiles.id));
  if (files.length === 0) return [];

  const legacy = files.filter((f) => !(storage && f.markdownKey));
  const rows = legacy.length
    ? await db
        .select({ fileId: fileChunks.projectFileId, text: fileChunks.text, page: fileChunks.page })
        .from(fileChunks)
        .where(inArray(fileChunks.projectFileId, legacy.map((f) => f.id)))
        .orderBy(asc(fileChunks.projectFileId), asc(fileChunks.ordinal))
    : [];
  const out: ProjectFileText[] = [];
  for (const f of files) {
    if (storage && f.markdownKey) {
      try {
        out.push({ filename: f.filename, text: (await storage.get(f.markdownKey)).toString('utf8'), whole: true });
        continue;
      } catch {
        // Its Markdown is gone: fall through to the chunks, which say whether they are whole.
      }
    }
    const mine = rows.filter((r) => r.fileId === f.id);
    const parts: string[] = [];
    let i = 0;
    while (i < mine.length) {
      // Chunks never straddle a page, so the overlap is undone page by page.
      const page = mine[i]!.page;
      const pageChunks: string[] = [];
      while (i < mine.length && mine[i]!.page === page) pageChunks.push(mine[i++]!.text);
      parts.push(page != null ? `[Page ${String(page)}]\n${joinChunks(pageChunks)}` : joinChunks(pageChunks));
    }
    if (parts.length) out.push({ filename: f.filename, text: parts.join('\n\n'), whole: isWhole(f) });
  }
  return out;
}

/** False when the file's chunks stop at a cap, now (a `chunk_cap` warning) or before version 2. */
export function isWhole(file: { chunkCount: number; warnings: FileWarning[]; indexVersion: number }): boolean {
  if (file.warnings.some((w) => w.code === 'chunk_cap')) return false;
  if (file.indexVersion < INDEX_VERSION && file.chunkCount >= LEGACY_MAX_CHUNKS_PER_FILE) return false;
  return file.chunkCount < MAX_CHUNKS_PER_FILE;
}

/** The project's files in full, for a prompt: project knowledge goes in context whole (ADR-0020). */
export function formatWholeFiles(files: ProjectFileText[]): string {
  return (
    "The complete text of this project's files. They are whole documents, not excerpts.\n\n" +
    files.map((f) => `--- ${f.filename} ---\n${f.text}`).join('\n\n')
  );
}


