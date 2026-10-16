/**
 * An uploaded ZIP becomes its members, each its own attachment (Stage 9 ZIP, Stage 1 FT-4,
 * Stage 16 FL-2, UD-2; D1 #1 option A, no new dependency).
 *
 * Inspect before extract: every refusal below is decided from the central directory alone,
 * before anything is inflated. Then each member is inflated with a running byte counter
 * capped at what it declared and at the 500 MB total (N-10), so a member that lies about its
 * size is stopped mid-stream. Only then is anything stored: a refused ZIP leaves no members.
 *
 * Rules: one level (no ZIP inside), at most 20 files (N-10), at most 500 MB unpacked (N-10),
 * no symlink, no path that leaves the archive, no encryption, every member a type `checkUpload`
 * accepts. macOS resource forks (`__MACOSX/`, `._*`) and `.DS_Store` / `Thumbs.db` are skipped,
 * not refused: every ZIP made on a Mac carries them (ours).
 */
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { Config } from '../../config.js';
import { NUMBERS } from '../../config/numbers.js';
import { checkUpload, extensionOf } from '../storage.js';
import { FileFailure } from './fileErrors.js';
import { ratioExceeded } from './preflight.js';
import { detectKind, SNIFF_BYTES } from './sniff.js';
import {
  fileSource,
  inflateEntry,
  InflateLimit,
  isDirectory,
  isEncrypted,
  isSymlink,
  isUnsafePath,
  readCentralDirectory,
  type ZipEntry,
} from './zipReader.js';

/** Formats that are ZIP containers themselves, so a `PK` member of these names is not nesting. */
const ZIP_DOCUMENTS = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.epub']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.jar', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz']);

function skipped(name: string): boolean {
  const base = name.split('/').pop() ?? name;
  return name.startsWith('__MACOSX/') || base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db';
}

export interface ZipMember {
  /** Path inside the archive, which is safe (checked) and used as the attachment's name. */
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** The unpacked member on local disk, removed when `expand` returns. */
  localPath: string;
}

/** The member list a ZIP would unpack to, or the refusal. Inflates nothing. */
export function inspectEntries(entries: ZipEntry[], cfg: Config): Array<ZipEntry & { mimeType: string }> {
  const files = entries.filter((e) => !isDirectory(e) && !skipped(e.name));
  if (entries.some(isEncrypted)) throw new FileFailure('zip_encrypted');
  if (entries.some((e) => isUnsafePath(e.name))) throw new FileFailure('zip_unsafe_path');
  if (entries.some(isSymlink)) throw new FileFailure('zip_symlink');
  if (files.length === 0) throw new FileFailure('unsupported_type', 'This ZIP has no files in it.');
  if (files.length > NUMBERS.ZIP_MAX_MEMBERS.value /* N-10 */) throw new FileFailure('zip_too_many_members');
  if (files.some((e) => ARCHIVE_EXTENSIONS.has(extensionOf(e.name)))) throw new FileFailure('zip_nested');
  const total = files.reduce((n, e) => n + e.uncompressedSize, 0);
  if (total > NUMBERS.ZIP_MAX_UNPACKED_BYTES.value /* N-10 */) throw new FileFailure('zip_too_large_unpacked');
  if (files.some((e) => ratioExceeded(e, cfg.ZIP_MAX_RATIO))) throw new FileFailure('zip_ratio');

  return files.map((e) => {
    const check = checkUpload(e.name.split('/').pop() ?? e.name, '', Math.max(1, e.uncompressedSize), cfg, cfg.ATTACHMENT_MAX_BYTES);
    if (!check.ok) {
      throw new FileFailure(
        check.code === 'payload_too_large' ? 'zip_too_large_unpacked' : 'zip_member_type',
        check.code === 'payload_too_large' ? undefined : `This ZIP contains “${e.name}”, a file type that is not supported, so it was not opened.`,
      );
    }
    return { ...e, mimeType: check.mimeType };
  });
}

/**
 * Unpacks the ZIP at `zipPath` to local files and hands each to `onMember` (which stores it);
 * every refusal happens before the first `onMember` call.
 */
export async function expandZip(
  zipPath: string,
  cfg: Config,
  onMember: (member: ZipMember) => Promise<void>,
): Promise<string[]> {
  const src = await fileSource(zipPath);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-zip-'));
  try {
    const planned = inspectEntries(await readCentralDirectory(src), cfg);
    const members: ZipMember[] = [];
    let unpacked = 0;
    for (const [i, entry] of planned.entries()) {
      const localPath = path.join(dir, String(i));
      const out = await open(localPath, 'w');
      let head = Buffer.alloc(0);
      let produced = 0;
      try {
        const room = NUMBERS.ZIP_MAX_UNPACKED_BYTES.value - unpacked; // N-10
        produced = await inflateEntry(
          src,
          entry,
          async (chunk) => {
            if (head.length < SNIFF_BYTES) head = Buffer.concat([head, Buffer.from(chunk.subarray(0, SNIFF_BYTES - head.length))]);
            await out.write(chunk);
          },
          { maxBytes: room, readChunk: 16 * 1024 },
        );
        unpacked += produced;
      } catch (err) {
        // Inflating past what it declared: the directory lied, the classic bomb.
        if (err instanceof InflateLimit) throw new FileFailure('zip_ratio');
        if (err instanceof FileFailure && err.code === 'encrypted') throw new FileFailure('zip_encrypted');
        throw err;
      } finally {
        await out.close();
      }
      // A ZIP named as something else is still a nested archive.
      if (detectKind(head) === 'zip' && !ZIP_DOCUMENTS.has(extensionOf(entry.name))) throw new FileFailure('zip_nested');
      members.push({ name: entry.name.slice(-255), mimeType: entry.mimeType, sizeBytes: produced, localPath });
    }
    for (const member of members) await onMember(member);
    return members.map((m) => m.name);
  } finally {
    await src.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** A member's bytes as a stream, for `ObjectStorage.putStream`. */
export function memberStream(member: ZipMember): Readable {
  return createReadStream(member.localPath);
}
