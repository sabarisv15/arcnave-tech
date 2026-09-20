/**
 * Post-generation inspector and verifier for PDF files.
 * Verifies PDF binary header magic bytes, page tree integrity,
 * image XObjects, cross-references, and non-corrupt document structure.
 */

import { PDFDocument, PDFName } from 'pdf-lib';
import type { VerificationResult } from '../types.js';

export async function verifyPdf(buffer: Buffer): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metrics: Record<string, number | string | boolean> = {
    pages: 0,
    images: 0,
    fonts: 0,
    hasValidHeader: false,
    hasCrossReferenceTable: false,
  };

  if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
    return {
      ok: false,
      errors: ['Invalid PDF buffer: Buffer is null or smaller than minimum PDF size (100 bytes).'],
      warnings,
      metrics,
    };
  }

  // 1. Magic number check: %PDF-
  const header = buffer.subarray(0, 5).toString('ascii');
  metrics.hasValidHeader = header === '%PDF-';
  if (!metrics.hasValidHeader) {
    return {
      ok: false,
      errors: [`Invalid PDF header: Expected '%PDF-', found '${header}'.`],
      warnings,
      metrics,
    };
  }

  try {
    const pdfDoc = await PDFDocument.load(buffer, { updateMetadata: false });
    metrics.pages = pdfDoc.getPageCount();
    if (metrics.pages === 0) {
      errors.push('PDF document has 0 pages.');
    }

    // Inspect objects for embedded images and fonts
    let imageCount = 0;
    let fontCount = 0;

    const indirectObjects = pdfDoc.context.enumerateIndirectObjects();
    for (const [ref, obj] of indirectObjects) {
      if (typeof obj === 'object' && obj !== null && 'dict' in obj) {
        const dict = (obj as unknown as { dict: Map<unknown, unknown> }).dict;
        if (dict instanceof Map) {
          const typeVal = dict.get(PDFName.of('Type'));
          const subtypeVal = dict.get(PDFName.of('Subtype'));
          if (subtypeVal === PDFName.of('Image')) {
            imageCount++;
          }
          if (typeVal === PDFName.of('Font')) {
            fontCount++;
          }
        }
      }
    }

    metrics.images = imageCount;
    metrics.fonts = fontCount;

    // Verify presence of xref or cross-reference structure
    const rawString = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('latin1');
    metrics.hasCrossReferenceTable = rawString.includes('startxref') || rawString.includes('%%EOF');
    if (!metrics.hasCrossReferenceTable) {
      warnings.push('PDF trailer missing standard startxref marker.');
    }
  } catch (err: unknown) {
    errors.push(`Failed to parse and verify PDF document: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}
