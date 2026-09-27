/**
 * What the model is told about the chat's files, and where run_python finds them.
 *
 * An uploaded file is already in the code container at
 * a path the model is told, and the model reads the skill for that kind of file before working
 * on it. Here, both follow from one deterministic plan:
 *
 * - `sandboxInputNames` gives every chat file a fixed name under `input/`. The manifest prints
 *   it and `CodeExecutionToolExecutor` materialises every file under exactly that name, so the
 *   path the model reads is the path that exists. No fileId needs to be passed to run_python.
 * - `skillForFile` names the skill for a file's type, printed on its manifest line, next to the
 *   file itself. The model still decides whether to load it (ADR-0006). The hint sits where the
 *   file is described, rather than only in a general rule it can skip. That is the failure seen
 *   on the 2026-09-24 KVB turn: nine run_python calls on a PDF and no `load_skill`.
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

const SKILL_BY_EXTENSION: Record<string, string> = {
  // An uploaded PDF is read, so its hint is the reading skill; `pdf` builds and changes PDFs
  // (ADR-0044). Pointing here at `pdf` cost a round loading the wrong skill first.
  '.pdf': 'pdf-reading',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
  '.xls': 'xlsx',
  '.csv': 'xlsx',
  '.tsv': 'xlsx',
  '.docx': 'docx',
  '.doc': 'docx',
  '.pptx': 'pptx',
  '.ppt': 'pptx',
};

const SKILL_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf-reading',
  'text/csv': 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx',
};

/** The skill that covers working with this kind of file, if there is one. */
export function skillForFile(file: Pick<ManifestFile, 'filename' | 'mimeType'>): string | undefined {
  return SKILL_BY_MIME[file.mimeType] ?? SKILL_BY_EXTENSION[path.extname(file.filename).toLowerCase()];
}

export interface ManifestOptions {
  /** run_python is available this turn: print each file's path under the working directory. */
  sandbox: boolean;
  /** Skills that exist and can be loaded this turn; hints name only these. */
  loadableSkills: ReadonlySet<string>;
}

export function buildAttachmentManifest(files: ManifestFile[], opts: ManifestOptions): string {
  if (files.length === 0) return '';
  const names = sandboxInputNames(files);
  let anySkill = false;
  const lines = files.map((f) => {
    const parts = [`- fileId: "${f.id}"`, `filename: "${f.filename}"`, `type: ${f.mimeType}`, `size: ${String(f.sizeBytes ?? 0)} bytes`];
    if (opts.sandbox) parts.push(`run_python path: input/${names.get(f.id)!}`);
    const skill = skillForFile(f);
    if (skill && opts.loadableSkills.has(skill)) {
      parts.push(`skill: ${skill}`);
      anySkill = true;
    }
    return parts.join(' | ');
  });
  const notes = ['Use fileId when filenames are ambiguous.'];
  if (opts.sandbox) {
    notes.push('Every file above is already in run_python\'s working directory at its path; open it there directly.');
  }
  if (anySkill) {
    notes.push(
      'Before working with a file\'s contents (reading, extracting, counting, converting, editing), call ' +
        'load_skill for the skill named on its line, unless that skill is already loaded in this turn.',
    );
  }
  return `<available_attachments>\nAvailable conversation attachments:\n${lines.join('\n')}\n\n${notes.join('\n')}\n</available_attachments>`;
}
