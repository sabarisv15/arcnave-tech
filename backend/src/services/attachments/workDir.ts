/**
 * Where the file pipeline keeps its working copies (ADR-0066, review finding M1).
 *
 * On Cloud Run the default temporary directory is an in-memory file system: every byte written
 * under `os.tmpdir()` counts against the instance's memory, beside the parsers' own. FILE_TMP_DIR
 * moves every working copy the pipeline makes (the job's download, ZIP members, audio pieces,
 * OCR renders, parser scratch, page images) to one configured directory, e.g. a mounted volume.
 * Empty means `os.tmpdir()`, as before.
 *
 * The directory is process-wide, like the config it comes from: the file service sets it when it
 * is built, and every `mkdtemp` in `services/attachments` and `routes/files.ts` goes through
 * `makeWorkDir` (a test fails when one does not).
 */
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let configured = '';

/** Sets the working directory root (FILE_TMP_DIR); '' restores `os.tmpdir()`. */
export function setFileTmpDir(dir: string): void {
  configured = dir.trim();
}

/** The root every working directory is made under. */
export function fileTmpDir(): string {
  return configured || os.tmpdir();
}

/** A fresh directory under FILE_TMP_DIR; the caller removes it. */
export async function makeWorkDir(prefix: string): Promise<string> {
  const root = fileTmpDir();
  // A mounted volume's mount point exists; a subdirectory of it may not yet.
  if (configured) await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, prefix));
}
