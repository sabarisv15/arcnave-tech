/**
 * What the model is told about the chat's files, and where the sandbox computer has them.
 *
 * `sandboxInputNames` gives every chat file a fixed name under `input/`. The manifest prints it
 * and `CodeExecutionToolExecutor` places every file under exactly that name, so the path the
 * model reads is the path that exists. The manifest names no skill: which skill to read is the
 * system prompt's mapping, applied after the model has seen what is already in context
 * (ADR-0047).
 */
import path from 'node:path';

import type { AttachmentBlock } from '../../providers/types.js';
import { nameForModel } from '../../providers/attachmentContent.js';

export interface ManifestFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
  /** How this request carries the file's content, from `contextNote`; absent when it is not sent. */
  inContext?: string;
}

/**
 * How the request carries a file, told on its manifest line. Live (turn 531d000c), a scanned PDF
 * whose 12 page images were in the request was read again with OCR over 26 tool calls: the list
 * said only that the file was on the computer, never that the model could already see it.
 */
export function contextNote(a: AttachmentBlock): string {
  if (a.omittedReason === 'read_with_code') return 'not in your context: read it from its file';
  if (a.omittedReason) return 'not in your context this turn';
  if (a.pages) {
    const images = a.pages.filter((p) => p.image?.fileUri || p.image?.base64).length;
    const withText = a.pages.filter((p) => p.text.trim() !== '').length;
    const layer = withText === 0 ? 'no text layer' : `a text layer on ${String(withText)} of ${String(a.pages.length)}`;
    const extra = a.textOnlyPageCount ? `; ${String(a.textOnlyPageCount)} more pages as text only` : '';
    return `in your context: ${String(images)} page image${images === 1 ? '' : 's'}, ${layer}${extra}`;
  }
  if (a.base64 && a.mimeType.startsWith('image/')) return 'in your context as an image';
  if (a.base64) return 'in your context';
  if (a.extractedText) return 'in your context as text';
  return 'not in your context this turn';
}

/** fileId -> name under `input/`. Stable for the same list: duplicate names get the first 8
 *  characters of the fileId, in list order, so the manifest and the workspace always agree. */
export function sandboxInputNames(files: Pick<ManifestFile, 'id' | 'filename'>[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const f of files) {
    if (out.has(f.id)) continue;
    const sanitized = path.basename(f.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    let name = sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : `attachment_${f.id.slice(0, 8)}`;
    if (taken.has(name)) {
      const ext = path.extname(name);
      name = `${path.basename(name, ext)}_${f.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}${ext}`;
    }
    taken.add(name);
    out.set(f.id, name);
  }
  return out;
}

export interface ManifestOptions {
  /** The sandbox computer is available this turn: print each file's path on it. */
  sandbox: boolean;
}

export function buildAttachmentManifest(files: ManifestFile[], opts: ManifestOptions): string {
  if (files.length === 0) return '';
  const names = sandboxInputNames(files);
  const lines = files.map((f) => {
    const parts = [`- fileId: "${f.id}"`, `filename: "${nameForModel(f.filename)}"`, `type: ${f.mimeType}`, `size: ${String(f.sizeBytes ?? 0)} bytes`];
    if (opts.sandbox) parts.push(`path: input/${names.get(f.id)!}`);
    if (f.inContext) parts.push(f.inContext);
    return parts.join(' | ');
  });
  const notes = ['Use fileId when filenames are ambiguous.'];
  if (opts.sandbox) {
    notes.push(
      'Every file above is also on the computer at its path, read-only. A file in your context is already ' +
        'read: use the computer to change that file or to build a new one, not to read it again.',
    );
  }
  return `<available_attachments>\nAvailable conversation attachments:\n${lines.join('\n')}\n\n${notes.join('\n')}\n</available_attachments>`;
}
