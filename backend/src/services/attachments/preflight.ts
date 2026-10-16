/**
 * Pre-flight for ZIP-based documents (DOCX, XLSX, PPTX, ODT, EPUB) before any parser sees
 * them (Stage 9 ISOLATION / G4-G6, D1 #7, ADR-0066). Runs in the API process with bounded
 * memory: nothing it inflates is kept.
 *
 * Two steps. First the central directory, nothing inflated: an inflate ratio above
 * ZIP_MAX_RATIO on any sizeable member, or more declared bytes than ZIP_MAX_UNPACKED_BYTES
 * (N-10), refuses the file for the cost of reading its directory; so do encrypted members and
 * macros (`vbaProject.bin`, FT-2).
 *
 * Then one streaming pass over every member, because the directory is what the file says about
 * itself and a parser inflates what is really there (review findings M3, N1):
 * - each member is inflated and its real bytes counted, the output discarded; a member that
 *   inflates past the size it declared is a bomb that lied (`zip_ratio`);
 * - the real total stops at ZIP_MAX_UNPACKED_BYTES (N-10, `zip_ratio`), and the pass has a wall
 *   clock (ZIP_PREFLIGHT_TIMEOUT_MS, ours, `timeout`);
 * - every `.xml` / `.rels` / `.vml` member is scanned through its whole length, across chunk
 *   boundaries, for `<!DOCTYPE` / `<!ENTITY`, in UTF-8 and in UTF-16 (the defusedxml rule:
 *   entity expansion and external entities are how XML attacks a parser). A prolog padded with
 *   a comment no longer hides one. EPUB members (every one but `mimetype` and media) get the
 *   lenient rule: a DOCTYPE without an internal subset is allowed, an ENTITY never.
 * Memory per step is one read of PASS_READ_BYTES and what it inflates to (deflate's ratio is
 * at most ~1,032:1, so about 4 MB), whatever the member declares.
 */
import { NUMBERS } from '../../config/numbers.js';
import { extensionOf } from '../storage.js';
import { FileFailure, saveAsText } from './fileErrors.js';
import { inflateEntry, InflateLimit, isDirectory, isEncrypted, readCentralDirectory, type ZipEntry, type ZipSource } from './zipReader.js';

/** Members smaller than this are never ratio-checked: tiny XML parts compress extremely well. */
const RATIO_MIN_BYTES = 1024 * 1024;
/** Compressed bytes read per inflate step (ours): bounds what one step can inflate to. */
export const PASS_READ_BYTES = 4 * 1024;
/** The pass's wall clock when the caller gives none (ZIP_PREFLIGHT_TIMEOUT_MS's default). */
const DEFAULT_DEADLINE_MS = 120_000;
/** Bytes carried from one chunk to the next, so a marker split across two is still seen. */
const SCAN_OVERLAP_CHARS = 64;
const MARKUP = /<!(?:DOCTYPE|ENTITY)/i;
/** Office XML, relationships and VML: scanned strictly (no DOCTYPE, no ENTITY), in any container. */
const XML_PART = /\.(xml|rels|vml)$/i;
/**
 * EPUB package, navigation and chapter parts: they legitimately open with a DOCTYPE (`<!DOCTYPE
 * html>`, EPUB 2's `<!DOCTYPE ncx PUBLIC …>`), so they are scanned with the lenient rule
 * (`MarkupScanner` 'epub'). Outside an EPUB only these names get it (review R3#2, r2 #1).
 */
const EPUB_MARKUP_PART = /\.(opf|ncx|xhtml|xht|html|htm)$/i;
/**
 * Members of an EPUB that are not scanned: the `mimetype` marker and media no XML parser reads.
 * Every other EPUB member is scanned, whatever its name: the parser opens what the OPF manifest
 * lists, and a chapter may be named `.xht` or have no extension at all (review r2 #2).
 */
const EPUB_UNSCANNED = /(^mimetype$)|\.(png|jpe?g|gif|webp|bmp|tiff?|ico|ttf|otf|woff2?|eot|mp3|mp4|m4a|m4v|aac|ogg|oga|ogv|opus|wav|webm|flac)$/i;
/** How far a DOCTYPE may run before its `>` (ours): past it, the declaration is refused. */
const DOCTYPE_MAX_CHARS = 4096;

const REQUIRED_PART: Record<string, RegExp> = {
  '.docx': /^word\/document\.xml$/,
  '.xlsx': /^xl\/workbook\.xml$/,
  '.pptx': /^ppt\/presentation\.xml$/,
};

export interface PreflightOptions {
  maxRatio: number;
  /** Wall clock of the streaming pass (ZIP_PREFLIGHT_TIMEOUT_MS, ours). */
  deadlineMs?: number;
  /** Real bytes the pass inflates at most; N-10's ZIP_MAX_UNPACKED_BYTES unless a test lowers it. */
  maxTotalBytes?: number;
  /** Test seams: the clock, and every inflated chunk's size (for the bounded-memory test). */
  now?: () => number;
  onInflated?: (bytes: number) => void;
}

export function ratioExceeded(e: ZipEntry, maxRatio: number): boolean {
  if (e.uncompressedSize < RATIO_MIN_BYTES) return false;
  return e.compressedSize === 0 || e.uncompressedSize / e.compressedSize > maxRatio;
}

const tooBig = (): FileFailure => new FileFailure('zip_ratio', 'This file expands far more than normal documents do, so it was not opened.');
const unsafeXml = (): FileFailure =>
  new FileFailure('corrupt', 'This file contains XML features that are not opened for safety. Save it again from Office and upload it.');

export async function preflightContainer(src: ZipSource, filename: string, opts: PreflightOptions): Promise<void> {
  const ext = extensionOf(filename);
  const entries = await readCentralDirectory(src);
  const maxTotal = opts.maxTotalBytes ?? NUMBERS.ZIP_MAX_UNPACKED_BYTES.value; // N-10
  const total = entries.reduce((n, e) => n + e.uncompressedSize, 0);
  if (total > maxTotal || entries.some((e) => ratioExceeded(e, opts.maxRatio))) throw tooBig();
  if (entries.some(isEncrypted)) throw new FileFailure('encrypted');
  if (entries.some((e) => /(^|\/)vbaProject\.bin$/i.test(e.name))) {
    // A ZIP under a non-OOXML name (an .xlsx saved as .xls) still names its macro format.
    throw new FileFailure('unsupported_type', saveAsText(ext.endsWith('x') ? ext.replace(/x$/, 'm') : `${ext}m`));
  }
  const required = REQUIRED_PART[ext];
  if (required && !entries.some((e) => required.test(e.name))) {
    throw new FileFailure('unsupported_type', `The content of this file does not match its name (${ext}). Save it in the right format and upload it again.`);
  }
  // An EPUB by name, or by its own layout (an EPUB under another name is still read as one).
  const epub = ext === '.epub' || (entries.some((e) => e.name === 'mimetype') && entries.some((e) => e.name === 'META-INF/container.xml'));
  await streamingPass(src, entries, maxTotal, opts, epub);
}

/** How a member is scanned for DTD markup, or null when it is not. */
function scannerFor(name: string, epub: boolean): MarkupScanner | null {
  if (XML_PART.test(name)) return new MarkupScanner('xml');
  if (EPUB_MARKUP_PART.test(name)) return new MarkupScanner('epub');
  if (epub && !EPUB_UNSCANNED.test(name)) return new MarkupScanner('epub');
  return null;
}

/** Inflates every member once, counting and scanning, keeping nothing. */
async function streamingPass(src: ZipSource, entries: ZipEntry[], maxTotal: number, opts: PreflightOptions, epub: boolean): Promise<void> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  let inflated = 0;
  for (const entry of entries) {
    if (now() > deadline) throw new FileFailure('timeout');
    if (isDirectory(entry)) continue;
    const scanner = scannerFor(entry.name, epub);
    try {
      await inflateEntry(
        src,
        entry,
        (chunk) => {
          inflated += chunk.length;
          opts.onInflated?.(chunk.length);
          if (inflated > maxTotal) throw tooBig();
          if (scanner?.push(chunk)) throw unsafeXml();
          if (now() > deadline) throw new FileFailure('timeout');
        },
        // The cap is what the member declared (inflateEntry's own); past it the directory lied.
        { maxBytes: Number.MAX_SAFE_INTEGER, readChunk: PASS_READ_BYTES },
      );
      if (scanner?.finish()) throw unsafeXml();
    } catch (err) {
      if (err instanceof InflateLimit) throw tooBig();
      throw err;
    }
  }
}

/**
 * Finds DTD markup in a stream of chunks. NUL bytes are dropped before matching, which turns
 * UTF-16 (either byte order) markup into the same ASCII the UTF-8 form has; the end of each
 * chunk is kept so markup split across two chunks is still seen.
 *
 * - `xml`: any `<!DOCTYPE` or `<!ENTITY` is refused.
 * - `epub`: any `<!ENTITY` is refused; a `<!DOCTYPE` naming any root is allowed only with no
 *   internal subset (`[`) before its `>` (`<!DOCTYPE html>`, EPUB 2's `<!DOCTYPE ncx PUBLIC …>`:
 *   the XML parser does not fetch an external DTD, and without a subset there is nothing to
 *   expand). A DOCTYPE still open when the part ends, or longer than DOCTYPE_MAX_CHARS, is refused.
 */
export class MarkupScanner {
  private tail = '';
  private open = false;

  constructor(private readonly mode: 'xml' | 'epub' = 'xml') {}

  /** True when refused markup was seen. */
  push(chunk: Uint8Array): boolean {
    const text = this.tail + Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1').replace(/\0/g, '');
    if (this.mode === 'xml') {
      this.tail = text.slice(-SCAN_OVERLAP_CHARS);
      return MARKUP.test(text);
    }
    if (/<!ENTITY/i.test(text)) return true;
    let keepFrom = Math.max(0, text.length - SCAN_OVERLAP_CHARS);
    this.open = false;
    const doctype = /<!DOCTYPE/gi;
    for (let m = doctype.exec(text); m; m = doctype.exec(text)) {
      const end = text.indexOf('>', m.index);
      if (end < 0) {
        if (text.length - m.index > DOCTYPE_MAX_CHARS) return true;
        // Judged when its end arrives: keep it whole for the next chunk.
        keepFrom = Math.min(keepFrom, m.index);
        this.open = true;
        break;
      }
      const decl = text.slice(m.index, end + 1);
      if (decl.includes('[') || !/^<!DOCTYPE\s+[A-Za-z_][\w.:-]*(\s|>)/i.test(decl)) return true;
    }
    this.tail = text.slice(keepFrom);
    return false;
  }

  /** True when the part ended inside a DOCTYPE (epub mode). */
  finish(): boolean {
    return this.open;
  }
}
