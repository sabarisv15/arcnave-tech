/**
 * ArcNave Format-Native Deliverable Engine.
 * Shared source parsing + specialized format renderers + post-generation verification.
 */

import { renderDocument } from './docxRenderer.js';
import { resolveArtifactImage, extractImageDimensions } from './images.js';
import {
  markdownToDocumentSpec,
  markdownToSlidesSpec,
  markdownToSpreadsheetSpec,
} from './parse.js';
import { renderPdf } from './pdfRenderer.js';
import { renderSlides } from './pptxRenderer.js';
import { MarkdownConversionUnsupported, MIME_BY_FORMAT } from './types.js';
import type {
  ArtifactImage,
  DocumentBlock,
  DocumentSpec,
  ExportFormat,
  SheetSpec,
  SlideCard,
  SlideImage,
  SlideItem,
  SlideTable,
  SlidesSpec,
  SpreadsheetSpec,
  VerificationResult,
} from './types.js';
import { verifyDocx } from './verify/docxVerify.js';
import { verifyPdf } from './verify/pdfVerify.js';
import { verifyPptx } from './verify/pptxVerify.js';
import { verifyXlsx } from './verify/xlsxVerify.js';
import { renderSpreadsheet } from './xlsxRenderer.js';

export type {
  ArtifactImage,
  DocumentBlock,
  DocumentSpec,
  ExportFormat,
  SheetSpec,
  SlideCard,
  SlideImage,
  SlideItem,
  SlideTable,
  SlidesSpec,
  SpreadsheetSpec,
  VerificationResult,
};

export {
  MarkdownConversionUnsupported,
  MIME_BY_FORMAT,
  extractImageDimensions,
  markdownToDocumentSpec,
  markdownToSlidesSpec,
  markdownToSpreadsheetSpec,
  renderDocument,
  renderPdf,
  renderSlides,
  renderSpreadsheet,
  resolveArtifactImage,
  verifyDocx,
  verifyPdf,
  verifyPptx,
  verifyXlsx,
};

/**
 * Universal export orchestrator:
 * 1. Semantic parsing into format-native spec
 * 2. Specialized format generation
 * 3. Automated post-generation verification
 */
export async function renderMarkdownExport(markdown: string, format: ExportFormat): Promise<Buffer> {
  let buf: Buffer;
  let verification: VerificationResult;

  switch (format) {
    case 'xlsx': {
      const spec = markdownToSpreadsheetSpec(markdown);
      buf = await renderSpreadsheet(spec);
      verification = await verifyXlsx(buf);
      break;
    }
    case 'docx': {
      const spec = markdownToDocumentSpec(markdown);
      buf = await renderDocument(spec);
      verification = await verifyDocx(buf);
      break;
    }
    case 'pptx': {
      const spec = markdownToSlidesSpec(markdown);
      buf = await renderSlides(spec);
      verification = await verifyPptx(buf);
      break;
    }
    case 'pdf': {
      const spec = markdownToDocumentSpec(markdown);
      buf = await renderPdf(spec);
      verification = await verifyPdf(buf);
      break;
    }
    default: {
      const exhaustive: never = format;
      throw new Error(`Unsupported export format: ${String(exhaustive)}`);
    }
  }

  if (!verification.ok) {
    throw new Error(
      `Post-generation verification failed for ${format.toUpperCase()}: ${verification.errors.join('; ')}`,
    );
  }

  return buf;
}
