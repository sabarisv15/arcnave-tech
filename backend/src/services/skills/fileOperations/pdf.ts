import { PDFDocument } from 'pdf-lib';

export interface PdfInspectResult {
  pageCount: number;
  title?: string;
  author?: string;
}

/**
 * PDF Skill operations: deterministic merge, split, and inspection using pdf-lib.
 * Preserves native PDF vector/text elements.
 */
export async function inspectPdf(inputBuffer: Buffer): Promise<PdfInspectResult> {
  const doc = await PDFDocument.load(inputBuffer);
  return {
    pageCount: doc.getPageCount(),
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
  };
}

export interface PdfMergeResult {
  buffer: Buffer;
  inputFilesCount: number;
  expectedTotalPages: number;
  actualPageCount: number;
}

export async function mergePdfFilesWithReport(inputBuffers: Buffer[]): Promise<PdfMergeResult> {
  if (inputBuffers.length === 0) {
    throw new Error('At least one PDF buffer is required to merge.');
  }

  const mergedDoc = await PDFDocument.create();
  let expectedTotalPages = 0;

  for (const buf of inputBuffers) {
    const srcDoc = await PDFDocument.load(buf);
    expectedTotalPages += srcDoc.getPageCount();
    const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    for (const page of copiedPages) {
      mergedDoc.addPage(page);
    }
  }

  const mergedBytes = await mergedDoc.save();
  const actualPageCount = mergedDoc.getPageCount();
  return {
    buffer: Buffer.from(mergedBytes),
    inputFilesCount: inputBuffers.length,
    expectedTotalPages,
    actualPageCount,
  };
}

export async function mergePdfFiles(inputBuffers: Buffer[]): Promise<Buffer> {
  const res = await mergePdfFilesWithReport(inputBuffers);
  return res.buffer;
}

export interface PdfSplitResult {
  buffers: Buffer[];
  partsCount: number;
  totalPagesExtracted: number;
}

export async function splitPdfFileWithReport(
  inputBuffer: Buffer,
  pageRanges: Array<[number, number]>,
): Promise<PdfSplitResult> {
  const srcDoc = await PDFDocument.load(inputBuffer);
  const totalPages = srcDoc.getPageCount();
  const results: Buffer[] = [];
  let totalPagesExtracted = 0;

  for (const [start, end] of pageRanges) {
    if (start < 1 || end > totalPages || start > end) {
      throw new Error(`Invalid page range [${start}, ${end}] for document with ${totalPages} pages.`);
    }

    const newDoc = await PDFDocument.create();
    // 0-indexed page indices
    const indices: number[] = [];
    for (let i = start - 1; i <= end - 1; i++) {
      indices.push(i);
    }

    const copiedPages = await newDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) {
      newDoc.addPage(page);
      totalPagesExtracted++;
    }

    const outBytes = await newDoc.save();
    results.push(Buffer.from(outBytes));
  }

  return {
    buffers: results,
    partsCount: results.length,
    totalPagesExtracted,
  };
}

export async function splitPdfFile(
  inputBuffer: Buffer,
  pageRanges: Array<[number, number]>,
): Promise<Buffer[]> {
  const res = await splitPdfFileWithReport(inputBuffer, pageRanges);
  return res.buffers;
}

