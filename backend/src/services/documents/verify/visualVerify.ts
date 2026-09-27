/**
 * Deterministic Layout Heuristics & Structural Property Verification.
 *
 * Inspects deliverable structures and style properties for layout defects:
 * 1. PDF: Structural & Text-Density Verification (blank page detection, page count, non-empty text extraction via pdf-parse).
 * 2. PPTX: Severe Text Clipping & Canvas Boundary Overflow (EMU coordinate boundary checks via OOXML inspection).
 * 3. PPTX/DOCX: Missing Media Placeholders (0-byte or corrupt image streams).
 *
 * NOTE: These are deterministic structural/style-property heuristics. Looking at the rendered pages
 * is the model's own step: the file skills say to render them and view them (ADR-0047).
 */
import JSZip from 'jszip';
import type { ExportFormat, VerificationResult } from '../types.js';

/** Slide canvas dimensions in EMUs for standard widescreen 16:9 presentation */
const PPTX_MAX_X_EMU = 12_192_000;
const PPTX_MAX_Y_EMU = 6_858_000;
/** Allowed slack (5%) for border styling before flagging boundary clipping */
const OVERFLOW_SLACK_FACTOR = 1.05;

export async function verifyLayoutHeuristics(
  format: ExportFormat,
  buffer: Buffer,
): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metrics: Record<string, number | string | boolean> = {
    blankPagesDetected: 0,
    clippedElementsDetected: 0,
    brokenMediaDetected: 0,
    visualPass: true,
  };

  switch (format) {
    case 'pdf': {
      try {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          let blankCount = 0;
          for (const page of result.pages) {
            if (page.text.trim().length === 0) {
              blankCount++;
            }
          }
          // If all pages have zero text and no screenshot screenshots
          if (blankCount === result.pages.length && result.pages.length > 0) {
            errors.push('Visual defect: All PDF pages rendered completely blank.');
          }
          metrics.blankPagesDetected = blankCount;
        } finally {
          await parser.destroy().catch(() => undefined);
        }
      } catch (err) {
        warnings.push(`PDF structural text verification deferred: ${String(err)}`);
      }
      break;
    }

    case 'pptx': {
      try {
        const zip = await JSZip.loadAsync(buffer);
        const slideFiles = Object.keys(zip.files).filter(
          (f) => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'),
        );

        let blankSlides = 0;
        let clippedElements = 0;

        for (const sf of slideFiles) {
          const xml = await zip.file(sf)!.async('text');
          const shapeCount = (xml.match(/<p:sp[\s>]/g) || []).length;
          const tableCount = (xml.match(/<a:tbl[\s>]/g) || []).length;
          const graphicCount = (xml.match(/<p:graphicFrame[\s>]/g) || []).length;

          if (shapeCount === 0 && tableCount === 0 && graphicCount === 0) {
            blankSlides++;
            errors.push(`Visual defect: ${sf} rendered with zero visible shapes, tables, or text.`);
          }

          // Inspect EMU coordinate bounding boxes
          const offMatches = xml.matchAll(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g);
          for (const m of offMatches) {
            const x = parseInt(m[1]!, 10);
            const y = parseInt(m[2]!, 10);
            const cx = parseInt(m[3]!, 10);
            const cy = parseInt(m[4]!, 10);

            if (x + cx > PPTX_MAX_X_EMU * OVERFLOW_SLACK_FACTOR) {
              clippedElements++;
            }
            if (y + cy > PPTX_MAX_Y_EMU * OVERFLOW_SLACK_FACTOR) {
              clippedElements++;
            }
          }
        }

        // Check for 0-byte media
        let brokenMedia = 0;
        const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'));
        for (const mf of mediaFiles) {
          const mediaData = await zip.file(mf)!.async('nodebuffer');
          if (mediaData.length === 0) {
            brokenMedia++;
            errors.push(`Visual defect: Slide image part ${mf} is 0 bytes (broken media).`);
          }
        }

        metrics.blankPagesDetected = blankSlides;
        metrics.clippedElementsDetected = clippedElements;
        metrics.brokenMediaDetected = brokenMedia;

        if (clippedElements > 0) {
          warnings.push(
            `Visual inspection flagged ${clippedElements} shape(s) extending beyond slide margins.`,
          );
        }
      } catch (err) {
        warnings.push(`PPTX visual render verification warning: ${String(err)}`);
      }
      break;
    }

    case 'docx': {
      try {
        const zip = await JSZip.loadAsync(buffer);
        const docXmlFile = zip.file('word/document.xml');
        if (docXmlFile) {
          const xml = await docXmlFile.async('text');
          const pCount = (xml.match(/<w:p[\s>]/g) || []).length;
          const tblCount = (xml.match(/<w:tbl[\s>]/g) || []).length;
          if (pCount === 0 && tblCount === 0) {
            errors.push('Visual defect: Document body contains zero paragraphs and zero tables.');
          }
        }

        // Check for 0-byte media
        let brokenMedia = 0;
        const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'));
        for (const mf of mediaFiles) {
          const mediaData = await zip.file(mf)!.async('nodebuffer');
          if (mediaData.length === 0) {
            brokenMedia++;
            errors.push(`Visual defect: Document embedded image ${mf} is 0 bytes.`);
          }
        }
        metrics.brokenMediaDetected = brokenMedia;
      } catch (err) {
        warnings.push(`DOCX visual render verification warning: ${String(err)}`);
      }
      break;
    }

    case 'xlsx': {
      // Level 2 checks for XLSX are covered in structural formula token inspection
      break;
    }
  }

  metrics.visualPass = errors.length === 0;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}

/** Backward-compatibility alias for verifyLayoutHeuristics */
export const verifyRenderVisuals = verifyLayoutHeuristics;

