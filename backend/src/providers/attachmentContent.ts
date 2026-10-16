/**
 * What an adapter sends for an attachment it cannot send natively (G15, G17). Shared so every
 * adapter says the same thing.
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
  const total = a.pageCount ?? a.pages?.length ?? 0;
  return `${a.filename ? `"${a.filename}" ` : ''}page ${String(num)} of ${String(total)}`;
}

function describe(a: AttachmentBlock): string {
  const name = a.filename ? `"${a.filename}"` : 'An attachment';
  const facts = [a.id ? `fileId: ${a.id}` : null, a.mimeType, a.sizeBytes ? `${a.sizeBytes} bytes` : null]
    .filter(Boolean)
    .join(', ');
  return `${name} (${facts})`;
}

/**
 * Office and e-book files are read from the file, not from flattened text in the conversation,
 * when the turn can run code (ADR-0045). Extracted text drops cell addresses, formulas, hidden
 * sheets and layout, and a large workbook's text crowds the request; code reads them exactly.
 * PDFs, images and plain-text formats stay in the conversation.
 */
const READ_WITH_CODE_EXTENSIONS = /\.(docx|xlsx|xlsm|xls|pptx|odt|rtf|epub)$/i;
const READ_WITH_CODE_MIME = /wordprocessingml|spreadsheetml|presentationml|ms-excel|opendocument\.text|\/rtf$|epub\+zip/;

export function readsWithCode(a: AttachmentBlock): boolean {
  return READ_WITH_CODE_MIME.test(a.mimeType) || READ_WITH_CODE_EXTENSIONS.test(a.filename ?? '');
}

/** The attachment as sent when the turn can run code: identity and a pointer, no inline text. */
export function asReadWithCode(a: AttachmentBlock): AttachmentBlock {
  if (a.omittedReason || !readsWithCode(a)) return a;
  // Stage 9 CF4 / D9-8 (ADR-0063, superseding ADR-0045 §1): a file whose token count fits the
  // whole-file limit goes inline as its normalised text, even when code could read it.
  if (a.wholeWithinBudget) return a;
  const { base64: _bytes, extractedText: text, ...rest } = a;
  // Above the limit: the pointer, plus the excerpts retrieved for this question.
  return { ...rest, extractedText: a.excerpted ? (text ?? null) : null, omittedReason: 'read_with_code' };
}

/** The note sent in place of an attachment whose content is not in this request. */
export function unavailableAttachmentNote(a: AttachmentBlock): string {
  const reach = a.id
    ? ` It is still stored: it is on the computer in input/ (fileId "${a.id}"; its path is in the file list).`
    : '';
  switch (a.omittedReason) {
    case 'read_with_code':
      return (
        `[Attachment ${describe(a)} is read from its file, not shown here as text. It is on the ` +
        `computer in input/ (its path is in the file list).]`
      );
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
