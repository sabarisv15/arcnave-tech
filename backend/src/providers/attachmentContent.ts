/**
 * What an adapter sends for an attachment it cannot send natively (G15, G17). Shared so Claude
 * and Gemini say the same thing.
 *
 * Invariant 1: an attachment is never sent as an empty block, and binary bytes are never
 * decoded and passed off as text. The model is told what is missing, why, and the fileId that
 * still reaches the stored file through a tool.
 */
import type { AttachmentBlock } from './types.js';

/** MIME types whose raw bytes are text, so decoding them as UTF-8 is faithful. */
export function isTextualMime(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml'
  );
}

/**
 * The attachment's text, if it has any genuine text. `null` means there is none to send. When
 * the file itself was left out, the text says so first: extracted text is a fallback, not the
 * file, and the model should know it can still rehydrate the original.
 */
export function attachmentText(a: AttachmentBlock): string | null {
  let text: string | null = null;
  if (a.extractedText && a.extractedText.trim() !== '') {
    text = a.extractedText;
  } else if (a.base64 && isTextualMime(a.mimeType)) {
    const decoded = Buffer.from(a.base64, 'base64').toString('utf8');
    if (decoded.trim() !== '') text = decoded;
  }
  if (text === null) return null;
  if (a.omittedReason) return `${unavailableAttachmentNote(a)}\nExtracted text follows.\n\n${text}`;
  if (a.textOnlyPageCount) {
    return (
      `[This PDF has ${String(a.textOnlyPageCount)} pages. PDFs over 100 pages are read as text only, ` +
      'so its images, charts and scanned pages are not included. Code can still open the file.]\n\n' +
      text
    );
  }
  return text;
}

/** The label that introduces each page, so a model can name the page it read. */
export function pageLabel(a: AttachmentBlock, num: number): string {
  const total = a.pages?.length ?? 0;
  return `${a.filename ? `"${a.filename}" ` : ''}page ${String(num)} of ${String(total)}`;
}

function describe(a: AttachmentBlock): string {
  const name = a.filename ? `"${a.filename}"` : 'An attachment';
  const facts = [a.id ? `fileId: ${a.id}` : null, a.mimeType, a.sizeBytes ? `${a.sizeBytes} bytes` : null]
    .filter(Boolean)
    .join(', ');
  return `${name} (${facts})`;
}

/** The note sent in place of an attachment whose content is not in this request. */
export function unavailableAttachmentNote(a: AttachmentBlock): string {
  const reach = a.id
    ? ` It is still stored: call read_uploaded_file, or pass fileId "${a.id}" to a tool that takes files.`
    : '';
  switch (a.omittedReason) {
    case 'history_budget':
      return (
        `[Attachment ${describe(a)} is not included in this request: earlier attachments exceed ` +
        `the per-request size budget.${reach}]`
      );
    case 'model_limit':
      return (
        `[Attachment ${describe(a)} is not included in this request: with it, the request would ` +
        `exceed the selected model's per-request limits.${reach}]`
      );
    case 'unreadable':
      return (
        `[Attachment ${describe(a)} could not be opened as a PDF` +
        `${a.omittedDetail ? ` (${a.omittedDetail})` : ''}, so its pages are not included.${reach}]`
      );
    case 'storage_unavailable':
      return `[Attachment ${describe(a)} could not be loaded from storage for this request.${reach}]`;
    default:
      return (
        `[Attachment ${describe(a)} has no readable text: text extraction failed or the format ` +
        `is not supported, so its contents are not included.${reach}]`
      );
  }
}
