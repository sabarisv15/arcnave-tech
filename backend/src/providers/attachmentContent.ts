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

/**
 * A user-controlled name (an attachment's filename, a project file's name, a ZIP member's path)
 * as the model sees it, everywhere it sees it: prompt text, the attachment list, a
 * `<document filename="…">` attribute, a document title, tool results (ADR-0069). One spelling,
 * so the model never meets one file under two names.
 *
 * What changes, and why:
 * - `<`, `>` and the characters that look like them become `&lt;` / `&gt;`, and `"` and `|`
 *   become `&quot;` / `&#124;`: every place quotes the name or separates fields with `|`, so a
 *   name could otherwise open a tag, end its quotes, or forge a field.
 * - Line breaks and other control characters (C0, DEL, C1, U+2028/2029) become a space, so a name
 *   cannot start a line of its own.
 * - Invisible characters (Unicode's Default_Ignorable_Code_Point set: bidi controls and isolates,
 *   zero-width characters, BOM, tag characters, variation selectors, the soft hyphen, Hangul
 *   fillers) are dropped: they can hide or reorder what the model reads.
 * `&` and `'` stay, so "R&D John's notes.pdf" reads as stored. A name that already contains
 * `&lt;` reads the same as one containing `<`; no tool takes a filename, only a fileId, so the
 * model's spelling of a name is never looked up.
 *
 * One pass over a character class with no quantifier, so it is linear in the name's length.
 */
export function nameForModel(name: string): string {
  return name.replace(UNTRUSTED_NAME_CHARS, (c) => NAME_REPLACEMENTS.get(c) ?? (DROPPED.test(c) ? '' : ' '));
}

/** Lookalikes of `<` and `>` (ours: a chosen set, not a Unicode table): fullwidth and small
 *  forms, angle quotation marks, angle brackets, ornaments, modifier arrowheads, syllabics. None
 *  is special inside a character class, so they go into the pattern as they are. */
const LESS_THAN_LOOKALIKES = '\uFF1C\uFE64\u2039\u2329\u3008\u27E8\u276C\u276E\u02C2\u1438\u2770\u27EA\u29FC\u300A';
const GREATER_THAN_LOOKALIKES = '\uFF1E\uFE65\u203A\u232A\u3009\u27E9\u276D\u276F\u02C3\u1433\u2771\u27EB\u29FD\u300B';
/** Lookalikes of `"` and `|` (ours, review build-3-fix r1): a quote or bar the model reads as the
 *  real one could still end a quoted name or forge a `|` field. */
const QUOTE_LOOKALIKES = '\uFF02\u201C\u201D\u201E\u201F\u2033\u02BA';
const BAR_LOOKALIKES = '\uFF5C\u2223\u01C0\u2502\u23D0\u2758';
/** Invisible characters that hide or reorder text, as pattern source: Unicode's
 *  Default_Ignorable_Code_Point set, which holds the Arabic letter mark, zero-width characters,
 *  LRM/RLM, bidi embeddings, overrides and isolates, the word joiner and invisible operators, the
 *  BOM, tag characters, variation selectors, the soft hyphen and the Hangul fillers. */
const DROPPED_CLASS = '\\p{Default_Ignorable_Code_Point}';
/** Control characters and line separators, as pattern source: each becomes a space. */
const SPACED_CLASS = '\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029';

const UNTRUSTED_NAME_CHARS = new RegExp(
  `[<>"|${LESS_THAN_LOOKALIKES}${GREATER_THAN_LOOKALIKES}${QUOTE_LOOKALIKES}${BAR_LOOKALIKES}${DROPPED_CLASS}${SPACED_CLASS}]`,
  'gu',
);
const DROPPED = new RegExp(`^[${DROPPED_CLASS}]$`, 'u');
const NAME_REPLACEMENTS = new Map<string, string>([
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ['|', '&#124;'],
  ...[...LESS_THAN_LOOKALIKES].map((c): [string, string] => [c, '&lt;']),
  ...[...GREATER_THAN_LOOKALIKES].map((c): [string, string] => [c, '&gt;']),
  ...[...QUOTE_LOOKALIKES].map((c): [string, string] => [c, '&quot;']),
  ...[...BAR_LOOKALIKES].map((c): [string, string] => [c, '&#124;']),
]);

/** The label that introduces each page, so a model can name the page it read. */
export function pageLabel(a: AttachmentBlock, num: number): string {
  const total = a.pageCount ?? a.pages?.length ?? 0;
  return `${a.filename ? `"${nameForModel(a.filename)}" ` : ''}page ${String(num)} of ${String(total)}`;
}

function describe(a: AttachmentBlock): string {
  const name = a.filename ? `"${nameForModel(a.filename)}"` : 'An attachment';
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
