/**
 * What a file is, from its bytes (Stage 1 FT-12, Stage 9 INTAKE / G1, D1 #4).
 *
 * The name and the browser's claim were checked at upload start (`checkUpload`); this checks
 * that the content agrees with them. None of the three alone is enough: a renamed executable
 * passes the name check, and a legacy or macro Office file renamed to `.docx` passes both.
 * Our own magic table over the first bytes, no new dependency (D1 #4 option A).
 *
 * It also finds the two cases the locked rules name for Office files: a password-protected
 * OOXML file is an OLE2 compound file holding an `EncryptedPackage` stream (FT-11), and a true
 * OLE2 file under any Office name is the legacy format (FT-3), refused with "save as".
 */
import { open, readFile } from 'node:fs/promises';

import { FileFailure, saveAsText } from './fileErrors.js';
import { extensionOf } from '../storage.js';

export type SniffKind =
  | 'pdf'
  | 'zip'
  | 'ole2'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'rtf'
  | 'media'
  | 'text'
  | 'binary';

/** The Stage 9 INTAKE minimum: at least 2 KB of the file is read. */
export const SNIFF_BYTES = 4096;

const startsWith = (b: Buffer, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, at: number, s: string): boolean => b.subarray(at, at + s.length).toString('latin1') === s;

export function detectKind(head: Buffer): SniffKind {
  // PDF readers accept the header anywhere in the first 1,024 bytes; so do we.
  if (head.subarray(0, 1024).includes('%PDF-')) return 'pdf';
  if (startsWith(head, [0x50, 0x4b]) && [0x0304, 0x0506, 0x0708].includes(head.readUInt16BE(2))) return 'zip';
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole2';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')) return 'gif';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return 'webp';
  if (ascii(head, 0, '{\\rtf')) return 'rtf';
  if (
    ascii(head, 0, 'ID3') ||
    (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WAVE')) ||
    ascii(head, 0, 'OggS') ||
    ascii(head, 0, 'fLaC') ||
    ascii(head, 4, 'ftyp') ||
    ascii(head, 4, 'moov') ||
    ascii(head, 4, 'mdat') ||
    ascii(head, 4, 'wide') ||
    startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]) ||
    // MPEG audio / ADTS AAC frame sync: 11 set bits.
    (head[0] === 0xff && head.length > 1 && (head[1]! & 0xe0) === 0xe0)
  ) {
    return 'media';
  }
  // A UTF-16 byte-order mark makes NULs legitimate; otherwise a NUL means binary.
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff])) return 'text';
  return head.includes(0) ? 'binary' : 'text';
}

const ZIP_CONTAINERS = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.epub', '.zip']);
const IMAGE_KIND: Record<string, SniffKind> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.gif': 'gif',
  '.webp': 'webp',
};

/** The legacy extension an OOXML name stands in for, for the "save as" text. */
const LEGACY_OF: Record<string, string> = { '.docx': '.doc', '.xlsx': '.xls', '.pptx': '.ppt', '.xls': '.xls' };

/** Bytes of the UTF-16LE directory-entry name an encrypted OOXML compound file carries. */
const ENCRYPTED_PACKAGE = Buffer.from('EncryptedPackage', 'utf16le');

/**
 * Checks the content against the name. `whole` is the complete file when it is cheap to have
 * (an OLE2 file's directory can sit anywhere in it); otherwise only the head is used. Returns
 * the detected kind; throws `FileFailure` when the content and the name disagree.
 */
export function sniffBuffer(head: Buffer, filename: string, mimeType: string, whole?: Buffer): SniffKind {
  const ext = extensionOf(filename);
  const kind = detectKind(head);

  if (kind === 'ole2') {
    if (ext in LEGACY_OF || ext === '.docm' || ext === '.xlsm' || ext === '.pptm') {
      if ((whole ?? head).includes(ENCRYPTED_PACKAGE)) throw new FileFailure('encrypted');
      throw new FileFailure('unsupported_type', saveAsText(LEGACY_OF[ext] ?? ext));
    }
    throw mismatch(ext);
  }

  let ok: boolean;
  if (ext === '.pdf' || mimeType === 'application/pdf') ok = kind === 'pdf';
  else if (ext === '.xls') ok = kind === 'text' || kind === 'zip'; // table exports, or an .xlsx misnamed
  else if (ZIP_CONTAINERS.has(ext)) ok = kind === 'zip';
  else if (ext === '.rtf') ok = kind === 'rtf';
  else if (ext in IMAGE_KIND) ok = kind === IMAGE_KIND[ext];
  else if (mimeType.startsWith('image/')) ok = ['png', 'jpeg', 'gif', 'webp'].includes(kind);
  else if (mimeType.startsWith('audio/') || (mimeType.startsWith('video/') && mimeType !== 'video/mp2t')) ok = kind === 'media';
  else ok = kind === 'text';
  if (!ok) throw mismatch(ext);
  return kind;
}

function mismatch(ext: string): FileFailure {
  return new FileFailure(
    'unsupported_type',
    `The content of this file does not match its name${ext ? ` (${ext})` : ''}. Save it in the right format and upload it again.`,
  );
}

/** `sniffBuffer` for a file on disk: reads the head, and the whole file only for OLE2. */
export async function sniffFile(path: string, filename: string, mimeType: string): Promise<SniffKind> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
    const first = head.subarray(0, bytesRead);
    if (detectKind(first) === 'ole2') {
      // Office files are at most 100 MB (N-10), and the encrypted marker needs the directory.
      return sniffBuffer(first, filename, mimeType, await readFile(path));
    }
    return sniffBuffer(first, filename, mimeType);
  } finally {
    await handle.close();
  }
}
