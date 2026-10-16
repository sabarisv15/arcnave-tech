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
import { MarkupScanner, PASS_READ_BYTES, preflightContainer } from './preflight.js';
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

describe('EPUB members: one lenient rule, every member scanned (review r2)', () => {
  const CONTAINER = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>';
  const OPF = '<?xml version="1.0"?><package version="2.0"><metadata/><manifest/><spine toc="ncx"/></package>';
  const XHTML = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter</p></body></html>';
  /** The NCX header EPUB 2 tools write (NISO DTD, external identifier, no internal subset). */
  const NCX =
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">\n' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Book</text></docTitle><navMap/></ncx>';
  const ENTITY_CHAPTER = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><x>&b;</x>';
  const book = (members: Record<string, Uint8Array>): Buffer =>
    Buffer.from(
      zipSync({
        mimetype: [enc('application/epub+zip'), { level: 0 }],
        'META-INF/container.xml': enc(CONTAINER),
        'OEBPS/content.opf': enc(OPF),
        ...members,
      }),
    );

  it('accepts an EPUB 2 toc.ncx with its NISO DOCTYPE', async () => {
    const epub = book({ 'OEBPS/toc.ncx': enc(NCX), 'OEBPS/ch1.xhtml': enc(XHTML) });
    await expect(preflightContainer(bufferSource(epub), 'book.epub', { maxRatio: 100 })).resolves.toBeUndefined();
  });

  it('refuses the same NCX with an internal subset', async () => {
    const ncx = NCX.replace('ncx-2005-1.dtd">', 'ncx-2005-1.dtd" [<!ENTITY t "x">]>');
    const epub = book({ 'OEBPS/toc.ncx': enc(ncx), 'OEBPS/ch1.xhtml': enc(XHTML) });
    await expect(preflightContainer(bufferSource(epub), 'book.epub', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('refuses an entity-laden chapter named ch1.xht', async () => {
    const epub = book({ 'OEBPS/toc.ncx': enc(NCX), 'OEBPS/ch1.xht': enc(ENTITY_CHAPTER) });
    await expect(preflightContainer(bufferSource(epub), 'book.epub', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('refuses an entity-laden chapter with no extension', async () => {
    const epub = book({ 'OEBPS/toc.ncx': enc(NCX), 'OEBPS/chapter1': enc(ENTITY_CHAPTER) });
    await expect(preflightContainer(bufferSource(epub), 'book.epub', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
    // Read as an EPUB by its layout too, whatever the upload is named.
    await expect(preflightContainer(bufferSource(epub), 'book.zip', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('accepts a normal EPUB with images, a font and a stylesheet', async () => {
    // Binary media can hold any bytes, including the markup text: it is not scanned.
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<!ENTITY looks-like-markup>')]);
    const epub = book({
      'OEBPS/toc.ncx': enc(NCX),
      'OEBPS/ch1.xhtml': enc(XHTML),
      'OEBPS/images/cover.png': png,
      'OEBPS/images/photo.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
      'OEBPS/fonts/body.otf': new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 1]),
      'OEBPS/style.css': enc('body { font-family: serif; }'),
    });
    await expect(preflightContainer(bufferSource(epub), 'book.epub', { maxRatio: 100 })).resolves.toBeUndefined();
  });

  it('keeps .xml/.rels/.vml strict inside an EPUB', async () => {
    const epub = book({ 'OEBPS/extra.xml': enc('<?xml version="1.0"?><!DOCTYPE extra SYSTEM "extra.dtd"><extra/>') });
    await expect(preflightContainer(bufferSource(epub), 'book.epub', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });
});
