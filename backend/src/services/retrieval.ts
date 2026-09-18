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

import type { Database } from '../db/client.js';
import { fileChunks, projectFiles } from '../db/schema.js';

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

export async function extractText(
  data: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  const lower = filename.toLowerCase();

  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return extractPdf(data);
  if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) return extractDocx(data);
  if (lower.endsWith('.xlsx') || mimeType.includes('spreadsheetml')) return extractXlsx(data);
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

async function extractPdf(data: Buffer): Promise<string> {
  let text: string;
  // pdf-parse v2 is class-based (v1's default-export function is gone) and holds a pdf.js
  // document open until destroyed, so the parser is disposed in a finally.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    text = result.text ?? '';
  } catch (err) {
    throw new ExtractionUnsupported(`This PDF could not be read: ${String(err)}`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
  if (text.trim() === '') {
    throw new ExtractionUnsupported(
      'No selectable text found. This looks like a scanned PDF; OCR is not configured.',
    );
  }
  return text;
}

async function extractDocx(data: Buffer): Promise<string> {
  let text: string;
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: data });
    text = result.value ?? '';
  } catch (err) {
    throw new ExtractionUnsupported(`This Word file could not be read: ${String(err)}`);
  }
  if (text.trim() === '') {
    throw new ExtractionUnsupported('This Word file contains no extractable text.');
  }
  return text;
}

async function extractXlsx(data: Buffer): Promise<string> {
  let text: string;
  try {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    // exceljs@4's bundled .d.ts declares its own `Buffer` param type that no longer structurally
    // matches @types/node's, regardless of which Buffer variant is passed — a known upstream
    // type-declaration bug (the runtime value is a plain, real Node Buffer either way).
    await workbook.xlsx.load(data as never);
    const sheets: string[] = [];
    workbook.eachSheet((sheet) => {
      const rows: string[] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell) => cells.push(cell.text));
        if (cells.some((c) => c.trim() !== '')) rows.push(cells.join('\t'));
      });
      if (rows.length > 0) sheets.push(`--- ${sheet.name} ---\n${rows.join('\n')}`);
    });
    text = sheets.join('\n\n');
  } catch (err) {
    throw new ExtractionUnsupported(`This spreadsheet could not be read: ${String(err)}`);
  }
  if (text.trim() === '') {
    throw new ExtractionUnsupported('This spreadsheet contains no readable cells.');
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
    const block = `--- ${chunk.filename} (part ${chunk.ordinal + 1}) ---\n${chunk.text}`;
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
): Promise<IndexResult> {
  await db.delete(fileChunks).where(eq(fileChunks.projectFileId, file.id));

  let text: string;
  try {
    text = await extractText(data, file.mimeType, file.filename);
  } catch (err) {
    if (err instanceof ExtractionUnsupported) {
      return { chunkCount: 0, status: 'unsupported', error: err.message };
    }
    throw err;
  }

  const pieces = chunkText(text);
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
      text: piece,
      charCount: piece.length,
    })),
  );

  return { chunkCount: pieces.length, status: 'ready', error: '' };
}
