/**
 * Pre-flight for ZIP-based documents (DOCX, XLSX, PPTX, ODT, EPUB) before any parser sees
 * them (Stage 9 ISOLATION / G4-G6, D1 #7, ADR-0066, ADR-0070). Runs in the API process with
 * bounded memory: nothing it inflates is kept.
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
 * - the members a parser reads are scanned through their whole length, across chunk boundaries,
 *   for `<!DOCTYPE` / `<!ENTITY`, in UTF-8 and in UTF-16 (the defusedxml rule: entity expansion
 *   and external entities are how XML attacks a parser), in time linear in their size
 *   (`MarkupScanner`). Which members, and which rule, is `scannerFor`.
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
/**
 * Office XML, relationships and VML, in any container, EPUB included: scanned strictly (no
 * DOCTYPE, no ENTITY). The Office readers (officeparser's Word/PowerPoint/OpenDocument parsers,
 * ExcelJS, SheetJS) read these, and which reader opens a file is chosen by its name and, for a
 * name with no extension, by the type the browser claimed (storage.ts `resolveMime`,
 * retrieval.ts `extractText`), so the pre-flight cannot know that an "EPUB" is not read as a
 * Word file. EPUB's own `.xml` members (`META-INF/container.xml`, `encryption.xml`,
 * `com.apple.ibooks.display-options.xml`) carry no DTD in practice (ADR-0070).
 */
const XML_PART = /\.(xml|rels|vml)$/i;
/**
 * What officeparser's EPUB reader parses besides `META-INF/container.xml` (an `.xml`, so strict
 * above): the package (`.opf`) and the chapters (`.xhtml/.html/.htm`). These legitimately open
 * with a DOCTYPE (`<!DOCTYPE html>`, the XHTML 1.1 PUBLIC form), so they get the lenient rule
 * (`MarkupScanner` 'epub'), in any container. Everything else in an EPUB (`.ncx`, `.svg`, `.xht`,
 * a name with no extension, CSS, media) is never parsed and is not scanned (ADR-0070, which
 * supersedes ADR-0066 §8). Pinned against the installed reader by preflightPass.test.ts.
 */
const EPUB_READ_PART = /\.(opf|xhtml|html|htm)$/i;
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
  await streamingPass(src, entries, maxTotal, opts);
}

/**
 * How a member is scanned for DTD markup, or null when no parser we run reads it. Independent of
 * the container's type: the rule follows the member, so the same bytes get the same rule whichever
 * reader the file is routed to.
 */
export function scannerFor(name: string): MarkupScanner | null {
  if (XML_PART.test(name)) return new MarkupScanner('xml');
  if (EPUB_READ_PART.test(name)) return new MarkupScanner('epub');
  return null;
}

/** Inflates every member once, counting and scanning, keeping nothing. */
async function streamingPass(src: ZipSource, entries: ZipEntry[], maxTotal: number, opts: PreflightOptions): Promise<void> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  let inflated = 0;
  for (const entry of entries) {
    if (now() > deadline) throw new FileFailure('timeout');
    if (isDirectory(entry)) continue;
    const scanner = scannerFor(entry.name);
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

/* ------------------------------------------------------------------ the markup scanner */

// Phases of an open DOCTYPE (epub mode).
const DECL_NONE = 0;
/** Right after `<!DOCTYPE`: at least one space must follow. */
const DECL_SPACE = 1;
const DECL_BEFORE_NAME = 2;
const DECL_NAME = 3;
/** After the root name, up to the closing `>`. */
const DECL_BODY = 4;

const LT = 0x3c;
const GT = 0x3e;
const BANG = 0x21;
const LSQB = 0x5b;
const QUOT = 0x22;
const APOS = 0x27;
const codes = (s: string): readonly number[] => [...s].map((c) => c.charCodeAt(0));
/** The keywords after `<!`, upper case. */
const DOCTYPE_WORD = codes('DOCTYPE');
const ENTITY_WORD = codes('ENTITY');
/** What `\s` matched in the Latin-1 text the previous scanner read: tab..CR, space, NBSP. */
const isSpace = (b: number): boolean => (b >= 0x09 && b <= 0x0d) || b === 0x20 || b === 0xa0;
const isNameStart = (b: number): boolean => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f;
const isNameChar = (b: number): boolean => isNameStart(b) || (b >= 0x30 && b <= 0x39) || b === 0x2e || b === 0x3a || b === 0x2d;

/**
 * Finds DTD markup in a stream of chunks, one byte at a time: a small state machine whose state
 * carries across chunks, so a marker split between two chunks is still seen and no byte is
 * looked at twice (review F13: the previous regex scanner went back over every declaration it
 * had already judged and was quadratic on `<!DOCTYPE a ` repeated). NUL bytes are skipped, which
 * turns UTF-16 (either byte order) markup into the same ASCII the UTF-8 form has.
 *
 * - `xml`: any `<!DOCTYPE` or `<!ENTITY` is refused.
 * - `epub`: any `<!ENTITY` is refused; a `<!DOCTYPE` naming any root is allowed only with no
 *   internal subset (`<!DOCTYPE html>`, `<!DOCTYPE html PUBLIC "…" "…">`, EPUB 2's
 *   `<!DOCTYPE ncx PUBLIC …>`). Refused: a `[` anywhere in it; a `<` outside a quoted literal; a
 *   `>` inside one (parsers disagree on where such a declaration ends); a declaration longer than
 *   DOCTYPE_MAX_CHARS, whether or not it closes; one still open when the part ends (`finish`).
 *   An external identifier is allowed: the parsers we run do not fetch one (ADR-0070, F18).
 */
export class MarkupScanner {
  /** 0 idle, 1 after `<`, 2 after `<!`, 3 inside a keyword (`word` at `wordAt`). */
  private marker = 0;
  private word: readonly number[] = DOCTYPE_WORD;
  private wordAt = 0;
  private decl = DECL_NONE;
  private declChars = 0;
  /** The open quote of a literal inside the DOCTYPE, 0 when none. */
  private quote = 0;
  private refused = false;

  constructor(private readonly mode: 'xml' | 'epub' = 'xml') {}

  /** True when refused markup was seen, in this chunk or an earlier one. */
  push(chunk: Uint8Array): boolean {
    if (this.refused) return true;
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]!;
      if (b === 0) continue;
      if ((this.decl !== DECL_NONE && !this.declByte(b)) || this.markerByte(b)) {
        this.refused = true;
        return true;
      }
    }
    return false;
  }

  /** True when the part ended inside a DOCTYPE (epub mode), or refused markup was seen. */
  finish(): boolean {
    return this.refused || this.decl !== DECL_NONE;
  }

  /** Advances the `<!DOCTYPE` / `<!ENTITY` matcher; true when the byte completes refused markup. */
  private markerByte(b: number): boolean {
    const up = b >= 0x61 && b <= 0x7a ? b - 0x20 : b;
    if (this.marker === 0) {
      if (b === LT) this.marker = 1;
      return false;
    }
    if (this.marker === 1) {
      this.marker = b === BANG ? 2 : b === LT ? 1 : 0;
      return false;
    }
    if (this.marker === 2) {
      if (up === DOCTYPE_WORD[0] || up === ENTITY_WORD[0]) {
        this.word = up === DOCTYPE_WORD[0] ? DOCTYPE_WORD : ENTITY_WORD;
        this.wordAt = 1;
        this.marker = 3;
      } else {
        this.marker = b === LT ? 1 : 0;
      }
      return false;
    }
    if (up !== this.word[this.wordAt]) {
      this.marker = b === LT ? 1 : 0;
      return false;
    }
    this.wordAt += 1;
    if (this.wordAt < this.word.length) return false;
    this.marker = 0;
    if (this.mode === 'xml' || this.word === ENTITY_WORD) return true;
    // A DOCTYPE inside a DOCTYPE (reachable only inside a quoted literal) is refused.
    if (this.decl !== DECL_NONE) return true;
    this.decl = DECL_SPACE;
    this.declChars = DOCTYPE_WORD.length + 2; // `<!DOCTYPE`
    this.quote = 0;
    return false;
  }

  /** One byte of an open DOCTYPE; false when the declaration is refused. */
  private declByte(b: number): boolean {
    this.declChars += 1;
    if (this.declChars > DOCTYPE_MAX_CHARS) return false;
    switch (this.decl) {
      case DECL_SPACE:
        if (!isSpace(b)) return false;
        this.decl = DECL_BEFORE_NAME;
        return true;
      case DECL_BEFORE_NAME:
        if (isSpace(b)) return true;
        if (!isNameStart(b)) return false;
        this.decl = DECL_NAME;
        return true;
      case DECL_NAME:
        if (b === GT) {
          this.decl = DECL_NONE;
          return true;
        }
        if (isSpace(b)) this.decl = DECL_BODY;
        else if (!isNameChar(b)) return false;
        return true;
      default:
        if (b === LSQB) return false;
        if (this.quote !== 0) {
          if (b === this.quote) this.quote = 0;
          return b !== GT;
        }
        if (b === QUOT || b === APOS) this.quote = b;
        else if (b === LT) return false;
        else if (b === GT) this.decl = DECL_NONE;
        return true;
    }
  }
}
