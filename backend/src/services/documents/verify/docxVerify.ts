/**
 * Post-generation inspector and verifier for Word (DOCX) files.
 * Verifies OOXML archive integrity, required schema files, table counts,
 * hyperlinks, footers, and embedded media.
 */

import JSZip from 'jszip';
import type { VerificationResult } from '../types.js';

export async function verifyDocx(buffer: Buffer): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metrics: Record<string, number | string | boolean> = {
    tables: 0,
    images: 0,
    hyperlinks: 0,
    hasFooter: false,
    hasPageNumbering: false,
    hasLandscape: false,
  };

  if (!Buffer.isBuffer(buffer) || buffer.length < 500) {
    return {
      ok: false,
      errors: ['Invalid DOCX buffer: Buffer is null or smaller than minimum OOXML size (500 bytes).'],
      warnings,
      metrics,
    };
  }

  // 1. Magic number check: PK\x03\x04
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    return {
      ok: false,
      errors: ['Invalid DOCX header: Missing standard ZIP/OOXML magic bytes PK\\x03\\x04.'],
      warnings,
      metrics,
    };
  }

  try {
    const zip = await JSZip.loadAsync(buffer);

    // 2. Required OOXML files
    if (!zip.file('[Content_Types].xml')) {
      errors.push('Missing [Content_Types].xml in DOCX archive.');
    }
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      errors.push('Missing word/document.xml in DOCX archive.');
      return { ok: false, errors, warnings, metrics };
    }

    const docXml = await docXmlFile.async('text');

    // 3. Table detection
    const tableMatches = docXml.match(/<w:tbl[\s>]/g);
    metrics.tables = tableMatches ? tableMatches.length : 0;

    // 4. Hyperlink relationships
    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (relsFile) {
      const relsXml = await relsFile.async('text');
      const hyperlinkMatches = relsXml.match(/Type="[^"]*hyperlink"/g);
      metrics.hyperlinks = hyperlinkMatches ? hyperlinkMatches.length : 0;
    }

    // 5. Embedded images
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'));
    metrics.images = mediaFiles.length;

    // 6. Footers and Page Numbering
    const footerFiles = Object.keys(zip.files).filter((f) => f.startsWith('word/footer'));
    metrics.hasFooter = footerFiles.length > 0;
    for (const ff of footerFiles) {
      const fXml = await zip.file(ff)!.async('text');
      if (fXml.includes('PAGE') || fXml.includes('fldChar') || fXml.includes('NUMPAGES')) {
        metrics.hasPageNumbering = true;
        break;
      }
    }

    // 7. Orientation
    metrics.hasLandscape = docXml.includes('w:orient="landscape"');
  } catch (err: unknown) {
    errors.push(`Failed to inspect DOCX archive: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}
