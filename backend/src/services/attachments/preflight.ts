/**
 * Pre-flight for ZIP-based documents (DOCX, XLSX, PPTX, ODT, EPUB) before any parser sees
 * them (Stage 9 ISOLATION / G4-G6, D1 #7). Runs in the API process because it never inflates
 * a member whole: it reads the central directory, and at most the first few kilobytes of each
 * XML part. A decompression bomb is refused from its declared sizes, so refusing it costs
 * kilobytes, not the gigabytes it would inflate to.
 *
 * Refuses: an inflate ratio above ZIP_MAX_RATIO on any sizeable member; more unpacked bytes than
 * ZIP_MAX_UNPACKED_BYTES (N-10); encrypted members; macros (`vbaProject.bin`, FT-2); and an XML
 * part that declares a DTD or entity (the defusedxml rule: entity expansion and external
 * entities are how XML attacks a parser).
 */
import { NUMBERS } from '../../config/numbers.js';
import { extensionOf } from '../storage.js';
import { FileFailure, saveAsText } from './fileErrors.js';
import { inflateEntry, InflateLimit, isDirectory, isEncrypted, readCentralDirectory, type ZipEntry, type ZipSource } from './zipReader.js';

/** Members smaller than this are never ratio-checked: tiny XML parts compress extremely well. */
const RATIO_MIN_BYTES = 1024 * 1024;
/** How much of each XML part's start is read for a DTD (ours: the prolog sits at the start). */
const PROLOG_BYTES = 4096;

const REQUIRED_PART: Record<string, RegExp> = {
  '.docx': /^word\/document\.xml$/,
  '.xlsx': /^xl\/workbook\.xml$/,
  '.pptx': /^ppt\/presentation\.xml$/,
};

export interface PreflightOptions {
  maxRatio: number;
}

export function ratioExceeded(e: ZipEntry, maxRatio: number): boolean {
  if (e.uncompressedSize < RATIO_MIN_BYTES) return false;
  return e.compressedSize === 0 || e.uncompressedSize / e.compressedSize > maxRatio;
}

export async function preflightContainer(src: ZipSource, filename: string, opts: PreflightOptions): Promise<void> {
  const ext = extensionOf(filename);
  const entries = await readCentralDirectory(src);
  const total = entries.reduce((n, e) => n + e.uncompressedSize, 0);
  if (total > NUMBERS.ZIP_MAX_UNPACKED_BYTES.value /* N-10 */ || entries.some((e) => ratioExceeded(e, opts.maxRatio))) {
    throw new FileFailure('zip_ratio', 'This file expands far more than normal documents do, so it was not opened.');
  }
  if (entries.some(isEncrypted)) throw new FileFailure('encrypted');
  if (entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name))) {
    throw new FileFailure('unsupported_type', saveAsText(`${ext}`.replace(/x$/, 'm')));
  }
  const required = REQUIRED_PART[ext];
  if (required && !entries.some((e) => required.test(e.name))) {
    throw new FileFailure('unsupported_type', `The content of this file does not match its name (${ext}). Save it in the right format and upload it again.`);
  }

  for (const entry of entries) {
    if (isDirectory(entry) || !/\.(xml|rels)$/i.test(entry.name)) continue;
    const parts: Uint8Array[] = [];
    try {
      await inflateEntry(src, entry, (c) => void parts.push(c), {
        maxBytes: Math.max(PROLOG_BYTES * 4, 64 * 1024),
        stopAfter: PROLOG_BYTES,
      });
    } catch (err) {
      // Reading only the start of a member stops before its end; that is not a fault.
      if (!(err instanceof InflateLimit)) throw err;
    }
    const prolog = Buffer.concat(parts).subarray(0, PROLOG_BYTES).toString('latin1').replace(/\0/g, ''); // UTF-16 parts too
    if (/<!DOCTYPE|<!ENTITY/i.test(prolog)) {
      throw new FileFailure('corrupt', 'This file contains XML features that are not opened for safety. Save it again from Office and upload it.');
    }
  }
}
