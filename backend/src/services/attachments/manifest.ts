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

export interface ManifestFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
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
    const parts = [`- fileId: "${f.id}"`, `filename: "${f.filename}"`, `type: ${f.mimeType}`, `size: ${String(f.sizeBytes ?? 0)} bytes`];
    if (opts.sandbox) parts.push(`path: input/${names.get(f.id)!}`);
    return parts.join(' | ');
  });
  const notes = ['Use fileId when filenames are ambiguous.'];
  if (opts.sandbox) {
    notes.push('Every file above is also on the computer at its path, read-only.');
  }
  return `<available_attachments>\nAvailable conversation attachments:\n${lines.join('\n')}\n\n${notes.join('\n')}\n</available_attachments>`;
}
