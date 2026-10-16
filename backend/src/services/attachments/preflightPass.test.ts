/**
 * The ZIP pre-flight's streaming pass (ADR-0066, review findings M3 and N1): the central
 * directory is not trusted. Every member is inflated and counted with bounded memory, a member
 * that inflates past what it declared is refused, and every XML part is scanned through its
 * whole length for a DTD or entity, in UTF-8 and UTF-16. A file that fails the pass never
 * reaches a parser.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeflateRaw } from 'node:zlib';

import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawned = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  return {
    ...real,
    spawn: ((...args: Parameters<typeof real.spawn>) => {
      spawned.count += 1;
      return real.spawn(...args);
    }) as typeof real.spawn,
  };
});

import { docxWith, lyingZip } from '../../test/fixtures/archives.js';
import { FileFailure } from './fileErrors.js';
import { isolatedText, type IsolationLimits } from './isolatedExtract.js';
import { MarkupScanner, PASS_READ_BYTES, preflightContainer, scannerFor } from './preflight.js';
import { bufferSource } from './zipReader.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/ops/build-2-fixtures');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const limits: IsolationLimits = { heapMb: 256, timeoutMs: 60_000, concurrency: 2, maxRatio: 100 };
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** `bytes` of zeros, raw-deflated as a stream: the body of a bomb, without holding the bomb. */
async function deflatedZeros(bytes: number): Promise<Buffer> {
  const out: Buffer[] = [];
  const z = createDeflateRaw({ level: 9 });
  z.on('data', (c: Buffer) => out.push(c));
  const done = new Promise<void>((resolve, reject) => {
    z.on('end', resolve);
    z.on('error', reject);
  });
  const block = Buffer.alloc(1024 * 1024);
  for (let left = bytes; left > 0; left -= block.length) {
    if (!z.write(left >= block.length ? block : block.subarray(0, left))) await new Promise((r) => z.once('drain', r));
  }
  z.end();
  await done;
  return Buffer.concat(out);
}

const documentXml = (body: string, prolog = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'): string =>
  `${prolog}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`;

function docxWithParts(parts: Record<string, Uint8Array>): Buffer {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': enc('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      '_rels/.rels': enc('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
      ...parts,
    }),
  );
}

beforeEach(() => {
  spawned.count = 0;
});

describe('the streaming pass does not trust the central directory (M3)', () => {
  it('refuses a member that declares 1 KB and really inflates to 200 MB of zeros, with bounded memory', async () => {
    const body = await deflatedZeros(200 * 1024 * 1024);
    // Small enough that the directory alone looks like a normal document: 1 KB, ratio < 100.
    const bomb = lyingZip([
      { name: '[Content_Types].xml', data: enc('<Types/>') },
      { name: 'word/document.xml', data: enc(documentXml('hi')) },
      { name: 'word/media/image1.bin', data: new Uint8Array(0), compressed: body, declaredSize: 1024 },
    ]);
    let largest = 0;
    let total = 0;
    const before = process.memoryUsage();
    const started = Date.now();
    const err = await preflightContainer(bufferSource(bomb), 'bomb.docx', {
      maxRatio: 100,
      onInflated: (n) => {
        largest = Math.max(largest, n);
        total += n;
      },
    }).catch((e: unknown) => e);
    const after = process.memoryUsage();
    expect(err).toBeInstanceOf(FileFailure);
    expect((err as FileFailure).code).toBe('zip_ratio');
    // Stopped at the declared size: nothing past 1 KB of the member was handed on...
    expect(total).toBeLessThanOrEqual(1024 + enc('<Types/>').length + enc(documentXml('hi')).length);
    // ...and one step can only inflate what PASS_READ_BYTES of input inflates to (deflate ≤ ~1,032:1).
    expect(largest).toBeLessThanOrEqual(PASS_READ_BYTES * 1100);
    expect(after.arrayBuffers - before.arrayBuffers).toBeLessThan(32 * 1024 * 1024);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a parser never runs on a document that failed the pass', async () => {
    const body = await deflatedZeros(20 * 1024 * 1024);
    const bomb = lyingZip([
      { name: '[Content_Types].xml', data: enc('<Types/>') },
      { name: 'word/document.xml', data: enc(documentXml('hi')) },
      { name: 'word/media/image1.bin', data: new Uint8Array(0), compressed: body, declaredSize: 1024 },
    ]);
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-pass-test-'));
    try {
      const p = path.join(dir, 'bomb.docx');
      await writeFile(p, bomb);
      await expect(isolatedText(p, 'bomb.docx', DOCX, limits)).rejects.toMatchObject({ code: 'zip_ratio' });
      expect(spawned.count).toBe(0);
      // Control: a sound document does reach the child.
      const ok = path.join(dir, 'ok.docx');
      await writeFile(ok, docxWith('sound'));
      expect(await isolatedText(ok, 'ok.docx', DOCX, limits)).toContain('sound');
      expect(spawned.count).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stops at the total cap (N-10) on real bytes, whatever each member declares', async () => {
    const docx = docxWithParts({ 'word/document.xml': enc(documentXml('x'.repeat(50_000))) });
    await expect(preflightContainer(bufferSource(docx), 'big.docx', { maxRatio: 100, maxTotalBytes: 10_000 })).rejects.toMatchObject({ code: 'zip_ratio' });
    await expect(preflightContainer(bufferSource(docx), 'big.docx', { maxRatio: 100 })).resolves.toBeUndefined();
  });

  it('has a wall clock: a pass past its deadline is `timeout`', async () => {
    let t = 0;
    const docx = docxWithParts({ 'word/document.xml': enc(documentXml('slow')) });
    await expect(
      preflightContainer(bufferSource(docx), 'slow.docx', { maxRatio: 100, deadlineMs: 5, now: () => (t += 10) }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('every XML part is scanned through its whole length (N1)', () => {
  it('refuses a DOCX whose document.xml has a 10 KB comment before <!DOCTYPE', async () => {
    const padded = `<?xml version="1.0"?><!--${'p'.repeat(10 * 1024)}--><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>`;
    const docx = docxWith('hello', padded);
    await expect(preflightContainer(bufferSource(docx), 'padded.docx', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('finds an entity declared deep in a UTF-16 part', async () => {
    const xml = Buffer.from(`﻿<?xml version="1.0" encoding="UTF-16"?><!--${'q'.repeat(50_000)}--><!ENTITY y "boom">${documentXml('x', '')}`, 'utf16le');
    const docx = docxWithParts({ 'word/document.xml': xml });
    await expect(preflightContainer(bufferSource(docx), 'u16.docx', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('finds a marker split across two inflate chunks', () => {
    const scanner = new MarkupScanner();
    expect(scanner.push(enc('<root><!DOC'))).toBe(false);
    expect(scanner.push(enc('TYPE x>'))).toBe(true);
    const u16 = new MarkupScanner();
    const bytes = Buffer.from('aaa<!ENTITY z "1">', 'utf16le');
    expect(u16.push(bytes.subarray(0, 9))).toBe(false); // splits a UTF-16 code unit
    expect(u16.push(bytes.subarray(9))).toBe(true);
  });

  it('accepts a long document with no DTD, scanned to its end', async () => {
    const docx = docxWithParts({ 'word/document.xml': enc(documentXml('word '.repeat(200_000))) });
    await expect(preflightContainer(bufferSource(docx), 'long.docx', { maxRatio: 100 })).resolves.toBeUndefined();
  });
});

describe('real documents still pass', () => {
  it.each(['04-tamil-a4.docx', '05-deck-16x9.pptx', '06-budget-lakh.xlsx'])('%s', async (name) => {
    const data = await readFile(path.join(FIXTURES, name));
    await expect(preflightContainer(bufferSource(data), name, { maxRatio: 100 })).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------------ review round 1 */

describe('a ZIP under a non-ZIP name is still pre-flighted (review R3#1)', () => {
  const XLS = 'application/vnd.ms-excel';
  async function onDisk(name: string, data: Buffer): Promise<{ p: string; done: () => Promise<void> }> {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-xls-test-'));
    const p = path.join(dir, name);
    await writeFile(p, data);
    return { p, done: () => rm(dir, { recursive: true, force: true }) };
  }

  it('refuses the lying-ZIP bomb named budget.xls before any parser runs', async () => {
    const body = await deflatedZeros(200 * 1024 * 1024);
    const bomb = lyingZip([
      { name: '[Content_Types].xml', data: enc('<Types/>') },
      { name: 'xl/workbook.xml', data: enc('<workbook/>') },
      { name: 'xl/media/blob.bin', data: new Uint8Array(0), compressed: body, declaredSize: 1024 },
    ]);
    const f = await onDisk('budget.xls', bomb);
    try {
      await expect(isolatedText(f.p, 'budget.xls', XLS, limits)).rejects.toMatchObject({ code: 'zip_ratio' });
      expect(spawned.count).toBe(0);
    } finally {
      await f.done();
    }
  });

  it('refuses a workbook with a DOCTYPE named budget.xls before any parser runs', async () => {
    const wb = Buffer.from(
      zipSync({
        '[Content_Types].xml': enc('<Types/>'),
        'xl/workbook.xml': enc('<?xml version="1.0"?><!DOCTYPE w [<!ENTITY a "aaaa">]><workbook>&a;</workbook>'),
      }),
    );
    const f = await onDisk('budget.xls', wb);
    try {
      await expect(isolatedText(f.p, 'budget.xls', XLS, limits)).rejects.toMatchObject({ code: 'corrupt' });
      expect(spawned.count).toBe(0);
    } finally {
      await f.done();
    }
  });
});

describe('EPUB parts are scanned too (review R3#2)', () => {
  const epub = (opf: string, xhtml: string): Buffer =>
    Buffer.from(
      zipSync({
        mimetype: [enc('application/epub+zip'), { level: 0 }],
        'META-INF/container.xml': enc('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
        'OEBPS/content.opf': enc(opf),
        'OEBPS/toc.ncx': enc('<?xml version="1.0"?><ncx/>'),
        'OEBPS/ch1.xhtml': enc(xhtml),
      }),
    );
  const OPF = '<package version="3.0"><metadata/><manifest/><spine/></package>';
  const XHTML = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter one</p></body></html>';

  it('refuses an EPUB whose content.opf has a DOCTYPE with an internal subset', async () => {
    const bad = epub(`<?xml version="1.0"?><!DOCTYPE package [<!ENTITY x "xxxxxxxxxx">]>${OPF}`, XHTML);
    await expect(preflightContainer(bufferSource(bad), 'book.epub', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('refuses an xhtml chapter whose DOCTYPE carries an internal subset, or that declares an entity', async () => {
    const subset = epub(`<?xml version="1.0"?>${OPF}`, XHTML.replace('<!DOCTYPE html>', '<!DOCTYPE html [<!ENTITY lol "lol">]>'));
    await expect(preflightContainer(bufferSource(subset), 'book.epub', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
    const scanner = new MarkupScanner('epub');
    expect(scanner.push(enc('<p>text</p><!ENTITY y "1">'))).toBe(true);
  });

  it('accepts a normal EPUB (xhtml with <!DOCTYPE html>, and the EPUB 2 PUBLIC form)', async () => {
    await expect(preflightContainer(bufferSource(epub(`<?xml version="1.0"?>${OPF}`, XHTML)), 'book.epub', { maxRatio: 100 })).resolves.toBeUndefined();
    const epub2 = XHTML.replace('<!DOCTYPE html>', '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">');
    await expect(preflightContainer(bufferSource(epub(`<?xml version="1.0"?>${OPF}`, epub2)), 'book.epub', { maxRatio: 100 })).resolves.toBeUndefined();
  });

  it('an html-mode DOCTYPE split across chunks is judged once its end arrives', () => {
    const ok = new MarkupScanner('epub');
    expect(ok.push(enc('<?xml?><!DOCTY'))).toBe(false);
    expect(ok.push(enc('PE html'))).toBe(false);
    expect(ok.push(enc('><html/>'))).toBe(false);
    expect(ok.finish()).toBe(false);
    const bad = new MarkupScanner('epub');
    expect(bad.push(enc('<!DOCTYPE html'))).toBe(false);
    expect(bad.push(enc(' [ <x> ]>'))).toBe(true);
    const open = new MarkupScanner('epub');
    expect(open.push(enc('<!DOCTYPE html'))).toBe(false);
    expect(open.finish()).toBe(true);
  });
});

/* ------------------------------------------------------------------ fix round (ADR-0070) */

/**
 * F14 (ADR-0070, superseding ADR-0066 §8): the scan follows what the installed EPUB reader
 * parses, not every member. Round 2 scanned every EPUB member, which refused an ordinary EPUB
 * with an Illustrator SVG (whose DOCTYPE carries an internal subset), though nothing parses it.
 */
describe('EPUB members: exactly what the reader parses is scanned (ADR-0070, F14)', () => {
  const CONTAINER = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>';
  const OPF = '<?xml version="1.0"?><package version="2.0"><metadata/><manifest/><spine toc="ncx"/></package>';
  const XHTML = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter</p></body></html>';
  /** The NCX header EPUB 2 tools write (NISO DTD, external identifier, no internal subset). */
  const NCX =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">\n' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Book</text></docTitle><navMap/></ncx>';
  /** The header Adobe Illustrator's SVG 1.1 export writes: a PUBLIC DOCTYPE with an internal subset of entities. */
  const ILLUSTRATOR_SVG =
    '<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator: Adobe Illustrator 16.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
    '\t<!ENTITY ns_svg "http://www.w3.org/2000/svg">\n\t<!ENTITY ns_xlink "http://www.w3.org/1999/xlink">\n]>\n' +
    '<svg version="1.1" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" width="10" height="10"><rect width="10" height="10"/></svg>';
  const ENTITY_CHAPTER = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><x>&b;</x>';
  const book = (members: Record<string, Uint8Array>, base: Record<string, string> = {}): Buffer =>
    Buffer.from(
      zipSync({
        mimetype: [enc('application/epub+zip'), { level: 0 }],
        'META-INF/container.xml': enc(base['container'] ?? CONTAINER),
        'OEBPS/content.opf': enc(base['opf'] ?? OPF),
        'OEBPS/ch1.xhtml': enc(base['xhtml'] ?? XHTML),
        ...members,
      }),
    );
  const check = (epub: Buffer, name = 'book.epub') => preflightContainer(bufferSource(epub), name, { maxRatio: 100 });

  it('accepts an EPUB with an Illustrator-style SVG (DOCTYPE with an entity subset): the reader never parses .svg', async () => {
    await expect(check(book({ 'OEBPS/images/logo.svg': enc(ILLUSTRATOR_SVG) }))).resolves.toBeUndefined();
  });

  it('accepts an EPUB 2 toc.ncx with its NISO DOCTYPE, and the same DOCTYPE in a chapter (lenient rule)', async () => {
    await expect(check(book({ 'OEBPS/toc.ncx': enc(NCX) }))).resolves.toBeUndefined();
    const s = new MarkupScanner('epub');
    expect(s.push(enc(NCX))).toBe(false);
    expect(s.finish()).toBe(false);
  });

  it('refuses a DOCTYPE with a subset or an ENTITY in the .opf, in an .xhtml chapter and in container.xml', async () => {
    const opf = OPF.replace('<package', '<!DOCTYPE package [<!ENTITY t "x">]><package');
    await expect(check(book({}, { opf }))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(check(book({}, { xhtml: ENTITY_CHAPTER }))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(check(book({ 'OEBPS/ch2.html': enc(ENTITY_CHAPTER) }))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(check(book({ 'OEBPS/ch3.htm': enc(ENTITY_CHAPTER) }))).rejects.toMatchObject({ code: 'corrupt' });
    // container.xml is strict (an .xml): even a DOCTYPE without a subset is refused.
    const container = CONTAINER.replace('<container>', '<!DOCTYPE container SYSTEM "c.dtd"><container>');
    await expect(check(book({}, { container }))).rejects.toMatchObject({ code: 'corrupt' });
    // The same members are scanned under any upload name: the rule follows the member.
    await expect(check(book({}, { xhtml: ENTITY_CHAPTER }), 'book.zip')).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('does not scan members the reader never parses (.ncx, .xht, no extension, .svg, .css) — changed from round 2 on purpose', async () => {
    // Round 2 refused these ("refuses an entity-laden chapter named ch1.xht / with no extension",
    // "refuses the same NCX with an internal subset"): officeparser 8's EPUB reader opens only
    // container.xml, *.opf and *.xhtml/html/htm, so they guarded a path that does not exist and
    // cost real books (F14). The pin test below fails if the reader starts reading more.
    const ncx = NCX.replace('ncx-2005-1.dtd">', 'ncx-2005-1.dtd" [<!ENTITY t "x">]>');
    const epub = book({
      'OEBPS/toc.ncx': enc(ncx),
      'OEBPS/ch9.xht': enc(ENTITY_CHAPTER),
      'OEBPS/chapter1': enc(ENTITY_CHAPTER),
      'OEBPS/style.css': enc('/* <!ENTITY x "y"> */ body { font-family: serif; }'),
    });
    await expect(check(epub)).resolves.toBeUndefined();
  });

  it('accepts a normal EPUB with images, a font and a stylesheet', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<!ENTITY looks-like-markup>')]);
    const epub = book({
      'OEBPS/toc.ncx': enc(NCX),
      'OEBPS/images/cover.png': png,
      'OEBPS/images/photo.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
      'OEBPS/fonts/body.otf': new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 1]),
      'OEBPS/style.css': enc('body { font-family: serif; }'),
    });
    await expect(check(epub)).resolves.toBeUndefined();
  });

  it.each(['OEBPS/extra.xml', 'META-INF/encryption.xml', 'OEBPS/_rels/x.rels', 'OEBPS/drawing.vml'])(
    'keeps %s strict inside an EPUB (an Office reader may open the same bytes)',
    async (name) => {
      const epub = book({ [name]: enc('<?xml version="1.0"?><!DOCTYPE extra SYSTEM "extra.dtd"><extra/>') });
      await expect(check(epub)).rejects.toMatchObject({ code: 'corrupt' });
      await expect(check(book({ [name]: enc('<?xml version="1.0"?><extra/>') }))).resolves.toBeUndefined();
    },
  );

  it("pins the installed EPUB reader's read set: the scan covers every member it parses", async () => {
    const { createRequire } = await import('node:module');
    const main = createRequire(import.meta.url).resolve('officeparser');
    const source = await readFile(path.join(path.dirname(main), 'parsers', 'EpubParser.js'), 'utf8');
    // The predicate officeparser 8.0.0 passes to extractFiles. If this changes, re-derive
    // EPUB_READ_PART / XML_PART in preflight.ts from the new predicate and update ADR-0070.
    const m = /extractFiles\)\(buffer, \(path\) => ([\s\S]*?), config\.decompressionLimits/.exec(source);
    expect(m, 'EpubParser.js no longer has the extractFiles predicate this pin reads').not.toBeNull();
    const predicate = m![1]!.replace(/\s+/g, ' ');
    expect(predicate).toBe(
      '/META-INF\\/container\\.xml$/i.test(path) || /\\.opf$/i.test(path) || /\\.(xhtml|html|htm)$/i.test(path) || (!!config.extractAttachments && /\\.(png|jpe?g|gif|svg|webp)$/i.test(path))',
    );
    // We never ask the reader for attachments, so it parses no image (and no SVG).
    const retrieval = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../retrieval.ts'), 'utf8');
    expect(retrieval).not.toMatch(/extractAttachments/);
    expect(retrieval).toMatch(/parseOffice\(data, \{ ocr: false, fileType \}\)/);
    // The predicate itself, run on a book's names: whatever it reads, the pre-flight scans.
    const reads = new Function('path', 'config', `return ${m![1]!};`) as (p: string, c: { extractAttachments: boolean }) => boolean;
    const names = [
      'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/Text/ch1.xhtml', 'OEBPS/ch2.HTML', 'ch3.htm', 'nested/META-INF/container.xml',
      'OEBPS/toc.ncx', 'OEBPS/ch.xht', 'OEBPS/chapter', 'OEBPS/img/logo.svg', 'OEBPS/img/a.png', 'mimetype', 'META-INF/encryption.xml',
    ];
    for (const name of names) {
      if (reads(name, { extractAttachments: false })) expect(scannerFor(name), name).not.toBeNull();
    }
    expect(names.filter((n) => reads(n, { extractAttachments: false }))).toEqual(names.slice(0, 6));
  });
});

/** Elapsed wall time of `fn`, in ms. */
function timed<T>(fn: () => T): { value: T; ms: number } {
  const t = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t };
}

async function timedAsync<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t };
}

/** Pushes `bytes` through `scanner` in `size`-byte chunks; the first refusal, or finish(). */
function scanAll(scanner: MarkupScanner, bytes: Uint8Array, size = 64 * 1024): boolean {
  for (let i = 0; i < bytes.length; i += size) if (scanner.push(bytes.subarray(i, i + size))) return true;
  return scanner.finish();
}

const EIGHT_MB = 8 * 1024 * 1024;
/** `unit` repeated to about `bytes`. */
const fill = (unit: string, bytes = EIGHT_MB): string => unit.repeat(Math.ceil(bytes / unit.length));

/**
 * F13: the scanner is linear. The previous one re-scanned from each DOCTYPE it had judged:
 * 1 MB of `<!DOCTYPE a ` took 1 s, 2 MB 7 s (explain.3). Each case is 8 MB and must finish in
 * well under 2 s; the times are logged for the fix-round record.
 */
describe('the DTD scan is linear on hostile input (ADR-0070, F13)', () => {
  const cases: Array<{ name: string; text: string; xml: boolean; epub: boolean }> = [
    { name: '8 MB comment padding', text: `<?xml version="1.0"?><!--${fill('p')}--><root/>`, xml: false, epub: false },
    { name: '<!DOCTYPE a  repeated, closed at the end', text: `${fill('<!DOCTYPE a ')}>`, xml: true, epub: true },
    // The explain.3 measurement (1 MB: 1 s, 2 MB: 7 s, not refused), as 2 MB runs each closed by
    // a `>`: one inflate step of the pass reaches ~2 MB here, so it holds a whole run.
    { name: '2 MB runs of <!DOCTYPE a , each closed', text: fill(`${'<!DOCTYPE a '.repeat(170_000)}>`), xml: true, epub: true },
    { name: '<!DOCTYPE a> repeated (each one allowed in epub mode)', text: fill('<!DOCTYPE a>'), xml: true, epub: false },
    { name: '<! repeated', text: fill('<!'), xml: false, epub: false },
    { name: '< repeated', text: fill('<'), xml: false, epub: false },
    { name: '<!DOCTYP repeated (a marker that never completes)', text: fill('<!DOCTYP'), xml: false, epub: false },
    { name: 'one DOCTYPE never closed', text: `<!DOCTYPE a ${fill('x')}`, xml: true, epub: true },
    { name: 'one DOCTYPE in a quoted literal that never ends', text: `<!DOCTYPE a PUBLIC "${fill('x')}`, xml: true, epub: true },
  ];

  it.each(cases)('scanner: $name, in one push and in 64 KB chunks', ({ name, text, xml, epub }) => {
    const bytes = enc(text);
    for (const size of [bytes.length, 64 * 1024]) {
      const a = timed(() => scanAll(new MarkupScanner('xml'), bytes, size));
      const b = timed(() => scanAll(new MarkupScanner('epub'), bytes, size));
      console.log(`[F13 timing] scanner ${name} (chunk ${size}): xml ${a.ms.toFixed(0)} ms, epub ${b.ms.toFixed(0)} ms (${bytes.length} bytes)`);
      expect(a.value).toBe(xml);
      expect(b.value).toBe(epub);
      expect(a.ms).toBeLessThan(2000);
      expect(b.ms).toBeLessThan(2000);
    }
  });

  it.each(cases)('preflightContainer: $name, as a chapter and as document.xml', async ({ name, text, xml, epub }) => {
    const data = enc(text);
    // A ratio limit this high lets the member through to the scan: the case is the scan's cost.
    const run = async (only: string) => {
      // Level 9: each 4 KB read of the pass inflates to as much as deflate allows (~4 MB here).
      const zip = Buffer.from(zipSync({ [only]: data }, { level: 9 }));
      return timedAsync(() =>
        preflightContainer(bufferSource(zip), 'book.epub', { maxRatio: 1e9 }).then(
          () => false,
          (e: unknown) => {
            if (e instanceof FileFailure && e.code === 'corrupt') return true;
            throw e;
          },
        ),
      );
    };
    const a = await run('word/document.xml');
    const b = await run('OEBPS/ch1.xhtml');
    console.log(`[F13 timing] preflightContainer ${name}: .xml ${a.ms.toFixed(0)} ms, .xhtml ${b.ms.toFixed(0)} ms (${data.length} bytes)`);
    expect(a.value).toBe(xml);
    expect(b.value).toBe(epub);
    expect(a.ms).toBeLessThan(2000);
    expect(b.ms).toBeLessThan(2000);
  });

  it('a 5,000-char DOCTYPE that does close is refused (the length limit holds either way)', () => {
    const s = new MarkupScanner('epub');
    expect(scanAll(s, enc(`<!DOCTYPE html PUBLIC "${'x'.repeat(5000)}"><html/>`))).toBe(true);
    // Control: a long but legitimate public id under the limit passes.
    expect(scanAll(new MarkupScanner('epub'), enc(`<!DOCTYPE html PUBLIC "${'x'.repeat(3000)}"><html/>`))).toBe(false);
  });
});

/**
 * F13/F20: a real DTD after 10 KB of comments is still refused, in UTF-8 and UTF-16 (both byte
 * orders), with the marker split at every byte; legitimate DOCTYPEs pass split the same way.
 */
describe('refusals survive every chunk split and encoding (ADR-0070, F13, F20)', () => {
  const pad = `<?xml version="1.0"?><!--${'c'.repeat(10 * 1024)}-->`;
  const encodings: Array<[string, (s: string) => Uint8Array]> = [
    ['utf-8', enc],
    ['utf-16le', (s) => Buffer.from(s, 'utf16le')],
    ['utf-16be', (s) => Buffer.from(s, 'utf16le').swap16()],
  ];
  /** Every split point of `bytes` within `around` bytes of `from`, plus one-byte chunks. */
  function everySplit(mode: 'xml' | 'epub', bytes: Uint8Array, from: number, around: number): boolean[] {
    const out: boolean[] = [];
    for (let at = Math.max(0, from - 4); at <= Math.min(bytes.length, from + around); at++) {
      const s = new MarkupScanner(mode);
      out.push(s.push(bytes.subarray(0, at)) || s.push(bytes.subarray(at)) || s.finish());
    }
    const one = new MarkupScanner(mode);
    let refused = false;
    for (let i = 0; i < bytes.length && !refused; i++) refused = one.push(bytes.subarray(i, i + 1));
    out.push(refused || one.finish());
    return out;
  }

  const refused = [
    '<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>',
    '<!DOCTYPE html [ <!ATTLIST html a CDATA "b"> ]><html/>',
    '<p>text</p><!ENTITY y "1">',
    '<!DOCTYPE html PUBLIC "a>b" [ ]><html/>',
    '<!DOCTYPE html SYSTEM "x" <!-- no --> ><html/>',
  ];
  const allowed = [
    '<!DOCTYPE html><html/>',
    '<!doctype html>\n<html/>',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html/>',
    "<!DOCTYPE ncx PUBLIC '-//NISO//DTD ncx 2005-1//EN' 'http://www.daisy.org/z3986/2005/ncx-2005-1.dtd'><ncx/>",
  ];

  for (const [label, encode] of encodings) {
    it(`${label}: refused markup after 10 KB of comments, split anywhere, in both modes`, () => {
      for (const tail of refused) {
        const bytes = encode(pad + tail);
        const from = encode(pad).length;
        expect(everySplit('epub', bytes, from, 40).every(Boolean), `epub ${tail}`).toBe(true);
        expect(everySplit('xml', bytes, from, 40).every(Boolean), `xml ${tail}`).toBe(true);
      }
    });

    it(`${label}: an allowed DOCTYPE after 10 KB of comments passes in epub mode, split anywhere; xml mode refuses it`, () => {
      for (const tail of allowed) {
        const bytes = encode(pad + tail);
        const from = encode(pad).length;
        expect(everySplit('epub', bytes, from, bytes.length).some(Boolean), `epub ${tail}`).toBe(false);
        expect(everySplit('xml', bytes, from, 40).every(Boolean), `xml ${tail}`).toBe(true);
      }
    });
  }

  it('preflightContainer: an ENTITY after 10 KB of comments in a UTF-16 chapter is refused', async () => {
    const xhtml = Buffer.from(`﻿${pad}<!DOCTYPE html><html><body><p>x</p></body></html><!ENTITY late "x">`, 'utf16le');
    const epub = Buffer.from(zipSync({ mimetype: enc('application/epub+zip'), 'OEBPS/ch1.xhtml': xhtml }));
    await expect(preflightContainer(bufferSource(epub), 'book.epub', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });
});

/**
 * F18 (ADR-0070): the lenient rule lets a DOCTYPE with an external identifier through, which is
 * safe only while the EPUB reader never fetches it. This pins that: a book whose package and
 * chapter point their DTD at a local server is read, and the server sees no request.
 */
describe('an allowed external DTD is never fetched (ADR-0070, F18)', () => {
  it('the isolated EPUB reader makes no request for a SYSTEM DTD in the .opf or a chapter', async () => {
    const http = await import('node:http');
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.end('<!ENTITY x "fetched">');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const dtd = `http://127.0.0.1:${String((server.address() as { port: number }).port)}/book.dtd`;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-dtd-test-'));
    try {
      const epub = Buffer.from(
        zipSync({
          mimetype: [enc('application/epub+zip'), { level: 0 }],
          'META-INF/container.xml': enc('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
          'OEBPS/content.opf': enc(
            `<?xml version="1.0"?><!DOCTYPE package SYSTEM "${dtd}"><package version="2.0"><metadata/>` +
              '<manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
          ),
          'OEBPS/ch1.xhtml': enc(
            `<?xml version="1.0"?><!DOCTYPE html SYSTEM "${dtd}"><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter text here</p></body></html>`,
          ),
        }),
      );
      await expect(preflightContainer(bufferSource(epub), 'book.epub', { maxRatio: 100 })).resolves.toBeUndefined();
      const p = path.join(dir, 'book.epub');
      await writeFile(p, epub);
      expect(await isolatedText(p, 'book.epub', 'application/epub+zip', limits)).toContain('Chapter text here');
      expect(hits).toBe(0);
      // Control: the server does count a request.
      await new Promise<void>((r) => http.get(dtd, (res) => res.resume().on('end', () => r())));
      expect(hits).toBe(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
