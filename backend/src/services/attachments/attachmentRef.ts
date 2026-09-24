/**
 * The one boundary where a stored attachment row becomes the internal `AttachmentRef` (G26).
 *
 * Every path that carries an attachment forward (current turn, history, executors, adapters)
 * gets it from here, so no consumer ever guesses between field names. Before this existed the
 * workspace materialisation read `att.name` while every producer set `filename`, and the sandbox
 * `input/` directory stayed empty.
 */
import type { AttachmentRef } from '../../providers/types.js';

export interface AttachmentRow {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  extractedText?: string | null;
}

export function toAttachmentRef(row: AttachmentRow): AttachmentRef {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    extractedText: row.extractedText ?? null,
  };
}
