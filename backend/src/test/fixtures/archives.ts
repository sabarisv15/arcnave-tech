/**
 * Archives for the file-pipeline tests, built byte by byte where a real tool would refuse to
 * write the case (a declared size that lies, a symlink entry, an encrypted flag, a `..` path).
 */
import { deflateRawSync } from 'node:zlib';

import { zipSync } from 'fflate';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface RawEntry {
  name: string;
  data: Uint8Array;
  /** 0 stored (default), 8 deflate. */
  method?: 0 | 8;
  /** What the central directory claims the member inflates to; the real size when absent. */
  declaredSize?: number;
  /** General-purpose flags; bit 0 marks the member encrypted. */
  flags?: number;
  /** A Unix mode (e.g. 0o120777 for a symlink); written with "made by Unix". */
  unixMode?: number;
  /**
   * The member's raw-deflate body, already compressed (method 8): for a member whose real size
   * is too large to hold in a test (a bomb). `data` then only feeds the CRC.
   */
  compressed?: Uint8Array;
}

/** A ZIP whose central directory says exactly what each entry asks it to, true or not. */
export function lyingZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.compressed ? 8 : (e.method ?? 0);
    const body = e.compressed ? Buffer.from(e.compressed) : method === 8 ? deflateRawSync(e.data) : Buffer.from(e.data);
    const name = Buffer.from(e.name, 'utf8');
    const size = e.declaredSize ?? e.data.length;
    const crc = crc32(e.data);
    const flags = (e.flags ?? 0) | 0x800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.unixMode !== undefined ? (3 << 8) | 20 : 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.unixMode !== undefined ? (e.unixMode << 16) >>> 0 : 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A minimal Word document whose body is `text`; `prolog` replaces document.xml's declaration. */
export function docxWith(text: string, prolog = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'): Buffer {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': enc(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': enc(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': enc(
        `${prolog}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`,
      ),
    }),
  );
}

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * The shape of a password-protected OOXML file: an OLE2 compound file whose directory names an
 * `EncryptedPackage` stream (MS-OFFCRYPTO). Only the parts the sniff reads are real; no Office
 * application would open it, which is the point — it must be refused before anything tries.
 */
export function encryptedOoxml(): Buffer {
  const header = Buffer.alloc(512);
  OLE2_MAGIC.copy(header, 0);
  const dirEntry = Buffer.alloc(128);
  Buffer.from('EncryptedPackage', 'utf16le').copy(dirEntry, 0);
  dirEntry.writeUInt16LE(('EncryptedPackage'.length + 1) * 2, 64);
  const info = Buffer.alloc(128);
  Buffer.from('EncryptionInfo', 'utf16le').copy(info, 0);
  return Buffer.concat([header, dirEntry, info, Buffer.alloc(1024)]);
}

/** A legacy binary Office file (OLE2 without an encrypted package), e.g. a real `.xls`. */
export function legacyOle2(): Buffer {
  const header = Buffer.alloc(512);
  OLE2_MAGIC.copy(header, 0);
  const dirEntry = Buffer.alloc(128);
  Buffer.from('Workbook', 'utf16le').copy(dirEntry, 0);
  return Buffer.concat([header, dirEntry, Buffer.alloc(1024)]);
}
