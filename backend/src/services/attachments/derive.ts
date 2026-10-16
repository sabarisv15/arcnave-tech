/**
 * Normalised derivatives of parsed documents (Stage 9 NORM / EXCEL / EXTRACT, D1 #9, #30; P12),
 * and the image normaliser (Stage 9 IMAGES, D1 #15) and PDF active-content strip (Stage 9 SCAN,
 * D1 #22; P19).
 *
 * Everything here parses untrusted bytes, so it runs only inside the isolated child
 * (extractChild.ts), never in the API process. Each builder returns Markdown, the units it is
 * made of with their locators (sheet, slide, section, page), a sidecar of facts, and warnings.
 * Built in the order the plan stages them: XLSX → PPTX → DOCX → PDF.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { unzipSync, strFromU8 } from 'fflate';
import * as XLSX from 'xlsx';

import type { FileWarning } from '../../db/schema.js';
import { extractText } from '../retrieval.js';
import { warning } from './fileErrors.js';

/** Bumped when any builder's output changes; a derivative of an older version is not reused (G3). */
export const EXTRACTOR_VERSION = 'ingest-1';

export interface Unit {
  /** sheet | slide | section | page | segment | form | comments */
  kind: string;
  label: string;
  text: string;
  /** text | ocr | transcript | parsed | failed */
  source: string;
  ocrEngine?: string;
  ocrVersion?: string;
  tStartMs?: number;
  tEndMs?: number;
}

export interface DerivedBody {
  kind: string;
  markdown: string;
  units: Unit[];
  sidecar: Record<string, unknown>;
  warnings: FileWarning[];
}

/* ------------------------------------------------------------------ XLSX */

const cellText = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

/**
 * Each sheet as a table whose header is the column letters and whose first column is the row
 * number, so every value keeps its cell address (Stage 9 EXCEL). Values are the formatted text
 * Excel shows (a lakh-format number reads 12,34,567). Hidden sheets are included and labelled;
 * formulas with no cached value are warned about.
 */
export function deriveXlsx(data: Buffer): DerivedBody {
  const wb = XLSX.read(data, { type: 'buffer', cellNF: true, cellFormula: true, cellDates: false, dense: false });
  const units: Unit[] = [];
  const sheets: Array<Record<string, unknown>> = [];
  let noValue = 0;
  const hidden: string[] = [];
  wb.SheetNames.forEach((name, i) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const state = wb.Workbook?.Sheets?.[i]?.Hidden ?? 0;
    if (state) hidden.push(name);
    const ref = ws['!ref'];
    if (!ref) {
      sheets.push({ name, hidden: Boolean(state), ref: null, rows: 0, columns: 0 });
      return;
    }
    const range = XLSX.utils.decode_range(ref);
    const cols: number[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) cols.push(c);
    const lines: string[] = [];
    const rows: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells = cols.map((c) => {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        if (!cell) return '';
        if (cell.f && cell.v === undefined) noValue += 1;
        return cellText(String(cell.w ?? cell.v ?? ''));
      });
      if (cells.every((v) => v === '')) continue;
      rows.push(cells);
      lines.push(`| ${String(r + 1)} | ${cells.join(' | ')} |`);
    }
    const letters = cols.map((c) => XLSX.utils.encode_col(c));
    const title = `## Sheet: ${name}${state ? ' (hidden)' : ''}`;
    const summary = `Range ${ref} · ${String(rows.length)} rows with data × ${String(cols.length)} columns`;
    const table = [`| Row | ${letters.join(' | ')} |`, `|---|${letters.map(() => '---').join('|')}|`, ...lines].join('\n');
    const text = `${title}\n${summary}\n\n${table}`;
    units.push({ kind: 'sheet', label: `${name}!${ref}`, text, source: 'parsed' });
    sheets.push({
      name,
      hidden: Boolean(state),
      ref,
      rows: rows.length,
      columns: cols.length,
      header: rows[0] ?? [],
      sample: rows.slice(1, 6),
    });
  });
  const warnings: FileWarning[] = [];
  if (hidden.length) warnings.push(warning('hidden_sheets', `Hidden sheets are included and labelled: ${hidden.join(', ')}.`));
  if (noValue) {
    warnings.push(
      warning('formula_no_value', `${String(noValue)} formula cell${noValue === 1 ? ' has' : 's have'} no saved value; open and save the file in Excel to fill them.`),
    );
  }
  return { kind: 'xlsx', markdown: units.map((u) => u.text).join('\n\n'), units, sidecar: { sheets }, warnings };
}

/* ------------------------------------------------------------------ XML helpers */

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Paragraph texts of a DrawingML part (`<a:p>` … `<a:t>`), fields (slide numbers) left out. */
function drawingParagraphs(xml: string): string[] {
  return xml
    .replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, '')
    .split(/<\/a:p>/)
    .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]!)).join(''))
    .map((t) => t.trim())
    .filter(Boolean);
}

function relsOf(xml: string | undefined): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>();
  for (const m of (xml ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(m[1]!)?.[1] ?? '';
    map.set(attr('Id'), { type: attr('Type'), target: attr('Target') });
  }
  return map;
}

function resolvePart(base: string, target: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/* ------------------------------------------------------------------ PPTX */

/** One unit per slide, in presentation order, with its speaker notes (Stage 9 OFFICE->PDF text half). */
export function derivePptx(data: Buffer): DerivedBody {
  const files = unzipSync(data, { filter: (f) => f.name.startsWith('ppt/') && (f.name.endsWith('.xml') || f.name.endsWith('.rels')) });
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : undefined);
  const presentation = read('ppt/presentation.xml') ?? '';
  const rels = relsOf(read('ppt/_rels/presentation.xml.rels'));
  const size = /<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(presentation);
  const order = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => rels.get(m[1]!)?.target).filter((t): t is string => Boolean(t));
  const units: Unit[] = [];
  order.forEach((target, i) => {
    const part = resolvePart('ppt/presentation.xml', target);
    const slide = read(part) ?? '';
    const slideRels = relsOf(read(part.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')));
    const notesTarget = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'))?.target;
    const notes = notesTarget ? drawingParagraphs(read(resolvePart(part, notesTarget)) ?? '') : [];
    const body = drawingParagraphs(slide);
    const text = [`## Slide ${String(i + 1)}`, ...body, ...(notes.length ? ['', `> Notes: ${notes.join(' ')}`] : [])].join('\n');
    units.push({ kind: 'slide', label: `Slide ${String(i + 1)}`, text, source: 'parsed' });
  });
  const cx = size ? Number(size[1]) : null;
  const cy = size ? Number(size[2]) : null;
  return {
    kind: 'pptx',
    markdown: units.map((u) => u.text).join('\n\n'),
    units,
    sidecar: {
      slides: units.length,
      slideSizeEmu: cx && cy ? { cx, cy } : null,
      aspect: cx && cy ? aspectName(cx, cy) : null,
    },
    warnings: [],
  };
}

function aspectName(cx: number, cy: number): string {
  const r = cx / cy;
  if (Math.abs(r - 16 / 9) < 0.01) return '16:9';
  if (Math.abs(r - 4 / 3) < 0.01) return '4:3';
  if (Math.abs(r - 16 / 10) < 0.01) return '16:10';
  return `${(r).toFixed(3)}:1`;
}

/* ------------------------------------------------------------------ DOCX */

/**
 * The document's Markdown (headings, tables) split into sections at its headings, plus its
 * comments and page size (an A4 page is 11906 × 16838 twips).
 */
export async function deriveDocx(data: Buffer, filename: string, mimeType: string): Promise<DerivedBody> {
  // officeparser opens its Markdown with YAML front matter (author, dates): document metadata,
  // not content, and the author is a person's name; it is left out.
  const markdown = (await extractText(data, mimeType, filename)).replace(/^---\n[\s\S]*?\n---\n+/, '');
  const files = unzipSync(data, { filter: (f) => f.name === 'word/document.xml' || f.name === 'word/comments.xml' });
  const doc = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
  const pg = /<w:pgSz\b[^>]*\bw:w="(\d+)"[^>]*\bw:h="(\d+)"/.exec(doc);
  const units: Unit[] = [];
  let current: Unit | null = null;
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading || !current) {
      // officeparser appends an anchor (`{#id}`) to a heading; the label is the heading's words.
      const label = heading ? heading[1]!.replace(/\s*\{#[^}]*\}\s*$/, '').trim().slice(0, 100) : 'Start';
      current = { kind: 'section', label, text: '', source: 'parsed' };
      units.push(current);
    }
    current.text += `${line}\n`;
  }
  for (const u of units) u.text = u.text.trim();
  const commentsXml = files['word/comments.xml'] ? strFromU8(files['word/comments.xml']) : '';
  const comments = [...commentsXml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)].map((m) => {
    const author = /\bw:author="([^"]*)"/.exec(m[1]!)?.[1] ?? '';
    const text = [...m[2]!.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => decodeXml(t[1]!)).join('');
    return { author: decodeXml(author), text };
  });
  let md = units.map((u) => u.text).filter(Boolean).join('\n\n');
  if (comments.length) {
    const block = `## Comments\n${comments.map((c) => `- ${c.author ? `${c.author}: ` : ''}${c.text}`).join('\n')}`;
    units.push({ kind: 'comments', label: 'Comments', text: block, source: 'parsed' });
    md += `\n\n${block}`;
  }
  return {
    kind: 'docx',
    markdown: md,
    units: units.filter((u) => u.text !== ''),
    sidecar: { pageSizeTwips: pg ? { w: Number(pg[1]), h: Number(pg[2]) } : null, comments: comments.length },
    warnings: [],
  };
}

/* ------------------------------------------------------------------ PDF extras + strip */

export interface PdfInspection {
  fields: Array<{ name: string; value: string }>;
  comments: Array<{ page: number; author: string; text: string }>;
  embeddedFiles: number;
  /** What was removed from the stored copy; empty when nothing was. */
  removed: string[];
  encrypted: boolean;
}

const ACTIVE = new Set(['JavaScript', 'Launch', 'ImportData', 'SubmitForm', 'ResetForm', 'Rendition', 'GoToR', 'GoToE']);

/**
 * Reads a PDF's form fields, comments and embedded-file count (Stage 9 G38 / G39), and removes
 * its active content (SCAN, best effort): the catalog's OpenAction when it is an action, every
 * additional-actions (`/AA`) entry, document-level JavaScript, and link / widget actions that run
 * script or launch, submit or import. When anything is removed the stripped copy is written to
 * `strippedPath`. An encrypted PDF is not rewritten: pdf-lib cannot save one faithfully.
 */
export async function inspectPdf(inputPath: string, strippedPath: string): Promise<PdfInspection> {
  const { PDFDocument, PDFDict, PDFName, PDFRef, PDFString, PDFHexString, PDFArray, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } =
    await import('pdf-lib');
  const doc = await PDFDocument.load(await readFile(inputPath), { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const text = (v: unknown) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '');

  const fields: PdfInspection['fields'] = [];
  try {
    for (const f of doc.getForm().getFields()) {
      let value = '';
      if (f instanceof PDFTextField) value = f.getText() ?? '';
      else if (f instanceof PDFCheckBox) value = f.isChecked() ? 'checked' : 'unchecked';
      else if (f instanceof PDFDropdown || f instanceof PDFOptionList) value = f.getSelected().join(', ');
      else if (f instanceof PDFRadioGroup) value = f.getSelected() ?? '';
      fields.push({ name: f.getName(), value });
    }
  } catch {
    // A malformed form leaves the fields unread; the pages still are.
  }

  const comments: PdfInspection['comments'] = [];
  doc.getPages().forEach((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    for (let j = 0; j < annots.size(); j++) {
      const a = annots.lookupMaybe(j, PDFDict);
      if (!a) continue;
      const sub = a.get(PDFName.of('Subtype'))?.toString();
      if (sub === '/Link' || sub === '/Widget' || sub === '/Popup') continue;
      const body = text(a.lookup(PDFName.of('Contents')));
      if (body.trim()) comments.push({ page: i + 1, author: text(a.lookup(PDFName.of('T'))), text: body.trim() });
    }
  });

  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const embeddedNames = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray);
  const embeddedFiles = embeddedNames ? Math.floor(embeddedNames.size() / 2) : embedded ? 1 : 0;

  const removed: string[] = [];
  const encrypted = doc.isEncrypted;
  if (!encrypted) {
    const isActive = (v: unknown): boolean => {
      const d = v instanceof PDFDict ? v : null;
      const s = d?.get(PDFName.of('S'))?.toString().slice(1);
      return Boolean(s && ACTIVE.has(s));
    };
    const open = doc.catalog.lookup(PDFName.of('OpenAction'));
    if (open instanceof PDFDict && isActive(open)) {
      doc.catalog.delete(PDFName.of('OpenAction'));
      removed.push('OpenAction');
    }
    if (names?.has(PDFName.of('JavaScript'))) {
      const tree = names.get(PDFName.of('JavaScript'));
      names.delete(PDFName.of('JavaScript'));
      if (tree instanceof PDFRef) doc.context.delete(tree);
      removed.push('JavaScript');
    }
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      if (obj.has(PDFName.of('AA'))) {
        obj.delete(PDFName.of('AA'));
        removed.push('AA');
      }
      if (isActive(obj.lookup(PDFName.of('A')))) {
        obj.delete(PDFName.of('A'));
        removed.push('A');
      }
    }
    if (doc.catalog.has(PDFName.of('AA'))) {
      doc.catalog.delete(PDFName.of('AA'));
      removed.push('AA');
    }
    // The action objects themselves go too: unreferenced they run nowhere, but a saved file
    // would still carry their script text for any lenient reader to find.
    if (removed.length) {
      for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
        if (obj instanceof PDFDict && (isActive(obj) || obj.has(PDFName.of('JS')))) doc.context.delete(ref);
      }
    }
    if (removed.length) await writeFile(strippedPath, await doc.save({ useObjectStreams: false }));
  }
  return { fields, comments, embeddedFiles, removed: [...new Set(removed)], encrypted };
}

/* ------------------------------------------------------------------ images */

export interface NormalisedImage {
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  /** The original's size, before rotation and resizing. */
  originalWidth: number;
  originalHeight: number;
}

/**
 * The copy every model is sent (Stage 9 IMAGES): rotated by its EXIF orientation, metadata
 * (EXIF, GPS, XMP, ICC) removed, long edge ≤ `maxEdge`, at most `maxBytes`; HEIC / HEIF decoded
 * first. PNG stays PNG when it has transparency; everything else becomes JPEG. The original is
 * kept as uploaded. `maxPixels` refuses a decompression-bomb image before decoding it whole.
 */
export async function normaliseImage(
  inputPath: string,
  mimeType: string,
  outPath: string,
  opts: { maxEdge: number; maxBytes: number; maxPixels: number },
): Promise<NormalisedImage> {
  const { default: sharp } = await import('sharp');
  let input: Parameters<typeof sharp>[0] = inputPath;
  let raw: { width: number; height: number; channels: 4 } | undefined;
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    const { default: decode } = await import('heic-decode');
    const img = await decode({ buffer: await readFile(inputPath) });
    if (img.width * img.height > opts.maxPixels) throw new Error('image too large');
    input = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    raw = { width: img.width, height: img.height, channels: 4 };
  }
  const base = () => sharp(input, { limitInputPixels: opts.maxPixels, ...(raw ? { raw } : {}), failOn: 'error' });
  const meta = await base().metadata();
  const alpha = Boolean(meta.hasAlpha) && mimeType === 'image/png';
  let edge = opts.maxEdge;
  for (let attempt = 0; attempt < 12; attempt++) {
    // `.rotate()` with no angle applies the EXIF orientation; sharp writes no metadata unless
    // asked (`withMetadata`), so EXIF and GPS do not survive.
    const pipeline = base().rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
    const quality = Math.max(50, 90 - attempt * 8);
    const out = alpha ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true }) : await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (out.data.length <= opts.maxBytes || attempt === 11) {
      await writeFile(outPath, out.data);
      return {
        mimeType: alpha ? 'image/png' : 'image/jpeg',
        width: out.info.width,
        height: out.info.height,
        bytes: out.data.length,
        originalWidth: meta.width ?? out.info.width,
        originalHeight: meta.height ?? out.info.height,
      };
    }
    if (alpha || quality <= 50) edge = Math.floor(edge * 0.8);
  }
  throw new Error('unreachable');
}
