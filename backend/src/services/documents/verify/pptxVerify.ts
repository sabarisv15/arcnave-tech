/**
 * Post-generation inspector and verifier for PowerPoint (PPTX) files.
 * Verifies presentation archive integrity, slide counts, table existence,
 * card shapes, embedded media, and the >= 14pt typography floor.
 */

import JSZip from 'jszip';
import type { VerificationResult } from '../types.js';

export async function verifyPptx(buffer: Buffer): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metrics: Record<string, number | string | boolean> = {
    slides: 0,
    tables: 0,
    shapes: 0,
    images: 0,
    hasNotes: false,
    fontFloorPreserved: true,
  };

  if (!Buffer.isBuffer(buffer) || buffer.length < 500) {
    return {
      ok: false,
      errors: ['Invalid PPTX buffer: Buffer is null or smaller than minimum OOXML size.'],
      warnings,
      metrics,
    };
  }

  // 1. Magic number check: PK\x03\x04
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    return {
      ok: false,
      errors: ['Invalid PPTX header: Missing standard ZIP/OOXML magic bytes PK\\x03\\x04.'],
      warnings,
      metrics,
    };
  }

  try {
    const zip = await JSZip.loadAsync(buffer);

    // 2. Required presentation file
    if (!zip.file('ppt/presentation.xml')) {
      errors.push('Missing ppt/presentation.xml in PPTX archive.');
      return { ok: false, errors, warnings, metrics };
    }

    // 3. Count slides
    const slideFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'),
    );
    metrics.slides = slideFiles.length;
    if (slideFiles.length === 0) {
      errors.push('PPTX presentation has 0 slides.');
    }

    let tableCount = 0;
    let shapeCount = 0;
    let subFloorFontFound = false;

    for (const sf of slideFiles) {
      const slideXml = await zip.file(sf)!.async('text');

      const tblMatches = slideXml.match(/<a:tbl[\s>]/g);
      if (tblMatches) tableCount += tblMatches.length;

      const spMatches = slideXml.match(/<p:sp[\s>]/g);
      if (spMatches) shapeCount += spMatches.length;

      // In OOXML, font size is expressed in hundredths of a point: sz="1400" = 14pt
      const szMatches = slideXml.matchAll(/sz="(\d+)"/g);
      for (const m of szMatches) {
        const sz = parseInt(m[1]!, 10);
        // Any text run below 1400 (14pt) violates the floor (excluding 0 or default)
        if (sz > 0 && sz < 1400) {
          subFloorFontFound = true;
        }
      }
    }

    metrics.tables = tableCount;
    metrics.shapes = shapeCount;
    metrics.fontFloorPreserved = !subFloorFontFound;
    if (subFloorFontFound) {
      warnings.push('Presentation contains font sizes below the 14pt readability floor.');
    }

    // 4. Embedded media
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'));
    metrics.images = mediaFiles.length;

    // 5. Speaker notes
    const noteFiles = Object.keys(zip.files).filter((f) => f.startsWith('ppt/notesSlides/'));
    metrics.hasNotes = noteFiles.length > 0;
  } catch (err: unknown) {
    errors.push(`Failed to inspect PPTX presentation: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}
