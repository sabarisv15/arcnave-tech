/**
 * Reading a plain-text upload (CSV, TXT, MD, code) as text (Stage 9 G32 / G46, D1 #31).
 *
 * Encoding, in this order: a BOM (UTF-8, UTF-16 LE / BE); UTF-16 without a BOM, told by the NUL
 * in every other byte of the head; UTF-8 when the whole file decodes strictly; otherwise
 * Windows-1252 with an `encoding_guess` warning, because a Western spreadsheet export is far
 * more common than anything else that fails UTF-8. No guessing library (ours).
 *
 * A NUL left in the decoded text means the file is binary under a text name: `corrupt`.
 *
 * The file is streamed: a 300 MB CSV is decoded to a local file and never held as one string.
 * Only the head (up to `keepChars`) comes back in memory.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { finished } from 'node:stream/promises';

import type { FileWarning } from '../../db/schema.js';
import { FileFailure, warning } from './fileErrors.js';

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

const HEAD = 64 * 1024;

export async function detectEncoding(path: string): Promise<{ encoding: TextEncoding; bom: number }> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(HEAD);
    const { bytesRead } = await fh.read(head, 0, HEAD, 0);
    const b = head.subarray(0, bytesRead);
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { encoding: 'utf-8', bom: 3 };
    if (b[0] === 0xff && b[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 };
    if (b[0] === 0xfe && b[1] === 0xff) return { encoding: 'utf-16be', bom: 2 };
    // UTF-16 without a BOM: ASCII-range text puts a NUL in every other byte.
    const pairs = Math.floor(b.length / 2);
    if (pairs >= 8) {
      let evenNul = 0;
      let oddNul = 0;
      for (let i = 0; i < pairs * 2; i += 2) {
        if (b[i] === 0) evenNul++;
        if (b[i + 1] === 0) oddNul++;
      }
      if (oddNul / pairs > 0.3 && evenNul / pairs < 0.05) return { encoding: 'utf-16le', bom: 0 };
      if (evenNul / pairs > 0.3 && oddNul / pairs < 0.05) return { encoding: 'utf-16be', bom: 0 };
    }
    return { encoding: (await isUtf8(path)) ? 'utf-8' : 'windows-1252', bom: 0 };
  } finally {
    await fh.close();
  }
}

async function isUtf8(path: string): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
      decoder.decode(chunk as Buffer, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

export interface DecodedText {
  encoding: TextEncoding;
  /** The text, when it is at most `keepChars`; null when longer (read it from `outPath`). */
  text: string | null;
  /** The first `keepChars` characters, always. */
  head: string;
  chars: number;
  warnings: FileWarning[];
}

/**
 * Decodes `path` to UTF-8 at `outPath`. Throws `FileFailure('corrupt')` on a NUL in the text.
 */
export async function decodeTextFile(path: string, outPath: string, keepChars: number): Promise<DecodedText> {
  const { encoding, bom } = await detectEncoding(path);
  // Node's TextDecoder has no UTF-16BE; swap byte pairs and read it as LE.
  const decoder = new TextDecoder(encoding === 'utf-16be' ? 'utf-16le' : encoding);
  const out = createWriteStream(outPath, { encoding: 'utf8' });
  let head = '';
  let chars = 0;
  let carry: number | null = null;
  const feed = (s: string) => {
    if (s.includes('\0')) throw new FileFailure('corrupt', 'This file has binary content, so it is not a text file. Upload it in its own format.');
    if (head.length < keepChars) head += s.slice(0, keepChars - head.length);
    chars += s.length;
    out.write(s);
  };
  try {
    let first = true;
    for await (const raw of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
      let chunk = raw as Buffer;
      if (first) {
        chunk = chunk.subarray(bom);
        first = false;
      }
      if (encoding === 'utf-16be') {
        if (carry !== null) {
          chunk = Buffer.concat([Buffer.from([carry]), chunk]);
          carry = null;
        }
        if (chunk.length % 2 === 1) {
          carry = chunk[chunk.length - 1]!;
          chunk = chunk.subarray(0, chunk.length - 1);
        }
        chunk = Buffer.from(chunk).swap16();
      }
      feed(decoder.decode(chunk, { stream: true }));
    }
    feed(decoder.decode());
  } finally {
    out.end();
    await finished(out);
  }
  return {
    encoding,
    text: chars <= keepChars ? head : null,
    head,
    chars,
    warnings:
      encoding === 'windows-1252'
        ? [warning('encoding_guess', 'This file is not UTF-8 or UTF-16, so it was read as Windows-1252. Some characters may be wrong; save it as UTF-8 for an exact read.')]
        : [],
  };
}
