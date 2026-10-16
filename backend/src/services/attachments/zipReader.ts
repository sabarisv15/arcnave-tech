/**
 * Reading a ZIP container without trusting it (Stage 9 ZIP, UD-2, Stage 16 FL-2; D1 #1, #7).
 *
 * The central directory is read first, without inflating anything: it declares every member's
 * name, sizes, method and flags, which is enough to refuse a bomb, a traversal, a link or an
 * encrypted member before a byte is decompressed. Members are then inflated one at a time from
 * the offsets the central directory gives, through a streaming inflater with a running byte
 * counter, so a member that inflates past what it declared is stopped mid-stream instead of
 * being believed.
 *
 * The central directory is the only index used. A local header is read only to find where its
 * data starts; a local header that disagrees with the central one does not change what is read.
 * ZIP64 archives are refused: N-10's 100 MB archive / 500 MB unpacked never needs them.
 */
import { open, type FileHandle } from 'node:fs/promises';

import { Inflate } from 'fflate';

import { FileFailure } from './fileErrors.js';

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** Upper 16 bits: Unix mode when the archive was made on Unix. */
  externalAttrs: number;
  /** High byte of "version made by": 3 = Unix. */
  madeBy: number;
}

/** Random access over the archive: a file on disk or a Buffer already in memory. */
export interface ZipSource {
  size: number;
  read(position: number, length: number): Promise<Buffer>;
  close(): Promise<void>;
}

export function bufferSource(data: Buffer): ZipSource {
  return {
    size: data.length,
    read: async (position, length) => data.subarray(position, Math.min(data.length, position + length)),
    close: async () => undefined,
  };
}

export async function fileSource(path: string): Promise<ZipSource> {
  const handle: FileHandle = await open(path, 'r');
  const { size } = await handle.stat();
  return {
    size,
    read: async (position, length) => {
      const buf = Buffer.alloc(Math.max(0, Math.min(length, size - position)));
      if (buf.length === 0) return buf;
      const { bytesRead } = await handle.read(buf, 0, buf.length, position);
      return buf.subarray(0, bytesRead);
    },
    close: () => handle.close(),
  };
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
/** EOCD is 22 bytes plus a comment of at most 65,535. */
const EOCD_SEARCH = 22 + 0xffff;
/** Central directory entries read at most (ours): far above N-10's 20, bounds a hostile listing. */
const MAX_ENTRIES = 10_000;

/** Every member the central directory declares. Throws `corrupt` when there is no directory. */
export async function readCentralDirectory(src: ZipSource): Promise<ZipEntry[]> {
  const tailLen = Math.min(src.size, EOCD_SEARCH);
  const tail = await src.read(src.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FileFailure('corrupt');
  const total = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new FileFailure('unsupported_type', 'This ZIP uses the ZIP64 format, which is not supported. Re-create it with a standard ZIP tool.');
  }
  if (total > MAX_ENTRIES) throw new FileFailure('zip_too_many_members');
  if (cdOffset + cdSize > src.size) throw new FileFailure('corrupt');

  const cd = await src.read(cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN_SIG) throw new FileFailure('corrupt');
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const entry: ZipEntry = {
      madeBy: cd.readUInt16LE(p + 4) >> 8,
      flags: cd.readUInt16LE(p + 8),
      method: cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      uncompressedSize: cd.readUInt32LE(p + 24),
      externalAttrs: cd.readUInt32LE(p + 38),
      localHeaderOffset: cd.readUInt32LE(p + 42),
      // Names are UTF-8 when flag bit 11 is set; otherwise CP437, whose ASCII part is the same.
      name: cd.subarray(p + 46, p + 46 + nameLen).toString((cd.readUInt16LE(p + 8) & 0x800) !== 0 ? 'utf8' : 'latin1'),
    };
    if (
      entry.compressedSize === 0xffffffff ||
      entry.uncompressedSize === 0xffffffff ||
      entry.localHeaderOffset === 0xffffffff
    ) {
      throw new FileFailure('unsupported_type', 'This ZIP uses the ZIP64 format, which is not supported. Re-create it with a standard ZIP tool.');
    }
    entries.push(entry);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export const isDirectory = (e: ZipEntry): boolean => e.name.endsWith('/');
export const isEncrypted = (e: ZipEntry): boolean => (e.flags & 0x1) !== 0;
/** A Unix symlink: mode S_IFLNK in the upper half of the external attributes. */
export const isSymlink = (e: ZipEntry): boolean => e.madeBy === 3 && ((e.externalAttrs >>> 16) & 0o170000) === 0o120000;

/**
 * A member name that would land outside the folder it is unpacked into (zip-slip), or that no
 * file system should be handed: absolute, drive-lettered, `..` segments, backslashes, NUL.
 */
export function isUnsafePath(name: string): boolean {
  if (name.includes('\0') || name.includes('\\')) return true;
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return true;
  return name.split('/').some((seg) => seg === '..');
}

/** Where a member's compressed bytes start: after its local header's name and extra field. */
async function dataOffset(src: ZipSource, entry: ZipEntry): Promise<number> {
  const header = await src.read(entry.localHeaderOffset, 30);
  if (header.length < 30 || header.readUInt32LE(0) !== LOC_SIG) throw new FileFailure('corrupt');
  const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (start + entry.compressedSize > src.size) throw new FileFailure('corrupt');
  return start;
}

/** Thrown when a member inflates past a cap: what it declared, or the caller's own limit. */
export class InflateLimit extends Error {
  override name = 'InflateLimit';
}

/**
 * Streams one member's inflated bytes to `onChunk`, never more than `maxBytes` and never more
 * than the member declared. `stopAfter` ends early once that many bytes were produced (a
 * prolog check needs only the first few kilobytes). Returns the bytes produced.
 */
export async function inflateEntry(
  src: ZipSource,
  entry: ZipEntry,
  onChunk: (chunk: Uint8Array) => Promise<void> | void,
  opts: { maxBytes: number; stopAfter?: number; readChunk?: number } = { maxBytes: Number.MAX_SAFE_INTEGER },
): Promise<number> {
  if (isEncrypted(entry)) throw new FileFailure('encrypted');
  if (entry.method !== 0 && entry.method !== 8) throw new FileFailure('unsupported_type', 'This archive uses a compression method that is not supported.');
  const start = await dataOffset(src, entry);
  const cap = Math.min(opts.maxBytes, entry.uncompressedSize);
  const readChunk = opts.readChunk ?? 64 * 1024;
  let produced = 0;
  let stop = false;
  let overflow = false;
  const pending: Uint8Array[] = [];

  // Bytes past the cap are never handed on: the part within it is, and then the stream stops.
  const accept = (chunk: Uint8Array): void => {
    if (overflow) return;
    const room = cap - produced;
    if (chunk.length > room) {
      if (room > 0) pending.push(chunk.subarray(0, room));
      produced = cap;
      overflow = true;
      return;
    }
    produced += chunk.length;
    pending.push(chunk);
    if (opts.stopAfter !== undefined && produced >= opts.stopAfter) stop = true;
  };
  const inflater = entry.method === 8 ? new Inflate((chunk) => accept(chunk)) : null;

  for (let pos = 0; pos < entry.compressedSize && !stop && !overflow; pos += readChunk) {
    const len = Math.min(readChunk, entry.compressedSize - pos);
    const piece = await src.read(start + pos, len);
    const final = pos + len >= entry.compressedSize;
    try {
      if (inflater) inflater.push(piece, final);
      else accept(new Uint8Array(piece));
    } catch {
      throw new FileFailure('corrupt');
    }
    while (pending.length) await onChunk(pending.shift()!);
  }
  if (overflow) throw new InflateLimit(`member inflated past ${String(cap)} bytes`);
  return produced;
}
